"""iv8 补环境模板:page.load 加载完整 HTML 页面。

适用场景:目标是完整 HTML 页面(含内联/外联脚本),需要执行脚本、派发事件。
依据:page.load 流式解析 → 执行 <script> → 处理样式 → 派发 DOMContentLoaded/load。
注意:外联脚本必须用 resources 注入;补丁/参数必须在 page.load 之前注入。
"""
import json
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


def extract_from_page(page_url: str, html: str, resources: dict,
                      cookies: dict = None) -> dict:
    """对外公开:从 HTML 页面提取加密参数。

    调用者不需要知道:page.load 参数构造、resources 格式、事件循环推进。
    可能变化:页面 URL、HTML 内容、外联资源、提取的字段。
    复杂度藏在内部:HTML 转义、resources 序列化、page.load 编排。
    """
    with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
        # 注意:location.href 由 page.load 的 baseURL 同步,无需在 environment 重复设置
        _inject_patches(ctx)
        _load_page(ctx, page_url, html, resources, cookies)
        _drain_events(ctx)
        return _extract_result(ctx)


# ===== 内部辅助函数 =====

def _inject_patches(ctx):
    """注入 ENV_PATCH 桩函数常量(必须在 page.load 之前,因内联 <script> 会立即执行)。"""
    ctx.eval(ENV_PATCH)


def _load_page(ctx, page_url: str, html: str, resources: dict, cookies: dict):
    """调用 page.load 加载 HTML,cookie 优先用主文档 headers 的 Set-Cookie 注入。

    resources 格式:{url: {body, status, headers}} 或 {url: "body 简写"}
    """
    snapshot = {
        "baseURL": page_url,
        "html": html,
        "resources": resources,
    }
    # cookie 优先用 page.load 的 headers(Set-Cookie)注入,每个 cookie 一个独立头(按 HTTP 规范)
    if cookies:
        snapshot["headers"] = [["Set-Cookie", f"{k}={v}; path=/"] for k, v in cookies.items()]
    try:
        ctx.eval(f"window.__ZY__.page.load({json.dumps(snapshot, ensure_ascii=False)});")
    except Exception as e:
        raise RuntimeError(f"page.load 失败,url={page_url}: {e}") from e


def _drain_events(ctx):
    """推进事件循环,让 DOMContentLoaded/load 回调执行。"""
    ctx.eval("window.__ZY__.eventLoop.drain()")


def _extract_result(ctx) -> dict:
    """提取页面算出的加密参数(整体转 Python dict)。"""
    try:
        return ctx.eval("window._result", to_py=True)
    except Exception as e:
        raise RuntimeError(f"提取结果失败: {e}") from e


if __name__ == "__main__":
    # 使用示例
    with open("target.html", "r", encoding="utf-8") as f:
        html = f.read()
    with open("main.js", "r", encoding="utf-8") as f:
        main_js = f.read()

    resources = {
        "https://target.com/main.js": {"body": main_js, "status": 200}
    }
    # cookie 优先通过 page.load 的 headers(Set-Cookie)注入
    result = extract_from_page("https://target.com/page", html, resources,
                               cookies={"session": "abc123"})
    print("结果:", result)
