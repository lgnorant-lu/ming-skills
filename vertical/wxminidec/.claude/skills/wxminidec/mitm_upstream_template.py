"""Windows mitmproxy upstream adapter template.

Burp -> upstream -> target server.  Supports two scenarios:

1. **Encryption adapters** — Body is ciphertext.  Upstream encrypts requests
   (plaintext from Burp → ciphertext for server) and decrypts responses.
   Configure CRYPTO_RULES and the encrypt/decrypt functions.

2. **Signing adapters** — Body is plaintext but needs a signature parameter.
   Upstream re-signs requests after Burp edits parameters.  Implement the
   `_handle_sign()` method — see the stub and comments below.

Both can coexist: if a request matches a CRYPTO_RULES entry it gets encrypted;
otherwise, if `_should_sign()` returns True it gets re-signed.
"""

from __future__ import annotations

import os
import sys
from urllib.parse import urlparse

_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from mitmproxy import http

# ── App-specific imports (add as needed) ─────────────────
# from sign_core import get_config, set_config, compute_sign, ...

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

# ── Encryption rules (only for apps with AES/SM4 body encryption) ──
# Rule keys: method, path, path_prefix, request_encrypt (bool), response_decrypt (bool)
CRYPTO_RULES: list[dict] = []

# ── Signing config (only for apps with request signing, no body encryption) ──
# Set to True when the app uses request signing (sign/timestamp params).
SIGNING_ENABLED: bool = False
# Override in the app-specific adapter.  When True, every request to
# TARGET_HOST is re-signed unless it matches a CRYPTO_RULES entry.
SIGN_ALL_PATHS: bool = True
# Only sign these HTTP methods (uppercase). GET parameters are re-written
# via query string; POST/PUT are re-written via urlencoded_form or JSON.
SIGN_METHODS: frozenset[str] = frozenset({"GET", "POST", "PUT"})


# ═══════════════════════════════════════════════════════════
#  mitmproxy 10 / 11 compatible body helpers
# ═══════════════════════════════════════════════════════════
#
#  Do NOT use form.set_all(list_of_tuples) — it was removed in mitmproxy 11.
#  The per-key assignment pattern works on both versions and is the documented
#  approach in mitmproxy's own examples.

def _set_form_fields(req: http.Request, fields: dict[str, str]) -> None:
    """Replace form fields using per-key assignment (mitmproxy 10+11 safe)."""
    for key, value in fields.items():
        req.urlencoded_form[str(key)] = str(value)


def _set_query_fields(req: http.Request, fields: dict[str, str]) -> None:
    """Replace query parameters using per-key assignment (mitmproxy 10+11 safe)."""
    for key, value in fields.items():
        req.query[str(key)] = str(value)


def _extract_params(req: http.Request) -> dict[str, str]:
    """Extract parameters from the request body or query string.

    Returns an empty dict on parse failure — the caller decides how to handle it.
    """
    params: dict[str, str] = {}
    content_type = (req.headers.get("content-type") or "").lower()

    if req.method in ("GET", "HEAD", "OPTIONS"):
        for k, v in req.query.items(multi=True):
            params[k] = v
    elif "json" in content_type and req.text:
        try:
            import json
            parsed = json.loads(req.text)
            if isinstance(parsed, dict):
                params.update({str(k): str(v) for k, v in parsed.items()})
        except Exception:
            pass  # keep params empty
    else:
        # form-encoded or other — urlencoded_form handles both
        try:
            for k, v in req.urlencoded_form.items(multi=True):
                params[k] = v
        except Exception:
            pass

    return params


def _describe(flow: http.HTTPFlow) -> str:
    return f"{flow.request.method} {flow.request.pretty_host}{_path(flow)}"


def _path(flow: http.HTTPFlow) -> str:
    return urlparse(flow.request.pretty_url).path or "/"


# ═══════════════════════════════════════════════════════════
#  Rule matching (for encryption)
# ═══════════════════════════════════════════════════════════

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


# ═══════════════════════════════════════════════════════════
#  Encryption stubs — override for apps with body encryption
# ═══════════════════════════════════════════════════════════

def encrypt_request_body(body: bytes, rule: dict) -> bytes:
    """Replace with the confirmed app-specific request encryption."""
    raise NotImplementedError("configure encrypt_request_body for this app")


def decrypt_response_body(body: bytes, rule: dict) -> bytes:
    """Replace with the confirmed app-specific response decryption."""
    raise NotImplementedError("configure decrypt_response_body for this app")


# ═══════════════════════════════════════════════════════════
#  Signing stub — override for apps with request signing
# ═══════════════════════════════════════════════════════════

def _should_sign(flow: http.HTTPFlow) -> bool:
    """Return True if this request should be re-signed."""
    if not SIGNING_ENABLED:
        return False
    host = flow.request.pretty_host.lower().rstrip(".")
    if host not in TARGET_HOSTS:
        return False
    if flow.request.method.upper() not in SIGN_METHODS:
        return False
    if not SIGN_ALL_PATHS:
        # App-specific path filtering goes here
        pass
    return True


def _handle_sign(flow: http.HTTPFlow) -> None:
    """Re-sign the request after Burp edits.

    Implement this in the app-specific adapter.  The implementation must:

    1. Parse params from the request body/query (use _extract_params).
    2. Remove old sign/countersign from params.
    3. Call compute_sign(flow.request.method, flow.request.path, params).
    4. Write new sign into params and rebuild the body.
       - Use _set_form_fields for POST/PUT form bodies.
       - Use _set_query_fields for GET query strings.
       - NEVER use .set_all() — it changed in mitmproxy 11.
    5. Update headers: sign, requestSignTime, etc.

    ALL of this must be inside ONE try/except block so a failure in step 4
    does not silently forward the request without signing.
    """
    raise NotImplementedError("implement _handle_sign for this app")


# ═══════════════════════════════════════════════════════════
#  Addon
# ═══════════════════════════════════════════════════════════

def _has_configured_key(config: dict) -> bool:
    key = config.get("aesKey") or config.get("crypto_key")
    if isinstance(key, bytes):
        key_text = key.decode("utf-8", errors="replace")
    else:
        key_text = str(key or "")
    return bool(key) and not key_text.startswith("PLACEHOLDER_")


class UpstreamAddon:
    def __init__(self):
        config = get_config()
        print(f"[mitm_upstream] Target hosts: {sorted(TARGET_HOSTS)}")
        print(f"[mitm_upstream] Encryption rules: {len(CRYPTO_RULES)}")
        print(f"[mitm_upstream] Signing enabled: {SIGNING_ENABLED}")
        print(f"[mitm_upstream] Configured key: {_has_configured_key(config)}")

    # ── request ──────────────────────────────────────────

    def request(self, flow: http.HTTPFlow) -> None:
        # 1) Encryption (takes priority — crypto transforms the whole body)
        rule = _find_rule(flow)
        if rule and rule.get("request_encrypt") and flow.request.content:
            try:
                transformed = encrypt_request_body(flow.request.content, rule)
                if transformed is not None:
                    flow.request.content = transformed
                    print(f"[mitm_upstream] {_describe(flow)} encrypted")
            except Exception as exc:
                print(
                    f"[mitm_upstream] ERROR {_describe(flow)} encrypt request: "
                    f"{type(exc).__name__}: {exc}; original body kept"
                )
            return

        # 2) Signing (plaintext body, add/update sign parameter)
        if _should_sign(flow):
            try:
                _handle_sign(flow)
            except NotImplementedError:
                pass  # template default — no signing configured yet
            except Exception as exc:
                print(
                    f"[mitm_upstream] ERROR {_describe(flow)} sign: "
                    f"{type(exc).__name__}: {exc}; unsigned request forwarded"
                )

    # ── response ─────────────────────────────────────────

    def response(self, flow: http.HTTPFlow) -> None:
        if not flow.response or not flow.response.content:
            return
        rule = _find_rule(flow)
        if not rule or not rule.get("response_decrypt"):
            return

        try:
            transformed = decrypt_response_body(flow.response.content, rule)
            if transformed is not None:
                flow.response.content = transformed
                print(f"[mitm_upstream] {_describe(flow)} decrypted response")
        except Exception as exc:
            print(
                f"[mitm_upstream] ERROR {_describe(flow)} decrypt response: "
                f"{type(exc).__name__}: {exc}; original body kept"
            )


addons = [UpstreamAddon()]

# Start with:
# mitmdump -s ./output/mitm_upstream.py -p 8083
