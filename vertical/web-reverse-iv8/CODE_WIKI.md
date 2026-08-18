# Code Wiki — web-reverse-iv8

> 本文档是 `web-reverse-iv8` 项目的结构化代码百科，覆盖项目整体架构、模块职责、关键类与函数、依赖关系及运行方式。
> 文档生成对应 skill 版本：**v9.29**（frontmatter 声明）。

---

## 目录

1. [项目概述](#1-项目概述)
2. [项目整体架构](#2-项目整体架构)
3. [四阶段工作流与阶段门机制](#3-四阶段工作流与阶段门机制)
4. [核心模块职责](#4-核心模块职责)
5. [关键类与函数说明](#5-关键类与函数说明)
6. [依赖关系](#6-依赖关系)
7. [项目运行方式](#7-项目运行方式)
8. [附录：关键概念与规则速查](#8-附录关键概念与规则速查)

---

## 1. 项目概述

### 1.1 项目定位

`web-reverse-iv8` 是一个面向 **AI Agent** 的 **web JS 加密参数逆向工程 Skill**。它不是传统意义上的代码库，而是一套"给 AI 的说明书"——通过确定性的状态机指令、阶段门硬阻断、强类型 manifest 校验，把 AI 退化为一台"按食谱做菜"的机器，避免概率模型在逆向场景中随机游走。

Skill 服务对象为 AI 模型，其规格说明、输入输出约束及流程分支均严格遵循 AI 的解析与执行规则，不依赖人类常识或隐含假设。

**核心能力链路**（从用户输入到交付）：

```
用户提供 HAR + trace
   ↓
参数溯源 + 加密点定位（HAR _initiator.stack）
   ↓
字符串可读性恢复 + 局部去壳（Babel AST）
   ↓
载体形态判定（WASM / JSVMP / Webpack / Worker / 无附加保护）
   ↓
分支选择（A/B/C/D）→ 方案 1 Python 重写 / 方案 2 iv8 补环境
   ↓
本地验证（HAR 真实值比对）→ 交付代码 + 验证报告
```

### 1.2 适用范围

| 维度 | 说明 |
|------|------|
| **正面范围** | web JS 内 sign/token/w 等加密参数的逆向：参数溯源、加密点定位、保护类型识别、方案选择与执行、本地验证 |
| **负面边界** | frida hook 客户端逆向、二进制协议逆向（非 web JS）、RPC/浏览器自动化（Puppeteer/Playwright/Selenium 明确禁止）、通用 web 开发、爬虫工程 |
| **不覆盖** | WASM 二进制内部逆向（仅处理胶水层）、JSVMP 字节码反编译（仅做整文件补环境） |

### 1.3 版本与背景

- **当前版本**：v9.29（`SKILL.md` frontmatter `metadata.version`）
- **演化背景**：项目存在两个并行目录——`web-reverse-iv8-gpt/`（GPT 版本）与本目录 `web-reverse-iv8/`（TRAE IDE 移植版）。开发版（本目录）成熟后会同步覆盖到 `.trae/skills/web-reverse-iv8/` 安装版。
- **兼容性**：Python 3.8–3.14、Windows x64、Linux x64（manylinux）；macOS arm64 实验版经 GitHub Releases 分发。核心依赖 `iv8` 社区版、`httpx`；可选 `curl_cffi`（TLS 指纹）、`wasmtime/pywasm`（WASM）、Node.js（Webpack 拆解）。

详细变更记录见 [changelog.md](file:///e:/temp/web-reverse-iv8/changelog.md)。

---

## 2. 项目整体架构

### 2.1 目录结构

```
web-reverse-iv8/
├── SKILL.md                      # Skill 主入口（AI 读取的说明书）
├── changelog.md                  # 版本变更记录（维护者参考）
├── scripts/                      # 可执行脚本层（Python + JS）
│   ├── stage_gate.py             # 阶段门硬阻断脚本
│   ├── schema_validator.py       # JSON manifest schema 校验器
│   ├── trace_analyzer.py         # 大 trace 文件分析脚本
│   ├── deobfuscate.js            # JS 字符串数组去混淆脚本
│   ├── package.json              # JS 依赖声明（Babel 全家桶）
│   └── package-lock.json
├── references/                   # 参考文档层
│   ├── workflow/                 # 阶段流程主文档（阶段 1-4 + 示例集）
│   │   ├── stage1-basics.md      # 阶段一主文档（合并 HAR + trace + WASM）
│   │   ├── stage2-tracing.md     # 阶段二主文档（合并 去壳 + Webpack）
│   │   ├── stage3.md             # 阶段三主文档：载体形态判定与分支选择
│   │   ├── stage4.md             # 阶段四主文档：本地模拟与验证
│   │   └── examples.md           # 阶段一/二示例集（辅助参考，非必读）
│   └── modules/                  # 深度参考文档（子模块 + 通用参考）
│       ├── code-extraction.md    # 扣代码与本地模拟
│       ├── iv8-env-patching.md   # iv8 补环境
│       ├── api-reference.md      # iv8 API 速查
│       └── conventions.md        # 适用范围 + 契约 + 方法论 + 代码规范
├── assets/templates/             # 产物模板层（13 个文件）
│   ├── single_context.py         # 单 Context iv8 模板
│   ├── multi_thread.py           # 多线程 iv8 模板
│   ├── page_load.py              # page.load 模板
│   ├── network_bridge.py         # Python↔JS 网络桥接模板
│   ├── code_extraction.py        # 扣代码（方案1→方案2降级）模板
│   ├── stage1.manifest.json      # 阶段一 manifest 模板
│   ├── stage2.manifest.json      # 阶段二 manifest 模板
│   ├── stage3.manifest.json      # 阶段三 manifest 模板
│   ├── stage5.manifest.json      # 阶段四 manifest 模板
│   ├── param-analysis.md         # 阶段一产物 md 模板
│   ├── stage2-output.md          # 阶段二产物 md 模板
│   ├── stage3-labels.md          # 阶段三产物 md 模板
│   └── stage5-verify.md          # 阶段四产物 md 模板
└── evals/
    └── evals.json                # 56 条评估用例
```

### 2.2 架构分层

项目采用 **6 层分层架构**，严格遵循"编排与实现分离"原则：

```
┌──────────────────────────────────────────────────────────────┐
│  入口层  SKILL.md                                              │
│  职责：AI 行为说明书，定义阶段门规则、核心原则、四阶段工作流    │
│  特征：确定性 If/Then 状态机，禁止模糊修饰词                   │
└──────────────────────────┬───────────────────────────────────┘
                           │ 引用
┌──────────────────────────▼───────────────────────────────────┐
│  规则层  references/                                           │
│  职责：阶段流程编排 + 能力工具说明 + 跨阶段方法论              │
│  特征：18 个文档，按"阶段流程(8章节强制结构) + 能力工具"组织   │
└──────────────────────────┬───────────────────────────────────┘
                           │ 被调用
┌──────────────────────────▼───────────────────────────────────┐
│  脚本层  scripts/                                              │
│  职责：阶段门硬阻断 + manifest 校验 + trace 分析 + 去混淆      │
│  特征：深函数（对外唯一入口），零第三方依赖（Python 脚本）     │
└──────────────────────────┬───────────────────────────────────┘
                           │ 校验对象
┌──────────────────────────▼───────────────────────────────────┐
│  模板层  assets/templates/                                     │
│  职责：iv8 代码模板 + manifest 模板 + 产物 md 模板             │
│  特征：模板填写 → manifest 硬门校验 → md 软警告，三层闭环      │
└──────────────────────────┬───────────────────────────────────┘
                           │ 质量保证
┌──────────────────────────▼───────────────────────────────────┐
│  评估层  evals/                                                │
│  职责：56 条评估用例，覆盖技术/流程/边界三维矩阵               │
└──────────────────────────────────────────────────────────────┘
```

### 2.3 设计哲学

项目严格遵循"深函数导向"与"确定性分支逻辑"两条核心原则：

1. **确定性分支逻辑**：所有指令以 If/Then 状态机编码，禁止"适当""合理""必要时"等模糊词。未覆盖的边界情况必须指定明确兜底动作（Fallback），不依赖 AI 临场发挥。
2. **深函数导向**：复杂度必须被函数内部吞掉，使用者只需面对极简签名。三个核心 Python 脚本均对外暴露唯一入口，内部吞掉全部规则、枚举、条件联动。
3. **编排与实现分离**：主流程函数仅负责调度，严禁包含具体业务逻辑。
4. **内部嵌套辅助函数**：辅助函数紧跟主流程之后，限制作用域，增强局部性。

---

## 3. 四阶段工作流与阶段门机制

### 3.1 四阶段工作流总览

| 阶段 | 名称 | 做什么 | 编排文档 | 产物文件 | JSON manifest |
|------|------|--------|----------|----------|---------------|
| 一 | 日志基础分析 | 环境指纹采集(trace) + HAR 参数分析 + WASM 标记 | [stage1-basics.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage1-basics.md) | `stage1-params.md` | `stage1.json` |
| 二 | 字符串可读性恢复与迭代溯源 | 2.1 字符串恢复 → 2.2 `_initiator.stack` 逐帧溯源 → 2.3 局部去壳（含 Webpack 模块边界提取） | [stage2-tracing.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage2-tracing.md) | `stage2-output.md` | `stage2.json` |
| 三 | 载体形态判定与分支选择 | 载体形态判定(六选一) + 载体清晰度最终判定 + 分支选择(A/B/C/D) | [stage3.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage3.md) | `stage3-labels.md` | `stage3.json` |
| 四 | 本地模拟与验证 | 分支实现指引 + 方案1/2判定 + Python重写/iv8补环境 + 验证 | [stage4.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage4.md) | `stage5-verify.md` | `stage5.json` |

> 注：阶段四流程文档已统一命名为 `stage4.md`，但产物文件（`stage5-verify.md` / `stage5.json` / `stage5.manifest.json`）及阶段门编号（`--stage 5` / `gate 5`）保留 `stage5` 历史命名，源于 v9.26 合并原阶段四/五。

### 3.2 阶段门阻断机制（核心质量保证）

阶段门是项目最关键的设计——**通过脚本硬阻断强制 AI 按顺序产出产物，禁止跳过任何前置阶段**。

```
IF 要进入阶段 N（N ∈ {2,3,4,5}）
   THEN 必须先运行:
        uv run scripts/stage_gate.py --stage N --task-dir ./<task-name>

   IF 退出码 == 0 (PASS)   → 允许进入阶段 N
   IF 退出码 == 1 (BLOCK)  → 禁止进入，按 stdout JSON.action 回退到阶段 N-1 补齐
   IF 退出码 == 2 (ARGS)   → 修正命令行参数后重试

IF 跳过 stage_gate.py 直接进入阶段 N
   → 产物无效，触发 P0 阶段门阻断
```

**v9.30 双层校验**：

| 校验层 | 校验对象 | 性质 | 失败后果 |
|--------|----------|------|----------|
| 硬门（P0） | `stageN.json` manifest schema 校验 | 强类型 + 枚举 + 条件联动 + 占位符递归扫描 | BLOCK，阻断流程 |
| 软警告 | `stageN-*.md` 字段存在性 | heading/关键词搜索 + 占位符识别 | 写入 `md_warnings`，不阻断 |

manifest 与 md 是"并行产物"：manifest 是可校验子集（强类型），md 是完整叙事（散文）。两者字段语义对齐但不强求逐字一致。

### 3.3 任务产物目录结构

```
./<task-name>/                      # task-name 用目标参数名或网站名（全小写连字符）
├── stage1-params.md                # 阶段一产物（md 叙事）
├── stage1.json                     # 阶段一 manifest（硬门校验对象）
├── stage2-output.md
├── stage2.json
├── stage3-labels.md
├── stage3.json
├── stage5-verify.md
├── stage5.json
├── code/                           # 代码交付物
│   ├── solution.py                 # 方案 1 Python 重写
│   └── iv8_patch.py                # 方案 2 iv8 补环境
└── evidence/                       # 证据材料
    ├── har/
    ├── trace/
    └── deobfuscated/               # 脱壳后代码
        └── <filename>.deobf.js
```

---

## 4. 核心模块职责

### 4.1 入口层 — [SKILL.md](file:///e:/temp/web-reverse-iv8/SKILL.md)

**职责**：AI 行为的总说明书，定义全局规则。

**关键内容**：
- **阶段门阻断规则**（启动前必读，L3 强制前置）
- **核心原则**：从内向外、最小执行范围；IIFE 闭包单体例外条款（唯一允许 page.load 整文件的场景）
- **四阶段工作流表**：阶段 → 做什么 → 参考模块文件
- **模块索引**：18 个文档的"何时用 / 必读时机 / 关键词反查"矩阵
- **禁止事项分级**：P0 硬约束（10 条）/ P1 流程约束（5 条）/ P2 风格约束（3 条）
- **任务失败交付物**与**任务完成前产物整理**：两个对称的 If/Then 状态机，固化"失败有报告，成功有整理"

### 4.2 脚本层 — [scripts/](file:///e:/temp/web-reverse-iv8/scripts/)

脚本层是阶段门机制与工具能力的实现核心，共 4 个可执行脚本。

| 脚本 | 语言 | 核心职责 | 对外入口 |
|------|------|----------|----------|
| [stage_gate.py](file:///e:/temp/web-reverse-iv8/scripts/stage_gate.py) | Python | 阶段 N 入口门禁检查（manifest 硬门 + md 软警告） | `check_stage(task_dir, stage) -> CheckResult` |
| [schema_validator.py](file:///e:/temp/web-reverse-iv8/scripts/schema_validator.py) | Python | 4 阶段 manifest 强类型 schema + 条件联动校验 | `validate_manifest(stage, manifest_path) -> list[str]` |
| [trace_analyzer.py](file:///e:/temp/web-reverse-iv8/scripts/trace_analyzer.py) | Python | 大 trace NDJSON 文件过滤与统计 | `main(trace_path, command, *args) -> int` |
| [deobfuscate.js](file:///e:/temp/web-reverse-iv8/scripts/deobfuscate.js) | JavaScript | OB 字符串数组去混淆（Babel AST 还原） | `main(argv)` |

**共性设计**：
- 三个 Python 脚本均采用 PEP 723 内联元数据 `# /// script / dependencies = [] / ///`，零第三方依赖，可由 `uv run` 直接执行
- 全部强制 UTF-8 stdout（`_ensure_utf8_stdout` / `_configure_utf8`），兼容 Windows GBK
- 严格遵循深函数原则：对外唯一入口，内部吞掉全部规则

### 4.3 规则层 — [references/](file:///e:/temp/web-reverse-iv8/references/)

10 个文档分两类目录组织(workflow/ 阶段流程主文档 + modules/ 深度参考文档):

#### 4.3.1 阶段流程文档(workflow/,4 个,遵循 8 章节强制结构)

阶段流程文档必须包含固定 8 章节：§1 使用时机 / §2 前置条件 / §3 目标与边界 / §4 Gotchas / §5 执行规则与流程 / §6 产物 / §7 GATE / §8 回执。

| 文档 | 阶段 | 核心编排 |
|------|------|----------|
| [stage1-basics.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage1-basics.md) | 阶段一 | HAR 样本选取 → 透传链路追溯 → WASM 标记 → trace 环境指纹采集 |
| [stage2-tracing.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage2-tracing.md) | 阶段二 | 2.1 字符串恢复（三方案降级链）→ 2.2 栈帧逐帧溯源 → 2.3 局部脱壳（含壳定义 + Webpack 模块边界） |
| [stage3.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage3.md) | 阶段三 | 载体形态判定矩阵 → W1-W4 特征核对 → 分支选择 A/B/C/D |
| [stage4.md](file:///e:/temp/web-reverse-iv8/references/workflow/stage4.md) | 阶段四 | 方案1/2判定 → 扣代码/iv8补环境 → 验证策略 |

#### 4.3.2 深度参考文档(modules/,4 个)

| 文档 | 职责 |
|------|------|
| [code-extraction.md](file:///e:/temp/web-reverse-iv8/references/modules/code-extraction.md) | 扣代码模式（方案1）+ iv8 补环境模式（方案2）、闭包 hook 注入 |
| [iv8-env-patching.md](file:///e:/temp/web-reverse-iv8/references/modules/iv8-env-patching.md) | iv8 补环境完整工作流、trace 前置补环境、指纹对齐、失败止损规则 |
| [api-reference.md](file:///e:/temp/web-reverse-iv8/references/modules/api-reference.md) | iv8 API 速查、社区版限制、桩函数 4 形态、内存限制 3 层策略 |
| [conventions.md](file:///e:/temp/web-reverse-iv8/references/modules/conventions.md) | 适用范围 + 契约 + 方法论 + 代码规范（v9.30 合并 4 文档） |

#### 4.3.3 其他参考

| 文档 | 职责 |
|------|------|
| [depend-js-guide.md](file:///e:/temp/web-reverse-iv8/assets/samples/depend-js-guide.md) | depend.js（最小可执行解密运行时）编写指南 |

### 4.4 模板层 — [assets/templates/](file:///e:/temp/web-reverse-iv8/assets/templates/)

13 个模板分三类：

#### 4.4.1 Python 代码模板（5 个，演示 iv8 用法模式）

| 模板 | 用途 | 涉及 iv8 API |
|------|------|--------------|
| [single_context.py](file:///e:/temp/web-reverse-iv8/assets/templates/single_context.py) | 单 Context 单次签名（最小补环境） | `JSContext(mode='debug', js_api='__ZY__')` + `page.load` + `eventLoop.drain()` |
| [multi_thread.py](file:///e:/temp/web-reverse-iv8/assets/templates/multi_thread.py) | 多线程批量签名（每线程独立 Context） | `mode='prod'` + `environment` 参数 + ThreadPoolExecutor |
| [page_load.py](file:///e:/temp/web-reverse-iv8/assets/templates/page_load.py) | 完整 HTML 页面加载 | `page.load` snapshot 4 字段（baseURL/html/resources/headers）完整用法 |
| [network_bridge.py](file:///e:/temp/web-reverse-iv8/assets/templates/network_bridge.py) | Python↔JS 网络桥接 | `ctx.add_resource(url, body, status, headers)` + httpx/curl_cffi |
| [code_extraction.py](file:///e:/temp/web-reverse-iv8/assets/templates/code_extraction.py) | 纯扣代码降级链 | 不涉及 iv8（方案1 Python + Node.js 降级） |

**共性**：4 个 iv8 模板共享同一段 `ENV_PATCH` 桩函数常量（MessageChannel），统一用 `window.__ZY__.wrapNative(fn, name)` 防 toString 检测；统一用 `with` 上下文管理器管理 JSContext 生命周期；cookie 统一通过 `page.load` 的 `headers` 字段（Set-Cookie）注入。

#### 4.4.2 JSON Manifest 模板（4 个，硬门校验对象）

每个 manifest 共享 `schema_version: 1` 顶层字段，其余顶层 key 由 `schema_validator.py` 的 `STAGE_SCHEMAS` 严格枚举（多/少即报错）。

| Manifest | 顶层 key 集合 | 对应阶段门 |
|----------|---------------|------------|
| [stage1.manifest.json](file:///e:/temp/web-reverse-iv8/assets/templates/stage1.manifest.json) | `schema_version, target, evidence, param_trace, wasm, fingerprint` | gate 2 |
| [stage2.manifest.json](file:///e:/temp/web-reverse-iv8/assets/templates/stage2.manifest.json) | `schema_version, decision, encryption_points, transform_ledger, carrier_clarity_initial, boundaries` | gate 3 |
| [stage3.manifest.json](file:///e:/temp/web-reverse-iv8/assets/templates/stage3.manifest.json) | `schema_version, decision, carrier_clarity_final, branch, branch_reason, webpack_features, iife_closure` | gate 4 |
| [stage5.manifest.json](file:///e:/temp/web-reverse-iv8/assets/templates/stage5.manifest.json) | `schema_version, decision, risk_controls, validation, deliverables, uncertainties` | gate 5 |

#### 4.4.3 Markdown 产物模板（4 个，软警告校验对象）

| 模板 | 写入路径 | stage_gate.py required_fields |
|------|----------|-------------------------------|
| [param-analysis.md](file:///e:/temp/web-reverse-iv8/assets/templates/param-analysis.md) | `stage1-params.md` | 参数溯源表、透传链路图、_initiator.stack |
| [stage2-output.md](file:///e:/temp/web-reverse-iv8/assets/templates/stage2-output.md) | `stage2-output.md` | 加密点位、变换台账、载体清晰度初判 |
| [stage3-labels.md](file:///e:/temp/web-reverse-iv8/assets/templates/stage3-labels.md) | `stage3-labels.md` | 载体形态判定结论、载体清晰度最终判定、判定依据、分支选择、分支选择依据 |
| [stage5-verify.md](file:///e:/temp/web-reverse-iv8/assets/templates/stage5-verify.md) | `stage5-verify.md` | 验证方式、验证结果、最终交付物（+ 条件字段"iv8 调试总轮次"） |

### 4.5 评估层 — [evals/evals.json](file:///e:/temp/web-reverse-iv8/evals/evals.json)

**职责**：56 条评估用例，覆盖"技术维度 + 流程维度 + 边界维度"三维矩阵。

**结构**：
```json
{
  "skill_name": "web-reverse-iv8",
  "evals": [
    { "id": 1, "prompt": "...", "expected_output": "...", "files": [] },
    ...
  ]
}
```

**评估维度**（每条用例隐含 5 维）：
1. 技术准确性（必须包含的核心技术要点）
2. API 用法正确性（必须出现的精确 API 调用）
3. 流程顺序正确性（必须强调的顺序约束）
4. 禁止项识别（必须明确禁止的用法）
5. 决策树分支正确性（必须正确对应 SKILL.md 决策树分支）

**用例分类**：iv8 基础与环境补全、JSContext 与模式选择、网络桥接、反调试与监控、事件循环、HAR 参数分析、载体形态判定、去壳与混淆处理、方案选择与扣代码、trace 分析、stage_gate 硬门、加密点判定、范围排除负向用例（禁止 Puppeteer/React 开发/Selenium 爬虫/frida/二进制协议/服务端签名触发）。

---

## 5. 关键类与函数说明

### 5.1 [stage_gate.py](file:///e:/temp/web-reverse-iv8/scripts/stage_gate.py) — 阶段门硬阻断

#### 核心数据结构

**`_STAGE_RULES: dict[int, dict]`**（阶段规则表）

| Stage | 检查的 md | 校验的 manifest | required_fields | fallback_stage | 特殊配置 |
|-------|-----------|-----------------|-----------------|----------------|----------|
| 2 | stage1-params.md | stage1.json | 参数溯源表 / 透传链路图 / `_initiator.stack` | 1 | — |
| 3 | stage2-output.md | stage2.json | 加密点位 / 变换台账 / 载体清晰度初判 | 2 | — |
| 4 | stage3-labels.md | stage3.json | 载体形态判定结论 / 载体清晰度最终判定 / 判定依据 / 分支选择 / 分支选择依据 | 3 | — |
| 5 | stage5-verify.md | stage5.json | 验证方式 / 验证结果 / 最终交付物 | 4 | `extra_files`（核对前序 3 个 md）+ `conditional_fields`（含"方案 2"/"iv8" → 检查"iv8 调试总轮次"） |

#### 关键函数

| 函数 | 签名 | 功能 |
|------|------|------|
| `CheckResult` (dataclass) | `status, stage, checked_file, missing=[], action="", md_warnings=[]` | 检查结果容器 |
| `check_stage` **(公开 API)** | `(task_dir: Path, stage: int) -> CheckResult` | 主入口；编排 5 步检查（md 存在性 → md 字段 → extra_files → conditional_fields → manifest schema 硬门） |
| `_read_md_robust` | `(path: Path) -> str` | 鲁棒读取 md（三级编码 fallback：utf-8 → gb18030 → utf-8 replace） |
| `_find_field_in_md` | `(md_text: str, field_name: str) -> bool` | 字段存在判定（heading 含字段名 + 内容非占位符，或 `字段名: 值` key-value 形式） |
| `_is_placeholder` | `(text: str) -> bool` | 占位符判定（`<...>` / `____` / `☐`） |
| `main` | `() -> int` | CLI 入口，返回退出码 0(PASS)/1(BLOCK) |

**核心逻辑**：`check_stage` 内部 5 步检查中，前 4 步（md 相关）均为软警告，累积到 `md_warnings`；第 5 步 manifest schema 校验为硬门（局部 `from schema_validator import validate_manifest`），失败立即返回 `status="BLOCK"`。

### 5.2 [schema_validator.py](file:///e:/temp/web-reverse-iv8/scripts/schema_validator.py) — manifest schema 校验器

#### 核心常量

- **`STAGE_SCHEMAS: dict[int, set[str]]`**：每阶段顶层 key 集合（多/少即报错）
- **13 个枚举集合**：`SHELL_KINDS` / `CARRIER_KINDS` / `IMPLEMENTATION_KINDS` / `VALIDATION_STATUSES` / `VALIDATION_METHODS` / `NETWORK_MODES` / `BRANCH_KINDS` / `CLARITY_KINDS` / `PARAM_KINDS` / `MARKER_KINDS` / `INTERFACE_TYPES` / `CAPTURE_KINDS`
- **正则**：`FAILURE_RESULT_RE`（假 PASS 防护）、`PLACEHOLDER_RE`（占位符递归扫描）

#### 关键函数

| 函数 | 签名 | 功能 |
|------|------|------|
| `validate_manifest` **(唯一公开 API)** | `(stage: int, manifest_path: Path) -> list[str]` | 主入口；编排 15 个 `_check_*` 子函数，返回错误列表（空=PASS） |
| `_check_top_level` | `(data, stage) -> list[str]` | 顶层 key 集合校验 + `schema_version==1` |
| `_check_target` | `(data, stage) -> list[str]` | stage1 target 字段（authorization 必须 "confirmed"） |
| `_check_evidence` | `(data, stage) -> list[str]` | stage1 `_initiator.stack` 结构校验 |
| `_check_fingerprint` | `(data, stage) -> list[str]` | v9.32 结构化指纹（trace_source + file_fingerprints 数组） |
| `_check_decision` | `(data, stage) -> list[str]` | stage2 shell / stage3 carrier / stage5 implementation |
| `_check_transform_ledger` | `(data, stage) -> list[str]` | stage2 变换台账（5 字段非空 + clarity 枚举） |
| `_check_encryption_points` | `(data, stage) -> list[str]` | stage2 加密点位（line/col 必须非负 int，拒绝字符串） |
| `_check_branch` | `(data, stage) -> list[str]` | stage3 分支选择 + carrier=unknown→branch=runtime 联动 |
| `_check_webpack_features` | `(data, stage) -> list[str]` | stage3 carrier=webpack→W1/W2/W3 必填 |
| `_check_iife_closure` | `(data, stage) -> list[str]` | stage3 applies=true→structure_type/grep_evidence/extractability 非空 |
| `_check_risk_controls` | `(data, stage) -> list[str]` | stage5 含 **iv8→untrusted 联动 + attempts≥8→stop_reason 联动** |
| `_check_validation` | `(data, stage) -> list[str]` | stage5 含 **verified→captures≥2 联动 + 假 PASS 防护** |
| `_check_deliverables` | `(data, stage, task_dir) -> list[str]` | stage5 solution_path 路径穿越防护 |
| `_check_uncertainties` | `(data, stage) -> list[str]` | stage5 provisional/blocked→uncertainties 必填 |
| `_find_placeholders` | `(value, path, errors) -> None` | 递归扫描占位符 |
| `run_self_test` | `() -> None` | 13+ 用例自检 |

#### 7 条关键条件联动

1. **stage3 `carrier=unknown` → `branch='runtime'`**
2. **stage3 `carrier=webpack` → `webpack_features.{W1,W2,W3}` 必填**
3. **stage3 `iife_closure.applies=true` → `structure_type/grep_evidence/extractability` 非空**
4. **stage5 `implementation=iv8` → `ran_untrusted_code=true`**
5. **stage5 `ran_untrusted_code=true` → `subprocess=true` + `network ∈ {disabled, allowlisted}` + `time_limit>0` + `memory_limit>0`**
6. **stage5 `iv8.attempts ≥ 8` → `stop_reason` 非空**（`same_failure_limit` 硬编码 = 3）
7. **stage5 `status=verified` → `captures ≥ 2` + 所有 capture `exact_match=true`**（v9.31 假 PASS 防护：status=verified/provisional 但 result 含失败关键词 → BLOCK）

### 5.3 [trace_analyzer.py](file:///e:/temp/web-reverse-iv8/scripts/trace_analyzer.py) — trace 分析

> **重要事实**：实际只有 2 个命令（`filter` 默认 + `stats`），非文档历史描述的"10 个命令"。v9.32 移除了 `detect/algo/chain/calltree/diff/values` 命令。`filter` 模式的 `--type` 参数有 9 个枚举值（get/set/call/typeof/construct/instanceof/timer/console/all）。

#### 关键函数

| 函数 | 签名 | 功能 |
|------|------|------|
| `main` **(唯一公开 API)** | `(trace_path, command=None, *args) -> int` | 主入口，分发 filter/stats；未知命令抛 ValueError |
| `_run_filter_mode` | `(trace_path, args) -> int` | 默认过滤模式：按 filename/type/interface/member 多维过滤，输出 JSON |
| `_run_stats_mode` | `(trace_path, args) -> int` | 聚合统计：interface.member 频次降序，输出文本表格 |
| `_iter_events` | `(path) -> generator[dict]` | 流式 NDJSON 迭代器（逐行 yield，解析失败警告并跳过） |
| `_match_filters` | `(ev, fargs) -> bool` | type/interface/member 三维过滤判定 |
| `_extract_script_name` | `(file_url) -> str` | URL → basename |
| `_get_op_value` | `(ev) -> (op, value)` | 按 type 分发提取操作与值 |

**输出格式**：
- filter：`{"<script>": [{"op","value","seq","type"}, ...]}`（作为 iv8 补环境核心输入）
- stats：`频次  interface.member` 文本表格（trace 完整性校验用）

### 5.4 [deobfuscate.js](file:///e:/temp/web-reverse-iv8/scripts/deobfuscate.js) — 字符串数组去混淆

> **重要事实**：未使用 webcrack/synchrony 等去混淆库，基于 Babel（`@babel/parser + @babel/traverse + @babel/types + @babel/generator`）自实现。**只做字符串数组还原**，显式不做变量重命名 / CFF 还原 / 死代码消除 / helper 内联。内置 56 用例自检。

#### 关键函数

| 函数 | 签名 | 功能 |
|------|------|------|
| `main` | `(argv) -> void` | CLI 入口，分发 self-check/help/正常流程 |
| `De_string_arraying_obfuscation` | `(ast, DECNAME, dependJsContent) -> {ast, report}` | **主去混淆函数**（2600+ 行，内嵌大量辅助函数） |
| `collectDecryptTargets` | `(ast, decryptName) -> targets` | 收集解密函数调用目标（含别名/wrapper/container array 三种形式） |
| `evaluateStaticNode` | `(node) -> value` | 递归静态求值（Unary/Binary/Logical/Conditional/Sequence/Template/Array/Member/Call） |
| `evaluateDecryptCall` | `(path, decryptName)` | 用 `eval(generator(callExpression).code)` 执行解密函数 |
| `runSelfCheck` | `() -> void` | 56 用例自检 |

**工作原理**：识别目标解密函数调用（含别名/wrapper/container array 形式）→ 用 `depend.js`（通过 `eval(dependJsContent)`）执行解密函数 → 将静态参数调用替换为字面量。

### 5.5 Python 代码模板关键函数

| 模板 | 公开深函数 | 内部编排 |
|------|-----------|----------|
| [single_context.py](file:///e:/temp/web-reverse-iv8/assets/templates/single_context.py) | `sign_one(params, cookies=None, debug_log=None) -> str` | `_setup_env → _load_target_js → _drain_events → _extract_sign` |
| [multi_thread.py](file:///e:/temp/web-reverse-iv8/assets/templates/multi_thread.py) | `batch_sign(tasks: list[dict], max_workers=8) -> dict[str, str]` | ThreadPoolExecutor + `_sign_task`（每线程独立 Context） |
| [page_load.py](file:///e:/temp/web-reverse-iv8/assets/templates/page_load.py) | `extract_from_page(page_url, html, resources, cookies=None) -> dict` | `_inject_patches → _load_page → _drain_events → _extract_result` |
| [network_bridge.py](file:///e:/temp/web-reverse-iv8/assets/templates/network_bridge.py) | `run_with_network(target_js_path, api_url, cookies=None, use_curl_cffi=False) -> str` | `_setup_env → _load_target_js → _trigger_request → _fetch_real → _inject_response → _drain_events → _extract_result` |
| [code_extraction.py](file:///e:/temp/web-reverse-iv8/assets/templates/code_extraction.py) | `encrypt(params: dict) -> str` | `_encrypt_py`（方案1）→ 失败降级 `_encrypt_node`（方案2） |

---

## 6. 依赖关系

### 6.1 内部模块依赖

```
stage_gate.py ──局部 import──→ schema_validator.py
   (from schema_validator import validate_manifest)
   (局部 import 避免循环依赖与启动开销)

trace_analyzer.py      独立，无内部依赖
deobfuscate.js         独立，仅依赖 npm @babel/*
```

这是 5 个脚本中**唯一**的内部模块依赖关系。

### 6.2 外部依赖

#### Python 依赖（工作区 [pyproject.toml](file:///e:/temp/pyproject.toml)）

```toml
requires-python = ">=3.12"
dependencies = [
    "iv8>=0.1.3",           # 核心：V8 引擎封装，社区版
    "pycryptodome>=3.23.0", # 加密算法实现（方案 1 Python 重写）
    "pycryptodomex>=3.23.0",
    "requests>=2.34.2",
]
```

> 注：三个核心 Python 脚本（stage_gate.py / schema_validator.py / trace_analyzer.py）通过 PEP 723 声明 `dependencies = []`，**零第三方依赖**，纯标准库实现，可由 `uv run` 直接执行。`iv8` / `pycryptodome` 等仅在实际逆向代码（阶段四产出）中使用。

可选依赖（按场景）：
- `curl_cffi`：TLS 指纹检测场景（替代 httpx）
- `wasmtime` / `pywasm`：WASM 场景（分支 A）
- `httpx`：HTTP 请求（验证阶段发包）
- `psutil`：高安全内存监控（第 3 层策略）

#### JavaScript 依赖（[scripts/package.json](file:///e:/temp/web-reverse-iv8/scripts/package.json)）

```json
{
  "devDependencies": {
    "@babel/generator": "^7.29.1",
    "@babel/parser": "^7.29.2",
    "@babel/traverse": "^7.29.0",
    "@babel/types": "^7.29.0"
  }
}
```

仅 4 个 Babel 包，全部为 dev 依赖（运行时无外部依赖，仅靠 Node 内置 + Babel）。

### 6.3 文档引用关系

#### 阶段流程链式引用

```
stage1-basics.md ──GATE 通过──→ stage2-tracing.md ──GATE 通过──→ stage3.md ──GATE 通过──→ stage4.md ──GATE 通过──→ SKILL.md 产物整理
```

#### 能力工具被引用关系

| 能力文档 | 被引用方 |
|----------|----------|
| depend-js-guide.md | ← stage2-tracing.md §2.1.2 方案一 |
| code-extraction.md | ← stage4.md §5.3/§5.4 |
| iv8-env-patching.md | ← stage4.md §5.4、code-extraction.md §5.3.2 |
| api-reference.md | ← iv8-env-patching.md / stage4.md / code-extraction.md / conventions.md |
| conventions.md | ← iv8-env-patching.md / 所有写代码前 |

#### 脚本引用关系

| 脚本 | 被引用方 |
|------|----------|
| scripts/stage_gate.py | ← 所有 stage*.md §7 |
| scripts/trace_analyzer.py | ← stage1-basics.md §5 |
| scripts/deobfuscate.js | ← stage2-tracing.md §2.1.2 方案一 |
| scripts/schema_validator.py | ← SKILL.md（manifest schema 校验规则） |

### 6.4 模板与 manifest 的语义对齐

- `single_context.py` / `multi_thread.py` / `page_load.py` / `network_bridge.py` → 对应 `stage5.json` 的 `decision.implementation.kind = "iv8"` 路径（方案 2）
- `code_extraction.py` → 对应 `stage5.json` 的 `decision.implementation.kind = "static-rewrite"` 路径（方案 1）
- `risk_controls.iv8.attempts >= 8` → 强制 `stop_reason` 非空，对应 `stage5-verify.md` §5.2 的"iv8 失败止损检查"

---

## 7. 项目运行方式

### 7.1 环境要求

| 组件 | 要求 |
|------|------|
| Python | ≥ 3.12（工作区要求）；脚本兼容 3.8–3.14 |
| 操作系统 | Windows x64 / Linux x64（manylinux）；macOS arm64 实验版 |
| Node.js | 阶段二去混淆（deobfuscate.js）必需 |
| 包管理 | `uv`（项目指定，所有命令用 `uv run`） |

### 7.2 安装

```powershell
# 工作区依赖安装（iv8 / pycryptodome / requests）
uv sync

# JS 依赖安装（deobfuscate.js 的 Babel 依赖）
cd scripts
npm install
```

### 7.3 脚本运行命令

#### 阶段门检查（核心命令）

```powershell
# 进入阶段 N 前 must 运行（N ∈ {2,3,4,5}）
uv run scripts/stage_gate.py --stage <2|3|4|5> --task-dir ./<task-name>

# 退出码：0=PASS / 1=BLOCK / 2=ARGS
# stdout 输出 JSON：{"status","stage","checked_file","missing","action","md_warnings"}
```

| 阶段门 | 校验对象 | 通过含义 |
|--------|----------|----------|
| `--stage 2` | stage1-params.md + stage1.json | 允许进入阶段二 |
| `--stage 3` | stage2-output.md + stage2.json | 允许进入阶段三 |
| `--stage 4` | stage3-labels.md + stage3.json | 允许进入阶段四 |
| `--stage 5` | stage5-verify.md + stage5.json + 前序 3 个 md | 允许交付（全产物核对） |

#### manifest schema 校验（独立运行）

```powershell
# 自检（13+ 用例）
uv run scripts/schema_validator.py --self-test

# 校验指定 manifest
uv run scripts/schema_validator.py --stage <1|2|3|5> --manifest <path>
# 退出码：0=PASS / 1=BLOCK
```

#### trace 分析

```powershell
# 默认 filter 模式（按文件/类型/接口/成员过滤，输出 JSON）
uv run scripts/trace_analyzer.py <trace> \
    [--filename <js>] [--type <get|set|call|typeof|construct|instanceof|timer|console|all>] \
    [--interface <iface>] [--member <mem>] [--output <file>]

# stats 模式（聚合统计 interface.member 频次）
uv run scripts/trace_analyzer.py <trace> stats
```

#### JS 去混淆

```powershell
# 正常去混淆
node scripts/deobfuscate.js --input <混淆JS> --output <还原JS> --depend <depend.js> --decrypt <解密函数名>

# 56 用例自检
npm run check
# 或
node scripts/deobfuscate.js --self-check

# 帮助
node scripts/deobfuscate.js --help
```

### 7.4 典型任务执行流程

```powershell
# 1. 创建任务目录
mkdir .\my-task

# 2. 阶段一：HAR 分析 + trace 采集，产出 stage1-params.md + stage1.json
#    （按 assets/templates/param-analysis.md 模板填写）

# 3. 阶段门检查（进入阶段二）
uv run scripts/stage_gate.py --stage 2 --task-dir ./my-task
# 看到 PASS 后继续

# 4. 阶段二：字符串恢复（可调用 deobfuscate.js）+ 溯源，产出 stage2-output.md + stage2.json
uv run scripts/stage_gate.py --stage 3 --task-dir ./my-task

# 5. 阶段三：载体形态判定 + 分支选择，产出 stage3-labels.md + stage3.json
uv run scripts/stage_gate.py --stage 4 --task-dir ./my-task

# 6. 阶段四：方案 1/2 实现 + 验证，产出 stage5-verify.md + stage5.json + code/
uv run scripts/stage_gate.py --stage 5 --task-dir ./my-task

# 7. 产物整理（按 SKILL.md "任务完成前产物整理"流程，4 步顺序执行）
```

### 7.5 iv8 代码模板使用

iv8 代码模板（`assets/templates/*.py`）是阶段四方案 2 的起点，需复制到任务目录后按站点改写：

```powershell
# 单 Context 签名
copy assets\templates\single_context.py .\my-task\code\signer.py
# 改写：ENV_PATCH 桩函数 + _load_target_js 加载目标 JS + _extract_sign 提取签名

# 多线程批量
copy assets\templates\multi_thread.py .\my-task\code\batch_signer.py

# 网络桥接（社区版 iv8 不发真实 HTTP 时）
copy assets\templates\network_bridge.py .\my-task\code\bridge.py
```

**iv8 核心执行顺序**（强制，违反则补环境失败）：
```
① 创建 Context → ② 注入 ENV_PATCH 桩函数 + 前置参数(localStorage) → ③ page.load → ④ drain 事件循环 → ⑤ 提取结果
```

---

## 8. 附录：关键概念与规则速查

### 8.1 核心概念

| 概念 | 定义 | 出处 |
|------|------|------|
| **载体形态六选一** | WASM 二进制 / JSVMP 字节码 / Webpack 模块 / Worker 算子 / 无附加保护 / 未知 | stage3.md §3.1.1 |
| **分支选择** | A(WASM) / B(JSVMP) / C(Webpack+无附加保护) / D(Worker)；未知→runtime | stage3.md §3.6 |
| **方案 1** | Python 重写（分支 C 专用，逻辑可读懂 + 算法代码路径不调用浏览器 API 产出密钥材料） | stage4.md §5.2 |
| **方案 2** | iv8 补环境（分支 C 兜底 + 分支 B 必走 + 分支 D 走 iv8 Hook） | stage4.md §5.4 |
| **加密点** | 明文数据作为实参**首次**被传入加密函数并触发加密逻辑的 Call Site；判定三原则：有密钥参与 + 不可逆 + 发生数学变化 | stage2-tracing.md §3 |
| **变换台账 4 字段** | 保持不变项 / 验证证据 / 载体形态特征观察 / 载体清晰度初判 | stage2-tracing.md §2.1.3 |
| **壳（2 类）** | OB 壳（obfuscator.io 系）+ eval/动态 Function 壳 | stage2-tracing.md §2.3.0 |
| **非壳（4 类）** | JSVMP / WASM / Webpack / Worker（保护类型/打包技术，非壳） | stage2-tracing.md §2.3.0 |
| **IIFE 闭包单体** | 整个文件是 IIFE 闭包，函数共享闭包变量无法独立提取；唯一允许 page.load 整文件的场景 | SKILL.md 核心原则 |
| **Recovery Level** | JSVMP 标签场景默认从 Level A 起步：A(默认)/B(升级)/C(升级)，硬性升级禁止跳级 | stage4.md §5.1.2 |
| **Webpack 特征 W1-W4** | W1 模块表对象 / W2 require 函数 / W3 IIFE 三段式 / W4 `__webpack_require__`（可选） | stage3.md §3.2 |
| **JSVMP 五条检查清单** | dispatch loop / 字节码数组 / 栈寄存器操作 / case 块抽象操作 / PC 指针单调递增 | stage3.md §3.3.2 |

### 8.2 iv8 关键约束

| 约束 | 说明 |
|------|------|
| **失败止损规则** | 同 API 同分类连续 3 次失败 → 止损；累计 8 次失败 → 任务标记失败 |
| **桩函数 4 形态** | 1.C++ 层 reject（最坑）/ 2.JS 层 reject / 3.回调永不触发（静默桩）/ 4.resolve 成 null/undefined |
| **内存限制 3 层** | 第 1 层（必须）V8 堆限制 + `ctx.close(gc="low_memory")`；第 2 层（推荐 Windows）子进程 + Job Object；第 3 层（高安全）第 2 层 + psutil 监控 |
| **社区版限制** | 不发真实 HTTP / CryptoJS 可能不完整 / DOM 内部映射表不完整 / 内置反调试已禁用 |
| **wrapNative 规则** | 补丁覆盖浏览器 API 必须用 wrapNative 伪装，否则 toString 暴露源码 |
| **vconsole 规范** | 禁止 `console.log`（会被目标 JS 检测），统一用 `vconsole` |

### 8.3 禁止事项分级

- **P0 硬约束（10 条）**：禁止 RPC/浏览器自动化 / 禁止跳过依赖图分析直接 page.load / 禁止跳过方案 1 必试清单 / 禁止因数据依赖浏览器跳过方案 1 / 禁止方案 1 失败后搭建动态调试环境 / 禁止 iv8 调试无回退 / 禁止跳过阶段门 / 禁止跳过 stage_gate.py / 禁止 DevTools API / 禁止 Black-box reuse 模式
- **P1 流程约束（5 条）**：禁止用 trace 做加密点定位 / 禁止把 trace 当"要补什么"清单 / 禁止跳过去壳后验证 / 禁止把 JSVMP/WASM/Webpack/Worker 当壳 / 禁止补 iv8 已有环境
- **P2 风格约束（3 条）**：禁止人工通读几百 MB trace / 禁止把 JSVMP 内部 eval 当壳 / 禁止用"厂商不会这么做"排除场景

---

> **文档维护说明**：本文档基于 v9.29 版本快照生成。如需了解版本演化，查阅 [changelog.md](file:///e:/temp/web-reverse-iv8/changelog.md)。实际阶段门执行始终以 `scripts/stage_gate.py` 退出码为准，本文档规则描述仅供参考。
