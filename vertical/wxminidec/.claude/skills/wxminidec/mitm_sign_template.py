"""
mitmproxy adapter example for a Mini Program API.  **单代理方案（旧版）**

此模板为向后兼容保留。如果你需要 Burp 中**请求和响应都显示明文**，
请使用双代理方案，参见两个新模板：
  - mitm_downstream_template.py  下游（面向浏览器，解密请求 + 加密响应）
  - mitm_upstream_template.py    上游（面向服务器，加密请求 + 解密响应）

单代理方案限制：Burp 中仅响应可解密为明文，请求体仍为密文。

---- 以下是原始模板内容 ----

This is a starting point, not a universal implementation. Rewrite the
signing fields, parameter extraction, request matching, and crypto rules to
match the decompiled Mini Program and its captured Burp traffic.

Example setup:
  1. Update sign_core.py with the values found in the decompiled source.
  2. Set MITM_TOKEN and MITM_USERINFO when this application needs them.
  3. Add only confirmed endpoints to CRYPTO_RULES below.
  4. Start: mitmdump -s mitm_sign.py -p 8888
  5. Configure Burp to use 127.0.0.1:8888 as its upstream proxy.

Signing and application-layer encryption are separate. This example signs
matching requests, but encryption is disabled until a crypto rule is added.
"""

import os
import sys
from typing import Any
from urllib.parse import urlparse

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from mitmproxy import http
from sign_core import (
    API_KEY as SOURCE_API_KEY,
    TARGET_HOST as SOURCE_TARGET_HOST,
    compute_sign,
    extract_data,
)

try:
    from sign_core import CRYPTO_MODE, decrypt_body, encrypt_body
except Exception as exc:
    CRYPTO_MODE = "unknown"
    decrypt_body = None
    encrypt_body = None
    print(f"[mitm_sign] Crypto functions unavailable: {type(exc).__name__}: {exc}")


def _env_or(name: str, fallback: str) -> str:
    value = os.environ.get(name, "")
    return value if value else fallback


TOKEN = _env_or("MITM_TOKEN", "undefined")
USERINFO = _env_or("MITM_USERINFO", "{}")
API_KEY = _env_or("MITM_API_KEY", SOURCE_API_KEY)
TARGET_HOST = _env_or("MITM_TARGET", SOURCE_TARGET_HOST).strip().lower().rstrip(".")

# Add only confirmed endpoints. The legacy adapter is inactive by default.
SIGNING_RULES = []

# Encryption is deliberately opt-in. Add rules only after Burp traffic and
# the decompiled source confirm the exact host, method, path, direction, and
# body/field scope. Use app-specific code for field-level encryption.
# Each rule may contain:
#   request_decrypt: captured request body must be decrypted before signing
#   request_encrypt: plaintext request body must be encrypted before sending
#   response_decrypt: response body must be decrypted before Burp sees it
CRYPTO_RULES: list[dict[str, Any]] = []


def _path(flow: http.HTTPFlow) -> str:
    return urlparse(flow.request.pretty_url).path or "/"


def _matches_scope(flow: http.HTTPFlow, rule: dict[str, Any]) -> bool:
    host = flow.request.pretty_host.lower().rstrip(".")
    if host != TARGET_HOST.rstrip("."):
        return False

    method = str(rule.get("method", "*")).upper()
    if method != "*" and flow.request.method.upper() != method:
        return False

    path = _path(flow)
    expected_path = rule.get("path", "*")
    if expected_path != "*" and path != expected_path:
        return False

    path_prefix = rule.get("path_prefix")
    return not path_prefix or path.startswith(path_prefix)


def _find_crypto_rule(flow: http.HTTPFlow) -> dict[str, Any] | None:
    for rule in CRYPTO_RULES:
        if _matches_scope(flow, rule):
            return rule
    return None


def _describe(flow: http.HTTPFlow) -> str:
    return f"{flow.request.method} {flow.request.pretty_host}{flow.request.path}"


class SigningAddon:
    def __init__(self):
        print(f"[mitm_sign] Target host: {TARGET_HOST}")
        print(f"[mitm_sign] Signing rules: {len(SIGNING_RULES)}")
        print(f"[mitm_sign] Crypto rules: {len(CRYPTO_RULES)}")
        if CRYPTO_RULES and not (decrypt_body and encrypt_body):
            print("[mitm_sign] ERROR: crypto rules exist but crypto functions are unavailable")
        elif CRYPTO_RULES:
            print(f"[mitm_sign] Crypto mode: {CRYPTO_MODE}")
        else:
            print("[mitm_sign] Crypto: disabled (no confirmed rules)")

    def _signing_rule(self, flow: http.HTTPFlow) -> dict[str, Any] | None:
        for rule in SIGNING_RULES:
            if _matches_scope(flow, rule):
                return rule
        return None

    def request(self, flow: http.HTTPFlow) -> None:
        rule = self._signing_rule(flow)
        if rule is None:
            return

        crypto_rule = _find_crypto_rule(flow)
        original_body = flow.request.content
        signing_body = original_body
        if crypto_rule and crypto_rule.get("request_decrypt") and signing_body:
            if decrypt_body is None:
                print(f"[mitm_sign] ERROR {_describe(flow)} request decrypt unavailable")
                return
            try:
                signing_body = decrypt_body(signing_body)
            except Exception as exc:
                print(
                    f"[mitm_sign] ERROR {_describe(flow)} request decrypt failed: "
                    f"{type(exc).__name__}: {exc}"
                )
                return
            print(f"[mitm_sign]   decrypted request body for signing")

        data = extract_data(
            method=flow.request.method,
            url=flow.request.pretty_url,
            body=signing_body,
        )
        sign, ts = compute_sign(data)

        outgoing_body = original_body
        if crypto_rule and crypto_rule.get("request_encrypt") and signing_body:
            if encrypt_body is None:
                print(f"[mitm_sign] ERROR {_describe(flow)} request encrypt unavailable")
                return
            try:
                encrypted_body = encrypt_body(signing_body)
            except Exception as exc:
                print(
                    f"[mitm_sign] ERROR {_describe(flow)} request encrypt failed: "
                    f"{type(exc).__name__}: {exc}"
                )
                return
            outgoing_body = encrypted_body.encode("utf-8")
            print(f"[mitm_sign]   encrypted request body")

        # These header names are only this example's protocol. If the source
        # places the signature in query/body fields, rewrite this section.
        flow.request.content = outgoing_body
        flow.request.headers["key"] = API_KEY
        flow.request.headers["sign"] = sign
        flow.request.headers["timestamp"] = str(ts)
        flow.request.headers["token"] = TOKEN
        flow.request.headers["userInfo"] = USERINFO

        print(f"[mitm_sign] {_describe(flow)}")
        print(f"[mitm_sign]   data={data} ts={ts} sign={sign}")

    def response(self, flow: http.HTTPFlow) -> None:
        if not flow.response or not flow.response.content:
            return

        crypto_rule = _find_crypto_rule(flow)
        if not crypto_rule or not crypto_rule.get("response_decrypt"):
            return
        if decrypt_body is None:
            print(f"[mitm_sign] ERROR {_describe(flow)} response decrypt unavailable")
            return

        original_body = flow.response.content
        try:
            plaintext = decrypt_body(original_body)
        except Exception as exc:
            print(
                f"[mitm_sign] ERROR {_describe(flow)} response decrypt failed: "
                f"{type(exc).__name__}: {exc}; keeping original body"
            )
            return

        flow.response.content = plaintext
        print(f"[mitm_sign]   decrypted response body ({len(plaintext)} bytes)")


addons = [SigningAddon()]
