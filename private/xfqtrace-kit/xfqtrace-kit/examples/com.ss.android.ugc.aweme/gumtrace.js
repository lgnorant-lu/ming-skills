// app_version: 34.6.0
// GumTrace device-side comparison for Douyin.
// This does not load libxfqtrace.so or QBDI. It wraps libmetasec_ml.so+0x77EC4
// with Frida Interceptor and runs libGumTrace.so only for the current thread.
const CONFIG = {
    package: "com.ss.android.ugc.aweme",
    target_so: "libmetasec_ml.so",
    target_offset: 0x77EC4,
    trace_so_path: "/data/data/com.ss.android.ugc.aweme/files/libGumTrace.so",
    output_path: "/data/data/com.ss.android.ugc.aweme/files/gumtrace_dy.log",
    options_mode: 0,
};

let gumtraceInit = null;
let gumtraceRun = null;
let gumtraceUnrun = null;
let gumtraceLoaded = false;
let armed = false;
let tracing = false;
let hitCount = 0;
let dlopenListener = null;
let targetListener = null;
let doneSent = false;
let doneTimer = null;

function log(msg) {
    console.log("[gumtrace-dy] " + msg);
}

function sendDoneOnce() {
    if (doneSent) return;
    doneSent = true;
    send({ type: "trace_done" });
}

function scheduleDone(delayMs) {
    if (doneTimer !== null || doneSent) return;
    doneTimer = setTimeout(sendDoneOnce, delayMs);
}

function loadGumTrace() {
    if (gumtraceLoaded) return true;

    const dlopen = new NativeFunction(Module.findExportByName(null, "dlopen"), "pointer", ["pointer", "int"]);
    const dlsym = new NativeFunction(Module.findExportByName(null, "dlsym"), "pointer", ["pointer", "pointer"]);
    const handle = dlopen(Memory.allocUtf8String(CONFIG.trace_so_path), 2);
    if (handle.isNull()) {
        log("dlopen failed: " + CONFIG.trace_so_path);
        return false;
    }

    gumtraceInit = new NativeFunction(
        dlsym(handle, Memory.allocUtf8String("init")),
        "void",
        ["pointer", "pointer", "int", "pointer"]
    );
    gumtraceRun = new NativeFunction(dlsym(handle, Memory.allocUtf8String("run")), "void", []);
    gumtraceUnrun = new NativeFunction(dlsym(handle, Memory.allocUtf8String("unrun")), "void", []);
    gumtraceLoaded = true;
    log("loaded " + CONFIG.trace_so_path);
    return true;
}

function startTrace() {
    if (tracing) return true;
    if (!loadGumTrace()) return false;

    const moduleNames = Memory.allocUtf8String(CONFIG.target_so);
    const outputPath = Memory.allocUtf8String(CONFIG.output_path);
    const options = Memory.alloc(8);
    options.writeU64(CONFIG.options_mode);

    gumtraceInit(moduleNames, outputPath, 0, options);
    gumtraceRun();
    tracing = true;
    log("trace started, output=" + CONFIG.output_path);
    return true;
}

function stopTrace() {
    if (!tracing) return;
    gumtraceUnrun();
    tracing = false;
    log("trace stopped");
}

function armTarget() {
    if (armed) return true;

    const mod = Process.findModuleByName(CONFIG.target_so);
    if (!mod) return false;

    const target = mod.base.add(CONFIG.target_offset);
    targetListener = Interceptor.attach(target, {
        onEnter(args) {
            hitCount++;
            this.hitIndex = hitCount;
            this.tracing = false;
            log("enter #" + this.hitIndex +
                " pid=" + Process.id +
                " tid=" + this.threadId +
                " target=" + target +
                " x0=" + args[0] +
                " x1=" + args[1] +
                " x2=" + args[2] +
                " x3=" + args[3]);
            if (this.hitIndex === 1 && startTrace()) {
                this.tracing = true;
                scheduleDone(15000);
            }
        },
        onLeave(retval) {
            log("leave #" + this.hitIndex + " ret=" + retval);
            if (this.tracing) {
                stopTrace();
                scheduleDone(2000);
            }
        },
    });

    armed = true;
    log(CONFIG.target_so + " @ " + mod.base + ", armed target=" + target);
    return true;
}

function installDlopenWatcher() {
    const androidDlopenExt = Module.findExportByName(null, "android_dlopen_ext");
    if (!androidDlopenExt) {
        throw new Error("android_dlopen_ext not found");
    }

    dlopenListener = Interceptor.attach(androidDlopenExt, {
        onLeave() {
            if (armTarget() && dlopenListener) {
                dlopenListener.detach();
                dlopenListener = null;
            }
        },
    });
}

if (!armTarget()) {
    installDlopenWatcher();
    log("waiting for " + CONFIG.target_so + " ...");
}

rpc.exports = {
    stop() {
        try {
            stopTrace();
        } catch (e) {
            log("stopTrace error: " + e);
        }
        if (targetListener) {
            targetListener.detach();
            targetListener = null;
        }
        if (dlopenListener) {
            dlopenListener.detach();
            dlopenListener = null;
        }
        log("stopped, hits=" + hitCount);
    },
};
