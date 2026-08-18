# iv8 API 参考

本文件为 iv8 补环境的 API 速查。当你在写代码时需要确认精确的参数签名、默认值或可用工具方法时,读取本文件。

## 目录

- [`iv8.JSContext` 构造参数](#iv8jscontext-构造参数)
- [`iv8.JSContext` 方法](#iv8jscontext-方法)
- [JS 侧 `window.__ZY__` 工具](#js-侧-window__zy__-工具)
- [`page.load` snapshot 字段](#pageload-snapshot-字段)
- [安装与运行环境](#安装与运行环境) — 含 [安装](#安装) / [运行环境](#运行环境) / [社区版 vs 专业版](#社区版-vs-专业版)
- [社区版关键限制](#社区版关键限制影响补环境策略)
- [社区版桩函数形态与实测清单](#社区版桩函数形态与实测清单必读防踩坑) — 含 [已实测清单](#已实测的桩函数清单按类别) / [探测方法](#桩函数探测方法)
- [开箱即用能力](#开箱即用能力补环境前必知)
- [内存限制](#内存限制必读防内存爆破) — 含 [分级判定](#分级判定v931-新增先判定场景再选层) / [第 1 层](#第-1-层开发期必须基础v8-堆限制--gc-清理) / [第 2 层](#第-2-层生产期必须进程隔离子进程--windows-job-object) / [第 3 层](#第-3-层高安全组合第-2-层--超时--psutil-监控) / [强制约束](#内存限制强制约束v931-修订)

## `iv8.JSContext` 构造参数

| 参数 | 默认 | 用途 |
|------|------|------|
| `mode` | `"prod"` | `"prod"` 零开销 / `"debug"` 启用 API 监控(**补环境默认用 debug**) |
| `environment` | None | 指纹覆盖(**仅在需要与目标站点对齐时才用**,优先 iv8 内置) |
| `config` | None | 框架行为(timezone、permissions.*) |
| `ignore_apis` | 内置默认 | 监控日志排除的 API |
| `time_mode` | `"logical"` | `"logical"` 虚拟时间 / `"system"` 真实时间 |
| `js_api` | `"__iv8__"` | **统一改为 `"__ZY__"`** 防止变量名被检测 |

## `iv8.JSContext` 方法

| 方法 | 用途 |
|------|------|
| `eval(source, name="", line=-1, col=-1, to_py=False)` | 执行 JS;返回值自动转 Python 类型。嵌套对象用 `to_py=True` 递归转换 |
| `add_resource(url, body, status=200, headers=None)` | 注入离线 HTTP 响应 |
| `expose(obj, name?)` / `expose(**kwargs)` | 暴露 Python 对象到 `__ZY__.data` 命名空间 |
| `get_defaults()` | 查看所有 iv8 内置指纹路径及默认值(排查对齐时用) |
| `close(gc="none")` | 释放上下文;`gc` 可选 `"low_memory"`/`"v8"`/`True` 或 `"aggressive"` |

## JS 侧 `window.__ZY__` 工具

| 工具 | 用途 |
|------|------|
| `page.load(snapshot)` | 流式加载 HTML;snapshot 字段:`baseURL`(必填)、`html`(必填)、`resources`(URL→响应映射,**每个资源可有自己的响应头**)、`headers`(**主文档响应头**,如 CSP、Set-Cookie;与 resources 内的 headers 不可混淆) |
| `eventLoop.advance(total, step?)` | 分帧推进虚拟时间(默认步长 ~16.67ms),模拟 rAF 节奏 |
| `eventLoop.sleep(ms?, max?)` | 推进 ms 毫秒,按时间线顺序排空任务队列 |
| `eventLoop.tick(ms?)` | 推进 ms 毫秒并执行一轮事件循环 |
| `eventLoop.drain(max?)` | 排空所有已到期任务,不推进时间(**最常用**) |
| `eventLoop.drainMicrotasks()` | 仅排空微任务队列(Promise.then) |
| `eventLoop.drainTimers()` | 仅处理已到期的定时器回调 |
| `eventLoop.setAutoAdvanceStep(ms)` | 设置 `performance.now()` 自动递增量(默认 0.001ms) |
| `eventLoop.setDateAdvanceStep(ms)` | 设置 `Date.now()` 自动递增量(默认 1ms) |
| `input.dispatchMouseEvent(init)` | 派发可信(`isTrusted=true`)鼠标事件 |
| `input.dispatchPointerEvent(init)` | 派发可信指针事件 |
| `netLog.entries` | 捕获的 XHR/fetch/导航请求数组 |
| `wrapNative(fn, name)` | 将 JS 函数伪装为 `[native code]`(**补丁覆盖 API 时强制使用**) |
| `help()` | 打印所有可用工具及说明 |

## `page.load` snapshot 字段

| 字段 | 类型 | 必填 | 用途 |
|------|------|------|------|
| `baseURL` | string | 是 | 页面 URL;同步 `document.URL`、`location.href` |
| `html` | string | 是 | HTML 源码 |
| `resources` | Object | 否 | URL → 响应映射;`<script src>`、`<link href>`、CSS `@import`、运行时 XHR/fetch 均从中匹配。值支持简写(字符串 body)或完整格式(`{body, status, headers}`,其中 `headers` 是**该资源的响应头**,如 `content-type`) |
| `headers` | Object/Array | 否 | **主文档响应头**(CSP、Set-Cookie 等)。注意:这是主文档的响应头,与 `resources` 内每个资源自带的 `headers` 是两个不同层级,不要混淆。cookie 注入优先用此处的 `Set-Cookie` |

## 安装与运行环境

### 安装

```bash
pip install --upgrade iv8 -i https://pypi.org/simple
```

建议始终保持最新版(`--upgrade`),iv8 仍在快速迭代,新版本会扩充内置 API 覆盖与指纹字段,减少手动补环境工作量。

### 运行环境

| 维度 | 支持 |
|------|------|
| Python | 3.8–3.14 |
| Windows | x64 |
| Linux | x64,manylinux 标准(支持 CentOS/Ubuntu/Debian/Fedora 等主流发行版) |
| macOS | arm64 实验版,经 GitHub Releases 分发,**不上 PyPI** |

### 社区版 vs 专业版

PyPI 上的 `iv8` 是**社区版**(当前版本),提供完整基线浏览器环境,覆盖绝大多数日常用例。专业版额外包含:

- CSS 布局引擎(层叠、继承、盒模型布局)、CSS 动画与过渡驱动
- 协议栈(深度裁剪 Chromium 网络模块,非 Cronet 封装)
- 多 Context Worker 并行执行
- 增强 API 语义/时序/边界对齐(覆盖更多规范边缘情况)
- 计算性能与内存占用的深度算法优化

社区版持续演进,专业版成熟特性会逐步回移植。

### 社区版关键限制(影响补环境策略)

| 限制 | 说明 | 补环境对策 |
|------|------|-----------|
| 不发真实 HTTP 请求 | XHR/fetch/WebSocket 的 API 形态完整,但响应需通过 `add_resource()` 注入(page.load 的 `resources` 参数或运行时 `ctx.add_resource()`) | 用 Python(httpx/curl_cffi)发真实请求 + `add_resource()` 注入响应 |
| 内置反调试已禁用 | `debugger;` 语句在 iv8 中不触发中断 | 用 `vdebugger;` + `vconsole` + 日志分离(stderr 重定向 + grep 过滤)调试 |
| **接口级桩函数(坑!)** | 重型浏览器 API(WebRTC/WebTransport/Sensors 等)类存在但方法是空桩,调用时**静默 reject 或返回 null**,不会被 JS 层 Promise hook 拦截 | 见下方"桩函数形态与实测清单",在 page.load 之前用 JS 覆盖 prototype 方法 |

### 社区版桩函数形态与实测清单(必读,防踩坑)

> **⚠️ Gotcha(v9.22 新增)**:iv8 在 V8 引擎之上提供广泛的浏览器 API 模拟层,覆盖以下 Web 标准(部分为**接口级桩实现**)。"类存在,方法是桩"是 iv8 社区版的核心限制之一,不补不会立即报错,但会**静默中断 JS 的 Promise 链**,导致加密参数生成失败或指纹采集异常。本节是 iv8 补环境场景的高频踩坑点,详见 [iv8-env-patching.md](iv8-env-patching.md) §4 Gotcha。

iv8 对依赖操作系统底层资源(摄像头驱动、WebRTC 网络栈、文件系统弹窗等)的 API 采取"**类存在,方法是桩**"策略。桩函数有 4 种形态,**形态 1 最隐蔽**:

| 形态 | 特征 | 检测方式 | 例子 |
|------|------|---------|------|
| **1. C++ 层 reject**(最坑) | 方法返回已 reject 的 Promise,reason 是字符串 `"Not implemented"`,**绕过 JS 层所有 Promise hook**(Promise.reject / executor reject 都拦不到) | hook `unhandledrejection` 事件 | `RTCPeerConnection.createOffer/createAnswer/setLocalDescription/setRemoteDescription/addIceCandidate/getStats` |
| **2. JS 层 reject** | 方法返回 reject 的 Promise,reason 是 `Error: xxx not implemented in mock environment`,**JS 层 Promise hook 可拦截** | hook `Promise.reject` | `window.showDirectoryPicker/showOpenFilePicker/showSaveFilePicker` |
| **3. 回调永不触发**(静默桩) | 方法存在,回调注册成功,但回调**永远不触发**,无 reject 无 error,只是"挂起" | drainMicrotasks 后回调 state 仍为 pending | `WebSocket.onopen` / `EventSource.onopen` / `BroadcastChannel.onmessage` / `canvas.toBlob` |
| **4. resolve 成 null/undefined** | 方法返回 resolve 的 Promise,但值是 null/undefined,后续 `.then` 里访问属性抛 TypeError | 检查 resolve 值是否为 null | `navigator.gpu.requestAdapter` / `serviceWorker.register` / `WebTransport.ready` / `OffscreenCanvas.getContext('2d'/'webgl')` / `ReadableStream.prototype.getReader()` / `MessageChannel` |

#### 已实测的桩函数清单(按类别)

> 以下清单通过批量 probe 实测得到(iv8 0.1.4,~140 个 API)。**未列出的 API 默认按"开箱即用能力"清单处理**。桩函数不补不会立即报错,但会**静默中断 JS 的 Promise 链**,导致后续逻辑(加密参数生成、指纹采集等)失败。

**第一类:网络/传输(最致命,易导致 Promise 链断裂)**

| API | 形态 | 备注 |
|-----|------|------|
| `RTCPeerConnection.createOffer/createAnswer/setLocalDescription/setRemoteDescription/addIceCandidate/getStats` | 1 | **必须补**:在 prototype 上用 `Promise.resolve({type:'offer',sdp:FAKE_SDP})` 覆盖 |
| `RTCPeerConnection.generateCertificate` | 1 | 静态方法同样 reject |
| `WebSocket.onopen/onmessage` | 3 | 构造 OK,readyState=0,但事件永不触发 |
| `WebTransport.ready` | 4 | resolve 为 undefined |
| `EventSource.onopen` | 3 | 构造 OK,readyState=0 永不变成 1 |
| `BroadcastChannel.onmessage` | 3 | 构造 OK |

**第二类:硬件/传感器**

| API | 形态 | 备注 |
|-----|------|------|
| `navigator.mediaDevices.getUserMedia` | 2 | reject `NotAllowedError: Permission denied` |
| `Accelerometer/Gyroscope/AmbientLightSensor/LinearAccelerationSensor/AbsoluteOrientationSensor/GravitySensor` | - | 构造 OK,但 start() 后事件未验证 |

**第三类:图形/媒体**

| API | 形态 | 备注 |
|-----|------|------|
| `OfflineAudioContext` | - | 构造抛 `Cannot set properties of null` |
| `OffscreenCanvas.getContext('2d'/'webgl')` | 4 | 返回 null |
| `AudioContext.audioWorklet` | - | 完全缺失(undefined) |
| `canvas.toBlob` | 3 | 回调触发但 blob.size=0 |
| `canvas.captureStream` | - | **正常工作**(active=true) |

**第四类:文件/存储**

| API | 形态 | 备注 |
|-----|------|------|
| `window.showDirectoryPicker/showOpenFilePicker/showSaveFilePicker` | 2 | reject `not implemented in mock environment` |
| `URL.createObjectURL` | - | **完全缺失**(typeof=undefined) |
| `FileReaderSync` | - | 完全缺失(Worker 专用) |

> 注:`IndexedDB` / `CookieStore` / `localStorage` / `sessionStorage` / `FileReader` / `Blob` / `File` **实际正常工作**。

**第五类:Streams API(半桩)**

| API | 形态 | 备注 |
|-----|------|------|
| `ReadableStream.prototype.getReader()` | 4 | **返回 null**,所有流读取操作失败 |
| `WritableStream` / `TransformStream` | - | 构造 OK(未测写入) |

**第六类:其他**

| API | 形态 | 备注 |
|-----|------|------|
| `navigator.gpu.requestAdapter` | 4 | resolve 为 null |
| `serviceWorker.register` | 4 | resolve 为 null |
| `navigator.mediaDevices.getDisplayMedia` | - | 完全缺失 |
| `NDEFReader` (Web NFC) | - | 完全缺失 |
| `HTMLMediaElement.remote` | - | 完全缺失 |
| `MessageChannel` | 4 | port1/port2 为 null |
| `window.fetch` | - | 调用后 reject "Failed to fetch"(无真实网络) |

> 注:`enumerateDevices` / `geolocation.getCurrentPosition` / `getBattery` **实际正常工作**(返回假数据但 Promise resolve),不算桩。

#### 桩函数探测方法

当 JS 逻辑出现"调用某 API 后 Promise 链中断、加密参数不生成或只生成一半"时,按以下步骤定位:

1. **Hook `unhandledrejection`**:捕获形态 1 和 2 的 reject reason
   ```js
   window.addEventListener('unhandledrejection', function(e) {
       console.log('reject:', e.reason);
   });
   ```
2. **检查 reason 字符串**:
   - `"Not implemented"` → 形态 1(C++ 层),必须在 prototype 上覆盖
   - `Error: ... not implemented in mock environment` → 形态 2(JS 层)
3. **判断返回值是否为 null**:`navigator.gpu.requestAdapter()` / `serviceWorker.register()` / `ReadableStream.getReader()` 等 resolve 成功但值是 null
4. **检查回调是否触发**:drainMicrotasks + sleep 后,onopen/onmessage 等 callback 是否执行

> 探测脚本模板:见 `probes/probe_iv8_stubs.py`(批量探测 API 状态)和 `probes/probe_iv8_stubs_v3_split.py`(分批隔离,避免单次崩溃)。

### 开箱即用能力(补环境前必知)

iv8 社区版开箱即带以下能力,**这些不需要补**:

- **浏览器指纹**:Chrome/Windows 基线 200+ 字段,内部字段间一致(`get_defaults()` 查看全量路径)
- **BOM/DOM/CSSOM**:Window/Location/History/Navigator/Screen、70+ HTML 元素、25+ CSS 规则类型、ShadowRoot、MutationObserver、Custom Elements
- **事件系统**:EventTarget/Event 继承链,80+ 事件类型(UI/Mouse/Pointer/Keyboard/Touch/Drag/Clipboard/Animation 等)
- **Crypto**:`crypto.getRandomValues` + SubtleCrypto(AES-GCM/CBC、RSA-OAEP/PSS、ECDH/ECDSA、HMAC/HKDF/PBKDF2、digest 全算法)
- **图形**:Canvas 2D、WebGL/WebGL2(30+ 扩展)、WebGPU、OffscreenCanvas
- **网络 API 形态**:XHR/fetch/WebSocket/WebTransport 的 API 形态与响应匹配机制(但不发真实请求,见上表)
- **存储**:localStorage/sessionStorage/CookieStore/IndexedDB
- **Worker**:Worker/SharedWorker/ServiceWorker/Worklet
- **可信事件**:`input.dispatchMouseEvent/PointerEvent` 派发 `isTrusted=true` 事件

> 详细 API 覆盖范围与每个类别限制见 [iv8 PyPI 文档](https://pypi.org/project/iv8/)。

### 内存限制(必读,防内存爆破)

> **⚠️ 强制规范(v9.23 新增;v9.31 修订引入"开发期 vs 生产期"分级)**:所有 iv8 使用场景(JSContext / page.load / ctx.eval)**必须**设置最大内存限制。iv8 基于 V8 引擎,目标 JS 代码可能因死循环分配、大数组构建、递归爆栈等导致内存爆破,若不限制会拖垮主进程。本节给出 3 层限制策略,按隔离强度递增。

#### 分级判定(v9.31 新增,先判定场景再选层)

```
IF 场景 = 开发期(快速验证 / 调试 / 一次性跑通 / 可信 JS / 小文件)
   THEN 必须实施第 1 层(with + gc 清理)
   → 不需要子进程隔离

IF 场景 = 生产期(批量 / 长跑 / 不可信 JS / 200KB+ / 复杂补环境)
   THEN 必须实施第 2 层(子进程 + Job Object)
   OR 第 3 层(第 2 层 + psutil 监控,高安全场景)

IF 开发期跳过第 1 层 / 生产期跳过第 2 层
   → P0 违规,触发阶段门阻断
```

> **为什么分级**:v9.23 原规则"所有场景必须第 1 层,不可信 JS 推荐第 2 层"对开发期过重(第 2 层 100+ 行 ctypes 模板对快速验证不现实),对生产期过轻(开发期用裸 ctx 违反 §1.1)。v9.31 按"风险等级 × 节奏"分级,开发期最小集 + 生产期强隔离。

#### 第 1 层(开发期必须,基础):V8 堆限制 + GC 清理

**适用场景**:开发期 / 可信 JS / 小文件 / 简单补环境

**实施方式**:
- 用 `with` 语句(强制,见 [conventions.md](conventions.md) §4.1.1)
- with 退出前调用 `ctx.close(gc="low_memory")` 主动 GC
- 若 iv8 暴露 V8 标志传递接口:设置 `--max-old-space-size=N`(默认 512MB)
- 限制范围:仅 V8 堆,不限制 Python 侧内存

```python
# 第 1 层模板:with + gc 清理(v9.31 修正,与 code-conventions.md §1.1 一致)
with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
    ctx.eval(js_code)
    ctx.close(gc="low_memory")  # with 退出前主动 GC
# with 退出时 iv8 幂等处理,不会重复报错
```

```python
# ✗ 禁止(v9.31 标注):裸 ctx 违反 conventions.md §4.1.1 强制上下文管理器
ctx = iv8.JSContext(mode="debug", js_api="__ZY__")
try:
    ctx.eval(js_code)
finally:
    ctx.close(gc="low_memory")
```

> ⚠️ 第 1 层只限制 V8 堆,不防止 Python 侧内存膨胀(如 iv8 内部 C++ 层的 DOM 对象累积)。不可信 JS / 生产期必须用第 2 层。

#### 第 2 层(生产期必须,进程隔离):子进程 + Windows Job Object

**适用场景**:生产期 / 不可信 JS / 大文件(200KB+) / 复杂补环境 / 批量场景

**实施方式**:
- iv8 调用放到子进程(`subprocess.Popen`)
- 主进程创建 Job Object,设置 `JOB_OBJECT_LIMIT_PROCESS_MEMORY`
- 子进程挂起启动(`CREATE_SUSPENDED`)→ 绑定到 Job Object → 恢复执行
- 超内存 OS kill 子进程(退出码特殊),主进程捕获并报错
- 限制范围:整个子进程(含 V8 堆 + Python 侧 + iv8 C++ 层)

```python
# 第 2 层模板:Windows Job Object 内存限制(ctypes,无额外依赖)
import ctypes
import subprocess
from ctypes import wintypes

# Win32 常量
JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
CREATE_SUSPENDED = 0x00000004
PROCESS_SET_QUOTA = 0x0100
PROCESS_TERMINATE = 0x0001

# 结构体定义(ctypes)
class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", wintypes.ULARGE_INTEGER),
        ("WriteOperationCount", wintypes.ULARGE_INTEGER),
        ("OtherOperationCount", wintypes.ULARGE_INTEGER),
        ("ReadTransferCount", wintypes.ULARGE_INTEGER),
        ("WriteTransferCount", wintypes.ULARGE_INTEGER),
        ("OtherTransferCount", wintypes.ULARGE_INTEGER),
    ]

class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
        ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_void_p),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]

class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]

def create_job_with_memory_limit(max_mb: int):
    """创建带内存限制的 Job Object(Windows)。
    调用者不需要知道 Job Object API 细节,只需传入 max_mb。
    """
    kernel32 = ctypes.windll.kernel32
    job_handle = kernel32.CreateJobObjectW(None, None)
    if not job_handle:
        raise ctypes.WinError()

    max_bytes = max_mb * 1024 * 1024
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = (
        JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    )
    info.ProcessMemoryLimit = max_bytes
    info.JobMemoryLimit = max_bytes

    if not kernel32.SetInformationJobObject(
        job_handle, JobObjectExtendedLimitInformation,
        ctypes.byref(info), ctypes.sizeof(info)
    ):
        kernel32.CloseHandle(job_handle)
        raise ctypes.WinError()
    return job_handle

def run_iv8_in_subprocess(iv8_script: str, max_memory_mb: int = 512, timeout_sec: int = 30):
    """在内存受限的子进程中运行 iv8。
    调用者只需提供 iv8_script(完整 Python 脚本字符串)+ max_memory_mb + timeout_sec。
    返回 {"success": bool, "stdout": str, "stderr": str, "error_type": str | None}。
    """
    kernel32 = ctypes.windll.kernel32
    job_handle = create_job_with_memory_limit(max_memory_mb)
    try:
        # 挂起启动,确保绑定 Job Object 后才执行
        proc = subprocess.Popen(
            ["python", "-c", iv8_script],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=CREATE_SUSPENDED,
        )
        # 绑定到 Job Object
        proc_handle = kernel32.OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, proc.pid
        )
        if not kernel32.AssignProcessToJobObject(job_handle, proc_handle):
            proc.kill()
            raise ctypes.WinError()
        kernel32.CloseHandle(proc_handle)
        # 恢复执行
        thread_handle = kernel32.OpenThread(0x0002, False, proc.pid)  # THREAD_RESUME
        kernel32.ResumeThread(thread_handle)
        kernel32.CloseHandle(thread_handle)

        try:
            stdout, stderr = proc.communicate(timeout=timeout_sec)
            # 内存超限:OS kill 子进程,退出码特殊(通常非 0)
            if proc.returncode != 0 and b"memory" in stderr.lower():
                return {"success": False, "stdout": stdout, "stderr": stderr,
                        "error_type": "memory_exceeded"}
            return {"success": proc.returncode == 0, "stdout": stdout,
                    "stderr": stderr, "error_type": None}
        except subprocess.TimeoutExpired:
            proc.kill()
            return {"success": False, "stdout": b"", "stderr": b"timeout",
                    "error_type": "timeout"}
    finally:
        kernel32.CloseHandle(job_handle)
```

> ⚠️ 第 2 层代码模板是指导 Agent 实施的参考,**不是现成脚本**。Agent 需根据具体场景调整 iv8_script 内容(含 page.load / ctx.eval / 补环境代码)。关键 API 序列(挂起启动 → 绑定 Job → 恢复执行)不可省略。

#### 第 3 层(高安全,组合):第 2 层 + 超时 + psutil 监控

**适用场景**:高安全要求 / 不可信大文件 / 反检测场景

**实施方式**:
- 第 2 层基础上加 `psutil` 监控子进程 RSS
- 超阈值(如 max_memory_mb 的 90%)主动 kill 子进程
- 配合 `subprocess.communicate(timeout=N)` 双保险

```python
# 第 3 层模板:在第 2 层基础上加 psutil 监控
import psutil

def run_iv8_with_monitor(iv8_script, max_memory_mb=512, timeout_sec=30):
    # ... 第 2 层代码(创建 Job Object + 子进程)...
    # 额外:轮询监控子进程 RSS
    import time
    threshold = int(max_memory_mb * 0.9 * 1024 * 1024)  # 90% 阈值
    start = time.time()
    while True:
        if proc.poll() is not None:
            break  # 子进程已退出
        if time.time() - start > timeout_sec:
            proc.kill()
            return {"success": False, "error_type": "timeout"}
        try:
            rss = psutil.Process(proc.pid).memory_info().rss
            if rss > threshold:
                proc.kill()
                return {"success": False, "error_type": "memory_exceeded"}
        except psutil.NoSuchProcess:
            break
        time.sleep(0.5)
    # ... 收集结果 ...
```

#### 内存限制强制约束(v9.31 修订)

```
IF 使用 iv8(JSContext / page.load / ctx.eval)
   → 先按"分级判定"判定场景(开发期 vs 生产期)
   → 开发期:必须实施第 1 层(with + gc 清理)
   → 生产期:必须实施第 2 层(子进程 + Job Object)
   → 高安全:不可信大文件 / 反检测场景实施第 3 层(第 2 层 + psutil 监控)

IF 开发期跳过第 1 层 / 生产期跳过第 2 层
   → 违反安全边界,触发阶段门阻断(见 [SKILL.md](../../SKILL.md) "阶段门阻断规则")

IF 开发期用裸 ctx(非 with 语句)
   → 违反 [conventions.md](conventions.md) §4.1.1 强制上下文管理器
   → P0 违规
```

> **默认参数**:max_memory_mb=512(可调,大文件场景建议 1024)、timeout_sec=30(可调,复杂补环境建议 60)。
