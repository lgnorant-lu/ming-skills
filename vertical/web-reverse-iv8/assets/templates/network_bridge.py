"""iv8 补环境模板:网络桥接(Python 发请求 + add_resource 注入)。

适用场景:目标 JS 发 XHR/fetch 但社区版不发真实 HTTP,需 Python 桥接。
依据:社区版 XHR/fetch 从离线 bundle 匹配响应。
工作流:JS 发请求 → Python 发真实请求 → add_resource 注入 → drain 推进。
HTTP 客户端:默认 httpx;检测 TLS 指纹时用 curl_cffi。
"""
import json
from typing import Optional

import httpx
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


def run_with_network(target_js_path: str, api_url: str,
                     cookies: Optional[dict] = None,
                     use_curl_cffi: bool = False) -> str:
    """对外公开:跑目标 JS,网络请求由 Python 桥接。

    调用者不需要知道:HTTP 客户端选择、TLS 指纹、header 顺序、事件循环推进。
    可能变化:目标 JS、API URL、cookie、是否检测 TLS。
    复杂度藏在内部:HTTP 客户端封装、响应注入、事件循环推进、异常映射。
    """
    with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
        _setup_env(ctx)
        _load_target_js(ctx, target_js_path, cookies)
        _trigger_request(ctx, api_url)

        # Python 侧发真实请求并注入响应
        resp = _fetch_real(api_url, cookies, use_curl_cffi)
        _inject_response(ctx, api_url, resp)

        _drain_events(ctx)
        return _extract_result(ctx)


# ===== 内部辅助函数 =====

def _setup_env(ctx):
    """注入桩函数 + 前置参数。"""
    _inject_patches(ctx)


def _inject_patches(ctx):
    """注入 ENV_PATCH 桩函数常量。"""
    ctx.eval(ENV_PATCH)


def _load_target_js(ctx, path: str, cookies: Optional[dict]):
    """用 page.load 加载目标 JS(包装为最小 HTML),cookie 优先通过 headers 注入。

    对齐浏览器导航流程:外层包一层最小 HTML,由 page.load 解析执行 <script>。
    """
    try:
        with open(path, "r", encoding="utf-8") as f:
            js_code = f.read()
        js_code = js_code.replace("</script>", "<\\/script>")  # 防 </script> 注入
        html = f'<html><head><script>{js_code}</script></head><body></body></html>'
        snapshot = {
            "baseURL": "https://target.com",
            "html": html,
        }
        # cookie 优先用 page.load 的 headers(Set-Cookie)注入,每个 cookie 一个独立头(按 HTTP 规范)
        if cookies:
            snapshot["headers"] = [["Set-Cookie", f"{k}={v}; path=/"] for k, v in cookies.items()]
        ctx.eval(f"window.__ZY__.page.load({json.dumps(snapshot, ensure_ascii=False)});")
    except Exception as e:
        raise RuntimeError(f"page.load 加载 {path} 失败: {e}") from e


def _trigger_request(ctx, api_url: str):
    """让 JS 发起 XHR(进入 pending,等 add_resource + drain 后回调执行)。"""
    try:
        ctx.eval(f"""
            var xhr = new XMLHttpRequest();
            xhr.open('GET', {json.dumps(api_url)});
            xhr.onload = function() {{ window._result = xhr.responseText; }};
            xhr.send();
        """)
    except Exception as e:
        raise RuntimeError(f"JS 发起请求失败,url={api_url}: {e}") from e


def _fetch_real(url: str, cookies: Optional[dict], use_curl_cffi: bool) -> dict:
    """Python 侧发真实 HTTP 请求。

    默认用 httpx;检测 TLS 指纹时用 curl_cffi(impersonate Chrome)。
    返回 dict:{body, status, headers}
    """
    if use_curl_cffi:
        return _fetch_with_curl_cffi(url, cookies)
    return _fetch_with_httpx(url, cookies)


def _fetch_with_httpx(url: str, cookies: Optional[dict]) -> dict:
    """httpx 实现(默认)。"""
    try:
        with httpx.Client(cookies=cookies or {}, timeout=30) as client:
            resp = client.get(url)
        return {
            "body": resp.text,
            "status": resp.status_code,
            "headers": dict(resp.headers),
        }
    except Exception as e:
        raise RuntimeError(f"httpx 请求失败,url={url}: {e}") from e


def _fetch_with_curl_cffi(url: str, cookies: Optional[dict]) -> dict:
    """curl_cffi 实现(检测 TLS 指纹时用)。

    impersonate 模拟 Chrome 的 TLS/JA3 指纹;
    注意保持与真实浏览器一致的 header 顺序。
    """
    try:
        from curl_cffi import requests as cffi_requests
        resp = cffi_requests.get(url, impersonate="chrome", cookies=cookies or {})
        return {
            "body": resp.text,
            "status": resp.status_code,
            "headers": dict(resp.headers),
        }
    except Exception as e:
        raise RuntimeError(f"curl_cffi 请求失败,url={url}: {e}") from e


def _inject_response(ctx, url: str, resp: dict):
    """把 Python 拿到的响应注入 iv8 离线 bundle。"""
    try:
        ctx.add_resource(url=url, body=resp["body"], status=resp["status"], headers=resp["headers"])
    except Exception as e:
        raise RuntimeError(f"add_resource 失败,url={url}: {e}") from e


def _drain_events(ctx):
    """推进事件循环,让 XHR 回调命中注入的响应。"""
    ctx.eval("window.__ZY__.eventLoop.drain()")


def _extract_result(ctx) -> str:
    """提取 JS 算出的结果。"""
    try:
        return ctx.eval("window._result")
    except Exception as e:
        raise RuntimeError(f"提取结果失败: {e}") from e


if __name__ == "__main__":
    # 使用示例:默认 httpx
    result = run_with_network(
        target_js_path="target.js",
        api_url="https://api.target.com/data",
        cookies={"session": "xxx"},
    )
    print("结果:", result)

    # 检测 TLS 指纹时用 curl_cffi
    result2 = run_with_network(
        target_js_path="target.js",
        api_url="https://api.target.com/data",
        cookies={"session": "xxx"},
        use_curl_cffi=True,
    )
    print("结果(curl_cffi):", result2)
