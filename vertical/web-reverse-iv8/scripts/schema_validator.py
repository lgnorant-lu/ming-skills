#!/usr/bin/env python3
# /// script
# dependencies = []
# ///
"""
schema_validator.py — web-reverse-iv8 manifest schema 校验器(深函数)

用法:
    from schema_validator import validate_manifest
    errors = validate_manifest(stage=5, manifest_path=Path("./task/stage5.json"))
    # errors 为空 = PASS,非空 = BLOCK(每条是一个错误说明)

    # 自检
    uv run scripts/schema_validator.py --self-test

设计:
    - 深函数:对外只暴露 validate_manifest(stage, manifest_path) -> list[str]
    - 内部吞掉全部 schema 定义、枚举集合、条件联动规则
    - 调用者只面对"传 stage + 路径,拿 errors",不需知道任何内部规则
    - 把 gpt 版 check_delivery.py 的条件规则引擎映射到 4 个阶段门
    - 纯标准库(json/re/pathlib),无新依赖
    - v9.5:失败关键词检测支持白名单/上下文感知(errorCode=0 不再误判)
    - v9.5:错误返回结构化字段(field_path/trigger_keyword/value_snippet/rule_source)
"""

from __future__ import annotations

import argparse
import copy
import inspect
import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any


# ============================================================
# schema 定义(内部常量,不暴露给调用者)
# ============================================================

# 每阶段 manifest 的顶层 key 集合(超出/缺失即报错)
STAGE_SCHEMAS: dict[int, set[str]] = {
    1: {"schema_version", "target", "evidence", "param_trace", "wasm", "fingerprint"},
    2: {"schema_version", "decision", "encryption_points", "transform_ledger",
        "carrier_clarity_initial", "boundaries"},
    3: {"schema_version", "decision", "carrier_clarity_final", "branch",
        "branch_reason", "webpack_features", "iife_closure"},
    5: {"schema_version", "decision", "risk_controls", "validation",
        "deliverables", "uncertainties"},
}

# 枚举集合
SHELL_KINDS = {"none", "ob", "eval-function", "mixed", "unknown"}
CARRIER_KINDS = {"native-js", "webpack", "worker", "wasm", "jsvmp", "mixed", "unknown"}
IMPLEMENTATION_KINDS = {"static-rewrite", "iv8", "blocked"}
VALIDATION_STATUSES = {"verified", "provisional", "blocked"}
VALIDATION_METHODS = {"exact", "invariants-semantic", "not-run"}
NETWORK_MODES = {"not-executed", "disabled", "allowlisted"}
BRANCH_KINDS = {"A", "B", "C", "D", "runtime"}
CLARITY_KINDS = {"clear", "partial", "unclear"}
PARAM_KINDS = {"fixed-constant", "js-generated", "passthrough", "user-input", "ring"}
MARKER_KINDS = {"jsvmp-boundary", "wasm-boundary", "worker-boundary",
                "deobfuscate-failed", "shell-boundary", "other"}
INTERFACE_TYPES = {"stateless-login", "session-bound-captcha", "async-callback"}
CAPTURE_KINDS = {"capture", "negative-control",
                 "capture-iv8", "capture-python", "capture-mixed"}
# 交叉一致性:sample.result 含这些关键词但 status=verified/provisional → 矛盾(假 PASS 风险)
FAILURE_RESULT_RE = re.compile(r"失败|不匹配|fail|mismatch|不对齐|错误|error", re.IGNORECASE)

# v9.5:失败关键词白名单(出现这些词不触发 BLOCK)
# 规则来源:errorCode=0 / errCode:"0" 是验证目标字段本身,非失败信号
FAILURE_KEYWORD_WHITELIST = {
    "errorcode", "errcode", "error_code", "errno",
    "errorlevel", "errormsg",  # 字段名,非失败描述
}

# v9.5:成功上下文窗口(关键词前后 N 字符内含这些模式 → 跳过匹配)
# 例:"返回 HTTP 200 + errorCode=0 + ticket=tr03" 中 errorCode=0 是成功信号
SUCCESS_CONTEXT_PATTERNS = [
    re.compile(r'=\s*0\b', re.IGNORECASE),           # =0 / = 0
    re.compile(r':\s*"0"\s*[,}\]]', re.IGNORECASE),  # :"0"
    re.compile(r":\s*'0'\s*[,}\]]", re.IGNORECASE),  # :'0'
    re.compile(r'success', re.IGNORECASE),           # success
    re.compile(r'成功', re.IGNORECASE),              # 成功
    re.compile(r'\bok\b', re.IGNORECASE),            # ok
]
SUCCESS_CONTEXT_WINDOW = 20  # 关键词前后各 20 字符扫描窗口

# 占位符正则(移植 gpt)
PLACEHOLDER_RE = re.compile(
    r"<[^>]+>|\bTODO\b|待填写|待补充|待定位|____", re.IGNORECASE
)


# ============================================================
# 深函数:对外唯一入口
# ============================================================

def validate_manifest(stage: int, manifest_path: Path) -> list[str]:
    """校验指定阶段的 manifest 文件,返回错误列表(空=PASS)。

    深函数原则:调用者只需传 stage + 路径,内部吞掉所有 schema 与条件规则。
    不抛异常,所有问题以错误字符串形式返回,供 stage_gate 转化为 BLOCK。

    Args:
        stage: 阶段号(1/2/3/5)
        manifest_path: manifest 文件路径

    Returns:
        错误列表,空列表表示 PASS
    """
    # ---------- 主流程(编排) ----------
    data, load_errors = _load_json(manifest_path)
    if load_errors:
        return load_errors

    errors: list[str] = []
    errors += _check_top_level(data, stage)
    errors += _check_target(data, stage)
    errors += _check_evidence(data, stage)
    errors += _check_fingerprint(data, stage)
    errors += _check_decision(data, stage)
    errors += _check_transform_ledger(data, stage)
    errors += _check_encryption_points(data, stage)
    errors += _check_carrier_clarity(data, stage)
    errors += _check_boundaries(data, stage)
    errors += _check_branch(data, stage)
    errors += _check_webpack_features(data, stage)
    errors += _check_iife_closure(data, stage)
    errors += _check_risk_controls(data, stage)
    errors += _check_validation(data, stage)
    errors += _check_deliverables(data, stage, manifest_path.parent)
    errors += _check_uncertainties(data, stage)
    placeholder_errors: list[str] = []
    _find_placeholders(data, "", placeholder_errors)
    errors += placeholder_errors
    return list(dict.fromkeys(errors))

    # ---------- 辅助函数(内部嵌套,仅本函数可见) ----------
    # 注:为保持文件可读性,辅助函数定义在模块级(下文),不嵌套在 validate_manifest 内。
    # 这是 Python 的实际限制:嵌套函数无法被 run_self_test 复用。
    # 编排与实现分离的原则通过"主函数只调度 + 辅助函数各管一域"实现。


# ============================================================
# 辅助函数(实现层,按职责拆分)
# ============================================================

def _load_json(path: Path) -> tuple[Any, list[str]]:
    """鲁棒读取 JSON 文件,返回 (data, errors)。"""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, [f"cannot read {path}: {exc}"]
    try:
        return json.loads(text), []
    except json.JSONDecodeError as exc:
        return None, [f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"]


def _get(data: Any, path: str, errors: list[str]) -> Any:
    """按点分路径取值,缺失即记错。"""
    current = data
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            errors.append(f"missing field: {path}")
            return None
        current = current[part]
    return current


def _nonempty(value: Any) -> bool:
    """字符串非空判定。"""
    return isinstance(value, str) and bool(value.strip())


def _require_nonempty(data: Any, path: str, errors: list[str]) -> Any:
    """取值并要求非空字符串。"""
    value = _get(data, path, errors)
    if value is not None and not _nonempty(value):
        errors.append(f"field must be a non-empty string: {path}")
    return value


def _require_choice(data: Any, path: str, choices: set[str], errors: list[str]) -> Any:
    """取值并要求在枚举集合内。"""
    value = _get(data, path, errors)
    if value is not None and value not in choices:
        errors.append(f"invalid {path}: {value!r}; expected one of {sorted(choices)}")
    return value


def _find_placeholders(value: Any, path: str, errors: list[str]) -> None:
    """递归扫描占位符(<...>/TODO/待填写/待补充/待定位/____)。"""
    if isinstance(value, dict):
        for key, item in value.items():
            _find_placeholders(item, f"{path}.{key}" if path else key, errors)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _find_placeholders(item, f"{path}[{index}]", errors)
    elif isinstance(value, str) and PLACEHOLDER_RE.search(value):
        errors.append(f"placeholder remains at {path}")


def _check_top_level(data: Any, stage: int) -> list[str]:
    """顶层 key 集合校验。"""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest root must be an object"]
    expected = STAGE_SCHEMAS.get(stage)
    if expected is None:
        return [f"unsupported stage {stage} (expected 1/2/3/5)"]
    missing = expected - set(data)
    extra = set(data) - expected
    if missing:
        errors.append(f"missing top-level keys: {sorted(missing)}")
    if extra:
        errors.append(f"unknown top-level keys: {sorted(extra)}")
    if data.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    return errors


def _check_target(data: Any, stage: int) -> list[str]:
    """target 字段校验(仅 stage1;stage5 不重复,授权已在 stage1 确认)。"""
    if stage != 1:
        return []
    errors: list[str] = []
    _require_nonempty(data, "target.parameter", errors)
    _require_nonempty(data, "target.request", errors)
    if _get(data, "target.authorization", errors) != "confirmed":
        errors.append("target.authorization must be 'confirmed'")
    return errors


def _check_evidence(data: Any, stage: int) -> list[str]:
    """evidence 字段校验(stage1)。"""
    if stage != 1:
        return []
    errors: list[str] = []
    inputs = _get(data, "evidence.inputs", errors)
    if not isinstance(inputs, list) or not inputs:
        errors.append("evidence.inputs must contain at least one source")
    else:
        for i, item in enumerate(inputs):
            if not isinstance(item, dict) or not _nonempty(item.get("source")):
                errors.append(f"evidence.inputs[{i}].source must be non-empty")

    stacks = _get(data, "evidence.initiator_stacks", errors)
    if not isinstance(stacks, list):
        errors.append("evidence.initiator_stacks must be a list")
    else:
        for i, item in enumerate(stacks):
            if not isinstance(item, dict):
                errors.append(f"evidence.initiator_stacks[{i}] must be an object")
                continue
            for key in ("parameter", "source", "location"):
                if not _nonempty(item.get(key)):
                    errors.append(
                        f"evidence.initiator_stacks[{i}].{key} must be non-empty"
                    )
    return errors


def _check_fingerprint(data: Any, stage: int) -> list[str]:
    """fingerprint 字段校验(stage1,v9.32 结构化)。

    v9.32 重构:fingerprint 从 `sources: []` 改为 `file_fingerprints` 数组,
    每条含 file + fields + evidence。空数组允许(无 trace 场景),但需在
    evidence 标注原因。
    """
    if stage != 1:
        return []
    errors: list[str] = []
    fp = _get(data, "fingerprint", errors)
    if not isinstance(fp, dict):
        errors.append("fingerprint must be an object")
        return errors

    # trace_source 非空字符串(trace 文件路径,无 trace 时填 "none")
    trace_src = fp.get("trace_source")
    if not isinstance(trace_src, str) or not trace_src.strip():
        errors.append("fingerprint.trace_source must be a non-empty string"
                      " (use 'none' if no trace)")

    # file_fingerprints 必须是数组(空数组允许)
    file_fps = fp.get("file_fingerprints")
    if not isinstance(file_fps, list):
        errors.append("fingerprint.file_fingerprints must be an array"
                      " (empty array allowed when no trace)")
        return errors

    # 空数组场景:evidence 不适用(整个 fingerprint 只有 trace_source="none")
    if not file_fps:
        return errors

    # 非空数组:逐条校验
    for i, item in enumerate(file_fps):
        if not isinstance(item, dict):
            errors.append(f"fingerprint.file_fingerprints[{i}] must be an object")
            continue
        if not _nonempty(item.get("file")):
            errors.append(
                f"fingerprint.file_fingerprints[{i}].file must be non-empty"
            )
        fields = item.get("fields")
        if not isinstance(fields, list):
            errors.append(
                f"fingerprint.file_fingerprints[{i}].fields must be an array"
            )
        elif not all(isinstance(f, str) and f.strip() for f in fields):
            errors.append(
                f"fingerprint.file_fingerprints[{i}].fields must contain"
                " non-empty strings"
            )
        if not _nonempty(item.get("evidence")):
            errors.append(
                f"fingerprint.file_fingerprints[{i}].evidence must be non-empty"
            )
    return errors


def _check_decision(data: Any, stage: int) -> list[str]:
    """decision 字段校验 + 条件联动(stage2 shell / stage3 carrier / stage5 implementation)。"""
    errors: list[str] = []

    if stage == 2:
        shell = _require_choice(data, "decision.shell.kind", SHELL_KINDS, errors)
        evidence = _get(data, "decision.shell.evidence", errors)
        if not isinstance(evidence, list):
            errors.append("decision.shell.evidence must be a list")
        elif shell not in {None, "none", "unknown"} and not evidence:
            errors.append(f"decision.shell.evidence is required for {shell}")
        elif any(not _nonempty(item) for item in evidence):
            errors.append("decision.shell.evidence entries must be non-empty strings")

    if stage == 3:
        carrier = _require_choice(data, "decision.carrier.kind", CARRIER_KINDS, errors)
        evidence = _get(data, "decision.carrier.evidence", errors)
        if not isinstance(evidence, list):
            errors.append("decision.carrier.evidence must be a list")
        elif carrier not in {None, "unknown"} and not evidence:
            errors.append(f"decision.carrier.evidence is required for {carrier}")
        elif any(not _nonempty(item) for item in evidence):
            errors.append("decision.carrier.evidence entries must be non-empty strings")

        whole = _get(data, "decision.whole_file_execution", errors)
        if not isinstance(whole, dict) or not isinstance(whole.get("used"), bool):
            errors.append("decision.whole_file_execution.used must be boolean")
        elif whole["used"] and not _nonempty(whole.get("reason")):
            errors.append("whole_file_execution.used=true requires a non-empty reason")

    if stage == 5:
        impl = _require_choice(
            data, "decision.implementation.kind", IMPLEMENTATION_KINDS, errors
        )
        _require_nonempty(data, "decision.implementation.reason", errors)
        return errors  # stage5 的进一步联动在 _check_validation/_check_risk_controls
    return errors


def _check_transform_ledger(data: Any, stage: int) -> list[str]:
    """变换台账校验(stage2,5 字段非空)。"""
    if stage != 2:
        return []
    errors: list[str] = []
    ledger = _get(data, "transform_ledger", errors)
    if not isinstance(ledger, list) or not ledger:
        errors.append("transform_ledger must contain at least one entry")
        return errors
    for i, item in enumerate(ledger):
        if not isinstance(item, dict):
            errors.append(f"transform_ledger[{i}] must be an object")
            continue
        for key in ("step", "invariants", "evidence", "carrier_observation", "clarity"):
            if not _nonempty(item.get(key)):
                errors.append(f"transform_ledger[{i}].{key} must be non-empty")
        if item.get("clarity") not in CLARITY_KINDS:
            errors.append(
                f"transform_ledger[{i}].clarity must be one of {sorted(CLARITY_KINDS)}"
            )
    return errors


def _check_encryption_points(data: Any, stage: int) -> list[str]:
    """加密点位校验(stage2,line/col 必须 int)。"""
    if stage != 2:
        return []
    errors: list[str] = []
    points = _get(data, "encryption_points", errors)
    if not isinstance(points, list) or not points:
        errors.append("encryption_points must contain at least one entry")
        return errors
    for i, item in enumerate(points):
        if not isinstance(item, dict):
            errors.append(f"encryption_points[{i}] must be an object")
            continue
        for key in ("parameter", "file", "functionName"):
            if not _nonempty(item.get(key)):
                errors.append(f"encryption_points[{i}].{key} must be non-empty")
        for key in ("line", "col"):
            val = item.get(key)
            if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                errors.append(f"encryption_points[{i}].{key} must be a non-negative int")
    return errors


def _check_carrier_clarity(data: Any, stage: int) -> list[str]:
    """载体清晰度校验(stage2 初判 / stage3 最终判定)。"""
    errors: list[str] = []
    if stage == 2:
        _require_choice(data, "carrier_clarity_initial", CLARITY_KINDS, errors)
    if stage == 3:
        _require_choice(data, "carrier_clarity_final", CLARITY_KINDS, errors)
    return errors


def _check_boundaries(data: Any, stage: int) -> list[str]:
    """边界标记校验(stage2)。"""
    if stage != 2:
        return []
    errors: list[str] = []
    bounds = _get(data, "boundaries", errors)
    if not isinstance(bounds, list):
        errors.append("boundaries must be a list")
        return errors
    for i, item in enumerate(bounds):
        if not isinstance(item, dict):
            errors.append(f"boundaries[{i}] must be an object")
            continue
        for key in ("call_site", "marker", "reason"):
            if not _nonempty(item.get(key)):
                errors.append(f"boundaries[{i}].{key} must be non-empty")
    return errors


def _check_branch(data: Any, stage: int) -> list[str]:
    """分支选择校验(stage3,carrier=unknown → branch=runtime 联动)。"""
    if stage != 3:
        return []
    errors: list[str] = []
    branch = _require_choice(data, "branch", BRANCH_KINDS, errors)
    _require_nonempty(data, "branch_reason", errors)
    carrier = _get(data, "decision.carrier.kind", errors)
    if carrier == "unknown" and branch not in (None, "runtime"):
        errors.append(
            f"carrier=unknown requires branch='runtime' (got {branch!r})"
        )
    return errors


def _check_webpack_features(data: Any, stage: int) -> list[str]:
    """Webpack 特征核对(stage3,carrier=webpack → webpack_features 必填)。"""
    if stage != 3:
        return []
    errors: list[str] = []
    carrier = _get(data, "decision.carrier.kind", errors)
    features = _get(data, "webpack_features", errors)
    if carrier == "webpack":
        if not isinstance(features, dict):
            errors.append(
                "webpack_features must be an object when carrier=webpack"
            )
            return errors
        for key in ("W1", "W2", "W3"):
            entry = features.get(key)
            if not isinstance(entry, dict):
                errors.append(f"webpack_features.{key} must be an object")
                continue
            if entry.get("hit") not in (True, False):
                errors.append(f"webpack_features.{key}.hit must be boolean")
            if not _nonempty(entry.get("evidence")):
                errors.append(f"webpack_features.{key}.evidence must be non-empty")
    return errors


def _check_iife_closure(data: Any, stage: int) -> list[str]:
    """IIFE 闭包单体例外校验(stage3,applies=true 时要求结构证据)。"""
    if stage != 3:
        return []
    errors: list[str] = []
    iife = _get(data, "iife_closure", errors)
    if not isinstance(iife, dict) or not isinstance(iife.get("applies"), bool):
        errors.append("iife_closure.applies must be boolean")
        return errors
    if iife["applies"]:
        for key in ("structure_type", "grep_evidence", "extractability"):
            if not _nonempty(iife.get(key)):
                errors.append(
                    f"iife_closure.{key} must be non-empty when applies=true"
                )
    return errors


def _check_risk_controls(data: Any, stage: int) -> list[str]:
    """风险控制校验(stage5,含 iv8→untrusted 联动 + attempts≥8→blocked 联动)。"""
    if stage != 5:
        return []
    errors: list[str] = []

    execution = _get(data, "risk_controls.execution", errors)
    if not isinstance(execution, dict):
        errors.append("risk_controls.execution must be an object")
        return errors

    ran_untrusted = execution.get("ran_untrusted_code")
    subprocess_used = execution.get("subprocess")
    network = execution.get("network")
    if not isinstance(ran_untrusted, bool):
        errors.append("risk_controls.execution.ran_untrusted_code must be boolean")
    if not isinstance(subprocess_used, bool):
        errors.append("risk_controls.execution.subprocess must be boolean")
    if network not in NETWORK_MODES:
        errors.append(f"invalid network mode: {network!r}")

    hosts = execution.get("allowed_hosts")
    if not isinstance(hosts, list):
        errors.append("risk_controls.execution.allowed_hosts must be a list")
    elif network == "allowlisted" and not hosts:
        errors.append("allowlisted network requires at least one host")
    elif network == "allowlisted" and not all(_nonempty(h) for h in hosts):
        errors.append("allowlisted network requires non-empty allowed_hosts")
    elif network != "allowlisted" and hosts:
        errors.append("allowed_hosts must be empty unless network is allowlisted")

    def _positive(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0

    if ran_untrusted:
        if not subprocess_used:
            errors.append("untrusted code must run in a subprocess")
        if network not in {"disabled", "allowlisted"}:
            errors.append("untrusted execution must declare disabled or allowlisted network")
        if not _positive(execution.get("time_limit_seconds")):
            errors.append("untrusted execution requires a positive time limit")
        if not _positive(execution.get("memory_limit_mb")):
            errors.append("untrusted execution requires a positive memory limit")

    iv8 = _get(data, "risk_controls.iv8", errors)
    if not isinstance(iv8, dict):
        errors.append("risk_controls.iv8 must be an object")
        return errors

    attempts = iv8.get("attempts")
    if not isinstance(attempts, int) or isinstance(attempts, bool) or attempts < 0:
        errors.append("risk_controls.iv8.attempts must be a non-negative integer")
    if iv8.get("same_failure_limit") != 3:
        errors.append("risk_controls.iv8.same_failure_limit must be 3")

    impl = _get(data, "decision.implementation.kind", errors)
    if impl == "iv8" and not ran_untrusted:
        errors.append("iv8 implementation must record untrusted-code execution controls")

    if isinstance(attempts, int) and attempts >= 8:
        if iv8.get("stop_reason") is None or not _nonempty(iv8.get("stop_reason")):
            errors.append("8+ iv8 attempts require a non-empty stop_reason")

    if _get(data, "risk_controls.secrets", errors) != "redacted":
        errors.append("risk_controls.secrets must be 'redacted'")
    return errors


def _check_validation(data: Any, stage: int) -> list[str]:
    """验证字段校验(stage5,verified↔samples↔method 联动 + 交叉一致性)。"""
    if stage != 5:
        return []
    errors: list[str] = []

    status = _require_choice(data, "validation.status", VALIDATION_STATUSES, errors)
    method = _require_choice(data, "validation.method", VALIDATION_METHODS, errors)
    _require_choice(data, "validation.interface_type", INTERFACE_TYPES, errors)
    _require_nonempty(data, "validation.result", errors)

    samples = _get(data, "validation.samples", errors)
    if not isinstance(samples, list):
        errors.append("validation.samples must be a list")
        samples = []
    else:
        for i, item in enumerate(samples):
            if not isinstance(item, dict):
                errors.append(f"validation.samples[{i}] must be an object")
                continue
            if not _nonempty(item.get("id")):
                errors.append(f"validation.samples[{i}].id must be non-empty")
            if item.get("kind") not in CAPTURE_KINDS:
                errors.append(
                    f"validation.samples[{i}].kind must be one of {sorted(CAPTURE_KINDS)}"
                )
            if not _nonempty(item.get("result")):
                errors.append(f"validation.samples[{i}].result must be non-empty")

    # captures 含所有 capture 变体(capture/capture-iv8/capture-python/capture-mixed)
    captures = [s for s in samples if isinstance(s, dict)
                and isinstance(s.get("kind"), str) and s["kind"].startswith("capture")]
    negatives = [
        s for s in samples if isinstance(s, dict) and s.get("kind") == "negative-control"
    ]
    impl = _get(data, "decision.implementation.kind", errors)

    if status == "verified":
        if impl == "blocked":
            errors.append("verified status requires an implementation")
        if method == "not-run":
            errors.append("verified status cannot use not-run")
        if len(captures) < 2:
            errors.append("verified status requires at least two capture samples")
        # v9.31:verified 时所有 capture 的 exact_match 必须为 true(无论 method)
        # 原规则只在 method=exact 时检查,导致 method=invariants-semantic 时
        # exact_match=false 也能 verified — 这是假 PASS 的来源
        if any(c.get("exact_match") is False for c in captures):
            errors.append(
                "verified status requires exact_match=true for every capture "
                "(found a capture with exact_match=false — possible false PASS)"
            )
        if method == "invariants-semantic":
            if not _nonempty(_get(data, "validation.counterexample", errors)):
                errors.append("invariants-semantic verification requires a counterexample")
            if not negatives:
                errors.append(
                    "invariants-semantic verification requires a negative-control sample"
                )
    elif status == "provisional":
        if impl == "blocked":
            errors.append("provisional status requires an implementation")
        if method == "not-run" or not captures:
            errors.append("provisional status requires at least one tested capture")
    elif status == "blocked":
        if impl != "blocked":
            errors.append("blocked validation requires blocked implementation")
        if method != "not-run":
            errors.append("blocked validation must use not-run")

    # v9.31 交叉一致性(假 PASS 防护,来源:腾讯防水墙问卷 §3.4)
    # v9.5 重构:失败关键词检测支持白名单/上下文感知 + 结构化报错
    # v9.6 修复:rule_source 行号动态化(inspect.currentframe),原硬编码 L617/L626 漂移
    # status=verified/provisional 但 sample.result 含失败关键词 → 内部矛盾
    if status in ("verified", "provisional"):
        for i, c in enumerate(captures):
            result = c.get("result", "")
            if not isinstance(result, str):
                continue
            hit = _detect_failure_keyword(result)
            if hit is not None:
                trigger_line = inspect.currentframe().f_lineno
                errors.append(
                    f"cross-consistency violation: validation.status={status} but "
                    f"samples[{i}].result contains failure keyword\n"
                    f"  field_path: validation.samples[{i}].result\n"
                    f"  trigger_keyword: {hit['keyword']!r}\n"
                    f"  value_snippet: {hit['snippet']!r}\n"
                    f"  rule_source: schema_validator.py:FAILURE_RESULT_RE L69 (触发于 L{trigger_line})\n"
                    f"  rules_yaml_anchor: schema-rules.yaml#stage5-validation-failure-keyword\n"
                    f"  suggestion: 移除失败关键词,或改用 '返回码'/'errCode' 等替代表述;"
                    f"若为成功语义(errorCode=0),确保含 '=0'/'success'/'成功' 等成功上下文\n"
                    f"  either fix the sample result or change status to blocked"
                )
        # verified 时 result 字段本身也不能含失败关键词
        top_result = _get(data, "validation.result", errors)
        if isinstance(top_result, str):
            hit = _detect_failure_keyword(top_result)
            if hit is not None:
                trigger_line = inspect.currentframe().f_lineno
                errors.append(
                    f"cross-consistency violation: validation.status={status} but "
                    f"validation.result contains failure keyword\n"
                    f"  field_path: validation.result\n"
                    f"  trigger_keyword: {hit['keyword']!r}\n"
                    f"  value_snippet: {hit['snippet']!r}\n"
                    f"  rule_source: schema_validator.py:FAILURE_RESULT_RE L69 (触发于 L{trigger_line})\n"
                    f"  rules_yaml_anchor: schema-rules.yaml#stage5-validation-failure-keyword\n"
                    f"  suggestion: 移除失败关键词,或改用 '返回码'/'errCode' 等替代表述;"
                    f"若为成功语义(errorCode=0),确保含 '=0'/'success'/'成功' 等成功上下文"
                )
    # blocked 但有 capture exact_match=true → 矛盾
    if status == "blocked" and any(c.get("exact_match") is True for c in captures):
        errors.append(
            "cross-consistency violation: status=blocked but a capture has "
            "exact_match=true — blocked status should have no passing capture"
        )
    return errors


def _check_deliverables(data: Any, stage: int, task_dir: Path) -> list[str]:
    """交付物校验(stage5,solution_path 路径穿越防护)。"""
    if stage != 5:
        return []
    errors: list[str] = []
    status = _get(data, "validation.status", errors)
    if status == "blocked":
        return errors

    solution_path = _get(data, "deliverables.solution_path", errors)
    command = _get(data, "deliverables.reproduction_command", errors)
    if not _nonempty(solution_path):
        errors.append("verified/provisional delivery requires solution_path")
        return errors
    relative = Path(solution_path)
    if relative.is_absolute():
        errors.append("solution_path must be task-relative")
        return errors
    root = task_dir.resolve()
    resolved = (root / relative).resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        errors.append("solution_path escapes the task directory")
        return errors
    if not resolved.is_file():
        errors.append(f"solution file does not exist: {solution_path}")
    if not _nonempty(command):
        errors.append("verified/provisional delivery requires reproduction_command")
    return errors


# ============================================================
# v9.5: 失败关键词检测(白名单 + 上下文感知)
# ============================================================

def _detect_failure_keyword(text: str) -> dict | None:
    """检测文本中是否含失败关键词(白名单 + 上下文感知)。

    深函数:内部吞掉白名单、上下文窗口、关键词匹配规则。
    调用者只需传文本,拿结构化命中信息(或 None)。

    判定逻辑(顺序短路):
        1. 用 FAILURE_RESULT_RE 找所有失败关键词匹配
        2. 对每个匹配:
           a. 提取匹配词本身(小写化)
           b. 若匹配词在 FAILURE_KEYWORD_WHITELIST → 跳过(字段名,非失败描述)
           c. 提取匹配位置前后 SUCCESS_CONTEXT_WINDOW 字符作为上下文窗口
           d. 若上下文窗口含任一 SUCCESS_CONTEXT_PATTERNS → 跳过(成功语义)
           e. 否则 → 命中,返回结构化信息

    Args:
        text: 待检测文本(通常是 validation.result 或 sample.result)

    Returns:
        None=未命中失败关键词
        dict=命中,含:
            - keyword: 触发关键词
            - snippet: 命中位置的上下文片段(前后各 20 字符)
            - position: 关键词在原文中的起始位置
    """
    if not isinstance(text, str) or not text:
        return None

    for match in FAILURE_RESULT_RE.finditer(text):
        keyword = match.group(0)
        keyword_lower = keyword.lower()

        # 规则 2a: 匹配后紧跟字母数字/下划线 → 是字段名的一部分(如 errorCode 中的 error) → 跳过
        # 来源:errorCode/errCode/errorCode 等字段名含 "error" 前缀,非失败描述
        end_pos = match.end()
        if end_pos < len(text) and (text[end_pos].isalnum() or text[end_pos] == "_"):
            continue

        # 规则 2b: 白名单跳过(errorCode/errCode 等是字段名,非失败描述)
        if keyword_lower in FAILURE_KEYWORD_WHITELIST:
            continue

        # 规则 2c: 提取上下文窗口
        start = max(0, match.start() - SUCCESS_CONTEXT_WINDOW)
        end = min(len(text), match.end() + SUCCESS_CONTEXT_WINDOW)
        window = text[start:end]

        # 规则 2d: 上下文含成功模式 → 跳过(如 "errorCode=0" 中 errorCode 后跟 =0)
        if any(p.search(window) for p in SUCCESS_CONTEXT_PATTERNS):
            continue

        # 规则 2e: 命中
        snippet = text[max(0, match.start() - 10):min(len(text), match.end() + 10)]
        return {
            "keyword": keyword,
            "snippet": snippet,
            "position": match.start(),
        }

    return None





def _check_uncertainties(data: Any, stage: int) -> list[str]:
    """uncertainties 校验(stage5,provisional/blocked 必填)。"""
    if stage != 5:
        return []
    errors: list[str] = []
    uncertainties = _get(data, "uncertainties", errors)
    if not isinstance(uncertainties, list):
        errors.append("uncertainties must be a list")
        return errors
    status = _get(data, "validation.status", errors)
    if status in ("provisional", "blocked") and not uncertainties:
        errors.append(f"{status} status requires at least one uncertainty")
    elif any(not _nonempty(u) for u in uncertainties):
        errors.append("uncertainties entries must be non-empty strings")
    return errors


# ============================================================
# 自检(移植 gpt run_self_test 模式)
# ============================================================

def _valid_stage1() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "target": {
            "parameter": "sign",
            "request": "POST https://example.test/api",
            "authorization": "confirmed",
        },
        "evidence": {
            "inputs": [{"source": "capture.har"}],
            "initiator_stacks": [
                {"parameter": "sign", "source": "capture.har", "location": "app.js:10:2"}
            ],
        },
        "param_trace": {
            "params": [
                {"name": "sign", "location": "body", "kind": "js-generated",
                 "upstream": "app.js#encrypt", "terminates": True}
            ],
            "passthrough_chain": "sign <- encrypt(uid, ts)",
            "ring_dependencies": [],
        },
        "wasm": {"present": False, "url": None},
        "fingerprint": {
            "trace_source": "trace.ndjson",
            "file_fingerprints": [
                {
                    "file": "tdc.js",
                    "fields": ["Navigator.userAgent", "Document.cookie"],
                    "evidence": "trace_analyzer.py filter --filename tdc.js",
                }
            ],
        },
    }


def _valid_stage2() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "decision": {
            "shell": {"kind": "ob", "evidence": ["_0x vars + string array observed"]}
        },
        "encryption_points": [
            {"parameter": "sign", "file": "app.js", "line": 10, "col": 2,
             "functionName": "encrypt"}
        ],
        "transform_ledger": [
            {"step": "string array restore", "invariants": "control flow",
             "evidence": "values match browser", "carrier_observation": "CFF",
             "clarity": "partial"}
        ],
        "carrier_clarity_initial": "partial",
        "boundaries": [
            {"call_site": "vm.run", "marker": "jsvmp-boundary", "reason": "5 features hit"}
        ],
    }


def _valid_stage3() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "decision": {
            "carrier": {"kind": "webpack", "evidence": ["module table + require fn"]},
            "whole_file_execution": {"used": False, "reason": None},
        },
        "carrier_clarity_final": "clear",
        "branch": "C",
        "branch_reason": "Webpack module with recoverable deps",
        "webpack_features": {
            "W1": {"hit": True, "evidence": "app.js:42 module table"},
            "W2": {"hit": True, "evidence": "app.js:50 require fn"},
            "W3": {"hit": True, "evidence": "app.js:60 IIFE three-part"},
        },
        "iife_closure": {"applies": False, "structure_type": None,
                         "grep_evidence": None, "extractability": None},
    }


def _valid_stage5() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "decision": {
            "implementation": {"kind": "static-rewrite", "reason": "Readable AES-CBC."}
        },
        "risk_controls": {
            "execution": {
                "ran_untrusted_code": False, "subprocess": False,
                "network": "not-executed", "allowed_hosts": [],
                "time_limit_seconds": None, "memory_limit_mb": None,
            },
            "iv8": {"attempts": 0, "same_failure_limit": 3, "stop_reason": None},
            "secrets": "redacted",
        },
        "validation": {
            "status": "verified", "method": "exact",
            "interface_type": "stateless-login",
            "samples": [
                {"id": "c1", "kind": "capture", "exact_match": True, "result": "match"},
                {"id": "c2", "kind": "capture", "exact_match": True, "result": "match"},
            ],
            "counterexample": None,
            "result": "Both captures match exactly.",
        },
        "deliverables": {"solution_path": "solution.py", "reproduction_command": "python solution.py"},
        "uncertainties": [],
    }


def run_self_test() -> None:
    """自检:构造合法/非法 manifest,assert PASS/BLOCK。"""
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        (root / "solution.py").write_text("print('ok')\n", encoding="utf-8")

        # 1. 合法 stage1/2/3/5 全 PASS
        assert validate_manifest(1, _write(root, "s1.json", _valid_stage1())) == []
        assert validate_manifest(2, _write(root, "s2.json", _valid_stage2())) == []
        assert validate_manifest(3, _write(root, "s3.json", _valid_stage3())) == []
        assert validate_manifest(5, _write(root, "s5.json", _valid_stage5())) == []

        # 2. verified 缺样本 → BLOCK
        one = copy.deepcopy(_valid_stage5())
        one["validation"]["samples"] = one["validation"]["samples"][:1]
        errs = validate_manifest(5, _write(root, "s5_one.json", one))
        assert any("two capture samples" in e for e in errs), errs

        # 3. iv8 缺 untrusted 控制件 → BLOCK
        iv8 = copy.deepcopy(_valid_stage5())
        iv8["decision"]["implementation"]["kind"] = "iv8"
        iv8["decision"]["implementation"]["reason"] = "JSVMP irreducible."
        iv8["validation"]["status"] = "provisional"
        iv8["validation"]["method"] = "invariants-semantic"
        iv8["validation"]["counterexample"] = "rejected"
        iv8["validation"]["samples"] = [
            {"id": "c1", "kind": "capture", "result": "struct ok"},
            {"id": "n1", "kind": "negative-control", "result": "fails differently"},
        ]
        iv8["uncertainties"] = ["single sample"]
        errs = validate_manifest(5, _write(root, "s5_iv8.json", iv8))
        assert any("untrusted-code execution controls" in e for e in errs), errs

        # 4. 路径穿越 → BLOCK
        escaped = copy.deepcopy(_valid_stage5())
        escaped["deliverables"]["solution_path"] = "../solution.py"
        errs = validate_manifest(5, _write(root, "s5_esc.json", escaped))
        assert any("escapes" in e for e in errs), errs

        # 5. 占位符残留 → BLOCK
        ph = copy.deepcopy(_valid_stage1())
        ph["target"]["parameter"] = "<param>"
        errs = validate_manifest(1, _write(root, "s1_ph.json", ph))
        assert any("placeholder remains" in e for e in errs), errs

        # 6. stage3 carrier=unknown 但 branch≠runtime → BLOCK
        unk = copy.deepcopy(_valid_stage3())
        unk["decision"]["carrier"]["kind"] = "unknown"
        unk["decision"]["carrier"]["evidence"] = []
        unk["branch"] = "C"
        errs = validate_manifest(3, _write(root, "s3_unk.json", unk))
        assert any("carrier=unknown requires branch='runtime'" in e for e in errs), errs

        # 7. stage3 carrier=webpack 但无 webpack_features → BLOCK
        no_wp = copy.deepcopy(_valid_stage3())
        no_wp["webpack_features"] = None
        errs = validate_manifest(3, _write(root, "s3_nowp.json", no_wp))
        assert any("webpack_features must be an object" in e for e in errs), errs

        # 8. stage5 iv8.attempts≥8 但 status≠blocked → BLOCK
        heavy = copy.deepcopy(_valid_stage5())
        heavy["risk_controls"]["iv8"]["attempts"] = 9
        errs = validate_manifest(5, _write(root, "s5_heavy.json", heavy))
        assert any("stop_reason" in e for e in errs), errs

        # 9. stage2 encryption_points.line 是字符串 → BLOCK
        bad_line = copy.deepcopy(_valid_stage2())
        bad_line["encryption_points"][0]["line"] = "10"
        errs = validate_manifest(2, _write(root, "s2_badline.json", bad_line))
        assert any("line must be a non-negative int" in e for e in errs), errs

        # 10. v9.31 假 PASS 防护:verified 但 sample.result 含"失败" → BLOCK
        false_pass = copy.deepcopy(_valid_stage5())
        false_pass["validation"]["samples"][0]["result"] = "collect 长度不匹配,失败"
        errs = validate_manifest(5, _write(root, "s5_falsepass.json", false_pass))
        assert any("cross-consistency violation" in e for e in errs), errs

        # 11. v9.31 缺 interface_type → BLOCK
        no_iface = copy.deepcopy(_valid_stage5())
        del no_iface["validation"]["interface_type"]
        errs = validate_manifest(5, _write(root, "s5_noiface.json", no_iface))
        assert any("interface_type" in e for e in errs), errs

        # 11.5 v9.32 stage1 fingerprint 用旧格式 sources(应 BLOCK)
        old_fp = copy.deepcopy(_valid_stage1())
        old_fp["fingerprint"] = {"sources": ["trace.ndjson"]}
        errs = validate_manifest(1, _write(root, "s1_oldfp.json", old_fp))
        assert any("trace_source must be" in e for e in errs), errs

        # 11.6 v9.32 stage1 file_fingerprints 缺 file 字段 → BLOCK
        bad_fp = copy.deepcopy(_valid_stage1())
        bad_fp["fingerprint"]["file_fingerprints"][0]["file"] = ""
        errs = validate_manifest(1, _write(root, "s1_badfp.json", bad_fp))
        assert any("file must be non-empty" in e for e in errs), errs

        # 11.7 v9.32 stage1 空数组 + trace_source="none" → PASS(无 trace 场景)
        no_trace = copy.deepcopy(_valid_stage1())
        no_trace["fingerprint"] = {"trace_source": "none", "file_fingerprints": []}
        errs = validate_manifest(1, _write(root, "s1_notrace.json", no_trace))
        assert errs == [], errs

        # 12. v9.31 verified 但 capture exact_match=false → BLOCK(假 PASS)
        bad_exact = copy.deepcopy(_valid_stage5())
        bad_exact["validation"]["samples"][0]["exact_match"] = False
        bad_exact["validation"]["samples"][0]["result"] = "value differs"
        errs = validate_manifest(5, _write(root, "s5_badexact.json", bad_exact))
        assert any("exact_match=false" in e for e in errs), errs

        # 13. v9.31 混合实现 capture kind 合法
        mixed = copy.deepcopy(_valid_stage5())
        mixed["decision"]["implementation"]["kind"] = "iv8"
        mixed["decision"]["implementation"]["reason"] = "JSVMP + Python mixed."
        mixed["risk_controls"]["execution"]["ran_untrusted_code"] = True
        mixed["risk_controls"]["execution"]["subprocess"] = True
        mixed["risk_controls"]["execution"]["network"] = "disabled"
        mixed["risk_controls"]["execution"]["time_limit_seconds"] = 60
        mixed["risk_controls"]["execution"]["memory_limit_mb"] = 512
        mixed["validation"]["samples"] = [
            {"id": "iv8-1", "kind": "capture-iv8", "exact_match": True, "result": "collect struct ok"},
            {"id": "py-1", "kind": "capture-python", "exact_match": True, "result": "pow_answer match"},
        ]
        errs = validate_manifest(5, _write(root, "s5_mixed.json", mixed))
        assert errs == [], f"mixed-impl valid manifest should PASS, got: {errs}"

        # 14. v9.5 白名单:errorCode=0 不再误判为失败关键词 → PASS
        #     来源:用户问卷反馈"errorCode 是验证目标字段本身,但出现在 result 描述里被判失败"
        whitelist_ok = copy.deepcopy(_valid_stage5())
        whitelist_ok["validation"]["result"] = "返回 HTTP 200 + errorCode=0 + ticket=tr03"
        whitelist_ok["validation"]["samples"] = [
            {"id": "c1", "kind": "capture", "exact_match": True, "result": "errorCode=0, success"},
            {"id": "c2", "kind": "capture", "exact_match": True, "result": "errorCode:0 ok"},
        ]
        errs = validate_manifest(5, _write(root, "s5_whitelist.json", whitelist_ok))
        assert errs == [], f"v9.5 白名单用例 errorCode=0 应 PASS, got: {errs}"

        # 15. v9.5 上下文感知:errorCode=1(失败语义)仍触发 BLOCK
        ctx_fail = copy.deepcopy(_valid_stage5())
        ctx_fail["validation"]["result"] = "返回 errorCode=1 失败"
        ctx_fail["validation"]["samples"] = [
            {"id": "c1", "kind": "capture", "exact_match": True, "result": "errorCode=1 fail"},
            {"id": "c2", "kind": "capture", "exact_match": True, "result": "errorCode=1 fail"},
        ]
        errs = validate_manifest(5, _write(root, "s5_ctxfail.json", ctx_fail))
        assert any("cross-consistency violation" in e for e in errs), \
            f"v9.5 上下文感知用例 errorCode=1 失败语义应 BLOCK, got: {errs}"

        # 16. v9.5 结构化报错:错误信息含 field_path/trigger_keyword/value_snippet/rule_source
        structured = copy.deepcopy(_valid_stage5())
        structured["validation"]["result"] = "collect 长度不匹配"
        structured["validation"]["samples"] = [
            {"id": "c1", "kind": "capture", "exact_match": True, "result": "match"},
            {"id": "c2", "kind": "capture", "exact_match": True, "result": "match"},
        ]
        errs = validate_manifest(5, _write(root, "s5_structured.json", structured))
        joined = "\n".join(errs)
        assert "field_path:" in joined, f"v9.5 结构化报错缺 field_path, got: {errs}"
        assert "trigger_keyword:" in joined, f"v9.5 结构化报错缺 trigger_keyword, got: {errs}"
        assert "value_snippet:" in joined, f"v9.5 结构化报错缺 value_snippet, got: {errs}"
        assert "rule_source:" in joined, f"v9.5 结构化报错缺 rule_source, got: {errs}"

        # 17. v9.5 _detect_failure_keyword 直接测试
        assert _detect_failure_keyword("errorCode=0 success") is None, \
            "v9.5 errorCode=0 + success 应被白名单/上下文跳过"
        assert _detect_failure_keyword("errorCode") is None, \
            "v9.5 errorCode 单独出现应被白名单跳过(字段名)"
        assert _detect_failure_keyword("collect 失败") is not None, \
            "v9.5 '失败' 应命中"
        hit = _detect_failure_keyword("collect 长度不匹配")
        assert hit is not None and hit["keyword"] == "不匹配", \
            f"v9.5 应返回结构化命中信息, got: {hit}"



def _write(root: Path, name: str, data: dict[str, Any]) -> Path:
    """写临时 manifest 文件,返回路径。"""
    path = root / name
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def _configure_utf8() -> None:
    """强制 stdout/stderr UTF-8(Windows GBK 兼容)。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    _configure_utf8()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="run self-test")
    parser.add_argument("--stage", type=int, choices=[1, 2, 3, 5], help="stage to validate")
    parser.add_argument("--manifest", type=Path, help="manifest file path")
    args = parser.parse_args()

    if args.self_test:
        run_self_test()
        print(json.dumps({"status": "PASS", "check": "self-test"}))
        return 0
    if args.stage is None or args.manifest is None:
        parser.error("--stage and --manifest are required unless --self-test is used")

    errors = validate_manifest(args.stage, args.manifest)
    output = {
        "status": "BLOCK" if errors else "PASS",
        "stage": args.stage,
        "manifest": str(args.manifest),
        "errors": errors,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
