from __future__ import annotations

import json
import time

from ..server import mcp, browser_manager


@mcp.tool()
async def network_capture(
    action: str,
    url_pattern: str = "**/*",
    capture_body: bool = False,
) -> dict:
    """Unified network capture control (v0.9.0).

    Replaces start_network_capture / stop_network_capture.

    Args:
        action:
          "start"  — begin capturing network events
          "stop"   — stop capturing (buffer retained)
          "clear"  — clear the capture buffer
          "status" — return current capture state
        url_pattern: Glob pattern for "start" (default "**/*" captures all).
        capture_body: For "start" only; capture response bodies (more memory).

    Returns:
        dict with action result + current status snapshot.
    """
    if action == "start":
        browser_manager._capturing = True
        browser_manager._capture_pattern = url_pattern
        browser_manager._capture_body = capture_body
        return {"status": "capturing", "pattern": url_pattern,
                "capture_body": capture_body}
    elif action == "stop":
        browser_manager._capturing = False
        return {"status": "stopped",
                "total_requests": len(browser_manager._network_requests)}
    elif action == "clear":
        count = len(browser_manager._network_requests)
        browser_manager._network_requests.clear()
        browser_manager._request_id_counter = 0
        return {"status": "cleared", "cleared_count": count}
    elif action == "status":
        return {
            "active": browser_manager._capturing,
            "pattern": browser_manager._capture_pattern,
            "capture_body": browser_manager._capture_body,
            "buffer_size": len(browser_manager._network_requests),
        }
    else:
        return {"error": f"unknown action: {action}. Use start/stop/clear/status"}


@mcp.tool()
async def list_network_requests(
    url_filter: str | None = None,
    url_contains_domain: str | None = None,
    method: str | None = None,
    resource_type: str | None = None,
    status_code: int | None = None,
) -> list[dict]:
    """List captured network requests with optional filters.

    Args:
        url_filter: Substring filter for request URLs.
        url_contains_domain: Convenience domain filter (e.g. 'nmpa.gov.cn').
        method: HTTP method filter (e.g. "GET", "POST").
        resource_type: Resource type filter (e.g. "xhr", "fetch", "script", "document").
        status_code: HTTP status code filter.

    Returns:
        List of request summaries with id, url, method, status, type, ms, size.
    """
    try:
        reqs = list(browser_manager._network_requests)
        if url_filter:
            reqs = [r for r in reqs if url_filter in r["url"]]
        if url_contains_domain:
            reqs = [r for r in reqs if url_contains_domain in r.get("url", "")]
        if method:
            reqs = [r for r in reqs if r["method"].upper() == method.upper()]
        if resource_type:
            reqs = [r for r in reqs if r.get("resource_type") == resource_type]
        if status_code is not None:
            reqs = [r for r in reqs if r.get("status") == status_code]

        summaries = []
        for r in reqs:
            body_size = len(r["response_body"]) if r.get("response_body") else 0
            summaries.append({
                "id": r["id"], "url": r["url"][:200], "method": r["method"],
                "status": r.get("status"), "type": r.get("resource_type"),
                "ms": r.get("duration"), "size": body_size,
                "has_body": body_size > 0,
            })
        return summaries
    except Exception as e:
        return [{"error": str(e)}]


@mcp.tool()
async def get_network_request(
    request_id: int,
    include_body: bool = False,
    include_headers: bool = True,
    max_body_size: int = 5000,
) -> dict:
    """Get full details of a specific captured network request.

    Args:
        request_id: The ID of the request (from list_network_requests).
        include_body: Include response body (default False).
        include_headers: Include request/response headers (default True).
        max_body_size: Max chars of body when include_body=True. Pass -1 for unlimited.

    Returns:
        dict with request and response details.
    """
    try:
        for r in browser_manager._network_requests:
            if r["id"] == request_id:
                result = dict(r)
                if not include_body:
                    body = result.pop("response_body", None)
                    result["response_body_available"] = body is not None
                    if body:
                        result["response_body_size"] = len(body)
                else:
                    body = result.get("response_body")
                    if body is not None and max_body_size >= 0 and len(body) > max_body_size:
                        result["response_body"] = body[:max_body_size]
                        result["response_body_truncated"] = True
                        result["response_body_original_size"] = len(body)
                        result["response_body_size_returned"] = max_body_size
                    elif body is not None:
                        result["response_body_truncated"] = False
                        result["response_body_original_size"] = len(body)
                        result["response_body_size_returned"] = len(body)
                if not include_headers:
                    result.pop("request_headers", None)
                    result.pop("response_headers", None)
                return result
        return {"error": f"Request ID {request_id} not found"}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def get_request_initiator(request_id: int) -> dict:
    """Get the JS call stack that initiated a network request.

    Golden path: see encrypted param -> get_request_initiator -> find signing function.
    Requires inject_hook_preset("xhr"/"fetch") BEFORE navigating.

    KNOWN LIMITATIONS (v0.8.1+):
      1. For requests modified by an interceptor registered BEFORE MCP's
         hooks (e.g. SDKs loaded via sync <script>), the initiator will be
         the interceptor's call, not the original business code.
         Workaround: use reload_with_hooks().
      2. For fetch on Firefox, Playwright-native initiator is often null.
         Requires inject_hook_preset('fetch', persistent=True).

    Args:
        request_id: The ID of the request.

    Returns:
        dict with url, initiator_stack, source, diagnostics.
    """
    try:
        target_entry = None
        for r in browser_manager._network_requests:
            if r["id"] == request_id:
                target_entry = r
                break
        if target_entry is None:
            return {"error": f"Request ID {request_id} not found"}

        page = await browser_manager.get_active_page()
        req_url = target_entry["url"]
        escaped_url = json.dumps(req_url)

        result = await page.evaluate(f"""() => {{
            const reqUrl = {escaped_url};
            function searchLogs(logs, type) {{
                if (!logs || !logs.length) return null;
                for (let i = logs.length - 1; i >= 0; i--) {{
                    const log = logs[i];
                    const logUrl = log.url || '';
                    if (reqUrl === logUrl || reqUrl.includes(logUrl) || logUrl.includes(reqUrl)) {{
                        return {{
                            url: logUrl, stack: log.stack || null, type: type,
                            method: log.method, headers: log.headers,
                            body: log.body ? String(log.body).substring(0, 2000) : null,
                            timestamp: log.timestamp
                        }};
                    }}
                    try {{
                        const u1 = new URL(reqUrl, location.origin);
                        const u2 = new URL(logUrl, location.origin);
                        if (u1.pathname === u2.pathname && u1.host === u2.host) {{
                            return {{
                                url: logUrl, stack: log.stack || null, type: type,
                                method: log.method, headers: log.headers,
                                body: log.body ? String(log.body).substring(0, 2000) : null,
                                timestamp: log.timestamp
                            }};
                        }}
                    }} catch(e) {{}}
                }}
                return null;
            }}
            const xhrResult = searchLogs(window.__mcp_xhr_log, 'xhr');
            if (xhrResult) return xhrResult;
            const fetchResult = searchLogs(window.__mcp_fetch_log, 'fetch');
            if (fetchResult) return fetchResult;
            const fetchInitLog = window.__mcp_fetch_initiator_log || [];
            for (let i = fetchInitLog.length - 1; i >= 0; i--) {{
                const entry = fetchInitLog[i];
                const logUrl = entry.url || '';
                if (reqUrl === logUrl || reqUrl.includes(logUrl) || logUrl.includes(reqUrl)) {{
                    return {{ url: logUrl, stack: entry.stack || null, type: 'fetch_hook',
                              method: entry.method, timestamp: entry.ts }};
                }}
                try {{
                    const u1 = new URL(reqUrl, location.origin);
                    const u2 = new URL(logUrl, location.origin);
                    if (u1.pathname === u2.pathname && u1.host === u2.host) {{
                        return {{ url: logUrl, stack: entry.stack || null, type: 'fetch_hook',
                                  method: entry.method, timestamp: entry.ts }};
                    }}
                }} catch(e) {{}}
            }}
            return {{
                url: reqUrl, stack: null, type: 'unknown',
                diagnostics: {{
                    xhr_hook_active: !!window.__mcp_xhr_hooked,
                    fetch_hook_active: !!window.__mcp_fetch_hooked,
                    hint: !window.__mcp_xhr_hooked && !window.__mcp_fetch_hooked
                        ? 'No hooks detected. Call inject_hook_preset("xhr"/"fetch") BEFORE navigating.'
                        : 'Hooks active but no matching URL found in logs.'
                }}
            }};
        }}""")

        source = result.get("type", "unknown")
        return {
            "url": result.get("url"),
            "initiator_stack": result.get("stack"),
            "initiator_type": source,
            "source": source,
            "method": result.get("method"),
            "request_headers": result.get("headers"),
            "request_body": result.get("body"),
            "diagnostics": result.get("diagnostics"),
            "diagnostic": (
                {
                    "likely_causes": [
                        "hook registered after SDK (try reload_with_hooks)",
                        "request made inside a sync-loaded SDK interceptor",
                        "fetch_hook.js not injected",
                    ],
                    "recommended_action": "Use reload_with_hooks() or inject hooks before navigate.",
                }
                if source in ("unknown", None) else None
            ),
        }
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
async def intercept_request(
    url_pattern: str,
    action: str = "log",
    modify_headers: dict | None = None,
    modify_body: str | None = None,
    mock_response: dict | None = None,
) -> dict:
    """Intercept network requests matching a pattern.

    Args:
        url_pattern: URL glob pattern (e.g. "**/api/login*").
        action: "log", "block", "modify", "mock", or "stop" (unroute).
        modify_headers: Headers to add/override (action="modify").
        modify_body: Request body replacement (action="modify").
        mock_response: Dict with "status", "headers", "body" (action="mock").
    """
    try:
        page = await browser_manager.get_active_page()

        if action == "stop":
            if url_pattern:
                await page.unroute(url_pattern)
                return {"status": "stopped", "pattern": url_pattern}
            else:
                await page.unroute("**/*")
                return {"status": "stopped_all"}

        async def handler(route):
            if action == "log":
                browser_manager._console_logs.append({
                    "level": "info",
                    "text": f"[INTERCEPT:log] {route.request.method} {route.request.url}",
                    "timestamp": time.time() * 1000, "location": None,
                })
                await route.continue_()
            elif action == "block":
                await route.abort()
            elif action == "modify":
                overrides = {}
                if modify_headers:
                    overrides["headers"] = {**dict(route.request.headers), **modify_headers}
                if modify_body:
                    overrides["post_data"] = modify_body
                await route.continue_(**overrides)
            elif action == "mock":
                resp = mock_response or {}
                await route.fulfill(
                    status=resp.get("status", 200),
                    headers=resp.get("headers", {"content-type": "application/json"}),
                    body=resp.get("body", "{}"),
                )

        await page.route(url_pattern, handler)
        return {"status": "intercepting", "pattern": url_pattern, "action": action}
    except Exception as e:
        return {"error": str(e)}
