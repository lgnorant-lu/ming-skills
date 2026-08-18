from __future__ import annotations

import json as _json
import os

from ..server import mcp, browser_manager


@mcp.tool()
async def scripts(
    action: str,
    url: str | None = None,
    save_path: str | None = None,
) -> dict | list | str:
    """Script inspection (v0.9.0 unified).

    Replaces list_scripts / get_script_source / save_script.

    Args:
        action:
          "list" — list all loaded scripts (src, type, inline preview)
          "get"  — get full source of one script (requires url;
                   use "inline:<index>" for inline scripts)
          "save" — save script source to local file (requires url + save_path)
        url: Script URL or "inline:<index>" (required for "get" and "save").
        save_path: Local file path (required for "save").

    Returns:
        For "list": list of script info dicts.
        For "get": dict with source string.
        For "save": dict with status, path, size.
    """
    if action == "list":
        return await _list_scripts()
    elif action == "get":
        if not url:
            return {"error": "url is required for action='get'"}
        src = await _get_script_source(url)
        return {"source": src, "url": url, "length": len(src) if isinstance(src, str) else 0}
    elif action == "save":
        if not url:
            return {"error": "url is required for action='save'"}
        if not save_path:
            return {"error": "save_path is required for action='save'"}
        return await _save_script(url, save_path)
    else:
        return {"error": f"unknown action: {action}. Use list/get/save"}


@mcp.tool()
async def search_code(
    keyword: str,
    script_url: str | None = None,
    context_chars: int = 200,
    context_lines: int = 3,
    max_results: int = 200,
) -> dict:
    """Search keyword in loaded scripts (v0.9.0 unified).

    Replaces search_code (all scripts) + search_code_in_script (single script).

    Args:
        keyword: The keyword to search for (case-sensitive substring match).
        script_url: If None, search across ALL loaded scripts.
            If given, search within that one script only (supports
            "inline:<index>" for inline scripts). Single-script mode
            auto-detects minified files and uses character-based context.
        context_chars: Context window in char mode (default 200 = +/-200 chars).
            Used when searching single minified scripts.
        context_lines: Context window in line mode (default 3).
        max_results: Maximum matches to return (default 200).

    Returns:
        dict with matches, total_matches, mode ("line" | "char"), etc.
    """
    if script_url is None:
        return await _search_code_all(keyword, max_results)
    else:
        return await _search_code_in_script(
            script_url, keyword, context_lines, context_chars, max_results
        )


# ---- internal implementations (not registered as MCP tools) ----

async def _list_scripts() -> list[dict]:
    try:
        page = await browser_manager.get_active_page()
        scripts_list = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            return Array.from(scripts).map((s, i) => ({
                index: i,
                src: s.src || null,
                type: s.type || 'text/javascript',
                is_module: s.type === 'module',
                inline_length: s.src ? 0 : (s.textContent || '').length,
                preview: s.src ? null : (s.textContent || '').substring(0, 200)
            }));
        }""")
        # v1.0.1: add hint for large scripts
        for s in scripts_list:
            size = s.get("inline_length", 0)
            src = s.get("src")
            if src and size == 0:
                # For external scripts, we don't know size yet from DOM alone
                # but we can hint based on common patterns
                pass
            elif size > 100_000:
                s["hint"] = (
                    f"Large script ({size} bytes). Consider saving for "
                    f"offline analysis: scripts(action='save', "
                    f"url='inline:{s['index']}', save_path='./script_{s['index']}.js')"
                )
        return scripts_list
    except Exception as e:
        return [{"error": str(e)}]


async def _get_script_source(url: str) -> str:
    try:
        page = await browser_manager.get_active_page()
        if url.startswith("inline:"):
            idx = int(url.split(":")[1])
            source = await page.evaluate(f"""() => {{
                const scripts = document.querySelectorAll('script');
                return scripts[{idx}] ? scripts[{idx}].textContent : null;
            }}""")
            return source or f"Inline script at index {idx} not found"
        else:
            source = await page.evaluate(f"""async () => {{
                try {{
                    const resp = await fetch("{url}");
                    return await resp.text();
                }} catch(e) {{
                    return "Fetch error: " + e.message;
                }}
            }}""")
            return source
    except Exception as e:
        return f"Error: {e}"


async def _save_script(url: str, save_path: str) -> dict:
    try:
        page = await browser_manager.get_active_page()
        source = await page.evaluate(f"""async () => {{
            const resp = await fetch("{url}");
            return await resp.text();
        }}""")
        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        with open(save_path, "w", encoding="utf-8") as f:
            f.write(source)
        return {"status": "saved", "path": save_path, "size": len(source)}
    except Exception as e:
        return {"error": str(e)}


async def _search_code_all(keyword: str, max_results: int = 50) -> dict:
    try:
        if max_results > 200:
            max_results = 200
        page = await browser_manager.get_active_page()
        results = await page.evaluate(f"""async () => {{
            const keyword = {repr(keyword)};
            const scripts = document.querySelectorAll('script');
            const matches = [];
            const maxResults = {max_results};
            let totalMatches = 0;
            let scriptsSearched = 0;
            const scriptsWithMatches = [];
            for (const s of scripts) {{
                let source = '';
                let scriptUrl = '';
                if (s.src) {{
                    scriptUrl = s.src;
                    try {{
                        const resp = await fetch(s.src);
                        source = await resp.text();
                    }} catch(e) {{ continue; }}
                }} else {{
                    scriptUrl = 'inline:' + scriptsSearched;
                    source = s.textContent || '';
                }}
                scriptsSearched++;
                const lines = source.split('\\n');
                let scriptMatchCount = 0;
                for (let i = 0; i < lines.length; i++) {{
                    if (lines[i].includes(keyword)) {{
                        totalMatches++;
                        scriptMatchCount++;
                        if (matches.length < maxResults) {{
                            const start = Math.max(0, i - 2);
                            const end = Math.min(lines.length, i + 3);
                            const contextLines = lines.slice(start, end);
                            const contextStr = contextLines.join('\\n');
                            matches.push({{
                                script_url: scriptUrl,
                                line_number: i + 1,
                                match: lines[i].trim().substring(0, 500),
                                context: contextStr.length > 2000
                                    ? contextStr.substring(0, 2000) + '...(truncated)'
                                    : contextStr
                            }});
                        }}
                    }}
                }}
                if (scriptMatchCount > 0) {{
                    scriptsWithMatches.push({{
                        url: scriptUrl,
                        match_count: scriptMatchCount,
                        source_length: source.length
                    }});
                }}
            }}
            return {{
                matches: matches,
                total_matches: totalMatches,
                returned_matches: matches.length,
                scripts_searched: scriptsSearched,
                scripts_with_matches: scriptsWithMatches,
                truncated: totalMatches > matches.length
            }};
        }}""")
        return results
    except Exception as e:
        return {"error": str(e)}


async def _search_code_in_script(
    script_url: str, keyword: str,
    context_lines: int = 3, context_chars: int = 200,
    max_results: int = 200,
) -> dict:
    try:
        page = await browser_manager.get_active_page()
        if script_url.startswith("inline:"):
            idx = int(script_url.split(":")[1])
            src = await page.evaluate(f"""() => {{
                const scripts = document.querySelectorAll('script');
                return scripts[{idx}] ? (scripts[{idx}].textContent || '') : null;
            }}""")
            if src is None:
                return {"error": f"Inline script not found at index {idx}"}
        else:
            src = await page.evaluate(
                f"fetch({_json.dumps(script_url)}, {{cache: 'force-cache'}}).then(r => r.text())"
            )
        if not isinstance(src, str):
            return {"error": f"script not fetchable: got {type(src).__name__}"}

        lines = src.split("\n")
        max_line_len = max((len(l) for l in lines), default=0)
        use_char_mode = len(lines) < 10 or max_line_len > 5000

        results: list[dict] = []
        total = 0

        if use_char_mode:
            i = 0
            while True:
                pos = src.find(keyword, i)
                if pos == -1:
                    break
                total += 1
                if len(results) < max_results:
                    start = max(0, pos - context_chars)
                    end = min(len(src), pos + len(keyword) + context_chars)
                    results.append({
                        "position": pos,
                        "context_start": start,
                        "context_end": end,
                        "context": src[start:end],
                        "match_highlight_range": [pos - start, pos - start + len(keyword)],
                    })
                i = pos + len(keyword)
            return {
                "total_matches": total, "returned": len(results),
                "script_url": script_url, "mode": "char",
                "source_size": len(src), "total_lines": len(lines),
                "max_line_length": max_line_len,
                "context_chars": context_chars, "results": results,
            }

        for idx, line in enumerate(lines):
            if keyword in line:
                total += 1
                if len(results) < max_results:
                    start = max(0, idx - context_lines)
                    end = min(len(lines), idx + context_lines + 1)
                    ctx = "\n".join(lines[start:end])
                    results.append({
                        "line": idx + 1,
                        "context": ctx[:3000] + ("...(truncated)" if len(ctx) > 3000 else ""),
                        "context_range": [start + 1, end],
                    })
        return {
            "total_matches": total, "returned": len(results),
            "script_url": script_url, "mode": "line",
            "total_lines": len(lines), "results": results,
        }
    except Exception as e:
        return {"error": str(e)}
