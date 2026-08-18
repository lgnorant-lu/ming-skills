#!/usr/bin/env python3
"""Windows dependency and mitmproxy CA check for wxminidec."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

NPM_REGISTRY = "https://registry.npmmirror.com"


def check_cmd(name: str, args: list[str] | None = None) -> tuple[bool, str]:
    """Check that a command is available; do not parse its version."""
    exe = shutil.which(name)
    if not exe:
        return False, f"MISSING: {name} not found on PATH"
    if not args:
        return True, f"OK: {name} found at {exe}"
    try:
        result = subprocess.run(
            [exe, *args],
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"FAIL: {name} check error: {type(exc).__name__}: {exc}"
    output = (result.stdout + result.stderr).strip()
    if result.returncode != 0:
        return False, f"FAIL: {name} returned {result.returncode}: {output[:160]}"
    return True, f"OK: {name} command check passed"


def check_node_version() -> tuple[bool, str]:
    """Check node --version >= 18 because wedecode needs Node 18+."""
    exe = shutil.which("node")
    if not exe:
        return False, "MISSING: node not found on PATH"
    try:
        result = subprocess.run(
            [exe, "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            encoding="utf-8",
            errors="replace",
        )
        ver_str = result.stdout.strip().lstrip("v")
        major = int(ver_str.split(".")[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError) as exc:
        return False, f"FAIL: node version check error: {type(exc).__name__}: {exc}"
    if major >= 18:
        return True, f"OK: node v{ver_str} (>= 18)"
    return False, f"FAIL: node v{ver_str} (need >= 18)"


def check_python_module(module_name: str) -> tuple[bool, str]:
    try:
        __import__(module_name)
    except ImportError:
        return False, f"MISSING: Python module {module_name}"
    return True, f"OK: Python module {module_name}"


def _certificate_hash(cert_path: Path) -> str | None:
    certutil = shutil.which("certutil")
    if not certutil:
        return None
    try:
        result = subprocess.run(
            [certutil, "-dump", str(cert_path)],
            capture_output=True,
            text=True,
            timeout=15,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError):
        return None
    # The SHA-1 fingerprint is stable even when certutil localizes labels.
    for line in (result.stdout + result.stderr).splitlines():
        if "sha1" in line.casefold() or "hash" in line.casefold():
            match = re.search(r"(?<![0-9A-Fa-f])([0-9A-Fa-f]{40})(?![0-9A-Fa-f])", line)
            if match:
                return match.group(1).casefold()
    matches = re.findall(r"(?<![0-9A-Fa-f])([0-9A-Fa-f]{40})(?![0-9A-Fa-f])", result.stdout)
    return matches[0].casefold() if matches else None


def _root_store_contains(cert_hash: str) -> bool:
    certutil = shutil.which("certutil")
    if not certutil:
        return False
    for store_args in (("-user", "-store", "root"), ("-store", "root")):
        try:
            result = subprocess.run(
                [certutil, *store_args],
                capture_output=True,
                text=True,
                timeout=20,
                encoding="utf-8",
                errors="replace",
            )
        except (OSError, subprocess.SubprocessError):
            continue
        store_hashes = {
            value.casefold()
            for value in re.findall(
                r"(?<![0-9A-Fa-f])([0-9A-Fa-f]{40})(?![0-9A-Fa-f])",
                result.stdout + result.stderr,
            )
        }
        if cert_hash.casefold() in store_hashes:
            return True
    return False


def check_mitmproxy_ca(auto_install: bool = True) -> tuple[bool, str]:
    """Check and, when requested, install the standard Windows mitmproxy CA."""
    if os.name != "nt":
        return False, "UNSUPPORTED: wxminidec assumes Windows"

    cert_path = Path(os.environ.get("USERPROFILE", "")) / ".mitmproxy" / "mitmproxy-ca-cert.cer"
    if not cert_path.is_file():
        return False, f"PENDING: mitmproxy CA not found at {cert_path}"

    cert_hash = _certificate_hash(cert_path)
    if not cert_hash:
        return False, f"FAIL: cannot read mitmproxy CA fingerprint from {cert_path}"
    if _root_store_contains(cert_hash):
        return True, f"OK: mitmproxy CA is trusted ({cert_path})"

    command = f'certutil -addstore root "%USERPROFILE%\\.mitmproxy\\mitmproxy-ca-cert.cer"'
    if not auto_install:
        return False, f"FAIL: mitmproxy CA is not trusted; run {command}"

    certutil = shutil.which("certutil")
    if not certutil:
        return False, f"FAIL: certutil not found; run {command}"
    try:
        result = subprocess.run(
            [certutil, "-addstore", "root", str(cert_path)],
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"FAIL: certutil install error {type(exc).__name__}: {exc}; run {command}"

    if result.returncode == 0 and _root_store_contains(cert_hash):
        return True, f"OK: mitmproxy CA installed and trusted ({cert_path})"
    return False, f"FAIL: certutil did not establish trust (exit={result.returncode}); run {command}"


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    print("=" * 60)
    print("wxminidec - Windows Dependency Check")
    print("=" * 60)
    print()

    required_ok = sys.version_info >= (3, 10)
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    print(f"[{'OK' if required_ok else 'FAIL'}] Python: {py_ver} (need >= 3.10)")

    print()
    print("- Conditional dependencies -")
    node_ok, node_msg = check_node_version()
    print(f"[{'OK' if node_ok else 'NA'}] {node_msg} (needed for decompilation)")

    mitm_ok, mitm_msg = check_cmd("mitmdump", ["--version"])
    print(f"[{'OK' if mitm_ok else 'NA'}] {mitm_msg} (optional proxy adapter)")

    crypto_ok, crypto_msg = check_python_module("Crypto")
    print(f"[{'OK' if crypto_ok else 'NA'}] {crypto_msg} (needed only for confirmed AES)")

    cert_ok, cert_msg = check_mitmproxy_ca(auto_install=True)
    print(f"[{'OK' if cert_ok else 'NA'}] {cert_msg} (needed for HTTPS interception)")

    print()
    print("- Optional commands -")
    wd_ok, wd_msg = check_cmd("wedecode")
    print(f"[{'OK' if wd_ok else 'NA'}] {wd_msg} (needed only for package decompilation)")
    print("[NA ] burp-ai-agent MCP: check at runtime (agent tools)")

    print()
    print("- Installation commands -")
    print(f"npm install -g wedecode --registry {NPM_REGISTRY}")
    print("python -m pip install -r ./output/requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple")
    print()
    print("=" * 60)
    if required_ok:
        print("Required Python dependency is available; conditional checks are listed above.")
    else:
        print("MISSING REQUIRED DEPENDENCY: Python 3.10+ is required.")
    print("=" * 60)
    return 0 if required_ok else 1


if __name__ == "__main__":
    sys.exit(main())
