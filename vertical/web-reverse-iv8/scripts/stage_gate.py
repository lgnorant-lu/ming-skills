# /// script
# dependencies = []
# ///
"""
stage_gate.py — web-reverse-iv8 阶段门强制检查脚本

用法:
    uv run scripts/stage_gate.py --stage 2 --task-dir ./geetest-w
    uv run scripts/stage_gate.py --stage 3 --task-dir ./geetest-w

含义:
    --stage N    检查是否允许进入阶段 N(即检查阶段 N-1 产物是否齐全)
    --task-dir   任务产物目录(含 stage1-params.md / stage2-output.md / ...)

退出码:
    0  PASS   前置产物齐全,允许进入阶段 N
    1  BLOCK  前置产物缺失或字段不全,必须回退补齐
    2  ARGS   参数错误

输出:
    stdout: JSON {"status":"PASS|BLOCK","stage":N,"checked_file":"...","missing":[...],"action":"..."}
    stderr: 诊断信息(进度/警告)

设计原则:
    - 调用者只需知道命令和退出码含义,不需知道检查规则
    - 检查规则(哪个阶段查哪个文件+哪些字段)在脚本内部,修改不影响调用方
    - 字段搜索用 markdown heading + 关键词,不依赖模板精确格式

v9.11 修复:
    - Windows 编码鲁棒性(utf-8 → gb18030 → utf-8 with replace fallback)
    - ### 子标题不再打断 ## 父节内容扫描(同级 break 规则)
    - _has_real_content 清洗规则收窄(保留表格/bullet/复选框内容)
    - stdout 强制 UTF-8(避免 Windows GBK 输出 JSON 中文乱码)
    - 公开 check_stage API(原 _check_stage)
"""

import argparse
import datetime
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path


def _normalize_path(path_str: str) -> Path:
    """规范化路径,兼容 POSIX 风格(/e/...)与 Windows 风格(E:/...)。

    v9.6 新增:Git Bash 等环境传入 POSIX 风格路径时,自动转换为 Windows 路径。
    仅 Windows 平台生效,Linux/macOS 直接 resolve。

    Args:
        path_str: 原始路径字符串

    Returns:
        规范化后的 Path 对象(绝对路径)
    """
    if sys.platform == "win32" and re.match(r"^/([a-zA-Z])/", path_str):
        path_str = f"{path_str[1].upper()}:{path_str[2:]}"
    return Path(path_str).resolve()


def _record_gate_history(task_dir: Path, stage: int, result: "CheckResult") -> None:
    """记录 gate 运行历史到 .stage_gate_history.jsonl(v9.6 过程可信机制)。

    每次运行追加一条记录,用于前置 gate 校验(防止跳过 gate 先斩后奏)。

    Args:
        task_dir: 任务产物目录
        stage: gate 阶段号
        result: 检查结果
    """
    history_path = task_dir / ".stage_gate_history.jsonl"
    record = {
        "stage": stage,
        "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
        "status": result.status,
        "task_dir": str(task_dir),
    }
    with open(history_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _check_prior_gate_passed(task_dir: Path, stage: int) -> tuple[bool, str]:
    """检查前置 gate 是否已运行且 PASS(v9.6 过程可信机制)。

    进入 gate N 时,检查 gate N-1 是否已运行且 PASS。
    若无记录 → BLOCK(禁止跳过 gate 先斩后奏)。

    Args:
        task_dir: 任务产物目录
        stage: 当前要进入的 gate 阶段号

    Returns:
        (passed, message): passed=True 表示前置 gate 已通过;
        passed=False 时 message 含 BLOCK 原因
    """
    if stage <= 2:
        # gate 2 是第一个 gate,无前置
        return True, ""

    prior_stage = stage - 1
    history_path = task_dir / ".stage_gate_history.jsonl"
    if not history_path.exists():
        return False, (
            f"未运行 gate {prior_stage} 直接进入 gate {stage}。"
            f"禁止跳过 gate 先斩后奏(v9.6 过程可信机制):"
            f"必须先运行 `uv run scripts/stage_gate.py --stage {prior_stage} --task-dir {task_dir}` 并 PASS,"
            f"再进入 gate {stage}。"
        )

    # 扫描历史记录,查找前置 gate 的最后一条记录
    prior_record = None
    try:
        with open(history_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("stage") == prior_stage:
                    prior_record = rec  # 取最后一条
    except (OSError, UnicodeDecodeError):
        return False, f"读取 gate 历史记录失败: {history_path}"

    if prior_record is None:
        return False, (
            f"未运行 gate {prior_stage} 直接进入 gate {stage}。"
            f"禁止跳过 gate 先斩后奏(v9.6 过程可信机制):"
            f"必须先运行 `uv run scripts/stage_gate.py --stage {prior_stage} --task-dir {task_dir}` 并 PASS,"
            f"再进入 gate {stage}。"
        )

    if prior_record.get("status") != "PASS":
        return False, (
            f"前置 gate {prior_stage} 状态为 {prior_record.get('status')}(非 PASS),"
            f"不能进入 gate {stage}。"
            f"请先修复 gate {prior_stage} 的 BLOCK 原因并重跑至 PASS。"
        )

    return True, ""


@dataclass
class CheckResult:
    """单阶段检查结果。

    md_warnings: md 产物文件的软警告(字段缺失/占位符/文件缺失),不阻断流程。
    missing: 硬门阻断的缺失项(manifest schema 校验失败时填入)。
    """
    status: str  # "PASS" | "BLOCK"
    stage: int
    checked_file: str
    missing: list[str] = field(default_factory=list)
    action: str = ""
    md_warnings: list[str] = field(default_factory=list)


# ============================================================
# 阶段规则表(内部常量,不暴露)
# ============================================================
# 每个阶段进入前,需要检查的产物文件 + 必需字段(heading 或关键词)
# 字段匹配规则:在 markdown 中搜索 heading(## 字段名)或关键词(字段名出现且非占位符)
_STAGE_RULES: dict[int, dict] = {
    2: {
        "file": "stage1-params.md",
        "manifest": "stage1.json",
        "manifest_stage": 1,
        "required_fields": [
            "参数溯源表",
            "透传链路图",
            "_initiator.stack",
        ],
        "fallback_stage": 1,
    },
    3: {
        "file": "stage2-output.md",
        "manifest": "stage2.json",
        "manifest_stage": 2,
        "required_fields": [
            "动态 JS 判定",      # §0 动态 JS 判定(v9.4 新增)
            "加密点位",          # §2 加密点位定位结论
            "变换台账",          # §3 变换台账
            "入口函数",          # §4.1 入口函数(v9.4 新增)
            "环境依赖",          # §4.2 入口函数环境依赖清单(v9.4 新增)
            "入参个数完整性判定", # §4.3 入参个数完整性判定(v9.4 新增)
            "载体清晰度初判",    # §6 载体清晰度初判
        ],
        "fallback_stage": 2,
    },
    # v9.26 合并:原 key 4(检查 stage3-labels.md)+ 原 key 5(检查 stage4-scheme.md)合并。
    # stage4-scheme.md 已删除,其"分支选择"+"分支选择依据"字段并入 stage3-labels.md。
    4: {
        "file": "stage3-labels.md",
        "manifest": "stage3.json",
        "manifest_stage": 3,
        "required_fields": [
            "载体形态判定结论",
            "载体清晰度最终判定",
            "判定依据",
            "分支选择",          # v9.26 新增(原 stage4-scheme.md 字段)
            "分支选择依据",      # v9.26 新增
        ],
        "fallback_stage": 3,
    },
    # 阶段 4 自身的检查(进入"任务交付"前)
    # v9.24 扩展:stage5 现做"全产物核对",除主文件 stage5-verify.md 外,
    # 额外复核前序 3 个产物文件存在 + 各自 required_fields 非占位符。
    # 任一缺失/含占位符 → BLOCK,action 指明回到哪个阶段补齐。
    # v9.25 扩展:增加 conditional_fields — 当主文件含特定关键词时,额外检查指定字段。
    # 用于强制方案 2(iv8)场景记录"iv8 调试总轮次",避免无限循环。
    # v9.26:原 key 6 改为 key 5;fallback_stage 5→4;extra_files 删除 stage4-scheme.md 条目;
    #       stage3-labels.md 必需字段新增"分支选择"。
    5: {
        "file": "stage5-verify.md",
        "manifest": "stage5.json",
        "manifest_stage": 5,
        "required_fields": [
            "验证方式",
            "验证结果",
            "最终交付物",
        ],
        "fallback_stage": 4,
        "extra_files": [
            # (文件名, 必需字段列表, 回退阶段号) — 与 _STAGE_RULES[2-4] 对齐
            ("stage1-params.md", ["参数溯源表", "透传链路图", "_initiator.stack"], 1),
            ("stage2-output.md", ["动态 JS 判定", "加密点位", "变换台账", "入口函数", "环境依赖", "入参个数完整性判定", "载体清晰度初判"], 2),
            ("stage3-labels.md", ["载体形态判定结论", "载体清晰度最终判定", "分支选择"], 3),
        ],
        # v9.25:条件字段 — 主文件含关键词时额外检查的字段
        # 触发条件:stage5-verify.md 含"方案 2"或"iv8"→ 必须含"iv8 调试总轮次"
        "conditional_fields": [
            {
                "trigger_keywords": ["方案 2", "方案2", "iv8"],
                "required_fields": ["iv8 调试总轮次"],
                "reason": "方案 2(iv8 补环境)必须记录 iv8 调试总轮次(强制记录防无限循环,见 stage4.md §5.4.2)",
            },
        ],
    },
}

# 占位符模式:这些不算"字段已填写"
_PLACEHOLDER_PATTERNS = [
    r"<[^>]+>",           # <file>:<line> 等
    r"____*",             # ____ 填空线
    r"☐",                 # 未勾选的复选框
]

# 编码 fallback 链(内部常量,不暴露)
# 顺序:优先 utf-8(标准),失败则 gb18030(Windows 中文),再失败用 utf-8 + replace(不吞字符)
_ENCODING_FALLBACK = [
    ("utf-8", "strict"),
    ("gb18030", "strict"),
    ("utf-8", "replace"),
]


def _read_md_robust(path: Path) -> str:
    """鲁棒读取 markdown 文件,处理 Windows 编码 fallback。

    编码 fallback 链:utf-8(strict)→ gb18030(strict)→ utf-8(replace)。
    不用 errors="ignore"(会吞字符导致中文匹配失效),用 errors="replace"(用 � 替换,可识别)。

    Args:
        path: markdown 文件路径

    Returns:
        文件文本内容

    Raises:
        FileNotFoundError: 文件不存在
    """
    raw = path.read_bytes()
    for encoding, errors in _ENCODING_FALLBACK:
        try:
            return raw.decode(encoding, errors=errors)
        except (UnicodeDecodeError, LookupError):
            continue
    # 理论上不可达(最后一个 fallback 用 replace 不会抛 UnicodeDecodeError)
    return raw.decode("utf-8", errors="replace")


def _parse_heading_level(line: str) -> int:
    """解析 markdown ATX heading 的级别。

    Args:
        line: 单行文本

    Returns:
        heading 级别(1-6 对应 #-######),0 表示非 heading
    """
    match = re.match(r"^(#{1,6})\s", line)
    if match:
        return len(match.group(1))
    return 0


def _extract_section(lines: list[str], heading_idx: int, heading_level: int) -> str:
    """抽取指定 heading 的"内容段",包含其下属所有更低级别 heading 的内容。

    解决 v9.10 之前的问题:### 子标题不再打断 ## 父节的内容扫描。

    Break 规则:遇到**同级或更高级** heading 时停止(level <= current_level)。
    更低级 heading(如 ### 在 ## 之下)被包含进父节内容。

    Args:
        lines: 文件所有行
        heading_idx: 当前 heading 在 lines 中的索引
        heading_level: 当前 heading 的级别(1-6)

    Returns:
        该 heading 的内容段(含下属更低级 heading 的内容),不含当前 heading 行本身
    """
    section_lines = []
    for j in range(heading_idx + 1, len(lines)):
        next_level = _parse_heading_level(lines[j])
        if next_level > 0 and next_level <= heading_level:
            # 同级或更高级 heading → 父节内容结束
            break
        section_lines.append(lines[j])
    return "\n".join(section_lines)


def _is_placeholder(text: str) -> bool:
    """判断文本是否是占位符(如 <file>:<line> / ____ / ☐)。"""
    text = text.strip()
    if not text:
        return True
    for pattern in _PLACEHOLDER_PATTERNS:
        if re.search(pattern, text):
            return True
    return False


def _has_real_content(text: str, field_name: str) -> bool:
    """判断文本中是否有非占位符的实际内容(逐行判定)。

    v9.11 修复:清洗规则收窄。
    - 旧版:一刀切 `re.sub(r"[\\s\\|☐✓\\-—>*]", "", cleaned)` 吞表格分隔符、bullet、复选框 → 假阳性+假阴性
    - 新版:逐行清洗,只剔除纯空白和占位符,保留表格内容、bullet 内容、复选框内容

    判定规则:任一行去掉前后空白 + 移除字段名出现 + 移除占位符后,**含至少一个字母数字字符** → True

    Args:
        text: heading 下的内容段文本
        field_name: 字段名(从内容中移除以免自我匹配)

    Returns:
        True=有实际内容, False=仅占位符、空白或纯标点
    """
    for raw_line in text.splitlines():
        # 移除字段名本身(避免"加密点位"出现在内容里被误判为有内容)
        line = raw_line.replace(field_name, "")
        # 移除占位符
        for pattern in _PLACEHOLDER_PATTERNS:
            line = re.sub(pattern, "", line)
        # 移除行首 bullet/markdown 标记符号(仅行首,不吞表格分隔符)
        line = re.sub(r"^\s*[-*+]\s+", "", line)
        line = re.sub(r"^\s*\d+\.\s+", "", line)
        # 移除行首 checkbox 标记
        line = re.sub(r"^\s*\[[ xX]\]\s+", "", line)
        # 移除表格行首尾的 |(分隔符),但保留单元格内容
        line = re.sub(r"^\s*\|", "", line)
        line = re.sub(r"\|\s*$", "", line)
        # 移除纯分隔线行(如 |---|---| 或 ---)
        if re.match(r"^\s*[\|\-:]+\s*$", line):
            continue
        # 关键:清理后必须含至少一个字母数字字符(CJK 含字母类别)
        # 避免"加密点位: <file>:<line>"清理后剩 ": :" 被误判为有内容
        if any(ch.isalnum() for ch in line):
            return True
    return False


def _find_field_in_md(md_text: str, field_name: str) -> bool:
    """在 markdown 文本里搜字段是否存在且非占位符。

    匹配规则(任一命中即算字段存在):
    1. heading 含字段名(## 字段名 / ### 字段名)— heading 级别不限,但内容段扫描遵循同级 break 规则
    2. 字段名作为 key 出现且值非占位符(字段名: 实际值)

    Args:
        md_text: markdown 文本内容(已读入,不解耦文件 IO)
        field_name: 字段名(如"加密点位")

    Returns:
        True=字段存在且非占位符, False=字段缺失或仅占位符
    """
    lines = md_text.splitlines()

    # 规则 1: heading 含字段名(## 字段名 / ### 字段名)
    heading_pattern = rf"^#{{1,6}}\s*.*{re.escape(field_name)}.*$"
    for i, line in enumerate(lines):
        if re.match(heading_pattern, line):
            level = _parse_heading_level(line)
            section_text = _extract_section(lines, i, level)
            if _has_real_content(section_text, field_name):
                return True
            # 继续扫描下一个同名 heading(可能多个)
    # 所有同名 heading 都没实际内容 → 规则 1 失败,降级到规则 2

    # 规则 2: 字段名作为 key 出现且值非占位符
    key_pattern = rf"{re.escape(field_name)}[：:]\s*(.+)"
    for match in re.finditer(key_pattern, md_text):
        value = match.group(1).strip()
        if value and not _is_placeholder(value):
            return True

    return False


def _build_block_message(stage: int, missing: list[str], fallback_stage: int) -> str:
    """生成 BLOCK 时的回退指令。"""
    missing_str = "; ".join(missing)
    return (
        f"BLOCK: 阶段 {stage} 入口检查未通过。"
        f"缺失字段: {missing_str}。"
        f"必须回到阶段 {fallback_stage} 补齐产物文件,然后重新运行本检查。"
        f"禁止跳过本检查直接进入阶段 {stage}(违反 SKILL.md 阶段门阻断规则)。"
    )


def check_stage(task_dir: Path, stage: int) -> CheckResult:
    """检查指定阶段的入口前置条件(公开 API)。

    Args:
        task_dir: 任务产物目录
        stage: 要进入的阶段号(2/3/4/5)

    Returns:
        CheckResult:status=PASS 或 BLOCK
    """

    def _check_extra_files(extra_files: list) -> list[str]:
        """核对额外产物文件清单,返回缺失项列表(空列表 = 全部通过)。

        对每个 (filename, fields, fallback_stage) 元组:
        - 文件不存在 → 记录"文件 X 不存在"
        - 字段缺失或含占位符 → 记录"X 缺字段: Y, Z"
        """
        missing_items = []
        for filename, fields, fb_stage in extra_files:
            file_path = task_dir / filename
            if not file_path.exists():
                missing_items.append(f"{filename} 不存在(回阶段 {fb_stage} 补齐)")
                continue
            file_text = _read_md_robust(file_path)
            file_missing = [
                f for f in fields if not _find_field_in_md(file_text, f)
            ]
            if file_missing:
                missing_items.append(
                    f"{filename} 缺字段: {', '.join(file_missing)}(回阶段 {fb_stage} 补齐)"
                )
        return missing_items

    def _build_extra_block_message(missing: list[str]) -> str:
        """生成 stage5 全产物核对的 BLOCK 回退指令。"""
        missing_str = "\n   - ".join(missing)
        return (
            f"BLOCK: 阶段 {stage} 全产物核对未通过(任务完成前产物整理)。\n"
            f"   以下前序产物缺失或含占位符:\n   - {missing_str}\n"
            f"   必须回到对应阶段补齐产物文件,然后重新运行本检查。\n"
            f"   禁止跳过本检查直接交付(违反 SKILL.md '任务完成前产物整理')。"
        )

    def _check_conditional_fields(md_text: str, conditional_fields: list) -> list[str]:
        """检查条件字段:主文件含触发关键词时,额外检查指定字段是否存在且非占位符。

        对每个 conditional_field 规则:
        - 主文件含任一 trigger_keyword → 检查 required_fields 是否齐全
        - 字段缺失或含占位符 → 记录"缺条件字段: Y(触发原因: Z)"

        Args:
            md_text: 主文件文本内容
            conditional_fields: [{"trigger_keywords": [...], "required_fields": [...], "reason": "..."}]

        Returns:
            缺失项列表(空列表 = 全部通过或未触发)
        """
        missing_items = []
        for cond in conditional_fields:
            keywords = cond.get("trigger_keywords", [])
            # 主文件含任一触发关键词 → 激活条件检查
            if not any(kw in md_text for kw in keywords):
                continue
            # 检查条件字段是否齐全
            cond_missing = [
                f for f in cond.get("required_fields", [])
                if not _find_field_in_md(md_text, f)
            ]
            if cond_missing:
                reason = cond.get("reason", "")
                missing_items.append(
                    f"{checked_file} 缺条件字段: {', '.join(cond_missing)}"
                    f"({reason})"
                )
        return missing_items

    # ---- 主流程(编排) ----
    # v9.30 重构:md 检查全部降级为软警告(md_warnings),manifest schema 校验作为硬门(P0)。
    # 原因:md 字段匹配只查"字段名存在+非占位符",不查类型/枚举/条件联动,确定性弱。
    # manifest schema 校验(移植自 gpt check_delivery.py)提供强确定性,作为硬门。
    # md 检查保留是为了不破坏 8 模块散文里"写入 stage2-output.md §4"这类锚点引用的语义。
    #
    # v9.6 新增:过程可信机制 — 进入 gate N 前检查 gate N-1 是否已 PASS
    # 防止 agent 跳过 gate 先斩后奏(3/3 实战问卷复现的老问题 7)
    prior_passed, prior_msg = _check_prior_gate_passed(task_dir, stage)
    if not prior_passed:
        return CheckResult(
            status="BLOCK",
            stage=stage,
            checked_file="",
            missing=[prior_msg],
            action=prior_msg,
        )

    rule = _STAGE_RULES.get(stage)
    if rule is None:
        return CheckResult(
            status="BLOCK",
            stage=stage,
            checked_file="",
            missing=[f"未知阶段 {stage}(支持 2/3/4/5)"],
            action=f"阶段号 {stage} 不支持,请传 2/3/4/5 之一",
        )

    checked_file = rule["file"]
    required_fields = rule["required_fields"]
    fallback_stage = rule["fallback_stage"]
    md_warnings: list[str] = []

    md_path = task_dir / checked_file

    # 检查 1: 主文件存在(软警告,不阻断 — manifest 是硬门)
    if not md_path.exists():
        md_warnings.append(f"文件 {checked_file} 不存在(回阶段 {fallback_stage} 补齐)")
    else:
        # 检查 2: 主文件必需字段齐全(软警告)
        md_text = _read_md_robust(md_path)
        missing_fields = [
            field_name
            for field_name in required_fields
            if not _find_field_in_md(md_text, field_name)
        ]
        if missing_fields:
            md_warnings.append(
                f"{checked_file} 缺字段: {', '.join(missing_fields)}"
                f"(回阶段 {fallback_stage} 补齐)"
            )

        # 检查 3: 额外文件全产物核对(仅 stage 5,软警告)
        extra_files = rule.get("extra_files")
        if extra_files:
            extra_missing = _check_extra_files(extra_files)
            if extra_missing:
                md_warnings.extend(extra_missing)

        # 检查 4: 条件字段检查(仅 stage 5,软警告)
        conditional_fields = rule.get("conditional_fields")
        if conditional_fields:
            cond_missing = _check_conditional_fields(md_text, conditional_fields)
            if cond_missing:
                md_warnings.extend(cond_missing)

    # 检查 5: JSON manifest schema 校验(硬门,P0)
    # manifest 是 Agent 必填的并行产物,与 md 同阶段同字段语义,但强类型化+条件联动校验。
    # 注意:manifest_stage 是 manifest 自身的阶段号,与 gate 的 stage 不同。
    # gate 2/3/4 校验上一阶段产物(manifest_stage = stage-1),gate 5 校验 stage5 产物。
    manifest_name = rule["manifest"]
    manifest_stage = rule["manifest_stage"]
    manifest_path = task_dir / manifest_name
    if not manifest_path.exists():
        return CheckResult(
            status="BLOCK",
            stage=stage,
            checked_file=checked_file,
            missing=[f"文件 {manifest_name} 不存在"],
            md_warnings=md_warnings,
            action=(
                f"BLOCK: 阶段 {stage} 入口缺少 {manifest_name} manifest。"
                f"按 assets/templates/{manifest_name.replace('.json', '.manifest.json')} 模板创建后重跑。"
                f"manifest 是硬门(P0),缺失即阻断,与 md 是否齐全无关。"
            ),
        )

    # 导入放局部避免循环依赖与启动开销
    from schema_validator import validate_manifest
    schema_errors = validate_manifest(manifest_stage, manifest_path)
    if schema_errors:
        return CheckResult(
            status="BLOCK",
            stage=stage,
            checked_file=checked_file,
            missing=schema_errors,
            md_warnings=md_warnings,
            action=(
                f"BLOCK: 阶段 {stage} 入口 {manifest_name} schema 校验未通过:\n   - "
                + "\n   - ".join(schema_errors)
                + "\n按 schema_validator 规则修正后重跑。manifest 是硬门(P0)。"
            ),
        )

    return CheckResult(
        status="PASS",
        stage=stage,
        checked_file=checked_file,
        md_warnings=md_warnings,
    )


def _ensure_utf8_stdout() -> None:
    """强制 stdout/stderr 用 UTF-8 编码(解决 Windows 默认 GBK 输出 JSON 中文乱码)。

    Python 3.7+ 支持 sys.stdout.reconfigure。低版本无 reconfigure 方法时静默跳过(降级到默认编码)。
    """
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (TypeError, ValueError, OSError):
            # 重新配置失败时静默降级(不影响主流程)
            pass


def main() -> int:
    """命令行入口。

    解析参数 → 运行检查 → 输出 JSON → 返回退出码。
    """
    _ensure_utf8_stdout()

    parser = argparse.ArgumentParser(
        prog="stage_gate.py",
        description="web-reverse-iv8 阶段门强制检查。检查阶段 N-1 产物是否齐全,允许进入阶段 N。",
        epilog="示例: uv run scripts/stage_gate.py --stage 2 --task-dir ./geetest-w --record",
    )
    parser.add_argument(
        "--stage",
        type=int,
        required=True,
        choices=[2, 3, 4, 5],
        help="要进入的阶段号(2/3/4/5)。检查阶段 N-1 的产物。",
    )
    parser.add_argument(
        "--task-dir",
        type=str,
        required=True,
        help="任务产物目录路径(含 stage{N-1}-*.md 文件)。支持 POSIX(/e/...)和 Windows(E:/...)风格。",
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="v9.6 新增:记录本次运行到 .stage_gate_history.jsonl(过程可信机制,默认开启)。",
    )
    args = parser.parse_args()

    # v9.6:路径规范化(兼容 POSIX 风格)
    task_dir = _normalize_path(args.task_dir)
    if not task_dir.exists():
        print(
            json.dumps(
                {
                    "status": "BLOCK",
                    "stage": args.stage,
                    "checked_file": "",
                    "missing": [f"任务目录 {args.task_dir} 不存在(规范化后: {task_dir})"],
                    "action": f"任务目录 {args.task_dir} 不存在,请确认路径",
                },
                ensure_ascii=False,
            )
        )
        return 1

    result = check_stage(task_dir, args.stage)

    # v9.6:记录 gate 历史(过程可信机制)
    # --record 参数是为了向前兼容(不传也记录),实际总是记录
    _record_gate_history(task_dir, args.stage, result)

    output = {
        "status": result.status,
        "stage": result.stage,
        "checked_file": result.checked_file,
        "missing": result.missing,
        "action": result.action,
        "md_warnings": result.md_warnings,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))

    return 0 if result.status == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
