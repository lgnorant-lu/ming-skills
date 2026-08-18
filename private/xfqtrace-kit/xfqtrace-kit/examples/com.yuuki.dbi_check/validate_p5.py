#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

PACKAGE = "com.yuuki.dbi_check"
DEFAULT_SERIAL = "13081FDD4002VL"
DEFAULT_APK = Path("/tmp/dbi_detect-yuuki-20260727/app/build/outputs/apk/debug/app-debug.apk")


def run(cmd, *, cwd=None, check=True, timeout=None):
    p = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if check and p.returncode != 0:
        raise RuntimeError(f"command failed ({p.returncode}): {' '.join(map(str, cmd))}\n{p.stdout}")
    return p.stdout


def adb(serial, *args, check=True, timeout=30):
    return run(["adb", "-s", serial, *args], check=check, timeout=timeout)


def require_pixel5(serial):
    devices = adb(serial, "devices")
    if f"{serial}\tdevice" not in devices:
        raise RuntimeError(f"Pixel 5 {serial} is not connected/authorized\n{devices}")
    device = adb(serial, "shell", "getprop", "ro.product.device").strip().replace("\r", "")
    model = adb(serial, "shell", "getprop", "ro.product.model").strip().replace("\r", "")
    if device != "redfin":
        raise RuntimeError(f"unexpected device for {serial}: model={model} device={device}")
    return {"serial": serial, "model": model, "device": device}


def wake_and_unlock(serial):
    adb(serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP", check=False, timeout=10)
    adb(serial, "shell", "input", "keyevent", "82", check=False, timeout=10)
    adb(serial, "shell", "input", "swipe", "540", "2000", "540", "400", "300", check=False, timeout=10)
    time.sleep(1)


def install_and_launch_baseline(serial, apk):
    wake_and_unlock(serial)
    adb(serial, "shell", "am", "force-stop", PACKAGE, check=False)
    adb(serial, "uninstall", PACKAGE, check=False)
    run(["adb", "-s", serial, "install", "-r", str(apk)], timeout=90)
    adb(serial, "shell", "am", "force-stop", PACKAGE, check=False)
    run(["adb", "-s", serial, "shell", "monkey", "-p", PACKAGE, "-c", "android.intent.category.LAUNCHER", "1"], timeout=30)
    time.sleep(2)
    wake_and_unlock(serial)
    return dump_ui(serial)


def dump_ui(serial):
    wake_and_unlock(serial)
    return adb(serial, "exec-out", "uiautomator", "dump", "/dev/tty", check=False, timeout=30).replace("\r", "")


def assert_contains(text, needle, label):
    if needle not in text:
        raise RuntimeError(f"{label}: missing {needle!r}\n{text[-2000:]}")


def clear_xfqhide_state(serial, kit_root, superkey, module):
    helper = kit_root.parent / "xfqtrace-hide" / "tools" / "xfqtrace_hide.py"
    if helper.exists():
        run([sys.executable, str(helper), "--serial", serial, "--superkey", superkey, "--module", module, "clear"],
            check=False, timeout=15)
        return
    # Fallback for standalone kit copies: send ctl0 directly if the module is loaded.
    run(["adb", "-s", serial, "shell", "su", "-c",
         f"truncate {superkey} module ctl0 {module} clear"], check=False, timeout=15)


def run_trace(serial, apk, kit_root):
    cmd = [
        sys.executable,
        "-u",
        "./全自动化trace.py",
        "-p", PACKAGE,
        "--serial", serial,
        "--reinstall", str(apk),
        "--inject-backend", "xfinject",
        "--clear-logs", "target",
        "--quiet-logcat",
        "--no-decompress",
    ]
    output = run(cmd, cwd=kit_root, check=True, timeout=120)
    log_root = kit_root / "examples" / PACKAGE / "xfqtrace_logs"
    sessions = sorted([p for p in log_root.iterdir() if p.is_dir() and p.name.isdigit()], key=lambda p: int(p.name))
    if not sessions:
        raise RuntimeError(f"no trace session under {log_root}")
    return output, sessions[-1]


def validate_trace_session(session):
    logcat = (session / "logcat.txt").read_text(encoding="utf-8", errors="replace")
    assert_contains(logcat, "trace completed successfully", "logcat")
    bad = ["FATAL EXCEPTION", "Fatal signal", "JNI DETECTED ERROR"]
    hits = [b for b in bad if b in logcat]
    if hits:
        raise RuntimeError(f"logcat contains crash markers: {hits}\n{logcat[-3000:]}")

    traces = sorted(session.glob("xfqtrace_libdbi_check_*_1ba8.log.lz4"))
    if not traces:
        raise RuntimeError(f"missing compressed trace in {session}")
    trace_text = run(["lz4", "-d", "-c", str(traces[-1])], check=True, timeout=30)
    branch = re.search(r"!0x1b20 .*w8=0x([0-9a-f]+)", trace_text)
    if not branch:
        raise RuntimeError("trace does not include DBI detector branch site 0x1b20")
    if branch.group(1) != "0":
        raise RuntimeError(f"xfqtrace-hide signal bridge did not clear detector branch: w8=0x{branch.group(1)}")
    if "!0x1b54" not in trace_text:
        raise RuntimeError("trace does not include md5_hex non-detected branch call site 0x1b54")
    if "!0x1b4c" in trace_text:
        raise RuntimeError("trace still includes sha256 detected branch call site 0x1b4c")
    if not re.search(r'call jni func: NewStringUTF\("[0-9a-f]{32}"\)', trace_text):
        raise RuntimeError("trace does not include 32-hex NewStringUTF return evidence")
    return {"session": str(session), "trace_file": str(traces[-1]), "detector_branch_w8": 0}


def main():
    parser = argparse.ArgumentParser(description="Pixel 5 Yuuki DBI detector regression for xfQTrace.")
    parser.add_argument("--serial", default=DEFAULT_SERIAL)
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--kit-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--kpm-superkey", default="xiaofeng777")
    parser.add_argument("--kpm-module", default="xfqtrace-hide")
    args = parser.parse_args()

    if not args.apk.exists():
        raise RuntimeError(f"missing APK: {args.apk}")
    device = require_pixel5(args.serial)

    clear_xfqhide_state(args.serial, args.kit_root, args.kpm_superkey, args.kpm_module)
    baseline_ui = install_and_launch_baseline(args.serial, args.apk)
    assert_contains(baseline_ui, "matched=true", "baseline UI")
    assert_contains(baseline_ui, "trace detected=false", "baseline UI")
    print("[ok] AC-1 baseline UI: matched=true, trace detected=false")

    clear_xfqhide_state(args.serial, args.kit_root, args.kpm_superkey, args.kpm_module)
    trace_output, session = run_trace(args.serial, args.apk, args.kit_root)
    assert_contains(trace_output, "native trace completed successfully", "trace runner")
    assert_contains(trace_output, "module", "trace runner")
    assert_contains(trace_output, args.kpm_module, "trace runner")
    trace_evidence = validate_trace_session(session)
    trace_ui = dump_ui(args.serial)
    assert_contains(trace_ui, "matched=true", "trace UI")
    assert_contains(trace_ui, "trace detected=false", "trace UI")
    print("[ok] AC-3 xfqtrace-hide signal bridge: w8=0, md5 branch, sha branch not taken")
    print("[ok] AC-3 UI: matched=true, trace detected=false")

    summary = {
        "device": device,
        "apk": str(args.apk),
        "baseline": {"matched": True, "trace_detected": False},
        "trace": {"native_trace_detected": False, "ui_clean": True, **trace_evidence},
    }
    out = session / "yuuki_validation_summary.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] summary: {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        raise SystemExit(1)
