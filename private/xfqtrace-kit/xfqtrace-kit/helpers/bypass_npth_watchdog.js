// bypass_npth_watchdog.js — 禁用字节 NPTH ANR monitor 看门狗
// NPTH 通过 npth_anr_monitor_loop 检测主线程无响应,超时后自杀进程。
// 策略:
// 1. hook libnpth.so 的 monitor loop 让它永远 sleep(不检测)
// 2. 兜底: hook kill/tgkill/raise/abort/__rt_sigaction 拦截 SIGKILL 自杀

(function() {
    var myPid = Process.id;
    console.log("[bypass_npth] pid=" + myPid);

    // 方案 1: 直接让 npth_anr_monitor_loop 变成死循环 sleep
    var npth = Process.findModuleByName("libnpth.so");
    if (npth) {
        // 搜导出符号(可能没有,npth 可能 strip 了)
        var symbols = npth.enumerateExports();
        var monitorSym = symbols.find(function(s) {
            return s.name.indexOf("anr_monitor") >= 0 || s.name.indexOf("npth_monitor") >= 0;
        });
        if (monitorSym) {
            console.log("[bypass_npth] found monitor export: " + monitorSym.name + " @ " + monitorSym.address);
            Interceptor.replace(monitorSym.address, new NativeCallback(function() {
                console.log("[bypass_npth] npth monitor loop DISABLED (replaced with infinite sleep)");
                while (true) { Thread.sleep(999999); }
            }, "void", []));
        } else {
            // 没有导出符号,用字符串搜或 pattern matching
            console.log("[bypass_npth] no exported monitor symbol, searching by string ref...");
            // "npth_anr_monitor_loop" 这个字符串在 logcat 里出现过,搜 SO 里的字符串引用
            var ranges = npth.enumerateRanges("r-x");
            // 兜底: 直接 hook pthread_create 在 npth 模块里的调用,让 monitor 线程不启动
        }
    } else {
        console.log("[bypass_npth] libnpth.so not loaded yet, waiting...");
    }

    // 方案 2: hook kill 和 tgkill(libc wrapper + raw syscall)
    var kill_addr = Module.findExportByName("libc.so", "kill");
    if (kill_addr) {
        Interceptor.attach(kill_addr, {
            onEnter: function(args) {
                var pid = args[0].toInt32();
                var sig = args[1].toInt32();
                if ((pid === myPid || pid === 0 || pid === -1) && sig === 9) {
                    console.log("[bypass_npth] BLOCKED kill(" + pid + ", SIGKILL)");
                    this.blocked = true;
                }
            },
            onLeave: function(retval) { if (this.blocked) retval.replace(0); }
        });
    }

    var tgkill_addr = Module.findExportByName("libc.so", "tgkill");
    if (tgkill_addr) {
        Interceptor.attach(tgkill_addr, {
            onEnter: function(args) {
                var tgid = args[0].toInt32();
                var sig = args[2].toInt32();
                if (tgid === myPid && sig === 9) {
                    console.log("[bypass_npth] BLOCKED tgkill(" + tgid + ", " + args[1].toInt32() + ", SIGKILL)");
                    this.blocked = true;
                }
            },
            onLeave: function(retval) { if (this.blocked) retval.replace(0); }
        });
    }

    // hook raise(SIGKILL)
    var raise_addr = Module.findExportByName("libc.so", "raise");
    if (raise_addr) {
        Interceptor.attach(raise_addr, {
            onEnter: function(args) {
                if (args[0].toInt32() === 9) {
                    console.log("[bypass_npth] BLOCKED raise(SIGKILL)");
                    this.blocked = true;
                }
            },
            onLeave: function(retval) { if (this.blocked) retval.replace(0); }
        });
    }

    // hook abort()
    var abort_addr = Module.findExportByName("libc.so", "abort");
    if (abort_addr) {
        Interceptor.attach(abort_addr, {
            onEnter: function(args) {
                console.log("[bypass_npth] BLOCKED abort()");
                // 改成 sleep 挂起而不是真 abort
                while(true) { Thread.sleep(999999); }
            }
        });
    }

    // hook exit / _exit
    ["exit", "_exit"].forEach(function(name) {
        var addr = Module.findExportByName("libc.so", name);
        if (addr) {
            Interceptor.attach(addr, {
                onEnter: function(args) {
                    var code = args[0].toInt32();
                    console.log("[bypass_npth] BLOCKED " + name + "(" + code + ")");
                    while(true) { Thread.sleep(999999); }
                }
            });
        }
    });

    console.log("[bypass_npth] watchdog bypass armed (kill/tgkill/raise/abort/exit all hooked)");
})();
