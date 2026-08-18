"""iv8 补环境模板:多线程批量签名。

适用场景:并发给多个站点/多组参数生成签名。
特点:每个线程内创建独立 Context(每个 isolate 独占),无需加锁。
依据:V8 执行期释放 GIL,实测 8 线程约 4.7x 加速。
"""
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

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


def batch_sign(tasks: list[dict], max_workers: int = 8) -> dict[str, str]:
    """对外公开:批量签名(多线程)。

    调用者不需要知道:线程池管理、Context 隔离、异常聚合。
    可能变化:任务结构、worker 数量、签名函数。
    复杂度藏在内部:线程池调度、每个线程的 Context 生命周期、异常收集。

    Args:
        tasks: 任务列表,每项含 site/params 等字段。
        max_workers: 线程数,默认 8。

    Returns:
        dict: task_id → 签名结果;失败时 value 为异常信息。
    """
    results: dict[str, str] = {}
    results_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_sign_task, task): task["id"]
            for task in tasks
        }
        for future in as_completed(futures):
            task_id = futures[future]
            try:
                sign = future.result()
            except Exception as e:
                sign = f"<ERROR: {e}>"
            with results_lock:
                results[task_id] = sign

    return results


# ===== 内部辅助函数 =====

def _sign_task(task: dict) -> str:
    """单个任务:每个线程内创建独立 Context。

    每个线程独占一个 V8 Isolate,无需加锁。
    """
    site = task["site"]
    params = task["params"]
    ua = task.get("ua")  # 可选:每个站点用不同 UA

    environment = {"navigator": {"userAgent": ua}} if ua else None

    # 批量场景用 mode='prod' 降低 debug 日志开销;补环境阶段(定位缺口时)用 mode='debug'
    with iv8.JSContext(mode='prod', js_api="__ZY__", environment=environment) as ctx:
        _setup_env(ctx, site)
        _load_target_js(ctx, site)
        _drain_events(ctx)
        return _extract_sign(ctx, params)


def _setup_env(ctx, site: str):
    """注入桩函数 + 前置参数(按站点)。"""
    _inject_patches(ctx)
    _inject_prerequisites(ctx, site)


def _inject_patches(ctx):
    """注入 ENV_PATCH 桩函数常量。"""
    ctx.eval(ENV_PATCH)


def _inject_prerequisites(ctx, site: str):
    """按站点注入 localStorage。

    cookie 优先用 page.load 的 headers(见 SKILL.md),不在此处用 ctx.eval 注入。
    site 用 json.dumps 转义,防止单引号/特殊字符破坏 JS。
    """
    ctx.eval(f"localStorage.setItem('site', {json.dumps(site)});")


def _load_target_js(ctx, site: str):
    """用 page.load 加载目标 JS(包装为最小 HTML)。

    对齐浏览器导航流程:外层包一层最小 HTML,由 page.load 解析执行 <script>。
    baseURL 按站点构造,保持与目标站点对齐;cookie 优先通过 page.load 的 headers 注入。
    """
    try:
        with open(f"{site}/target.js", "r", encoding="utf-8") as f:
            js_code = f.read()
        js_code = js_code.replace("</script>", "<\\/script>")  # 防 </script> 注入
        html = f'<html><head><script>{js_code}</script></head><body></body></html>'
        snapshot = {
            "baseURL": f"https://{site}.com",
            "html": html,
            # 每个 cookie 一个独立 Set-Cookie 头(按 HTTP 规范,避免被当作前一个的属性)
            "headers": [
                ["Set-Cookie", f"site={site}; path=/"],
                ["Set-Cookie", "session=abc123; path=/"],
            ],
        }
        ctx.eval(f"window.__ZY__.page.load({json.dumps(snapshot, ensure_ascii=False)});")
    except Exception as e:
        raise RuntimeError(f"page.load 加载 {site}/target.js 失败: {e}") from e


def _drain_events(ctx):
    """推进事件循环。"""
    ctx.eval("window.__ZY__.eventLoop.drain()")


def _extract_sign(ctx, params: dict) -> str:
    """调用 getSign。"""
    try:
        return ctx.eval(f"getSign({json.dumps(params, ensure_ascii=False)})")
    except Exception as e:
        raise RuntimeError(f"调用 getSign 失败,params={params}: {e}") from e


if __name__ == "__main__":
    # 使用示例
    tasks = [
        {"id": "t1", "site": "site_a", "params": {"ts": 1700000000}, "ua": "Mozilla/5.0 ... Chrome/124.0"},
        {"id": "t2", "site": "site_b", "params": {"ts": 1700000001}, "ua": "Mozilla/5.0 ... Chrome/123.0"},
    ]
    results = batch_sign(tasks, max_workers=2)
    for tid, sign in results.items():
        print(f"{tid}: {sign}")
