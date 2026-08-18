# 工具链完整参考 — 三条路由详解

## 调用前置条件

本文件是工具能力参考，不是当前运行环境的工具清单。`adspower-browser`、`js-reverse-mcp`、`reqable-mcp`、`ida-pro-mcp` 等名称只有在当前会话 active tools 明确暴露时才能直接调用。

禁止行为：

- 不要因为本文出现 `MCP:` 前缀就发起不存在的 tool call。
- 不要把 `evaluate-script` 和 `evaluate_script` 当成同一个工具的两个拼写；它们属于不同外部工具示例。
- 不要把 AdsPower 页面、普通 Chrome 页面、`js-reverse-mcp` 页面、CDP WebSocket 页面视为同一个浏览器上下文。
- 不要通过 shell 伪造不存在的 MCP 调用。

安全降级：

- 无 MCP：使用浏览器 DevTools、HAR、复制 `scripts/hooks/*.js`、本地下载 JS、运行 bundled scripts。
- 有 CDP WebSocket：使用 `scripts/cdp_bridge.py`。
- 有真实 MCP：严格按该 MCP 当前 schema 调用，并保持路线一致。

## ⚠️ 核心原则

**adspower-browser** 和 **js-reverse-mcp** 是独立的浏览器进程，不能混用。
每次调试必须选择一条路线并坚持到底。

---

## 路线A：纯 adspower-browser（指纹保护优先）

适用场景：目标有 Cloudflare/验证码/风控，需要真实指纹

### 能力边界
- ✅ 指纹保护（AdsPower内核模拟真实浏览器）
- ✅ evaluate-script 注入Hook/执行JS/获取变量
- ✅ 页面交互（点击/填充/拖拽/截图）
- ✅ Cookie管理和复用
- ❌ 断点调试
- ❌ 源码搜索
- ❌ 调用栈追踪

### Profile管理
```
MCP: adspower-browser → get-browser-list → 查看所有profile
MCP: adspower-browser → create-browser → 创建新profile（需指纹参数）
MCP: adspower-browser → open-browser → 打开profile（返回CDP端口）
MCP: adspower-browser → close-browser → 关闭profile
MCP: adspower-browser → get-opened-browser → 获取已打开profile + CDP端口
```

### 页面操作
```
MCP: adspower-browser → navigate → 导航到URL
MCP: adspower-browser → screenshot → 截图
MCP: adspower-browser → get-page-html → 获取HTML源码
MCP: adspower-browser → get-page-visible-text → 获取可见文本
```

### 元素交互
```
MCP: adspower-browser → click-element → 点击元素
MCP: adspower-browser → fill-input → 填充输入框
MCP: adspower-browser → select-option → 选择下拉选项
MCP: adspower-browser → hover-element → 悬停元素
MCP: adspower-browser → scroll-element → 滚动元素
MCP: adspower-browser → drag-element → 拖拽元素（滑块验证码）
```

### 脚本执行
```
MCP: adspower-browser → evaluate-script → 执行JS并返回结果
# 典型用途：注入Hook、提取变量、触发事件
```

### Cookie/Cache管理
```
MCP: adspower-browser → get-profile-cookies → 获取profile的Cookie
# 获取CDP端口的3种方法：
# 1. get-opened-browser → 返回 ws://127.0.0.1:61559/...
# 2. AdsPower客户端界面顶部显示
# 3. http://127.0.0.1:50325/api/v1/browser/active
```

### 路线A升级到路线C
```
# 当路线A的 evaluate-script 不够用时（需要断点/源码搜索）
adspower-browser → open-browser → get-opened-browser → 获取CDP端口
→ Python websocket-client → 手工CDP协议（见路线C）
```

---

## 路线B：纯 js-reverse-mcp（深度调试优先）

适用场景：目标无反爬/内网环境/快速原型验证

### 能力边界
- ✅ 断点调试（set_breakpoint_on_text）
- ✅ 调用栈追踪（get_paused_info）
- ✅ 源码搜索（search_in_sources）
- ✅ 页面加载前注入（inject_before_load）
- ✅ Hook注入（evaluate_script）
- ✅ 网络请求列表（list_network_requests）
- ❌ 指纹保护（浏览器可能就是普通Chrome）
- ❌ Cookie持久化管理

### 选择页面
```
MCP: js-reverse-mcp → new_page → 创建新页面
MCP: js-reverse-mcp → select_page → 选择已有页面
MCP: js-reverse-mcp → list_scripts → 查看已加载的JS
```

### Hook注入
```
MCP: js-reverse-mcp → navigate_page → 导航到目标URL
MCP: js-reverse-mcp → inject_before_load → 注入JS（页面加载前执行）★关键
MCP: js-reverse-mcp → evaluate_script → 动态执行JS
```

### 断点调试
```
MCP: js-reverse-mcp → search_in_sources → 搜索函数名/关键字
MCP: js-reverse-mcp → set_breakpoint_on_text → 设断点
# 触发目标操作（登录/提交）
MCP: js-reverse-mcp → get_paused_info → 查看调用栈和变量
MCP: js-reverse-mcp → step → 单步执行
MCP: js-reverse-mcp → pause_or_resume → 继续执行
MCP: js-reverse-mcp → remove_breakpoint → 移除断点
MCP: js-reverse-mcp → list_breakpoints → 列出所有断点
```

### 源码与网络
```
MCP: js-reverse-mcp → get_script_source → 获取JS源码（保存到本地）
MCP: js-reverse-mcp → list_network_requests → 查看网络请求
MCP: js-reverse-mcp → break_on_xhr → 在XHR发送时断点
MCP: js-reverse-mcp → get_request_initiator → 查看请求发起者
MCP: js-reverse-mcp → get_websocket_messages → 查看WebSocket消息
MCP: js-reverse-mcp → list_console_messages → 查看控制台输出
```

### 截图
```
MCP: js-reverse-mcp → take_screenshot → 截取当前页面
```

---

## 路线C：AdsPower CDP桥接（全能型）

适用场景：既要指纹保护，又要断点调试/源码搜索

### 能力边界
- ✅ 指纹保护（AdsPower内核）
- ✅ 断点调试（通过CDP Debugger域）
- ✅ 源码搜索（通过CDP Debugger域）
- ✅ Hook注入（通过CDP Runtime域）
- ✅ 可编程控制（Python全控制）
- ⚠️ 需要自己写CDP代码

### 桥接步骤

```
步骤1：打开AdsPower指纹浏览器
  MCP: adspower-browser → open-browser → 传入profile_id
  MCP: adspower-browser → navigate → 目标URL
  MCP: adspower-browser → get-opened-browser → 获取CDP端口（如 61559）

步骤2：Python连接CDP WebSocket
  pip install websocket-client
  
  import json
  import websocket
  
  # 获取WebSocket URL
  import http.client
  conn = http.client.HTTPConnection("127.0.0.1", 61559)
  conn.request("GET", "/json")
  tabs = json.loads(conn.getresponse().read())
  ws_url = tabs[0]['webSocketDebuggerUrl']
  
  ws = websocket.create_connection(ws_url)

步骤3：通过CDP协议操作
  # 执行JS
  ws.send(json.dumps({"id":1,"method":"Runtime.evaluate",
      "params":{"expression":"document.title","returnByValue":true}}))
  
  # 设断点
  ws.send(json.dumps({"id":2,"method":"Debugger.enable"}))
  ws.send(json.dumps({"id":3,"method":"Debugger.setBreakpointByUrl",
      "params":{"urlRegex":".*app.*.js","lineNumber":0}}))
  
  # 注入页面加载前执行脚本
  ws.send(json.dumps({"id":4,"method":"Page.addScriptToEvaluateOnNewDocument",
      "params":{"source":"window.__hooked = true;"}}))
```

### 完整CDP桥类

参考 recipe 6（SKILL.md 配方6）或 `sites/rednote/src/cdp_bridge.py` 的完整实现。

核心CDP域：
- `Runtime` — JS执行、变量读取
- `Debugger` — 断点、单步、调用栈
- `Network` — 请求拦截、响应修改
- `Page` — 导航、截图、加载前注入
- `DOM` — DOM查询和修改

---

## 路线选择流程图

```
开始调试
  │
  ├─ 需要指纹保护？
  │   ├─ 否 → 路线B（js-reverse-mcp）
  │   └─ 是 → 需要断点/源码搜索？
  │           ├─ 否 → 路线A（adspower-browser）
  │           └─ 是 → 路线C（AdsPower + Python CDP）
```

---

## Python请求层工具

### curl_cffi — TLS指纹模拟（重要）

**适用场景**：
- 站点检测TLS指纹（JA3/JA4）
- Python requests 被拦截（403/412）
- 需要模拟Chrome/Safari等浏览器的TLS握手

**安装**：
```bash
pip install curl_cffi
```

**使用**：
```python
from curl_cffi import requests

# 模拟Chrome 131的TLS指纹
resp = requests.get("https://target.com/api", 
                    impersonate="chrome131",
                    headers=headers,
                    cookies=cookies)

# 可选指纹: chrome124/chrome131/safari17_0/firefox120 等
```

**关键注意**：
- 必须配合正确的Cookie和完整headers
- 不是 pip install curl-cffi（注意下划线vs连字符）
- 适用于"登录态可复用"的场景（配CDP桥/AdsPower的Cookie）

### 请求层选型：curl_cffi 之外的三个补充

当 curl_cffi 的内置指纹版本不够新、或需要在 Go/Node 服务化时，用下面三个：

| 工具 | 语言 | 何时选它 |
|------|------|---------|
| **tls-client** (`bogdanfinn/tls-client`) | Go（含 py/js/c# 绑定） | 指纹更激进、要 Go 服务化/高并发；`pip install tls-client`，`Session(client_identifier="chrome131")` |
| **curl-impersonate** (`lexiforest/curl-impersonate`) | C/curl 底层 | 需要命令行 curl 或作为其它语言底座；curl_cffi 就是它的 py 绑定，ECH/HTTP3/新指纹更全 |
| **hrequests** (`daijro/hrequests`) | Python | 想一体化：requests 替代 + TLS 指纹 + 无头浏览器；`pip install hrequests`（注意 2024 后更新趋缓） |

**决策链**：Python 首选 `curl_cffi`（生态最活跃）→ 指纹版本不够/要服务化换 `tls-client` → 要底层/命令行用 `curl-impersonate` → 想连无头浏览器一起搞用 `hrequests`。
> 本机 Python 一律用 `python3.11` 安装（`python3`/`python` 是坏的 Store stub）。

---

## 常用Hook模板（所有路线通用）

### Hook fetch
```javascript
const origFetch = window.fetch;
window.fetch = async function(...args) {
    const [url, options] = args;
    console.log('[fetch]', url, options?.method, options?.body?.substring?.(0, 200));
    const response = await origFetch.apply(this, args);
    const clone = response.clone();
    clone.text().then(t => console.log('[fetch response]', t.substring(0, 500)));
    return response;
};
```

### Hook XHR
```javascript
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    return origOpen.apply(this, arguments);
};
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(body) {
    console.log('[XHR]', this._method, this._url, body?.substring?.(0, 200));
    this.addEventListener('load', function() {
        console.log('[XHR response]', this.responseText?.substring?.(0, 500));
    });
    return origSend.call(this, body);
};
```

### Hook CryptoJS
```javascript
if (window.CryptoJS) {
    ['MD5', 'SHA1', 'SHA256', 'HmacMD5', 'HmacSHA256'].forEach(fn => {
        if (CryptoJS[fn]) {
            const orig = CryptoJS[fn];
            CryptoJS[fn] = function(msg, key) {
                console.log(`[CryptoJS.${fn}]`, msg?.toString?.(), key?.toString?.());
                const result = orig.apply(this, arguments);
                console.log(`[CryptoJS.${fn} result]`, result.toString());
                return result;
            };
        }
    });
}
```

### Hook document.cookie
```javascript
const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
             Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
Object.defineProperty(document, 'cookie', {
    get: function() { return desc.get.call(document); },
    set: function(val) {
        console.log('[cookie set]', val);
        desc.set.call(document, val);
    }
});
```

### Hook setRequestHeader
```javascript
const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    console.log('[setRequestHeader]', header, '=', value?.substring?.(0, 100));
    return origSetRequestHeader.call(this, header, value);
};
```
