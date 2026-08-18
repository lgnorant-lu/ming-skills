"""Automatic verification for signing and confirmed encryption baselines.

The preferred input is ``output/baselines/_metadata.json``. Each baseline can
contain structured request/signature fields or point at a raw HTTP request;
legacy plaintext/encrypted body files remain supported for encryption checks.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

_PATH = Path(__file__).resolve().parent
_BASELINE_DIR = _PATH / "baselines"
PENDING_EXIT = 2

# Compatibility hooks for an app-specific generated script. The normal path is
# automatic metadata/raw-request loading; do not fill these by hand by default.
TEST_CASES: list[tuple] = []
ENC_TEST_CASES: list[tuple] = []

_SIGNATURE_NAMES = (
    "sign",
    "signature",
    "x-signature",
    "x-ca-signature",
    "x-sign",
)
_TIMESTAMP_NAMES = (
    "timestamp",
    "requestsigntime",
    "request-sign-time",
    "x-timestamp",
    "x-request-timestamp",
)


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (FileNotFoundError, OSError, UnicodeDecodeError):
        return None


def _read_ref(value, base: Path) -> str | None:
    if not isinstance(value, str):
        return value
    candidate = base / value
    if candidate.is_file():
        return _read_text(candidate)
    return value


def _first_file(baseline_id: str, suffixes: tuple[str, ...]) -> str | None:
    for suffix in suffixes:
        content = _read_text(_BASELINE_DIR / f"{baseline_id}{suffix}")
        if content is not None:
            return content
    return None


def _header_value(headers: dict, name: str | None) -> str | None:
    if not name:
        return None
    wanted = name.casefold()
    for key, value in headers.items():
        if str(key).casefold() == wanted:
            return str(value)
    return None


def _first_header(headers: dict, names: tuple[str, ...]) -> tuple[str, str] | None:
    for name in names:
        value = _header_value(headers, name)
        if value is not None and value != "":
            return name, value
    return None


def _parse_raw_request(raw: str) -> dict:
    separator = "\r\n\r\n" if "\r\n\r\n" in raw else "\n\n"
    header_text, body = (raw.split(separator, 1) + [""])[:2] if separator in raw else (raw, "")
    lines = header_text.splitlines()
    parsed = {"method": "", "url": "", "headers": {}, "body": body}
    if lines:
        first = lines[0].split()
        if len(first) >= 2:
            parsed["method"] = first[0].upper()
            parsed["url"] = first[1]
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parsed["headers"][key.strip()] = value.strip()
    return parsed


def _as_dict(value):
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return None
        return dict(parsed) if isinstance(parsed, dict) else None
    return None


def _body_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _payload_data(method: str, url: str, body) -> dict:
    from sign_core import extract_data

    body_text = _body_text(body)
    try:
        return extract_data(method, url, body_text.encode("utf-8"))
    except (TypeError, ValueError, UnicodeError):
        return {}


def _payload_value(payload: dict, names: tuple[str, ...], explicit: str | None = None):
    candidates = (explicit,) if explicit else names
    folded = {str(name).casefold() for name in candidates if name}
    for key, value in payload.items():
        if str(key).casefold() in folded and value not in (None, ""):
            return str(value), str(key)
    return None, None


def _signature_value(
    entry: dict,
    headers: dict,
    metadata: dict,
    payload: dict,
) -> tuple[str | None, str | None]:
    explicit = entry.get("signature_header") or metadata.get("signature_header")
    value = entry.get("signature")
    if isinstance(value, dict):
        explicit = explicit or value.get("header")
        value = value.get("value")
    value = value or entry.get("expected_signature") or entry.get("expected_sign")
    value = value or metadata.get("signature")
    if isinstance(value, dict):
        explicit = explicit or value.get("header")
        value = value.get("value")
    if value is not None:
        return str(value), explicit
    if explicit:
        value = _header_value(headers, str(explicit))
        if value is not None:
            return value, str(explicit)
        value, field = _payload_value(payload, (), str(entry.get("signature_field") or metadata.get("signature_field") or explicit))
        return value, field or str(explicit)
    found = _first_header(headers, _SIGNATURE_NAMES)
    if found:
        return found[1], found[0]
    return _payload_value(
        payload,
        _SIGNATURE_NAMES,
        entry.get("signature_field") or metadata.get("signature_field"),
    )


def _timestamp_value(
    entry: dict,
    headers: dict,
    metadata: dict,
    payload: dict,
) -> tuple[int | None, str | None]:
    explicit = entry.get("timestamp_header") or metadata.get("timestamp_header")
    value = entry.get("timestamp") or entry.get("sign_timestamp")
    if isinstance(value, dict):
        explicit = explicit or value.get("header")
        value = value.get("value")
    if value is None and explicit:
        value = _header_value(headers, str(explicit))
    if value is None:
        found = _first_header(headers, _TIMESTAMP_NAMES)
        if found:
            explicit, value = found
    if value is None:
        value, field = _payload_value(
            payload,
            _TIMESTAMP_NAMES,
            entry.get("timestamp_field") or metadata.get("timestamp_field"),
        )
        explicit = explicit or field
    if value is None:
        return None, explicit
    try:
        return int(str(value).strip()), explicit
    except (TypeError, ValueError):
        return None, explicit


def _extract_sign_data(entry: dict, method: str, url: str, body: str) -> dict | None:
    explicit = _as_dict(entry.get("sign_data"))
    if explicit is not None:
        return explicit

    from sign_core import extract_data

    extracted = extract_data(method, url, body.encode("utf-8"))
    if not extracted:
        return None

    excluded = entry.get("exclude_fields", [])
    if isinstance(excluded, str):
        excluded = [excluded]
    excluded_folded = {str(item).casefold() for item in excluded}
    signature = entry.get("signature")
    if isinstance(signature, dict):
        signature = signature.get("value")
    for key in list(extracted):
        if str(key).casefold() in excluded_folded:
            del extracted[key]
        elif str(key).casefold() in {"sign", "signature"}:
            del extracted[key]
    return extracted or None


def _load_signature_cases() -> tuple[list[tuple], list[str], bool]:
    if not _BASELINE_DIR.is_dir():
        return list(TEST_CASES), ["output/baselines 目录不存在"], False

    metadata_path = _BASELINE_DIR / "_metadata.json"
    if not metadata_path.is_file():
        return list(TEST_CASES), ["缺少 output/baselines/_metadata.json"], False

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [], [f"无法读取 metadata: {type(exc).__name__}: {exc}"], False

    signing_marker = metadata.get("signing", "unknown")
    if signing_marker in (False, "false", "none", "N/A", "na"):
        return [], [], True

    entries = metadata.get("baselines", [])
    if isinstance(entries, dict):
        entries = [entries]
    cases = list(TEST_CASES)
    issues = []

    for index, entry in enumerate(entries, 1):
        if not isinstance(entry, dict):
            issues.append(f"baselines[{index}] 不是对象")
            continue
        baseline_id = str(entry.get("id", f"{index:03d}"))
        request = entry.get("request") if isinstance(entry.get("request"), dict) else {}
        raw = _read_ref(entry.get("raw_request"), _BASELINE_DIR)
        if raw is None:
            raw = _first_file(baseline_id, ("_request.txt", "_req_raw.txt", "_raw_request.txt"))
        parsed_raw = _parse_raw_request(raw) if raw else {}

        method = str(entry.get("method") or request.get("method") or parsed_raw.get("method") or "").upper()
        url = str(entry.get("url") or request.get("url") or parsed_raw.get("url") or entry.get("path") or "")
        headers = {}
        headers.update(parsed_raw.get("headers", {}))
        headers.update(request.get("headers", {}))
        headers.update(entry.get("headers", {}))

        body_value = entry.get("body", request.get("body"))
        body = _read_ref(body_value, _BASELINE_DIR) if body_value is not None else None
        plaintext_body = _first_file(baseline_id, ("_req_plaintext.txt",))
        if body is None:
            body = plaintext_body
        if body is None:
            body = parsed_raw.get("body", "")
        if body is None:
            body = _first_file(baseline_id, ("_req_encrypted.txt",)) or ""

        sign_data_body = plaintext_body if plaintext_body is not None else body
        payload = _payload_data(method, url, sign_data_body)
        signature, signature_header = _signature_value(entry, headers, metadata, payload)
        timestamp, timestamp_header = _timestamp_value(entry, headers, metadata, payload)
        sign_data = _extract_sign_data(entry, method, url, _body_text(sign_data_body))

        missing = []
        if not method:
            missing.append("method")
        if not url:
            missing.append("url/path")
        if signature is None:
            missing.append("signature")
        if timestamp is None:
            missing.append("timestamp")
        if sign_data is None:
            missing.append("sign_data")
        if missing:
            issues.append(f"{baseline_id} 缺少 {', '.join(missing)}")
            continue

        cases.append(
            (
                entry.get("description", baseline_id),
                sign_data,
                timestamp,
                signature,
                signature_header,
                timestamp_header,
            )
        )

    return cases, issues, False


def run_tests() -> str:
    cases, issues, explicitly_no_signing = _load_signature_cases()
    if explicitly_no_signing:
        print("签名验证: N/A（metadata 明确标记 signing=false）")
        return "na"
    if issues:
        for issue in issues:
            print(f"签名基线待补充: {issue}")
    if not cases:
        print("签名验证: PENDING（没有足够的自动基线字段）")
        return "pending"

    from sign_core import compute_sign

    failed = 0
    pending = bool(issues)
    for index, case in enumerate(cases, 1):
        if len(case) == 4:
            description, data, timestamp, expected = case
            signature_header = timestamp_header = None
        else:
            description, data, timestamp, expected, signature_header, timestamp_header = case
        computed, used_timestamp = compute_sign(data, timestamp)
        ok = computed == str(expected)
        print(f"签名测试 {index} ({description}): {'PASS' if ok else 'FAIL'}")
        print(f"  timestamp={used_timestamp} expected={expected} computed={computed}")
        if signature_header:
            print(f"  signature_header={signature_header}")
        if timestamp_header:
            print(f"  timestamp_header={timestamp_header}")
        if not ok:
            failed += 1

    if failed:
        return "fail"
    return "pending" if pending else "pass"


def _load_baseline_enc_tests() -> list[tuple]:
    if not _BASELINE_DIR.is_dir():
        return []
    metadata_path = _BASELINE_DIR / "_metadata.json"
    if not metadata_path.is_file():
        return []
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    cases = list(ENC_TEST_CASES)
    for entry in metadata.get("baselines", []):
        if not isinstance(entry, dict):
            continue
        baseline_id = str(entry.get("id", ""))
        description = entry.get("description", baseline_id)
        req_ct = _first_file(baseline_id, ("_req_encrypted.txt",))
        req_pt = _first_file(baseline_id, ("_req_plaintext.txt",))
        resp_ct = _first_file(baseline_id, ("_resp_encrypted.txt",))
        resp_pt = _first_file(baseline_id, ("_resp_plaintext.txt",))
        if req_ct and req_pt:
            cases.append((f"{description} - request decrypt", req_ct.strip(), req_pt))
        if resp_ct and resp_pt:
            cases.append((f"{description} - response decrypt", resp_ct.strip(), resp_pt))
    return cases


def run_enc_tests() -> str:
    cases = _load_baseline_enc_tests()
    if not cases:
        print("加密验证: N/A（没有加密基线）")
        return "na"

    try:
        from sign_core import decrypt_body
    except ImportError as exc:
        print(f"加密验证: FAIL（无法导入 decrypt_body: {exc}）")
        return "fail"

    failed = 0
    for index, (description, ciphertext, expected_plaintext) in enumerate(cases, 1):
        try:
            result = decrypt_body(ciphertext)
            if isinstance(result, bytes):
                result = result.decode("utf-8")
            ok = result == expected_plaintext
            detail = result[:200]
        except Exception as exc:
            ok = False
            detail = f"{type(exc).__name__}: {exc}"
        print(f"加密测试 {index} ({description}): {'PASS' if ok else 'FAIL'}")
        print(f"  decrypted={detail[:200]}")
        if not ok:
            failed += 1
    return "fail" if failed else "pass"


if __name__ == "__main__":
    signature_status = run_tests()
    encryption_status = run_enc_tests()
    if "fail" in (signature_status, encryption_status):
        sys.exit(1)
    if signature_status == "pending":
        sys.exit(PENDING_EXIT)
    sys.exit(0)
