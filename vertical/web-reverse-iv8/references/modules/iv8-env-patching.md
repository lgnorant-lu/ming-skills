# iv8 补环境模块

**何时用 iv8 补环境**(回链决策树分支 B/C/D/E):目标 JS 有 window/document/navigator/fetch 等浏览器依赖,或为 JSVMP/无法扣代码的场景,或方案 1(Python 重写)试跑失败。纯计算(无 DOM/BOM 依赖)且算法标准 → 优先方案 1,不用 iv8。补环境工作是"处理 iv8 未覆盖的边界 + 注入业务前置数据 + 对抗检测"(iv8 已内置完整浏览器环境与 200+ 指纹字段,绝大多数 API 开箱即用)。

## 目录

- [iv8 补环境核心原则](#iv8-补环境核心原则往真实浏览器靠v94-新增强制)
- [补环境心智模型:iv8 已补 vs 需要你补](#补环境心智模型iv8-已补-vs-需要你补-跨阶段)
- [trace 前置补环境](#trace-前置补环境主-阶段四) — 含 trace 前置工作流
- [补环境标准工作流(debug 日志驱动)](#补环境标准工作流debug-日志驱动-阶段四)
  - [第一步:debug 模式加载目标 JS](#第一步debug-模式加载目标-js)
  - [第二步:定位环境缺口](#第二步根据-debug-日志定位环境缺口)
  - [第三步:指纹对齐流程](#第三步指纹对齐流程核心非可选v94-重构)
  - [指纹值参与加密运算的判定与对齐](#指纹值参与加密运算的判定与对齐v94-合并核心) — 含 [识别方法](#识别方法如何判断指纹值是否参与加密运算) / [对齐流程](#对齐流程确认参与后确保-iv8-指纹值与-har-真实值一致) / [高频字段清单](#高频参与加密运算的指纹字段清单) / [排查路径](#排查路径对齐后加密参数仍不对)
  - [第四步:补网络(Python 桥接)](#第四步补网络python-桥接--add_resource)
  - [第五步:提取目标函数到 Python](#第五步提取目标函数到-python)
- [iv8 失败止损规则](#iv8-失败止损规则-阶段四强制) — 含社区版已知限制
- [加密参数生成失败排查](#加密参数生成失败排查-阶段四) — 含 [Step 1 数据对齐](#step-1-数据对齐排查入口函数被加密数据是否对齐) / [Step 2 cookie/localStorage](#step-2-cookielocalstorage-等网页专属环境排查) / [Step 3 指纹/UA](#step-3-指纹ua-排查) / [混淆器 buggy 代码处理](#混淆器生成-buggy-代码的处理实战常见)
- [检测对抗](#检测对抗-阶段四) — 含 [反调试](#反调试) / [wrapNative 规则](#wrapnative-规则v931-修订场景分级)
- [诊断:定位环境探测点](#诊断定位环境探测点-阶段四)
- [事件循环控制](#事件循环控制-阶段四)
- [日志分离:debug 输出与 print 隔离](#日志分离debug-输出与-print-隔离-阶段四)
- [API 速查](#api-速查-跨阶段)
- [多线程批量补环境](#多线程批量补环境-阶段四)
- [常见踩坑案例库](#常见踩坑案例库v95-新增实战积累-阶段四) — v9.5 新增,5 条实战高频踩坑(MessageChannel/ctx.close/page.load timeout/桩时机/environment 路径)
- [代码规范与模板](#代码规范与模板写代码前必读-跨阶段)
- [关键提醒](#关键提醒-跨阶段)

## iv8 补环境核心原则:保持 iv8 内部一致性(v9.6 修订,原 v9.4 规则废止)

> **v9.6 修订**:原 v9.4 规则"指纹字段被加密点位文件读取 → 必须用 HAR 真实值对齐"已废止。实战反馈(3 份问卷)证明此规则会破坏 iv8 内部一致性(iv8 内置 Chrome 130,注入 HAR 的 Chrome 120 UA → UA 与 userAgentData 不一致 → 被站点检测)。新规则改为"保持 iv8 内部一致性,仅服务端校验具体值时才调整"。

**原则**:iv8 本身是完整一致的浏览器环境(200+ 字段内部一致),禁止无脑注入 HAR 采集值破坏内部一致性。

**默认行为**:保持 iv8 内置默认值,仅服务端校验具体值时才用 environment 整体覆盖。

**判定流程**(与 [stage4.md](../workflow/stage4.md) §5.4.5 对齐):

```
Step 1: 确认某客户端环境字段是否参与加密运算
   IF 不参与加密运算(仅被检测)
      → 保持 iv8 内置默认值(内部一致,通常能通过检测)
      → 禁止覆盖(破坏一致性)
   IF 参与加密运算(如 navigator.userAgent 拼接进待加密字符串)
      → Step 2

Step 2: 判断服务端是否校验该字段的具体值
   IF 服务端不校验具体值(只校验加密参数正确性)
      → 保持 iv8 默认值(方案 2 iv8 内部生成加密参数,读取 iv8 默认值,自洽)
   IF 服务端校验具体值(如要求 UA 必须是 Chrome)
      → Step 3

Step 3: 必须调整时,用 environment 参数整体覆盖(保持内部一致性)
   - 禁止在 JS 里手动改单个字段(破坏字段间一致性,如改 UA 不会同步 userAgentData)
   - 必须用 environment 参数整体覆盖(iv8 内部会同步关联字段)
   - 覆盖范围:仅覆盖服务端校验具体值的字段,其他字段保持默认
```

**禁止**:
- ⛔ 无脑把所有 HAR 指纹值注入 iv8(破坏内部一致性)
- ⛔ 在 JS 里手动改单个字段(如 `navigator.userAgent = 'xxx'`)
- ⛔ 用占位值(如 `"00000000000000000000000000000000"` / `"placeholder"`)
- ⛔ 主动对齐所有 trace 标注字段(原 v9.4 规则,已废止)

**与网站运行时上下文的区分**(v9.6 新增):
- **客户端环境上下文**(本节):不随网站变化,保持 iv8 内部一致性
- **网站运行时上下文**(见 [stage4.md](../workflow/stage4.md) §5.4.5):随网站变化,必须逆向生成机制
- 两类上下文对齐策略不同,不要混淆

**工具对象名保护:** 创建 Context 时统一用 `js_api="__ZY__"`,JS 侧工具对象挂载为 `window.__ZY__`(而非默认的 `__iv8__`),防止目标 JS 检测 `__iv8__` 工具对象名。

**iv8 架构澄清(常见误解)**:

| 误解 | 实际 |
|------|------|
| "page.load 内的 JS 在沙箱里,Python 侧的 ctx.eval/hook 在沙箱外,两者隔离" | **不隔离**。同一 `JSContext` 内的所有 JS(page.load 加载的、ctx.eval 执行的、expose 桥接的)共享**同一个 V8 Context**。Python 侧 `ctx.eval` 能直接访问 page.load 内的全局变量、函数、闭包(只要它们暴露到 window 或通过 expose 桥接) |
| "闭包内的函数 Python 侧访问不到" | **部分正确**。闭包内的局部变量确实不可见(这是 JS 作用域规则,不是沙箱隔离),但可以通过修改源码注入 `window.__HOOK__ = 闭包内函数` 暴露(见 [code-extraction.md](code-extraction.md) §5.5 闭包 hook 策略) |
| "page.load 是浏览器沙箱,有 CORS/CSP 限制" | **无 CORS/CSP 限制**。iv8 不是浏览器,page.load 仅解析 HTML+执行 script,没有同源策略/CSP/网络层限制。所有"跨域"在 iv8 里都不存在 |

## 补环境心智模型:iv8 已补 vs 需要你补 [跨阶段]

| 类别 | iv8 已补好(开箱即用) | 你需要处理 |
|------|----------------------|-----------|
| 浏览器 API | navigator/window/document/screen/location/history、DOM 70+ 元素、80+ 事件、crypto、Canvas、WebGL 等 | iv8 未覆盖的冷门 API(如 MessageChannel 的 port1/port2 可能为 null,赋值 onmessage 报 `Cannot set properties of null`) |
| 浏览器指纹 | Chrome/Windows 基线 200+ 字段,内部字段间一致 | 客户端环境上下文(不随网站变化):保持 iv8 内置默认值;仅服务端校验具体值时用 environment 整体覆盖(见上方"iv8 补环境核心原则");网站运行时上下文(随网站变化)见 [stage4.md](../workflow/stage4.md) §5.4.5 |
| 网络请求 | XHR/fetch/WebSocket 的 API 形态与响应匹配机制 | **真实 HTTP 请求**(社区版不发)→ 用 Python 发 + `add_resource()` 注入 |
| 时间/事件循环 | 微/宏任务调度、rAF、定时器 | 用 `eventLoop.*` 推进虚拟时间,让异步回调执行 |
| 反调试 | `debugger;` 已禁用、工具对象不可检测 | 用 `vdebugger;` + `vconsole` + 日志分离(stderr 重定向 + grep 过滤)调试 |
| 函数伪装 | `wrapNative` 把 JS 函数伪装成 `[native code]` | **只要补丁覆盖浏览器 API,就必须用 wrapNative 伪装** |

## trace 前置补环境(主) [阶段四]

**前提**:HAR 和 trace 是核心文件,缺一不可。没 trace 时方案 2 停止(无法做前置补环境,也无法做环境指纹对齐)。

### trace 前置工作流

```
1. 从阶段二产出物取加密点位涉及的文件 URL 列表
2. 用 trace_analyzer.py 按 stack.file 过滤 → 目标 JS 的 API 调用清单
3. 对比 iv8 已有环境(见心智模型表 + api-reference.md)→ 找缺口 → 按缺口预补环境
4. 进入 iv8 debug 工作流验证
```

> trace 是静态清单(应该有什么),iv8 debug 是运行时验证(实际缺什么),两者互补。补多余环境不影响正确性——iv8 跑加密流程时只走加密代码路径,非加密 API 不会被调用。

## 补环境标准工作流(debug 日志驱动) [阶段四]

> **前置门(强制,v9.30 新增)**:进入本工作流前,必须先通过 [stage4.md](stage4.md) §5.4.0 "iv8 调试前置门"的 3 步检查(算法确认 → 明文对比 → 环境检测)。禁止跳过算法确认直接进入下方"debug 模式加载目标 JS"。
>
> **JS 来源检查(强制,v9.31 新增)**:进入本工作流前,必须先通过 [stage4.md](stage4.md) §5.4.4 "动态生成 JS 识别与处理"的判定。若目标 JS 是动态生成(如 tdc.js / gcaptcha4.js 按 session 生成变量名),禁止用本地缓存旧文件,必须当次请求下载。跳过 → P0 违规,加密输出必然错位。

### 第一步:debug 模式加载目标 JS

**强制规则:** 始终先用 `mode='debug'`,一律用 `page.load` 加载(含单独 JS 文件,包一层最小 HTML)。`ctx.eval` 仅作辅助(注入桩/参数、调用函数、提取结果)。

> **page.load 大文件性能预期(Gotcha):** 加载大文件(如 989KB OB 壳 Webpack bundle)时,page.load 需要 **2-3 分钟**(含 HTML 解析 + script 执行 + 事件派发)。这是正常耗时,不是卡死。建议:
> - 首次加载用 `mode="debug"` 看日志,确认加载进度(debug 日志走 stderr,见"日志分离"小节)
> - 若超过 5 分钟未返回,检查是否死循环(CFF dispatcher 未命中任何 case)或等待异步回调(需 `eventLoop.drain()` 推进)
> - 不要设过短的 socket timeout,iv8 的 page.load 是同步阻塞调用

> **大文件 debug 日志量预警(Gotcha,v9.8 新增;v9.10 修订):** 加载 500KB+ 混淆文件时,debug 模式输出的「实例访问」日志可能达到 **数 MB**(实测 gcaptcha4.js 676KB → 7MB+ 日志,每个 `_xxx` 属性访问打印一行)。有效信息(字符串表、错误信息)被淹没。
>
> **大文件调试工作流(强制,If/Then)**:
> ```
> IF 目标 JS 文件 ≥ 500KB
>    THEN 禁止直接用 mode='debug' 全量加载
>    必须按以下顺序:
>    1. 先用 mode='prod' 加载,确认无报错(看 print 输出 + 检查 ctx.eval 调用是否成功)
>       IF prod 模式报错 → 记录错误信息,直接进入第 2 步定位
>       IF prod 模式无报错但结果不对 → 进入第 2 步定位环境差异
>    2. 需要定位环境差异时,用 mode='debug' + 日志分离(stderr 重定向到文件)
>       (sys.stderr 重定向到文件,见"日志分离"小节,不要喷到控制台)
>       日志文件用 grep / scripts/trace_analyzer.py search 过滤关键信息
>    3. 仅在 prod 模式 + print 调试无法定位问题(如需要看完整 API 调用链)时,才用全量 mode='debug'
>       日志分离后用 grep 过滤关键 API(navigator.*、document.*、crypto.* 等)
> ```
> **禁止**:✗ 500KB+ 文件直接 `mode='debug'` 不重定向 stderr(控制台被淹没,无法看到 print);✗ 使用 `with_devtools`(已禁用,见 SKILL.md P0 禁令)。

| 方式 | 定位 | 使用场景 |
|------|------|----------|
| `page.load(snapshot)` | **默认/首选** | 加载目标 JS/HTML。对单独 JS 文件也用它包一层最小 HTML(见下方示例) |
| `ctx.eval(source)` | **辅助** | 注入桩函数、前置参数、调用目标函数、提取结果等加载后的辅助操作 |

**禁止:** ✗ 用 `ctx.eval` 直接执行目标 JS 文件(绕过 page.load,丢失 URL 同步、事件派发);✗ 用 `document.documentElement.innerHTML` 加载需执行脚本的页面(脚本不执行)。

**权威执行顺序(① 桩 → ② 参数 → ③ page.load → ④ drain → ⑤ 提取):**

```python
import iv8
import json

with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:  # js_api 设为 __ZY__ 防检测
    # ① 注入桩函数(page.load 之前)——内嵌 JS 字符串,不用严格模式,函数用表达式
    ctx.eval("""
        if (typeof MessageChannel === 'undefined' || !MessageChannel.prototype.port1) {
            var MessageChannel = function() {
                var port = { onmessage: null, postMessage: function(){} };
                this.port1 = port;
                this.port2 = port;
            };
            window.MessageChannel = window.__ZY__.wrapNative(MessageChannel, 'MessageChannel');
        }
    """)

    # ② 注入前置参数(page.load 之前)——localStorage 用 ctx.eval;cookie 优先用 ③ 的 headers,不在此处
    ctx.eval("localStorage.setItem('token', 'xyz');")

    # ③ page.load 加载目标 JS(包最小 HTML,转义 </script>);cookie 用主文档 headers 的 Set-Cookie(最接近真实浏览器)
    with open("target.js", "r", encoding="utf-8") as f:
        js_code = f.read()
    js_code = js_code.replace("</script>", "<\\/script>")
    html = f'<html><head><script>{js_code}</script></head><body></body></html>'
    snapshot = {
        "baseURL": "https://target.com",
        "html": html,
        "headers": [["Set-Cookie", "session=abc123; path=/"]],
    }
    ctx.eval(f"window.__ZY__.page.load({json.dumps(snapshot, ensure_ascii=False)});")
    # debug 模式自动输出 API 调用链日志,据此定位缺口

    # ④ 推进事件循环(page.load 之后)
    ctx.eval("window.__ZY__.eventLoop.drain()")

    # ⑤ 调用目标函数提取结果(page.load 之后)
    sign = ctx.eval("getSign('param')")
```

**完整 HTML 页面(含外联脚本)同样用 `page.load`**——`resources` 注入外联脚本,`json.dumps` 保证转义安全。① 桩函数/② 前置参数见上文,此处聚焦 `resources` 与 cookie 的 headers 注入:

```python
# ctx 创建 + 桩函数注入见上文权威示例
snapshot = json.dumps({
    "baseURL": "https://target.com/page",
    "html": html,  # 从 target.html 读取
    "headers": [["Set-Cookie", "session=abc123; path=/"]],  # cookie 优先用主文档 headers
    "resources": {
        "https://target.com/main.js": {"body": main_js, "status": 200,
            "headers": [["content-type", "application/javascript"]]},
        "https://target.com/encrypt.js": {"body": encrypt_js, "status": 200,  # 后续依赖脚本同理在 resources 追加
            "headers": [["content-type", "application/javascript"]]}
    }
}, ensure_ascii=False)
ctx.eval(f"window.__ZY__.page.load({snapshot});")
# ④ drain → ⑤ 提取见上文
```

> **cookie 注入优先级:** 优先用 `page.load` 的 `headers`(主文档 `Set-Cookie`,最接近真实浏览器),其次用 `add_resource` 响应头的 `Set-Cookie`,备选 `ctx.eval("document.cookie = ...")`。

> **排查顺序提示:** 第一次跑用 debug 模式加载目标 JS 看报什么错(第二步),**拿到缺口清单后**,重新按上面 ①→②→③→④→⑤ 的顺序组织代码。不要在目标 JS 跑到一半才补环境。

### 第二步:根据 debug 日志定位环境缺口

debug 模式自动记录受监控 API 的属性读/写、方法调用、构造调用及 JS 内置反射路径(Object.keys、Reflect.ownKeys、Function.prototype.toString、JSON.parse/stringify)。按缺口类型处理:

| 缺口类型 | 日志特征 | 对策 |
|----------|----------|------|
| iv8 未覆盖的 API | `Cannot set properties of null`、`XXX is not a function`(如 MessageChannel.port1 为 null) | **在 page.load 之前**用 `ctx.eval()` 注入桩函数补全;真实逻辑可用 `expose()` 桥到 Python |
| 需要前置参数 | 日志显示读取 `document.cookie`、`localStorage.xxx`、某接口返回值 | **在 page.load 之前**注入:cookie 优先用 `page.load` 的 `headers`(Set-Cookie),备选 `ctx.eval()`;localStorage 用 `ctx.eval()`;接口返回值用 `add_resource()` 注入(见第四步) |
| XHR/fetch 拿不到响应 | 请求 pending、回调不执行 | 用 Python 发请求 + `add_resource()` 注入(见第四步) |
| 异步回调不执行 | 日志显示 setTimeout/Promise 注册但未触发 | `eventLoop.drain()` / `advance(ms)` 推进 |
| 检测类异常 | 日志显示频繁读 navigator.webdriver、window.chrome、canvas.toDataURL 等 | 用日志分离 + grep 在这些点定位,排查探测逻辑(见诊断章节) |

> ⚠️ **接口级桩坑点(v9.22,补环境前必读)**:iv8 部分 API 是"接口级桩"——形态完整(存在函数、可调用、不报错)但**无真实行为**。不要误以为"API 存在 = API 可用"。补环境前必读 [api-reference.md](api-reference.md) "开箱即用能力"表格的"接口级桩"列,确认目标 API 是完整实现还是桩。已知桩:XHR/fetch(不发真实请求)/ sessionStorage(导航后清空)/ CSS 布局属性(offsetHeight 为 0)/ Canvas 渲染(指纹不一致)/ 部分冷门 API(MessageChannel 等可能为 null)。若为桩,用 `ctx.eval` 注入真实行为或用 `expose` 桥到 Python。

**注入时机(关键):** 桩函数与前置参数(cookie、localStorage、接口返回值)**必须在 page.load 之前注入**。原因:`page.load` 会执行 HTML 内的 `<script>`(内联或外联),脚本一跑就可能立即读取这些 API;若此时桩/参数不存在,会直接报错或走到错误分支,后续再补也来不及。按第一步的 ①→②→③→④→⑤ 权威顺序组织代码。

### 第三步:指纹对齐流程(核心,非可选,v9.4 重构)

> **v9.4 重构**:原"第三步:指纹策略(优先 iv8 内置,仅补缺口)"改为"指纹对齐流程(核心,非可选)"。
> 原逻辑"站点不检测 → 用 iv8 默认值禁止覆盖"已废弃,改为"指纹字段被加密点位文件读取 → 必须用 HAR 真实值对齐"(见顶部"iv8 补环境核心原则")。

**If/Then 规则(主动对齐,非被动响应):**

- IF 阶段一 `stage1.json` 的 `fingerprint.file_fingerprints[].fields` 非空 → **必须用 HAR 真实值对齐所有列出的指纹字段**(通过 `environment` 参数注入)
- IF 某指纹字段不在 `fields` 列表(加密点位文件未读取)→ 保持 iv8 内置默认值,不覆盖(避免破坏字段间一致性)
- IF 需要覆盖指纹 → **必须用 `environment` 参数整体覆盖,禁止在 JS 里手动改单个字段**(会破坏字段间一致性,如改 UA 不会同步 userAgentData)

```python
with iv8.JSContext(js_api="__ZY__", environment={
    "navigator": {"userAgent": "<HAR 请求头 User-Agent 真实值>"},
    "location": {"href": "<HAR 请求 URL 真实值>"},
    # 其他在 file_fingerprints[].fields 列出的字段同理,用 HAR/trace 真实值
}) as ctx:
    # 之后按工作流:注入桩/参数 → page.load 加载目标 JS → drain → 提取
    ...
```

查看所有 iv8 内置指纹路径(排查对齐时用):

```python
for path, value in sorted(iv8.JSContext.get_defaults().items()):
    print(f"{path} = {value!r}")
```

### 指纹值参与加密运算的判定与对齐(v9.4 合并,核心)

> **v9.4 合并**:原"第三步补:指纹值参与加密运算"合并到"第三步:指纹对齐流程"。判定逻辑从"被动响应"改为"主动判定"——在补环境阶段就判定指纹值是否进入加密输入,不是等 iv8 跑通对不齐才排查。
>
> **⚠️ 关键区分**:指纹有两种用途,处理方式完全不同:
> - **用途 A:指纹被检测(anti-bot)** — 站点检查 `navigator.webdriver === false`、UA 是否为 Chrome。iv8 内置默认指纹通常能通过,无需覆盖。
> - **用途 B:指纹值参与加密运算** — 站点把 `navigator.userAgent` 的**具体值**拼接进待加密字符串,或把 `document.cookie` 的某个值作为密钥。此时不是"是 Chrome 就行",而是"iv8 的指纹值必须与 HAR 真实请求中的值**完全一致**"。本节处理此场景。

#### 识别方法(如何判断指纹值是否参与加密运算)

```
IF 满足以下任一条件 → 判定为"指纹值参与加密运算"(必须对齐)
   条件 1:阶段一 stage1.json fingerprint.file_fingerprints[].fields 含指纹字段
      (如 navigator.userAgent / location.href / document.cookie / document.referrer / screen.width 等)
      → 这些字段已被 trace 确认为"加密点位文件读取",直接判参与,无需再判定

   条件 2:脱壳后代码中,加密函数体内直接读取了指纹字段
      (grep 搜 navigator.userAgent / location.href / document.cookie 等,确认是否在加密函数作用域内)
      → 仅适用于静态混淆 / 可读代码

   条件 3(v9.31 新增):目标 JS 是 JSVMP(阶段三判定)
      AND stage1.json trace 显示该文件读取了指纹字段(file_fingerprints[].fields 非空)
      → JSVMP 字节码不可读,无法 grep 确认是否在加密函数作用域内
      → 判定:假设所有被 trace 记录读取的指纹字段都参与加密(保守策略)
      → 必须全部用 HAR 真实值对齐(宁可多对齐不可漏对齐)

   条件 4:方案 2 iv8 跑通后,加密参数输出与 HAR 真实值对不齐
      AND 排查了 cookie/localStorage/接口返回值等前置参数后仍对不齐
      → 高度怀疑指纹值不一致导致(回溯补对齐)
```

#### 对齐流程(确认参与后,确保 iv8 指纹值与 HAR 真实值一致)

```
Step 1: 从 HAR 提取真实指纹值
   → HAR 请求头取 User-Agent / Referer / Cookie(真实浏览器发送的值)
   → HAR 请求 URL 取 location.href 基准值
   → 产出:真实指纹值清单(字段名 + 真实值)

Step 2: 从 trace 提取补充指纹值
   → 阶段一已用 trace_analyzer.py filter --filename <加密点位文件> 输出按文件的调用记录
   → 从输出的 entry.value 字段取真实值(如 Navigator.userAgent 的 value)
   → 产出:补充指纹值清单(trace 提供的字段 + 真实值)

Step 3: 用 environment 参数覆盖 iv8 内置指纹
   → 把 Step 1 + Step 2 提取的真实值,通过 environment 参数注入 iv8
   → 必须用 environment 整体覆盖,禁止在 JS 里手动改单个字段(会破坏字段间一致性)

   with iv8.JSContext(js_api="__ZY__", environment={
       "navigator": {"userAgent": "<HAR 真实 UA>"},
       "location": {"href": "<HAR 真实 URL>"},
       # 其他参与加密的指纹字段同理
   }) as ctx:
       ...

Step 4: 验证对齐
   → iv8 加载目标 JS 后,用 ctx.eval 读取实际指纹值,确认与 HAR 真实值一致
   → ctx.eval("navigator.userAgent") 应返回 environment 中设置的值
   → ctx.eval("location.href") 应返回 environment 中设置的值
   → 若不一致 → 检查 environment 参数路径是否正确(用 get_defaults() 查路径)
```

#### 高频参与加密运算的指纹字段清单

| 字段 | JS 访问路径 | 获取真实值来源 | 典型用途 |
|------|------------|--------------|---------|
| User-Agent | `navigator.userAgent` | HAR 请求头 `User-Agent` | 拼接进待加密字符串 / 作为密钥派生输入 |
| location.href | `location.href` | HAR 请求 URL | 作为盐值 / 拼接进签名 |
| Cookie | `document.cookie` | HAR 请求头 `Cookie` | 提取特定 cookie 值作为密钥 |
| Referer | `document.referrer` | HAR 请求头 `Referer` | 拼接进待加密字符串 |
| screen 分辨率 | `screen.width` / `screen.height` | trace filter 输出的 value 字段 | 拼接进指纹采集 / 加密输入 |
| Canvas 指纹 | `canvas.toDataURL()` | trace filter 输出的 value 字段 | 作为加密输入(高难度,需 iv8 Canvas 渲染一致) |
| WebGL 指纹 | `WebGLRenderingContext.getParameter()` | trace filter 输出的 value 字段 | 作为加密输入(高难度) |

#### 排查路径(对齐后加密参数仍不对)

```
IF 指纹值已通过 environment 覆盖 + 验证对齐,但加密参数仍不对
   THEN 按以下顺序排查:
      1. 检查是否遗漏了某个参与加密的指纹字段
         → 重新看 trace stats,确认是否有其他指纹字段被读取
      2. 检查 environment 覆盖路径是否正确
         → 用 get_defaults() 查看完整路径(如 navigator.userAgent vs navigator.userAgentData.userAgent)
      3. 检查指纹值是否在运行时被修改
         → 目标 JS 可能在运行时覆盖了 navigator.userAgent(用 Object.defineProperty)
         → 在 page.load 之前 hook 拦截属性修改
      4. 检查 Canvas/WebGL 指纹(高难度场景)
         → iv8 的 Canvas 渲染可能与真实浏览器不一致(社区版限制)
         → 若 Canvas 指纹参与加密 → 考虑走方案 1(Python 重写)+ 用 HAR 真实 Canvas 值作为输入参数
```

### 第四步:补网络(Python 桥接 + add_resource)

社区版 XHR/fetch 不发真实请求。补网络工作流:JS 发请求 → Python 用 HTTP 客户端发真实请求 → `ctx.add_resource()` 注入响应 → `eventLoop.drain()` 推进事件循环(JS 回调命中注入的响应)。

**Python HTTP 客户端选择:**

| 客户端 | 适用场景 |
|--------|----------|
| `httpx` | 默认选择,功能完整(同步/异步、HTTP/2) |
| `curl_cffi` | 目标站点检测 TLS/JA3 指纹时使用(可模拟 Chrome/Firefox 的 TLS 指纹) |

**Header 顺序指纹:** 部分站点检测请求头顺序,用 `curl_cffi` 时注意保持与真实浏览器一致的 header 顺序。`httpx` 和 `curl_cffi` 都支持有序 header。

```python
import iv8
import httpx  # 默认用 httpx

with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
    # ① page.load 加载目标 JS(包装方式见第一步权威示例 ③),目标 JS 内的 XHR 进入 pending(社区版不发真实 HTTP)
    ...

    # ② Python 侧用 httpx 发真实请求(带与 JS 侧一致的 cookie)
    with httpx.Client(cookies={"session": "xxx"}) as client:
        resp = client.get("https://api.target.com/data")

    # ③ 注入响应
    ctx.add_resource(url="https://api.target.com/data", body=resp.text,
                     status=resp.status_code, headers=dict(resp.headers))

    # ④ 推进事件循环,JS 回调命中注入的响应
    ctx.eval("window.__ZY__.eventLoop.drain()")
    print(ctx.eval("window._result"))
```

**目标站点检测 TLS 指纹时用 curl_cffi:**

```python
from curl_cffi import requests as cffi_requests
# impersonate="chrome" 模拟 Chrome 的 TLS/JA3 指纹
resp = cffi_requests.get("https://api.target.com/data", impersonate="chrome", cookies={"session": "xxx"})
ctx.add_resource(url="https://api.target.com/data", body=resp.text, status=resp.status_code, headers=dict(resp.headers))
```

> `page.load` 的 `resources` 也可预先注入批量响应(适合已知的外联 JS/CSS),完整示例见 [`../../assets/templates/page_load.py`](../../assets/templates/page_load.py)。

### 第五步:提取目标函数到 Python

补环境跑通后,把目标 JS 的加密/签名函数导出到 Python。**加载目标 JS 均用 `page.load`**(包装方式见第一步权威示例 ③,含 `</script>` 转义),以下仅展示提取差异:

**方式一:直接 eval 调用**(函数已在 JS 全局作用域):

```python
# page.load 加载目标 JS(见第一步),此处假设已加载
sign1 = ctx.eval("getSign('param1')")
sign2 = ctx.eval("getSign('param2')")
```

**方式二:expose 桥接**(JS 主动调用 Python 传参/取结果,适合复杂交互):

```python
def on_sign_ready(sign):
    print("got sign:", sign)

ctx.expose(on_sign_ready)  # __ZY__.data.on_sign_ready(...)
ctx.eval("on_sign_ready(getSign('param'))")
```

**方式三:批量提取对象**(`to_py=True` 把对象/数组递归转成 Python dict/list;**JS 函数不可跨边界调用**,须在 JS 侧调用后取结果):

```python
config = ctx.eval("targetModule.config", to_py=True)  # 纯数据 dict,可直接取
sign = ctx.eval("targetModule.encrypt('data')")       # 函数须在 JS 侧调用
```

## iv8 失败止损规则 [阶段四,强制]

> **为什么有止损规则**:实战中 Agent 在 iv8 调试失败时会陷入循环——反复修改 hook、改注入点、改补环境,单次任务可耗 30+ 分钟无回退(见 changelog v9.5 失败案例)。本规则把"失败 N 次后必须回退"固化为 If/Then,禁止无回退循环。
>
> **v9.26 修订(同类错误定义细化)**:原规则按 5 大类归类,同类内连续 3 次即止损。但实战中不同 API 的桩函数问题(如 WebRTC reject + ReadableStream 返回 null + strData 异步生成)虽同属"桩函数"类,却各有解法,按"同分类"止损会导致任务过早失败。现改为**"同 API 同错误"才算同类**,避免误判。

**失败计数定义(v9.26 修订)**:**同 API 同错误**连续出现 ≥3 次,计为"连续失败 3 次"。

**错误标识二维定义**(v9.26 新增 API 维度):

| 维度 | 取值 | 说明 |
|------|------|------|
| API 标识 | 报错信息中涉及的 API 路径(如 `RTCPeerConnection.createOffer` / `ReadableStream.getReader` / `navigator.userAgent`)。无明确 API 的(如进程崩溃/编码错误)用"全局" | 区分不同 API 的同类问题 |
| 错误分类 | 沙箱/进程 / 编码 / 属性缺失 / 类型 / 超时 / 桩函数(v9.26 新增) | 粗粒度归类,用于累计兜底计数 |

**错误分类清单**(v9.26 新增"桩函数"类):

| 错误分类 | 典型报错模式 | 归类依据 |
|---------|------------|---------|
| 沙箱/进程错误 | exit code 非 0、沙箱崩溃、process killed、iv8 进程异常退出 | 进程层错误 |
| 编码错误 | UnicodeEncodeError、UnicodeDecodeError、codec error、字符无法编码 | 编码层错误 |
| 属性缺失错误 | xxx is not defined、Cannot read property 'xxx' of undefined、xxx is undefined、构造函数缺少 config 属性 | 属性/变量缺失 |
| 类型错误 | TypeError、ValueError、AttributeError、调用非函数对象 | 类型/调用错误 |
| 超时错误 | timeout、hang、process deadlock、长时间无输出 | 超时类错误 |
| **桩函数错误**(v9.26 新增) | "Not implemented" / "not implemented in mock environment" / resolve 成 null / 回调永不触发 | iv8 桩函数导致(见 [api-reference.md](api-reference.md) "社区版桩函数形态与实测清单") |

**归类规则(v9.26 修订)**:
- **同类定义**:API 标识相同 AND 错误分类相同 → 算"同类"
- **同 API 不同分类**(如 `RTCPeerConnection.createOffer` 先报桩函数错误,改补丁后报类型错误)→ **不算同类**,各分类独立计数
- **不同 API 同分类**(如 `RTCPeerConnection.createOffer` 桩函数错误 + `ReadableStream.getReader` 桩函数错误)→ **不算同类**,各 API 独立计数
- **同类连续 3 次**(同 API 同分类) → 触发回退
- **跨 API / 跨分类切换** → 各 API+分类组合独立计数,不重置
- **兜底**:无论 API/分类,**累计 8 次失败**(v9.26 从 6 次上调) → 任务标记失败

```
IF iv8 调试同一 API 同一分类连续失败 3 次
   THEN 必须执行:
      1. 停止当前调试路径,不再尝试同类补丁
      2. 在 stage5-verify.md 记录失败模式(API 标识 + 错误分类 + 错误信息 + 已尝试补丁 + 失败次数)
      3. 回溯判定(按以下顺序检查):
         ├─ 检查 1:脱壳代码是否完整?
         │   → 回读 stage2-output.md 加密点位 + 脱壳记录,确认是否有遗漏的下层函数
         │   → IF 脱壳代码不完整 → 回到阶段二 2.3 补全脱壳,再回阶段四
         │
         ├─ 检查 2:方案选择是否正确?
         │   → 回读 stage5-verify.md §1 方案选择依据
         │   → IF 方案 1 必试清单满足但跳过了方案 1 → 回阶段四走方案 1(见 [stage4.md](stage4.md) §5.2)
         │   → IF 算法是 JSVMP/重度混淆但选了方案 1 → 改选方案 2
         │
         ├─ 检查 3:是否触发了 iv8 社区版已知限制?
         │   → 见下方"iv8 社区版已知限制"表
         │   → IF 命中已知限制 → 在 stage5-verify.md 标注,考虑更换工具(如 iv8 专业版 / Node.js + jsdom / 真实浏览器 headless)
         │
         └─ 检查 4:是否是 IIFE 闭包单体闭包变量不可访问?
            → IF 是闭包变量 → 用源码注入 hook(见 [code-extraction.md](code-extraction.md) §5.5 闭包 hook 策略)
            → IF 源码注入仍失败 → 标注"闭包结构限制",触发阶段门阻断
               (Black-box reuse 模式已禁用,见 SKILL.md P0 禁令;无法绕过闭包限制则走"任务失败交付物"流程)

IF 回溯后重试仍连续失败 3 次(累计 8 次,不论 API/分类)
   THEN 任务标记为"iv8 路径失败"
      → 在 stage5-verify.md 输出标准化失败报告(见 SKILL.md "任务失败交付物")
      → 禁止:继续在 iv8 调试循环中尝试(违反 SKILL.md "阶段门阻断规则")

IF API 标识或错误分类发生变化(跨 API 或跨分类切换)
   THEN 各 API+分类组合独立计数(不重置,不清零);但累计总数持续累加至 8 次兜底
```

### iv8 社区版已知限制

| 限制 | 表现 | 规避方式 |
|------|------|---------|
| 不发真实 HTTP 请求 | XHR/fetch 从离线 bundle 匹配,无网络层 | 用 Python 发 + `add_resource()` 注入响应 |
| CryptoJS 模块可能不完整 | AES/CBC 子类缺失、`createEncryptor` 报错 | 用 Python pycryptodome 重实现加密算法(走方案 1) |
| DOM 内部映射表不完整 | OB 壳 `element.$_CFq` 等内部映射访问返回 undefined | 用日志分离 + grep 确认具体 API,补桩映射表(见 SKILL.md "OB 壳 DOM 代理映射兼容性") |
| 极验4 gcaptcha4.js 非标准混淆 | CryptoJS 闭包变量不可访问、构造函数依赖 DOM | 走方案 1(Python AES 重写)+ 静态脱壳代码分析 |

## 加密参数生成失败排查 [阶段四]

> **v9.4 重构**:排查顺序对齐 [stage4.md](../workflow/stage4.md) §5.4.3 "验证失败排查顺序"三步(数据→cookie/localStorage→指纹/UA),禁止跳步。原 6 步排查(重看日志→检查 API→检查前置参数→检查事件循环→检查指纹→日志分离)已重构为三步分类,每步包含原步骤的相关检查。

加载生成加密参数的 JS 后,若**不能生成加密参数**或**加密参数不对**,按以下三步顺序排查(禁止跳步):

### Step 1: 数据对齐排查(入口函数被加密数据是否对齐)

- **hook 入口函数 dump 明文**:对照 [stage4.md](../workflow/stage4.md) §5.4.0 Step 2,dump 浏览器侧明文 vs iv8 侧明文
- **检查入口函数入参个数**:对照 stage2-output.md §4.3 入参个数完整性判定,确认入参无遗漏
- **检查入参来源**:HAR 直接 / 前序接口 / 浏览器环境 / 用户操作,是否正确注入
- **重看 debug 日志**:是否有报错被忽略(如 `Cannot set properties of null`、`XXX is not defined`)
- IF 入参缺失或不对齐 → 补齐后重新验证
- IF 入参对齐 → Step 2

### Step 2: cookie/localStorage 等网页专属环境排查

- **检查 cookie 注入**:page.load headers Set-Cookie / ctx.eval document.cookie
- **检查 localStorage/sessionStorage 注入**:ctx.eval setItem
- **检查接口返回值注入**:add_resource
- **检查事件循环**:异步回调是否执行(`eventLoop.drain()`)
- **检查 iv8 未覆盖的 API**:目标 JS 是否用了 MessageChannel、BroadcastChannel、特定 Worker 等冷门 API,而 iv8 的实现为 null 或桩
- IF 网页专属环境缺失 → 补齐后重新验证
- IF 网页专属环境齐全 → Step 3

### Step 3: 指纹/UA 排查

- **检查 navigator.userAgent 对齐**:用 environment 参数注入 HAR 真实值
- **检查 location.href / document.referrer 对齐**:用 environment 参数注入
- **检查 screen / canvas / WebGL 指纹对齐**:对照 stage2-output.md §4.2 环境依赖清单
- **检查 wrapNative 伪装**:补丁覆盖浏览器 API 时是否用 wrapNative 伪装(防止 toString 检测)
- **用日志分离 + grep 定位**:在加密函数入口前后过滤 debug 日志,逐步定位差异
- IF 指纹对齐后仍不通过 → 进入 [stage4.md](../workflow/stage4.md) §5.4.3.2 失败止损规则

### 混淆器生成 buggy 代码的处理(实战常见)

**问题现象**:混淆器(obfuscator.io / 非标准混淆工具)生成的代码本身有 bug——典型表现是 iv8 page.load 后报 `xxx is not defined`(`$_HHEDE 未定义` 这类),但同样的代码在真实浏览器能跑(浏览器宽松行为掩盖了 bug)。

**处理规则**(显式 If/Then):

```
IF iv8 page.load 报 "xxx is not defined"(变量未定义错误)
   → 第一步:确认错误位置是否在混淆器生成的代码(非业务代码)
   → 第二步:用 grep 在原 JS 搜索 "xxx",确认该标识符是否真的从未定义
   → 第三步(分支):
      ├─ IF 标识符从未定义且无任何赋值 → 混淆器 buggy 代码
      │   → 处理:在 page.load 前用 ctx.eval 预定义该变量为 undefined
      │   → ctx.eval("var xxx;") 或 ctx.eval("window.xxx = undefined;")
      │   → 重新 page.load,看是否能跑通
      │
      ├─ IF 标识符在闭包内定义但被外部引用 → JS 作用域问题(非 bug)
      │   → 处理:见 [code-extraction.md](code-extraction.md) §5.5 闭包 hook 注入
      │
      └─ IF 标识符在运行时动态定义(如 eval 注入)→ 运行时依赖
          → 处理:确保动态定义代码先执行(检查 page.load 顺序)

IF 预定义变量后报错变化(从未定义 → 其他错误)
   → 继续按新错误排查,可能需要预定义多个 buggy 变量

IF 预定义后能跑通但加密参数不对
   → buggy 变量影响了加密路径
   → 用日志分离 + grep 对比 buggy 变量在浏览器 vs iv8 的实际值
   → 若浏览器中该变量有值(运行时动态赋值),用 ctx.eval 在正确时机注入相同值
```

> **关键判定与处理原则**:混淆器 buggy 代码的特征是"标识符从未定义且无任何赋值路径"。grep 搜不到该标识符的定义,且原 JS 在真实浏览器能跑 → 判定为 buggy 代码。处理:**预定义变量为 undefined**(`ctx.eval("var xxx;")`),让代码能跑即可。**禁止修复混淆器的 buggy 代码**(改写原 JS 逻辑、补全函数实现等)——这是混淆器的 bug,不是逆向职责。

## 检测对抗 [阶段四]

### 反调试

| 威胁 | iv8 对策 |
|------|----------|
| 无限 `debugger;` 循环 | iv8 已禁用 `debugger;`,不会触发断点 |
| 主动断点 | 用 `vdebugger;` 代替(行为同 `debugger`) |
| `console` API 检测 | 用 `vconsole.log()` 替代 `console.log`(`vconsole` 不走 DevTools 上报,JS 不可见) |
| 函数 toString 检测 | 见下方 wrapNative 规则 |

### wrapNative 规则(v9.31 修订,场景分级)

补丁覆盖浏览器 API 时,按场景分级决定是否必须用 `wrapNative` 伪装。原规则"一刀切必须 wrapNative"未区分诊断/生产、JSVMP/静态混淆,对诊断场景过重。

```
IF patch 用途 = 生产(持久覆盖 navigator/document/window 等 API,交付代码)
   THEN 必须用 wrapNative 伪装(无例外)
   → 否则 toString() 暴露补丁源码被反调试检测

IF patch 用途 = 诊断(临时记录监听器注册 / 临时 hook 拦截属性修改)
   AND 目标 JS 是 JSVMP(阶段三判定,字节码不可读)
   THEN 允许豁免 wrapNative(JSVMP 无法主动调 toString 检测)
   但必须在 stage5-verify.md §5.3 记录:
      - patch 函数列表
      - 豁免理由("JSVMP 不可读源码,toString 检测概率低")
      - 风险提示("若目标 JS 升级加 toString 检测,需补 wrapNative")

IF patch 用途 = 诊断
   AND 目标 JS 是静态混淆(obfuscator.io / 可读源码)
   THEN 必须用 wrapNative(静态混淆可主动调 toString 检测)

IF 豁免 wrapNative 后验证失败(加密参数对不齐)
   AND 排查方向怀疑 toString 检测
   → 立即补 wrapNative 重新验证(兜底)
```

```python
with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
    ctx.eval("vdebugger;")              # 主动断点(debugger; 已禁用)
    ctx.eval("vconsole.log('info');")   # 隐蔽日志(console 可被检测)

    # 生产 patch → 必须用 wrapNative 伪装
    ctx.eval("window.myPatch = window.__ZY__.wrapNative(function(x){return x*2}, 'myPatch');")
    print(ctx.eval("window.myPatch.toString()"))  # "function myPatch() { [native code] }"
```

## 诊断:定位环境探测点 [阶段四]

目标 JS 常通过读取特定 API 探测环境(如 `navigator.webdriver`、`window.chrome`、`canvas.toDataURL` 的哈希)。用 debug 模式 + 日志分离 + grep 过滤定位探测链路(`with_devtools` 已禁用,见 SKILL.md P0 禁令)。

```python
with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
    # page.load 加载目标 JS(包装方式见第一步权威示例 ③)
    ...
    # debug 模式自动记录所有 API 访问到 stderr
    # stderr 重定向到文件后,用 Grep 工具或 Python 过滤关键 API(跨平台,禁止用 Unix grep 命令,见 conventions.md §4.8):
    #   Python: python -c "import re; [print(l) for l in open('debug.log', encoding='utf-8', errors='replace') if re.search(r'navigator\.(webdriver|plugins|userAgent)|window\.chrome|canvas\.toDataURL', l)]"
```

用 `netLog` 查看目标 JS 的网络行为:

```python
entries = ctx.eval("window.__ZY__.netLog.entries", to_py=True)  # 含 method/url 等字段
```

## 事件循环控制 [阶段四]

目标 JS 用了 `setTimeout`/`Promise`/`requestAnimationFrame` 时,需手动推进事件循环让回调执行:

| 方法 | 用途 |
|------|------|
| `eventLoop.drain()` | 排空所有已到期任务(最常用) |
| `eventLoop.advance(ms)` | 分帧推进 ms 毫秒(模拟 rAF) |
| `eventLoop.sleep(ms)` | 推进 ms 毫秒,按时间线排空 |

> `drainMicrotasks()`(仅微任务)/ `drainTimers()`(仅定时器)等更多 API 见 [`api-reference.md`](api-reference.md)。

```python
# time_mode="logical"(默认)下,advance(ms) 推进虚拟时间触发到期回调
ctx.eval("var log=[]; setTimeout(()=>log.push('macro'),100); Promise.resolve().then(()=>log.push('micro'));")
ctx.eval("window.__ZY__.eventLoop.advance(200)")
print(ctx.eval("log"))  # ['micro', 'macro']
```

时间模式:`logical`(默认,虚拟时间瞬间完成,适合自动化)/ `system`(真实时间锚定,适合 POW、时间差校验)。

## 日志分离:debug 输出与 print 隔离 [阶段四]

### 问题

debug 模式下 iv8 会输出大量日志(实测 gcaptcha4.js 989KB 内容直接喷到 stdout),Python 的 `print()` 完全被淹没,无法看到自己的调试信息。prod 模式好一些但仍有泄漏。

### 模板

```python
import sys
import iv8

def sign_with_log_separation(params: dict) -> str:
    """日志分离:print 在控制台(stdout),iv8 debug 日志在文件(stderr)。"""
    original_stderr = sys.stderr
    log_file = open('iv8_debug.log', 'w', encoding='utf-8')
    sys.stderr = log_file  # 重定向后 iv8 debug 日志写入文件,print 仍走 stdout
    try:
        with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
            ctx.eval("window.__ZY__.page.load(...);")
            ctx.eval("window.__ZY__.eventLoop.drain()")
            return ctx.eval("encrypt(params)")
    finally:
        sys.stderr = original_stderr
        log_file.close()
```

### 使用建议

**规则:** 调试补环境缺口用 debug + stderr 重定向到文件(控制台只看 print);验证算法/批量生产用 prod(日志少,无需重定向);排查环境差异用 debug + trace 交叉验证。

## API 速查 [跨阶段]

完整 API 签名(构造参数、方法、`__ZY__` 工具、page.load snapshot 字段、安装命令)见 [`api-reference.md`](api-reference.md)。以下为本指南高频使用的核心 API 摘要:

- `iv8.JSContext(mode='debug', js_api='__ZY__', environment=..., time_mode=...)` — 创建上下文
- `ctx.eval(source, to_py=False)` — 执行 JS;嵌套对象转 Python 用 `to_py=True`
- `ctx.add_resource(url, body, status=200, headers=None)` — 注入离线 HTTP 响应
- `ctx.expose(obj, name?)` — 暴露 Python 对象到 `__ZY__.data`
- `window.__ZY__.page.load(snapshot)` — 流式加载 HTML
- `window.__ZY__.eventLoop.drain()` — 排空已到期任务(最常用)
- `window.__ZY__.wrapNative(fn, name)` — 函数伪装为 `[native code]`(补丁覆盖 API 时强制)

## 多线程批量补环境 [阶段四]

每个 `JSContext` 独占 V8 Isolate,执行期释放 GIL,**无需加锁**,适合并发跑多个站点/多个指纹。完整示例见 [`../../assets/templates/multi_thread.py`](../../assets/templates/multi_thread.py)。要点:

- 每个线程内创建独立 Context(`with iv8.JSContext(...) as ctx`),用 `environment` 按站点设置不同 UA;Context 创建开销 ~3ms,**无需复用**,每次用新 Context 获得干净状态
- 批量场景用 `mode='prod'` 降低日志开销;补环境阶段(定位缺口)用 `mode='debug'`
- 实测 8 线程约 4.7x 加速

## 常见踩坑案例库(v9.5 新增,实战积累) [阶段四]

> **规则来源**:用户问卷反馈"文档里有桩函数清单但缺少常见踩坑案例,这些问题在 iv8-env-patching.md 里没有预警"。本章节把实战高频踩坑固化为案例库,每条含"现象/原因/解决"三段式。
>
> **使用时机**:进入 iv8 补环境工作流前必读,遇到对应症状时按案例解决。

### 踩坑 1: MessageChannel prototype 属性直接访问触发"非法调用"

- **现象**: `MessageChannel.prototype.port1` 直接读取报 `Illegal invocation`(非法调用)
- **原因**: `prototype` 上的 `port1`/`port2` 是实例绑定属性,直接访问 prototype 丢失 `this` 上下文,V8 抛非法调用
- **解决**: 改用 `try/catch` 实例化检测,实例上读取
  ```javascript
  try {
      var ch = new MessageChannel();
      var p1 = ch.port1;  // 实例访问,合法
  } catch(e) {
      // 桩:MessageChannel 不可用,补桩
      var MessageChannel = function() {
          var port = { onmessage: null, postMessage: function(){} };
          this.port1 = port;
          this.port2 = port;
      };
      window.MessageChannel = window.__ZY__.wrapNative(MessageChannel, 'MessageChannel');
  }
  ```
- **关联**: 见上方"补环境心智模型"表"iv8 未覆盖的冷门 API"行

### 踩坑 2: ctx.close(gc=true) 与 with 语句 __exit__ 冲突

- **现象**: `with iv8.JSContext() as ctx: ...` 末尾自动调用 `ctx.close()`,若内部已手动 `ctx.close(gc="low_memory")` 会重复关闭报错
- **原因**: `with` 语句的 `__exit__` 会再次调用 `close()`,二次关闭触发 V8 Context 已释放错误
- **解决**: 二选一,**推荐让 with 自动管理**(不手动 ctx.close())
  ```python
  # ✅ 推荐:with 自动管理,不手动 close
  with iv8.JSContext(js_api="__ZY__") as ctx:
      ctx.eval("window.__ZY__.eventLoop.drain()")  # 确保异步回调执行
      result = ctx.eval("getSign('param')")
  # with 末尾自动 close,无需手动调用

  # ✗ 错误:with 内手动 close 导致二次关闭
  with iv8.JSContext() as ctx:
      ...
      ctx.close(gc="low_memory")  # 触发二次关闭报错
  ```
- **若必须手动 close**(如内存限制场景): 不用 with,改用 try/finally
  ```python
  ctx = iv8.JSContext(js_api="__ZY__")
  try:
      ctx.eval("...")
      ctx.close(gc="low_memory")  # 手动 close,后续不再用
  except Exception:
      ctx.close()  # 异常兜底
  ```

### 踩坑 3: page.load 大文件时 socket timeout 误判卡死

- **现象**: 加载 989KB OB 壳 Webpack bundle 时,`page.load` 5 分钟未返回,误判为卡死强制终止
- **原因**: `page.load` 是同步阻塞调用,大文件(HTML 解析 + script 执行 + 事件派发)需 2-3 分钟,默认 socket timeout 过短
- **解决**:
  - 不要设过短的 socket timeout(建议 ≥ 300 秒)
  - 首次加载用 `mode='debug'` 看日志进度(debug 日志走 stderr)
  - IF 超过 5 分钟未返回 → 检查是否死循环(CFF dispatcher 未命中任何 case)或等待异步回调(需 `eventLoop.drain()` 推进)
- **关联**: 见上方"第一步:debug 模式加载目标 JS"的"page.load 大文件性能预期"提示框

### 踩坑 4: ctx.eval 注入桩函数时机错误

- **现象**: page.load 加载目标 JS 后注入桩函数,目标 JS 已读取 `MessageChannel` 报 `is not defined`
- **原因**: `page.load` 会执行 HTML 内的 `<script>`,脚本一跑就立即读取这些 API;若桩在 page.load 之后注入,为时已晚
- **解决**: **桩函数必须在 page.load 之前注入**(见上方"权威执行顺序 ①→②→③→④→⑤)
  ```python
  # ✅ 正确:page.load 之前注入桩
  ctx.eval("/* 桩函数 */")  # ①
  ctx.eval("localStorage.setItem('token', 'xyz')")  # ② 前置参数
  ctx.eval(f"window.__ZY__.page.load({snapshot})")  # ③ page.load
  ctx.eval("window.__ZY__.eventLoop.drain()")  # ④
  result = ctx.eval("getSign('param')")  # ⑤

  # ✗ 错误:page.load 之后注入桩,目标 JS 已读取失败
  ctx.eval(f"window.__ZY__.page.load({snapshot})")  # 目标 JS 立即读取 MessageChannel
  ctx.eval("/* 桩函数 */")  # 为时已晚
  ```

### 踩坑 5: environment 参数路径错误导致指纹未对齐

- **现象**: 设置了 `environment={"navigator": {"userAgent": "..."}}` 但 `ctx.eval("navigator.userAgent")` 返回 iv8 默认值
- **原因**: environment 参数路径与 iv8 内置路径不匹配(如错写 `nav.userAgent` 而非 `navigator.userAgent`)
- **解决**:
  - 用 `iv8.JSContext.get_defaults()` 查所有内置路径
  - 验证对齐:`ctx.eval("navigator.userAgent")` 应返回 environment 中设置的值
  - IF 不一致 → 检查 environment 参数路径(用 get_defaults() 查路径)
- **关联**: 见上方"第三步:指纹对齐流程"Step 4 验证对齐

### 踩坑 6: 网站运行时上下文用 HAR 旧值占位(v9.6 新增)

- **现象**: `localStorage.token` 用 HAR 旧值占位,服务端校验失败(返回 401 / error=100 / 会话过期)
- **原因**: token 属于"网站运行时上下文"(随网站变化,会过期),参与加密参数生成。HAR 旧值会过期,不能简单占位
- **解决**: 见 [stage4.md](../workflow/stage4.md) §5.4.5,逆向 token 生成机制,本地生成新值
  - IF token 是服务端接口下发 → 逆向接口调用,本地 httpx 获取新值
  - IF token 是前端动态生成 → 逆向生成算法,本地实现(如 `md5(timestamp + device_id)`)
  - IF token 是动态生成(session-bound) → 当次请求获取(与 §5.4.4 动态 JS 平行)
- **区分**: 若是"客户端环境上下文"(如 UA),保持 iv8 默认值或 environment 整体覆盖,不需逆向生成机制
- **禁止**: 用 HAR 旧值 / null / undefined 占位

## 代码规范与模板(写代码前必读) [跨阶段]

- **代码规范:** 写 iv8 补环境脚本前,读取 [`conventions.md`](conventions.md) §4,覆盖 JSContext 生命周期、桩函数组织、Python↔JS 边界、错误处理与日志、命名约定、文件组织。
- **代码模板:** 从 [`../../assets/templates/`](../../assets/templates/) 选起步:`single_context.py`(单次签名,最常用)/ `multi_thread.py`(多线程)/ `page_load.py`(完整 HTML)/ `network_bridge.py`(网络桥接)。模板遵循深函数原则。

## 关键提醒 [跨阶段]

- **`__ZY__` 工具对象挂载在 window 上,目标 JS 理论上可读到**——自定义名字不易被主动检测,但**禁止在你不可控的目标 JS 代码里引用 `__ZY__`**(只在自写的桩/桥接代码里用)。
- **OB 壳 DOM 代理映射兼容性(Gotcha,v9.9 从 SKILL.md 外移):** OB 壳常通过原型内部映射访问 DOM(如 `element.$_CFq` 访问 `Node.prototype` 上的内部映射表)。iv8 的 DOM 实现是 C++ 层完整实现但可能不覆盖所有内部映射表,某些上下文下 `Node.prototype.appendChild` 等标准 API 可能返回 undefined。**遇到 OB 壳 DOM 访问异常时,先用日志分离 + grep 确认调用的具体 API,再判断是 iv8 缺口还是 OB 壳内部映射**;若是内部映射,补桩该映射表而非补标准 DOM API。
- **接口级桩函数坑(v9.22 新增,防踩坑):** iv8 在 V8 引擎之上提供广泛的浏览器 API 模拟层,覆盖以下 Web 标准(部分为**接口级桩实现**)。"类存在,方法是桩"是 iv8 社区版的核心限制——重型浏览器 API(WebRTC/WebTransport/Sensors 等)类存在但方法是空桩,调用时**静默 reject 或返回 null**,不会被 JS 层 Promise hook 拦截。**症状**:加密参数生成失败、Promise 链中断、指纹采集异常,但无报错。**对策**:见 [api-reference.md](api-reference.md) "社区版桩函数形态与实测清单"(4 种形态 + 6 类已实测清单 + 探测方法),在 page.load 之前用 JS 覆盖 prototype 方法。**最隐蔽的是形态 1(C++ 层 reject)**:绕过 JS 层所有 Promise hook,必须 hook `unhandledrejection` 事件才能捕获。
- **内存爆破防护(v9.23 新增,强制规范):** 所有 iv8 使用场景(JSContext / page.load / ctx.eval)**必须**设置最大内存限制。目标 JS 代码可能因死循环分配、大数组构建、递归爆栈等导致内存爆破,若不限制会拖垮主进程。**3 层限制策略**:第 1 层(必须)V8 堆限制 + `ctx.close(gc="low_memory")`;第 2 层(推荐,Windows)子进程 + Job Object 限制子进程内存;第 3 层(高安全)第 2 层 + psutil 监控。**不可信 JS / 大文件(200KB+) / 复杂补环境场景必须实施第 2 层**。完整规范与代码模板见 [api-reference.md](api-reference.md) "内存限制(必读,防内存爆破)"。
