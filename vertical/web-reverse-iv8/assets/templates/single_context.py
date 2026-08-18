"""iv8 补环境模板:单 Context 单次签名。

适用场景:给一个站点补环境,生成一次签名/加密参数。
特点:每个任务用独立 Context,符合"每次新 Context 获得干净状态"原则。
日志分离:debug 模式下 iv8 日志重定向到文件,控制台只看 print(见 iv8-env-patching.md 日志分离章节)。
"""
import json
import sys
import iv8

# 桩函数集中常量(内嵌,不用严格模式,函数用表达式;按缺口增删)
ENV_PATCH = r"""
if (typeof MessageChannel === 'undefined' || !MessageChannel.prototype.port1) {
    var MessageChannel = function() {
        var port = { onmessage: null, postMessage: function() {} };
        this.port1 = port;
        this.port2 = port;
    };
    window.MessageChannel = window.__ZY__.wrapNative(MessageChannel, 'MessageChannel');
}
"""


def sign_one(params: dict, cookies: dict = None, debug_log: str = None) -> str:
    """对外公开:单次签名生成。

    调用者不需要知道:JSContext 生命周期、桩函数加载、cookie 注入、事件循环推进。
    可能变化:目标 JS 路径、签名函数名、前置参数、cookie。
    复杂度藏在内部:Context 管理、ENV_PATCH 注入、cookie headers 构造、异常映射。

    参数 debug_log: 若指定文件路径,将 iv8 debug 日志重定向到该文件(debug 模式下推荐)。
                     不指定则 iv8 日志混入控制台(prod 模式可接受)。
    """
    if debug_log:
        # 日志分离:iv8 debug → 文件,print → 控制台
        original_stderr = sys.stderr
        log_file = open(debug_log, 'w', encoding='utf-8')
        sys.stderr = log_file
        try:
            return _run_sign(params, cookies)
        finally:
            sys.stderr = original_stderr
            log_file.close()
    else:
        return _run_sign(params, cookies)


def _run_sign(params: dict, cookies: dict = None) -> str:
    """实际签名逻辑(在日志分离或直通模式下均可调用)。"""
    with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
        _setup_env(ctx)
        _load_target_js(ctx, cookies)
        _drain_events(ctx)
        return _extract_sign(ctx, params)


# ===== 内部辅助函数 =====

def _setup_env(ctx):
    """注入桩函数 + 前置参数(必须在目标 JS 之前)。"""
    _inject_patches(ctx)
    _inject_prerequisites(ctx)


def _inject_patches(ctx):
    """注入 ENV_PATCH 桩函数常量。"""
    ctx.eval(ENV_PATCH)


def _inject_prerequisites(ctx):
    """注入 localStorage 等前置参数。

    cookie 优先用 page.load 的 headers(见 SKILL.md),不在此处用 ctx.eval 注入。
    """
    ctx.eval("localStorage.setItem('token', 'xyz');")


def _load_target_js(ctx, cookies: dict = None):
    """用 page.load 加载目标 JS(包装为最小 HTML),cookie 优先用主文档 headers 注入。

    对齐浏览器导航流程:外层包一层最小 HTML,由 page.load 解析执行 <script>。
    每个 cookie 一个独立 Set-Cookie 头(按 HTTP 规范)。
    """
    try:
        with open("target.js", "r", encoding="utf-8") as f:
            js_code = f.read()
        js_code = js_code.replace("</script>", "<\\/script>")  # 防 </script> 注入
        html = f'<html><head><script>{js_code}</script></head><body></body></html>'
        snapshot = {"baseURL": "https://target.com", "html": html}
        # cookie 优先用 page.load 的 headers(Set-Cookie)注入,每个 cookie 一个独立头
        if cookies:
            snapshot["headers"] = [["Set-Cookie", f"{k}={v}; path=/"] for k, v in cookies.items()]
        ctx.eval(f"window.__ZY__.page.load({json.dumps(snapshot, ensure_ascii=False)});")
    except Exception as e:
        raise RuntimeError(f"page.load 加载 target.js 失败: {e}") from e


def _drain_events(ctx):
    """推进事件循环,让 setTimeout/Promise 等异步回调执行。"""
    ctx.eval("window.__ZY__.eventLoop.drain()")


def _extract_sign(ctx, params: dict) -> str:
    """调用目标 JS 的 getSign 并返回结果。"""
    try:
        return ctx.eval(f"getSign({json.dumps(params, ensure_ascii=False)})")
    except Exception as e:
        raise RuntimeError(f"调用 getSign 失败,params={params},JS 报错: {e}") from e


if __name__ == "__main__":
    # 使用示例:debug 模式 + 日志分离
    # iv8 日志 → iv8_debug.log,控制台只看 print
    result = sign_one(
        {"user_id": 123, "ts": 1700000000},
        cookies={"session": "abc123"},
        debug_log="iv8_debug.log"
    )
    print("签名:", result)
