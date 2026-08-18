'use strict';

var TARGET_CLASS = 'com.taobao.wireless.security.adapter.JNICLibrary';
var TARGET_SO = 'libsgmainso-6.6.231201.33656539.so';
var TARGET_CMD = 70102;
var installed = false;

function log(s) { console.log('[hook] ' + s); }

function dumpObjectArray(arr) {
  if (arr === null) return 'null';
  var out = [];
  try {
    for (var i = 0; i < arr.length; i++) {
      try { out.push(String(arr[i])); }
      catch (e) { out.push('<err:' + e + '>'); }
    }
  } catch (e) {
    return '<dump failed: ' + e + '>';
  }
  return JSON.stringify(out);
}

function installHook() {
  var JNICLibrary = Java.use(TARGET_CLASS);
  var m = JNICLibrary.doCommandNative.overload('int', '[Ljava.lang.Object;');

  m.implementation = function (cmd, args) {
    if (cmd !== TARGET_CMD) return m.call(this, cmd, args);

    log('doCommandNative enter cmd=' + cmd + ' args=' + dumpObjectArray(args));
    var ret = m.call(this, cmd, args);
    log('doCommandNative leave cmd=' + cmd + ' ret=' + ret);
    return ret;
  };

  installed = true;
  log('installed: ' + TARGET_CLASS + '.doCommandNative(int,Object[]) filter cmd=' + TARGET_CMD);
}

function tryInstall() {
  if (installed || !Java.available) return;

  Java.perform(function () {
    if (installed) return;

    try {
      installHook();
      return;
    } catch (_) {}

    Java.enumerateClassLoaders({
      onMatch: function (loader) {
        if (installed) return;
        try {
          loader.findClass(TARGET_CLASS);
          Java.classFactory.loader = loader;
          log('use classloader: ' + loader);
          installHook();
        } catch (_) {}
      },
      onComplete: function () {
        if (!installed) log('class not found yet: ' + TARGET_CLASS);
      }
    });
  });
}

function watchDlopen() {
  var p = Module.findExportByName(null, 'android_dlopen_ext');
  if (!p) return;

  Interceptor.attach(p, {
    onEnter: function (args) {
      try { this.path = args[0].isNull() ? '' : args[0].readCString(); }
      catch (_) { this.path = ''; }
    },
    onLeave: function () {
      if (this.path.indexOf(TARGET_SO) >= 0) {
        log('android_dlopen_ext loaded ' + this.path);
        setTimeout(tryInstall, 0);
      }
    }
  });
  log('watch android_dlopen_ext');
}

watchDlopen();
tryInstall();
setInterval(tryInstall, 1000);
