#!/usr/bin/env python3
"""Pixel 5 CRC/self-hash hook demo validation for tracedemo."""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

SERIAL = "13081FDD4002VL"
PKG = "com.xiaofeng.qbdi"
ACTIVITY = "com.xiaofeng.qbdi/.MainActivity"
RECEIVER = "com.xiaofeng.qbdi/.CrcDemoReceiver"
TAG = "QTraceTest"
ROOT = Path(__file__).resolve().parents[3]
TRACEDEMO = ROOT / "tracedemo"
APK = TRACEDEMO / "app/build/outputs/apk/debug/app-debug.apk"
DEFAULT_WXSHADOW_KPM = Path("/home/xiaofeng/Desktop/projects/kpm-dev/builds/kpm/mkpms/wxshadow.p5fix25-gshadow.kpm")
DEFAULT_XFQHIDE_KPM = ROOT / "xfqtrace-hide/out/xfqtrace-hide.kpm"
RESULT_RE = re.compile(r"CRC_HOOK_DEMO(?:_BROADCAST)?_RESULT\s+(\{.*\})")


def run(cmd, *, cwd=None, env=None, check=True, capture=True, timeout=60):
    print("$", " ".join(str(x) for x in cmd))
    p = subprocess.run(
        [str(x) for x in cmd],
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
        timeout=timeout,
        check=False,
    )
    if capture and p.stdout:
        print(p.stdout, end="" if p.stdout.endswith("\n") else "\n")
    if check and p.returncode != 0:
        raise SystemExit(f"command failed: {p.returncode}")
    return p


def ensure_pixel5():
    p = run(["adb", "devices"], check=True, capture=True)
    state = None
    for line in p.stdout.splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0] == SERIAL:
            state = parts[1]
            break
    if state != "device":
        raise SystemExit(f"Pixel 5 {SERIAL} not ready; adb state={state!r}")


def build_apk_if_needed():
    if APK.exists():
        return
    env = os.environ.copy()
    env.setdefault("ANDROID_HOME", "/home/xiaofeng/Android/Sdk")
    env.setdefault("ANDROID_SDK_ROOT", env["ANDROID_HOME"])
    run(["./gradlew", ":app:assembleDebug"], cwd=TRACEDEMO, env=env, timeout=180)


def adb(*args, timeout=60, check=True):
    return run(["adb", "-s", SERIAL, *args], timeout=timeout, check=check)


def maybe_load_kpm(kpm_path: Path, module_name: str):
    if not kpm_path.exists():
        raise SystemExit(f"{module_name} KPM not found: {kpm_path}")
    remote = f"/data/local/tmp/mkpms/{kpm_path.name}"
    adb("shell", "su", "-c", "mkdir -p /data/local/tmp/mkpms", timeout=20)
    adb("shell", "su", "-c", "truncate xiaofeng777 module unload wxshadow; echo wx_unload_rc:$?", timeout=20, check=False)
    adb("shell", "su", "-c", "truncate xiaofeng777 module unload xfqtrace-hide; echo hide_unload_rc:$?", timeout=20, check=False)
    adb("push", str(kpm_path), remote, timeout=60)
    adb("shell", "su", "-c", f"truncate xiaofeng777 module load {remote}; echo load_rc:$?", timeout=20)
    adb("shell", "su", "-c", "truncate xiaofeng777 module list", timeout=20)


def collect_result(timeout_s=12):
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        p = adb("logcat", "-d", "-v", "brief", f"{TAG}:E", "*:S", timeout=10, check=False)
        last = p.stdout or ""
        matches = RESULT_RE.findall(last)
        if matches:
            raw = matches[-1]
            print("[result]", raw)
            return json.loads(raw)
        time.sleep(0.5)
    print(last)
    raise SystemExit("CRC_HOOK_DEMO_RESULT not found in logcat")


def run_detector(mode: str):
    adb("logcat", "-c")
    adb("shell", "am", "force-stop", PKG)
    adb("shell", "am", "broadcast", "-n", RECEIVER, "--es", "crc_mode", mode)
    return collect_result()


def check_inline(result):
    checks = {
        "mode inline": result.get("mode") == "inline",
        "before original": result.get("before_call") == "0x13572468",
        "after hooked": result.get("after_call") == "0x24681357",
        "install ok": result.get("install_ok") is True,
        "hook effective": result.get("hook_effective") is True,
        "direct crc changed": result.get("text_changed_direct") is True,
        "normal inline detected": result.get("normal_inline_detected") is True,
        "shadow pass false": result.get("shadow_pass_shape") is False,
    }
    if result.get("before_proc_mem_ok") and result.get("after_proc_mem_ok"):
        checks["proc mem crc changed"] = result.get("proc_mem_changed") is True
    return checks


def check_wxshadow(result):
    checks = {
        "mode wxshadow": result.get("mode") in ("wxshadow", "gshadow", "shadow"),
        "backend wxshadow": result.get("patch_backend") == "wxshadow",
        "before original": result.get("before_call") == "0x13572468",
        "after hooked": result.get("after_call") == "0x24681357",
        "install ok": result.get("install_ok") is True,
        "hook effective": result.get("hook_effective") is True,
        "direct crc unchanged": result.get("text_changed_direct") is False,
        "proc mem unchanged": result.get("proc_mem_changed") is False,
        "normal inline not detected": result.get("normal_inline_detected") is False,
        "shadow pass true": result.get("shadow_pass_shape") is True,
    }
    if result.get("before_proc_mem_ok") and result.get("after_proc_mem_ok"):
        checks["proc mem crc stable"] = result.get("before_proc_mem_crc") == result.get("after_proc_mem_crc")
    return checks


def assert_checks(kind, result, checks):
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(f"{kind} failed checks: " + ", ".join(failed))
    print(f"[ok] {kind}: target={result.get('target_addr')} hook={result.get('hook_addr')} patch_len={result.get('patch_len')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["inline", "wxshadow", "both"], default="inline")
    ap.add_argument("--load-xfqhide", action="store_true", help="push and load xfqtrace-hide KPM with embedded shadow backend")
    ap.add_argument("--load-wxshadow", action="store_true", help="legacy: push and load standalone wxshadow KPM")
    ap.add_argument("--xfqhide-kpm", type=Path, default=DEFAULT_XFQHIDE_KPM)
    ap.add_argument("--wxshadow-kpm", type=Path, default=DEFAULT_WXSHADOW_KPM)
    args = ap.parse_args()

    ensure_pixel5()
    build_apk_if_needed()
    if args.load_xfqhide:
        maybe_load_kpm(args.xfqhide_kpm, "xfqtrace-hide")
    elif args.load_wxshadow:
        maybe_load_kpm(args.wxshadow_kpm, "wxshadow")
    adb("install", "-r", str(APK), timeout=120)

    if args.mode in ("inline", "both"):
        inline = run_detector("inline")
        assert_checks("normal inline baseline", inline, check_inline(inline))
        print("[ok] normal inline hook changes call result and CRC/self-hash sees patched text")

    if args.mode in ("wxshadow", "both"):
        shadow = run_detector("wxshadow")
        assert_checks("wxshadow/gshadow page hiding", shadow, check_wxshadow(shadow))
        print("[ok] wxshadow call result changed while direct text and /proc/self/mem stayed original")


if __name__ == "__main__":
    main()
