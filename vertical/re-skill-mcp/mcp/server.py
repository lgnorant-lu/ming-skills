"""
reverse-engineering-skill MCP server.

A minimal, self-contained MCP server that ships alongside the SKILL.md.
Exposes 5 tools covering the static-analysis / methodology core of the skill:

  - checklist.render        — render the v1 startup Checklist (forces phase 0 ritual)
  - signatures.list         — list 22 built-in signature fingerprints
  - signatures.scan         — scan a JS/HTML snippet against the signature DB
  - hook.templates          — list 12 built-in hook templates
  - hook.render             — render one hook template with parameter substitution
  - case.template           — return the case-library markdown template

Run with:
    python -m mcp_server      (if installed)
    python server.py          (direct)
Requires:
    pip install "mcp[cli]>=1.2"
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:                                          # pragma: no cover
    raise SystemExit(
        "The 'mcp' package is required.\n"
        "Install it with:\n    pip install \"mcp[cli]>=1.2\"\n"
    ) from exc


# ─────────────────────────── built-in data ───────────────────────────

SIGNATURES: list[dict[str, Any]] = [
    # sign / token family
    {"id": "x-bogus",        "name": "X-Bogus",        "category": "sign",   "patterns": [r"X-Bogus", r"_0x4ebd6b"]},
    {"id": "a-bogus",        "name": "a_bogus",        "category": "sign",   "patterns": [r"a_bogus", r"abogus"]},
    {"id": "x-gnarly",       "name": "X-Gnarly",       "category": "sign",   "patterns": [r"X-Gnarly"]},
    {"id": "x-sign",         "name": "X-Sign",         "category": "sign",   "patterns": [r"X-Sign\b"]},
    {"id": "x-s",            "name": "X-S",            "category": "sign",   "patterns": [r"X-S\b", r"window\._webmsxyw"]},
    {"id": "h5st",           "name": "H5ST (京东)",     "category": "sign",   "patterns": [r"_JdJrTdRiskFpInfo", r"H5ST"]},
    {"id": "byted-acrawler", "name": "byted_acrawler", "category": "sign",   "patterns": [r"byted_acrawler", r"webmssdk"]},
    {"id": "_signature",     "name": "_signature",     "category": "sign",   "patterns": [r"window\.byted_acrawler", r"_signature"]},
    {"id": "_webmsxyw",      "name": "_webmsxyw (小红书)","category": "sign", "patterns": [r"_webmsxyw", r"window\._webmsxyw"]},

    # environment / antibot
    {"id": "akamai-sd",      "name": "Akamai sensor_data","category": "antibot","patterns": [r"sensor_data", r"_abck"]},
    {"id": "rs-fssb",        "name": "瑞数 FSSBBIl1UgzbN7N","category": "antibot","patterns": [r"FSSBBIl1UgzbN7N", r"sdenv"]},
    {"id": "rs-nfbc",        "name": "瑞数 NfBCSins2OywS","category": "antibot","patterns": [r"NfBCSins2OywS", r"acmescripts"]},
    {"id": "acw-sc-v2",      "name": "阿里 WAF acw_sc__v2","category": "antibot","patterns": [r"acw_sc__v2"]},

    # crypto
    {"id": "crypto-js",      "name": "CryptoJS",       "category": "crypto", "patterns": [r"CryptoJS\.(AES|MD5|SHA|HmacSHA)"]},
    {"id": "webcrypto",      "name": "WebCrypto",      "category": "crypto", "patterns": [r"crypto\.subtle\.(encrypt|sign|digest)"]},
    {"id": "sm-cn",          "name": "国密 SM2/3/4",    "category": "crypto", "patterns": [r"\bSM2\b", r"\bSM3\b", r"\bSM4\b", r"sm-crypto"]},
    {"id": "rsa-jsenc",      "name": "RSA (jsencrypt)","category": "crypto", "patterns": [r"JSEncrypt\b", r"setPublicKey\("]},

    # obfuscation
    {"id": "ob-obfuscator",  "name": "obfuscator.io 混淆","category": "obfusc", "patterns": [r"_0x[a-f0-9]{4,}", r"\['\\x[0-9a-f]{2}"]},
    {"id": "cff",            "name": "控制流平坦化",     "category": "obfusc", "patterns": [r"switch\s*\(\s*\w+\s*\)\s*\{\s*case\s+'\d+'"]},
    {"id": "jsvmp",          "name": "JSVMP 虚拟机",     "category": "obfusc", "patterns": [r"while\s*\(\s*!?\s*\[\s*\]\s*\)", r"function\s+\w+\([^)]*\)\s*\{[^{}]{2000,}"]},

    # webpack / runtime
    {"id": "webpack-rt",     "name": "Webpack 运行时",   "category": "build",  "patterns": [r"__webpack_require__", r"webpackChunk"]},
    {"id": "vite-rt",        "name": "Vite 运行时",      "category": "build",  "patterns": [r"__vite__cjsImport"]},
]

HOOK_TEMPLATES: dict[str, str] = {
    "function": """(()=>{
  const orig = {TARGET};
  {TARGET} = function(...args){
    console.log('[hook:{LABEL}] args=', args);
    const r = orig.apply(this, args);
    console.log('[hook:{LABEL}] ret=', r);
    return r;
  };
})();""",

    "xhr": """(()=>{
  const O = XMLHttpRequest.prototype.open;
  const S = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m,u,...rest){
    this.__url=u; this.__method=m;
    if(String(u).includes('{URL_KEYWORD}')) debugger;
    return O.apply(this,[m,u,...rest]);
  };
  XMLHttpRequest.prototype.send = function(body){
    console.log('[xhr]', this.__method, this.__url, body);
    return S.apply(this,[body]);
  };
})();""",

    "fetch": """(()=>{
  const f = window.fetch;
  window.fetch = function(input, init){
    const url = typeof input==='string' ? input : input.url;
    if(url.includes('{URL_KEYWORD}')) debugger;
    console.log('[fetch]', url, init);
    return f.apply(this, arguments);
  };
})();""",

    "cookie": """(()=>{
  const desc = Object.getOwnPropertyDescriptor(Document.prototype,'cookie');
  Object.defineProperty(document,'cookie',{
    get(){ const v=desc.get.call(document); return v; },
    set(v){ if(String(v).includes('{COOKIE_KEYWORD}')) debugger; console.log('[cookie set]',v); return desc.set.call(document,v); }
  });
})();""",

    "storage": """(()=>{
  ['localStorage','sessionStorage'].forEach(k=>{
    const s = window[k]; const orig = s.setItem.bind(s);
    s.setItem = function(key,val){ if(key.includes('{STORAGE_KEYWORD}')) debugger; console.log('['+k+' set]',key,val); return orig(key,val); };
  });
})();""",

    "crypto": """(()=>{
  if(!window.CryptoJS) return console.warn('[hook] CryptoJS not loaded');
  ['AES','DES','TripleDES','RC4','Rabbit'].forEach(alg=>{
    const c = CryptoJS[alg]; if(!c) return;
    ['encrypt','decrypt'].forEach(op=>{
      const orig = c[op].bind(c);
      c[op] = function(msg,key,cfg){ console.log('[CryptoJS]',alg+'.'+op,{msg:String(msg),key:String(key),cfg}); return orig(msg,key,cfg); };
    });
  });
  ['MD5','SHA1','SHA256','SHA512'].forEach(h=>{
    const orig = CryptoJS[h]; if(!orig) return;
    CryptoJS[h] = function(m){ const r = orig(m); console.log('[CryptoJS]',h,String(m),'=>',r.toString()); return r; };
  });
})();""",

    "websocket": """(()=>{
  const W = window.WebSocket;
  window.WebSocket = function(url, proto){
    console.log('[ws] connect', url);
    const ws = new W(url, proto);
    const send = ws.send.bind(ws);
    ws.send = function(d){ console.log('[ws] send', d); return send(d); };
    ws.addEventListener('message', e => console.log('[ws] recv', e.data));
    return ws;
  };
})();""",

    "canvas": """(()=>{
  const t = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...a){
    console.log('[canvas] toDataURL', this.width+'x'+this.height); console.trace();
    return t.apply(this,a);
  };
})();""",

    "webgl": """(()=>{
  const g = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type,opts){
    if(String(type).includes('webgl')) console.log('[webgl] getContext', type);
    return g.apply(this,[type,opts]);
  };
})();""",

    "audio": """(()=>{
  if(!window.OfflineAudioContext) return;
  const O = window.OfflineAudioContext;
  window.OfflineAudioContext = function(...a){ console.log('[audio] new OfflineAudioContext', a); console.trace(); return new O(...a); };
})();""",

    "navigator": """(()=>{
  ['userAgent','platform','language','languages','hardwareConcurrency','deviceMemory','webdriver','plugins','mimeTypes']
    .forEach(p=>{
      try {
        const d = Object.getOwnPropertyDescriptor(Navigator.prototype, p) || Object.getOwnPropertyDescriptor(navigator, p);
        if(!d || !d.get) return;
        Object.defineProperty(navigator, p, { get(){ const v = d.get.call(navigator); console.log('[nav]', p, '=>', v); return v; }});
      } catch(e){}
    });
})();""",

    "fingerprint": """(()=>{
  ['toDataURL','toBlob','getImageData'].forEach(m=>{
    const proto = m==='getImageData' ? CanvasRenderingContext2D.prototype : HTMLCanvasElement.prototype;
    const orig = proto[m]; if(!orig) return;
    proto[m] = function(...a){ console.log('[fp:canvas]', m); console.trace(); return orig.apply(this,a); };
  });
  if(window.AudioBuffer){
    const o = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(...a){ console.log('[fp:audio] getChannelData'); console.trace(); return o.apply(this,a); };
  }
  ['userAgent','platform','language','plugins','mimeTypes','hardwareConcurrency'].forEach(p=>{
    try {
      const d = Object.getOwnPropertyDescriptor(Navigator.prototype, p); if(!d?.get) return;
      Object.defineProperty(navigator, p, { get(){ console.log('[fp:nav]', p); console.trace(); return d.get.call(navigator); }});
    } catch(e){}
  });
})();""",
}


CHECKLIST_TEMPLATE = """═══ reverse-engineering SKILL 启动 Checklist（v1）═══

[CHECK-1] 环境自检
  - 本 skill 主体（5 工具）已就位
  - 下游 MCP 是否就绪：
    □ js-reverse-mcp      (Chrome 断点)
    □ camoufox-reverse-mcp(JSVMP / 环境对比)

[CHECK-2] 案例库速查
  - 调用 case.template 拿模板格式
  - 翻你自己的 cases/ 看是否已有同站案例 → 优先复用其"踩坑记录"

[CHECK-3] 最终方案意图声明
  本次目标 (一句话):  ______
  预期最终方案:        纯协议 Node.js / 纯协议 Python / jsdom 伪装 / sdenv
  红线 3 自测:         无 X11 Docker 能跑 24h 吗？  能 / 不能(违规)

[CHECK-4] 反爬类型三分（不加 hook 先 navigate）
  □ 签名型 (RS / Akamai)    → sdenv + AST 插桩, 禁 proxy 模式
  □ 行为型 (字节系 X-Bogus)  → 路径 A 算法追踪 / 路径 B 环境伪装
  □ 纯混淆 (obfuscator.io)   → AST 反混淆 + 标准四板斧

═══ 四项填完，开始 Phase 0 ═══
"""


# ─────────────────────────── server ───────────────────────────

mcp = FastMCP("reverse-engineering-skill")

REPO_ROOT = Path(__file__).resolve().parent.parent


@mcp.tool()
def checklist_render() -> str:
    """Render the v1 startup Checklist.

    Call this FIRST in every reverse-engineering task. Fill in the blanks
    and post the filled checklist back to the user before any other tool call.
    Skipping this counts as a red-line violation per the skill methodology.
    """
    return CHECKLIST_TEMPLATE


@mcp.tool()
def signatures_list(category: str = "") -> list[dict[str, Any]]:
    """List built-in signature fingerprints.

    Args:
        category: Optional filter — one of: sign / antibot / crypto / obfusc / build.
                  Empty string returns all.

    Returns:
        List of {id, name, category, patterns}.
    """
    if not category:
        return [{k: v for k, v in s.items() if k != "patterns"} for s in SIGNATURES]
    return [
        {k: v for k, v in s.items() if k != "patterns"}
        for s in SIGNATURES
        if s["category"] == category
    ]


@mcp.tool()
def signatures_scan(text: str, max_hits: int = 50) -> dict[str, Any]:
    """Scan a JS / HTML snippet against the 22-signature database.

    Args:
        text: source text to scan (any size; only first 2MB scanned).
        max_hits: cap on hits returned per signature.

    Returns:
        {"hits": [{id, name, category, matched_pattern, sample}], "scanned_bytes": N}
    """
    blob = text[: 2 * 1024 * 1024]
    hits: list[dict[str, Any]] = []
    for sig in SIGNATURES:
        for pat in sig["patterns"]:
            try:
                m = re.search(pat, blob)
            except re.error:
                continue
            if m:
                hits.append({
                    "id": sig["id"],
                    "name": sig["name"],
                    "category": sig["category"],
                    "matched_pattern": pat,
                    "sample": m.group(0)[:120],
                })
                break
        if len(hits) >= max_hits:
            break
    return {"hits": hits, "scanned_bytes": len(blob)}


@mcp.tool()
def hook_templates() -> list[dict[str, str]]:
    """List the 12 built-in hook templates (name + one-line purpose)."""
    purpose = {
        "function":    "Wrap any callable, log args/ret",
        "xhr":         "Intercept XMLHttpRequest open/send + debugger by URL",
        "fetch":       "Intercept window.fetch + debugger by URL",
        "cookie":      "Trap document.cookie set by keyword",
        "storage":     "Trap (local|session)Storage.setItem by keyword",
        "crypto":      "Tap CryptoJS AES/DES/MD5/SHA family",
        "websocket":   "Trace WebSocket connect / send / recv",
        "canvas":      "Trace canvas.toDataURL with stack",
        "webgl":       "Trace getContext('webgl*')",
        "audio":       "Trace new OfflineAudioContext (fingerprinting)",
        "navigator":   "Tap navigator.{ua, plugins, webdriver, …} getter access",
        "fingerprint": "All-in-one canvas+audio+navigator fingerprint probe",
    }
    return [{"name": n, "purpose": purpose[n]} for n in HOOK_TEMPLATES]


@mcp.tool()
def hook_render(template: str, params: dict[str, str] | None = None) -> str:
    """Render a hook template with `{KEY}` placeholders substituted.

    Args:
        template: one of the names returned by hook_templates.
        params:   substitution map — e.g. {"TARGET": "window.byted_acrawler.sign",
                                            "LABEL":  "acrawler",
                                            "URL_KEYWORD": "/aweme/v1/web/"}.
                  Any unfilled `{KEY}` stays literal so you spot what you missed.

    Returns:
        A ready-to-paste IIFE JavaScript snippet.
    """
    if template not in HOOK_TEMPLATES:
        raise ValueError(
            f"unknown template '{template}'. Available: {sorted(HOOK_TEMPLATES)}"
        )
    src = HOOK_TEMPLATES[template]
    for k, v in (params or {}).items():
        src = src.replace("{" + k + "}", str(v))
    return src


@mcp.tool()
def case_template() -> str:
    """Return the markdown template for the case library (use after Phase 5)."""
    tpl = REPO_ROOT / "cases" / "_template.md"
    if tpl.exists():
        return tpl.read_text(encoding="utf-8")
    return "# Case template missing — check the repo's cases/_template.md"


@mcp.tool()
def cookies_schema_template() -> dict[str, Any]:
    """Return the JSON schema for persisting a target site's cookies (v1.1 — gap-3).

    Use this as the structure for `config/cookies.json` in every reverse-eng project.
    Categorizes cookies into 4 buckets so future you knows which ones break what:

      - _critical_login    : kill these → 401/-101 unauthorized
      - _critical_signing  : kill these → all signatures invalid
      - _static            : long-lived constants, OK to hardcode
      - _runtime           : refresh per request, do NOT hardcode

    Always capture from a 200-OK protected endpoint (e.g. /user/me), NOT from
    document.cookie (which misses HttpOnly cookies like web_session / sessionid).

    NOTE (v1.2): for sites that mix cookie + localStorage in signing inputs
    (xiaohongshu uses `b1` / `dsllt` from localStorage), prefer
    `state_schema_template()` which adds local/session storage buckets.
    """
    return {
        "captured_at":   "<ISO 8601 timestamp>",
        "source":        "<URL of the 200-OK request used to capture this>",
        "user":          {"user_id": "...", "nickname": "..."},
        "ua":            "<User-Agent string from that request>",
        "cookie_string": "<raw Cookie header value, used as-is when re-sending>",
        "cookies": {
            "_critical_login":   {"<key>": "<value>", "_doc": "Without these → 401"},
            "_critical_signing": {"<key>": "<value>", "_doc": "Without these → sig invalid"},
            "_static":           {"<key>": "<value>", "_doc": "Long-lived, OK to hardcode"},
            "_runtime":          {"<key>": "<value>", "_doc": "Refreshed each request"},
        },
        "notes": [
            "HttpOnly cookies (web_session / sessionid / SESSDATA) MUST be captured",
            "  from a successful network request's headers — JS cannot see them.",
            "Save the entire cookie string verbatim — server may check unknown keys.",
        ],
    }


@mcp.tool()
def state_schema_template() -> dict[str, Any]:
    """Return the JSON schema for FULL state persistence — cookies + localStorage +
    sessionStorage + window globals (v1.2 — gap-14).

    Use this when the target site mixes browser state across storage layers in
    its signing inputs. Real-world examples from cases/:

      - 小红书 x-s-common reads `b1` (1.5KB device fp), `dsllt`, `p1` from
        localStorage and `window._dsl` constant. Cookie-only dump would miss
        all of them and produce invalid signatures.

      - 抖音 webmssdk reads `xmst` from sessionStorage as nonce input.

    Capture sequence in Phase 0:
      1. trigger a 200-OK protected endpoint (verify login)
      2. dump cookies from that request's Headers (HttpOnly OK)
      3. evaluate_script over the page to dump localStorage + sessionStorage
      4. evaluate_script to read suspected signing-related window globals
    """
    return {
        "captured_at":   "<ISO 8601 timestamp>",
        "source":        "<URL of the 200-OK request used>",
        "user":          {"user_id": "...", "nickname": "..."},
        "ua":            "<User-Agent>",
        "cookie_string": "<raw Cookie header>",
        "cookies": {
            "_critical_login":   {"_doc": "Without these → 401", "<key>": "<val>"},
            "_critical_signing": {"_doc": "Without these → sig invalid", "<key>": "<val>"},
            "_static":           {"_doc": "Long-lived constants", "<key>": "<val>"},
            "_runtime":          {"_doc": "Refresh per request", "<key>": "<val>"},
        },
        "localStorage": {
            "_critical_signing": {
                "_doc": "Keys participating in signature inputs (b1/dsllt/p1/etc)",
                "<key>": "<value>",
            },
            "_state": {
                "_doc": "Per-user state (search history, settings); skip if too large",
                "<key>": "<value>",
            },
        },
        "sessionStorage": {
            "_doc": "Per-tab state including nonce/counters used in signing",
            "<key>": "<value>",
        },
        "window_globals": {
            "_doc": "Suspected signing-related globals (window._dsl/xsecappid/...)",
            "<key>": "<value>",
        },
        "notes": [
            "Phase 0 capture: dump cookies + localStorage + sessionStorage + window in ONE go.",
            "For each storage key with >500 bytes, store a head + length marker only.",
            "Map each key back to its role in cases/_template.md ef-field-mapping table.",
        ],
    }


@mcp.tool()
def storage_dump_snippet(domain: str = "") -> str:
    """Return the canonical evaluate_script snippet to dump localStorage +
    sessionStorage + suspected signing globals in one shot (v1.2 — gap-14).

    Args:
        domain: optional target hint. If given, includes site-specific suspected
                signing globals (window._dsl for xiaohongshu, msToken for douyin).
    """
    site_globals = {
        "xiaohongshu.com": ["_dsl", "xsecappid", "xsecappvers", "xsecplatform",
                             "anti_hp_sign_config", "_webmsxyw", "mnsv2",
                             "xhsFingerprintV3", "__rap_app_id__"],
        "douyin.com":      ["msToken", "byted_acrawler", "_signature_function"],
        "tiktok.com":      ["msToken", "_signature_function", "byted_acrawler"],
    }
    key = domain.lower().strip()
    _alias = {"xhs": "xiaohongshu.com", "redbook": "xiaohongshu.com",
              "dy": "douyin.com", "tt": "tiktok.com"}
    site = _alias.get(key, key)
    globals_hint = site_globals.get(site, [])
    globals_js = json.dumps(globals_hint)

    return f"""// Phase 0 全状态 dump — paste into chrome-devtools / js-reverse evaluate_script
(() => {{
  const out = {{ captured_at: new Date().toISOString(), url: location.href, ua: navigator.userAgent }};

  // 1. localStorage
  out.localStorage = {{}};
  for (const k of Object.keys(localStorage)) {{
    const v = localStorage.getItem(k);
    out.localStorage[k] = v && v.length > 500
      ? {{ _truncated: true, length: v.length, head: v.slice(0, 100) }}
      : v;
  }}

  // 2. sessionStorage
  out.sessionStorage = {{}};
  for (const k of Object.keys(sessionStorage)) {{
    const v = sessionStorage.getItem(k);
    out.sessionStorage[k] = v && v.length > 500
      ? {{ _truncated: true, length: v.length, head: v.slice(0, 100) }}
      : v;
  }}

  // 3. document.cookie (JS-visible only — HttpOnly cookies must come from Network panel)
  out.cookie_string_js_visible = document.cookie;

  // 4. suspected signing globals
  const suspected = {globals_js};
  const auto_match = Object.keys(window).filter(k =>
    /^(_?webms|sign|mns|byted|sec|wsg|rgv|xsec|__rap|anti_hp|fingerprint)/i.test(k)
  );
  out.window_signing_globals = {{}};
  for (const k of [...new Set([...suspected, ...auto_match])].slice(0, 40)) {{
    try {{
      const v = window[k];
      if (typeof v === 'function') {{
        const src = v.toString();
        out.window_signing_globals[k] = {{
          type: 'function',
          src_len: src.length,
          src_head: src.slice(0, 150),
          is_native: /\\[native code\\]/.test(src),
        }};
      }} else if (typeof v === 'object' && v !== null) {{
        out.window_signing_globals[k] = {{ type: 'object', keys: Object.keys(v).slice(0, 30) }};
      }} else {{
        out.window_signing_globals[k] = {{ type: typeof v, value: String(v).slice(0, 200) }};
      }}
    }} catch(e) {{}}
  }}

  return out;
}})()
"""


# ── Domain atlas (v1.1 — gap-4) ────────────────────────────────────────────

_DOMAIN_ATLAS: dict[str, dict[str, str]] = {
    "xiaohongshu.com": {
        "edith.xiaohongshu.com":   "主业务 (user/me, search/notes, feed, comment) — 签名接口都在这",
        "so.xiaohongshu.com":      "搜索副 (history/sync, dqa/recommend, worldcup) — 部分要签名",
        "as.xiaohongshu.com":      "安全 SDK 上报 (sec/v1/scripting, sec/v1/sbtsource, p/pj) — 风控埋点，可忽略",
        "t2.xiaohongshu.com":      "通用埋点上报 (v2/collect) — 高频噪声，过滤掉",
        "apm-fe.xiaohongshu.com":  "前端性能上报 (api/data) — 噪声",
        "pages.xiaohongshu.com":   "静态配置 (sem_sdk, xhs_pc_nps) — 配置 JSON",
        "fe-static.xhscdn.com":    "前端 JS bundle (library-*.js, vendor-*.js, page-*.js) — 源码都在这",
        "fe-platform.xhscdn.com":  "运营图片 / 二维码",
        "sns-webpic-qc.xhscdn.com":"用户上传图片 CDN",
        "_signature_apis_hint":    "anti_hp_sign_config.signIncludesUrl 列出真正要签的接口",
    },
    "douyin.com": {
        "www.douyin.com":          "网页前端",
        "www-hj.douyin.com":       "服务端 (推荐/搜索/用户)",
        "mcs.zijieapi.com":        "埋点上报",
        "sf16-website-login.neutral.ttwstatic.com": "静态资源",
        "_signature_apis_hint":    "/aweme/v1/web/* 路径都要 X-Bogus / a_bogus / _signature",
    },
    "tiktok.com": {
        "www.tiktok.com":          "网页前端",
        "m.tiktok.com":            "移动 web",
        "webcast.tiktok.com":      "直播 API",
        "mssdk-va.tiktokv.com":    "msToken SDK",
        "_signature_apis_hint":    "_signature + msToken + X-Bogus 三件套",
    },
    "bilibili.com": {
        "www.bilibili.com":        "网页前端",
        "api.bilibili.com":        "主 API (video, user, dm)",
        "api.live.bilibili.com":   "直播 API",
        "passport.bilibili.com":   "登录 / OAuth",
        "data.bilibili.com":       "弹幕分析",
        "_signature_apis_hint":    "wbi_img_key + sub_key + wts (w_rid 签名)",
    },
    "jd.com": {
        "www.jd.com":              "首页",
        "search.jd.com":           "搜索",
        "item.jd.com":             "商品详情",
        "api.m.jd.com":            "H5 API (要 H5ST 签名)",
        "_signature_apis_hint":    "H5ST 4 段签名，京东集团统一风控",
    },
    "weibo.com": {
        "weibo.com":               "网页",
        "passport.weibo.com":      "登录",
        "api.weibo.com":           "开放 API",
        "_signature_apis_hint":    "S 头 + Cookie SUB/SUBP 校验",
    },
    "zhihu.com": {
        "www.zhihu.com":           "网页",
        "api.zhihu.com":           "移动 API",
        "_signature_apis_hint":    "x-zse-93 / x-zse-96 头",
    },
}


@mcp.tool()
def domain_atlas(domain: str = "") -> dict[str, Any]:
    """Look up subdomain responsibilities for a target site (v1.1 — gap-4).

    Reverse-eng targets often spread across 5-10 subdomains, each with a
    different role (main API, security SDK, telemetry, CDN, ...). This tool
    returns a quick-reference table so you can filter Network panel noise and
    head straight to the signature-bearing main API.

    Args:
        domain: site root (e.g. "xiaohongshu.com"). Pass "" to list every
                site in the atlas. Substring match is OK ("xhs" → xiaohongshu).

    Returns:
        {"domain": "...", "subdomains": {sub: role, ...}}  or
        {"domains_known": [...]}                            if no match.
    """
    if not domain:
        return {"domains_known": sorted(_DOMAIN_ATLAS)}
    key = domain.lower().strip()
    # exact match
    if key in _DOMAIN_ATLAS:
        return {"domain": key, "subdomains": _DOMAIN_ATLAS[key]}
    # alias / substring match
    _alias = {"xhs": "xiaohongshu.com", "redbook": "xiaohongshu.com",
              "dy": "douyin.com", "tt": "tiktok.com", "bili": "bilibili.com",
              "wb": "weibo.com", "zh": "zhihu.com"}
    if key in _alias:
        k = _alias[key]
        return {"domain": k, "subdomains": _DOMAIN_ATLAS[k]}
    for k in _DOMAIN_ATLAS:
        if key in k or k in key or key.replace(".com", "") in k:
            return {"domain": k, "subdomains": _DOMAIN_ATLAS[k]}
    return {
        "domain": domain,
        "match": None,
        "domains_known": sorted(_DOMAIN_ATLAS),
        "hint": "no entry yet — consider contributing one back via the case template",
    }


# ─────────────────────────── Phase 4 env-patch workbench ──────────────────
#
# Rule 34 (SKILL.md): 补环境是必经站, 纯算是奖励. 这 5 个工具把"手写补环境"
# 变成"装配补环境": scaffold → diff_snippet → minimize → verify_harness →
# algo_translate_hint. 串起来就是 Phase 4 的 Step 1-5.

TEMPLATES_ROOT = REPO_ROOT / "templates" / "env-patch"
HOOKS_ROOT     = REPO_ROOT / "hooks"


@mcp.tool()
def env_patch_scaffold(
    project_name: str,
    target_domain: str,
    out_dir: str = "",
) -> dict[str, Any]:
    """Materialize a ready-to-run Node.js env-patch project (Rule 34, Step 2-3).

    Writes:
      <out_dir>/<project_name>/
        package.json   runner.js   verify.js   env_diff.js   stub.js
        README.md
        config/sign-source.js   config/samples.json

    The user only needs to: (a) paste the extracted signer into
    config/sign-source.js, (b) replace REPLACE-WITH-BROWSER-CAPTURE in
    config/samples.json with real headers from Network panel.

    Args:
        project_name : kebab-case dir name, e.g. "xhs-x-s-signer".
        target_domain: e.g. "xiaohongshu.com" — used in stub UA/cookie defaults.
        out_dir      : parent dir (default = current working dir).

    Returns:
        {"project_dir": "<abs path>", "files": [list], "next_steps": [...]}
    """
    if not TEMPLATES_ROOT.exists():
        raise RuntimeError(
            f"templates/env-patch missing at {TEMPLATES_ROOT}. "
            "Reinstall the skill — this dir ships with the repo."
        )
    parent = Path(out_dir).resolve() if out_dir else Path.cwd()
    target = parent / project_name
    if target.exists():
        raise FileExistsError(
            f"{target} already exists. Remove it or pick another project_name."
        )

    written: list[str] = []
    for src in TEMPLATES_ROOT.rglob("*"):
        if src.is_dir():
            continue
        rel = src.relative_to(TEMPLATES_ROOT)
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text(encoding="utf-8")
        text = (text.replace("{PROJECT_NAME}", project_name)
                    .replace("{TARGET_DOMAIN}", target_domain))
        dst.write_text(text, encoding="utf-8")
        written.append(str(dst.relative_to(parent)))

    return {
        "project_dir": str(target),
        "files": sorted(written),
        "next_steps": [
            "1. paste extracted signer into config/sign-source.js (must end with window.__sign__ = fn)",
            "2. capture browser truth → fill config/samples.json {input, expected} pairs",
            "3. node runner.js          # first failure points to missing env field",
            "4. node verify.js          # iterate until byte-byte match",
            "5. paste env_diff_snippet() in browser → save to config/browser-env.json → node env_diff.js",
            "6. once all green: call algo_translate_hint() to plan the Python pure-algo port",
        ],
    }


@mcp.tool()
def env_diff_snippet(extra_globals: list[str] | None = None) -> str:
    """Return a browser-side probe (IIFE) — paste into DevTools console and the
    result is the exact JSON your stub.js needs to mimic (Rule 17).

    The snippet dumps:
      - navigator: 20 fingerprintable getters
      - screen / window: layout + DPR
      - document: hasFocus + readyState + cookie (JS-visible only)
      - location: full URL parts
      - storage: localStorage + sessionStorage keys (with truncation for >500B)
      - performance.timing keys (signers sometimes use timeOrigin / now())
      - extra_globals: any window.* names you suspect (small_red_book_dsl, msToken, ...)

    Save the resulting JSON to your env-patch project as config/browser-env.json.
    Then `node env_diff.js` shows you what stub.js is missing.

    Args:
        extra_globals: site-specific window keys to dump (added on top of defaults).
    """
    extras = json.dumps(extra_globals or [])
    return f"""// env_diff probe — paste into DevTools console of the target page
// (run AFTER any login / nav to a protected page so all signing globals are loaded)
(() => {{
  const out = {{ captured_at: new Date().toISOString(), url: location.href }};

  // navigator
  out.navigator = {{}};
  for (const k of ['userAgent','platform','language','languages','hardwareConcurrency',
                   'deviceMemory','webdriver','vendor','appVersion','product','productSub',
                   'cookieEnabled','doNotTrack','maxTouchPoints','onLine','oscpu','buildID',
                   'plugins','mimeTypes','connection','permissions']) {{
    try {{
      const v = navigator[k];
      if (v == null) {{ out.navigator[k] = v; continue; }}
      if (typeof v === 'function') {{ out.navigator[k] = '[function]'; continue; }}
      if (typeof v === 'object') {{
        out.navigator[k] = {{ _type: v.constructor && v.constructor.name, _len: v.length, keys: Object.keys(v).slice(0,10) }};
      }} else {{ out.navigator[k] = v; }}
    }} catch(e) {{ out.navigator[k] = '<throw>'; }}
  }}

  // screen + window
  out.screen = {{}};
  for (const k of ['width','height','availWidth','availHeight','colorDepth','pixelDepth','orientation']) {{
    try {{ out.screen[k] = String(screen[k]); }} catch(e) {{}}
  }}
  out.window = {{
    innerWidth: innerWidth, innerHeight: innerHeight, outerWidth: outerWidth, outerHeight: outerHeight,
    devicePixelRatio: devicePixelRatio, scrollX: scrollX, scrollY: scrollY,
    chrome: typeof window.chrome,
  }};

  // document
  out.document = {{
    readyState: document.readyState, hidden: document.hidden, visibilityState: document.visibilityState,
    domain: document.domain, title: document.title, hasFocus: document.hasFocus(),
    cookie_js_visible: document.cookie,
  }};

  // location
  out.location = {{}};
  for (const k of ['href','origin','protocol','host','hostname','pathname','search','hash','port']) {{
    out.location[k] = String(location[k]);
  }}

  // localStorage / sessionStorage (truncate big values)
  function dumpStorage(s) {{
    const o = {{}};
    for (const k of Object.keys(s)) {{
      const v = s.getItem(k);
      o[k] = v && v.length > 500 ? {{_truncated: true, len: v.length, head: v.slice(0,100)}} : v;
    }}
    return o;
  }}
  out.localStorage   = dumpStorage(localStorage);
  out.sessionStorage = dumpStorage(sessionStorage);

  // performance (sign timestamps often come from here)
  out.performance = {{
    timeOrigin: performance.timeOrigin,
    nowSample:  performance.now(),
    timing_keys: performance.timing ? Object.keys(JSON.parse(JSON.stringify(performance.timing))) : null,
  }};

  // extra globals suspected of signing role
  out.extra_globals = {{}};
  const suspects = {extras}.concat(Object.keys(window).filter(k =>
    /^(_?webms|sign|mns|byted|sec|wsg|rgv|xsec|__rap|anti_hp|fingerprint|jsvmp)/i.test(k)));
  for (const k of [...new Set(suspects)].slice(0, 50)) {{
    try {{
      const v = window[k];
      if (typeof v === 'function') {{
        const s = v.toString();
        out.extra_globals[k] = {{ type: 'function', src_len: s.length,
                                  is_native: /\\[native code\\]/.test(s),
                                  src_head: s.slice(0, 200) }};
      }} else if (v && typeof v === 'object') {{
        out.extra_globals[k] = {{ type: 'object', keys: Object.keys(v).slice(0, 30) }};
      }} else {{
        out.extra_globals[k] = {{ type: typeof v, value: String(v).slice(0, 200) }};
      }}
    }} catch(e) {{}}
  }}

  copy(JSON.stringify(out, null, 2));     // ← Chrome DevTools: copies to clipboard
  console.log('[env_diff] dumped', Object.keys(out).length, 'sections, copied to clipboard');
  return out;
}})()"""


@mcp.tool()
def env_patch_minimize(
    trace_log: list[dict[str, Any]],
    keep_top_n: int = 50,
) -> dict[str, Any]:
    """Compress a property-access trace (from hooks/property_access_hook.js or
    runtime_probe.js or instrumentation log) into the SHORTEST stub.js you can
    get away with (Rule 9: only patch what the signer actually reads).

    Input format (any one works — autodetect by keys):
      [{"property":"navigator.userAgent","value":"...","timestamp":...}, ...]
      [{"type":"nav_read","prop":"userAgent","value":"...","ts":...}, ...]
      [{"type":"tap_get","path":"document.cookie","value":"..."}, ...]

    Output:
      {
        "by_object": {
          "navigator": [{"key":"userAgent","reads":12,"sample":"Mozilla/..."}, ...],
          "document":  [...],
          "window":    [...],
          "localStorage": [...],
        },
        "stub_patch_js": "// drop-in additions for stub.js\\nnavigator.userAgent = '...';\\n...",
        "dropped_n_unique": <int>,    # properties accessed but truncated past keep_top_n
        "audit": "..."                # one-line summary
      }

    The stub_patch_js value is paste-ready — append it to stub.js and rerun
    verify.js. If it still fails, your trace was incomplete — re-run the
    probe with more interactions.

    Args:
        trace_log : list of access events (any of the three schemas above).
        keep_top_n: cap per-object property count (most-accessed first).
    """
    by_object: dict[str, dict[str, dict[str, Any]]] = {}
    for ev in trace_log:
        # normalize to (path, value)
        if "property" in ev:
            path = str(ev["property"])
            val  = ev.get("value")
        elif "prop" in ev and ev.get("type") == "nav_read":
            path = "navigator." + str(ev["prop"])
            val  = ev.get("value")
        elif "path" in ev and ev.get("type") in ("tap_get", "tap_method", "get"):
            path = str(ev["path"])
            val  = ev.get("value")
        else:
            continue
        if "." not in path:
            continue
        obj, _, key = path.partition(".")
        slot = by_object.setdefault(obj, {}).setdefault(key, {"reads": 0, "sample": None})
        slot["reads"] += 1
        if slot["sample"] is None and val is not None:
            slot["sample"] = str(val)[:200]

    # rank + cap
    ranked: dict[str, list[dict[str, Any]]] = {}
    dropped = 0
    for obj, keys in by_object.items():
        items = sorted(
            ({"key": k, **v} for k, v in keys.items()),
            key=lambda r: r["reads"], reverse=True,
        )
        ranked[obj] = items[:keep_top_n]
        dropped += max(0, len(items) - keep_top_n)

    # emit drop-in stub patch
    lines = ["// === env_patch_minimize OUTPUT — append to stub.js ===",
             "// Only includes properties confirmed read by the signer trace.", ""]
    for obj in ("navigator", "document", "window", "location", "screen"):
        if obj not in ranked:
            continue
        lines.append(f"// {obj}")
        for r in ranked[obj]:
            sample = r["sample"]
            if sample is None:
                lit = "null  // never observed a value; probably called as method"
            else:
                # try JSON literal; fall back to string
                try:
                    json.loads(sample); lit = sample
                except Exception:
                    lit = json.dumps(sample)
            lines.append(f"{obj}.{r['key']} = {lit};   // read x{r['reads']}")
        lines.append("")

    for obj in ("localStorage", "sessionStorage"):
        if obj not in ranked:
            continue
        lines.append(f"// {obj} — set via .setItem")
        for r in ranked[obj]:
            sample = r["sample"] if r["sample"] is not None else ""
            lines.append(f"{obj}.setItem({json.dumps(r['key'])}, {json.dumps(sample)});  // read x{r['reads']}")
        lines.append("")

    total_unique = sum(len(v) for v in by_object.values())
    audit = (f"observed {len(trace_log)} access events covering "
             f"{total_unique} unique properties across {len(by_object)} root objects; "
             f"kept top {sum(len(v) for v in ranked.values())}, dropped {dropped}.")

    return {
        "by_object": ranked,
        "stub_patch_js": "\n".join(lines),
        "dropped_n_unique": dropped,
        "audit": audit,
    }


@mcp.tool()
def signer_verify_harness(
    project_name: str = "signer-test",
    sample_count: int = 5,
) -> str:
    """Return a self-contained Node.js verify harness — drop-in alternative to
    the verify.js that ships in env_patch_scaffold's template, but standalone
    (no project layout assumed). Useful when you already have a signer file and
    samples elsewhere.

    Output is a single .js file. Usage:
        node verify.js path/to/signer.js path/to/samples.json

    samples.json schema:
        [{"id":"...", "input": <any>, "expected": <any>}, ...]

    The harness:
      - loads signer.js inside vm.runInContext with a minimal env (re-exports
        global.__sign__)
      - byte-byte compares JSON.stringify(actual) vs JSON.stringify(expected)
      - on miss: reports first divergent character index + 30-char context
      - exit code 0 if all pass, 1 otherwise

    Args:
        project_name : informational only — embedded in the harness header.
        sample_count : informational only — used in summary log.
    """
    return f"""// signer_verify_harness — generated by reverse-engineering-skill
// project: {project_name} (expected sample_count: {sample_count})
// usage:  node verify.js <signer.js> <samples.json>

'use strict';
const fs = require('fs');
const vm = require('vm');

if (process.argv.length < 4) {{
  console.error('usage: node verify.js <signer.js> <samples.json>');
  process.exit(2);
}}
const signerSrc = fs.readFileSync(process.argv[2], 'utf8');
const samples   = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));

// minimal stub — signer should NOT need network or DOM if you extracted it cleanly
const window = {{}}; window.window = window; window.self = window;
const navigator = {{ userAgent: 'Mozilla/5.0', platform: 'Win32', language: 'zh-CN', webdriver: false }};
window.navigator = navigator;
const document  = {{ cookie: '', referrer: '', URL: '', readyState: 'complete', hasFocus: () => true }};
window.document = document;
const location  = {{ href: '', origin: '', protocol: 'https:', host: '', pathname: '/', search: '', hash: '' }};
window.location = location;
window.localStorage   = {{ getItem: () => null, setItem: () => {{}}, removeItem: () => {{}} }};
window.sessionStorage = window.localStorage;
window.btoa = s => Buffer.from(s, 'binary').toString('base64');
window.atob = s => Buffer.from(s, 'base64').toString('binary');

const ctx = vm.createContext(Object.assign({{ console, Buffer, setTimeout, clearTimeout }}, {{ window, navigator, document, location }}));
vm.runInContext(signerSrc, ctx, {{ filename: 'signer.js', timeout: 5000 }});

const signer = ctx.window.__sign__ || ctx.__sign__;
if (typeof signer !== 'function') {{
  console.error('signer.js must expose window.__sign__ = function(input) {{...}}');
  process.exit(2);
}}

let pass = 0, fail = 0;
const failures = [];
for (const s of samples) {{
  let actual, err;
  try {{ actual = signer(s.input); }} catch (e) {{ err = e; }}
  if (err) {{
    fail++; failures.push({{ id: s.id, kind: 'exception', message: err.message }});
    continue;
  }}
  const a = JSON.stringify(actual), e = JSON.stringify(s.expected);
  if (a === e) {{ pass++; continue; }}
  let i = 0;
  while (i < a.length && i < e.length && a[i] === e[i]) i++;
  fail++;
  failures.push({{
    id: s.id, first_divergence_at: i,
    actual_around:   a.slice(Math.max(0, i-30), i+30),
    expected_around: e.slice(Math.max(0, i-30), i+30),
    actual_len: a.length, expected_len: e.length,
  }});
}}

console.log('\\n=== ' + pass + '/' + (pass+fail) + ' pass ===\\n');
if (failures.length) {{ console.log(JSON.stringify(failures, null, 2)); process.exit(1); }}
"""


@mcp.tool()
def algo_translate_hint(
    by_object_summary: dict[str, list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Given an env_patch_minimize "by_object" report, plan the JS → Python pure-algo
    port (Rule 34 Step 5). Categorizes each env read into:

      - constant     : same value across all signatures → hard-code in Python
      - per_request  : changes per call but derivable from input (timestamps, nonces) → compute in Python
      - opaque       : depends on browser/device state (UA, plugins, cookies) → carry verbatim
      - method_call  : signer called this as a function (toString/JSON.stringify/etc) → re-implement

    Output is a checklist you walk top-down. Anything in `opaque` you keep in
    config; everything else either becomes a Python literal or 3 lines of code.

    Args:
        by_object_summary: the "by_object" field returned by env_patch_minimize.
                           Pass None to get the rubric-only version.

    Returns:
        {"plan": [...], "estimated_lines_python": int, "rubric": "..."}
    """
    rubric = (
        "READ TYPES: "
        "constant (UA/platform/language → 1-line Python literal) | "
        "per_request (Date.now/random/path → 3-line compute) | "
        "opaque (cookie/localStorage[b1]/xhsFingerprintV3 → keep in config, never derive) | "
        "method_call (JSON.stringify/btoa/CryptoJS.MD5 → use Python stdlib equivalent)"
    )
    if not by_object_summary:
        return {
            "plan": [],
            "estimated_lines_python": 0,
            "rubric": rubric,
            "hint": "call env_patch_minimize first, pass its 'by_object' field back here",
        }

    plan: list[dict[str, Any]] = []
    py_lines = 0
    _constant_words = ("Mozilla", "Win32", "MacIntel", "Linux", "zh-CN", "en-US",
                       "Google Inc.", "Gecko", "Chrome", "true", "false")
    for obj, items in by_object_summary.items():
        for r in items:
            key = r["key"]; sample = r.get("sample"); reads = r.get("reads", 1)
            if obj in ("localStorage", "sessionStorage") or (obj == "document" and key == "cookie"):
                cat = "opaque"; advice = f"carry from config['{obj}']['{key}']"; lines = 1
            elif sample and any(w in str(sample) for w in _constant_words):
                cat = "constant"; advice = f"ENV['{obj}.{key}'] = {json.dumps(sample)}"; lines = 1
            elif key in ("now", "Date", "random", "performance"):
                cat = "per_request"; advice = "compute fresh each call (time.time()*1000 / secrets.token_hex)"; lines = 2
            elif sample is None:
                cat = "method_call"; advice = "find Python stdlib equivalent (hashlib/hmac/json/base64)"; lines = 3
            else:
                cat = "opaque"; advice = "treat as opaque input; carry verbatim from samples"; lines = 1
            plan.append({"path": f"{obj}.{key}", "reads": reads, "category": cat,
                         "sample": sample, "advice": advice, "py_lines": lines})
            py_lines += lines

    plan.sort(key=lambda r: (r["category"], -r["reads"]))
    return {
        "plan": plan,
        "estimated_lines_python": py_lines,
        "rubric": rubric,
        "next_step": ("Walk plan top-down. Each 'constant' becomes a Python literal; "
                      "each 'per_request' is computed in sign(); each 'opaque' lives "
                      "in config.json and is read but never derived. If estimated "
                      "lines > 200, the algo is too entangled — stay on env-patch."),
    }


@mcp.tool()
def hook_assets_list() -> dict[str, Any]:
    """List the 10 bundled hook JS files (shipped with the skill at hooks/).

    These are ready-to-paste IIFE scripts used by env-patch / JSVMP analysis.
    Use hook_assets_get(name) to fetch the full body.

    Sources: adapted from camoufox-reverse-mcp hooks (MIT) + reverse-agent.
    """
    if not HOOKS_ROOT.exists():
        return {"hooks_dir": str(HOOKS_ROOT), "files": [], "note": "hooks dir missing"}
    items = []
    purpose = {
        "property_access_hook.js":     "Proxy navigator/document/window — log every property read with stack",
        "runtime_probe.js":            "Low-overhead universal probe (XHR/fetch/canvas/webgl/navigator/events)",
        "jsvmp_hook.js":               "JSVMP interpreter Proxy mode — full trace",
        "jsvmp_transparent_hook.js":   "JSVMP transparent passthrough — no Proxy, won't break signatures",
        "crypto_hook.js":              "CryptoJS / WebCrypto digest tap",
        "xhr_hook.js":                 "XMLHttpRequest open/send + setRequestHeader log",
        "fetch_hook.js":               "window.fetch + Request body log",
        "cookie_hook.js":              "document.cookie get/set trap",
        "websocket_hook.js":           "WebSocket connect/send/recv log",
        "debugger_trap.js":            "Bypass debugger; statements anti-debug guards",
    }
    for p in sorted(HOOKS_ROOT.glob("*.js")):
        items.append({"name": p.name, "size": p.stat().st_size,
                      "purpose": purpose.get(p.name, "")})
    return {"hooks_dir": str(HOOKS_ROOT), "files": items}


@mcp.tool()
def hook_assets_get(name: str) -> str:
    """Return the full content of one bundled hook file by name.

    Pass the name from hook_assets_list (e.g. "property_access_hook.js").
    Result is a paste-ready IIFE — drop into DevTools console or
    chrome-devtools__evaluate_script / js-reverse__evaluate_script.

    Some hooks contain {{TARGETS}} / {{URL_PATTERN}} placeholders — substitute
    them yourself (the placeholder syntax is double-brace so JS template
    literals don't choke).
    """
    p = HOOKS_ROOT / name
    if not p.exists() or not p.is_file() or p.suffix != ".js":
        raise FileNotFoundError(
            f"hook '{name}' not found. Available: "
            + ", ".join(sorted(x.name for x in HOOKS_ROOT.glob('*.js')))
        )
    return p.read_text(encoding="utf-8")


# ─────────────────────────── downstream MCP integration ───────────────────
#
# camoufox-reverse-mcp is a separate, heavy (~150MB browser binary) project but
# is THE recommended downstream MCP for strong-antibot sites (RS / Akamai / CF /
# DataDome). reverse-skill ships with the install helper, the recommended-config
# generator, and a tool atlas so the skill can orchestrate it without
# duplicating its codebase.

CAMOUFOX_TOOL_ATLAS: dict[str, list[dict[str, str]]] = {
    "browser_control": [
        {"name": "launch_browser",  "use": "启动 Camoufox(Firefox 内核 + C++ 指纹伪造), 支持 headless/proxy/geoip/humanize/enable_trace"},
        {"name": "close_browser",   "use": "关浏览器, 释放 trace context"},
        {"name": "navigate",        "use": "导航到 URL, wait_until=load/domcontentloaded/networkidle"},
        {"name": "reload",          "use": "重载当前页(保持 Hook 不失效)"},
        {"name": "reset_browser_state", "use": "清 cookie/storage, 不关进程"},
        {"name": "get_page_info",   "use": "拿当前 URL/title/redirect_chain(看 RS 412 链路)"},
    ],
    "interact_probe": [
        {"name": "click",           "use": "CSS selector 点击, 触发 SPA 路由"},
        {"name": "type_text",       "use": "模拟键盘输入(带 delay 防机器特征)"},
        {"name": "wait_for",        "use": "等元素/超时/网络空闲"},
        {"name": "take_screenshot", "use": "截图(full_page 或 selector)"},
        {"name": "take_snapshot",   "use": "a11y 树快照(给 AI 看页面结构)"},
        {"name": "get_console_logs","use": "拿浏览器 console 历史(看 Hook 输出)"},
    ],
    "script_analysis": [
        {"name": "scripts",         "use": "action=list/get/save 管理加载脚本(自动美化压缩代码)"},
        {"name": "search_code",     "use": "在所有 JS 里搜文本(JSVMP 200KB+ 必传 script_url 限定)"},
        {"name": "evaluate_js",     "use": "在页面 context 跑 JS(IIFE 包装, 多策略 JSON 解析)"},
    ],
    "hooking": [
        {"name": "hook_function",   "use": "mode=intercept/trace, 持久化 + 防覆盖 Hook 任意函数"},
        {"name": "inject_hook_preset", "use": "预置 Hook: xhr/fetch/crypto/websocket/cookie/debugger_bypass/runtime_probe"},
        {"name": "remove_hooks",    "use": "清 Hook (keep_persistent 选择性保留)"},
    ],
    "network": [
        {"name": "network_capture", "use": "action=start/stop, 开关网络录制"},
        {"name": "list_network_requests", "use": "查请求列表, urlFilter/resourceTypes 过滤"},
        {"name": "get_network_request",   "use": "拿单请求 Headers/Body 详情"},
        {"name": "get_request_initiator", "use": "拿请求的 JS 调用栈(签名追溯黄金路径)"},
        {"name": "intercept_request",     "use": "改请求/响应(测签名校验严格度)"},
        {"name": "analyze_cookie_sources","use": "分析每个 cookie 由谁 set(Set-Cookie 头 vs document.cookie= vs JS Hook)"},
    ],
    "storage": [
        {"name": "cookies",         "use": "action=get/set/delete, 批量 cookies_list"},
        {"name": "get_storage",     "use": "dump localStorage 或 sessionStorage"},
        {"name": "export_state",    "use": "存整个浏览器 context(cookie+storage+IDB)到文件"},
        {"name": "import_state",    "use": "导入 context, 复用登录态跳过登录"},
    ],
    "jsvmp_env_patch": [
        {"name": "hook_jsvmp_interpreter", "use": "JSVMP 解释器探针 mode=proxy(全 trace)/transparent(不破签名)"},
        {"name": "compare_env",     "use": "Camoufox 真实环境 vs Node/jsdom 全量 diff(补环境起点)"},
        {"name": "instrumentation", "use": "action=install/log/reload/stop, 源码级 AST 插桩(通用 VMP 利器)"},
        {"name": "check_environment","use": "环境健康检查(浏览器/Hook/网络状态)"},
        {"name": "verify_signer_offline", "use": "离线验证签名函数, samples 字符级 first_divergence 定位"},
    ],
    "engine_trace": [
        {"name": "trace_property_access", "use": "**C++ 引擎层属性追踪**(JSVMP 不可检测, 精准 5-10x compare_env), enable_trace=True 时可用"},
        {"name": "list_trace_files",      "use": "列历史 trace session 文件"},
        {"name": "query_trace_file",      "use": "按 prop/stack/time bucket 查询 trace 数据"},
    ],
}


@mcp.tool()
def camoufox_install_helper(host: str = "claude-code") -> dict[str, Any]:
    """Detect camoufox-reverse-mcp install status and emit a ready-to-paste host
    config snippet (v1.3 — downstream MCP integration).

    camoufox-reverse-mcp is THE recommended downstream MCP for strong-antibot
    sites (RS / Akamai / CF Turnstile / DataDome) where chrome-devtools won't
    even reach the page. It uses Camoufox (Firefox + C++ engine-level
    fingerprint spoofing) — fingerprints are forged BELOW the JS layer, so
    the page cannot detect them.

    What this helper does:
      1. Probe whether `camoufox_reverse_mcp` is importable in current Python
      2. Probe whether the Camoufox browser binary is downloaded (~150MB)
      3. Emit install commands for whatever is missing
      4. Emit a host config JSON snippet for the chosen MCP host

    Args:
        host: one of claude-code / claude-desktop / cursor / cline.

    Returns:
        {
          "python_pkg_installed":   bool,
          "browser_binary_present": bool,
          "install_steps":          [shell commands to run, in order],
          "host_config_snippet":    {...JSON to merge into host config...},
          "verify_command":         "...one-line probe after install...",
          "when_to_use":            "...short rubric...",
        }
    """
    import importlib.util, shutil, sys

    py_installed = importlib.util.find_spec("camoufox_reverse_mcp") is not None
    # camoufox CLI presence ≈ binary cache populated
    cam_cli = bool(shutil.which("camoufox"))

    # naive binary check: ~/.cache/camoufox or %LOCALAPPDATA%\camoufox
    home = Path.home()
    binary_paths = [home / ".cache" / "camoufox", home / "AppData" / "Local" / "camoufox"]
    binary_present = any(p.exists() and any(p.iterdir()) for p in binary_paths if p.exists())

    steps: list[str] = []
    if not py_installed:
        steps.append("pip install camoufox-reverse-mcp        # ~30s, installs MCP server + Playwright")
    if not binary_present:
        steps.append("python -m camoufox fetch                # ~150MB browser binary, one-time")
    if not steps:
        steps.append("# already installed — just merge host_config_snippet and restart host")

    # host-specific config snippets
    common_args = ["-m", "camoufox_reverse_mcp", "--headless"]
    proxy_hint  = '# add  "--proxy", "http://127.0.0.1:7890",  "--geoip", "--humanize"  for hard targets'

    snippets = {
        "claude-code": {
            "mcpServers": {
                "camoufox-reverse": {
                    "type": "stdio",
                    "command": "python",
                    "args": common_args,
                }
            }
        },
        "claude-desktop": {
            "mcpServers": {
                "camoufox-reverse": {
                    "command": "python",
                    "args": common_args,
                }
            }
        },
        "cursor": {
            "mcpServers": {
                "camoufox-reverse": {
                    "command": "python",
                    "args": common_args,
                }
            }
        },
        "cline": {
            "mcpServers": {
                "camoufox-reverse": {
                    "command": "python",
                    "args": common_args,
                    "disabled": False,
                }
            }
        },
    }
    host_key = host.lower().strip()
    if host_key not in snippets:
        raise ValueError(f"unknown host '{host}'. Choose: {sorted(snippets)}")

    return {
        "python_pkg_installed":   py_installed,
        "browser_binary_present": binary_present or cam_cli,
        "install_steps":          steps,
        "host_config_snippet":    snippets[host_key],
        "proxy_hint":             proxy_hint,
        "verify_command":         'python -c "import camoufox_reverse_mcp; print(camoufox_reverse_mcp.__name__, \'OK\')"',
        "when_to_use": (
            "MUST use camoufox when: RS 412 redirect chain, Akamai sensor_data, "
            "CF Turnstile challenge, DataDome JS challenge, sites loading sdenv*.js/"
            "acmescripts*.js, or any time chrome-devtools-mcp can't get past the "
            "initial page. SKIP camoufox when: pure axios sign + static cookie + "
            "no fingerprint check (~70% of small/medium sites) — chrome-devtools or "
            "js-reverse is faster."
        ),
        "after_install_next_step": (
            "Once camoufox is up, call mcp__camoufox-reverse__launch_browser "
            "{headless: false, enable_trace: true} → navigate(target_url) → "
            "trace_property_access(duration=60, mode='summary', collect_values=true). "
            "The 30-50 properties it returns are EXACTLY what stub.js needs to "
            "mimic — feed them straight to env_patch_minimize."
        ),
    }


@mcp.tool()
def chunk_dump_helper(
    base_url: str = "https://fe-static.xhscdn.com/formula-static/xhs-pc-web/public/resource/js",
    chunks: list[str] | None = None,
) -> dict[str, Any]:
    """
    Generate a fetch IIFE for dumping webpack chunk source code via chrome-devtools MCP.

    (v1.5) Workaround for js-reverse + chrome-devtools user-data-dir conflict.

    Args:
        base_url: CDN base prefix for chunks
        chunks: List of chunk filenames. Defaults to xhs Phase 4 Step 1 list.

    Returns:
        iife_js: Paste this into chrome-devtools evaluate_script() to dump all chunks
        curl_script: shell one-liner to download all chunks directly via curl
        default_chunks: the default chunk list used when chunks=None
    """
    if chunks is None:
        chunks = [
            "library-axios.1c2d8386.js",
            "vendor.1cedd4e6.js",
            "index.8c481e2a.js",
            "async/Track.2a7d06b0.js",
            "async/Search.f2b05949.js",
            "async/4291.065f6813.js",
            "async/395.6ce4f169.js",
            "async/6638.51a3911b.js",
            "async/7513.edf1808c.js",
            "async/8019.6ff0577f.js",
        ]

    iife_js = f"""
(async () => {{
  const chunks = {json.dumps(chunks)};
  const base = {json.dumps(base_url)};
  const out = {{}};
  for (const c of chunks) {{
    try {{
      const r = await fetch(base + '/' + c);
      out[c] = {{ size: r.headers.get('content-length'), status: r.status }};
    }} catch (e) {{
      out[c] = {{ error: String(e) }};
    }}
  }}
  return out;
}})();
""".lstrip("\n")

    curl = "mkdir -p vendor && \\\n"
    for c in chunks:
        curl += f'  curl -sSL "{base_url}/{c}" -o vendor/"{c.replace("/", "-")}" && \\\n'
    curl = curl.rstrip(" \\\n") + "\necho '=== all dumped ==>' && ls -l vendor/ | wc -l"

    return {
        "iife_js": iife_js,
        "curl_script": curl,
        "default_chunks": chunks,
    }


@mcp.tool()
def rap_hijacker_detector(
    xhr_send_src: str,
    fetch_src: str,
    set_header_src: str | None = None,
    web_msxyw_src: str | None = None,
) -> dict[str, Any]:
    """
    Detect RAP hijacker presence, takeover precision, and multi-trampoline tiers.

    (v1.5) Run probe first after Step 0 navigate — tells you exactly which
    functions are wrapped, which are native, and what your attack order should be.

    Args:
        xhr_send_src: String(XMLHttpRequest.prototype.send)
        fetch_src: String(window.fetch)
        set_header_src: Optional String(XMLHttpRequest.prototype.setRequestHeader)
        web_msxyw_src: Optional String(window._webmsxyw)

    Returns:
        takeover_summary: plaintext verdict
        attack_order: list of trampolines by difficulty (ascending: attack first)
        trampolines: per-trampoline metadata
    """
    import re

    sabo = bool(re.search(r"_sabo_\w+", xhr_send_src))
    ace  = bool(re.search(r"_ace_\w+", web_msxyw_src or ""))
    ox   = bool(re.search(r"_\w+x_\w+", web_msxyw_src or ""))
    native_sh = "native code" in (set_header_src or "")

    tiers = []
    if web_msxyw_src:
        tiers.append({
            "name":    "_webmsxyw / _ace_* (small trampoline)",
            "len":     len(web_msxyw_src),
            "pattern": "_ace_*",
            "is_decoy": True,
            "difficulty": "2-3h",
            "tools": "babel AST deobfuscate, dump closure",
            "attack_order": 1,
        })
    if sabo:
        tiers.append({
            "name":    "Sanji / _sabo_* (big bytecode VM)",
            "len":     len(xhr_send_src),
            "pattern": "_sabo_eb61 / _sabo_d156d / _sabo_*",
            "is_decoy": False,
            "difficulty": ">= 1 day",
            "tools": "chrome breakpoint at dispatcher, dump w bytecode + M handler table",
            "attack_order": 3 if len(xhr_send_src) < 200 else 3,
        })

    takeover = (
        f"XHR.send : {'TRAMPOLINE _sabo_*' if sabo else 'native / unknown'} (len={len(xhr_send_src)})"
        f"\nwindow.fetch : {'SAME TRAMPOLINE' if fetch_src == xhr_send_src else 'native / unknown'} (len={len(fetch_src)})"
        f"\nXHR.setRequestHeader : {'NATIVE [not hijacked]' if native_sh else 'HOOKED'}"
    )

    summary = (
        f"RAP hijacker PRESENT: {sabo}"
        f"\nPrecision: {'send/fetch only, setHeader native' if sabo and native_sh else 'unknown'}"
        f"\nMulti-trampoline count: {len(tiers)} (_ace_ decoy + _sabo_ production = typical xhs pattern)"
        f"\nRule 37: attack smallest difficulty first -- if _ace_ decoy output is accepted by backend, STOP"
    )

    attack_order = sorted(tiers, key=lambda t: t["attack_order"])
    return {
        "takeover_summary_lines": takeover.split("\n"),
        "detector_summary":      summary,
        "attack_order":          attack_order,
        "trampolines":           tiers,
    }


@mcp.tool()
def camoufox_tool_atlas(category: str = "") -> dict[str, Any]:
    """List the 36 tools that camoufox-reverse-mcp exposes, grouped by purpose.

    Categories:
      - browser_control : launch / navigate / reload / state
      - interact_probe  : click / type / screenshot / a11y / console
      - script_analysis : scripts() / search_code / evaluate_js
      - hooking         : hook_function / inject_hook_preset / remove_hooks
      - network         : capture / list / get / initiator / intercept / cookie sources
      - storage         : cookies / get_storage / export_state / import_state
      - jsvmp_env_patch : hook_jsvmp_interpreter / compare_env / instrumentation / verify_signer_offline
      - engine_trace    : trace_property_access (C++ layer, JSVMP-undetectable)

    Args:
        category: empty string returns all groups; otherwise filter to one.

    Returns:
        {"groups": {category: [{name, use}, ...]}, "total": <int>}
    """
    if category:
        if category not in CAMOUFOX_TOOL_ATLAS:
            raise ValueError(
                f"unknown category '{category}'. Choose: {sorted(CAMOUFOX_TOOL_ATLAS)}"
            )
        return {
            "groups": {category: CAMOUFOX_TOOL_ATLAS[category]},
            "total":  len(CAMOUFOX_TOOL_ATLAS[category]),
        }
    return {
        "groups": CAMOUFOX_TOOL_ATLAS,
        "total":  sum(len(v) for v in CAMOUFOX_TOOL_ATLAS.values()),
    }


@mcp.tool()
def mcp_stack_recommendation(target_url: str, antibot_signals: list[str] | None = None) -> dict[str, Any]:
    """Given a target URL and the antibot signals you've observed in Phase 0,
    recommend which MCP servers to enable for this engagement.

    Stack tiers (in order of complexity):
      Tier 1 — reverse-skill only           : static analysis, signature lookup, scaffold
      Tier 2 — + chrome-devtools-mcp        : visual + Chrome (most general)
      Tier 3 — + js-reverse-mcp             : Chrome breakpoints, WS, paused-state eval
      Tier 4 — + camoufox-reverse-mcp       : strong antibot (RS/Akamai/CF/DataDome)

    Args:
        target_url:      e.g. "https://xiaohongshu.com/explore"
        antibot_signals: list of observed signals. Examples:
                         "412_redirect" / "sensor_data" / "cf_turnstile" /
                         "datadome_js" / "fssbb_token" / "akamai_abck" /
                         "jsvmp_loaded" / "rs_acmescripts" / "axios_only"

    Returns:
        {
          "recommended_tier":  1-4,
          "required_mcps":     [...],
          "optional_mcps":     [...],
          "reasoning":         "...",
          "install_command":   "...",
        }
    """
    signals = set((antibot_signals or []))
    strong = {"412_redirect", "sensor_data", "cf_turnstile", "datadome_js",
              "fssbb_token", "akamai_abck", "rs_acmescripts"}
    needs_debugger = {"jsvmp_loaded", "obfuscator", "control_flow_flat"}

    if signals & strong:
        tier, required, optional = 4, ["reverse-skill", "camoufox-reverse"], ["js-reverse", "chrome-devtools"]
        why = (f"signal(s) {sorted(signals & strong)} indicate engine-level fingerprint "
               "checks. chrome-devtools-mcp will be detected and blocked. Camoufox "
               "is the only one that gets past.")
    elif signals & needs_debugger:
        tier, required, optional = 3, ["reverse-skill", "js-reverse"], ["chrome-devtools", "camoufox-reverse"]
        why = ("JSVMP/heavy obfuscation needs breakpoint + paused-state eval. "
               "js-reverse-mcp's set_breakpoint_on_text is fastest path.")
    elif signals and signals - {"axios_only"}:
        tier, required, optional = 2, ["reverse-skill", "chrome-devtools"], ["js-reverse"]
        why = "non-trivial signals; chrome-devtools gives you Network + scripts source."
    else:
        tier, required, optional = 1, ["reverse-skill"], ["chrome-devtools"]
        why = ("no strong signals — likely plain axios sign with static cookies. "
               "reverse-skill's static analysis + env_patch_scaffold is enough.")

    cmds_per_mcp = {
        "reverse-skill":     "# already in this skill — no install",
        "chrome-devtools":   "claude mcp add chrome-devtools npx -y chrome-devtools-mcp@latest",
        "js-reverse":        "claude mcp add js-reverse npx js-reverse-mcp",
        "camoufox-reverse":  "pip install camoufox-reverse-mcp && python -m camoufox fetch",
    }
    return {
        "recommended_tier":  tier,
        "required_mcps":     required,
        "optional_mcps":     optional,
        "reasoning":         why,
        "install_commands":  [cmds_per_mcp[m] for m in required if cmds_per_mcp.get(m)],
        "after_install":     (
            "1. restart host so new MCPs load; 2. call mcp_stack_recommendation again "
            "to confirm tier; 3. start with env_patch_scaffold for the project skeleton; "
            "4. for tier 4 sites, kick off camoufox launch_browser(enable_trace=true) → "
            "trace_property_access → env_patch_minimize chain."
        ),
    }


# ─────────────────────────── entrypoint ───────────────────────────

def main() -> None:
    """Run the MCP stdio server (foreground)."""
    mcp.run()


if __name__ == "__main__":
    main()
