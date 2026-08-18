# iv8 — Run JavaScript with a Full Browser Environment in Python

## [中文](./README.md) | English

[![PyPI](https://img.shields.io/pypi/v/iv8)](https://pypi.org/project/iv8/)
[![Python](https://img.shields.io/pypi/pyversions/iv8)](https://pypi.org/project/iv8/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS%20(experimental)-blue)]()
[![GitHub](https://img.shields.io/badge/GitHub-iv8-blue?logo=github)](https://github.com/HanZzzzz000/iv8)

**iv8** is a high-performance Python native extension built on the V8 engine. It implements browser APIs at the C++ level, providing highly controllable, high-fidelity BOM/DOM/CSSOM emulation with built-in API call chain monitoring and Chrome DevTools remote debugging. Run JavaScript that depends on a web environment directly in Python — no browser required.

Suitable for browser environment emulation, automated script execution, security research, JS engine testing, and more.

This repository is the **Community Edition** of iv8, offering a fully functional baseline browser environment emulation that covers the vast majority of everyday use cases.

iv8 also offers a **Pro Edition**, which adds a CSS layout engine (cascade, inheritance, box model layout), CSS animation and transition drivers, a protocol stack built by deep-trimming Chromium's network module (not a Cronet wrapper), multi-context Worker parallel execution, enhanced API semantic/timing/boundary alignment (covering more spec edge cases), and deep algorithmic optimizations for computation performance and memory footprint. The Community Edition continues to evolve, and mature Pro features will progressively be backported.

The Python–V8 interop layer draws on the design of [STPyV8](https://github.com/cloudflare/stpyv8), with optimized design and implementation.

---

## Key Highlights

| Feature | Description |
|---------|-------------|
| **C++ Native Browser APIs** | Pure C++ implementation of BOM / DOM / CSSOM / Events / Crypto / Canvas / WebGL and more, covering 70+ HTML elements, 25+ CSS rule types, 80+ event types |
| **Streaming HTML Parser** | `page.load` aligns with browser navigation flow: HTML parsing → `<script>` pause & execute → stylesheet processing → DOMContentLoaded / load event dispatch |
| **Programmable Event Loop** | Micro/macro-task tiered scheduling (aligned with HTML spec); `sleep(5000)` completes instantly in logical time mode |
| **Browser Fingerprint Config** | Ships with Chrome/Windows default fingerprint (200+ fields); selectively override via `environment`, JS-side behavior matches real browsers |
| **Multi-thread Parallelism** | Each Context owns a V8 Isolate; GIL released during execution; ~4.7x speedup measured with 8 threads |
| **DevTools Remote Debugging** | Breakpoints, API access breakpoints, Elements / Application panels; built-in anti-debug protection (`debugger;` disabled) |
| **API Monitoring** | Debug mode auto-records browser API access chains and JS built-in reflection paths to locate environment probing logic |
| **Trusted Input Events** | Dispatches `isTrusted=true` mouse / pointer events (click / mousedown / pointerdown, etc.) |
| **Function Disguise** | `wrapNative` disguises JS functions as `[native code]`, reducing observable differences introduced by local patches |

## Architecture Overview

![iv8 free System-level Runtime Model](https://raw.githubusercontent.com/HanZzzzz000/iv8/main/assets/system_architecture.png)

> Python enters the C++ Bridge through `JSContext`, each Context owns a dedicated `v8::Isolate` enabling true parallelism across multiple Python threads; within the isolate, the window scope and per-document runtime are mounted, with core capabilities including the `page.load` loading flow, event loop and time control, offline resource model, and trusted input; monitoring and debugging form an optional debug plane, activated only in `debug` / `with_devtools()` mode.

## Quick Start

```bash
pip install --upgrade iv8 -i https://pypi.org/simple
```

We recommend installing or upgrading from the official PyPI index. Some third-party mirrors may lag behind and may not have the latest release immediately.

Supports Python 3.9 – 3.14, Windows (x64), and Linux (x64 / aarch64).
The Linux build is compiled to the manylinux standard and runs on CentOS, Ubuntu, Debian, Fedora, and other mainstream distributions.

> **macOS**: From **0.1.4**, prebuilt macOS arm64 / x86_64 wheels (Python 3.11–3.14, macOS 14+) are published to **PyPI** together with Linux/Windows — install with `pip install iv8`. Earlier 0.1.3 macOS builds were GitHub Releases–only. The author has no macOS device for long-term testing; feedback is welcome.

```python
import iv8

with iv8.JSContext() as ctx:
    # Execute JavaScript
    print(ctx.eval("1 + 2"))  # 3

    # Browser APIs work out of the box
    print(ctx.eval("navigator.userAgent"))   # Mozilla/5.0 ...
    print(ctx.eval("navigator.webdriver"))   # False

    # Load an HTML page (streaming parse + script execution + event dispatch)
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body><div id="app">Hello</div></body></html>'
        });
    """)
    print(ctx.eval("document.getElementById('app').textContent"))  # "Hello"
```

---

## Performance Characteristics

The following data was measured on Intel Core i7-14700 / Windows 10 / Python 3.11; results may vary on different hardware.

| Dimension | Metric | Data |
|-----------|--------|------|
| **Speed** | JSContext create + eval + destroy | ~3.3 ms / call |
| | Simple eval throughput (`1+1`) | ~950,000 ops/s |
| | Browser API calls (navigator / DOM / crypto) | 340,000 – 570,000 ops/s |
| | Real webpage DOM parse (Wikipedia [JavaScript article](https://en.wikipedia.org/wiki/JavaScript), ~440 KB) | ~7 ms / page (incl. Context create+destroy ~11.5 ms, serial ~86 pages/s) |
| **Memory** | First load (`import iv8` + 1st Context) | +15 MB |
| | Per-round peak increment (batch loop) | ~9 MB |
| | 100-round long-run cumulative drift | +2 MB |
| **Multi-thread** | Speedup (2 / 4 / 8 threads) | 1.86x / 3.26x / 4.71x |

> Memory figures are iv8 marginal increments (excluding the Python interpreter itself).
> Multi-thread test uses compute-intensive JS (200K sin/cos loop iterations); real-world scenarios (executing hundreds of KB of obfuscated JS) typically show better speedup.
> For GIL release mechanism, Context creation overhead, and page.load vs innerHTML guidance, see the [Best Practices](#best-practices) section below.

---

## Browser API Compatibility

iv8 provides an extensive browser API emulation layer on top of the V8 engine, covering the following web standards (some are interface-level stubs):

| Category | Coverage |
|----------|----------|
| **DOM & HTML** | Document, Element, Node inheritance chain, 70+ HTML element interfaces, ShadowRoot, MutationObserver, Range, Custom Elements, etc. |
| **SVG** | SVGElement inheritance chain with 50+ SVG element interfaces, SVGAnimated\* series |
| **CSS & CSSOM** | CSSStyleSheet, 25+ CSSRule subclasses, CSSStyleDeclaration, CSS Typed OM (CSSUnitValue / CSSMath\*), Highlight API |
| **Event System** | EventTarget / Event inheritance chain, 80+ event types (UI / Mouse / Pointer / Keyboard / Touch / Drag / Clipboard / Animation, etc.) |
| **Window & Navigator** | Window, Location, History, Navigator, Screen, Performance API, Navigation API |
| **Network** | XMLHttpRequest, Fetch API (Request / Response / Headers), Streams, WebSocket, WebTransport, Beacon. The Community Edition does not include a built-in real HTTP/HTTPS transport; XHR / fetch / external resources receive responses via `add_resource` or `page.load.resources`, giving users full control over real request details (proxy / TLS fingerprint / cookie pool) |
| **Encoding & File** | TextEncoder / Decoder, Blob, File, FileReader, URL / URLSearchParams, File System Access |
| **Storage** | localStorage, sessionStorage, CookieStore, IndexedDB, Storage Buckets |
| **Crypto** | `crypto.getRandomValues`, SubtleCrypto (AES-GCM / AES-CBC / RSA-OAEP / RSA-PSS / ECDH / ECDSA / HMAC / HKDF / PBKDF2 / digest algorithms, etc.) |
| **Canvas & Graphics** | Canvas 2D, WebGL / WebGL2 (30+ extensions, parameters from `environment.webgl.*`), WebGPU, OffscreenCanvas |
| **Media** | HTMLMediaElement, Web Audio API (20+ AudioNode subclasses), MediaStream, WebRTC, WebCodecs |
| **Timers & Scheduling** | setTimeout / setInterval / requestAnimationFrame / requestIdleCallback, Scheduler API |
| **Web Animations** | Animation, KeyframeEffect, DocumentTimeline, ScrollTimeline, ViewTimeline |
| **Geometry** | DOMPoint, DOMRect, DOMQuad, DOMMatrix and ReadOnly variants |
| **Performance** | PerformanceTiming, PerformanceResourceTiming, PerformanceObserver, MemoryInfo, etc. |
| **Permissions & Security** | Permissions API, Credential Management, Trusted Types, CSP |
| **Device APIs** | Clipboard, Notification, Geolocation, DeviceOrientation, Sensor API, BatteryManager |
| **Communication** | MessagePort, Web MIDI, Presentation API |
| **Workers** | Worker / SharedWorker / ServiceWorker / Worklet |

---

## Feature Details

### 1. JavaScript Execution & Type Conversion

Built on the modern V8 engine with full ES6+ syntax support (class, modules, Promise, async/await, optional chaining, private fields, top-level await, etc.). Return values are automatically converted to Python types.

```python
with iv8.JSContext() as ctx:
    # Primitive types auto-convert
    print(ctx.eval("42"))                    # int: 42
    print(ctx.eval("'hello'"))               # str: "hello"
    print(ctx.eval("[1, 2, 3]"))             # list: [1, 2, 3]

    # to_py=True recursively converts complex nested objects
    data = ctx.eval("({name: 'test', items: [1,2,3]})", to_py=True)
    print(data['items'])  # [1, 2, 3]

    # Full ES6+ support
    ctx.eval("""
        const { name, scores } = { name: 'Alice', scores: [90, 85, 92] };
        var avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    """)
    print(ctx.eval("avg"))  # 89
```

### 2. Browser Environment & Fingerprint Configuration

iv8 ships with a complete Chrome desktop / Windows baseline fingerprint (200+ fields) — ready to use without passing `environment`.
Use the `environment` dict to selectively override fingerprint fields; unspecified fields retain their defaults.
The exposed browser version is determined by `navigator.userAgent` / `navigator.userAgentData` fields, freely overridable by users — built-in defaults serve only as out-of-the-box fallbacks and **do not constitute a commitment to a specific Chrome version**.

```python
with iv8.JSContext(environment={
    "navigator": {
        "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "platform": "Win32",
        "language": "zh-CN",
        "languages": ["zh-CN", "en-US"],
        "hardwareConcurrency": 8,
        "deviceMemory": 8,
    },
    "screen": {
        "width": 1920, "height": 1080, "colorDepth": 24,
    },
    "location": {
        "href": "https://example.com/page",
    },
    "webgl": {
        "vendor": "Google Inc. (NVIDIA)",
        "renderer": "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)",
    },
}) as ctx:
    print(ctx.eval("navigator.userAgent"))
    print(ctx.eval("navigator.hardwareConcurrency"))  # 8
    print(ctx.eval("screen.width"))                    # 1920
```

**View all configurable fields:** `get_defaults()` returns all supported paths and their default values, making it easy to discover the full override surface:

```python
for path, value in sorted(iv8.JSContext.get_defaults().items()):
    print(f"{path} = {value!r}")
# navigator.userAgent = 'Mozilla/5.0 ...'
# screen.width = 1920
# window.devicePixelRatio = 1.0
# ...
```

### 3. DOM Manipulation & Page Loading

Full DOM engine with HTML streaming parse, element creation, and node manipulation.

**Two ways to load HTML:**

- `page.load(snapshot)` — Streaming load aligned with key browser navigation stages: parse HTML by chunk,
  pause on `<script>` for execution (including external resources from the bundle), process `<style>` and `<link>` stylesheets,
  dispatch DOMContentLoaded / load events, sync `document.URL` / `location.href`.
  Best for scenarios requiring script execution, lifecycle events, or simulating a real page load.

- `document.documentElement.innerHTML` — Direct assignment that only builds the DOM tree — no script execution, no event dispatch,
  no URL synchronization. Lower overhead, ideal for simple scenarios where only the DOM structure is needed (e.g., parsing HTML, extracting data).

**`page.load(snapshot)` parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseURL` | string | Yes | Page URL, synced to `document.URL` and `location.href` |
| `html` | string | Yes | HTML source |
| `resources` | Object | No | External resource mapping (URL → content); `<script src>` / `<link href>` in HTML and runtime XHR / fetch all match against this |
| `headers` | Object/Array | No | Main document response headers (CSP, Set-Cookie, etc.) |

**`resources` format:** Keyed by URL; values support shorthand and full format:

```javascript
resources: {
    // Shorthand: value is the content string directly
    'https://example.com/lib.js': 'var LIB = true;',

    // Full format: specify HTTP status, response headers, body
    'https://example.com/app.js': {
        body: 'var APP = true;',
        status: 200,
        headers: [['content-type', 'application/javascript']],
    }
}
```

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><head><script src="/app.js"></script></head><body></body></html>',
            resources: {
                'https://example.com/app.js': { body: 'window.APP_LOADED = true;' }
            }
        });
    """)
    print(ctx.eval("window.APP_LOADED"))  # True
```

### 4. Event Loop & Timer Control

Implements micro-task / macro-task two-phase scheduling (aligned with HTML spec event loop), with macro-tasks prioritized by level and fine-grained time control APIs.

- **Macro-tasks**: setTimeout, setInterval, requestAnimationFrame, XHR/fetch callbacks, etc.
- **Micro-tasks**: Promise.then/catch/finally, queueMicrotask, MutationObserver callbacks, etc.

```python
with iv8.JSContext(time_mode="logical") as ctx:
    ctx.eval("""
        var log = [];
        setTimeout(() => log.push('macro-100'), 100);
        setTimeout(() => log.push('macro-200'), 200);
        Promise.resolve().then(() => log.push('micro'));
        queueMicrotask(() => log.push('micro-2'));
    """)

    ctx.eval("window.__iv8__.eventLoop.advance(250)")
    print(ctx.eval("log"))
    # ['micro', 'micro-2', 'macro-100', 'macro-200']
```

**Event loop control methods:**

| Method | Description |
|--------|-------------|
| `advance(total, step?)` | Advance virtual time frame-by-frame (default step ~16.67ms), simulating rAF rhythm |
| `sleep(ms?, max?)` | Advance virtual time by ms milliseconds, draining the task queue in chronological order |
| `tick(ms?)` | Advance ms milliseconds and run one event loop iteration |
| `drain(max?)` | Drain all due tasks without advancing time |
| `drainMicrotasks()` | Drain only the micro-task queue |
| `drainTimers()` | Process only due timer callbacks |
| `setAutoAdvanceStep(ms)` | Set the auto-increment step for `performance.now()` (default 0.001ms) |
| `setDateAdvanceStep(ms)` | Set the auto-increment step for `Date.now()` (default 1ms) |

**Time modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| `logical` (default) | Pure logical advancement; `sleep(5000)` completes instantly | Automation, fast execution |
| `system` | Anchored to system time; `Date.now()` reflects real elapsed time during JS execution | Time-sensitive scenarios (PoW, time-delta checks) |

### 5. Network Request Interception

> **Community Edition network boundary:** The Community Edition does not directly send real HTTP/HTTPS requests and does not include the Chromium network transport stack. XHR / fetch / external resources match responses from the offline bundle by default; real requests should be performed by the user's Python HTTP client and then injected via `add_resource()` or `page.load.resources`. The Pro Edition provides a real protocol stack built from a deeply trimmed Chromium net module.

`add_resource()` and the `resources` parameter of `page.load` write into the same offline resource bundle.
During HTML parsing, `<script src>` / `<link href>` / CSS `@import`, as well as runtime XHR / fetch, all match against this bundle.
`netLog` automatically records all XHR / fetch / navigation requests initiated from the JS side, enabling analysis of the target JS network behavior.

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body></body></html>'
        });
    """)

    # XHR requests are automatically captured by netLog
    ctx.eval("""
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.example.com/data', false);
        xhr.send();
    """)
    print(ctx.eval("xhr.status"))  # 200

    entries = ctx.eval("window.__iv8__.netLog.entries", to_py=True)
    for entry in entries:
        print(f"  {entry.get('method', '')} {entry.get('url', '')}")
```

**Collaborating with real HTTP requests:** iv8's network APIs do not send HTTP requests directly; instead they match responses from the offline bundle.
This design gives users full control over the network layer (proxy, TLS fingerprint, cookie pool, etc., are all determined by the user's HTTP client).
Typical workflow: JS initiates request → pause event loop → Python sends real HTTP request → inject response → resume event loop.

```python
import requests

with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body></body></html>'
        });
    """)

    # JS initiates an async XHR
    ctx.eval("""
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.example.com/data');
        xhr.onload = function() { window._result = xhr.responseText; };
        xhr.send();
    """)

    # Python sends the real request and injects the response into the offline bundle
    resp = requests.get("https://api.example.com/data")
    ctx.add_resource(
        url="https://api.example.com/data",
        body=resp.text,
        status=resp.status_code,
        headers=dict(resp.headers),
    )

    # Resume the event loop — the XHR callback will match the just-injected resource
    ctx.eval("window.__iv8__.eventLoop.drain()")
    print(ctx.eval("window._result"))
```

### 6. Monitoring & Debugging

**Runtime modes:**

| Mode | Description |
|------|-------------|
| `prod` (default) | Zero monitoring overhead, suitable for production use |
| `debug` | Enables API call chain tracing, reflection interceptor monitoring, and DevTools debugging |

**API monitoring in debug mode:** Automatically records all monitored browser API property reads/writes, method calls, and constructor calls (high-frequency built-in types like Math / JSON / Array / typed arrays are silenced by default to reduce noise; adjustable via `ignore_apis`). Also instruments JS built-in reflection paths (Object.keys / getOwnPropertyDescriptor / defineProperty, Reflect.ownKeys / get / has, Function.prototype.toString, JSON.parse / stringify, etc.), recording the target JS environment probing chain.

**DevTools debugging:** Built-in Chrome DevTools Protocol (CDP) support.

> **Anti-debug Protection & Replacement Tools:**
>
> - **`debugger;` → `vdebugger;`**: iv8 disables native `debugger;` statements (they won't trigger breakpoints) because target JS commonly exploits infinite `debugger` loops for anti-debugging. Use `vdebugger;` instead — its behavior is identical to standard `debugger`.
> - **`console` → `vconsole`**: Some anti-scraping JS detects the debugging environment through behavioral differences in the `console` API. After setting `enable_console=False` to disable standard `console` DevTools reporting, use `vconsole.log()` / `vconsole.warn()` etc. as replacements. `vconsole` output appears only in the DevTools Console panel and is completely invisible to target JS.

```python
# Basic debugging
with iv8.JSContext(mode='debug').with_devtools(port=9229) as ctx:
    ctx.eval("vdebugger;")  # Pauses in Chrome DevTools

# API access breakpoints + covert debug channel
with iv8.JSContext(mode='debug').with_devtools(
    port=9229,
    watch_apis=["navigator.userAgent", "document.cookie", "canvas.toDataURL"],
    enable_console=False,
) as ctx:
    ctx.eval("let ua = navigator.userAgent;")  # Triggers breakpoint
    ctx.eval("vconsole.log('debug info', ua);")  # Only visible in DevTools
```

**Supported DevTools features:** Breakpoint debugging (`vdebugger;`), API access breakpoints (`watch_apis`), event listener breakpoints, XHR/Fetch URL breakpoints, DOM element structure inspection (Elements panel), Cookie / Storage inspection and editing (Application panel), step-through execution, variable inspection and modification.

### 7. Input Event Simulation

Dispatches trusted mouse / pointer events with `isTrusted=true`; capture → target → bubble chain and isTrusted semantics aligned with Chrome.

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body><button id="btn">Click</button></body></html>'
        });

        var clicked = false;
        document.getElementById('btn').addEventListener('click', e => {
            clicked = e.isTrusted;  // true
        });

        window.__iv8__.input.dispatchMouseEvent({
            type: 'click',
            target: document.getElementById('btn'),
            clientX: 50, clientY: 25,
            button: 0, buttons: 0
        });
    """)
    print(ctx.eval("clicked"))  # True
```

### 8. Function Disguise

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        var myFunc = window.__iv8__.wrapNative(function(x) { return x * 2; }, 'myFunc');
    """)
    print(ctx.eval("myFunc.toString()"))     # "function myFunc() { [native code] }"
    print(ctx.eval("myFunc(21)"))            # 42

```

### 9. Python ↔ JS Interop

`expose()` exposes Python objects to the `__iv8__.data` namespace in JS, without polluting the `window` global scope.
When JS calls an exposed Python function, the GIL is automatically acquired (blocking the current V8 execution and other Python threads), so exposed functions should be kept lightweight.

```python
import requests

with iv8.JSContext() as ctx:
    # Method 1: Named expose
    ctx.expose(requests.get, "httpGet")
    # JS: __iv8__.data.httpGet("https://...")

    # Method 2: Auto-named (uses the function's __name__ attribute)
    def fetch_data(url):
        return requests.get(url).text
    ctx.expose(fetch_data)
    # JS: __iv8__.data.fetch_data("https://...")

    # Method 3: Keyword argument batch expose
    ctx.expose(get=requests.get, post=requests.post)
    # JS: __iv8__.data.get(...), __iv8__.data.post(...)

    # Expose non-function data (dicts, lists, etc.)
    ctx.expose({"token": "abc123", "debug": True}, "config")
    result = ctx.eval("__iv8__.data.config.token")  # "abc123"
```


---

## Python API Reference

### `iv8.JSContext`

Main entry class. Creates an independent V8 context with browser APIs.

**Constructor parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `str` | `"prod"` | `"prod"` production mode / `"debug"` debug mode |
| `environment` | `dict` | `None` | Browser fingerprint configuration (navigator / screen / location / webgl, etc.) |
| `config` | `dict` | `None` | Framework behavior configuration (`timezone`, `permissions.*`, etc.; full paths via `get_defaults()`) |
| `ignore_apis` | `list` | Built-in default | APIs to exclude from monitoring logs |
| `time_mode` | `str` | `"logical"` | `"logical"` logical time / `"system"` system time |
| `js_api` | `str` | `"__iv8__"` | JS-side utility object mount name |

**Methods:**

| Method | Description |
|--------|-------------|
| `eval(source, name="", line=-1, col=-1, to_py=False, devtools=True)` | Execute JS code; return value auto-converts to Python types |
| `close(gc="none")` | Release the context. `gc` can be `"low_memory"` (or `"v8"` / `True`) / `"aggressive"` to trigger GC |
| `add_resource(url, body, status=200, headers=None)` | Inject an offline HTTP response |
| `with_devtools(port=9229, watch_apis=None, enable_console=True)` | Enable DevTools debugging |
| `expose(obj, name?)` / `expose(**kwargs)` | Expose Python objects to the `__iv8__.data` namespace |
| `get_defaults()` | Get all supported environment/config paths and their default values |

**Context manager usage (recommended):**

```python
with iv8.JSContext() as ctx:
    ctx.eval("...")
# Resources automatically released
```


---

## JS-side Utility Object

When a context is created, iv8 mounts a utility object `window.__iv8__` on the global scope (customizable via the `js_api` parameter).
This object is designed to be "undetectable" (`typeof window.__iv8__ === "undefined"`) and does not affect target JS behavior.

| Utility | Description |
|---------|-------------|
| `__iv8__.eventLoop.*` | Event loop control (advance / sleep / tick / drain, etc.) |
| `__iv8__.page.load(snapshot)` | Stream-load an HTML document |
| `__iv8__.input.dispatchMouseEvent(init)` | Dispatch trusted mouse events (isTrusted=true) |
| `__iv8__.input.dispatchPointerEvent(init)` | Dispatch trusted pointer events |
| `__iv8__.netLog.entries` | Captured network request log array |
| `__iv8__.wrapNative(fn, name)` | Disguise a JS function as a native function |
| `__iv8__.help()` | Print all available utilities and descriptions |

---

## Best Practices

### GIL & Multi-threading

iv8 **releases the Python GIL** during V8 JavaScript execution, allowing multiple threads to truly execute JS code in parallel.
When V8 calls back into Python (e.g., a function exposed via `expose()` is invoked by JS), the GIL is automatically reacquired.

```
Python eval() → Release GIL → V8 executes → (JS calls Python → Acquire GIL → Execute → Release GIL) → V8 returns → Acquire GIL → Return to Python
```

Each `JSContext` owns an independent V8 Isolate — no additional locking required for multi-threaded use:

```python
import threading

def run_js(thread_id, environment):
    with iv8.JSContext(environment=environment) as ctx:
        ua = ctx.eval("navigator.userAgent")
        print(f"Thread {thread_id}: {ua}")

threads = []
for i in range(4):
    t = threading.Thread(target=run_js, args=(i, {
        "navigator": {"userAgent": f"ThreadBot/{i}"}
    }))
    threads.append(t)
    t.start()
for t in threads:
    t.join()
```

Since the GIL is released during V8 execution, multi-threading achieves near-multiprocess parallelism while avoiding the overhead of inter-process communication and memory copying. For scenarios requiring simultaneous execution of multiple JS environments (e.g., concurrently running scripts from different sites), prefer multi-threading.

### Context Creation Overhead

`JSContext` creation (including an independent V8 Isolate + browser API surface) and destruction are lightweight — approximately 3ms per cycle (~300 ctx/s) in practice. There is no need to aggressively reuse contexts.
Creating a fresh `JSContext` each time provides a clean environment state, avoiding side-effect contamination from previous executions.

### page.load vs innerHTML

| Approach | Overhead | Use Case |
|----------|----------|----------|
| `page.load(snapshot)` | Higher: streaming parse + script execution + event dispatch | When full page lifecycle is needed (script execution, event triggering) |
| `innerHTML = html` | Lower: builds DOM tree only | When only DOM structure is needed (parsing HTML, extracting data) |

If the target JS does not depend on DOMContentLoaded / load events or external script execution, using `innerHTML` assignment can significantly reduce overhead.

---

## Changelog

### 0.1.4

- Fixed Promises returned by `Response.json()` / `Response.text()` never resolving after the event loop was drained (#29).
- Fixed `OfflineAudioContext` construction (both the `(numberOfChannels, length, sampleRate)` legacy form and the options-dictionary form) incorrectly raising "1 argument required" (#29).
- Fixed native DOM methods with receiver brand checks (`appendChild` / `insertBefore` / `addEventListener`, …) throwing `Illegal invocation` — and some silently returning `null` — when the first `JSContext` in a process is created on a **worker thread** (#18 / #25).
- Added `document.currentScript`: returns the executing `<script>` element during inline script execution and `null` otherwise (#23).
- Improved `navigator.userAgentData`: `brands` and `getHighEntropyValues()` (`uaFullVersion` / `bitness` / `architecture`, …) are now configurable via `environment` and consistent with the `Sec-CH-UA*` request headers (#20).
- Completed default values for `navigator.permissions.query()` (`usb` / `hid` / `serial` / `background-fetch` / `display-capture` / `compute-pressure` / `speaker-selection`, …), removing the "unknown environment config path" ERROR log noise (#19 / #22 / #24).
- Fixed the WebGL `EXT_texture_filter_anisotropic` extension where `getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)` returned `null`; it now returns a number (16 by default) (#28).
- Fixed extra arguments in `setTimeout(fn, delay, ...args)` / `setInterval` not being forwarded to the callback (including the `eventLoop.advance` path) (#15).
- Fixed `new URL(...).searchParams` returning `null` and related `URLSearchParams` gaps (#12).
- Platforms: added prebuilt wheels for **Linux aarch64** and **macOS x86_64**; **macOS (arm64 / x86_64) is now published to PyPI** alongside Linux/Windows starting with this release. All platforms pass per-issue regression plus the offline comprehensive API self-test (173/173).

### 0.1.3

- Fixed overly strict Latin1 validation in `btoa()`, so inputs such as `String.fromCharCode(0xE9)` now encode correctly.
- Fixed a DevTools local debugging issue where `localhost` could resolve to IPv6 on some Windows / Chrome environments and cause the WebSocket connection to disconnect.
- Improved parser-time `document.write()` behavior in `page.load()`, so DOM written by inline scripts is now persisted in the document tree.
- Fixed `innerHTML` serialization only returning the first child node; it now serializes all child nodes in order.
- Added a prebuilt macOS Apple Silicon wheel (arm64 / Python 3.11–3.14), an experimental build distributed via GitHub Releases (not on PyPI); passes the offline comprehensive API self-test (173/173).

---

## License

The iv8 Community Edition is currently distributed as pre-compiled binaries. Browser-environment emulation is an ongoing process of behavioral alignment and adversarial iteration; opening the full implementation too early may make it easier to build targeted detections. As the project becomes more refined and its interfaces and behaviors stabilize, we will evaluate gradually opening more implementation details or source code in the future.

- Free for personal, educational, and non-commercial use
- Reverse-engineering, decompilation, and disassembly are prohibited
- Commercial use (integration into commercial products or services) requires a commercial license (Pro Edition)
- Unauthorized redistribution is prohibited

See the [LICENSE](LICENSE) file for details.

## Disclaimer

This project is intended solely for learning, research, security testing, and lawful automation purposes. Users must comply with the terms of service and robots policies of target websites, as well as all applicable laws and regulations. The author assumes no responsibility for any misuse.

For more real-world usage examples, see the [examples/](examples/) directory.

## Acknowledgments

- [STPyV8](https://github.com/cloudflare/stpyv8) — Design reference for the Python–V8 interop layer
