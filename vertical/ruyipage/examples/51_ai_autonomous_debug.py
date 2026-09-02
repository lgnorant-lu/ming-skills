# -*- coding: utf-8 -*-
"""AI 自主调试闭环演示

只给一个页面地址，其余全靠调试器自己发现：有哪些 JS 源、代码长什么样、
该在哪一行下断点、入口函数叫什么。这正是 AI 自主排查页面问题需要走的流程。

    python examples/51_ai_autonomous_debug.py

注意：JS 暂停期间任何依赖它的 BiDi 调用都会阻塞，所以触发断点的调用
必须放在后台线程。
"""

import pathlib
import re
import threading

from ruyipage import FirefoxOptions, FirefoxPage

BROWSER_PATH = r"D:\firefox\src\firefox\obj-jscall-check\dist\bin\firefox.exe"

PAGE = (
    pathlib.Path(__file__).parent.parent
    / "tests" / "fixtures" / "pages" / "debugger_target.html"
).resolve().as_uri()


def main():
    opts = FirefoxOptions()
    opts.headless(True)
    opts.set_browser_path(BROWSER_PATH)
    opts.enable_debugger()

    page = FirefoxPage(opts)
    try:
        page.get(PAGE)
        dbg = page.debugger.start()

        # 1. 发现页面加载了哪些脚本
        sources = [s for s in dbg.sources() if s.url and s.url.endswith(".js")]
        print("1. 发现源:", [s.url.rsplit("/", 1)[-1] for s in sources])

        # 2. 读回引擎正在执行的源码，从中找一个函数
        target = sources[0]
        code = dbg.source_text(target)
        lines = code.split("\n")
        func_line = next(
            i + 1 for i, text in enumerate(lines) if re.match(r"\s*function \w+\(", text)
        )
        func_name = re.search(r"function (\w+)", lines[func_line - 1]).group(1)
        print("2. 找到函数 {}（第 {} 行）".format(func_name, func_line))

        # 3. 在函数体里挑一个真正可下断点的行
        breakable = set(dbg.breakable_lines(target.url))
        body_line = next(i for i in range(func_line + 1, func_line + 12) if i in breakable)
        print("3. 选定第 {} 行: {}".format(body_line, lines[body_line - 1].strip()))
        dbg.set_breakpoint(target.url, body_line)

        # 4. 从源码里推断出入口函数并调用（放后台线程，因为它会被断住）
        entry = re.search(r"window\.(\w+)\s*=\s*function", code).group(1)
        print("4. 发现入口 window.{}".format(entry))

        outcome = {}

        def trigger():
            outcome["value"] = page.run_js(
                "return window.{}(25, 4);".format(entry), timeout=60
            )

        worker = threading.Thread(target=trigger, daemon=True)
        worker.start()

        # 5. 断住后检查现场
        state = dbg.wait_paused(timeout=30)
        print("5. 命中 {}，停在第 {} 行".format(state.why, state.line))
        print("   调用栈:", " <- ".join(f.display_name for f in dbg.frames()))
        before = dbg.scope()
        print("   变量:")
        for name, value in before.items():
            shown = value if not isinstance(value, dict) else "<{}>".format(value.get("class"))
            print("      {} = {}".format(name, shown))

        # 6. 单步一行，对比哪些变量变了
        dbg.step_over()
        stepped = dbg.wait_paused(timeout=20)
        after = dbg.scope()
        changed = {k: v for k, v in after.items() if before.get(k) != v}
        print("6. 单步到第 {} 行，变化: {}".format(stepped.line, changed))

        dbg.resume()
        worker.join(timeout=30)
        print("7. 恢复执行，返回值:", outcome.get("value"))
    finally:
        dbg_unit = page.debugger
        try:
            dbg_unit.stop()
        except Exception:
            pass
        page.quit()


if __name__ == "__main__":
    main()
