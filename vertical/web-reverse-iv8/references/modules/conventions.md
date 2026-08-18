# 规范与契约

> 本文件合并原 scope.md / contract.md / methodology.md / code-conventions.md(v9.32 重构)。
> 只保留"AI 无法自主判断、缺少规范就会跑偏"的决策规则、路径边界、风险止损逻辑与强制输出标准。

## 目录

- [1. 适用范围与边界](#1-适用范围与边界)
- [2. 输入/输出契约](#2-输入输出契约)
- [3. 方法论能力边界](#3-方法论能力边界)
- [4. 代码规范](#4-代码规范)
  - [4.1 JSContext 生命周期](#41-jscontext-生命周期)
  - [4.2 桩函数组织](#42-桩函数组织)
  - [4.3 Python↔JS 边界](#43-pythonjs-边界)
  - [4.4 错误处理与日志](#44-错误处理与日志)
  - [4.5 命名约定](#45-命名约定)
  - [4.6 文件组织](#46-文件组织)
  - [4.7 诊断脚本规范](#47-诊断脚本规范)
  - [4.8 跨平台工具使用规范](#48-跨平台工具使用规范)
  - [4.9 内置工具能力边界](#49-内置工具能力边界)

---

## 1. 适用范围与边界

### 正面范围

web JS 加密参数分析的完整链路:参数溯源 → 加密点定位 → 保护类型识别 → 方案选择与执行 → 本地验证。

### 负面边界

| 不做的领域 | 改用什么 |
|-----------|---------|
| frida hook 方式的客户端逆向 | frida 专项工具 |
| 二进制协议逆向(非 web JS) | IDA/Ghidra |
| RPC/浏览器自动化 | Puppeteer/Playwright/Selenium |
| 通用 web 开发 / 爬虫工程 | 常规工具 |

### 边界澄清(重叠场景判定)

| 场景 | 属于本 skill? | 判定依据 |
|------|--------------|---------|
| web JS 内生成的 sign/token/w 参数 | ✓ 是 | 加密逻辑在浏览器 JS 内 |
| 服务端签名(如 HMAC-SHA256 服务端计算) | ✗ 否 | 加密逻辑在服务端 |
| web JS 内调用 WASM 模块加密 | ✓ 是 | WASM 是载体形态之一 |
| frida hook native so 的加密函数 | ✗ 否 | 非 web JS 范畴 |

---

## 2. 输入/输出契约

### 输入(用户提供)

| 输入 | 必需性 | 用途 |
|------|--------|------|
| HAR 文件 | **必需** | 参数溯源 + `_initiator.stack` 提取(加密点定位起点) |
| trace 文件 | 可选但**强烈推荐** | 阶段一环境指纹采集;无 trace 则方案 2 环境补全缺少基准值,需 iv8 debug 探测 |
| 目标 JS 文件 | 从 HAR 提取 URL,agent 自行下载 | 加密逻辑载体 |

> 无 HAR → skill 无法启动。无 trace → 可走方案 1;方案 2 仍可用但环境补全效率降低。

### 输出(skill 交付)

| 输出 | 形式 | 何时产生 |
|------|------|---------|
| 加密参数生成代码 | 方案1:Python 重写 / 方案2:iv8 补环境脚本 | 阶段四结束 |
| 验证结果 | 生成的参数与 HAR 真实值比对(通过/不通过) | 阶段四结束 |

> 阶段四验证不通过 → 回溯调整方案,不直接交付未验证代码。

### 产物持久化(强制)

**产物目录结构**(在工作目录下创建):

```
./<task-name>/
├── stage1-params.md          # 阶段一:参数分析报告
├── stage2-output.md          # 阶段二:加密点位 + 脱壳代码 + 变换台账
├── stage3-labels.md          # 阶段三:载体形态标签 + 分支选择
├── stage5-verify.md          # 阶段四:验证结果
├── code/                     # 阶段四产出的代码
│   ├── solution.py           # 方案1:Python 重写
│   └── iv8_patch.py          # 方案2:iv8 补环境脚本
└── evidence/                 # 证据材料(可选)
    ├── har/                  # 原始 HAR 文件
    ├── trace/                # 原始 trace 文件
    └── deobfuscated/         # 脱壳后代码片段
```

**持久化规则**:
- 每个阶段结束时写入对应文件,路径作为下一阶段入口 checklist 的确认项
- 跨阶段引用用文件路径而非对话历史(如"见 stage2-output.md §2 加密点位")
- task-name 命名:用目标参数名或网站名(如 `geetest-w`、`xxx-sign`),全小写连字符

---

## 3. 方法论能力边界

### 3.1 数据流追踪能力边界(阶段二只做流向辨识)

```
IF 数据流类型 = 函数内同步(变量赋值/参数传递/返回值/字符串拼接)
   → 做(脱壳后静态可行),作为终止判定
IF 数据流类型 = 跨函数同步调用
   → 部分可行,跨函数调用时做
IF 数据流类型 = 异步/回调/状态(Promise.then/事件回调/全局变量/闭包)
   → 不做,标注 [静态未验证] 留阶段四(运行时验证)
```

**流向辨识 vs 精确追踪**:
- 流向辨识(做):能看出加密参数在函数内大致流向(赋值给谁、传给谁、拼接到哪里)
- 精确追踪(不做):追踪每次变换、每个中间变量值——纯静态不可靠,留阶段四

**第二层断裂条件**(脱壳后也可能存在,是 JS 动态特性):
- 动态属性访问:`obj[key]` 中 key 是变量 → 数据流断裂
- this 绑定:`this.encrypt(data)` 静态不知道 this 指向 → 不知道调用哪个方法
- apply/call/bind:`fn.apply(obj, [data])` 中 fn 是变量 → 不知道调用哪个函数

### 3.2 HAR `_initiator.stack` 能力边界

```
IF _initiator.stack 的所有栈帧内都找不到加密逻辑
   → 不一定是无加密函数,可能是加密在更早的异步回调里完成
   → Fallback:全局搜索加密特征词(encrypt/sign/crypto/hash 等)

IF _initiator.stack 缺失或为空(部分抓包工具不记录)
   → 无 _initiator.stack 的 HAR 无法走标准溯源流程
   → 见 har-analysis.md "HAR 来源校验"
```

### 3.3 封装结构处理操作难度差异

| 操作 | 难度 | 失败模式 | 处理原则 |
|------|------|---------|---------|
| 去壳(OB壳/eval-Function壳) | **高**,可能失败 | 信息丢失 → 分层回退纠错 | 默认信息丢失需要回退 |
| Webpack 剥离 | **低**,基本不会失败 | — | 失败时优先怀疑自己改写错了,不是信息丢失 |
| WASM 胶水提取 | 中,可能找不到 | 胶水定位失败 → 全量 iv8 | — |
| Worker 源码获取 | 中,可能被反调试 | 拿不到源码 → 降级方案 2 | — |

**关键规则**:不要把 Webpack 剥离失败当作信息丢失回退——优先怀疑自己改写错了。

---

## 4. 代码规范

> 动手前分析 checklist、方案选择、禁止事项见 [SKILL.md](../../SKILL.md) 核心原则/禁止事项、[stage3.md](../workflow/stage3.md) §5(分支判定)+ [stage4.md](../workflow/stage4.md) §5.2(方案 1/2 判定)。

### 4.1 JSContext 生命周期

#### 4.1.1 强制上下文管理器

**必须**用 `with iv8.JSContext(...) as ctx:`,禁止裸 `ctx = iv8.JSContext()` + 手动 `close()`(异常路径下手动 close 易遗漏,导致 isolate 泄漏)。

```python
# ✓ 正确
with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:
    ...

# ✗ 禁止
ctx = iv8.JSContext(mode='debug', js_api="__ZY__")
try:
    ...
finally:
    ctx.close()
```

#### 4.1.2 每个任务用新 Context

Context 创建+销毁约 3ms,无需复用。每个补环境任务用一个新 Context,获得干净状态。

#### 4.1.3 禁止跨线程共享 Context

每个 `JSContext` 独占 V8 Isolate,**禁止跨线程共享**。多线程场景每个线程内创建自己的 Context。

#### 4.1.4 GC 策略

`with` 退出时由 iv8 自动释放。仅在长跑场景需提前回收时显式调用 `ctx.close(gc="low_memory")`,调用后该 Context 不可再用,`with` 退出时 iv8 幂等处理。

### 4.2 桩函数组织

#### 4.2.1 内嵌管理:ENV_PATCH 常量

**所有桩函数集中为一个 Python 字符串常量 `ENV_PATCH`**,内嵌在补环境脚本中,按 API 分类组织章节。禁止散落在多个 `ctx.eval` 调用里。

```python
ENV_PATCH = r"""
// 不使用严格模式;函数用表达式声明
if (typeof MessageChannel === 'undefined' || !MessageChannel.prototype.port1) {
    var MessageChannel = function() {
        var port = { onmessage: null, postMessage: function() {} };
        this.port1 = port;
        this.port2 = port;
    };
    window.MessageChannel = window.__ZY__.wrapNative(MessageChannel, 'MessageChannel');
}
"""
```

> **不用 `'use strict'`** 的原因:严格模式下函数声明为块级作用域,桩函数在 `if` 块外不可见。

#### 4.2.2 加载顺序(强制)

桩函数与前置参数**必须在 page.load 之前**注入:

```
① 注入 ENV_PATCH → ② 注入 localStorage 等前置参数 → ③ page.load 加载目标 JS →
④ window.__ZY__.eventLoop.drain() → ⑤ ctx.eval 提取结果
```

- cookie 优先用 `page.load` 的 `headers`(Set-Cookie,每个 cookie 一个独立头)
- 加载目标 JS 一律 `page.load`(包最小 HTML,转义 `</script>`)

#### 4.2.3 桩函数编写规则

1. **先判断再补:** 用 `typeof XXX === 'undefined'` 判断,避免覆盖 iv8 已有实现。
2. **wrapNative 场景分级(v9.31):** 生产 patch 必须用 wrapNative 伪装;诊断 patch + JSVMP 目标允许豁免(需在 stage5-verify.md §5.3 记录);诊断 patch + 静态混淆必须用。详细判定见 [iv8-env-patching.md](iv8-env-patching.md) "wrapNative 规则"。
3. **返回安全默认值:** 空数组 `[]` / 空对象 `{}` / `null`,确保目标 JS 不会因解构/属性访问报错。
4. **命名约定:** 桩函数名与原生 API 同名,通过 `window.XXX = wrapNative(...)` 挂载。

### 4.3 Python↔JS 边界

#### 4.3.1 expose 函数签名约定

`expose` 的 Python 函数**签名要小**、**返回 Python 原生类型**、**函数体轻量**(纯计算或查表)。禁止返回自定义对象,禁止在 expose 函数里做网络请求等重活。

```python
# ✓ 正确:小签名 + 原生类型 + 轻量
_cache: dict[str, dict] = {}
def get_cached(url: str) -> dict:
    return _cache.get(url, {"status": 0, "body": ""})
ctx.expose(get_cached, "get_cached")

# ✗ 禁止:返回自定义对象 / 长生命周期对象
def get_client() -> httpx.Client:
    return _global_client  # JS 拿到也无法使用
```

#### 4.3.2 数据传递策略

| 场景 | 方式 |
|------|------|
| JS 算出简单结果(签名/加密值) | `ctx.eval("getSign(...)")` 自动转 Python str/int |
| JS 算出复杂结构(对象/数组) | `ctx.eval("...", to_py=True)` 递归转 dict/list |
| Python 传参数给 JS | 小数据拼 eval 字符串;大数据用 expose 桥接 |
| Python 暴露函数给 JS 调用 | `ctx.expose(fn, name)`(注意 GIL,函数要轻量) |

#### 4.3.3 GIL 注意

expose 的函数被 JS 调用时会重新获取 GIL,**阻塞所有 Python 线程**:
1. expose 函数要**轻量**(纯计算或简单 IO)。
2. 重活在 Python 主线程预先完成,结果通过 `add_resource` 或 `ctx.eval` 注入。
3. 多线程场景下,expose 函数要避免锁竞争。

### 4.4 错误处理与日志

#### 4.4.1 JS 异常映射

`ctx.eval` 执行 JS 报错时,**必须捕获并重新明确抛出**,带 Python 侧上下文:

```python
def _extract_sign(ctx, params: dict) -> str:
    try:
        return ctx.eval(f"getSign({json.dumps(params)})")
    except Exception as e:
        raise RuntimeError(f"调用 getSign 失败,params={params},JS 报错: {e}") from e
```

#### 4.4.2 debug 日志采集规范

1. 补环境阶段默认 `mode='debug'`,生产/批量场景用 `mode='prod'`。
2. **日志降噪:** 高频 API(Math/JSON/Array)默认静音;用 `ignore_apis` 调整排除列表。
3. **日志分离:** print 走 stdout,iv8 debug 日志走 stderr(重定向到文件),两条流物理隔离。

#### 4.4.3 vconsole 使用规范

**禁止用 `console.log`**(会被目标 JS 检测),统一用 `vconsole`:

```python
# ✓ 正确
ctx.eval("vconsole.log('调试信息', someVar);")

# ✗ 禁止
ctx.eval("console.log('调试信息');")  # 对目标 JS 可见,被反爬检测
```

### 4.5 命名约定

| 对象 | 约定 | 示例 |
|------|------|------|
| Python 主流程函数 | 动词+名词,编排为主 | `sign_one`、`batch_sign` |
| Python 辅助函数 | 单下划线前缀 | `_setup_env`、`_inject_patches` |
| 桩函数常量 | 固定名 `ENV_PATCH` | — |
| expose 的 Python 函数 | snake_case,JS 侧同名 | `get_cached` → `__ZY__.data.get_cached` |
| JS 侧临时变量 | 下划线前缀 | `window._result`、`window._sign` |

### 4.6 文件组织

单站点补环境脚本的标准文件结构:

```
<site>/
├── target.js             # 目标 JS(从站点抓取,不可控)
└── signer.py             # Python 主流程(编排 + 实现,内嵌 ENV_PATCH)
```

`signer.py` 内部结构遵循深函数原则:
- **公开函数**(`sign_one` / `batch_sign`)签名小,内部嵌套辅助函数
- **主流程仅编排**:`_setup_env` → `_load_target_js` → `_drain_events` → `_extract_sign`
- **辅助函数独立**:`_inject_patches` / `_inject_prerequisites` / `_load_target_js` / `_drain_events` / `_extract_sign`
- **异常映射在辅助函数内完成**,主流程不处理具体错误

#### 4.6.1 文件创建前置检查(P0 硬约束)

> 规则来源:实战中 Agent 在未确认"是否真的需要诊断"前就创建 6 个 `diag_*.py` 文件,其中 5 个是无效探索。

**创建新文件前(Write 工具),必须按顺序确认(顺序不可调):**

```
IF 要创建新文件
   THEN 必须先确认(逐项尝试,前一项失败才进入下一项):
      1. Grep 能否定位目标内容? → 能 → 用 Grep(不创建文件)
      2. Read 能否读取目标文件上下文? → 能 → 用 Read(不创建文件)
      3. python -c "<单行>" 能否解决问题? → 能 → 用 RunCommand 执行(不创建文件)
      IF 三者均无法满足(需多行逻辑 / 需复用 / 需循环 / 需文件 IO)
         THEN 允许 Write 创建文件
         且必须在 stage5-verify.md §5.3 记录创建理由

IF 跳过上述确认直接 Write 创建文件
   → P0 违规,产物无效 → 必须删除多余文件
```

**例外(允许直接创建):**
- 阶段四交付代码(`solution.py` / `iv8_patch.py`)— 用户明确要求
- 任务产物文件(`stageN-*.md` / `stageN.json`)— skill 流程要求
- `depend.js` — 阶段二 2.1 字符串恢复必需

### 4.7 诊断脚本规范

> 规则来源:实战中 Agent 生成 6+ 个诊断脚本,其中 5 个是"撒网式试探",只有 1 个有用。

**诊断脚本定义**:为定位 iv8 补环境问题而创建的临时 Python 脚本(非交付代码)。

**创建前置(If/Then):**

```
IF 要创建诊断脚本
   THEN 必须先在 stage5-verify.md §5.3 写明 3 项(缺一不可):
      1. 要验证的假设(一句话,如"假设 navigator.webdriver 被检测")
      2. 脚本的通过/失败判据(如"返回 true = 假设成立")
      3. 脚本执行后的预期结论(如"成立 → 需 wrapNative 伪装;不成立 → 排除此可能")
   IF 三项任一缺失 → 禁止创建脚本
```

**命名规范**:`_diag_<验证目标>.py`(单下划线前缀,表明临时文件)

**收敛规则:**
- 每个诊断脚本必须输出**单一结论**(pass/fail + 一句话原因)
- 脚本验证完成后,结论写入 stage5-verify.md §5.3,脚本本身删除

**禁止:**
- ⚠️ 在未明确假设的情况下批量创建多个诊断脚本("撒网式试探")
- ⚠️ 诊断脚本之间逻辑重叠
- ⚠️ 诊断脚本长期残留不删除
- ⚠️ 单个诊断脚本验证多个不相关假设(违反单一职责)

### 4.8 跨平台工具使用规范(P0 硬约束)

> 规则来源:实战中 `wc -l` 在 Windows PowerShell 不可用、`grep`/`sed`/`awk` 行为不一致、PowerShell 复杂表达式频繁转义失败。

**工具使用优先级(从高到低):**

| 优先级 | 工具 | 适用场景 |
|--------|------|----------|
| 1(优先) | 专用工具(Read/Edit/Write/Glob/Grep) | 文件读取/编辑/创建/搜索,已封装跨平台 |
| 2(次选) | Python 脚本 | 复杂字符串处理 / 文件分析 / 正则匹配 |
| 3(最后) | RunCommand | 仅用于 git/uv/npm/node 等跨平台命令 |

**禁止(⛔ P0,违反 → 产物无效):**
- ⛔ 禁止使用 `wc` / `grep` / `sed` / `awk` / `find` / `xargs` 等 Unix 专用工具
  - 替代:统计行数用 `len(open(f).readlines())`;搜索用 Grep 工具;字符串替换用 Python `str.replace()`
- ⛔ 禁止在 RunCommand 中内联复杂 PowerShell 表达式(含 `$` 变量、下标索引、方法调用)
  - 替代:一律用 Python 脚本处理(Write 创建临时 .py → `uv run` 执行 → 删除)
- ⛔ 禁止用 `cmd.exe` / `command.exe`

**允许的 RunCommand 场景:**
- `git status` / `git diff` / `git log` / `git add` / `git commit`
- `uv run <script>.py` / `uv run scripts/stage_gate.py --stage N --task-dir <path>`
- `npm run <script>` / `npm install` / `node <script>.js`
- `python -c "<简单单行>"`(仅无 `$` 无引号嵌套的简单命令)

**跨平台命令对照表:**

| 任务 | ❌ Unix 专用(禁止) | ✅ 跨平台(允许) |
|------|---------------------|-------------------|
| 统计文件行数 | `wc -l <file>` | `python -c "print(sum(1 for _ in open('<file>')))"` |
| 搜索字符串 | `grep "pattern" <file>` | Grep 工具 |
| 统计匹配次数 | `grep -c "pattern" <file>` | `python -c "print(open('<file>').read().count('pattern'))"` |
| 字符串替换 | `sed -i 's/old/new/g' <file>` | Edit 工具 或 Python `str.replace()` |
| 提取字段 | `awk '{print $1}' <file>` | Python 脚本 `split()` |
| 查找文件 | `find . -name "*.py"` | Glob 工具 |

### 4.9 内置工具能力边界(P1 流程约束)

> 规则来源:实战中 Read 读取 78KB 单行文件(tdc.js)被截断到 ~30KB;Grep count 模式返回 `1`(文件数)但底部显示 `Found 0 total occurrence`,造成误判。

#### 4.9.1 Read 工具

- **限制**:单行文件(压缩 JS / 混淆代码)可能被截断,截断阈值 ~30KB
- **现象**:返回内容不完整 + 系统提示 "Results from Read have been CLEARED"
- **应对**:
  ```
  IF 目标文件是单行大文件(>30KB,如压缩/混淆 JS)
     THEN 禁止用 Read 直接读取
     改用:Grep 定位 → Python 脚本 str.find() 精确提取上下文
  ```

#### 4.9.2 Grep count 模式

- **限制**:count 模式输出 `1` 是"匹配的文件数",不是"匹配次数"
- **应对**:
  ```
  IF 要验证字符串是否存在
     THEN 禁止用 Grep count 模式
     改用:Grep content 模式(返回匹配行)或 Python content.count()
  ```

#### 4.9.3 Glob 大目录

- **限制**:超大目录(>10000 文件)可能超时
- **应对**:用 `target_directories` 参数限定搜索范围

**工具使用原则:**
- 关键判定用两种工具交叉验证
- 单行大文件 / 大文件 / 二进制文件优先用 Python 脚本处理
