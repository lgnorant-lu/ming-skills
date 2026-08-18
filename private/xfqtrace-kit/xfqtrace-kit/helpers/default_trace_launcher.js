// Auto-generated xfQTrace launcher template.
// Python replaces the token below with recipe.json content.

var CONFIG = __XFQTRACE_CONFIG_JSON__;
var ENGINE_PATH = "/data/data/" + CONFIG.package + "/files/libxfqtrace.so";
var ENGINE_PATH_ALT = "/data/user/0/" + CONFIG.package + "/files/libxfqtrace.so";

var _dlopen_addr = Module.findExportByName(null, "dlopen");
var _android_dlopen_ext_addr = Module.findExportByName(null, "android_dlopen_ext");
var _dlsym_addr = Module.findExportByName(null, "dlsym");
var _dlerror_addr = Module.findExportByName(null, "dlerror");
if (!_dlopen_addr || !_android_dlopen_ext_addr || !_dlsym_addr) {
  throw new Error("dlopen/android_dlopen_ext/dlsym not found");
}

var _dlopen = new NativeFunction(_dlopen_addr, "pointer", ["pointer", "int"]);
var _dlsym = new NativeFunction(_dlsym_addr, "pointer", ["pointer", "pointer"]);
var _dlerror = _dlerror_addr ? new NativeFunction(_dlerror_addr, "pointer", []) : null;
var _fopen = null;
var _fgets = null;
var _fclose = null;
var _loader_dlopen = null;
var _loader_android_dlopen_ext = null;

var g_handle = null;
var g_done_callback = null;
var g_armed = false;
var g_dlopen_listeners = [];
var g_arm_retry_timer = null;
var g_last_dlopen_error = "";
var g_seen_dlopen_errors = {};
var g_target_path = null;

function log(msg) { console.log("[qtrace] " + msg); }

function findLinkerSymbol(name) {
  var candidates = [name, "__dl__" + name];
  for (var c = 0; c < candidates.length; c++) {
    try {
      var exp = Module.findExportByName(null, candidates[c]);
      if (exp) return exp;
    } catch (e) {}
    try {
      var exp2 = Module.findExportByName("linker64", candidates[c]) || Module.findExportByName("linker", candidates[c]);
      if (exp2) return exp2;
    } catch (e) {}
  }
  var mods = Process.enumerateModules();
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    if (m.name !== "linker64" && m.name !== "linker" && (!m.path || m.path.indexOf("/linker") === -1)) continue;
    try {
      var syms = m.enumerateSymbols();
      for (var j = 0; j < syms.length; j++) {
        if (syms[j].name === name || syms[j].name === "__dl__" + name) return syms[j].address;
      }
    } catch (e) {}
  }
  return null;
}

function dlerrorString() {
  try {
    var ep = _dlerror ? _dlerror() : ptr(0);
    return ep && !ep.isNull() ? (": " + ep.readCString()) : "";
  } catch (e) {
    return "";
  }
}

function noteLoadError(msg) {
  if (!g_seen_dlopen_errors[msg]) {
    g_seen_dlopen_errors[msg] = true;
    g_last_dlopen_error = msg;
    log(msg);
  }
}

function tryPlainDlopen(path) {
  g_handle = _dlopen(Memory.allocUtf8String(path), 2);
  if (g_handle.isNull()) {
    var err = dlerrorString();
    noteLoadError("dlopen failed: " + path + err);
    g_handle = null;
    return false;
  } else {
    g_last_dlopen_error = "";
    log("engine loaded: " + g_handle);
    return true;
  }
}

function tryLoaderAndroidDlopenExt(path, callerAddr) {
  if (_loader_android_dlopen_ext === null) {
    var addr = findLinkerSymbol("__loader_android_dlopen_ext");
    _loader_android_dlopen_ext = addr ? new NativeFunction(addr, "pointer", ["pointer", "int", "pointer", "pointer"]) : false;
    log(_loader_android_dlopen_ext ? ("linker __loader_android_dlopen_ext ready: " + addr) : "linker __loader_android_dlopen_ext not found");
  }
  if (!_loader_android_dlopen_ext) return false;
  g_handle = _loader_android_dlopen_ext(Memory.allocUtf8String(path), 2, ptr(0), callerAddr);
  if (g_handle.isNull()) {
    noteLoadError("__loader_android_dlopen_ext failed: " + path + " caller=" + callerAddr + dlerrorString());
    g_handle = null;
    return false;
  }
  g_last_dlopen_error = "";
  log("engine loaded via __loader_android_dlopen_ext: " + g_handle + " caller=" + callerAddr);
  return true;
}

function tryLoaderDlopen(path, callerAddr) {
  if (_loader_dlopen === null) {
    var addr = findLinkerSymbol("__loader_dlopen");
    _loader_dlopen = addr ? new NativeFunction(addr, "pointer", ["pointer", "int", "pointer"]) : false;
    log(_loader_dlopen ? ("linker __loader_dlopen ready: " + addr) : "linker __loader_dlopen not found");
  }
  if (!_loader_dlopen) return false;
  g_handle = _loader_dlopen(Memory.allocUtf8String(path), 2, callerAddr);
  if (g_handle.isNull()) {
    noteLoadError("__loader_dlopen failed: " + path + " caller=" + callerAddr + dlerrorString());
    g_handle = null;
    return false;
  }
  g_last_dlopen_error = "";
  log("engine loaded via __loader_dlopen: " + g_handle + " caller=" + callerAddr);
  return true;
}

function dirname(path) {
  var p = path || "";
  var i = p.lastIndexOf("/");
  return i >= 0 ? p.substring(0, i) : "";
}

function pathEndsWithName(path, name) {
  return !!path && path.length > name.length &&
      path.substring(path.length - name.length - 1) === ("/" + name);
}

function tryLoadEngine(callerAddr, extraPaths) {
  if (g_handle) return true;
  var paths = ENGINE_PATH === ENGINE_PATH_ALT ? [ENGINE_PATH] : [ENGINE_PATH, ENGINE_PATH_ALT];
  if (extraPaths) {
    for (var ep = 0; ep < extraPaths.length; ep++) {
      if (extraPaths[ep] && paths.indexOf(extraPaths[ep]) === -1) paths.unshift(extraPaths[ep]);
    }
  }
  for (var i = 0; i < paths.length; i++) {
    if (tryPlainDlopen(paths[i])) return true;
  }

  var callers = [];
  if (callerAddr && !callerAddr.isNull()) callers.push(callerAddr);
  for (var c = 0; c < callers.length; c++) {
    var ca = callers[c];
    for (var j = 0; j < paths.length; j++) {
      if (tryLoaderAndroidDlopenExt(paths[j], ca)) return true;
      if (tryLoaderDlopen(paths[j], ca)) return true;
    }
  }

  return false;
}

function getApi(name, ret, args) {
  var addr = _dlsym(g_handle, Memory.allocUtf8String(name));
  if (!addr || addr.isNull()) throw new Error(name + " not found");
  return new NativeFunction(addr, ret, args);
}

function buildTargetWithBase(base) {
  var target = {};
  var src = CONFIG.target || {};
  for (var k in src) {
    if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
  }
  target.base = base.toString();
  return target;
}

function buildJson(base) {
  return JSON.stringify({
    target: buildTargetWithBase(base),
    options: CONFIG.options || {}
  });
}

function formatOffsetForLog(offset) {
  if (typeof offset === "string") {
    return offset.indexOf("0x") === 0 || offset.indexOf("0X") === 0 ? offset : ("0x" + offset);
  }
  return "0x" + offset.toString(16);
}

function clearArmRetry() {
  if (g_arm_retry_timer !== null) {
    try { clearInterval(g_arm_retry_timer); } catch (e) {}
    g_arm_retry_timer = null;
  }
}

function detachDlopenListeners() {
  for (var i = 0; i < g_dlopen_listeners.length; i++) {
    try { g_dlopen_listeners[i].detach(); } catch (e) {}
  }
  g_dlopen_listeners = [];
}

function findTargetModuleFromMaps() {
  var name = CONFIG.target.so_name;
  if (_fopen === null) {
    var fopenAddr = Module.findExportByName(null, "fopen");
    var fgetsAddr = Module.findExportByName(null, "fgets");
    var fcloseAddr = Module.findExportByName(null, "fclose");
    _fopen = (fopenAddr && fgetsAddr && fcloseAddr) ? new NativeFunction(fopenAddr, "pointer", ["pointer", "pointer"]) : false;
    _fgets = _fopen ? new NativeFunction(fgetsAddr, "pointer", ["pointer", "int", "pointer"]) : false;
    _fclose = _fopen ? new NativeFunction(fcloseAddr, "int", ["pointer"]) : false;
  }
  if (!_fopen) return null;
  try {
    var f = _fopen(Memory.allocUtf8String("/proc/self/maps"), Memory.allocUtf8String("r"));
    if (f.isNull()) return null;
    var buf = Memory.alloc(4096);
    while (!_fgets(buf, 4096, f).isNull()) {
      var line = buf.readCString();
      if (line.indexOf("/" + name) === -1) continue;
      var cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      var path = cols.slice(5).join(" ");
      if (!pathEndsWithName(path, name)) continue;
      var start = cols[0].split("-")[0];
      _fclose(f);
      return { name: name, path: path, base: ptr("0x" + start) };
    }
    _fclose(f);
  } catch (e) {}
  return null;
}

function findTargetModule() {
  var name = CONFIG.target.so_name;
  var mapsMod = findTargetModuleFromMaps();
  if (mapsMod) return mapsMod;
  var mods = Process.enumerateModules();
  var fallback = null;
  for (var i = 0; i < mods.length; i++) {
    var m = mods[i];
    var hit = (m.name === name) || pathEndsWithName(m.path, name);
    if (!hit) continue;
    if (m.path && m.path.indexOf("/data/app/") === 0) return m;
    if (!fallback && pathEndsWithName(m.path, name)) fallback = m;
  }
  var direct = Process.findModuleByName(name);
  if (direct && !pathEndsWithName(direct.path, name)) direct = null;
  return fallback || direct;
}

function armTrace() {
  var mod = findTargetModule();
  if (!mod) {
    log(CONFIG.target.so_name + " not loaded");
    return;
  }
  var targetPath = g_target_path || mod.path;
  if (!targetPath ||
      !pathEndsWithName(targetPath, CONFIG.target.so_name)) {
    log("ignore mismatched module for " + CONFIG.target.so_name + ": " + (targetPath || "<no path>"));
    return false;
  }
  var libdirEnginePath = targetPath ? (dirname(targetPath) + "/libxfqtrace.so") : null;
  if (!tryLoadEngine(mod.base, libdirEnginePath ? [libdirEnginePath] : [])) return false;

  log(CONFIG.target.so_name + " @ " + mod.base + (targetPath ? (" path=" + targetPath) : ""));

  var configure = getApi("xfqtrace_configure", "int", ["pointer"]);
  var start = getApi("xfqtrace_start", "int", []);
  var get_error = getApi("xfqtrace_get_last_error", "pointer", []);
  var set_done_cb = getApi("xfqtrace_set_done_callback", "void", ["pointer"]);

  var json = buildJson(mod.base);
  log("config: " + json);

  var rc = configure(Memory.allocUtf8String(json));
  if (rc !== 0) {
    log("configure failed: " + get_error().readCString());
    send({ type: "trace_done" });
    return;
  }

  if (start() !== 0) {
    log("start failed: " + get_error().readCString());
    send({ type: "trace_done" });
    return;
  }

  log("trace armed! " + CONFIG.target.so_name + "+" + formatOffsetForLog(CONFIG.target.offset));

  g_done_callback = new NativeCallback(function () {
    send({ type: "trace_done" });
  }, "void", []);
  set_done_cb(g_done_callback);

  if (CONFIG.frida && (CONFIG.frida.trigger_xfq_demo || CONFIG.frida.trigger_static_method)) {
    setTimeout(function () {
      Java.perform(function () {
        try {
          var MainActivity = Java.use("com.xiaofeng.qbdi.MainActivity");
          var method = CONFIG.frida.trigger_static_method || "triggerAllTests";
          var arg = CONFIG.frida.trigger_arg || "hello_svc_test";
          var ok = MainActivity[method].overload("java.lang.String").call(MainActivity, arg);
          log("triggered " + method + " => " + ok);
        } catch (e) {
          log("Java trigger failed: " + e);
        }
      });
    }, CONFIG.frida.trigger_delay_ms || 500);
  }
  return true;
}

function scheduleArmTrace() {
  if (g_armed) return;
  if (armTrace()) {
    g_armed = true;
    clearArmRetry();
    detachDlopenListeners();
    return;
  }
  if (g_arm_retry_timer !== null) return;
  g_arm_retry_timer = setInterval(function () {
    if (g_armed) return;
    try {
      if (armTrace()) {
        g_armed = true;
        clearArmRetry();
        detachDlopenListeners();
      }
    } catch (e) {
      log("arm retry failed: " + e);
    }
  }, 200);
  log("arm retry scheduled");
}

function watchDlopen(addr, name) {
  if (!addr || addr.isNull()) return;
  var listener = Interceptor.attach(addr, {
    onEnter: function (args) {
      this.hit = false;
      try {
        var path = args[0].isNull() ? "" : args[0].readCString();
        this.hit = path.indexOf(CONFIG.target.so_name) !== -1;
        if (this.hit) g_target_path = path;
      } catch (e) {}
    },
    onLeave: function (retval) {
      if (!g_armed && this.hit) {
        log("detected load: " + CONFIG.target.so_name);
        scheduleArmTrace();
      }
    }
  });
  g_dlopen_listeners.push(listener);
  log("watch " + name);
}

function installDlopenWatch() {
  watchDlopen(_android_dlopen_ext_addr, "android_dlopen_ext");
  watchDlopen(_dlopen_addr, "dlopen");
}

var initiallyLoaded = Process.findModuleByName(CONFIG.target.so_name);
if (initiallyLoaded && (!initiallyLoaded.path ||
    !pathEndsWithName(initiallyLoaded.path, CONFIG.target.so_name))) {
  initiallyLoaded = null;
}
if (initiallyLoaded) {
  log(CONFIG.target.so_name + " already loaded");
  setTimeout(function () {
    if (!g_armed) scheduleArmTrace();
  }, 100);
} else {
  installDlopenWatch();
  setTimeout(function () {
    if (!g_armed && findTargetModule()) {
      log(CONFIG.target.so_name + " already loaded");
      scheduleArmTrace();
    }
  }, 100);
}

log("waiting for " + CONFIG.target.so_name + " ...");

function cleanupDone() {
  clearArmRetry();
  detachDlopenListeners();
  if (g_handle) {
    try { getApi("xfqtrace_set_done_callback", "void", ["pointer"])(ptr(0)); } catch (e) {}
  }
  g_done_callback = null;
}

rpc.exports = {
  cleanupDone: cleanupDone,
  cleanup_done: cleanupDone,
  stop: function () {
    clearArmRetry();
    detachDlopenListeners();
    if (g_handle) {
      try { getApi("xfqtrace_stop", "void", [])(); } catch (e) {}
      try { getApi("xfqtrace_set_done_callback", "void", ["pointer"])(ptr(0)); } catch (e) {}
    }
    g_done_callback = null;
    log("xfqtrace stopped");
  }
};
