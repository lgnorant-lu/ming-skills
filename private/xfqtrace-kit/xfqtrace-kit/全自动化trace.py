#!/usr/bin/env python3
"""
全自动化trace.py — xfQTrace 自动化: push SO → frida-server 注入 → 设备侧保存 xfQTrace logcat → 等待 trace 完成 → pull → lz4 解压

布局约定:
  开发仓库:
    kit/全自动化trace.py              <- 本文件
    kit/bin/libxfqtrace.so       <- 开发运行用 SO / lz4 / pidcat
    kit/半自动化trace.js              <- 默认 hook 脚本
    kit/helpers/                    <- bypass/auto-click/batch 等辅助脚本
    kit/examples/<package>/      <- 单包样本和本地 trace 输出

  xfqtrace-kit 产物:
    全自动化trace.py
    bin/libxfqtrace.so
    半自动化trace.js
    examples/<recipe>/

SO 分发路径:
  开发仓库固定使用 kit/bin/libxfqtrace.so
  kit 产物固定使用 bin/libxfqtrace.so
  避免“刚编译的 so”和“实际注入的 so”不一致

用法:
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --attach
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --quiet-logcat
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --clear-only
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --clear-logs
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --clear-logs target
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --clear-logs all --clear-only
  python ../xfqtrace-kit/全自动化trace.py -p com.ss.android.ugc.aweme
# 普通 trace 默认会先 force-stop 旧进程；清数据需显式 --clear-app-data
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --no-push
  python ../xfqtrace-kit/全自动化trace.py -p cn.soulapp.android --pull-only
  python ../xfqtrace-kit/全自动化trace.py -p com.mfw.roadbook --script ../xfqtrace-kit/examples/com.mfw.roadbook/半自动化trace.js
"""
import argparse
import json
import subprocess
import sys
import os
import time
import threading
import platform
import re
import shutil
import importlib.util
import tempfile
import shlex

try:
    import pty
except ImportError:  # Windows 下没有 pty；直接启动 pidcat.exe 即可
    pty = None

try:
    import frida
except ImportError:
    frida = None


SELF_DIR = os.path.dirname(os.path.abspath(__file__))


def _helper_dir(root):
    """Prefer helpers/ for auxiliary scripts; accept legacy scripts/ read-only."""
    helpers = os.path.join(root, "helpers")
    if os.path.isdir(helpers):
        return helpers
    return os.path.join(root, "scripts")


def detect_layout():
    """Return (examples_dir, helpers_dir, bin_dir) for kit source or packaged kit."""
    script_dir = SELF_DIR
    parent_dir = os.path.dirname(script_dir)

    # Kit source or packaged kit:
    #   kit/全自动化trace.py
    #   kit/bin/
    #   kit/helpers/
    #   kit/examples/
    if os.path.isdir(os.path.join(script_dir, "examples")):
        return (
            os.path.join(script_dir, "examples"),
            _helper_dir(script_dir),
            os.path.join(script_dir, "bin"),
        )

    if (
        os.path.basename(script_dir) in {"helpers", "scripts"}
        and os.path.isdir(os.path.join(parent_dir, "examples"))
    ):
        return (
            os.path.join(parent_dir, "examples"),
            _helper_dir(parent_dir),
            os.path.join(parent_dir, "bin"),
        )

    examples_root = script_dir if os.path.basename(script_dir).lower() != "bin" else os.path.dirname(script_dir)
    examples_dir = os.path.join(examples_root, "examples")
    if not os.path.isdir(examples_dir):
        examples_dir = examples_root
    return examples_dir, _helper_dir(examples_root), os.path.join(examples_root, "bin")


EXAMPLES_DIR, HELPERS_DIR, BIN_DIR = detect_layout()
SCRIPTS_DIR = HELPERS_DIR  # compatibility alias for older local code/snippets
KIT_ROOT = os.path.dirname(BIN_DIR)
# Canonical distributed SO path used by this automation entrypoint.
SO_PATH = os.path.join(BIN_DIR, "libxfqtrace.so")

FALLBACK_HOOK_SCRIPT = os.path.join(KIT_ROOT, "半自动化trace.js")
if not os.path.exists(FALLBACK_HOOK_SCRIPT):
    FALLBACK_HOOK_SCRIPT = os.path.join(HELPERS_DIR, "半自动化trace.js")

DEFAULT_TRACE_LAUNCHER = os.path.join(HELPERS_DIR, "default_trace_launcher.js")

BYPASS_SCRIPTS = {
    "msa":            os.path.join(HELPERS_DIR, "bypass_msa.js"),
    "bangbang":       os.path.join(HELPERS_DIR, "bypass_bangbang.js"),
    "apiguard3":      os.path.join(HELPERS_DIR, "bypass_apiguard3.js"),
    "dump_apiguard3": os.path.join(HELPERS_DIR, "dump_apiguard3.js"),
}
BUNDLED_LZ4_EXE = os.path.join(BIN_DIR, "lz4.exe") if platform.system() == "Windows" \
    else os.path.join(BIN_DIR, "lz4")
LZ4_EXE = None
LOGCAT_STARTUP_SETTLE_SEC = 0.50
LOCAL_LOG_DIRNAME = "xfqtrace_logs"
LOG_LEVELS = {"V", "D", "I", "W", "E", "F"}
DEFAULT_LOG_VIEWER = "none"
DEFAULT_CONSOLE_LOG_LEVEL = "I"
DEFAULT_LOG_FILE_LEVEL = "V"
ADB_COMMAND_TIMEOUT_SEC = 8

# 首启自动点击隐私协议脚本（文件名为中文，按路径动态加载复用其 drive_first_launch_ui）
AUTO_CLICK_SCRIPT = os.path.join(HELPERS_DIR, "自动点击隐私同意按钮.py")
_auto_click_mod = None


def load_xfinject_backend():
    path = os.path.join(HELPERS_DIR, "xfinject_backend.py")
    spec = importlib.util.spec_from_file_location("xfqtrace_xfinject_backend", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# 少数 demo/样本需要额外 UI 触发，不能让隐私协议 auto-click 线程乱点。
PACKAGE_DEFAULTS = {
    "com.xiaofeng.qbdi": {"no_auto_click": True},
}


def normalize_log_level(value, default):
    if value is None:
        return default
    value = str(value).strip().upper()
    if value in LOG_LEVELS:
        return value
    print(f"[!] invalid log level '{value}', using {default}")
    return default


def normalize_log_viewer(value, default=DEFAULT_LOG_VIEWER):
    if value is None:
        return default
    value = str(value).strip().lower()
    if value in {"auto", "pidcat", "logcat", "none"}:
        return value
    print(f"[!] invalid log viewer '{value}', using {default}")
    return default


def logcat_filter_args(level):
    level = normalize_log_level(level, DEFAULT_LOG_FILE_LEVEL)
    return [
        f"xfQTrace:{level}",
        f"xfQTrace.sync:{level}",
        "ActivityManager:I",
        "AndroidRuntime:E",
        "DEBUG:E",
        "libc:F",
        "crash_dump64:E",
        "tombstoned:E",
        "*:S",
    ]


def find_pidcat_executable():
    if platform.system() == "Windows":
        candidates = [
            os.path.join(BIN_DIR, "pidcat.exe"),
            os.path.join(BIN_DIR, "pidcat"),
            shutil.which("pidcat.exe"),
            shutil.which("pidcat"),
        ]
    else:
        candidates = [
            os.path.join(BIN_DIR, "pidcat"),
            os.path.join(BIN_DIR, "pidcat.exe"),
            shutil.which("pidcat"),
            shutil.which("pidcat.exe"),
        ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def load_hook_script_text(hook_script):
    with open(hook_script, "r", encoding="utf-8") as f:
        return f.read()




def recipe_path_for(package):
    return os.path.join(EXAMPLES_DIR, package, "recipe.json")


def resolve_recipe_path(package, recipe_path=None):
    if not recipe_path:
        return recipe_path_for(package)
    if os.path.isabs(recipe_path):
        return os.path.join(recipe_path, "recipe.json") if os.path.isdir(recipe_path) else recipe_path
    if os.path.exists(recipe_path):
        return os.path.join(recipe_path, "recipe.json") if os.path.isdir(recipe_path) else recipe_path
    package_dir = os.path.join(EXAMPLES_DIR, package)
    candidates = [
        os.path.join(package_dir, recipe_path),
        os.path.join(package_dir, recipe_path, "recipe.json"),
        os.path.join(package_dir, "recipes", recipe_path),
        os.path.join(package_dir, "recipes", recipe_path + ".json"),
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return os.path.join(candidate, "recipe.json") if os.path.isdir(candidate) else candidate
    return os.path.join(package_dir, recipe_path)


def load_recipe(package, recipe_path=None):
    path = resolve_recipe_path(package, recipe_path)
    if not os.path.exists(path):
        return None, None
    with open(path, "r", encoding="utf-8") as f:
        recipe = json.load(f)
    if not isinstance(recipe, dict):
        raise ValueError(f"recipe must be a JSON object: {path}")
    recipe = dict(recipe)
    recipe.setdefault("package", package)
    if "target" not in recipe or "options" not in recipe:
        raise ValueError(f"recipe.json requires target and options: {path}")
    return recipe, path


def build_frida_script_from_recipe(recipe):
    if not os.path.exists(DEFAULT_TRACE_LAUNCHER):
        raise FileNotFoundError(DEFAULT_TRACE_LAUNCHER)
    with open(DEFAULT_TRACE_LAUNCHER, "r", encoding="utf-8") as f:
        template = f.read()
    payload = json.dumps(recipe, ensure_ascii=False, separators=(",", ":"))
    return template.replace("__XFQTRACE_CONFIG_JSON__", payload)


def load_trace_recipe_or_script(package, script_path=None, recipe_path=None):
    if script_path:
        return load_hook_script_text(script_path), script_path, None
    recipe, recipe_path = load_recipe(package, recipe_path)
    if recipe is not None:
        return build_frida_script_from_recipe(recipe), recipe_path, recipe
    hook_script = resolve_hook_script(package)
    return load_hook_script_text(hook_script), hook_script, None

def load_auto_click_module():
    """惰性加载自动点击模块；失败返回 None 并打印原因。"""
    global _auto_click_mod
    if _auto_click_mod is not None:
        return _auto_click_mod
    if not os.path.exists(AUTO_CLICK_SCRIPT):
        print(f"[!] auto-click script not found: {AUTO_CLICK_SCRIPT}")
        return None
    try:
        spec = importlib.util.spec_from_file_location("xfqtrace_autoclick", AUTO_CLICK_SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _auto_click_mod = mod
        return mod
    except Exception as exc:  # pragma: no cover - 加载失败时降级
        print(f"[!] failed to load auto-click module: {exc}")
        return None


def start_auto_click_thread(serial, package, stop_event=None):
    """在后台线程驱动首启 UI 自动点击（app 由注入后端启动，辅助线程不重新启动）。"""
    mod = load_auto_click_module()
    if mod is None or not hasattr(mod, "drive_first_launch_ui"):
        print("[!] auto-click unavailable; skipping privacy-dialog automation")
        return None

    def _worker():
        try:
            mod.drive_first_launch_ui(
                serial=serial,
                package=package,
                timeout_sec=None,
                launch=False,
                stop_event=stop_event,
                relaunch_on_exit=False,
            )
        except Exception as exc:
            print(f"[!] auto-click thread error: {exc}")

    t = threading.Thread(target=_worker, name="auto-click", daemon=True)
    t.start()
    print("[*] auto-click thread started (runs until trace stops)")
    return t


def resolve_hook_script(package):
    """优先 examples/<package>/半自动化trace.js，回退 kit 根目录半自动化trace.js"""
    per_pkg = os.path.join(EXAMPLES_DIR, package, "半自动化trace.js")
    if os.path.exists(per_pkg):
        return per_pkg
    return FALLBACK_HOOK_SCRIPT


def allocate_session_dir(package):
    logs_root = os.path.join(EXAMPLES_DIR, package, LOCAL_LOG_DIRNAME)
    os.makedirs(logs_root, exist_ok=True)
    existing = [int(d) for d in os.listdir(logs_root)
                if d.isdigit() and os.path.isdir(os.path.join(logs_root, d))]
    seq = (max(existing) + 1) if existing else 1
    session_dir = os.path.join(logs_root, str(seq))
    os.makedirs(session_dir, exist_ok=True)
    return session_dir


def remove_tree_contents(path):
    if not os.path.isdir(path):
        return 0
    removed = 0
    for name in os.listdir(path):
        full = os.path.join(path, name)
        if os.path.isdir(full):
            shutil.rmtree(full, ignore_errors=True)
        else:
            try:
                os.remove(full)
            except FileNotFoundError:
                pass
        removed += 1
    return removed


def list_example_packages():
    packages = []
    for name in os.listdir(EXAMPLES_DIR):
        full = os.path.join(EXAMPLES_DIR, name)
        if not os.path.isdir(full):
            continue
        if name in {"bin", "helpers", "scripts", "USAGE.assets", "__pycache__"}:
            continue
        if name.startswith("."):
            continue
        if (
            os.path.isdir(os.path.join(full, LOCAL_LOG_DIRNAME))
            or os.path.exists(os.path.join(full, "recipe.json"))
            or os.path.isdir(os.path.join(full, "recipes"))
            or os.path.exists(os.path.join(full, "半自动化trace.js"))
        ):
            packages.append(name)
    return sorted(packages)


def clear_local_logs(package, scope):
    targets = [package] if scope == "target" else list_example_packages()
    if package not in targets:
        targets.append(package)

    removed_targets = []
    for pkg in sorted(set(targets)):
        logs_root = os.path.join(EXAMPLES_DIR, pkg, LOCAL_LOG_DIRNAME)
        if not os.path.isdir(logs_root):
            continue
        count = remove_tree_contents(logs_root)
        removed_targets.append((pkg, count))

    if not removed_targets:
        print("[*] No local logs directory matched")
        return

    for pkg, count in removed_targets:
        print(f"[*] Cleared local logs: {pkg} ({count} entry/entries)")


def clear_device_logs_for_package(serial, package):
    trace_dir = f"/data/data/{package}/files/trace_logs"
    adb_shell(f"rm -rf {trace_dir}", serial=serial, root=True)
    adb_shell(f"mkdir -p {trace_dir}", serial=serial, root=True)
    owner, _, rc = adb_shell(f"stat -c %u:%g /data/data/{package}", serial=serial, root=True)
    if rc == 0 and owner.strip():
        adb_shell(f"chown -R {owner.strip()} {trace_dir}", serial=serial, root=True)


def clear_device_logs(serial, package, scope):
    adb_shell("rm -f /sdcard/xfqtrace_* /data/local/tmp/xfqtrace_*", serial=serial, root=True)
    targets = [package] if scope == "target" else list_example_packages()
    if package not in targets:
        targets.append(package)
    for pkg in sorted(set(targets)):
        clear_device_logs_for_package(serial, pkg)
    if scope == "target":
        print(f"[*] Cleared device logs: /sdcard + {package} trace_logs")
    else:
        print(f"[*] Cleared device logs: /sdcard + {len(set(targets))} package trace_logs")


def clear_logs(serial, package, scope):
    clear_local_logs(package, scope)
    clear_device_logs(serial, package, scope)


def clear_app_data(serial, package):
    out, err, rc = adb_shell(f"pm clear {package}", serial=serial)
    msg = (out or err).strip()
    if rc != 0:
        print(f"[!] pm clear failed: {msg or 'unknown error'}")
        return False
    if msg:
        print(msg)
    print(f"[*] Cleared app data: {package}")
    return True


def force_stop_app(serial, package):
    out, err, rc = adb_shell(f"am force-stop {shell_quote(package)}", serial=serial, root=True)
    if rc != 0:
        msg = (out or err).strip()
        print(f"[!] force-stop failed: {msg or 'unknown error'}")
        return False
    deadline = time.time() + 3.0
    while time.time() < deadline:
        alive, _, _ = adb_shell(f"pidof {shell_quote(package)} 2>/dev/null", serial=serial, root=True)
        if not alive.strip():
            break
        time.sleep(0.2)

    alive, _, _ = adb_shell(f"pidof {shell_quote(package)} 2>/dev/null", serial=serial, root=True)
    if alive.strip():
        adb_shell(f"kill -9 {alive.strip()} 2>/dev/null || true", serial=serial, root=True)
        time.sleep(0.5)
        still, _, _ = adb_shell(f"pidof {shell_quote(package)} 2>/dev/null", serial=serial, root=True)
        if still.strip():
            print(f"[!] force-stop left live pids for {package}: {still.strip()}")
            return False
        print(f"[*] Force-stopped previous app process: {package} (killed stale pids: {alive.strip()})")
    else:
        print(f"[*] Force-stopped previous app process: {package}")

    # Some samples keep a stale ActivityManager ProcessRecord for a while even
    # after the Linux pid is gone.  Wait for that bookkeeping to drain before we
    # relaunch, otherwise AMS may cancel the new start with "attached to a
    # previous process" and xfinject will never see the next child fork.
    record_deadline = time.time() + 10.0
    while time.time() < record_deadline:
        out, _, _ = adb_shell(
            f"dumpsys activity processes 2>/dev/null | grep -F {shell_quote(package)} || true",
            serial=serial,
            root=True,
        )
        if not out.strip():
            return True
        time.sleep(0.5)
    print(f"[!] ActivityManager still shows stale records for {package}; relaunch may race")
    return True


class LogcatCapture:
    def __init__(self, serial, tee_console=False, viewer=DEFAULT_LOG_VIEWER,
                 level=DEFAULT_CONSOLE_LOG_LEVEL):
        self.serial = serial
        self.tee_console = tee_console
        self.viewer = normalize_log_viewer(viewer)
        self.level = normalize_log_level(level, DEFAULT_CONSOLE_LOG_LEVEL)
        self.proc = None
        self.thread = None
        self.master_fd = None

    def start(self):
        if not self.tee_console or self.viewer == "none":
            return
        cmd = None
        if self.viewer in ("auto", "pidcat"):
            pidcat = find_pidcat_executable()
            if pidcat:
                cmd = [
                    pidcat,
                    "-s", self.serial,
                    "--all",
                    "--always-display-tags",
                    "-l", self.level,
                    "-t", "xfQTrace",
                    "-t", "xfQTrace.sync",
                ]
            else:
                print("[!] pidcat not found in kit/bin or PATH; falling back to adb logcat")
                if self.viewer == "pidcat":
                    print("[!] Put pidcat/pidcat.exe into kit/bin/ for colored logcat output")

        if cmd is None:
            cmd = ["adb"]
            if self.serial:
                cmd += ["-s", self.serial]
            cmd += ["logcat", "-v", "threadtime"] + logcat_filter_args(self.level)

        viewer_name = "pidcat" if os.path.basename(cmd[0]).lower().startswith("pidcat") else "logcat"
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        if viewer_name == "pidcat" and os.name != "nt" and pty is not None:
            master_fd, slave_fd = pty.openpty()
            self.master_fd = master_fd
            self.proc = subprocess.Popen(
                cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                env=env,
                close_fds=True,
            )
            os.close(slave_fd)
            self.thread = threading.Thread(target=self._pump_pty, daemon=True)
            self.thread.start()
        else:
            self.proc = subprocess.Popen(cmd, env=env)
        print(f"[*] {viewer_name} tee enabled (console_level={self.level})")

    def _pump(self):
        assert self.proc is not None
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            if self.tee_console:
                print(line.rstrip("\n"))

    def _pump_pty(self):
        assert self.master_fd is not None
        while True:
            try:
                data = os.read(self.master_fd, 4096)
            except OSError:
                break
            if not data:
                break
            print(data.decode("utf-8", "replace"), end="")

    def stop(self):
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)
        if self.thread is not None:
            self.thread.join(timeout=3)
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None


class DeviceLogcatRecorder:
    def __init__(self, serial, remote_path, level=DEFAULT_LOG_FILE_LEVEL):
        self.serial = serial
        self.remote_path = remote_path
        self.level = normalize_log_level(level, DEFAULT_LOG_FILE_LEVEL)
        self.proc = None

    def start(self):
        adb_shell(f"rm -f {self.remote_path}", serial=self.serial)
        cmd = ["adb"]
        if self.serial:
            cmd += ["-s", self.serial]
        logcat_cmd = " ".join(shell_quote(v) for v in [
            "logcat",
            "-v",
            "threadtime",
            *logcat_filter_args(self.level),
            "-f",
            self.remote_path,
        ])
        cmd += ["shell", "su", "0", "-c", logcat_cmd]
        self.proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def stop(self):
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=3)

    def pull(self, session_dir):
        local_path = os.path.join(session_dir, "logcat.txt")
        pull_cmd = ["adb"]
        if self.serial:
            pull_cmd += ["-s", self.serial]
        pull_cmd += ["pull", self.remote_path, local_path]
        rc = subprocess.run(pull_cmd, stdout=subprocess.DEVNULL).returncode
        if rc != 0 or not os.path.exists(local_path):
            print(f"[!] pull device logcat failed: {self.remote_path}")
            return None
        adb_shell(f"rm -f {self.remote_path}", serial=self.serial)
        print(f"[*] Pulled device logcat -> {local_path}")
        return local_path


def refresh_logcat_from_buffer(serial, local_path, level=DEFAULT_LOG_FILE_LEVEL):
    """Append a final host-side logcat -d snapshot.

    Device-side `logcat -f` can lag or terminate before the last native
    owner-continuation lines are flushed.  We clear the logcat buffer before
    each run, so a bounded final `logcat -d` snapshot is the authoritative
    source for the main-process completion/crash lines.
    """
    if not local_path:
        return local_path
    try:
        # This is only a final host-buffer refresh; the full run log is already
        # captured by DeviceLogcatRecorder.  Use non-root recent-buffer logcat to
        # avoid APatch/su pipe stalls on long traces.
        out, _, rc = adb("logcat", "-d", "-t", "2000", "-v", "threadtime", *logcat_filter_args(level), serial=serial)
        if rc == 0 and out:
            with open(local_path, "w", encoding="utf-8", errors="replace") as f:
                f.write(out)
            print(f"[*] Refreshed logcat from host buffer -> {local_path}")
    except Exception as e:
        print(f"[!] refresh logcat failed: {e}")
    return local_path


def start_logcat_capture(serial, tee_console=False, viewer=DEFAULT_LOG_VIEWER,
                         level=DEFAULT_CONSOLE_LOG_LEVEL):
    capture = LogcatCapture(serial, tee_console=tee_console, viewer=viewer, level=level)
    capture.start()
    return capture


def logcat_threadtime_pid(line):
    parts = line.split()
    if len(parts) < 5:
        return None
    try:
        return int(parts[2])
    except ValueError:
        return None


def summarize_crash_window(logcat_path, package, window=80):
    if not logcat_path or not os.path.exists(logcat_path):
        return None

    with open(logcat_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    death_patterns = [
        re.compile(rf"Process {re.escape(package)} .* has died"),
        re.compile(rf"am_crash.*{re.escape(package)}"),
        re.compile(rf"Fatal signal .*{re.escape(package)}"),
        re.compile(rf"FATAL EXCEPTION.*{re.escape(package)}"),
    ]

    death_idx = None
    death_pid = None
    for idx, line in enumerate(lines):
        if any(p.search(line) for p in death_patterns):
            death_idx = idx
            m = re.search(r"\(pid\s+(\d+)\)", line)
            if not m:
                m = re.search(r"\bpid[:= ]+(\d+)\b", line)
            if m:
                death_pid = int(m.group(1))
            break

    if death_idx is None:
        return None

    start = max(0, death_idx - window)
    focus = lines[start:death_idx + 1]
    xfq_lines = []
    for line in focus:
        if "xfQTrace" not in line:
            continue
        if death_pid is not None and logcat_threadtime_pid(line) != death_pid:
            continue
        xfq_lines.append(line.rstrip("\n"))
    if not xfq_lines:
        return None

    last_sync = next((line for line in reversed(xfq_lines) if "xfQTrace.sync" in line), xfq_lines[-1])
    last_call = next((line for line in reversed(xfq_lines) if "call func:" in line), None)
    last_pc = next((line for line in reversed(xfq_lines) if "[lib" in line and "0x" in line), None)
    death_line = lines[death_idx].rstrip("\n")

    summary_lines = [
        "[*] Crash window summary:",
        f"    death: {death_line}",
    ]
    if last_call:
        summary_lines.append(f"    last call: {last_call}")
    if last_pc:
        summary_lines.append(f"    last pc:   {last_pc}")
    summary_lines.append(f"    last log:  {last_sync}")
    summary_lines.append(f"    window:    {max(0, len(xfq_lines))} xfqtrace line(s) before death")
    print("\n".join(summary_lines))

    summary_path = os.path.join(os.path.dirname(logcat_path), "crash_summary.txt")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(summary_lines))
        f.write("\n\n--- Last xfQTrace window ---\n")
        for line in xfq_lines:
            f.write(line)
            f.write("\n")
    print(f"[*] Crash summary -> {summary_path}")
    return summary_path


def clear_logcat_buffer(serial):
    _, err, rc = adb("logcat", "-c", serial=serial)
    if rc != 0:
        err = err.strip()
        if err:
            print(f"[!] adb logcat -c failed: {err}")
        else:
            print("[!] adb logcat -c failed")
        return False
    return True


def infer_expected_traces(script_code):
    """
    从注入脚本里尽量提取 options.stop_condition.max_traces。
    仅当能明确解析出正整数时返回该值；否则返回 None。
    """
    m = re.search(r"[\"\']?stop_condition[\"\']?\s*:\s*\{\s*[\"\']?max_traces[\"\']?\s*:\s*(-?\d+)", script_code)
    if not m:
        return None
    try:
        value = int(m.group(1))
    except ValueError:
        return None
    return value if value > 0 else None


def infer_lz4_enabled(script_code):
    """
    从注入脚本里尽量提取 options.lz4_compression.enable。
    解析不到时默认按启用处理。
    """
    m = re.search(r"[\"\']?lz4_compression[\"\']?\s*:\s*\{\s*[\"\']?enable[\"\']?\s*:\s*(true|false)", script_code, re.IGNORECASE)
    if not m:
        return True
    return m.group(1).lower() == "true"


def ensure_lz4_available():
    global LZ4_EXE
    if LZ4_EXE and os.path.exists(LZ4_EXE):
        return True
    if os.path.exists(BUNDLED_LZ4_EXE):
        LZ4_EXE = BUNDLED_LZ4_EXE
        return True
    path_lz4 = shutil.which("lz4.exe") if platform.system() == "Windows" else None
    if not path_lz4:
        path_lz4 = shutil.which("lz4")
    if path_lz4:
        LZ4_EXE = path_lz4
        return True
    print(f"[!] lz4 not found: {BUNDLED_LZ4_EXE} or PATH")
    print("[!] Put lz4 into kit/bin/ or install lz4 in PATH")
    return False


def warn_lz4_requirement(hook_script=None, pull_only=False, script_code=None):
    if pull_only:
        return ensure_lz4_available()
    if script_code is None:
        try:
            script_code = load_hook_script_text(hook_script)
        except OSError as e:
            print(f"[!] failed to read hook script for lz4 preflight: {e}")
            return True
    if infer_lz4_enabled(script_code):
        if not ensure_lz4_available():
            print("[!] trace can still run; compressed trace will only be pulled, not auto-decompressed")
    return True


def shell_quote(value):
    return shlex.quote(str(value))



def adb(*args, serial=None):
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    return r.stdout.strip(), r.stderr.strip(), r.returncode


def adb_shell(cmd, serial=None, root=False):
    if root:
        # APatch/KernelSU variants may default `su -c` to the current shell uid.
        # xfinject needs real root for /proc/<pid>/maps|mem, so request uid 0
        # explicitly and quote the original command as one shell argument.
        cmd = f"su 0 -c {shell_quote(cmd)}"
    return adb("shell", cmd, serial=serial)


def find_device():
    out, _, _ = adb("devices")
    lines = [l for l in out.splitlines()[1:] if l.strip() and "device" in l]
    if not lines:
        print("[!] No device found")
        sys.exit(1)
    return lines[0].split()[0]


def resolve_frida_pid(device, package):
    short = package.rsplit(".", 1)[-1]
    for app in device.enumerate_applications():
        if app.identifier == package and app.pid:
            return app.pid
    for p in device.enumerate_processes():
        if p.name == short or p.name == package or p.name.startswith(package + ":"):
            return p.pid
    return None


def attach_stable_process(device, package, serial=None, attempts=200, delay_sec=0.03):
    last_pid = None
    last_error = None
    for _ in range(attempts):
        pid = None
        if serial:
            out, _, _ = adb_shell(f"pidof {shell_quote(package)}", serial=serial)
            for token in out.split():
                try:
                    pid = int(token)
                    break
                except ValueError:
                    continue
        if pid is None:
            pid = resolve_frida_pid(device, package)
        if pid is None:
            time.sleep(delay_sec)
            continue
        last_pid = pid
        try:
            session = device.attach(pid)
            if last_pid != pid:
                print(f"[*] Attached {package} -> PID {pid} (after pid change)")
            return session, pid
        except frida.ProcessNotFoundError as exc:
            last_error = exc
            time.sleep(delay_sec)
    if last_error is not None:
        raise last_error
    raise frida.ProcessNotFoundError(f"unable to find process for {package}")


def push_so(serial, package):
    if not os.path.exists(SO_PATH):
        print(f"[!] SO not found: {SO_PATH}")
        print("[!] Build it first with: ./build/build.sh")
        return False
    remote_dir = f"/data/data/{package}/files"
    remote = remote_dir + "/libxfqtrace.so"
    tmp = "/data/local/tmp/libxfqtrace.so"
    print(f"[*] Using local SO: {SO_PATH}")
    adb("push", SO_PATH, tmp, serial=serial)
    adb_shell(f"mkdir -p {remote_dir}", serial=serial, root=True)
    adb_shell(f"cp {tmp} {remote}", serial=serial, root=True)
    # `$(stat ...)` 必须在 root 下展开（shell 用户读不到 /data/data/<pkg>），
    # 否则刚装/没启动过的 app（files/ 由我们以 root 建）会留在 root:755 → app 没写权
    owner, _, _ = adb_shell(f"stat -c %u:%g /data/data/{package}", serial=serial, root=True)
    if owner.strip():
        adb_shell(f"chown -R {owner.strip()} {remote_dir}", serial=serial, root=True)
    adb_shell(f"chmod 755 {remote}", serial=serial, root=True)
    adb_shell(f"chcon u:object_r:app_data_file:s0 {remote}", serial=serial, root=True)
    size = os.path.getsize(SO_PATH)
    print(f"[*] Pushed libxfqtrace.so ({size:,} bytes) -> {remote}")
    return True


def run_frida(serial, package, spawn=True, hook_script=None, bypass=None,
              auto_click=False, script_code_override=None):
    device = frida.get_device(serial)
    print(f"[*] frida-server device: {device.name}")
    stop_event = threading.Event()
    stop_reason = {"value": None}
    target_pid = None

    if spawn:
        pid = device.spawn([package])
        target_pid = pid
        session = device.attach(pid)
    else:
        # frida-server 可能用 short name；先用包名，失败则按短名/identifier 查找 PID
        try:
            session = device.attach(package)
        except frida.ProcessNotFoundError:
            session, target_pid = attach_stable_process(device, package, serial=serial)
            print(f"[*] Resolved {package} -> PID {target_pid}")
        else:
            target_pid = resolve_frida_pid(device, package)

    def mark_stopped(reason):
        if stop_event.is_set():
            return
        stop_reason["value"] = reason
        stop_event.set()

    def on_detached(*detached_args):
        reason = detached_args[0] if detached_args else "unknown"
        if not stop_event.is_set():
            print(f"[!] frida-server session detached before trace_done: {reason}")
            mark_stopped("session_detached")

    session.on("detached", on_detached)

    def monitor_original_pid():
        if target_pid is None:
            return
        missing = 0
        while not stop_event.wait(1.0):
            out, _, _ = adb_shell(
                f"if [ -d /proc/{target_pid} ]; then echo alive; else echo dead; fi",
                serial=serial,
                root=True)
            if out.strip() == "alive":
                missing = 0
                continue
            missing += 1
            if missing >= 2:
                print(f"[!] Target process pid={target_pid} exited before trace_done")
                mark_stopped("process_died")
                return

    pid_monitor = threading.Thread(target=monitor_original_pid, daemon=True)
    pid_monitor.start()

    # 加载 bypass 脚本（msa / bangbang / apiguard3，支持逗号分隔多个），先注入再注 trace
    if bypass:
        names = [n.strip() for n in bypass.split(",") if n.strip()]
        for name in names:
            bypass_path = BYPASS_SCRIPTS.get(name)
            if not bypass_path or not os.path.exists(bypass_path):
                print(f"[!] bypass '{name}' not found at {bypass_path}")
                sys.exit(1)
            with open(bypass_path, "r", encoding="utf-8") as f:
                bypass_code = f.read()
            bypass_script = session.create_script(bypass_code)
            bypass_script.on("message", lambda msg, data: print(msg.get("payload", msg))
                             if msg["type"] == "log" else
                             (print(msg["payload"]) if msg["type"] == "send" and isinstance(msg["payload"], str) else None))
            bypass_script.load()
            print(f"[*] Loaded bypass: {os.path.basename(bypass_path)}")

    script_code = script_code_override if script_code_override is not None else load_hook_script_text(hook_script)
    expected_traces = infer_expected_traces(script_code)
    if expected_traces is not None:
        print(f"[*] expecting {expected_traces} trace(s) from stop_condition.max_traces")
    else:
        print("[*] expected trace count unknown; auto-stop disabled until Ctrl+C")

    trace_count = [0]

    def on_message(message, data):
        mtype = message["type"]
        if mtype == "send":
            payload = message["payload"]
            if isinstance(payload, dict) and payload.get("type") == "trace_done":
                trace_count[0] += 1
                print(f"[*] trace #{trace_count[0]} done")
                if expected_traces is not None and trace_count[0] >= expected_traces:
                    mark_stopped("trace_done")
            elif isinstance(payload, str):
                print(payload)
        elif mtype == "error":
            print(f"[!] {message.get('description', message)}")
            mark_stopped("script_error")
        elif mtype == "log":
            payload = message.get("payload", "")
            print(payload)

    script = session.create_script(script_code)
    script.on("message", on_message)
    script.load()

    if spawn:
        device.resume(pid)
        print(f"[*] spawned {package} (pid={pid})")

    # app 已恢复运行：并行驱动首启 UI 自动点击（同意隐私协议/授权），不阻塞 trace 等待
    if auto_click:
        start_auto_click_thread(serial, package, stop_event=stop_event)

    if expected_traces is not None:
        print(f"[*] tracing... waiting for {expected_traces} trace_done signal(s) (Ctrl+C to stop early)")
    else:
        print("[*] tracing... Ctrl+C to stop and pull")
    try:
        while not stop_event.wait(0.5):
            pass
    except KeyboardInterrupt:
        mark_stopped("keyboard_interrupt")
        print("\n[*] Stopping...")
    else:
        if stop_reason["value"] == "trace_done":
            print("[*] Received trace_done, auto-stopping and continuing to pull")
        elif stop_reason["value"] in ("process_died", "session_detached", "script_error"):
            print(f"[!] Trace stopped early: {stop_reason['value']}; pulling partial logs")

    # 正常 trace_done 时 native 侧已经完成 trace/flush。不要走 stop() 的 abort 路径；
    # 但也不能立刻 detach frida-server session：dy 首启路径中 owner 线程还会从 hook/trampoline
    # 返回一小段原生信号链，过早 detach 会留下已卸载的 frida-agent signal handler 指针。
    # 先给 owner 返回留出窗口，再做非 abort 的 hook/callback 清理，然后 detach。
    if stop_reason["value"] == "trace_done":
        time.sleep(1.5)
        try:
            script.exports_sync.cleanup_done()
        except Exception as e:
            msg = str(e)
            if "unable to find method" not in msg and "cleanup" not in msg.lower():
                print(f"[!] cleanup_done failed: {e}")
    elif stop_reason["value"] in ("process_died", "session_detached"):
        pass
    else:
        try:
            script.exports_sync.stop()
        except:
            pass
    try:
        session.detach()
    except:
        pass
    print(f"[*] Detached. Total traces: {trace_count[0]}")
    return {
        "reason": stop_reason["value"],
        "trace_count": trace_count[0],
        "expected_traces": expected_traces,
        "pid": target_pid,
    }


def pull_and_decompress(serial, package, session_dir=None, decompress=True):
    trace_dir = f"/data/data/{package}/files/trace_logs"

    out, _, _ = adb_shell(f"ls {trace_dir}/", serial=serial, root=True)
    if not out:
        print("[!] No trace files found")
        return session_dir

    files = [f.strip() for f in out.splitlines() if f.strip()]
    print(f"\n[*] Found {len(files)} trace file(s)")

    if session_dir is None:
        session_dir = allocate_session_dir(package)
    print(f"[*] Output dir: {session_dir}")

    # chmod so adb can pull via /data/local/tmp
    adb_shell(f"chmod -R 777 {trace_dir}", serial=serial, root=True)

    for f in files:
        remote = f"{trace_dir}/{f}"
        local = os.path.join(session_dir, f)

        # cp to tmp then pull (avoid permission issues)
        tmp = f"/data/local/tmp/{f}"
        adb_shell(f"cp {shell_quote(remote)} {shell_quote(tmp)} && chmod 644 {shell_quote(tmp)}", serial=serial, root=True)

        # adb pull with progress (stderr shows transfer speed)
        pull_cmd = ["adb"]
        if serial:
            pull_cmd += ["-s", serial]
        pull_cmd += ["pull", tmp, local]
        rc = subprocess.run(pull_cmd, stdout=subprocess.DEVNULL).returncode
        if rc != 0:
            print(f"  [!] pull failed: {f}")
            continue
        adb_shell(f"rm -f {tmp}", serial=serial, root=True)
        size = os.path.getsize(local)
        print(f"  [+] {f} ({size:,} bytes)")

        # lz4 decompress (tolerates truncated frames from crash/abort)
        if f.endswith(".lz4") and decompress:
            if not ensure_lz4_available():
                continue
            out_path = local[:-4]  # remove .lz4
            try:
                r = subprocess.run([LZ4_EXE, "-d", "-f", local, out_path],
                                   capture_output=True, text=True)
                if r.returncode != 0:
                    # lz4 returns error on truncated frames, but partial data is still written
                    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                        raw_size = os.path.getsize(out_path)
                        ratio = (1.0 - size / raw_size) * 100 if raw_size > 0 else 0
                        print(f"  [~] partial decompress: {os.path.basename(out_path)} ({raw_size:,} bytes, {ratio:.0f}% compression)")
                        print(f"      (truncated frame — trace was interrupted)")
                        os.remove(local)
                    else:
                        print(f"  [!] decompress failed: {r.stderr.strip()}")
                else:
                    raw_size = os.path.getsize(out_path)
                    ratio = (1.0 - size / raw_size) * 100 if raw_size > 0 else 0
                    print(f"  [+] -> {os.path.basename(out_path)} ({raw_size:,} bytes, {ratio:.0f}% compression)")
                    os.remove(local)  # 删除 .lz4，保留解压后的
            except Exception as e:
                print(f"  [!] decompress failed: {e}")

    print(f"\n[*] Output: {session_dir}")
    return session_dir


def display_thread_tree(session_dir):
    """Parse .meta files and display thread tree with trace file associations."""
    if not session_dir or not os.path.isdir(session_dir):
        return
    meta_files = [f for f in os.listdir(session_dir) if f.endswith(".meta")]
    if not meta_files:
        return

    print(f"\n[*] Thread tree ({len(meta_files)} child thread(s)):")
    print("    ┌─ main thread (parent)")

    threads = []
    for mf in sorted(meta_files):
        meta_path = os.path.join(session_dir, mf)
        info = {}
        with open(meta_path, "r") as f:
            for line in f:
                line = line.strip()
                if "=" in line:
                    k, v = line.split("=", 1)
                    info[k] = v
        threads.append(info)

    for i, info in enumerate(threads):
        tid = info.get("child_tid", "?")
        parent = info.get("parent_tid", "?")
        start = info.get("start_routine", "?")
        fork_idx = info.get("fork_insn_index", "?")
        completed = info.get("completed", "0") == "1"
        status = "done" if completed else "running"

        # Find matching trace file
        trace_file = None
        for f in os.listdir(session_dir):
            if f"_t{tid}" in f and not f.endswith(".meta"):
                trace_file = f
                break

        connector = "└" if i == len(threads) - 1 else "├"
        print(f"    {connector}── tid={tid} (parent={parent}) start=0x{start[2:] if start.startswith('0x') else start} "
              f"fork@insn#{fork_idx} [{status}]")
        if trace_file:
            padding = "    " if i == len(threads) - 1 else "│   "
            print(f"    {padding}   → {trace_file}")

    print()


def main():
    parser = argparse.ArgumentParser(description="xfQTrace: push → trace → pull → decompress")
    parser.add_argument("-p", "--package", required=True, help="Target package name")
    parser.add_argument("--serial", help="ADB device serial")
    parser.add_argument("--inject-backend", choices=["frida-server", "xfinject"], default="xfinject",
                        help="Injection backend: xfinject (default) or frida-server")
    parser.add_argument("--xfinject-timeout", type=int, default=0,
                        help="Wait time for xfinject/native trace completion in seconds (0 = wait until real native completion)")
    parser.add_argument("--vma-hide", choices=["auto", "always", "never"], default="auto",
                        help="xfinject /proc maps hide mode: auto, always, or never")
    parser.add_argument("--attach", action="store_true", help="Attach to running process")
    parser.add_argument("--reinstall", help="Uninstall+reinstall APK to reset device fingerprint (path to APK)")
    parser.add_argument("--pull-only", action="store_true", help="Only pull + decompress, no injection")
    parser.add_argument("--no-decompress", action="store_true",
                        help="Only pull compressed .lz4 files; do not auto-decompress large traces.")
    parser.add_argument("--keep-running-on-timeout", action="store_true",
                        help="With --inject-backend xfinject and a positive --xfinject-timeout, leave the target app running after timeout. "
                             "Default only force-stops on an explicit positive timeout; --xfinject-timeout 0 waits for real completion.")
    parser.add_argument("--no-push", action="store_true", help="Skip pushing SO to device")
    parser.add_argument("--recipe",
                        help="Use a specific recipe JSON. Accepts absolute path, relative path, "
                             "or a JSON file under examples/<package>/.")
    parser.add_argument("--script", help="Custom frida-server JS to inject (default: kit/examples/<package>/半自动化trace.js, fallback 半自动化trace.js)")
    parser.add_argument("--quiet-logcat", action="store_true",
                        help="Save xfQTrace logcat to logs/<N>/logcat.txt without mirroring it to console")
    parser.add_argument("--log-viewer", choices=["auto", "pidcat", "logcat", "none"],
                        help="Console log viewer: auto/pidcat/logcat/none. "
                             "Default: none, which only saves logcat to file and does not mirror it to Python.")
    parser.add_argument("--console-log-level", choices=sorted(LOG_LEVELS),
                        help="Minimum console log level for xfQTrace tags (default: I).")
    parser.add_argument("--log-file-level", choices=sorted(LOG_LEVELS),
                        help="Minimum saved logcat level for xfQTrace tags (default: V).")
    parser.add_argument("--clear-app-data", action="store_true",
                        help="Run 'pm clear <package>' before tracing. Useful for first-launch/privacy-agreement flows.")
    parser.add_argument("--no-clear-app-data", action="store_true",
                        help="Compatibility no-op unless --clear-app-data is also provided; default no longer clears app data.")
    parser.add_argument("--auto-click", action="store_true",
                        help="Auto-tap first-launch privacy/permission dialogs in a background thread "
                             "(reuses 自动点击隐私同意按钮.py). Useful with --clear-app-data.")
    parser.add_argument("--no-auto-click", action="store_true",
                        help="Disable the default first-launch privacy/permission auto-click helper.")
    parser.add_argument("--clear-logs", choices=["target", "all"], nargs="?", const="target",
                        help="Clear trace/logcat artifacts before running. "
                             "Default is 'target' when the flag is present without a value. "
                             "'target' clears current package logs; 'all' also clears examples/*/logs and "
                             "device trace_logs for known example packages.")
    parser.add_argument("--clear-only", action="store_true",
                        help="Only clear logs and exit. Defaults to '--clear-logs target' if no scope is given.")
    parser.add_argument("--bypass",
                        help="Pre-inject anti-detection bypass(es), comma-separated. "
                             "Available: " + " | ".join(sorted(BYPASS_SCRIPTS.keys())) +
                             ". Example: --bypass apiguard3,bangbang")
    args = parser.parse_args()

    if args.clear_only and not args.clear_logs:
        args.clear_logs = "target"

    package_defaults = PACKAGE_DEFAULTS.get(args.package, {})
    if not args.attach and not args.pull_only and not args.clear_only:
        if package_defaults.get("no_clear_app_data"):
            args.no_clear_app_data = True
        if package_defaults.get("no_auto_click"):
            args.no_auto_click = True
        if args.no_clear_app_data and args.clear_app_data:
            args.clear_app_data = False
            print("[*] --no-clear-app-data overrides --clear-app-data")
        if not args.no_auto_click and not args.auto_click:
            args.auto_click = True
            print("[*] Default: --auto-click enabled (use --no-auto-click to disable)")

    serial = args.serial or find_device()
    print(f"[*] Device: {serial}")
    print(f"[*] Package: {args.package}")
    if args.inject_backend == "frida-server" and frida is None:
        print(f"[!] {args.inject_backend} backend requires frida Python bindings")
        sys.exit(1)
    if args.inject_backend == "xfinject" and args.bypass:
        print(f"[!] --bypass is ignored with {args.inject_backend} backend")
    if args.inject_backend == "xfinject" and args.no_push:
        print(f"[!] --no-push is not supported with {args.inject_backend} backend; it still needs local payloads to stage")
        sys.exit(1)
    session_dir = None
    logcat_capture = None
    device_logcat = None
    should_pull_logcat = False
    trace_status = None
    log_viewer = DEFAULT_LOG_VIEWER
    console_log_level = DEFAULT_CONSOLE_LOG_LEVEL
    log_file_level = DEFAULT_LOG_FILE_LEVEL

    if args.clear_logs:
        clear_logs(serial, args.package, args.clear_logs)
        if args.clear_only:
            return
    if not args.pull_only and not args.clear_only:
        if args.inject_backend == "frida-server" and args.attach:
            print("[*] --attach with frida-server: skipping pre-trace force-stop")
        else:
            if not force_stop_app(serial, args.package):
                sys.exit(1)
    if args.clear_app_data:
        if not clear_app_data(serial, args.package):
            sys.exit(1)

    if not args.pull_only:
        session_dir = allocate_session_dir(args.package)
        print(f"[*] Session dir: {session_dir}")
        if args.script and args.recipe:
            print("[!] --script and --recipe are mutually exclusive")
            sys.exit(1)
        hook_script_code, hook_source, trace_recipe = load_trace_recipe_or_script(
            args.package,
            script_path=args.script,
            recipe_path=args.recipe,
        )
        hook_script = hook_source
        if trace_recipe is not None:
            print(f"[*] Recipe: {hook_source}")
        log_viewer = normalize_log_viewer(args.log_viewer, DEFAULT_LOG_VIEWER)
        console_log_level = normalize_log_level(args.console_log_level, DEFAULT_CONSOLE_LOG_LEVEL)
        log_file_level = normalize_log_level(args.log_file_level, DEFAULT_LOG_FILE_LEVEL)
        if args.quiet_logcat:
            log_viewer = "none"
        print(f"[*] Logcat: viewer={log_viewer} console_level={console_log_level} log_file_level={log_file_level}")
        warn_lz4_requirement(hook_script=hook_script, pull_only=False, script_code=hook_script_code)

        # 卸载重装（重置设备指纹）
        if args.reinstall:
            adb_shell(f"pm uninstall {args.package}", serial=serial)
            print(f"[*] Uninstalled {args.package}")
            out, err, rc = adb("install", args.reinstall, serial=serial)
            if rc != 0:
                print(f"[!] Install failed: {err}")
                sys.exit(1)
            print(f"[*] Reinstalled from {args.reinstall}")

        # 清理旧 trace 文件
        trace_dir = f"/data/data/{args.package}/files/trace_logs"
        adb_shell(f"rm -f {trace_dir}/*", serial=serial, root=True)

        clear_logcat_buffer(serial)
        device_logcat_remote = f"/sdcard/xfqtrace_{args.package.replace('.', '_')}_logcat.txt"
        logcat_capture = start_logcat_capture(serial, tee_console=(log_viewer != "none" and not args.quiet_logcat),
                                              viewer=log_viewer, level=console_log_level)
        device_logcat = DeviceLogcatRecorder(serial, device_logcat_remote, level=log_file_level)
        device_logcat.start()
        print(f"[*] Device-side xfQTrace logcat -> {device_logcat_remote} (log_file_level={log_file_level})")
        time.sleep(LOGCAT_STARTUP_SETTLE_SEC)

        if args.inject_backend == "xfinject":
            if args.attach:
                print("[!] --attach is not supported with xfinject backend; using spawn-style launch")
            trace_stop_event = threading.Event()
            if args.auto_click:
                start_auto_click_thread(serial, args.package, stop_event=trace_stop_event)
            try:
                xfinject_backend = load_xfinject_backend()
                expected_traces = xfinject_backend.infer_expected_traces(hook_script_code)
                if not xfinject_backend.run_xfinject(serial, args.package, hook_script_code, local_so=SO_PATH, kit_root=KIT_ROOT, vma_hide=args.vma_hide or "auto", recipe=trace_recipe):
                    raise RuntimeError("xfinject backend failed")
                trace_status = xfinject_backend.wait_for_native_trace_completion(
                    serial,
                    args.package,
                    expected_traces=expected_traces,
                    timeout_sec=args.xfinject_timeout,
                    log_level=log_file_level,
                )
                if args.xfinject_timeout > 0 and not args.keep_running_on_timeout:
                    xfinject_backend.stop_target_after_timeout(serial, args.package, trace_status.get("reason"))
            except Exception as exc:
                print(f"[!] xfinject run failed before trace completion: {type(exc).__name__}: {exc}")
                trace_status = {
                    "reason": "xfinject_error",
                    "trace_count": 0,
                    "expected_traces": None,
                }
            finally:
                trace_stop_event.set()
                should_pull_logcat = True
        else:
            # frida-server backend calls xfqtrace_configure/start from JS.
            # Remove any stale xfinject autostart config so the constructor does
            # not race the explicit Frida launcher with an old files JSON.
            adb_shell(f"rm -f /data/data/{args.package}/files/xfqtrace_config.json /data/data/{args.package}/cache/xfqtrace_config.json", serial=serial, root=True)
            if not args.no_push and not push_so(serial, args.package):
                logcat_capture.stop()
                device_logcat.stop()
                device_logcat.pull(session_dir)
                sys.exit(1)
            try:
                trace_status = run_frida(serial, args.package, spawn=not args.attach,
                                         hook_script=hook_script,
                                         bypass=args.bypass,
                                         auto_click=args.auto_click,
                                         script_code_override=hook_script_code)
            except Exception as exc:
                print(f"[!] frida-server run failed before trace completion: {type(exc).__name__}: {exc}")
                trace_status = {
                    "reason": "frida_server_error",
                    "trace_count": 0,
                    "expected_traces": None,
                }
            finally:
                should_pull_logcat = True
    else:
        if not warn_lz4_requirement(pull_only=True):
            sys.exit(1)

    session_dir = pull_and_decompress(serial, args.package,
                                      session_dir=session_dir,
                                      decompress=not args.no_decompress)
    if should_pull_logcat and logcat_capture is not None and device_logcat is not None:
        logcat_capture.stop()
        device_logcat.stop()
        logcat_path = device_logcat.pull(session_dir)
        logcat_path = refresh_logcat_from_buffer(serial, logcat_path, level=log_file_level)
        summarize_crash_window(logcat_path, args.package)
    display_thread_tree(session_dir)

    if trace_status is not None:
        reason = trace_status.get("reason")
        expected_traces = trace_status.get("expected_traces")
        trace_count = trace_status.get("trace_count", 0)
        if reason in ("process_died", "session_detached", "script_error", "frida_server_error", "xfinject_error"):
            sys.exit(2)
        if reason != "keyboard_interrupt" and expected_traces is not None and trace_count < expected_traces:
            sys.exit(2)


if __name__ == "__main__":
    main()
