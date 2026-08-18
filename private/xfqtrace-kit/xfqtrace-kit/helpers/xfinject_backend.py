#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""xfinject backend adapter for xfQTrace kit automation.

This keeps xfinject-specific CONFIG extraction, payload staging, injection, and
native-log completion polling out of the main Frida-oriented automation script.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import time

DEFAULT_LOG_FILE_LEVEL = "V"
LOG_LEVELS = {"V", "D", "I", "W", "E", "F"}
ADB_COMMAND_TIMEOUT_SEC = 8


def shell_quote(value):
    return shlex.quote(str(value))


def adb(*args, serial=None, timeout=None):
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    env = os.environ.copy()
    env["MSYS_NO_PATHCONV"] = "1"
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", env=env, timeout=timeout)
    except subprocess.TimeoutExpired as e:
        # This is a host-side adb/su/logcat transport guard only.  It must never
        # be interpreted as trace completion/failure; callers simply retry on the
        # next lifecycle poll.  Without this, a stuck `adb logcat -d` or `su grep`
        # can freeze an otherwise healthy long trace forever.
        out = (e.stdout or "")
        err = (e.stderr or "")
        label = f"{timeout}s" if timeout is not None else "unknown"
        return out.strip(), (err.strip() + f"\nadb command timed out after {label}").strip(), 124
    return r.stdout.strip(), r.stderr.strip(), r.returncode


def adb_shell(cmd, serial=None, root=False, timeout=None):
    if root:
        # APatch's su defaults to the current shell uid unless the target user
        # is explicit.  Use uid 0 so xfinject can read zygote maps/mem
        # consistently across devices.
        cmd = f"su 0 -c {shell_quote(cmd)}"
    return adb("shell", cmd, serial=serial, timeout=timeout)


def normalize_log_level(value, default=DEFAULT_LOG_FILE_LEVEL):
    if value is None:
        return default
    value = str(value).strip().upper()
    return value if value in LOG_LEVELS else default


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
        "*:S",
    ]


def root_logcat_dump(serial, level=DEFAULT_LOG_FILE_LEVEL):
    # Keep the lifecycle poll cheap and non-blocking.  The device-side recorder
    # already writes the full log to /sdcard; this host-side snapshot only needs
    # recent completion/crash lines.  Avoid `su 0 -c logcat -d` here: on some
    # devices APatch/su can keep the pipe open long enough to make the trace
    # wait loop look "slow" even though the app is fine.
    out, err, rc = adb("logcat", "-d", "-t", "1200", "-v", "threadtime",
                       *logcat_filter_args(level), serial=serial,
                       timeout=ADB_COMMAND_TIMEOUT_SEC)
    if rc == 0:
        return out
    out, _, _ = adb("logcat", "-d", "-t", "1200", "-v", "threadtime",
                    *logcat_filter_args(level), serial=serial,
                    timeout=ADB_COMMAND_TIMEOUT_SEC)
    return out


def device_logcat_summary(serial, package):
    remote = f"/sdcard/xfqtrace_{package.replace('.', '_')}_logcat.txt"
    grep_expr = (
        "trace completed successfully\\|max_traces reached\\|configure failed\\|start failed"
        "\\|target address is not executable\\|did not become executable"
        "\\|Fatal signal\\|FATAL EXCEPTION\\|Abort message\\|Process .* has died"
    )
    cmd = f"grep -a -e {shell_quote(grep_expr)} {shell_quote(remote)} 2>/dev/null || true"
    # /sdcard is shell-readable; avoid spawning su inside the hot wait loop.
    out, _, _ = adb_shell(cmd, serial=serial, root=False, timeout=ADB_COMMAND_TIMEOUT_SEC)
    return out


def infer_expected_traces(script_code):
    """Extract options.stop_condition.max_traces when it is a literal integer."""
    m = re.search(r"[\"\']?stop_condition[\"\']?\s*:\s*\{\s*[\"\']?max_traces[\"\']?\s*:\s*(-?\d+)", script_code)
    if not m:
        return None
    try:
        value = int(m.group(1))
    except ValueError:
        return None
    return value if value > 0 else None


def _extract_js_object_literal(source, anchor):
    idx = source.find(anchor)
    if idx < 0:
        return None
    brace = source.find("{", idx)
    if brace < 0:
        return None

    depth = 0
    in_str = None
    escaped = False
    in_line_comment = False
    in_block_comment = False
    for pos in range(brace, len(source)):
        ch = source[pos]
        nxt = source[pos + 1] if pos + 1 < len(source) else ""
        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
            continue
        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
            continue
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_str:
                in_str = None
            continue
        if ch == "/" and nxt == "/":
            in_line_comment = True
            continue
        if ch == "/" and nxt == "*":
            in_block_comment = True
            continue
        if ch in ("'", '"', "`"):
            in_str = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[brace:pos + 1]
    return None


def build_xfqtrace_config_from_script(script_code):
    """Derive the JSON config consumed by libxfqtrace_autostart.

    The xfinject backend loads libxfqtrace directly, so it only needs the static
    CONFIG.target/options object. Frida-only helper fields are stripped.
    """
    config_text = (_extract_js_object_literal(script_code, "const CONFIG") or
                   _extract_js_object_literal(script_code, "var CONFIG") or
                   _extract_js_object_literal(script_code, "let CONFIG"))
    if config_text is None:
        raise ValueError("could not locate CONFIG object in hook script")

    js_source = (
        script_code[: script_code.find(config_text) + len(config_text)]
        + "\nconsole.log(JSON.stringify({target: CONFIG.target, options: CONFIG.options}));\n"
    )
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node is required to extract CONFIG from hook script")
    proc = subprocess.run([node, "-e", js_source], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"node CONFIG extraction failed: {proc.stderr.strip() or proc.stdout.strip()}")
    cfg = json.loads(proc.stdout.strip().splitlines()[-1])
    if isinstance(cfg.get("target"), dict):
        cfg["target"].pop("base", None)
        cfg["target"].pop("symbol", None)
    return cfg


def find_xfinjectd_in_kit(kit_root):
    candidates = []
    env = os.environ.get("XFINJECTD")
    if env:
        candidates.append(env)
    candidates.append(os.path.join(kit_root, "bin", "xfinjectd"))
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            os.chmod(path, os.stat(path).st_mode | 0o111)
        except OSError:
            pass
        return os.path.abspath(path)
    return None


def ensure_xfinjectd_binary(kit_root):
    bundled = find_xfinjectd_in_kit(kit_root)
    if not bundled:
        raise RuntimeError("xfinjectd not found: distributed kit must contain kit/bin/xfinjectd")
    return os.path.dirname(bundled), bundled


def prepare_device_config(serial, package, config):
    payload = json.dumps(config, ensure_ascii=False, indent=2) + "\n"
    fd, local_path = tempfile.mkstemp(prefix=f"xfqtrace_{package.replace('.', '_')}_", suffix=".json")
    os.close(fd)
    try:
        with open(local_path, "w", encoding="utf-8") as f:
            f.write(payload)
        remote_tmp = f"/data/local/tmp/{os.path.basename(local_path)}"
        remote_cfg = f"/data/data/{package}/files/xfqtrace_config.json"
        _, err, rc = adb("push", local_path, remote_tmp, serial=serial)
        if rc != 0:
            raise RuntimeError(f"adb push config failed: {err}")
        # Do not write /data/data/<pkg>/files from a root shell here.  On APatch
        # builds, immediately after --clear-app-data, shell+su can see
        # Permission denied even for uid 0, while the native xfinject process can
        # stage files using the same app-sandbox writer that stages payload .so
        # copies.  The actual files/ placement is therefore done by xfinject's
        # generic -app-file option before the target is launched.
        print(f"[*] Pushed xfqtrace config staging source -> {remote_tmp}")
        return remote_tmp, remote_cfg
    finally:
        try:
            os.unlink(local_path)
        except OSError:
            pass


def push_payload(serial, local_so):
    remote = "/data/local/tmp/libxfqtrace.so"
    adb("push", local_so, remote, serial=serial)
    adb_shell(f"chmod 644 {shell_quote(remote)}", serial=serial, root=True)
    print(f"[*] Pushed payload -> {remote}")
    return remote


def push_xfinjectd(serial, binary_path):
    remote = "/data/local/tmp/xfinjectd"
    adb("push", binary_path, remote, serial=serial)
    adb_shell(f"chmod 755 {shell_quote(remote)}", serial=serial, root=True)
    print(f"[*] Pushed injector -> {remote}")
    return remote


def run_xfinject(serial, package, hook_script, *, local_so, kit_root, vma_hide="auto", recipe=None):
    if not os.path.exists(local_so):
        print(f"[!] SO not found: {local_so}")
        print("[!] Build libxfqtrace.so first, then retry xfinject backend")
        return False
    xfinject_root, binary_path = ensure_xfinjectd_binary(kit_root)
    if recipe is not None:
        config = {"target": dict(recipe.get("target", {})), "options": recipe.get("options", {})}
        config["target"].pop("base", None)
        config["target"].pop("symbol", None)
    else:
        config = build_xfqtrace_config_from_script(hook_script)
    remote_cfg_src, remote_cfg = prepare_device_config(serial, package, config)
    remote_injector = push_xfinjectd(serial, binary_path)
    remote_so = push_payload(serial, local_so)
    debug_flag = ""
    if os.environ.get("XFINJECT_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}:
        debug_flag = "-debug "
    cmd = (
        f"{shell_quote(remote_injector)} "
        f"{debug_flag}"
        f"-pkg {shell_quote(package)} "
        f"-app-file {shell_quote(remote_cfg_src + ':xfqtrace_config.json')} "
        f"-lib {shell_quote(remote_so)} "
        f"-autostart-symbol xfqtrace_configure_file_and_start_async "
        f"-autostart-arg {shell_quote(remote_cfg)} "
        f"-vma-hide {shell_quote(vma_hide)}"
    )
    print(f"[*] xfinject root: {xfinject_root}")
    print(f"[*] xfinject cmd: {cmd}")
    out, err, rc = adb_shell(cmd, serial=serial, root=True)
    if out:
        print(out)
    if err:
        print(err)
    if rc != 0:
        print(f"[!] xfinject failed with rc={rc}")
        return False
    adb_shell(f"rm -f {shell_quote(remote_cfg_src)}", serial=serial, root=True)
    print(f"[*] xfinject completed; config used: {remote_cfg}")
    return True


def wait_for_native_trace_completion(serial, package, expected_traces=None, timeout_sec=0, log_level="V"):
    """Wait for native xfQTrace completion logs after xfinject injection.

    timeout_sec <= 0 means wait until the native engine reports real completion.
    This is important for long-running traces: the automation must not turn a
    still-active trace into a failed/partial run just because it is large.
    """
    trace_dir = f"/data/data/{package}/files/trace_logs"
    deadline = (time.time() + timeout_sec) if timeout_sec and timeout_sec > 0 else None
    saw_trace_file = False
    seen_target_pids = set()
    timeout_label = f"{timeout_sec}s" if deadline is not None else "none"
    print(f"[*] waiting for native trace completion (timeout={timeout_label})")

    def _target_pids():
        out, _, _ = adb_shell(f"pidof {shell_quote(package)}", serial=serial)
        pids = set()
        for token in out.split():
            try:
                pids.add(int(token))
            except ValueError:
                pass
        return pids

    def _pid_from_logcat_line(line):
        parts = line.split()
        if len(parts) >= 3:
            try:
                return int(parts[2])
            except ValueError:
                return None
        return None

    def _crash_belongs_to_target(line, filter_pids):
        if f"Process {package} " in line and " has died" in line:
            return True
        if not any(marker in line for marker in ("Fatal signal", "FATAL EXCEPTION", "Abort message")):
            return False
        if not filter_pids:
            return saw_trace_file
        pid = _pid_from_logcat_line(line)
        if pid in filter_pids:
            return True
        m = re.search(r"\bpid:\s*(\d+)\b", line)
        return bool(m and int(m.group(1)) in filter_pids)

    def _completion_from_log():
        target_pids = _target_pids()
        seen_target_pids.update(target_pids)
        filter_pids = seen_target_pids or target_pids
        raw_log_out = root_logcat_dump(serial, log_level)
        remote_summary = device_logcat_summary(serial, package)
        if remote_summary:
            raw_log_out = raw_log_out + "\n" + remote_summary
        if any(_crash_belongs_to_target(line, filter_pids) for line in raw_log_out.splitlines()):
            print("[!] target crash detected in native logcat")
            return {"reason": "process_died", "trace_count": 0, "expected_traces": expected_traces, "saw_trace_file": saw_trace_file}
        if not filter_pids and not saw_trace_file:
            return None
        log_out = raw_log_out
        if filter_pids:
            lines = []
            for line in log_out.splitlines():
                if "xfQTrace" not in line:
                    continue
                pid = _pid_from_logcat_line(line)
                if pid in filter_pids:
                    lines.append(line)
            log_out = "\n".join(lines)
        if ("configure failed" in log_out or "start failed" in log_out or
                "target address is not executable" in log_out or
                "did not become executable" in log_out):
            print("[!] native autostart reported configure/start failure")
            return {"reason": "script_error", "trace_count": 0, "expected_traces": expected_traces, "saw_trace_file": saw_trace_file}
        completed_count = log_out.count("trace completed successfully")
        if expected_traces is not None:
            # `max_traces reached` only means the hook was disarmed after a slot
            # was reserved/completed enough to enforce the limit.  The native
            # trace may still be finalizing hook return/diff logs and closing the
            # trace file, so it must not be treated as lifecycle completion.
            if completed_count >= expected_traces:
                print(f"[*] native trace completed successfully ({completed_count}/{expected_traces})")
                return {"reason": "trace_done", "trace_count": completed_count, "expected_traces": expected_traces, "saw_trace_file": True}
        elif completed_count > 0:
            print("[*] native trace completed successfully")
            return {"reason": "trace_done", "trace_count": completed_count, "expected_traces": expected_traces, "saw_trace_file": True}
        return None

    while deadline is None or time.time() < deadline:
        # Host-side adb/su transport guard only: a stuck `su ls` or `pidof`
        # should not freeze an otherwise healthy long trace.  rc=124 is not a
        # trace verdict; the next lifecycle poll will retry.
        out, _, _ = adb_shell(f"ls {shell_quote(trace_dir)} 2>/dev/null",
                              serial=serial, root=True, timeout=ADB_COMMAND_TIMEOUT_SEC)
        if [line.strip() for line in out.splitlines() if line.strip()]:
            saw_trace_file = True
        completed = _completion_from_log()
        if completed is not None:
            return completed
        alive, _, _ = adb_shell(f"pidof {shell_quote(package)}",
                                serial=serial, timeout=ADB_COMMAND_TIMEOUT_SEC)
        if (saw_trace_file or seen_target_pids) and not alive.strip():
            print("[!] target exited before native trace completion; pulling partial logs")
            return {"reason": "process_died", "trace_count": 0, "expected_traces": expected_traces, "saw_trace_file": saw_trace_file}
        time.sleep(1.0)

    completed = _completion_from_log()
    if completed is not None:
        return completed
    print("[!] native trace wait timed out; pulling partial logs")
    return {"reason": "timeout", "trace_count": 0, "expected_traces": expected_traces, "saw_trace_file": saw_trace_file}


def stop_target_after_timeout(serial, package, reason):
    """Stop app after xfinject/native timeout so trace cannot keep filling disk."""
    if reason != "timeout":
        return
    alive, _, _ = adb_shell(f"pidof {shell_quote(package)}",
                            serial=serial, timeout=ADB_COMMAND_TIMEOUT_SEC)
    if not alive.strip():
        return
    print(f"[*] xfinject timeout cleanup: force-stopping {package} to stop background tracing")
    adb_shell(f"am force-stop {shell_quote(package)}", serial=serial, root=True)
    time.sleep(1.0)
