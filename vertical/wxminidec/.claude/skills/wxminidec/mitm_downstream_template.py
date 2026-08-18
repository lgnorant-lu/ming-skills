"""Windows mitmproxy downstream adapter template.

Client -> downstream -> Burp -> upstream -> server

The template is intentionally inactive until an app-specific target host and
transformation rules are supplied. It never guesses an encryption format.

Two scenarios are supported:
1. **Encryption** — decrypt requests (ciphertext→plaintext for Burp), encrypt
   responses (plaintext→ciphertext for browser). Configure CRYPTO_RULES.
2. **Signing-only** — Pass-through (body is already plaintext).  Downstream
   is a passthrough; re-sign happens in the upstream adapter.
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from mitmproxy import http
from sign_core import get_config, set_config


# ═══════════════════════════════════════════════════════════
#  Environment / config
# ═══════════════════════════════════════════════════════════

_ENV_OVERRIDES: dict[str, str] = {}
for _env_key, _cfg_key in (
    ("MITM_APP_SECRET", "appSecret"),
    ("MITM_AES_KEY", "aesKey"),
    ("MITM_SALT", "salt"),
    ("MITM_API_KEY", "api_key"),
    ("MITM_TARGET", "target_host"),
):
    _val = os.environ.get(_env_key, "")
    if _val:
        _ENV_OVERRIDES[_cfg_key] = _val
if _ENV_OVERRIDES:
    set_config(**_ENV_OVERRIDES)

_cfg = get_config()
TARGET_HOST = str(_cfg.get("target_host", "api.example.com")).strip().lower().rstrip(".")
TARGET_HOSTS: frozenset[str] = frozenset({TARGET_HOST}) if TARGET_HOST else frozenset()
PLACEHOLDER_HOSTS: frozenset[str] = frozenset({"api.example.com", "placeholder_host_replace_me"})

# Add only confirmed rules. A rule has method/path/path_prefix and can set
# request_decrypt or response_encrypt. The default keeps all traffic intact.
CRYPTO_RULES: list[dict] = []


def _path(flow: http.HTTPFlow) -> str:
    return urlparse(flow.request.pretty_url).path or "/"


def _describe(flow: http.HTTPFlow) -> str:
    return f"{flow.request.method} {flow.request.pretty_host}{_path(flow)}"


def _rule_matches(flow: http.HTTPFlow, rule: dict) -> bool:
    host = flow.request.pretty_host.lower().rstrip(".")
    if host not in TARGET_HOSTS or host in PLACEHOLDER_HOSTS:
        return False

    method = str(rule.get("method", "*")).upper()
    if method != "*" and flow.request.method.upper() != method:
        return False

    req_path = _path(flow)
    expected_path = rule.get("path", "*")
    if expected_path != "*" and req_path != expected_path:
        return False
    path_prefix = rule.get("path_prefix")
    return not path_prefix or req_path.startswith(path_prefix)


def _find_rule(flow: http.HTTPFlow) -> dict | None:
    for rule in CRYPTO_RULES:
        if _rule_matches(flow, rule):
            return rule
    return None


def decrypt_request_body(body: bytes, rule: dict) -> bytes:
    """Replace with the confirmed app-specific request decryption."""
    raise NotImplementedError("configure decrypt_request_body for this app")


def encrypt_response_body(body: bytes, rule: dict) -> bytes:
    """Replace with the confirmed app-specific response encryption."""
    raise NotImplementedError("configure encrypt_response_body for this app")


def _transform(
    flow: http.HTTPFlow,
    operation: str,
    body: bytes,
    rule: dict,
) -> bytes | None:
    try:
        if operation == "decrypt request":
            transformed = decrypt_request_body(body, rule)
        elif operation == "encrypt response":
            transformed = encrypt_response_body(body, rule)
        else:
            raise ValueError(f"unsupported downstream operation: {operation}")
        if not isinstance(transformed, bytes):
            raise TypeError(f"{operation} must return bytes")
        return transformed
    except Exception as exc:
        print(
            f"[mitm_downstream] ERROR {_describe(flow)} {operation}: "
            f"{type(exc).__name__}: {exc}; original body kept"
        )
        return None


def _has_configured_key(config: dict) -> bool:
    key = config.get("aesKey") or config.get("crypto_key")
    if isinstance(key, bytes):
        key_text = key.decode("utf-8", errors="replace")
    else:
        key_text = str(key or "")
    return bool(key) and not key_text.startswith("PLACEHOLDER_")


class DownstreamAddon:
    def __init__(self):
        config = get_config()
        print(f"[mitm_downstream] Target hosts: {sorted(TARGET_HOSTS)}")
        print(f"[mitm_downstream] Rules: {len(CRYPTO_RULES)}")
        print(f"[mitm_downstream] Configured key: {_has_configured_key(config)}")

    def request(self, flow: http.HTTPFlow) -> None:
        rule = _find_rule(flow)
        if not rule or not rule.get("request_decrypt") or not flow.request.content:
            return

        transformed = _transform(flow, "decrypt request", flow.request.content, rule)
        if transformed is None:
            return
        flow.request.content = transformed
        print(f"[mitm_downstream] {_describe(flow)} DECRYPTED")

    def response(self, flow: http.HTTPFlow) -> None:
        if not flow.response or not flow.response.content:
            return
        rule = _find_rule(flow)
        if not rule or not rule.get("response_encrypt"):
            return

        transformed = _transform(flow, "encrypt response", flow.response.content, rule)
        if transformed is None:
            return
        flow.response.content = transformed
        print(f"[mitm_downstream] {_describe(flow)} ENCRYPTED response")


addons = [DownstreamAddon()]

# Start from the project root with:
# mitmdump -s ./output/mitm_downstream.py -p 8082 --mode upstream:http://127.0.0.1:8080 --set upstream_cert=false --ssl-insecure
