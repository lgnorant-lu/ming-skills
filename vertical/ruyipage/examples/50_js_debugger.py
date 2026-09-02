# -*- coding: utf-8 -*-
"""JS 断点调试

断点、单步、调用栈、作用域变量——这些能力不在 WebDriver BiDi 规范里
（BiDi 没有 debugger 模块），也无法用 CDP 实现（Firefox 141 已彻底移除 CDP），
因此 ruyiPage 通过 Firefox 自己的 DevTools RDP 通道提供，与 BiDi 并行工作。

运行前先改 BROWSER_PATH，然后：

    python examples/50_js_debugger.py

关键注意事项
------------
JS 暂停期间，任何依赖 JS 执行的调用（run_js、点击、取文本）都会阻塞到超时。
所以触发断点的代码必须放在后台线程，如下面的 trigger()。
"""

import pathlib
import threading

from ruyipage import FirefoxOptions, FirefoxPage

BROWSER_PATH = r"D:\firefox\src\firefox\obj-jscall-check\dist\bin\firefox.exe"

PAGE = (
    pathlib.Path(__file__).parent.parent
    / "tests" / "fixtures" / "pages" / "debugger_target.html"
).resolve().as_uri()


def main():
    opts = FirefoxOptions()
    opts.set_browser_path(BROWSER_PATH)
    # 写入 devtools 所需 pref 并以 --start-debugger-server 启动
    opts.enable_debugger()

    page = FirefoxPage(opts)
    try:
        page.get(PAGE)

        # 建立调试通道并 attach 到当前标签页
        page.debugger.start()

        # 看看加载了哪些 JS 源
        for source in page.debugger.sources(url_contains="debugger_target.js"):
            print("source:", source.url)

        # 哪些行可以下断点（Firefox 只接受落在真实断点位置上的断点，
        # 省略 column 时 ruyiPage 会自动查询该行的有效列）
        print("breakable lines:", page.debugger.breakable_lines("debugger_target.js"))

        bp = page.debugger.set_breakpoint("debugger_target.js", 6)
        print("breakpoint set:", bp)

        # 在后台线程触发，因为命中断点后这个调用会一直阻塞
        result = {}

        def trigger():
            result["value"] = page.run_js(
                "return window.runComputation(25, 4);", timeout=120
            )

        worker = threading.Thread(target=trigger, daemon=True)
        worker.start()

        state = page.debugger.wait_paused(timeout=30)
        print("\npaused: why={} at line {}".format(state.why, state.line))

        print("call stack:")
        for frame in page.debugger.frames():
            print("   {} @ {}:{}".format(frame.display_name, frame.url, frame.line))

        print("local variables:", page.debugger.scope())

        # 单步跳过一行，看 total 被赋值
        page.debugger.step_over()
        stepped = page.debugger.wait_paused(timeout=20)
        print("\nstepped to line {}".format(stepped.line))
        print("total is now:", page.debugger.scope().get("total"))

        page.debugger.resume()
        worker.join(timeout=30)
        print("\nresumed, js returned:", result.get("value"))
    finally:
        # stop() 会在断开前自动恢复执行，避免页面卡死
        page.debugger.stop()
        page.quit()


if __name__ == "__main__":
    main()
