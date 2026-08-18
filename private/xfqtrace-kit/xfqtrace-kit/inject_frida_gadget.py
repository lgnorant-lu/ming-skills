#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Standalone helper: inject Frida Gadget with xfinjectd, then attach/load JS.

This script is intentionally generic:
- no xfQTrace config
- no trace lifecycle
- no recipe parsing

It only stages a Frida Gadget listen config, injects Gadget through xfinjectd,
and optionally runs `frida -H 127.0.0.1:<port> -n Gadget -l hook.js`.
"""

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time

DEFAULT_PORT = 14725
DEFAULT_GADGET_BASENAME = "libgadget.so"
DEFAULT_CONFIG_BASENAME = "libgadget.config.so"


def kit_root():
    return os.path.dirname(os.path.abspath(__file__))


def q(value):
    return shlex.quote(str(value))


def run(cmd, *, check=True, capture=True):
    print("$ " + " ".join(q(x) for x in cmd))
    p = subprocess.run(
        cmd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
    )
    if capture:
        if p.stdout:
            print(p.stdout.rstrip())
        if p.stderr:
            print(p.stderr.rstrip(), file=sys.stderr)
    if check and p.returncode != 0:
        raise SystemExit(p.returncode)
    return p


def adb_cmd(serial, *args):
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    return cmd


def adb(serial, *args, check=True):
    return run(adb_cmd(serial, *args), check=check)


def adb_shell(serial, shell_cmd, *, root=False, check=True):
    if root:
        shell_cmd = "su 0 -c " + q(shell_cmd)
    return adb(serial, "shell", shell_cmd, check=check)


def find_default_gadget():
    return os.path.join(kit_root(), "bin", "libgadget-rusda.so")


def find_default_xfinjectd():
    return os.path.join(kit_root(), "bin", "xfinjectd")


def require_host_tool(name, *, required=True):
    path = shutil.which(name)
    if not path and required:
        raise SystemExit(f"missing host tool: {name} (please install it or put it in PATH)")
    return path


def require_file(path, *, role, hint=None):
    if os.path.isfile(path):
        return
    msg = f"missing {role}: {path}"
    if hint:
        msg += "\n" + hint
    raise SystemExit(msg)



def default_config_for_gadget(gadget_path):
    base = os.path.basename(gadget_path)
    directory = os.path.dirname(gadget_path)
    candidates = []
    if base.startswith("lib") and base.endswith(".so"):
        candidates.append(os.path.join(directory, base[:-3] + ".config.so"))
    candidates.append(os.path.join(directory, DEFAULT_CONFIG_BASENAME))
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return None

def write_gadget_config(path, *, port, address, on_load):
    cfg = {
        "interaction": {
            "type": "listen",
            "on_port_conflict": "fail",
            "on_load": on_load,
            "address": address,
            "port": int(port),
        }
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return cfg


def push_file(serial, local_path, remote_path, mode):
    if not os.path.isfile(local_path):
        raise SystemExit(f"missing file: {local_path}")
    adb(serial, "push", local_path, remote_path)
    adb_shell(serial, f"chmod {mode:o} {q(remote_path)}", root=True)


def start_xfinject(serial, xfinject_cmd):
    cmd = adb_cmd(serial, "shell", "su", "0", "-c", xfinject_cmd)
    print("$ " + " ".join(q(x) for x in cmd))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    def pump():
        assert proc.stdout is not None
        for line in proc.stdout:
            print(line.rstrip())

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    return proc


def is_gadget_listening(serial, port):
    p = adb_shell(
        serial,
        f"ss -ltnp 2>/dev/null | grep ':{int(port)}' || true",
        root=True,
        check=False,
    )
    return bool(p.stdout.strip())


def wait_for_gadget_port(serial, port, seconds):
    if seconds <= 0:
        return False
    deadline = time.time() + seconds
    while time.time() < deadline:
        if is_gadget_listening(serial, port):
            return True
        time.sleep(0.2)
    return False


def run_frida_cli(port, target_name, hook_script, extra_args):
    if not hook_script:
        print(f"[*] Gadget injected. Attach manually:")
        print(f"    frida -H 127.0.0.1:{int(port)} -n {target_name} -l <hook.js>")
        return 0
    cmd = ["frida", "-H", f"127.0.0.1:{int(port)}", "-n", target_name, "-l", hook_script]
    if extra_args:
        cmd += extra_args
    print("$ " + " ".join(q(x) for x in cmd))
    return subprocess.call(cmd)


def main():
    ap = argparse.ArgumentParser(
        description="Inject Frida Gadget with xfinjectd, then optionally load a hook JS."
    )
    ap.add_argument("-p", "--package", required=True, help="target Android package")
    ap.add_argument("--serial", help="adb serial")
    ap.add_argument("-l", "--load", dest="hook_script", help="hook JS to load with frida after Gadget is listening")
    ap.add_argument("--target-name", default="Gadget", help="Frida attach name, default Gadget")
    ap.add_argument("--gadget", help="local Frida Gadget .so; default bin/libgadget-rusda.so")
    ap.add_argument("--xfinjectd", default=find_default_xfinjectd(), help="local xfinjectd; default bin/xfinjectd")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="Gadget listen port, default 14725")
    ap.add_argument("--config", help="custom local Gadget config file; default: config next to --gadget if present, otherwise auto-generate")
    ap.add_argument("--address", default="0.0.0.0", help="Gadget listen address, default 0.0.0.0")
    ap.add_argument("--on-load", choices=["wait", "resume"], default="wait", help="Gadget on_load, default wait")
    ap.add_argument("--vma-hide", choices=["auto", "always", "never"], default="auto", help="xfinject vma hide mode")
    ap.add_argument("--no-forward", action="store_true", help="do not run adb forward")
    ap.add_argument("--wait-port-sec", type=float, default=20.0, help="wait for Gadget TCP listener before running frida")
    ap.add_argument("--print-only", action="store_true", help="print config/commands only")
    ap.add_argument("--", dest="frida_args", nargs=argparse.REMAINDER, help="extra args passed to frida CLI")
    args = ap.parse_args()

    gadget = os.path.abspath(args.gadget or find_default_gadget())
    xfinjectd = os.path.abspath(args.xfinjectd)
    if args.hook_script:
        args.hook_script = os.path.abspath(args.hook_script)
        require_file(args.hook_script, role="hook script")
    custom_config = os.path.abspath(args.config) if args.config else None
    require_file(
        gadget,
        role="Frida Gadget",
        hint=(
            "Expected default path is bin/libgadget-rusda.so.\n"
            "Put rusda Gadget there, or pass --gadget /path/to/libgadget.so."
        ),
    )
    if not custom_config:
        custom_config = default_config_for_gadget(gadget)
    if custom_config:
        require_file(custom_config, role="Gadget config")

    require_file(
        xfinjectd,
        role="xfinjectd",
        hint="Expected default path is bin/xfinjectd. Build/copy xfinjectd into kit/bin first.",
    )
    if not args.print_only:
        require_host_tool("adb")
        if args.hook_script:
            require_host_tool("frida")

    remote_gadget = "/data/local/tmp/libgadget.so"
    remote_config = "/data/local/tmp/libgadget.config.so"
    remote_xfinjectd = "/data/local/tmp/xfinjectd"

    with tempfile.TemporaryDirectory(prefix="frida_gadget_") as td:
        if custom_config:
            local_config = custom_config
            cfg = None
        else:
            local_config = os.path.join(td, DEFAULT_CONFIG_BASENAME)
            cfg = write_gadget_config(local_config, port=args.port, address=args.address, on_load=args.on_load)

        xfinject_cmd = (
            f"{q(remote_xfinjectd)} "
            f"-pkg {q(args.package)} "
            f"-app-file {q(remote_config + ':' + DEFAULT_CONFIG_BASENAME)} "
            f"-lib {q(remote_gadget + ':' + DEFAULT_GADGET_BASENAME)} "
            f"-vma-hide {q(args.vma_hide)}"
        )

        if cfg is None:
            print(f"[*] Gadget config: {local_config} (from file)")
        else:
            print("[*] Gadget config: <auto-generated>")
            print(json.dumps(cfg, ensure_ascii=False, indent=2))
        print("[*] Required local files:")
        print(f"    gadget   -> {gadget}")
        print(f"    config   -> {local_config}")
        print(f"    xfinjectd -> {xfinjectd}")
        if args.hook_script:
            print(f"    hook.js  -> {args.hook_script}")
        else:
            print("    hook.js  -> <manual, pass -l hook.js or attach later>")
        print(f"[*] Gadget: {gadget}")
        print(f"[*] xfinjectd: {xfinjectd}")
        print(f"[*] xfinject cmd:\n    {xfinject_cmd}")
        if args.hook_script:
            print(f"[*] hook JS: {args.hook_script}")

        if args.print_only:
            return

        if not args.no_forward:
            adb(args.serial, "forward", "--remove", f"tcp:{int(args.port)}", check=False)
            adb(args.serial, "forward", f"tcp:{int(args.port)}", f"tcp:{int(args.port)}")

        push_file(args.serial, gadget, remote_gadget, 0o644)
        push_file(args.serial, local_config, remote_config, 0o644)
        push_file(args.serial, xfinjectd, remote_xfinjectd, 0o755)

        proc = start_xfinject(args.serial, xfinject_cmd)

        if wait_for_gadget_port(args.serial, args.port, args.wait_port_sec):
            print(f"[*] Gadget is listening on 127.0.0.1:{int(args.port)}")
        else:
            print(f"[!] Gadget listen port not observed within {args.wait_port_sec:g}s; trying/printing frida command anyway")

        rc = run_frida_cli(args.port, args.target_name, args.hook_script, args.frida_args)

        # Do not force-kill xfinject or the target app here. If Gadget was in
        # wait mode, attaching lets dlopen return and xfinject should exit by
        # itself; if the user only wanted staging, leaving state untouched is
        # less surprising.
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        raise SystemExit(rc)


if __name__ == "__main__":
    main()
