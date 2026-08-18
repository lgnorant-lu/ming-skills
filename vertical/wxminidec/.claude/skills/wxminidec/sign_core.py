#!/usr/bin/env python3
"""
Reference signing and optional AES helpers for wxminidec adapters.

The constants and serialization rules in this file are examples. Replace them
with values and behavior confirmed from the target Mini Program and a captured
baseline before using an adapter against a real service.
"""

import base64
import hashlib
import math
import re
import time
import urllib.parse
from urllib.parse import parse_qs

SALT = "PLACEHOLDER_SALT_REPLACE_ME"
API_KEY = "PLACEHOLDER_KEY_REPLACE_ME"
TARGET_HOST = "PLACEHOLDER_HOST_REPLACE_ME"
SPECIAL_CHARS_REGEX = (
    r'''[\n`~!@#$%^&*()+|{}';',\[\].<>/?~！@#￥%……&*（）——+|{}【】'；："'''
    r'''。， 、？]'''
)

CRYPTO_KEY = b"PLACEHOLDER_16_OR_32_BYTE_KEY"
CRYPTO_IV = b"PLACEHOLDER_16_BYTE_IV__"
CRYPTO_MODE = "CBC"

_CONFIG = {
    "salt": SALT,
    "api_key": API_KEY,
    "target_host": TARGET_HOST,
    "crypto_key": CRYPTO_KEY,
    "crypto_iv": CRYPTO_IV,
    "crypto_mode": CRYPTO_MODE,
    "appSecret": "",
    "aesKey": "",
}

_CONFIG_TO_GLOBAL = {
    "salt": "SALT",
    "api_key": "API_KEY",
    "target_host": "TARGET_HOST",
    "crypto_key": "CRYPTO_KEY",
    "crypto_iv": "CRYPTO_IV",
    "crypto_mode": "CRYPTO_MODE",
}


def get_config() -> dict:
    """Return the current adapter configuration as a shallow copy."""
    return dict(_CONFIG)


def set_config(**overrides) -> dict:
    """Apply non-None configuration overrides and return the new config."""
    for key, value in overrides.items():
        if value is None:
            continue
        if key == "aesKey":
            _CONFIG["aesKey"] = value
            _CONFIG["crypto_key"] = value
        else:
            _CONFIG[key] = value

        global_name = _CONFIG_TO_GLOBAL.get(key)
        if global_name:
            globals()[global_name] = value

    if "aesKey" in overrides and overrides["aesKey"] is not None:
        globals()["CRYPTO_KEY"] = overrides["aesKey"]
    return get_config()


def strip_special(value: str) -> str:
    """Remove the characters specified by the target source regex."""
    return re.sub(SPECIAL_CHARS_REGEX, "", value)


def _js_number_to_string(value: int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if value == 0:
        return "0"
    if value.is_integer():
        return str(int(value))

    text = repr(value)
    if "e" in text or "E" in text:
        mantissa, exponent = re.split("[eE]", text)
        exponent_value = int(exponent)
        if -6 < exponent_value < 21:
            text = format(value, ".20f").rstrip("0").rstrip(".")
        else:
            text = f"{mantissa}e{'+' if exponent_value >= 0 else ''}{exponent_value}"
    return text


def js_to_string(value) -> str:
    """Approximate JavaScript String(value) for signing values."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _js_number_to_string(value)
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return ",".join("" if item is None else js_to_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def _config_value(key: str, fallback):
    value = _CONFIG.get(key, fallback)
    return fallback if value is None else value


def compute_sign(data: dict, timestamp: int | None = None) -> tuple[str, int]:
    """Compute the reference signature for a parameter mapping."""
    if timestamp is None:
        timestamp = int(time.time() * 1000)

    normalized = {str(key): value for key, value in data.items()}
    sorted_keys = sorted(normalized)
    parts = [_config_value("salt", SALT) + str(timestamp)]
    for key in sorted_keys:
        parts.append(f"{key}={js_to_string(normalized[key])}")

    raw = "&".join(parts) if len(parts) > 1 else parts[0]
    cleaned = strip_special(raw)
    encoded = urllib.parse.quote(cleaned, safe="-_.!~*'()")
    sign = hashlib.md5(encoded.encode("utf-8")).hexdigest().upper()
    return sign, timestamp


def _coerce_form_value(value: str):
    if re.fullmatch(r"[-+]?\d+", value):
        try:
            return int(value)
        except ValueError:
            pass
    return value


def extract_data(method: str, url: str, body: bytes = b"") -> dict:
    """Extract common GET, form-urlencoded, or JSON request parameters."""
    data = {}
    method = method.upper()
    parsed = urllib.parse.urlparse(url)

    if method == "GET":
        for key, values in parse_qs(parsed.query, keep_blank_values=True).items():
            data[key] = _coerce_form_value(values[0])
        return data

    content = body.decode("utf-8", errors="replace") if body else ""
    if not content:
        return data

    stripped = content.lstrip()
    if stripped.startswith("{"):
        try:
            import json

            parsed_body = json.loads(content)
            if isinstance(parsed_body, dict):
                return parsed_body
        except (ValueError, TypeError):
            pass

    if "=" in content:
        for key, values in parse_qs(content, keep_blank_values=True).items():
            data[key] = _coerce_form_value(values[0])
    return data


def build_headers(
    data: dict,
    token: str = "undefined",
    user_info: str = "{}",
    key: str | None = None,
    timestamp: int | None = None,
) -> dict:
    """Build the example signing headers."""
    sign, ts = compute_sign(data, timestamp)
    return {
        "key": key or _config_value("api_key", API_KEY),
        "sign": sign,
        "timestamp": str(ts),
        "token": token,
        "userInfo": user_info,
    }


def _get_cipher():
    try:
        from Crypto.Cipher import AES
    except ImportError as exc:
        raise ImportError(
            "pycryptodome is required for encryption/decryption. "
            "Install it with: python -m pip install pycryptodome "
            "-i https://pypi.tuna.tsinghua.edu.cn/simple"
        ) from exc

    key = _config_value("crypto_key", CRYPTO_KEY)
    iv = _config_value("crypto_iv", CRYPTO_IV)
    mode = str(_config_value("crypto_mode", CRYPTO_MODE)).upper()
    if isinstance(key, str):
        key = key.encode("utf-8")
    if isinstance(iv, str):
        iv = iv.encode("utf-8")
    if mode == "ECB":
        return AES.new(key, AES.MODE_ECB)
    if mode == "CBC":
        return AES.new(key, AES.MODE_CBC, iv=iv)
    raise ValueError(f"unsupported AES mode: {mode}")


def decrypt_body(ciphertext: bytes | str) -> bytes:
    """Decode Base64, decrypt AES, and remove PKCS7 padding."""
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad

    if isinstance(ciphertext, bytes):
        ciphertext = ciphertext.decode("utf-8", errors="strict")
    raw = base64.b64decode(ciphertext.strip())
    return unpad(_get_cipher().decrypt(raw), AES.block_size)


def encrypt_body(plaintext: bytes | str) -> str:
    """Apply PKCS7 padding, encrypt AES, and return Base64 text."""
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad

    if isinstance(plaintext, str):
        plaintext = plaintext.encode("utf-8")
    ciphertext = _get_cipher().encrypt(pad(plaintext, AES.block_size))
    return base64.b64encode(ciphertext).decode("ascii")


# Compatibility names used by older generated verification scripts.
aes_decrypt = decrypt_body
aes_encrypt = encrypt_body
