# 阶段一:日志基础分析

> 负责:HAR 参数溯源 + trace 环境指纹 + WASM 标记。只保留决策规则与强制输出标准。

## 目录

- [1. 使用时机与前置](#1-使用时机与前置)
- [2. Gotchas(必读,内嵌例子)](#2-gotchas必读内嵌例子)
- [3. 执行流程(4 步)](#3-执行流程4-步)
- [4. trace 能力边界(跨阶段)](#4-trace-能力边界跨阶段)
- [5. trace 环境指纹采集](#5-trace-环境指纹采集)
- [6. 环境差异检测(阶段四可选)](#6-环境差异检测阶段四可选)
- [7. 产物与 GATE](#7-产物与-gate)

---

## 1. 使用时机与前置

- **加载触发**:用户进入阶段一时加载
- **前置**:
  - 用户提供多份 HAR 文件(Chrome/Edge 完整导出含 `_initiator.stack`)
  - 用户提供 trace 文件(可选,用于环境指纹采集)

**安全边界**(违反即产物失效):
- ⛔ 禁止用 trace 做加密点定位(见 §2 Gotcha 1)
- ⛔ 禁止人工通读几百 MB trace 文件(用 `scripts/trace_analyzer.py`)

---

## 2. Gotchas(必读,内嵌例子)

### Gotcha 1:trace 加密点定位盲区(P0)

> [内嵌理由:无此例子 AI 会转向 trace 查询逃避静态分析阻力,浪费轮次且抓不住核心]

**反例**:Agent 在阶段二读脱壳代码受阻 → 转向 trace 查 `encrypt` 关键词 → trace 不记录纯 JS 函数调用 → 找不到加密函数 → 继续在 trace 里挖 → 浪费 5+ 轮次。

**正例**:静态分析受阻时,坚持用 HAR `_initiator.stack` + 原始代码直读,trace 仅用于环境指纹采集(阶段一)和差异检测(阶段四)。

### Gotcha 2:HAR 浏览器兼容性

> [内嵌理由:无此例子 AI 会用 Firefox/抓包工具 HAR 跑流程,`_initiator.stack` 缺失导致阶段二无起点]

**反例**:用户提供 Firefox HAR → `_initiator.stack` 无 `parent` 字段 → 异步边界不可达 → 阶段二溯源漏掉加密函数。

**正例**:HAR 来源校验(见 §3 Step 2),Firefox/抓包工具 HAR → 要求用户用 Chrome/Edge 重新抓。

### Gotcha 3:trace 大文件

> [内嵌理由:无此例子 AI 会人工通读几百 MB trace,卡死或漏关键信息]

**反例**:Agent 用 Read 工具读 200MB trace 文件 → 卡死或截断。

**正例**:用 `scripts/trace_analyzer.py` 的 `stats` + `filter` 两模式。

### Gotcha 4:trace 日志 `[Object Proxy]`(v9.22)

> [内嵌理由:无此例子 AI 会误以为"window 异常/补环境出错"花时间排查]

**反例**:Agent 看到 `Window.get` 返回 `[Object Proxy]` → 误判为 iv8 补环境错误 → 花 3 轮次排查 window 对象。

**正例**:`[Object Proxy]` 是浏览器 trace 序列化的标准行为,等同于 window 对象本身,不需要排查。其他复杂对象(Navigator/Screen/HTMLCanvasElement)同理。trace 的 `value` 字段**不可作为真实指纹值**,仅用 `op` 字段(哪些 API 被读取),真实值从 HAR 提取。

---

## 3. 执行流程(4 步)

```
Step 1: HAR 样本选取与参数分类
  → 采集 ≥2 份样本(不同业务参数/不同时间/不同会话)
  → 参数分类:固定常量 / 接口透传 / JS 生成 / 用户输入
  → 产出:加密参数清单(JS 生成类)

Step 2: 透传链路追溯 + _initiator.stack 提取
  → 对"接口透传"参数递归追溯上游接口
  → 对"JS 生成"参数提取 _initiator.stack(完整保留 callFrames + parent 链)
  → HAR 来源校验(见 §3.1)
  → ⚠️ 禁止用 trace 做加密点定位(见 §2 Gotcha 1)
  → 产出:_initiator.stack 字段化输出(阶段二起点)

Step 3: WASM 加载存在标记
  → 扫描 HAR 中 .wasm 文件 / application/wasm / WebAssembly.instantiate 调用
  → 产出:.wasm 文件 URL(若存在,仅标记存在与 URL,不记录时机)

Step 4: trace 环境指纹采集(见 §5)
  → 产出:file_fingerprints(文件 → op 去重列表)
```

### 3.1 HAR 来源校验(决策规则)

```
IF _initiator 存在 且 stack 含 parent 字段
   → 来源标记:Chrome(完整)→ 正常使用 callFrames + parent 全链路

IF _initiator 存在 但 stack 无 parent 字段
   → 来源标记:Firefox/Safari(部分)→ 降级:仅用 callFrames
   → 标注:[HAR 来源无 parent,异步边界不可达]

IF _initiator 完全缺失
   → 来源标记:抓包工具(无 _initiator)
   → 终止阶段二(无溯源起点)
   → 要求用户用 Chrome/Edge 重新抓
```

### 3.2 透传链路追溯终止条件

- 参数是固定常量/前端硬编码 → 停止
- 参数是 JS 算出 → 停止,切到阶段二
- 参数是用户输入 → 停止,标记外部输入
- **环依赖**(上游接口又依赖当前参数)→ 标记为环,通常意味着会话级参数一次性获取后复用

### 3.3 `_initiator.stack` 字段化输出格式

```markdown
### 加密参数:<参数名>
- 出现的请求 URL: <URL>
- _initiator.stack:
  - callFrames(同步栈):
    - [帧0] <functionName> (<url>:<line>:<col>)
    - [帧1] <functionName> (<url>:<line>:<col>)
  - parent 链(异步边界,若存在):
    - [parent 层1] type=<type>
      - callFrames: ...
- 栈帧数: <总数>
- HAR 来源: <Chrome/Firefox/抓包工具>
```

**提取约束**:
- 完整保留 `callFrames` + `parent` 全链路,不截断
- `functionName` 为空时保留空值,不猜测
- `url` 保留完整 URL(含 query),阶段二据此下载 JS
- `columnNumber` 是最可靠定位信息(混淆函数名可能重复),阶段二按字节偏移定位

---

## 4. trace 能力边界(跨阶段)

### 4.1 trace 使用速查表

| 阶段 | 该用 trace 做什么 | 不该用 trace 做什么(改用什么) |
|------|------------------|------------------------------|
| 阶段一 | 环境指纹采集:`stats` + `filter --filename` | — |
| 阶段二 | **不使用 trace** | 加密点定位 → HAR `_initiator.stack` + 原始代码直读;脱壳纠错 → iv8 |
| 阶段三 | **不使用 trace** | 载体形态判定 → 基于脱壳后代码 |
| 阶段四 | 环境差异检测(可选) | 加密参数生成 → 方案 1/2 |

### 4.2 "定位请求发起者" vs "定位加密生成者"

| 场景 | trace 能看到吗 | 为什么 |
|------|--------------|--------|
| `genSign()` 里调 `XHR.send` | 能看到 sendReq 帧 | XHR.send 是 Web API |
| `genSign()` 里调 `encryptParam()` 算加密(纯 JS) | 看不到 | 纯 JS 函数调用,trace 不记录 |

**结论**:trace 只能定位"请求发起者",不能定位"加密生成者"。加密生成者定位在阶段二用 HAR `_initiator.stack` + 原始代码直读。

### 4.3 trace 核心约束

trace 仅记录 Web API、DOM 调用,不记录 JS 函数调用本身。纯 JS 计算(不触达 Web API 的函数调用链)在 trace 里完全隐形。

---

## 5. trace 环境指纹采集

### 5.1 trace 完整性校验(stats)

```
Step 1: uv run scripts/trace_analyzer.py <trace> stats
  → 输出 interface.member 频次降序表

Step 2: 判定完整性
  IF stats 输出非空 AND _initiator.stack 主入口文件的 API 出现在 stats 表中
     → trace 完整性 PASS
  IF stats 输出为空
     → trace 采集时机错过加密时刻
     → 要求用户重新采集(在加密请求触发前启动 trace)
```

### 5.2 按文件过滤输出(filter,iv8 补环境核心输入)

```
Step 1: 从阶段一 Step 2 提取加密点位文件名(来源:HAR _initiator.stack 的 file 字段)

Step 2: 逐文件过滤
  → uv run scripts/trace_analyzer.py <trace> --filename <加密点位文件>
  → 输出 JSON:{"<file>": [{"op", "value", "seq", "type"}, ...]}

Step 3: 汇总到 manifest
  → 每个文件一条 file_fingerprints 记录
  → fields 字段 = filter 输出的 op 去重列表
  → 不提取 value(留到阶段四按需提取,trace value 不可靠时从 HAR 提取)
```

### 5.3 trace 定位

trace 是**辅助证据**,不是硬输入:
- HAR 请求头/响应体 → 主证据(真实浏览器发送/接收的值)
- 当次请求响应 → 主证据(动态生成 JS 场景的唯一可靠来源,见 stage4.md §5.4.4)
- trace → 辅助证据(提供 API 调用清单,但 value 字段可能为 [Object Proxy])

```
IF trace 缺失 → 不阻断流程(file_fingerprints 为空数组,evidence 标注"无 trace")
IF trace value 为 [Object Proxy] → 仅用 op 字段,value 从 HAR 提取
```

### 5.4 type 字段的 iv8 补环境语义(阶段四用,阶段一不判定)

| type | iv8 补环境方式 |
|------|---------------|
| get | iv8 environment 字段设值(如 navigator.userAgent) |
| set | iv8 hook 属性写入(如 document.cookie) |
| call | iv8 hook 方法返回值(如 canvas.toDataURL) |
| construct | iv8 模拟构造器(如 new XMLHttpRequest) |
| typeof/instanceof | iv8 environment 字段类型匹配 |

### 5.5 跨文件调用处理

一个 Web API 调用的 stack 包含多个文件时(如 dy-ele.js 的函数被 tdc.js 调用),该调用同时归到两个文件——iv8 补环境时两个文件都需要这个 API。

---

## 6. 环境差异检测(阶段四可选)

```
Step 1: 回顾阶段一 filter 输出
  → 从 stage1.json 的 fingerprint.file_fingerprints 取每个文件的 op 列表

Step 2: iv8 debug 探测
  → 用 iv8 debug 模式跑目标 JS
  → 记录 iv8 报的缺口 + iv8 访问的 API 清单

Step 3: 交叉对比
  → 阶段一 filter 有 + iv8 无 = 最危险(环境差异,走了错误分支)
  → 阶段一 filter 有 + iv8 有 = 一致(确认补环境点)
  → 阶段一 filter 无 + iv8 有 = iv8 多余(通常无害)
```

**关键**:阶段一 filter 有 + iv8 无是最危险的——目标 JS 在 iv8 里因环境差异走了错误分支,产出的加密参数必然不对。这是加密参数"看起来跑通了但值不对"的常见根因。

---

## 7. 产物与 GATE

### 7.1 产物

| 产物 | 模板 | 用途 |
|---|---|---|
| 参数分析报告 | [param-analysis.md](../../assets/templates/param-analysis.md) | 阶段一交付物 |
| 加密参数清单(含 `_initiator.stack`) | 同上 §加密参数清单 | 阶段二溯源起点 |
| WASM 加载存在标记 | 同上 §WASM 标记 | 阶段三载体形态判定参考 |
| 环境指纹(trace) | stage1.json `fingerprint.file_fingerprints` | 阶段四 iv8 补环境核心输入 |

**强制字段**(缺任一 → 阶段二 GATE 阻断):
- 参数分析报告:接口信息 / 样本清单 / 参数溯源表 / 透传链路图 / 加密参数清单 / 环形依赖检查 / 结论
- 加密参数清单:每条含 `_initiator.stack`(callFrames + parent 全链路)
- WASM 标记:有/无(无也要明确写)
- 环境指纹:`fingerprint.file_fingerprints` 数组,每条含 `file` + `fields`(op 去重列表)+ `evidence`。trace 缺失时为空数组,evidence 标注"无 trace,阶段四按需补"

### 7.2 GATE

```
运行 uv run scripts/stage_gate.py --stage 2 --task-dir <path>
  退出码 0 + status PASS → 进入阶段二(见 stage2-tracing.md)
  退出码 1 + status BLOCK → 按 JSON.action 回到 §3 流程对应 Step 补齐
```

**降级动作**:
- HAR 缺失 `_initiator.stack` → 走 §3.1 校验失败流程,要求用户用 Chrome/Edge 重新抓
- 无法补齐 → 走 SKILL.md "任务失败交付物"流程

### 7.3 回执

**成功**:`./<task>/stage1-params.md` 写入完成。上报:"阶段一完成,加密参数 N 个,WASM 标记 有/无,环境指纹 已采集/无 trace。进入阶段二。"

**降级**:HAR 缺 `_initiator.stack` / trace 损坏 → 要求用户重新提供。上报:"阶段一降级:<原因>。已要求用户:<动作>。"

**失败**:用户无法提供合规 HAR 且拒绝重新抓 → 失败交付物。上报:"阶段一失败:<原因>。已写入失败交付物:<路径>。"

### 7.4 trace_analyzer.py 命令参考

| 命令 | 用途 | 输出格式 | 阶段 |
|------|------|---------|------|
| `stats` | 聚合统计(interface.member 频次降序) | 文本表格 | 阶段一(完整性校验) |
| `filter`(默认) | 按文件/类型/interface/member 过滤 | JSON | 阶段一(指纹采集) |

```
uv run scripts/trace_analyzer.py <trace> [--filename <js>] [--type <t>] \
    [--interface <iface>] [--member <mem>] [--output <file>]
```

**禁止**:
- 禁止人工通读 trace 文件
- 禁止用劫持代码(Hook)提取指纹值——直接用 `trace_analyzer.py filter`
- 禁止在阶段二/三使用 trace
