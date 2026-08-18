// ===== xfQTrace 半自动化 trace 模板 =====
// 修改 CONFIG 即可适配不同 app，脚本逻辑不需要动

const CONFIG = {
    package: "com.xiaofeng.qbdi",
    target: {type: "func", so_name: "libxftest.so", offset: 0x20414},
    options: {
        inline_hook_backend: 2,         // 0=ShadowHook, 1=frida-gum, 2=Dobby
        out_format: "traceui",          // "traceui" | "xfqtrace" | {line, separator_rw}
        lz4_compression: { enable: true, level: 0 },
        logging: {
            hook_result_level: "E",     // hook arg / hook return
            trace_event_level: "W",     // start trace / trace end / completed
        },
        stop_condition: { max_traces: 10 },
        hook_format: { args: "cstr", ret: "hex", naming_source: 0, naming_index: 0 },
        // filter: { arg: 0, type: "cstr", op: "eq", value: "hello_svc_test" },
        // filter_display: "cstr",
        // memory_trace: false,
        // sync_flush: false,
        // anon_trace: true,
    },
};

// ======================== 以下为脚本逻辑，一般不需要修改 ========================

const ENGINE_PATH = `/data/data/${CONFIG.package}/files/libxfqtrace.so`;

const _dlopen = new NativeFunction(
    Module.findExportByName(null, "dlopen"), "pointer", ["pointer", "int"]
);
const _dlsym = new NativeFunction(
    Module.findExportByName(null, "dlsym"), "pointer", ["pointer", "pointer"]
);

var g_handle = null;
var g_done_callback = null;

function loadEngine() {
    if (g_handle) return;
    g_handle = _dlopen(Memory.allocUtf8String(ENGINE_PATH), 2);
    if (g_handle.isNull()) throw new Error("dlopen failed: " + ENGINE_PATH);
    console.log("[*] engine loaded: " + g_handle);
}

function getApi(name, ret, args) {
    var addr = _dlsym(g_handle, Memory.allocUtf8String(name));
    if (!addr || addr.isNull()) throw new Error(name + " not found");
    return new NativeFunction(addr, ret, args);
}

function buildJson(base) {
    var json = {};
    json.target = Object.assign({}, CONFIG.target, { base: base.toString() });
    json.options = CONFIG.options;
    return JSON.stringify(json);
}

function armTrace() {
    var mod = Process.findModuleByName(CONFIG.target.so_name);
    if (!mod) { console.log("[-] " + CONFIG.target.so_name + " not loaded"); return; }

    console.log("[*] " + CONFIG.target.so_name + " @ " + mod.base);
    loadEngine();

    var configure   = getApi("xfqtrace_configure", "int", ["pointer"]);
    var start       = getApi("xfqtrace_start", "int", []);
    var get_error   = getApi("xfqtrace_get_last_error", "pointer", []);
    var set_done_cb = getApi("xfqtrace_set_done_callback", "void", ["pointer"]);

    var json = buildJson(mod.base);
    console.log("[*] config: " + json);

    var rc = configure(Memory.allocUtf8String(json));
    if (rc !== 0) {
        console.log("[-] config error: " + get_error().readCString());
        send({ type: "trace_done" });
        return;
    }

    if (start() !== 0) {
        console.log("[-] start error: " + get_error().readCString());
        send({ type: "trace_done" });
        return;
    }
    console.log("[+] trace armed! " + CONFIG.target.so_name + "+0x" + CONFIG.target.offset.toString(16));

    g_done_callback = new NativeCallback(function() {
        send({type: "trace_done"});
    }, "void", []);
    set_done_cb(g_done_callback);

    // demo app: trace 装载完毕后触发测试
    if (CONFIG.target.so_name === "libxftest.so") {
        setTimeout(function() {
            Java.perform(function() {
                try {
                    var MainActivity = Java.use("com.xiaofeng.qbdi.MainActivity");
                    var ok = MainActivity.triggerAllTests("hello_svc_test");
                    console.log("[+] triggered nativeRunAllTests => " + ok);
                } catch(e) {
                    console.log("[-] Java trigger failed: " + e);
                }
            });
        }, 500);
    }
}

var g_armed = false;
var g_dlopen_listener = Interceptor.attach(Module.findExportByName(null, "android_dlopen_ext"), {
    onEnter: function(args) {},
    onLeave: function(retval) {
        if (!g_armed && Process.findModuleByName(CONFIG.target.so_name)) {
            g_armed = true;
            console.log("[*] detected load: " + CONFIG.target.so_name);
            g_dlopen_listener.detach();
            armTrace();
        }
    }
});

if (Process.findModuleByName(CONFIG.target.so_name)) {
    console.log("[*] " + CONFIG.target.so_name + " already loaded");
    g_armed = true;
    armTrace();
}

console.log("[*] waiting for " + CONFIG.target.so_name + " ...");

rpc.exports = {
    stop: function() {
        if (!g_armed) g_dlopen_listener.detach();
        if (g_handle) {
            try { getApi("xfqtrace_stop", "void", [])(); } catch(e) {}
            try { getApi("xfqtrace_set_done_callback", "void", ["pointer"])(ptr(0)); } catch(e) {}
        }
        g_done_callback = null;
        console.log("[*] xfqtrace stopped");
    }
};
