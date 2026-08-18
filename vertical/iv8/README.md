# iv8 — Python 原生的 V8 + 浏览器环境运行时


## [English](./README_EN.md) | 中文


[![PyPI](https://img.shields.io/pypi/v/iv8)](https://pypi.org/project/iv8/)
[![Python](https://img.shields.io/pypi/pyversions/iv8)](https://pypi.org/project/iv8/)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS%20(experimental)-blue)]()
[![GitHub](https://img.shields.io/badge/GitHub-iv8-blue?logo=github)](https://github.com/HanZzzzz000/iv8)

**iv8** 是基于 V8 引擎的高性能 Python 原生扩展，在 C++ 层实现浏览器 API，提供高可控、高保真的 BOM/DOM/CSSOM 模拟，内置 API 调用链监控与 Chrome DevTools 远程调试，可在 Python 中直接运行依赖 Web 环境的 JavaScript，无需启动浏览器。


适用于浏览器环境模拟、自动化脚本执行、安全研究、JS 引擎测试等场景。

本仓库为 iv8 **社区版**，提供可用的基础浏览器环境模拟能力，能够满足绝大多数日常使用场景。

iv8 同时提供 **Pro 版**，在社区版基础上新增 CSS 布局引擎（级联、继承、盒模型布局）、CSS 动画与过渡驱动、基于 Chromium 网络模块深度裁剪的协议栈（非 Cronet 封装）、多上下文 Worker 并行执行、API 语义 / 时序 / 边界对齐增强（覆盖更多 spec 边界场景），以及计算性能、内存占用的深度算法优化。社区版持续迭代，Pro 版成熟特性将逐步回流至社区版。


Python 与 V8 的互操作层参考了 [STPyV8](https://github.com/cloudflare/stpyv8) 的设计思路，在此基础上优化设计与实现。

---

## 核心亮点

| 特性 | 说明 |
|------|------|
| **C++ 原生浏览器 API** | 纯 C++ 实现 BOM / DOM / CSSOM / 事件 / 加密 / Canvas / WebGL 等标准接口，覆盖 70+ HTML 元素、25+ CSS 规则、80+ 事件类型 |
| **流式 HTML 解析** | `page.load` 对齐浏览器导航流程：HTML 解析 → `<script>` 暂停执行 → 样式表处理 → DOMContentLoaded / load 事件派发 |
| **可编程事件循环** | 微 / 宏任务分级调度（对齐 HTML spec），逻辑时间模式下 `sleep(5000)` 瞬间完成 |
| **浏览器指纹配置** | 内置 Chrome/Windows 默认指纹（200+ 字段），通过 `environment` 按需覆盖，JS 侧表现与真实浏览器一致 |
| **多线程并行** | 每个 Context 独占 V8 Isolate，执行期释放 GIL；8 线程实测 ~4.7x 加速 |
| **DevTools 远程调试** | 断点、API 访问断点、Elements / Application 面板；内置反调试保护（`debugger;` 已禁用） |
| **API 监控** | debug 模式自动记录浏览器 API 访问链路与 JS 内置反射路径，定位环境探测逻辑 |
| **可信输入事件** | 派发 `isTrusted=true` 的鼠标 / 指针事件（click / mousedown / pointerdown 等） |
| **函数伪装** | `wrapNative` 将 JS 函数伪装为 `[native code]`，降低临时补丁的可观测差异 |

## 架构概览

![iv8 free 系统级运行模型](https://raw.githubusercontent.com/HanZzzzz000/iv8/main/assets/system_architecture.png)

> Python 通过 `JSContext` 进入 C++ Bridge，每个 Context 独占一个 `v8::Isolate`，可在多个 Python 线程上并行；isolate 内挂载 window 域与 per-document 运行时，核心能力为 `page.load` 加载流程、事件循环与时间控制、离线资源模型、可信输入；调试与监控为可选 debug plane，仅在 `debug` / `with_devtools()` 模式启用。

## 快速上手

```bash
pip install --upgrade iv8 -i https://pypi.org/simple
```

建议使用 PyPI 官方源安装或升级；部分第三方镜像源可能同步延迟，暂时无法获取最新版本。

支持 Python 3.9 – 3.14，Windows (x64)、Linux (x64 / aarch64)。
Linux 版本通过 manylinux 标准编译，可在 CentOS、Ubuntu、Debian、Fedora 等主流发行版上运行。

> **macOS**：自 **0.1.4** 起，macOS arm64 / x86_64 预编译 wheel（Python 3.11–3.14、macOS 14+）与 Linux/Windows 一并发布到 **PyPI**，可直接 `pip install iv8`。0.1.3 及更早的 macOS 包曾仅经 [GitHub Releases](https://github.com/HanZzzzz000/iv8/releases) 分发。作者无 macOS 设备长期实测，欢迎反馈问题。

```python
import iv8

with iv8.JSContext() as ctx:
    # 执行 JavaScript
    print(ctx.eval("1 + 2"))  # 3

    # 浏览器 API 开箱可用
    print(ctx.eval("navigator.userAgent"))   # Mozilla/5.0 ...
    print(ctx.eval("navigator.webdriver"))   # False

    # 加载 HTML 页面（流式解析 + 脚本执行 + 事件派发）
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body><div id="app">Hello</div></body></html>'
        });
    """)
    print(ctx.eval("document.getElementById('app').textContent"))  # "Hello"
```

---

## 性能特征

以下数据在 Intel Core i7-14700 / Windows 10 / Python 3.11 环境下实测，不同硬件结果会有差异。

| 维度 | 指标 | 数据 |
|------|------|------|
| **速度** | JSContext 创建 + eval + 销毁 | ~3.3 ms / 次 |
| | 简单 eval 吞吐（`1+1`） | ~950,000 ops/s |
| | 浏览器 API 调用（navigator / DOM / crypto） | 340,000 – 570,000 ops/s |
| | 真实网页 DOM 解析（维基百科 [JavaScript 条目](https://zh.wikipedia.org/wiki/JavaScript)，~440 KB） | ~7 ms / 页（含 Context 创建+销毁 ~11.5 ms，串行 ~86 页/s） |
| **内存** | 首次加载（`import iv8` + 首个 Context） | +15 MB |
| | 单轮峰值增量（批量循环场景） | ~9 MB |
| | 100 轮长跑累计漂移 | +2 MB |
| **多线程** | 加速比（2 / 4 / 8 线程） | 1.86x / 3.26x / 4.71x |

> 内存为 iv8 边际增量（不含 Python 解释器本身）。
> 多线程测试使用计算密集型 JS（20 万次 sin/cos 循环），真实场景（执行几百 KB 混淆 JS）的加速效果通常更优。
> GIL 释放机制、Context 创建开销、page.load 与 innerHTML 的选择等使用建议，详见下方[最佳实践](#最佳实践)章节。

---

## 浏览器 API 兼容性

iv8 在 V8 引擎之上提供广泛的浏览器 API 模拟层，覆盖以下 Web 标准（部分为接口级桩实现）：

| 分类 | 覆盖范围 |
|------|---------|
| **DOM & HTML** | Document、Element、Node 继承链、70+ HTML 元素接口、ShadowRoot、MutationObserver、Range、Custom Elements 等 |
| **SVG** | SVGElement 继承链及 50+ SVG 元素接口、SVGAnimated\* 系列 |
| **CSS & CSSOM** | CSSStyleSheet、25+ CSSRule 子类、CSSStyleDeclaration、CSS Typed OM（CSSUnitValue / CSSMath\*）、Highlight API |
| **事件系统** | EventTarget / Event 继承链，80+ 事件类型（UI / Mouse / Pointer / Keyboard / Touch / Drag / Clipboard / Animation 等） |
| **Window & Navigator** | Window、Location、History、Navigator、Screen、Performance API、Navigation API |
| **网络** | XMLHttpRequest、Fetch API（Request / Response / Headers）、Streams、WebSocket、WebTransport、Beacon。社区版不内置真实网络传输栈；XHR / fetch / 外联资源默认通过 `add_resource` 或 `page.load.resources` 注入响应，由用户决定真实请求细节（代理 / TLS 指纹 / cookie 池） |
| **编码 & 文件** | TextEncoder / Decoder、Blob、File、FileReader、URL / URLSearchParams、File System Access |
| **存储** | localStorage、sessionStorage、CookieStore、IndexedDB、Storage Buckets |
| **加密** | `crypto.getRandomValues`、SubtleCrypto（AES-GCM / AES-CBC / RSA-OAEP / RSA-PSS / ECDH / ECDSA / HMAC / HKDF / PBKDF2 / 摘要算法等） |
| **Canvas & 图形** | Canvas 2D、WebGL / WebGL2（30+ 扩展，参数来自 `environment.webgl.*`）、WebGPU、OffscreenCanvas |
| **媒体** | HTMLMediaElement、Web Audio API（20+ AudioNode 子类）、MediaStream、WebRTC、WebCodecs |
| **定时器 & 调度** | setTimeout / setInterval / requestAnimationFrame / requestIdleCallback、Scheduler API |
| **Web Animations** | Animation、KeyframeEffect、DocumentTimeline、ScrollTimeline、ViewTimeline |
| **Geometry** | DOMPoint、DOMRect、DOMQuad、DOMMatrix 及 ReadOnly 变体 |
| **Performance** | PerformanceTiming、PerformanceResourceTiming、PerformanceObserver、MemoryInfo 等 |
| **权限 & 安全** | Permissions API、Credential Management、Trusted Types、CSP |
| **设备 API** | Clipboard、Notification、Geolocation、DeviceOrientation、Sensor API、BatteryManager |
| **通信** | MessagePort、Web MIDI、Presentation API |
| **Workers** | Worker / SharedWorker / ServiceWorker / Worklet |

---

## 功能详解

### 1. JavaScript 执行与类型转换

基于现代 V8 引擎，支持 ES6+ 主流语法（class、模块、Promise、async / await、可选链、私有字段、Top-level await 等），返回值自动转换为 Python 类型。

```python
with iv8.JSContext() as ctx:
    # 基本类型自动转换
    print(ctx.eval("42"))                    # int: 42
    print(ctx.eval("'hello'"))               # str: "hello"
    print(ctx.eval("[1, 2, 3]"))             # list: [1, 2, 3]

    # to_py=True 确保复杂嵌套对象也递归转换
    data = ctx.eval("({name: 'test', items: [1,2,3]})", to_py=True)
    print(data['items'])  # [1, 2, 3]

    # ES6+ 全支持
    ctx.eval("""
        const { name, scores } = { name: 'Alice', scores: [90, 85, 92] };
        var avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    """)
    print(ctx.eval("avg"))  # 89
```

### 2. 浏览器环境与指纹配置

iv8 内置一套基于 Chrome 桌面 / Windows 基线的默认指纹（200+ 字段），不传 `environment` 即开箱可用。
通过 `environment` 字典可选择性覆盖指纹字段，未覆盖的保持默认值。
对外暴露的浏览器版本号由 `navigator.userAgent` / `navigator.userAgentData` 等字段决定，由用户随时覆盖 —— 内置默认值仅作开箱即用兜底，**不构成对"项目锚定哪个 Chrome 版本"的承诺**。

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

**查看所有可配置项：** `get_defaults()` 返回全部支持的路径及默认值，便于了解可覆盖范围：

```python
for path, value in sorted(iv8.JSContext.get_defaults().items()):
    print(f"{path} = {value!r}")
# navigator.userAgent = 'Mozilla/5.0 ...'
# screen.width = 1920
# window.devicePixelRatio = 1.0
# ...
```

### 3. DOM 操作与页面加载

内置完整的 DOM 引擎，支持 HTML 流式解析、元素创建、节点操作。

**两种 HTML 加载方式：**

- `page.load(snapshot)` — 流式加载，对齐浏览器导航的关键阶段：按 chunk 解析 HTML、
  遇到 `<script>` 暂停并执行（含外联资源从 bundle 加载）、处理 `<style>` 和 `<link>` 样式表、
  派发 DOMContentLoaded / load 事件、同步 `document.URL` / `location.href`。
  适合需要执行页面脚本、触发生命周期事件或模拟真实页面加载的场景。

- `document.documentElement.innerHTML` — 直接赋值，仅构建 DOM 树，不执行脚本、不派发事件、
  不同步 URL。性能开销更低，适合只需要 DOM 结构（如解析 HTML、提取数据）的简单场景。

**`page.load(snapshot)` 参数说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `baseURL` | string | 是 | 页面 URL，同步到 `document.URL`、`location.href` |
| `html` | string | 是 | HTML 源码 |
| `resources` | Object | 否 | 外联资源映射（URL → 内容），HTML 中的 `<script src>` / `<link href>` 及运行时的 XHR / fetch 均从中匹配响应 |
| `headers` | Object/Array | 否 | 主文档响应头（CSP、Set-Cookie 等） |

**`resources` 格式：** 以 URL 为 key，value 支持简写和完整格式：

```javascript
resources: {
    // 简写：value 直接为内容字符串
    'https://example.com/lib.js': 'var LIB = true;',

    // 完整格式：可指定 HTTP 状态码、响应头、body
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

### 4. 事件循环与定时器控制

实现微任务 / 宏任务两阶段调度（对齐 HTML spec event loop），宏任务按优先级分级，提供精细的时间控制 API。

- **宏任务**: setTimeout、setInterval、requestAnimationFrame、XHR/fetch 回调等
- **微任务**: Promise.then/catch/finally、queueMicrotask、MutationObserver 回调等

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

**事件循环控制方法：**

| 方法 | 说明 |
|------|------|
| `advance(total, step?)` | 分帧推进虚拟时间（默认步长 ~16.67ms），模拟 rAF 节奏 |
| `sleep(ms?, max?)` | 推进虚拟时间 ms 毫秒，按时间线顺序排空任务队列 |
| `tick(ms?)` | 推进 ms 毫秒并执行一轮事件循环 |
| `drain(max?)` | 排空所有已到期任务，不推进时间 |
| `drainMicrotasks()` | 仅排空微任务队列 |
| `drainTimers()` | 仅处理已到期的定时器回调 |
| `setAutoAdvanceStep(ms)` | 设置 `performance.now()` 自动递增量（默认 0.001ms） |
| `setDateAdvanceStep(ms)` | 设置 `Date.now()` 自动递增量（默认 1ms） |

**时间模式：**

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| `logical`（默认） | 纯逻辑推进，`sleep(5000)` 瞬间完成 | 自动化、快速执行 |
| `system` | 系统时间锚定，JS 执行期间 Date.now() 反映真实耗时 | 时间敏感场景（POW、时间差校验） |

### 5. 网络请求拦截

> **社区版网络边界：** 社区版不直接发起真实 HTTP/HTTPS 请求，也不内置 Chromium 网络传输栈。XHR / fetch / 外联资源默认从离线 bundle 匹配响应；真实请求需由 Python 侧 HTTP 客户端完成，再通过 `add_resource()` 或 `page.load.resources` 注入。Pro 版提供基于 Chromium net 深度裁剪的真实网络协议栈。

`add_resource()` 和 `page.load` 的 `resources` 参数写入同一个离线资源 bundle，
HTML 解析期的 `<script src>` / `<link href>` / CSS `@import`，以及运行期的 XHR / fetch 均会从中匹配。
`netLog` 自动记录 JS 侧发起的全部 XHR / fetch / 导航请求，便于分析目标 JS 的网络行为。

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body></body></html>'
        });
    """)

    # XHR 请求会被 netLog 自动记录
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

**与真实 HTTP 请求协作：** iv8 的网络 API 不直接发送 HTTP 请求，而是从离线 bundle 匹配响应。
这种设计将网络层完全交给用户控制（代理、TLS 指纹、cookie 池等由用户的 HTTP 客户端决定）。
典型工作流：JS 发起请求 → 暂停事件循环 → Python 侧用真实 HTTP 客户端发请求 → 注入响应 → 继续推进。

```python
import requests

with iv8.JSContext() as ctx:
    ctx.eval("""
        window.__iv8__.page.load({
            baseURL: 'https://example.com',
            html: '<html><body></body></html>'
        });
    """)

    # JS 侧发起异步 XHR
    ctx.eval("""
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://api.example.com/data');
        xhr.onload = function() { window._result = xhr.responseText; };
        xhr.send();
    """)

    # Python 侧发真实请求，将响应注入离线 bundle
    resp = requests.get("https://api.example.com/data")
    ctx.add_resource(
        url="https://api.example.com/data",
        body=resp.text,
        status=resp.status_code,
        headers=dict(resp.headers),
    )

    # 继续推进事件循环，XHR 回调会命中刚注入的资源
    ctx.eval("window.__iv8__.eventLoop.drain()")
    print(ctx.eval("window._result"))
```

### 6. 监控与调试

**运行模式：**

| 模式 | 说明 |
|------|------|
| `prod`（默认） | 零监控开销，适合生产使用 |
| `debug` | 启用 API 调用链追踪、反射拦截器监控，支持 DevTools 调试 |

**debug 模式下的 API 监控：** 自动记录所有受监控浏览器 API 的属性读 / 写、方法调用与构造调用（默认对 Math / JSON / Array / 类型化数组等高频内置类型静音以降噪，可通过 `ignore_apis` 调整）；同时拦截 JS 内置反射路径（Object.keys / getOwnPropertyDescriptor / defineProperty、Reflect.ownKeys / get / has、Function.prototype.toString、JSON.parse / stringify 等），记录目标 JS 的环境探测链路。

**DevTools 调试：** 内置 Chrome DevTools Protocol (CDP) 支持。

> **反调试保护与替代工具：**
>
> - **`debugger;` → `vdebugger;`**：iv8 禁用了原生 `debugger;` 语句（不会触发断点），因为目标 JS 常利用无限 `debugger` 循环进行反调试。需要断点时使用 `vdebugger;` 代替，行为与标准 `debugger` 完全一致。
> - **`console` → `vconsole`**：某些反爬 JS 会通过 `console` API 的行为差异检测调试环境。设置 `enable_console=False` 关闭标准 `console` 的 DevTools 上报后，使用 `vconsole.log()` / `vconsole.warn()` 等替代。`vconsole` 输出仅在 DevTools Console 面板显示，对目标 JS 完全不可见。

```python
# 基础调试
with iv8.JSContext(mode='debug').with_devtools(port=9229) as ctx:
    ctx.eval("vdebugger;")  # 在 Chrome DevTools 中暂停

# API 访问断点 + 隐蔽调试通道
with iv8.JSContext(mode='debug').with_devtools(
    port=9229,
    watch_apis=["navigator.userAgent", "document.cookie", "canvas.toDataURL"],
    enable_console=False,
) as ctx:
    ctx.eval("let ua = navigator.userAgent;")  # 触发断点
    ctx.eval("vconsole.log('调试信息', ua);")  # 仅 DevTools 可见
```

**DevTools 支持的功能：** 断点调试（`vdebugger;`）、API 访问断点（`watch_apis`）、事件监听器断点、XHR/Fetch URL 断点、DOM 元素结构查看（Elements 面板）、Cookie / Storage 查看与编辑（Application 面板）、单步执行、变量查看与修改。

### 7. 输入事件模拟

派发 `isTrusted=true` 的可信鼠标 / 指针事件，事件的捕获 → 目标 → 冒泡链与 isTrusted 语义对齐 Chrome。

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

### 8. 函数伪装

```python
with iv8.JSContext() as ctx:
    ctx.eval("""
        var myFunc = window.__iv8__.wrapNative(function(x) { return x * 2; }, 'myFunc');
    """)
    print(ctx.eval("myFunc.toString()"))     # "function myFunc() { [native code] }"
    print(ctx.eval("myFunc(21)"))            # 42

```

### 9. Python ↔ JS 互调

`expose()` 将 Python 对象暴露到 JS 的 `__iv8__.data` 命名空间，不污染 `window` 全局作用域。
JS 调用暴露的 Python 函数时会自动获取 GIL（阻塞当前 V8 执行和其他 Python 线程），因此暴露的函数应尽量轻量。

```python
import requests

with iv8.JSContext() as ctx:
    # 方式一：命名暴露
    ctx.expose(requests.get, "httpGet")
    # JS: __iv8__.data.httpGet("https://...")

    # 方式二：自动命名（使用函数的 __name__ 属性）
    def fetch_data(url):
        return requests.get(url).text
    ctx.expose(fetch_data)
    # JS: __iv8__.data.fetch_data("https://...")

    # 方式三：关键字参数批量暴露
    ctx.expose(get=requests.get, post=requests.post)
    # JS: __iv8__.data.get(...), __iv8__.data.post(...)

    # 暴露非函数数据（字典、列表等）
    ctx.expose({"token": "abc123", "debug": True}, "config")
    result = ctx.eval("__iv8__.data.config.token")  # "abc123"
```


---

## Python API 参考

### `iv8.JSContext`

主入口类，创建带有浏览器 API 的独立 V8 上下文。

**构造参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `str` | `"prod"` | `"prod"` 生产模式 / `"debug"` 调试模式 |
| `environment` | `dict` | `None` | 浏览器指纹配置（navigator / screen / location / webgl 等） |
| `config` | `dict` | `None` | 框架行为配置（`timezone`、`permissions.*` 等，完整路径通过 `get_defaults()` 查看） |
| `ignore_apis` | `list` | 内置默认 | 从监控日志排除的 API 列表 |
| `time_mode` | `str` | `"logical"` | `"logical"` 逻辑时间 / `"system"` 系统时间 |
| `js_api` | `str` | `"__iv8__"` | JS 侧工具对象挂载名 |

**方法：**

| 方法 | 说明 |
|------|------|
| `eval(source, name="", line=-1, col=-1, to_py=False, devtools=True)` | 执行 JS 代码，返回值自动转换为 Python 类型 |
| `close(gc="none")` | 释放上下文。`gc` 可选 `"low_memory"`（或 `"v8"` / `True`）/ `"aggressive"` 触发 GC |
| `add_resource(url, body, status=200, headers=None)` | 注入离线 HTTP 响应 |
| `with_devtools(port=9229, watch_apis=None, enable_console=True)` | 启用 DevTools 调试 |
| `expose(obj, name?)` / `expose(**kwargs)` | 将 Python 对象暴露到 `__iv8__.data` 命名空间 |
| `get_defaults()` | 获取所有支持的 environment/config 路径及默认值 |

**上下文管理器用法（推荐）：**

```python
with iv8.JSContext() as ctx:
    ctx.eval("...")
# 自动释放资源
```


---

## JS 侧工具对象

创建上下文时，iv8 在全局挂载工具对象 `window.__iv8__`（可通过 `js_api` 参数自定义）。
该对象设计为"不可检测"（`typeof window.__iv8__ === "undefined"`），不影响目标 JS 行为。

| 工具 | 说明 |
|------|------|
| `__iv8__.eventLoop.*` | 事件循环控制（advance / sleep / tick / drain 等） |
| `__iv8__.page.load(snapshot)` | 流式加载 HTML 文档 |
| `__iv8__.input.dispatchMouseEvent(init)` | 派发可信鼠标事件（isTrusted=true） |
| `__iv8__.input.dispatchPointerEvent(init)` | 派发可信指针事件 |
| `__iv8__.netLog.entries` | 捕获的网络请求日志数组 |
| `__iv8__.wrapNative(fn, name)` | 将 JS 函数伪装为原生函数 |
| `__iv8__.help()` | 打印所有可用工具及说明 |

---

## 最佳实践

### GIL 与多线程

iv8 在 V8 执行 JavaScript 期间**释放 Python GIL**，多个线程可以并行执行 JS 代码。
V8 回调到 Python（如 `expose()` 暴露的函数被 JS 调用）时会自动重新获取 GIL。

```
Python eval() → 释放 GIL → V8 执行 → （JS 调 Python → 获取 GIL → 执行 → 释放 GIL） → V8 返回 → 获取 GIL → 返回 Python
```

每个 `JSContext` 独占一个 V8 Isolate，多线程使用无需额外加锁：

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

由于 V8 执行期间释放 GIL，多线程已可获得接近多进程的并行效果，且避免了进程间通信和内存复制的额外开销。对于需要同时运行多个 JS 环境的场景（如并发执行不同站点的脚本），推荐优先使用多线程。

### Context 创建开销

`JSContext` 创建（含独立 V8 Isolate + 浏览器 API 表面）和销毁都很轻量。实测单次约 3ms（~300 ctx/s），无需刻意复用。
每次使用新的 `JSContext` 可以获得干净的环境状态，避免上一次执行的副作用干扰。

### page.load vs innerHTML

| 方式 | 开销 | 适用场景 |
|------|------|---------|
| `page.load(snapshot)` | 较高：流式解析 + 脚本执行 + 事件派发 | 需要完整页面生命周期（执行脚本、触发事件） |
| `innerHTML = html` | 较低：仅构建 DOM 树 | 只需 DOM 结构（解析 HTML、提取数据） |

如果目标 JS 不依赖 DOMContentLoaded / load 事件或外联脚本执行，使用 `innerHTML` 赋值可显著降低开销。

---

## 更新记录

### 0.1.4

- 修复 `Response.json()` / `Response.text()` 返回的 Promise 在事件循环推进后仍不解析的问题（#29）。
- 修复 `OfflineAudioContext` 构造（`(numberOfChannels, length, sampleRate)` 传统形式与 options 字典形式）误报「1 argument required」的问题（#29）。
- 修复在**子线程**首次创建 `JSContext` 时，带 receiver 校验的原生 DOM 方法（`appendChild` / `insertBefore` / `addEventListener` 等）抛 `Illegal invocation`、部分方法静默返回 `null` 的问题（#18 / #25）。
- 新增 `document.currentScript`：内联脚本执行期返回当前 `<script>` 元素，非执行期返回 `null`（#23）。
- 增强 `navigator.userAgentData`：`brands`、`getHighEntropyValues()`（`uaFullVersion` / `bitness` / `architecture` 等）现可经 `environment` 配置，且与 `Sec-CH-UA*` 请求头同源（#20）。
- 补全 `navigator.permissions.query()` 权限默认值（`usb` / `hid` / `serial` / `background-fetch` / `display-capture` / `compute-pressure` / `speaker-selection` 等），消除「未知的环境配置路径」ERROR 日志噪音（#19 / #22 / #24）。
- 修复 WebGL `EXT_texture_filter_anisotropic` 扩展 `getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)` 返回 `null` 的问题，现返回数值（默认 16）（#28）。
- 修复 `setTimeout(fn, delay, ...args)` / `setInterval` 额外参数未透传给回调的问题（含 `eventLoop.advance` 路径）（#15）。
- 修复 `new URL(...).searchParams` 返回 `null` 及 `URLSearchParams` 相关缺失（#12）。
- 平台：新增 **Linux aarch64** 与 **macOS x86_64** 预编译 wheel；**macOS（arm64 / x86_64）自本版起随 Linux/Windows 一并发布到 PyPI**。各平台均通过逐 issue 回归 + 离线 API 综合自测（173/173）。

### 0.1.3

- 修复 `btoa()` 对 Latin1 字符判断过窄的问题，`String.fromCharCode(0xE9)` 等 Latin1 输入现在可正常编码。
- 修复 DevTools 本地调试地址在部分 Windows / Chrome 环境下因 `localhost` 解析到 IPv6 导致 WebSocket 断开的问题。
- 增强 `page.load()` 解析期 `document.write()` 行为，inline script 写入的 DOM 内容现在会持久化到文档树。
- 修复 `innerHTML` 只序列化第一个子节点的问题，现在会按顺序序列化全部子节点。
- 新增 macOS Apple Silicon（arm64 / Python 3.11–3.14）预编译 wheel（实验版，经 GitHub Releases 分发，不上 PyPI；已通过离线 API 综合自测 173/173）。

---

## 许可证

iv8 社区版当前以编译成品形式免费提供。浏览器环境模拟本质上是一个持续对齐与攻防迭代的过程，过早开放完整源码可能会被用于针对性检测；项目会在能力持续精细化、接口与行为更加稳定后，评估逐步开放更多实现细节或源码的可能性。

- 允许个人学习、研究、非商业用途免费使用
- 禁止反编译、反汇编或以其他方式尝试获取源代码
- 商业用途（集成到商业产品或服务中）需获取商业授权（Pro 版）
- 禁止未经许可的再分发

详见 [LICENSE](LICENSE) 文件。

## 免责声明

本项目仅供学习研究、安全测试与合法的自动化场景使用。使用者应遵守目标网站的服务条款和 robots 协议，遵守所在地区的法律法规。作者不对任何滥用行为承担责任。

更多真实场景示例见 [examples/](examples/) 目录。

## 致谢

- [STPyV8](https://github.com/cloudflare/stpyv8) — Python 与 V8 的互操作层参考了 STPyV8 的设计，并在其基础上进行了优化。
