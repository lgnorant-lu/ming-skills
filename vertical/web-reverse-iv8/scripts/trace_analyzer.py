# /// script
# dependencies = []
# ///
"""trace NDJSON 分析工具(深函数版)。

处理几百 MB 的浏览器运行时 trace 文件,提供两大能力:
  1. 按文件过滤输出 trace 调用记录(默认模式,iv8 补环境的核心输入)
  2. stats 聚合统计(trace 完整性校验用)

设计哲学:
  - 深函数:对外只暴露 main(trace_path, command, *args) -> int
  - 调用者只需知道 "传 trace 文件 + 命令",内部吞掉所有解析/过滤/聚合细节
  - 输出格式固定:JSON(默认模式)或文本表格(stats 模式)
  - 零依赖(纯标准库),不引入 iv8 依赖

用法:
    # 默认模式:按文件过滤输出(iv8 补环境核心输入)
    uv run scripts/trace_analyzer.py <trace> [--filename <js>] [--type <t>] \\
        [--interface <iface>] [--member <mem>] [--output <file>]

    # 按入口函数调用栈过滤(v9.4 新增:阶段二 §2.4 环境依赖分析)
    uv run scripts/trace_analyzer.py <trace> --stack-func <函数名>

    # stats 模式:聚合统计(trace 完整性校验)
    uv run scripts/trace_analyzer.py <trace> stats

输出说明:
    - 默认模式输出 JSON:{"<script>": [{"op", "value", "seq", "type"}, ...]}
    - stats 模式输出文本表格:interface.member 频次降序

    type 字段取自 trace 事件原始 type(get/set/call/construct/typeof/
    instanceof/timer/console),不做语义推断。iv8 补环境根据 type 决定
    补全方式:
      - get/set  → iv8 environment 字段设值
      - call     → iv8 hook 方法返回值
      - construct → iv8 模拟构造器
      - typeof/instanceof → iv8 environment 字段类型匹配
"""

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse


# ============================================================
# 深函数:对外唯一入口
# ============================================================

def main(trace_path, command=None, *args):
    """主入口:仅编排子命令分发,不含业务逻辑。

    调用者不需要知道:子命令参数校验、trace 解析格式、输出序列化方式。
    可能变化:未来新增子命令只需在 _COMMANDS 注册,不影响分发逻辑。
    复杂度藏在内部:_iter_events 的流式读取、_extract_script_name 的 URL 解析、
                   _get_op_value 的 type 分发,调用者无需感知。

    Args:
        trace_path: trace NDJSON 文件路径
        command: 子命令(None=默认过滤模式,"stats"=聚合统计)
        *args: 子命令额外参数

    Returns:
        int: 命中记录数(0 表示无匹配,非 0 表示有结果)
    """
    # ---------- 主流程(编排) ----------
    if command is None or command == "filter":
        return _run_filter_mode(trace_path, args)
    if command == "stats":
        return _run_stats_mode(trace_path, args)
    raise ValueError(
        f"未知命令: {command!r}, 可用命令: filter(默认) | stats"
    )


# ============================================================
# 实现层:子命令各自独立
# ============================================================

def _run_filter_mode(trace_path, args):
    """默认过滤模式:按文件/类型/interface/member 过滤,输出 JSON。

    深函数原则:调用者(命令行/库)只传 trace 路径 + 可选过滤条件,
    内部吞掉 argparse 解析、事件流式读取、脚本名提取、op/type 分发、
    JSON 序列化等全部细节。

    Args:
        trace_path: trace NDJSON 文件路径
        args: 命令行参数列表(传给 _parse_filter_args)

    Returns:
        int: 命中记录总数
    """
    # ---------- 主流程(编排) ----------
    fargs = _parse_filter_args(args)
    result = defaultdict(list)
    total, filtered = _collect_filtered_events(trace_path, fargs, result)
    _emit_filter_output(result, fargs)
    print(f"\nTotal events: {total}, matched: {filtered}", file=sys.stderr)
    print(f"Unique scripts: {len(result)}", file=sys.stderr)
    return filtered


def _parse_filter_args(raw_args):
    """解析过滤模式参数(argparse,内部细节,调用者无需感知)。"""
    parser = argparse.ArgumentParser(prog="trace_analyzer filter", add_help=False)
    parser.add_argument("input", help="Path to trace ndjson file")
    parser.add_argument(
        "-f", "--filename", default="all",
        help="Filter by script filename (e.g. 'tdc.js'), or 'all'",
    )
    parser.add_argument(
        "-t", "--type",
        choices=["get", "set", "call", "typeof", "construct",
                 "instanceof", "timer", "console", "all"],
        default="all",
        help="Filter by event type",
    )
    parser.add_argument(
        "-i", "--interface",
        help="Filter by interface name (e.g. 'Window', 'Document')",
    )
    parser.add_argument(
        "-m", "--member",
        help="Filter by member name (e.g. 'get document', 'set')",
    )
    parser.add_argument(
        "--stack-func",
        help="Filter by function name in stack (e.g. 'getSign'). "
             "Returns events whose stack contains the function (跨文件覆盖). "
             "v9.4 新增:用于阶段二 §2.4 环境依赖分析",
    )
    parser.add_argument(
        "-o", "--output",
        help="Output to file instead of stdout",
    )
    return parser.parse_args(list(raw_args) if raw_args else [])


def _collect_filtered_events(trace_path, fargs, result):
    """流式读取 trace,按条件过滤,聚合到 result(按脚本名分组)。

    Args:
        trace_path: trace 文件路径
        fargs: 解析后的过滤参数
        result: 输出容器(defaultdict(list),key=脚本名)

    Returns:
        (total, filtered): 总事件数, 命中事件数
    """
    total = 0
    filtered = 0
    for ev in _iter_events(trace_path):
        total += 1
        if ev.get("type") == "trace_init":
            continue

        if not _match_filters(ev, fargs):
            continue

        op, value = _get_op_value(ev)
        seq = ev.get("seq")
        ev_type = ev.get("type", "")
        scripts = _get_stack_scripts(ev.get("stack"))

        if fargs.filename == "all":
            relevant = scripts
        else:
            relevant = {s for s in scripts
                        if fargs.filename.lower() in s.lower()}

        if not relevant:
            continue

        entry = {"op": op, "value": value, "seq": seq, "type": ev_type}
        for script in relevant:
            result[script].append(entry)
        filtered += 1

    return total, filtered


def _match_filters(ev, fargs):
    """判定事件是否匹配 type/interface/member/stack-func 过滤条件。"""
    if fargs.type != "all" and ev.get("type") != fargs.type:
        return False
    if fargs.interface and ev.get("interface") != fargs.interface:
        return False
    if fargs.member and ev.get("member") != fargs.member:
        return False
    if fargs.stack_func and not _stack_contains_func(ev.get("stack"), fargs.stack_func):
        return False
    return True


def _stack_contains_func(stack, func_name):
    """判定 stack 中是否含指定函数名(支持跨文件调用链)。

    Args:
        stack: trace 事件的 stack 字段(list[dict] 或 None)
        func_name: 目标函数名(大小写敏感,完全匹配)

    Returns:
        bool: stack 中任一 frame 的 functionName 等于 func_name 即 True
    """
    if not stack or not func_name:
        return False
    func_lower = func_name.lower()
    for frame in stack:
        # 兼容多种字段名:functionName / function / name
        fname = (frame.get("functionName")
                 or frame.get("function")
                 or frame.get("name")
                 or "")
        if fname and fname.lower() == func_lower:
            return True
    return False


def _emit_filter_output(result, fargs):
    """输出过滤结果(JSON 格式)。"""
    if not result:
        print("No matching events found.", file=sys.stderr)
        return

    output = json.dumps(dict(result), indent=2, ensure_ascii=False)
    if fargs.output:
        with open(fargs.output, "w", encoding="utf-8") as fo:
            fo.write(output)
            fo.write("\n")
        print(f"Output written to {fargs.output}", file=sys.stderr)
    else:
        print(output)


def _run_stats_mode(trace_path, args):
    """stats 模式:聚合统计 interface.member 频次,输出文本表格。

    用于阶段一 trace 完整性校验:判断 trace 是否覆盖了加密时刻的 API 调用。
    输出格式固定:频次降序的文本表格 + 汇总行。

    Args:
        trace_path: trace NDJSON 文件路径
        args: 额外参数(忽略)

    Returns:
        int: 不同 API 数量
    """
    counter = Counter()
    for ev in _iter_events(trace_path):
        if ev.get("type") == "trace_init":
            continue
        key = _build_stats_key(ev)
        if key:
            counter[key] += 1

    _print_stats(counter)
    return len(counter)


def _print_stats(counter):
    """格式化输出 stats 频次表。"""
    print("=== 聚合统计 (interface.member 频次) ===")
    print(f"{'频次':>8}  interface.member")
    print("-" * 60)
    for key, count in counter.most_common():
        print(f"{count:>8}  {key}")
    print("-" * 60)
    print(f"共 {len(counter)} 个不同 API, {sum(counter.values())} 次调用")


def _build_stats_key(ev):
    """由 interface 与 member 拼接统计键。"""
    interface = ev.get("interface", "") or ""
    member = ev.get("member", "") or ""
    if not interface and not member:
        return ""
    return f"{interface}.{member}"


# ============================================================
# 实现层:trace 事件解析(共用)
# ============================================================

def _iter_events(path):
    """流式逐行读取 NDJSON,yield 解析后的 dict。

    大文件不一次性加载,按行 yield。解析失败的行输出警告并跳过,不中断流。

    Args:
        path: trace NDJSON 文件路径

    Yields:
        dict: 解析后的 trace 事件
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"trace 文件不存在: {path}")

    with file_path.open("r", encoding="utf-8", errors="replace") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as e:
                print(
                    f"[警告] 第 {line_no} 行 JSON 解析失败, 已跳过: {e}",
                    file=sys.stderr,
                )
                continue
            record["_line_no"] = line_no
            yield record


def _extract_script_name(file_url):
    """从 stack frame 的 file URL 提取脚本 basename。

    例:
        "https://example.com/static/tdc.js" → "tdc.js"
        "self-hosted" → "self-hosted"
        "" → "unknown"

    Args:
        file_url: stack frame 的 file 字段(URL 或特殊标识)

    Returns:
        str: 脚本 basename,空 URL 返回 "unknown"
    """
    if not file_url or file_url == "self-hosted":
        return file_url if file_url else "unknown"
    parsed = urlparse(file_url)
    path = parsed.path.rstrip("/")
    if not path:
        return parsed.netloc or "unknown"
    return path.rsplit("/", 1)[-1]


def _get_stack_scripts(stack):
    """从 stack 字段提取所有涉及的脚本名集合。

    Args:
        stack: trace 事件的 stack 字段(list[dict] 或 None)

    Returns:
        set[str]: 脚本名集合
    """
    scripts = set()
    for frame in stack or []:
        file_url = frame.get("file", "")
        name = _extract_script_name(file_url)
        if name:
            scripts.add(name)
    return scripts


def _get_op_value(ev):
    """根据事件 type 分发,提取 op 标识和 value 值。

    不同 type 的 op/value 取值方式不同:
      - typeof: op="typeof", value=result
      - instanceof: op="instanceof", value=result
      - timer: op="timer.<method>", value=delay
      - console: op="console.<method>", value=args
      - construct: op="<interface>.", value=return
      - get/set: op="<interface>.<member>", value=value
      - 其他: op="<interface>.<member>", value=return

    Args:
        ev: trace 事件 dict

    Returns:
        (op, value): op 标识字符串, value 原始值(可能为 None)
    """
    ev_type = ev.get("type", "")
    interface = ev.get("interface", "")
    member = ev.get("member", "")

    if ev_type == "typeof":
        return "typeof", ev.get("result")
    if ev_type == "instanceof":
        return "instanceof", ev.get("result")
    if ev_type == "timer":
        return f"timer.{ev.get('method', '')}", ev.get("delay")
    if ev_type == "console":
        return f"console.{ev.get('method', '')}", ev.get("args")
    if ev_type == "construct":
        return f"{interface}.", ev.get("return")
    if ev_type in ("get", "set"):
        op = f"{interface}.{member}" if interface else member
        return op, ev.get("value")
    # 其他类型(call 等)
    op = f"{interface}.{member}" if interface else member
    return op, ev.get("return")


# ============================================================
# 命令行入口
# ============================================================

def _parse_cli(argv):
    """解析命令行参数,返回 (trace_path, command, extra_args)。"""
    if len(argv) < 2:
        print(
            "用法: uv run scripts/trace_analyzer.py <trace> [command] [args]\n"
            "命令: filter(默认, 按文件过滤输出) | stats(聚合统计)\n"
            "filter 参数: [--filename <js>] [--type <t>] [--interface <iface>]\n"
            "             [--member <mem>] [--stack-func <func>] [--output <file>]\n"
            "             --stack-func: 按入口函数名过滤(v9.4 新增,阶段二 §2.4 环境依赖分析)",
            file=sys.stderr,
        )
        sys.exit(2)
    trace_path = argv[1]
    command = argv[2] if len(argv) >= 3 and not argv[2].startswith("-") else None
    # 如果 argv[2] 以 - 开头(如 --filename),说明是 filter 模式的参数
    extra_start = 3 if command is not None else 2
    extra = argv[extra_start:]
    # filter 模式下,把 trace_path 重新加入 extra 头部供 argparse 解析
    if command is None or command == "filter":
        extra = [trace_path] + extra
    return trace_path, command, extra


if __name__ == "__main__":
    trace, cmd, extra = _parse_cli(sys.argv)
    try:
        main(trace, cmd, *extra)
    except FileNotFoundError as e:
        print(f"[错误] 文件不存在: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"[错误] 执行失败: {e}", file=sys.stderr)
        raise
