# 版本变更记录

## v9.6:rule_source 行号动态化 + stage_gate 过程可信机制 + 算法对齐检查清单 + 两类上下文分类 + iv8 内部一致性原则 + POSIX 兼容 + 版本注脚下沉 + 方案 1 轻量模板

**核心变更**:基于 3 份实战问卷(GeeTest v4 / 网易易盾 WorkBuddy / 网易易盾 ds-4p)综合分析,聚焦"过程可信""参数对齐方法论""iv8 内部一致性"三大深水区。修复 P1/P4 rule_source 行号硬编码 bug,新增 stage_gate 过程可信机制(防止先斩后奏),引入"网站运行时上下文 / 客户端环境上下文"二分法判定标准,废止 v9.4 "指纹必须用 HAR 真实值对齐"的错误规则。

### 主题 1:P1/P4 rule_source 行号动态化(P0 修 bug)

**问题**:v9.5 的 P1 修复中,`schema_validator.py:650/666` 硬编码 `rule_source: schema_validator.py:_check_validation L617/L626`,但实际 `FAILURE_RESULT_RE` 在 L69,触发分支在 L647/L663。P1 想根治"读源码定位"却自伤。

**修复**:用 `inspect.currentframe().f_lineno` 动态获取触发行号,rule_source 指向常量定义行(L69 `FAILURE_RESULT_RE`)+ 触发行号。新增 `rules_yaml_anchor` 字段指向 `schema-rules.yaml` 锚点。

**影响文件**:`scripts/schema_validator.py`

### 主题 2:SKILL.md 版本号同步(P0 复核)

**修复**:SKILL.md frontmatter `version: v9.6`,changelog 新增 v9.6 条目。

### 主题 3:stage_gate 过程可信机制(P1,3/3 复现老问题 7)

**问题**:3/3 项目复现"跳过 stage_gate 假成功":agent 先斩后奏跑通业务,再回填产物,gate 校验"产物自洽性"无法阻止。

**修复**:stage_gate.py 新增 `--record` 参数写入 `.stage_gate_history.jsonl`;进入 gate N 时检查 gate N-1 是否已运行,无记录 → BLOCK。SKILL.md 新增"过程可信机制"章节。stage5-verify.md 模板新增 §0 gate 运行记录。

**影响文件**:`scripts/stage_gate.py` / `SKILL.md` / `assets/templates/stage5-verify.md` / `references/workflow/stage4.md`

### 主题 4:算法对齐检查清单(P1,通用方法论)

**问题**:GeeTest v4(userresponse 线性变换/offset 几何标定)和 ds-4p(7 处算法差异)反馈缺算法对齐方法论。

**修复**:stage4.md §5.3.3 新增"算法对齐检查清单"(7 项通用方法论:采样公式/时间语义/坐标语义/编码字母表/去重维度/数值精度/有符号字节)。滑块参数作为"采样公式"项示例内嵌,不建业务领域专项模块(skill 是通用逆向方法论,不为每个业务领域建模块)。

**影响文件**:`references/workflow/stage4.md`

### 主题 5:两类上下文分类 + 差异化对齐(P2 核心重构)

**问题**:存储型 token 用 HAR 旧值会过期;AI 不理解"网站专属上下文";v9.4 规则"指纹必须用 HAR 真实值对齐"破坏 iv8 内部一致性。

**修复**(三段重构):

1. **两类上下文定义**(阶段二 §2.4):
   - 网站运行时上下文:"你在这个网站上正在干什么?"(随网站变化,需逆向生成机制)
   - 客户端环境上下文:"你是谁?你用什么工具上网?"(不随网站变化,保持 iv8 内部一致性)
   - 判定标准:是否随网站变化(确定性判定,不依赖 AI 常识)

2. **差异化对齐策略**(阶段四 §5.4.5):
   - 网站运行时上下文 + 参与加密生成 → 必须逆向生成机制(禁止 HAR 旧值占位,会过期)
   - 客户端环境上下文 + 参与加密生成 → 默认保持 iv8 默认值;仅服务端校验具体值时才用 environment 整体覆盖

3. **iv8 补环境核心原则修订**(v9.4 规则废止):
   - 废止:"指纹字段被加密点位文件读取 → 必须用 HAR 真实值对齐"
   - 新规则:"iv8 是完整一致的浏览器环境,禁止无脑注入 HAR 采集值破坏内部一致性"
   - 新增踩坑 6:网站运行时上下文用 HAR 旧值占位

4. **错误码复用陷阱**(stage4.md §5.5):同一错误码连续 3 次必须"正-反-正夹心"验证,间隔 ≥ 30 秒。

**影响文件**:`references/workflow/stage2-tracing.md` / `assets/templates/stage2-output.md` / `references/workflow/stage4.md` / `references/modules/iv8-env-patching.md` / `scripts/stage_gate.py` / `SKILL.md`

### 主题 6:stage_gate.py POSIX 路径兼容(P2 兼容)

**问题**:Git Bash 风格路径 `/e/temp/...` 时 stage_gate.py 读不到 task-dir。

**修复**:新增 `_normalize_path` 函数,内部转换 POSIX 风格路径为 Windows 路径。

**影响文件**:`scripts/stage_gate.py`

### 主题 7:SKILL.md 版本注脚下沉 + YAML 发现性提升(P3 体验)

**问题**:SKILL.md 版本注脚噪声大;3/3 问卷 schema-rules.yaml 发现性低。

**修复**:SKILL.md 历史 version 注脚下沉到 changelog(只保留 v9.6 新增注脚);schema_validator BLOCK 报错新增 `rules_yaml_anchor` 字段;SKILL.md "v9.30 双层校验"章节新增"先读 YAML"提示。

**影响文件**:`SKILL.md` / `scripts/schema_validator.py`

### 主题 8:manifest 方案 1 轻量模板(P3 模板)

**问题**:GeeTest v4 未生成任何 manifest 仍验证成功。manifest 字段偏 iv8 视角,方案 1 场景关联弱。

**修复**:新增 `assets/templates/stage5.manifest-light.json`(方案 1 轻量版,无 iv8 字段,含 algorithm_alignment 检查清单);schema_validator.py 支持轻量版 schema;SKILL.md 说明双模板选择规则。

**影响文件**:`assets/templates/stage5.manifest-light.json` / `scripts/schema_validator.py` / `SKILL.md`

---

## v9.5:stage_gate 报错精细化 + 失败关键词白名单/上下文感知 + iv8 踩坑案例库 + schema 规则可读化 + md/manifest 真相源

**核心变更**:基于用户实战问卷反馈,聚焦"调试体验优化"。重构 schema_validator 报错机制(结构化字段+白名单+上下文感知),新增 iv8 踩坑案例库,抽离 schema 规则为可读 YAML,明确 md vs manifest 真相源边界。skill 改名 `web-reverse-iv8-tare` → `web-reverse-iv8`。

### 主题 1:stage_gate.py 报错信息精细化(P1)

**问题**:用户反馈"BLOCK 只说'含失败关键词',不指明字段/关键词/文件/规则源",调试往返 3-4 次。

**修改文件**:
- `scripts/schema_validator.py` `_check_validation` 函数
  - 失败关键词命中时,返回结构化错误信息,含:
    - `field_path`: 字段路径(如 `validation.samples[0].result`)
    - `trigger_keyword`: 触发关键词(如 `"失败"`)
    - `value_snippet`: 命中位置的上下文片段(前后各 10 字符)
    - `rule_source`: 规则源(如 `schema_validator.py:_check_validation L617`)
    - `suggestion`: 修复建议(移除关键词/改用替代表述/确保成功上下文)
  - 预期收益:Agent 调试 BLOCK 往返次数从 3-4 次降到 1 次

### 主题 2:失败关键词白名单 / 上下文感知(P2)

**问题**:用户反馈"`errorCode=0` 是验证目标字段本身(成功语义),但 `errorCode` 出现在 result 描述里被判失败"。

**修改文件**:
- `scripts/schema_validator.py` 新增常量与函数
  - `FAILURE_KEYWORD_WHITELIST`:白名单关键词集合(errorcode/errcode/error_code/errno/errorlevel/errormsg)
  - `SUCCESS_CONTEXT_PATTERNS`:成功上下文模式列表(=0/:"0"/'0'/success/成功/ok)
  - `SUCCESS_CONTEXT_WINDOW = 20`:上下文扫描窗口(关键词前后各 20 字符)
  - `_detect_failure_keyword(text)`:深函数,内部吞掉白名单、上下文窗口、关键词匹配规则
  - 判定逻辑(顺序短路):
    1. 用 FAILURE_RESULT_RE 找所有失败关键词匹配
    2. 匹配后紧跟字母数字/下划线 → 是字段名一部分(如 errorCode 中的 error)→ 跳过
    3. 匹配词在白名单 → 跳过
    4. 上下文窗口含成功模式 → 跳过(如 "errorCode=0" 中 errorCode 后跟 =0)
    5. 否则 → 命中,返回结构化信息
  - 自检用例 4 条(白名单 PASS / 上下文失败 BLOCK / 结构化报错字段完整 / _detect_failure_keyword 直接测试)

### 主题 3:iv8 桩函数踩坑案例库(P3)

**问题**:用户反馈"文档有桩函数清单但缺常见踩坑案例,MessageChannel/ctx.close 等踩坑耗费调试时间"。

**修改文件**:
- `references/modules/iv8-env-patching.md` 新增"§常见踩坑案例库"章节
  - 5 条实战高频踩坑,每条含"现象/原因/解决"三段式:
    1. MessageChannel prototype 属性直接访问触发"非法调用"
    2. ctx.close(gc=true) 与 with 语句 __exit__ 冲突
    3. page.load 大文件时 socket timeout 误判卡死
    4. ctx.eval 注入桩函数时机错误(page.load 之后注入为时已晚)
    5. environment 参数路径错误导致指纹未对齐
  - 更新 TOC 添加章节链接

### 主题 4:schema 规则可读化(P4)

**问题**:用户反馈"schema 规则隐藏在源码注释里,SKILL.md 说'Agent 不需记忆',但调试 BLOCK 必须读 schema_validator.py 源码"。

**新增文件**:
- `assets/schema-rules.yaml`:schema_validator.py 规则可读化描述
  - 按 stage1/stage2/stage3/stage5/common 分块
  - 每条规则含 `rule`(规则描述)+ `rule_source`(源码位置)
  - v9.5 失败关键词检测规则含 `whitelist` / `success_context_patterns` / `success_context_window`
  - 维护原则:schema_validator.py 是真相源(执行用),YAML 是描述(阅读用)

**修改文件**:
- `SKILL.md` "v9.30 双层校验"段 + "v9.5 md vs manifest 真相源"段
  - 引用 schema-rules.yaml 作为规则可读化入口

### 主题 5:md vs manifest 真相源(P5)

**问题**:用户反馈"md 降级软警告但部分字段实际是硬门,两边重复填写易不一致,真相源不清"。

**修改文件**:
- `SKILL.md` 新增"v9.5 md vs manifest 真相源"小节
  - manifest(JSON):硬门真相源,Agent 调试期只填 manifest
  - md(叙事):交付前补全,服务人类审计
  - 禁止:调试期同时维护 md 和 manifest(浪费轮次)
  - 字段去重:"iv8 调试总轮次"等字段仅在 manifest 维护,md 用引用
  - BLOCK 调试:读 schema-rules.yaml 快速定位规则

### 主题 6:skill 改名 web-reverse-iv8-tare → web-reverse-iv8

**修改文件**:
- `CODE_WIKI.md`:全文替换 web-reverse-iv8-tare → web-reverse-iv8(52 处)
- `scripts/schema_validator.py`:文档字符串中 "tare 的 4 个阶段门" → "4 个阶段门"

### 主题 7:stage5 概念残留修复

**问题**:用户反馈"最后一个产物顺序不对,原先第5阶段怎么还有,应该是第四阶段"。

**修改文件**:
- `SKILL.md` L46:"阶段 5 入口(交付前)" → "阶段四交付前(gate 5)",加注 stage5-* 历史命名说明
- `SKILL.md` L206:"通过 stage5 验证后" → "通过 gate 5(阶段四交付前检查)后"

### 验证

- ✅ schema_validator.py --self-test 通过(原 13 用例 + v9.5 新增 4 用例,共 17 用例)
- ✅ Python 语法检查通过(schema_validator.py / stage_gate.py / trace_analyzer.py)
- ✅ 无 web-reverse-iv8-tare 字符串残留

---

## v9.4:动态 JS 判定前置 + 三概念定义 + 入口函数环境依赖分析 + 验证失败排查顺序固化

**核心变更**:围绕"动态 JS 判定""加密点/入口函数/加密函数三概念""入口函数环境依赖分析""验证失败排查顺序"四个主题,重构阶段二/三/四流程,统一编号为 2.x,版本号从 v9.32 直接升级到 v9.4。

### 主题 1:动态 JS 判定前置(阶段二 §2.0)

**新增文件/章节**:
- `references/workflow/stage2-tracing.md` §2.0 动态 JS 判定(v9.4 新增,前置)
  - §2.0.1 判定流程(基于 HAR 证据,不发请求):URL 静态特征检查 → HAR 多份响应对比(含文件大小比对)→ 产物输出
  - §2.0.2 不做子类型判定(强制):禁止基于 diff 内容判定"什么变了"
  - §2.0.3 安全边界:禁止发请求、禁止子类型判定、禁止跳过本节

**修改文件**:
- `references/workflow/stage4.md` §5.4.4 动态生成 JS 识别与处理(v9.4 重构,与阶段二 §2.0 衔接)
  - 与阶段二 §2.0 衔接:阶段二判定"是否动态"(预警),阶段四验证"是否干预加密参数生成"(确认)
  - 干预判定标准:P2 != P1 则干预(P1=旧 JS 输出,P2=新 JS 输出)
  - 新增方案 1 路径:httpx 下载 JS + re 匹配提取动态参数 + Python 本地模拟(优先,省去 iv8 复杂化)
- `references/workflow/stage4.md` §5.4.0 iv8 调试前置门(v9.4 边界明确)
  - 明确执行顺序:§5.4.4(JS 来源检查)→ §5.4.0(算法确认 → 明文对比 → 环境检测)→ §5.4.1(补环境流程)
  - 新增禁止事项:禁止跳过 §5.4.4 动态 JS 检查直接进入本前置门

### 主题 2:三概念定义独立成节(阶段二 §3.1)

**新增文件/章节**:
- `references/workflow/stage2-tracing.md` §3.1 三概念定义(加密点 / 入口函数 / 加密函数,v9.4 新增独立成节)
  - §3.1.1 加密点(Encryption Point):明文数据首次传入加密函数的调用位置
  - §3.1.2 入口函数(Entry Function):加密流程的调用入口
  - §3.1.3 加密函数(Encryption Function):真正执行加密算法的函数定义
  - 三种场景下的可见性矩阵(分支 C/A/B/D/重度混淆)
  - 定位职责:入口函数所有分支都定位;加密点/加密函数仅分支 C 定位

**修改文件**:
- `references/workflow/stage3.md` §3.6.1 分支判定矩阵(加密点未知说明,v9.4 新增)
  - 分支 A/B/D/重度混淆场景加密点/加密函数"未知",分支判定仅依据载体形态判定
- `references/workflow/stage2-tracing.md` §2.4 入口函数定位 + 环境依赖分析(v9.4 新增)
  - 入口函数定位:从 HAR `_initiator.stack` 提取
  - 环境依赖分析:基于 trace 按入口函数调用栈过滤(用 trace_analyzer.py --stack-func)
  - 入参个数完整性判定:基于脱壳后代码和调用栈判定入参个数及来源

### 主题 3:验证失败排查顺序固化(阶段四 §5.3.3 + §5.4.3)

**修改文件**:
- `references/workflow/stage4.md` §5.3.3 试跑失败处理(v9.4 重构三步排查)
  - 方案 1 排查顺序:数据齐全性 → 算法实现 → 环境排查(发包环境被检测)
  - 禁止跳步,每步有明确的检查项和退出条件
- `references/workflow/stage4.md` §5.4.3 iv8 验证失败排查与止损规则(v9.4 重构)
  - §5.4.3.1 验证失败排查顺序(三步):数据对齐 → cookie/localStorage → 指纹/UA
  - §5.4.3.2 失败止损规则(原 §5.4.3,保留)
- `references/modules/iv8-env-patching.md` 加密参数生成失败排查(v9.4 重构)
  - 原 6 步排查重构为三步分类,对齐 stage4.md §5.4.3
  - Step 1 数据对齐 / Step 2 cookie/localStorage / Step 3 指纹/UA

### 产物模板扩展

**修改文件**:
- `assets/templates/stage2-output.md`(v9.4 修订)
  - 新增 §0 动态 JS 判定字段
  - 新增 §4 入口函数 + 环境依赖分析字段(入口函数 / 环境依赖清单 / 入参个数完整性判定 / 加密点/加密函数)
  - 调整边界标记、载体清晰度初判结论等编号

### 工具增强

**修改文件**:
- `scripts/trace_analyzer.py`(v9.4 新增 --stack-func 参数)
  - 新增 `--stack-func` 参数,按入口函数名过滤 trace 事件
  - 新增 `_stack_contains_func` 函数,支持跨文件调用链
  - 用于阶段二 §2.4 环境依赖分析

### 阶段门检查扩展

**修改文件**:
- `scripts/stage_gate.py`(v9.4 阶段二 GATE 新增检查项)
  - 阶段 3 入口(gate 3)新增检查:动态 JS 判定 / 入口函数 / 环境依赖 / 入参个数完整性判定
  - 阶段 5 入口(gate 5)extra_files 同步扩展 stage2-output.md 检查字段

### 版本号统一

- `SKILL.md` frontmatter `metadata.version`:从 `v9.32` 更新为 `v9.4`
- `references/modules/iv8-env-patching.md`:所有 `v9.33` 更新为 `v9.4`(5 处)
- 统一用 2.x 编号(§2.0 / §2.4 等),三概念定义独立成节

### 规范符合性(skill-creator-anthropic)

- ✅ **确定性分支逻辑**:所有新增章节使用 If/Then 状态机,无模糊修饰词
- ✅ **过程穷举**:动态 JS 判定、干预性验证、验证失败排查均有明确兜底动作
- ✅ **输出定型**:stage2-output.md 模板扩展字段,强制字段非空约束
- ✅ **深函数原则**:trace_analyzer.py 新增 --stack-func 参数,调用者只需传函数名,内部吞掉 stack 解析细节
- ✅ **TOC 完整性**:iv8-env-patching.md TOC 锚点同步更新(v9.33 → v9.4)

## v9.32-5:大型参考文件添加 TOC + SKILL.md 版本号对齐(按 skill-creator-anthropic 规范)

**核心变更**:为 4 个超过 300 行的参考文件添加目录(TOC),修复 SKILL.md frontmatter 版本号与 changelog 不一致问题。

### TOC 添加(4 个文件)

| 文件 | 行数 | TOC 范围 |
|------|------|----------|
| `references/workflow/stage3.md` | 348 行 | §1-§8 + §3.1-§3.8 全部子章节(W1-W4 特征 / WASM/JSVMP/Worker 判定 / 兜底规则 / 多特征叠加 / 分支判定矩阵 / 特征扫描关键词 / Webpack Gotcha) |
| `references/workflow/stage4.md` | 565 行 | §1-§8 + §5.1-§5.5 全部子章节(分支实现指引 A/B/C/D / 方案 1/2 选择状态机 / Python 重写 / iv8 补环境调试前置门 / 验证策略) |
| `references/modules/iv8-env-patching.md` | 495 行 | 核心原则 / 心智模型 / trace 前置 / 补环境标准工作流(5 步)/ 失败止损 / 检测对抗 / 诊断 / 事件循环 / 日志分离 / API 速查 / 多线程 / 代码规范 |
| `references/modules/api-reference.md` | 349 行 | 构造参数 / 方法 / JS 侧工具 / page.load snapshot / 安装与运行环境 / 社区版限制 / 桩函数清单 / 开箱即用能力 / 内存限制(3 层) |

### TOC 锚点修正

- `references/modules/iv8-env-patching.md`:补充遗漏的 `### 指纹值参与加密运算的判定与对齐(v9.33 合并,核心)` 章节条目,将其下 4 个四级章节(识别方法 / 对齐流程 / 高频字段清单 / 排查路径)挂载到正确父级

### 版本号对齐

- `SKILL.md` frontmatter `metadata.version`:从 `v9.30` 更新为 `v9.32`,与 changelog 最新版本一致

### 规范符合性(skill-creator-anthropic)

- ✅ **大型文件可读性**:>300 行的参考文件均含 TOC,符合 skill-creator-anthropic 对长文档的导航要求
- ✅ **元数据一致性**:SKILL.md frontmatter 版本号与 changelog 保持同步
- ✅ **锚点准确性**:TOC 锚点与实际章节标题逐一核对,无悬空链接

## v9.32-4:stage5.md 重命名为 stage4.md(流程文档命名统一)

**核心变更**:将阶段四流程文档 `references/workflow/stage5.md` 重命名为 `stage4.md`,使 workflow/ 目录下流程文档命名与阶段编号一致(stage1-stage4)。

### 重命名范围

- **流程文档**:`references/workflow/stage5.md` → `references/workflow/stage4.md`
- **引用更新**:12 个文件中对 `stage5.md` 的引用全部更新为 `stage4.md`
- **保留不变**:产物文件名(`stage5-verify.md` / `stage5.json` / `stage5.manifest.json`)、阶段门编号(`--stage 5` / `gate 5`)、stage_gate.py 中的 stage 枚举值保留 `stage5` 历史命名

### 更新文件(12 个)

- `SKILL.md`:模块索引 + 禁止事项中的 stage5.md 引用
- `scripts/stage_gate.py`:reason 字段中的 stage5.md 引用
- `CODE_WIKI.md`:阶段表 + §4.3 规则层 + 命名错位注释更新
- `references/workflow/stage2-tracing.md`:不加载场景引用
- `references/workflow/stage3.md`:阶段四引用
- `references/workflow/stage1-basics.md`:阶段四引用
- `references/modules/conventions.md`:stage5.md 引用
- `references/modules/code-extraction.md`:stage5.md 引用
- `references/modules/iv8-env-patching.md`:stage5.md 引用
- `assets/templates/stage5-verify.md`:规则引用(文件名本身保留)
- `assets/templates/stage3-labels.md`:下一步引用
- `evals/evals.json`:expected_output 中的 stage5.md 引用

### 命名错位说明

流程文档已统一为 `stage4.md`,但产物文件(`stage5-*`)及阶段门编号(`--stage 5`)保留历史命名,源于 v9.26 合并原阶段四/五。CODE_WIKI.md §3.1 已更新注释说明此错位。

## v9.32-3:references/ 目录结构统一(按 skill-creator-anthropic 规范)

**核心变更**:统一 `references/` 目录结构,消除 workflow/modules 语义混乱。workflow/ 放阶段流程主文档(1-4),modules/ 放深度参考文档(子模块 + 通用参考)。

### 文件迁移

| 文件 | 原路径 | 新路径 | 原因 |
|------|--------|--------|------|
| stage3.md | references/modules/ | references/workflow/ | 阶段三主文档,应在 workflow/ |
| stage5.md | references/modules/ | references/workflow/ | 阶段四主文档,应在 workflow/ |
| api-reference.md | references/ | references/modules/ | 深度参考文档,归入 modules/ |
| conventions.md | references/ | references/modules/ | 深度参考文档,归入 modules/ |
| webpack.md | references/modules/ | (删除) | 批4 遗留残留,内容已并入 stage2-tracing.md |

### 迁移后结构

```
references/
├── workflow/                 # 阶段流程主文档(1-4) + 示例集
│   ├── stage1-basics.md      # 阶段一
│   ├── stage2-tracing.md     # 阶段二
│   ├── stage3.md             # 阶段三
│   ├── stage5.md             # 阶段四(命名错位保留)
│   └── examples.md           # 示例集
└── modules/                  # 深度参考文档(子模块 + 通用参考)
    ├── code-extraction.md    # 扣代码与本地模拟
    ├── iv8-env-patching.md   # iv8 补环境
    ├── api-reference.md      # iv8 API 速查
    └── conventions.md        # 适用范围 + 契约 + 方法论 + 代码规范
```

### 引用更新(约 40 处)

- **SKILL.md**:stage3/stage5 路径 modules→workflow(9 处)+ api-reference/conventions 路径 references→references/modules(8 处)
- **references/workflow/stage2-tracing.md**:stage3/stage5 改同目录引用(6 处)+ api-reference/conventions 改 ../modules/(3 处)
- **references/workflow/stage5.md**:api-reference 改 ../modules/(3 处)
- **references/workflow/examples.md**:conventions 改 ../modules/(1 处)
- **references/modules/iv8-env-patching.md**:api-reference/conventions 改同目录引用(5 处)
- **references/modules/code-extraction.md**:api-reference 改同目录引用(1 处)
- **references/modules/conventions.md**:SKILL.md 改 ../../(1 处)+ stage3/stage5 改 ../workflow/(1 处)+ iv8-env-patching 改同目录(1 处)
- **references/modules/api-reference.md**:iv8-env-patching 改同目录(1 处)
- **CODE_WIKI.md**:目录树 + §3.1 阶段表 + §4.3 规则层章节全面更新(约 10 处)
- **assets/templates/stage3-labels.md**:stage3/stage5 改 ../workflow/(6 处)
- **assets/templates/stage5-verify.md**:stage5 改 ../workflow/(5 处)+ api-reference 改 ../modules/(1 处)

### 规范符合性(skill-creator-anthropic)

- ✅ **Progressive Disclosure**:workflow/ 主文档 + modules/ 深度内容,层级清晰
- ✅ **Reference files clearly**:目录命名语义化,workflow=流程,modules=模块深度内容
- ✅ **guidance on when to read them**:SKILL.md 模块索引明确标注"何时用 / 必读时机"

### 验证结果

- ✅ 无 `modules/stage3.md` / `modules/stage5.md` / `modules/webpack.md` 残留引用
- ✅ 无 `references/api-reference.md` / `references/conventions.md` 残留引用
- ✅ 无 `../api-reference.md` / `../conventions.md` / `../modules/stage3.md` / `../modules/stage5.md` 残留引用
- ✅ 无 `modules/iv8-env-patching.md` / `modules/api-reference.md` / `modules/conventions.md` 跨目录错误引用
- ✅ 目录结构统一:references/ 下仅 workflow/ 和 modules/ 两个子目录

## v9.32-2:stage2-tracing.md 审查修复(按 skill-creator-anthropic 规范)

**核心变更**:对 `references/workflow/stage2-tracing.md` 进行多维度审查,修复 5 个 P0 悬空引用 + 2 个 P1 结构问题 + 3 个 P2 一致性问题。

### P0 严重问题修复(5 处悬空/错误引用)

- **L245**:`depend-js-content.md`(文件不存在)→ `[depend-js-guide.md](../../assets/samples/depend-js-guide.md)`(L223 已正确引用,统一)
- **L17 / L441**:`§2.3.3 "iv8 字符串表拉取"` 锚点错误(§2.3.3 实际是 "eval/Function 递归去壳")→ `§2.3.9 "iv8 字符串表拉取"`(配合 P1 #7 章节调整)
- **§2.3.5 内 3 处**:`§2.3.6 "iv8 字符串表拉取"` → `§2.3.9 "iv8 字符串表拉取"`(同上)
- **§2.3.6 内 1 处**:"下方'iv8 字符串表拉取'" → `§2.3.9 "iv8 字符串表拉取"`(归属调整后表述修正)
- **L710**:`[SKILL.md](../../SKILL.md) "载体清晰度判定"`(SKILL.md 无此小节)→ `[stage3.md](../modules/stage3.md) §3.1.2 "判定流程"`(载体清晰度最终判定所在)
- **L773**:`[SKILL.md](../../SKILL.md) "产物持久化"小节`(SKILL.md 无此小节)→ `[conventions.md](../conventions.md) §2.3 "产物持久化(强制)"`

### P1 结构问题修复

- **章节归属调整**:`#### iv8 字符串表拉取` 从 §2.3.6 "去壳后验证与分层回退纠错" 下移出,提升为独立 `### 2.3.9 iv8 字符串表拉取(跨 2.1/2.3 共用)`。原归属混乱(自述"在 2.1 执行"却放在 2.3.6 去壳后验证下),是 L17/L441 错引 §2.3.3 的根因。独立成节后语义清晰,防止未来再错引。
- **添加完整 TOC**:829 行超过 skill-creator-anthropic 规范 300 行阈值,在文件开头添加完整目录(覆盖 §1-§9 + 2.1.1-2.1.5 + 2.3.0-2.3.9 所有子章节),符合 "For large reference files (>300 lines), include a table of contents" 规范。
- **§5 流程概览同步**:补 2.3.9 到流程概览列表。

### P2 一致性问题修复

- **版本号统一**:L63 `### 加密点定义(v9.33 新增)` + L94 `Gotcha 7(加密点判定三原则,v9.33 新增)` → 均改为 `v9.32`(与 changelog 最新版本 + SKILL.md frontmatter v9.30 对齐,v9.33 是未发布版本)。同步更新 SKILL.md L44 锚点 `#加密点定义v933-新增` → `#加密点定义v932-新增` + TOC 锚点。
- **章节编号风格跨文件不统一**(stage2-tracing.md 用 §1-§9 + 2.1.x,stage1-basics.md 用 1.x 无 §):本文件内编号已统一,跨文件统一属独立审查任务范围。

### 修改文件

- `references/workflow/stage2-tracing.md`:13 处编辑(1 处 depend 引用 + 5 处 §2.3.x 锚点 + 2 处 SKILL.md 悬空引用 + 1 处章节迁移 + 1 处 TOC 添加 + 1 处流程概览补全 + 2 处版本号)
- `SKILL.md`:1 处锚点同步(v9.33 → v9.32)

### 验证结果

- ✅ 无 `depend-js-content.md` / `§2.3.3 "iv8` / `§2.3.6 "iv8` / `v9.33` / `SKILL.md "载体清晰度判定"` / `SKILL.md "产物持久化"` 残留引用
- ✅ 章节完整:§1-§9 + 2.1.1-2.1.5 + 2.3.0-2.3.9 全部存在
- ✅ 所有外部引用路径正确(stage1-basics.md / stage3.md / stage5.md / conventions.md / api-reference.md / code-extraction.md / examples.md / depend-js-guide.md / scripts/*)
- ✅ SKILL.md L84/L176 引用的 "阶段门阻断规则" 章节存在(L11)

## v9.32

**核心变更**:按 skill-creator-anthropic 规范继续优化文件结构(批 4:阶段二三合一)。将原分散的 3 个阶段二文档(stage2-tracing.md / shell-removal.md / webpack.md)合并为单一主文档 `references/workflow/stage2-tracing.md`,并将非决策性示例(depend 调整循环诊断 / 标准B 抽样分层 / require.c 注入模板代码 / 常见误判清单 / 大文件处理规则)外移到 `references/workflow/examples.md` 的"阶段二示例"章节。决策规则、If/Then 分支、⛔ 安全边界、GATE 契约全部保留在主文档。

**设计依据**:文件分散导致 AI 加载阶段二时需打开 3 个文件且跨文件跳转,违反"深函数导向"原则。合并后单一入口,复杂度隐藏在文件内部,调用者(阶段二启动时的 AI)只需面对一个干净的主文档。决策性反例内嵌主文档 §4 Gotchas,辅助示例外移 examples.md,符合"AI 无法自主判断则内嵌"原则。

### v9.32-1:阶段二三合一(stage2-tracing.md + shell-removal.md + webpack.md → workflow/stage2-tracing.md)

**修改文件**:
- 新建:`references/workflow/stage2-tracing.md`(合并 3 文件,829 行,保留全部决策规则 + If/Then + ⛔ 安全边界 + GATE 契约)
- 修改:`references/workflow/examples.md`(追加"阶段二示例"章节,示例 7-11)
- 删除:`references/modules/stage2-tracing.md`、`references/modules/shell-removal.md`、`references/modules/webpack.md`

**合并内容映射**:
- 原 stage2-tracing.md §1-§8 → 新主文档 §1-§8(完整保留,前置条件/Gotchas/产物/GATE/回执不变)
- 原 shell-removal.md §0 壳定义 → 新主文档 §2.3.0(决策依据,5 个子章节)
- 原 shell-removal.md 壳特征识别/eval-Function 递归去壳/分层回退纠错/去壳终止标准/反调试干扰 → 新主文档 §2.3.2/§2.3.3/§2.3.6/§2.3.7/§2.3.8
- 原 shell-removal.md 常见误判 → examples.md 示例 10(非决策性,外移)
- 原 webpack.md 全部内容 → 新主文档 §2.3.5(Webpack 模块边界提取,含静态/动态路径 + 何时先拆 bundle)
- 原 webpack.md require.c 注入模板代码 → examples.md 示例 9(代码模板,外移)
- 原 stage2-tracing.md depend 调整循环详细诊断 → examples.md 示例 7(诊断决策树,外移)
- 原 stage2-tracing.md 标准B 抽样数量分层 → examples.md 示例 8(详细规则,外移)
- 原 shell-removal.md 大文件处理注意 → examples.md 示例 11(参考规则,外移)

**引用同步更新**(12 个文件):
- `SKILL.md`:四阶段工作流表阶段二路径合并 + 模块索引 3 行→2 行 + P0 加密点定义锚点路径 + 2 处 Fallback/降级路径引用 + 修复 stage1.md 残留(batch 3 遗留)
- `references/modules/stage3.md`:3 处 stage2-tracing.md 引用路径(同目录→跨目录)
- `references/modules/stage5.md`:1 处 webpack.md 引用 → stage2-tracing.md §2.3.5
- `references/modules/code-extraction.md`:4 处 stage2-tracing.md + 2 处 webpack.md 引用路径
- `assets/templates/stage2-output.md`:3 处 ../modules/stage2-tracing.md → ../workflow/stage2-tracing.md
- `references/workflow/stage1-basics.md`:无变更(stage2-tracing.md 同目录,引用仍有效)
- `evals/evals.json`:12 处 prose mentions(shell-removal.md / webpack.md → stage2-tracing.md)
- `CODE_WIKI.md`:目录树 + 阶段工作流表 + 阶段流程文档表 + 能力工具表 + 顶层通用文档表 + 引用关系表 + 脚本引用表 + 流程链式图(综合反映 batch 3+4 实际结构)

**未变更**(保留历史):
- `changelog.md` 历史 v9.5-v9.31 条目中的旧路径引用(历史记录,不修改)

## v9.31

**核心变更**:基于腾讯防水墙 tdc.js 逆向实战反馈,修复 5 个问题——动态生成 JS 场景未覆盖(最严重,P0)、内存限制规范与实战节奏脱节、wrapNative 规则一刀切、指纹对齐流程对 JSVMP 失效、trace 价值被高估。问题 5(快速通道)经用户确认不修复,保持现有阶段门严格度。同时合并记录 v9.31 早期已落地的 §5.4.2 指纹占位规则、§5.5.3 非确定性输出结构对齐、§5.5.4 混合实现验证规则。

**设计依据**:实战中 tdc.js 按 session 动态生成(变量名/内嵌密钥/文件大小每次不同),Agent 用本地缓存旧文件跑 iv8,导致 collect 环境数据完全错位,卡 2 天靠偶然对比文件 hash 才发现根因。同类场景覆盖极验 gcaptcha4.js、腾讯前端风控 JS。同时 Agent 跳过内存限制(违反 P0)、诊断 patch 全部裸函数未 wrapNative、JSVMP 场景 grep 不到指纹字段导致漏对齐、trace value 为 [Object Proxy] 仍当作真实值用。本版本按 skill-creator-anthropic 规范,用渐进式披露组织修复:SKILL.md 只放 P0 禁止事项,详细判定流程放对应模块文件。

### v9.31-1:stage5.md 新增 §5.4.4 动态生成 JS 识别与处理(P0,最严重)

**修改文件**:`references/modules/stage5.md` §5.4.4(新增)

**问题**:tdc.js 按 session 动态生成,Agent 用本地缓存旧文件跑 iv8,加密输出必然错位(变量名/密钥不匹配),无法通过对齐修复。skill 原流程假设"JS 文件是静态的",未覆盖动态生成场景。

**改动**:新增 §5.4.4,定义 4 特征判定(同 URL 两次 hash 不同 / 含 32 位随机变量名 / 文件大小每次不同 / 响应含 Set-Cookie),命中即判定动态生成,必须当次请求下载(带 session cookie,依赖前置接口时先调前置接口),禁止用本地旧文件。跳过判定 → P0 违规。在 §5.4.0 前置门之前执行。

### v9.31-2:api-reference.md 内存限制分级 + 第 1 层模板修正

**修改文件**:`references/api-reference.md` "内存限制"章节

**问题**:v9.23 原规则"所有场景必须第 1 层"对开发期过重(第 2 层 100+ 行 ctypes 对快速验证不现实),第 1 层模板用裸 `ctx = iv8.JSContext()` 违反 code-conventions.md §1.1 强制上下文管理器。

**改动**:新增"分级判定"章节(开发期 vs 生产期),开发期必须第 1 层(with + gc)、生产期必须第 2 层(子进程 + Job Object)。第 1 层模板修正为 `with` 语句,与 §1.1 一致;原裸 ctx 模板标注"禁止"。强制约束章节同步修订。

### v9.31-3:iv8-env-patching.md wrapNative 规则场景分级

**修改文件**:`references/modules/iv8-env-patching.md` "wrapNative 规则" + `references/code-conventions.md` §2.3

**问题**:原规则"补丁覆盖 API 就必须 wrapNative"未区分诊断/生产、JSVMP/静态混淆,对诊断场景过重。

**改动**:wrapNative 规则改为场景分级——生产 patch 必须用;诊断 patch + JSVMP 目标允许豁免(需在 stage5-verify.md §5.3 记录 patch 列表/豁免理由/风险提示);诊断 patch + 静态混淆必须用;豁免后验证失败怀疑 toString 检测时兜底补 wrapNative。code-conventions.md §2.3 同步引用。

### v9.31-4:iv8-env-patching.md 指纹对齐识别方法新增 JSVMP 路径

**修改文件**:`references/modules/iv8-env-patching.md` "识别方法"

**问题**:原条件 2"grep 搜 navigator.userAgent 确认是否在加密函数作用域内"对 JSVMP 失效(字节码不可读,grep 不到明文 API 名),导致 JSVMP 场景漏判"指纹参与加密"。

**改动**:识别方法新增条件 3(JSVMP 专用)——目标 JS 是 JSVMP + trace 显示该文件读取了指纹字段 → 假设所有被 trace 记录读取的指纹字段都参与加密(保守策略),必须全部用 HAR 真实值对齐。原条件 3 改为条件 4。

### v9.31-5:stage1.md + trace-analysis.md trace 定位修订为辅助证据

**修改文件**:`references/modules/stage1.md` Step 4 + `references/modules/trace-analysis.md` §3.2

**问题**:skill 把 trace 作为"环境指纹采集"硬输入,但 trace value 字段常为 [Object Proxy](Gotcha 4 已承认),实战中靠 HAR + 当次请求响应就能成功,trace 几乎没用上。

**改动**:stage1.md Step 4 明确 trace 为"辅助证据"——HAR 请求头/响应体 + 当次请求响应为主证据,trace 提供调用清单但 value 不可靠;trace 缺失不阻断流程;trace value 为 [Object Proxy] 时仅用 op 字段,value 从 HAR 提取。trace-analysis.md §3.2 补充:value 字段不可作为真实指纹值来源,仅用 op 字段,真实值从 HAR 提取。

### v9.31-6(早期已落地,本次记录):stage5.md §5.4.2 + §5.5.3 + §5.5.4

**修改文件**:`references/modules/stage5.md` §5.4.2 / §5.5.3 / §5.5.4(之前会话已修改,本次补 changelog)

**改动**:
- §5.4.2 指纹值对齐与占位规则:指纹值进入加密输入必须用 HAR 真实值,禁止占位;不进入加密输入允许占位但需标注 + 至少 1 个确定性参数佐证
- §5.5.3 非确定性输出结构对齐细则:消除"结构一致""长度匹配""业务正确响应"三处歧义
- §5.5.4 混合实现验证规则:混合实现(部分确定性 + 部分非确定性)的验证规则

### SKILL.md P0 禁止事项新增 2 条

**修改文件**:`SKILL.md` P0 硬约束

**改动**:
- 新增"禁止用本地缓存文件跑动态生成 JS"(引用 stage5.md §5.4.4)
- 新增"禁止 iv8 不设内存限制"(引用 api-reference.md "内存限制",开发期第 1 层 / 生产期第 2 层)

### iv8-env-patching.md 前置门同步

**修改文件**:`references/modules/iv8-env-patching.md` "补环境标准工作流"

**改动**:在原 v9.30 前置门(算法确认 → 明文对比 → 环境检测)之前,新增 v9.31 JS 来源检查前置门(引用 stage5.md §5.4.4)。

### 验证
- `uv run scripts/schema_validator.py --self-test` → PASS
- 本次修改仅涉及文档(references/ + SKILL.md + changelog.md),不涉及 scripts/ 和 assets/templates/,不影响 stage_gate.py 硬门校验

### 未修复(用户确认)
- 问题 5(快速通道):用户确认不修复,保持现有阶段门严格度。已知单一接口 + 加密点位已知 + 载体形态无歧义场景仍需走完整 4 md + 4 json + 5 gate 流程

## v9.30

**核心变更**:基于网易易盾 collect 参数逆向实战反馈,修复 5 个问题——工作流顺序缺乏强制约束(最严重)、诊断脚本生成缺乏收敛条件、Windows 工具兼容性 bug、内置工具能力边界未文档化、过早创建文件反模式。问题 2(加密点定义)经用户确认不修复,保持"入口函数=加密点"定义。

**设计依据**:用户的三步策略(算法 → 明文 → 环境)清晰,但 AI 凭经验跳到第三步"环境参数对比",列一堆 navigator/screen/canvas 字段(明文组成部分),5 个诊断脚本均无效;用户纠正后读源码,5 分钟找到 TEA delta 常量 2654435769。本版本把"算法确认 → 明文对比 → 环境检测"固化为强制状态机,并修复 Windows 环境下的工具兼容性 bug。

### v9.30-1:stage5.md §5.4 新增"iv8 调试前置门"(P0)

**修改文件**:`references/modules/stage5.md` §5.4.0(新增)

**问题**:Agent 收到"分析加密参数"任务后,跳过"读源码定位加密点"直接进入"环境参数对比",浪费轮次且抓不住核心。

**改动**:
- §5.4 新增 §5.4.0 "iv8 调试前置门"(强制)
- 3 步前置检查(顺序不可调):
  - Step 1 算法确认:grep 搜索已知加密算法常量(TEA delta 2654435769 / AES S-box / MD5 K 值 / SM4 FK/CK / SHA-256 K 值 / RSA)
  - Step 2 加密前明文对比:hook 入口函数 dump 浏览器 vs iv8 明文
  - Step 3 环境检测:仅当 Step 2 明文一致密文不同时才执行
- 跳过 Step 1/2 → P0 违规,产物无效

### v9.30-2:SKILL.md P0 禁止事项新增 2 条

**修改文件**:`SKILL.md` P0 硬约束

**改动**:
- 新增"禁止跳过 iv8 调试前置门直接进入环境参数对比"(引用 stage5.md §5.4.0)
- 新增"禁止在未穷尽现有工具(Grep/Read/Python 内联)前创建诊断脚本"(引用 code-conventions.md §6.1)

### v9.30-3:code-conventions.md 新增 §6.1 + §7 + §8 + §9

**修改文件**:`references/code-conventions.md`

**改动**:
- §6.1 文件创建前置检查(P0):Write 前必须依次尝试 Grep → Read → `python -c`,三者均无法满足才允许创建文件;例外:交付代码/产物文件/depend.js
- §7 诊断脚本规范:创建前必须写明假设 + 通过/失败判据 + 预期结论;命名 `_diag_<目标>.py`;输出单一结论;验证后删除
- §8 跨平台工具使用规范(P0):禁止 wc/grep/sed/awk/find/xargs;禁止内联复杂 PowerShell 表达式;允许 git/uv/npm/node;附跨平台命令对照表
- §9 内置工具能力边界(P1):Read 单行大文件截断(~30KB)+ Grep count 模式误导 + Glob 大目录超时;附 If/Then 应对策略

### v9.30-4:iv8-env-patching.md + shell-removal.md 同步更新

**修改文件**:
- `references/modules/iv8-env-patching.md`
- `references/modules/shell-removal.md`

**改动**:
- iv8-env-patching.md "补环境标准工作流"顶部增加前置门引用(指向 stage5.md §5.4.0)
- iv8-env-patching.md "诊断:定位环境探测点"的 `grep -E` 示例改为 Python `re.search`(跨平台,引用 code-conventions.md §8)
- shell-removal.md "iv8 字符串表拉取"增加大文件处理注意(Read 截断 + Grep count 误导,引用 code-conventions.md §9)

### 验证

- `uv run scripts/schema_validator.py --self-test` → PASS(13+ 用例自检通过)
- 本次修改仅涉及文档(references/ + SKILL.md + changelog.md),不涉及 scripts/ 和 assets/templates/,不影响 stage_gate.py 硬门校验

### 未修复(用户确认)

- 问题 2(加密点定义):用户确认不修复,保持"入口函数=加密点"定义。问题 1 的前置门通过"算法确认 + 明文对比"步骤间接解决"跳过算法定位"问题,不依赖加密点概念区分

## v9.29

**核心变更**:删除方案 1/2 判定中的"魔改"概念,只看"可静态还原"。基于网易易盾 v3/check 实战反馈——Agent 误判"参数化自定义"为"魔改"跳过方案 1,实际方案 1 用 Node.js 手写 200 行即跑通。

**设计依据**:skill 是给 AI 逆向的说明书,去除 AI 已知的能力,保留的是 AI 不会主动决定的判断点。"魔改"是模糊概念,AI 无法确定性判定;参数化自定义(常量可提取 + 逻辑可重写)不阻碍方案 1。

### v9.29-1:stage5.md §4 新增 Gotcha 10 + Gotcha 11

**修改文件**:`references/modules/stage5.md` §4 Gotchas

**问题**:Agent 看到"自定义轮函数/自定义 S 盒/自定义操作序列"直接判定为"魔改 → 方案 2",跳过方案 1。且方案 1 实现时误用"加载完整 JS + hook 捕获内部函数"(方案 2 思路),因 IIFE 闭包单体反复失败。

**改动**:
- 新增 Gotcha 10:参数化自定义误判"魔改"→ 跳方案 1。明确方案 1 判定标准只有两条:(1) 逻辑可读懂(2.1+2.3 完成后);(2) 算法代码路径不调用浏览器 API 产出密钥材料。附网易易盾 v3/check 实战教训。
- 新增 Gotcha 11:方案 1 实现策略——提取重写,禁止加载完整 JS + hook。正确做法:理解加密流程 → 提取所有常量 → 用 Node.js/Python 独立重写。禁止在方案 1 场景下用 iv8/Node.js 加载完整 JS + hook 捕获内部函数。

### v9.29-2:stage5.md §5.2.1 方案 1 必试清单简化

**修改文件**:`references/modules/stage5.md` §5.2.1

**问题**:方案 1 必试清单原为 3 条件(逻辑可读懂 + 算法代码路径不调用浏览器 API + 标准算法/无魔改),第 3 条"标准算法/无魔改"是模糊判定,AI 无法确定性执行。

**改动**:
- 删除第 3 条件"标准算法/无魔改",简化为 2 条件:逻辑可读懂 + 算法代码路径不调用浏览器 API 产出密钥材料
- 删除"标准算法清单"段落 + "魔改算法不算标准算法"句
- 新增"参数化自定义不阻碍方案 1"注释(引用 Gotcha 10)

### v9.29-3:stage5.md §3/§5.2.2/§5.2.3/§5.3.1 同步清理"魔改"

**修改文件**:`references/modules/stage5.md`

**改动**:
- §3 L33:"重度魔改" → "重度混淆"
- §5.2.2:删除"标准算法清单"段落 + "魔改算法不算标准算法"句,保留浏览器 API 判定 block
- §5.2.3 L312:"重度魔改" → "重度混淆"
- §5.3.1 Step 1 L343-344:"识别标准算法 + 排除魔改算法" → "理解加密流程 + 提取常量 + 识别算法结构(标准算法/参数化自定义算法,均可走方案 1)"

### v9.29-4:SKILL.md 删除"禁止把魔改算法当标准算法走方案 1"

**修改文件**:`SKILL.md` L151(原 P1 流程约束)

**问题**:"魔改"概念已删除,该禁令失去判定基础。

**改动**:删除整行 `⚠️ 禁止把魔改算法当标准算法走方案 1(改 S 盒的 AES/自定义变形都不算标准)。`

### v9.29-5:计划外文件"魔改"引用同步清理(用户确认)

**修改文件**:5 个文件 7 处

**问题**:v9.29 删除 stage5.md "魔改"概念后,其他文件的方案 1/2 判定场景仍残留"魔改"引用,导致不一致。

**改动**:
- `assets/templates/stage5-verify.md` L20:模板示例"AES-CBC 标准算法,无魔改" → "AES-CBC,逻辑可读懂(2.1+2.3 完成后)"
- `assets/templates/code_extraction.py` L21/L28/L32:模板注释"魔改算法" → "算法不可静态还原"
- `references/modules/iv8-env-patching.md` L386:回溯检查"JSVMP/重度魔改" → "JSVMP/重度混淆"
- `references/modules/code-extraction.md` §5.1 L17:概述表"标准算法+无魔改+逻辑可读懂" → "逻辑可读懂"
- `evals/evals.json` id17 L103:"魔改算法走方案 1 试跑失败则降级方案 2" → "方案 1 试跑失败则降级方案 2(见 stage5.md §5.3.3)"

**保留未改**(非方案 1/2 判定场景):
- `stage3.md` L329 / `shell-removal.md` L19 / `evals.json` id33:"OB 壳(含标准配置与魔改变种)"——描述混淆器配置变体,非算法判定
- `code-extraction.md` §5.2 L93:计划明确"§5.2/§5.3 保持不动"
- `changelog.md`:历史记录不可修改

## v9.28

**核心变更**:按 agent-skills-creation 规范(ch02/ch04/ch05)进行结构合规性修复 + 安装版同步。

### v9.28-1:ch02 目录结构合规 — 模板迁移到 assets/(P1-1)

**修改文件**:`assets/templates/` 新建 + 11 个模板文件从 `references/templates/` 迁移 + 6 个引用文件路径更新

**问题**:ch02 规范明确 `assets/` 用于"Templates, images, data files",`references/` 用于"Additional documentation"。原结构模板放在 `references/templates/`,违反目录用途定义。

**改动**:
- 创建 `assets/templates/` 目录
- 迁移 9 个模板文件(删除废弃的 stage4-scheme.md 和 minimal_scope.py)
- 更新 15 处引用路径:`references/templates/` → `assets/templates/`,`../templates/` → `../../assets/templates/`
- 涉及文件:SKILL.md(2 处)、har-analysis.md(2 处)、iv8-env-patching.md(3 处)、stage3.md(5 处)、stage1.md(2 处)、stage5.md(1 处)

**同步恢复**:模板文件在迁移过程中因命令误操作被意外删除,从安装版(v9.19)恢复后重新应用 v9.20-v9.27 的所有改动(stage5-verify.md 8 处、stage3-labels.md 7 处、stage2-output.md 3 处)。

### v9.28-2:ch02 引用断链修复(P1-2)

**修改文件**:`references/modules/stage2-tracing.md` L506

**问题**:L506 引用 `[SKILL.md](../SKILL.md)` 从 `references/modules/` 解析为 `references/SKILL.md`(不存在),应为 `../../SKILL.md`。

**改动**:`../SKILL.md` → `../../SKILL.md`(与同文件 L43 一致)。

### v9.28-3:ch02 compatibility 字段语义修复(P1-3)

**修改文件**:`SKILL.md` frontmatter L4

**问题**:compatibility 字段包含文件引用(`references/api-reference.md`、`references/code-conventions.md`),ch02 规范定义 compatibility 为"环境要求",文件引用应放在 body。

**改动**:compatibility 仅保留 Python 版本/OS/依赖信息,文件引用部分删除(body 中模块索引已存在)。

### v9.28-4:安装版同步

**修改文件**:`e:\temp\.trae\skills\web-reverse-iv8\` 全部文件

**问题**:安装版 v9.19 落后开发版 8 个版本(v9.20-v9.27),且包含已废弃的 stage4.md / stage4-scheme.md / minimal_scope.py。

**改动**:
- 删除安装版废弃文件:stage4.md / stage4-scheme.md / minimal_scope.py / references/templates/ 目录
- 用开发版全部文件覆盖安装版:SKILL.md / changelog.md / evals/ / scripts/ / references/ / assets/
- 安装版版本号:v9.19 → v9.28

### 规范审查结果(agent-skills-creation ch02/ch04/ch05)

| 维度 | 评分 | 说明 |
|------|------|------|
| ch02 合规度 | 7.5→9/10 | 修复 P1-1(模板迁移)/ P1-2(断链)/ P1-3(compatibility 清理)后提升 |
| ch04 合规度 | 9.5/10 | Gotchas/模板/Checklist/Validation loops 全部高质量,无违规项 |
| ch05 合规度 | 9/10 | description 质量高,5 类 near-miss 显式排除,仅轻微问题 |
| 总体合规度 | 8.7→9.2/10 | P1 修复后提升 |

### 未修复项(P2,可选优化)

| 项 | 原因 |
|----|------|
| references/modules/ 扁平化 | 11 个模块文件,保留 modules/ 有助于组织;路径深度增加但不影响 agent 认知 |
| evals.json 区分 train/validation | 60/40 split,防止 overfitting(当前 50 用例无 overfitting 风险) |
| description 去掉 `_initiator.stack` | 边界情况,用户可能直接提到此字段,保留有助于精确触发 |

## v9.27

**核心变更**:补充"指纹值参与加密运算"场景的系统化处理规范。用户反馈:iv8 内置了浏览器环境(200+ 指纹字段),但有些网站把指纹值(UA/href/cookie/screen 等)参与加密参数运算——不是 anti-bot 检测(是 Chrome 就行),而是具体值必须与 HAR 真实值完全一致。skill 原本仅简短提及(iv8-env-patching.md L340 一句话),缺少识别方法、对齐流程和排查路径。

### v9.27-1:iv8-env-patching.md 新增「指纹值参与加密运算」小节

**修改文件**:`references/modules/iv8-env-patching.md`

**问题**:iv8 内置浏览器环境,但"指纹被检测(anti-bot)"和"指纹值参与加密运算"是两种完全不同的场景。前者 iv8 默认指纹通常能通过;后者要求 iv8 的指纹值与 HAR 真实值完全一致(因为指纹值进入了加密算法的输入)。skill 原本只在排查清单 L340 简短提及,缺少系统化指引。

**改动**:在"第三步:指纹策略"后新增"第三步补:指纹值参与加密运算"小节,包含:
- **关键区分**:用途 A(指纹被检测,iv8 默认可过)vs 用途 B(指纹值参与加密运算,必须与 HAR 真实值一致)
- **识别方法**(3 个条件):trace stats 显示加密路径读取指纹字段 / 脱壳代码中加密函数体内直接读取指纹字段 / 方案 2 跑通后加密参数对不齐且排除了其他前置参数
- **对齐流程**(4 步):HAR 提取真实值 → trace 补充 → environment 覆盖 → ctx.eval 验证对齐
- **高频参与加密运算的指纹字段清单**(7 个):UA / location.href / Cookie / Referer / screen 分辨率 / Canvas 指纹 / WebGL 指纹
- **排查路径**(4 步):遗漏字段 / environment 路径错误 / 运行时被修改 / Canvas/WebGL 高难度场景

**同步更新**:
- iv8-env-patching.md 排查清单 L340 "检查指纹对齐" 增加引用 "详见第三步补:指纹值参与加密运算"
- stage5-verify.md 参数溯源表后新增 "⚠️ 指纹值参与加密运算检查" 提示框
- SKILL.md 模块索引表 iv8-env-patching.md 关键词反查列补充 "指纹参与加密 / environment 覆盖"

### 设计依据

- **agent-skills-creation ch04 - Gotchas Are Highest Value**:指纹值参与加密运算是高频踩坑点(用户实战反馈),Gotcha 防护栏必须系统化
- **确定性分支逻辑**:识别方法用 3 个显式条件(If/Then),对齐流程用 4 步状态机,排查路径用 4 步顺序检查,无模糊措辞
- **关键区分原则**:两种指纹用途(被检测 vs 参与加密)处理方式完全不同,必须显式区分,避免 Agent 误判

### 验证

- iv8-env-patching.md:新增"第三步补"小节(识别 + 对齐 + 清单 + 排查 4 部分)
- stage5-verify.md:参数溯源表后增加"指纹值参与加密运算检查"提示框
- SKILL.md:版本 v9.26 → v9.27;关键词反查列补充"指纹参与加密 / environment 覆盖"

## v9.26

**核心变更**:五阶段架构合并为四阶段架构(方案 A 彻底合并)。原阶段三(载体形态判定)+ 原阶段四(决策树分支执行,纯判定)合并为新阶段三(载体形态判定与分支选择);原阶段五(本地模拟与验证)上移为新阶段四。合并动机:原阶段四仅做分支选择(纯判定,无实现),作为独立阶段过重——分支选择是阶段三载体形态判定的自然延伸(同一判定矩阵的输出),独立成阶段导致 stage_gate 多一层门控 + 多一个产物文件(stage4-scheme.md) + Agent 多一次跨阶段跳转,认知负担与价值不匹配。合并后:阶段三产出"载体形态判定 + 分支选择"一体结论,阶段四直接消费结论做实现,流程更紧凑。

### v9.26-1:stage3.md 重写(合并原 stage4 §4.1 分支判定矩阵 + §4 Gotchas)

**修改文件**:`references/modules/stage3.md`(重写)、`references/modules/stage4.md`(删除)

**改动**:
- 标题改为"阶段三:载体形态判定与分支选择"
- §3 负责项扩展:新增"分支选择(A/B/C/D)"+"分支选择依据"
- §4 Gotchas 合并去重:原 stage3 Gotcha 5 + stage4 Gotcha 4 合并为 7 条
- §5 Step 3 扩展:标签到分支映射 + 分支选择 + 写分支选择依据
- 新增 §3.6.1 分支判定矩阵(从 stage4 §4.1 迁移)
- 新增 §3.6.2 分支选择依据(从 stage4 §4.1 迁移)
- §6 产物扩展强制字段(分支选择 + 分支选择依据)
- §7 GATE 改为 `--stage 4` 检查 stage3-labels.md
- §8 回执改为"进入阶段四"
- stage4.md §4.2-§4.5(分支实现指引)迁移到 stage5.md §5.1 附录

### v9.26-2:stage5.md 重写(保留文件名,标题改阶段四 + 接收分支实现指引)

**修改文件**:`references/modules/stage5.md`(重写,保留文件名)

**改动**:
- 标题改为"阶段四:本地模拟与验证"
- §1 使用时机改为"阶段三 GATE 通过后进入阶段四"
- §2 前置条件 stage4-scheme.md 改为 stage3-labels.md
- 新增 §5.1 附录"分支实现指引"(从 stage4.md §4.2-§4.5 迁移):
  - §5.1.1 分支 A(WASM)
  - §5.1.2 分支 B(JSVMP,含 Recovery Level 表)
  - §5.1.3 分支 C
  - §5.1.4 分支 D(Worker)
- 所有"阶段五"改为"阶段四"
- §7 GATE `--stage 6` 改为 `--stage 5`

### v9.26-3:stage_gate.py 阶段门硬编码改造

**修改文件**:`scripts/stage_gate.py`

**改动**:
- `_STAGE_RULES` key 5 删除(原 stage4-scheme.md 检查)
- `_STAGE_RULES` key 6 改为 key 5(stage5-verify.md 检查)
- key 4 的 required_fields 扩展:新增"分支选择"+"分支选择依据"
- key 4 的 fallback_stage 由 5 改为 4
- extra_files 删除 stage4-scheme.md 条目
- argparse choices 由 [2,3,4,5,6] 改为 [2,3,4,5]
- 注释中 stage6 改为 stage5
- 语法检查通过(`python -c "import ast; ast.parse(...)"` 输出 OK)

### v9.26-4:SKILL.md 四阶段表更新

**修改文件**:`SKILL.md`

**改动**:
- version v9.25 → v9.26
- `{2,3,4,5,6}` → `{2,3,4,5}`
- 检查字段说明:删除"阶段 5 入口:stage4-scheme.md",合并到阶段 4 入口(扩展为含"分支选择""分支选择依据")
- "五阶段工作流"→"四阶段工作流",删除原阶段四行,原阶段五行改为阶段四行
- 模块索引表:删除 stage4.md 行,合并描述
- P0 禁令"阶段二→三→四→五"改为"阶段二→三→四"
- 任务失败交付物触发条件"阶段五验证不通过"改为"阶段四验证不通过"
- 任务完成前产物整理:5 个文件改为 4 个文件(删除 stage4-scheme.md),`--stage 6` 改为 `--stage 5`

### v9.26-5:references/ 顶层文件 + modules/ 子模块同步更新

**修改文件**(10 个):
- `references/stage-gate-rules.md`:`{2,3,4,5,6}` → `{2,3,4,5}`;检查范围删除"阶段 5 入口:stage4-scheme.md",阶段 4 入口扩展,阶段 6 入口改为阶段 5 入口;人类可读规则更新;阶段门表格更新
- `references/contract.md`:"阶段四结束"/"阶段五结束"统一改为"阶段四结束";"阶段五验证不通过"改为"阶段四验证不通过";产物目录结构删除 stage4-scheme.md 行,stage3-labels.md 注释扩展
- `references/reference-outline-spec.md`:文档对齐状态表删除 stage4.md 行;stage3.md/stage5.md 备注更新
- `references/methodology.md`:文件列表删除 stage4.md;第三层"留阶段四"扩展为"留阶段四(运行时验证)"
- `references/code-conventions.md`:`[stage4.md](modules/stage4.md) §4.1-§4.5(分支判定)` 改为 `[stage3.md](modules/stage3.md) §5(分支判定)`;"阶段五扣代码与本地模拟"改为"阶段四扣代码与本地模拟"
- `references/modules/stage1.md`:L29/L59-60/L93 阶段编号更新
- `references/modules/stage2-tracing.md`:L12/L32/L293/L487 阶段编号更新
- `references/modules/code-extraction.md`:L3/L5/L13/L29/L328 阶段编号更新
- `references/modules/iv8-env-patching.md`:所有 `[阶段五]` 章节标记改为 `[阶段四]`(11 处);L286/L290 阶段编号更新
- `references/modules/shell-removal.md`:L232/L234/L267/L275/L277 阶段编号更新
- `references/modules/trace-analysis.md`:L28-29 合并为单行阶段四;L303 "分支执行"改为"本地模拟与验证,iv8 路径时"
- `references/modules/har-analysis.md`:无改动(所有引用阶段一/二/三不变)

### v9.26-6:templates/ 模板更新

**修改文件**(3 个修改 + 1 个删除):
- `references/templates/stage3-labels.md`:标题改"阶段三载体形态判定与分支选择模板";强制字段扩展含"分支选择""分支选择依据";§5 删除分支 E;新增 §5.1 分支选择依据(从 stage4-scheme.md §2 迁移);§8 进入阶段四改为引用 stage5.md §5.1
- `references/templates/stage5-verify.md`:标题改"阶段四验证报告模板";L3 改 `--stage 4`;L9 改 `--stage 5`;L17 改"来自 stage3-labels.md 的分支选择";L34 阶段五→阶段四;L75 `--stage 6`→`--stage 5`;L89 回溯选项更新
- `references/templates/stage2-output.md`:L5/L66 "阶段三/四/五" → "阶段三/四"
- `references/templates/stage4-scheme.md`:**删除**(内容合并到 stage3-labels.md §5 + §5.1)

### v9.26-7:evals/evals.json 更新

**修改文件**:`evals/evals.json`

**改动**:
- id 20(L121):"分支 A/B/C/D/E" → "分支 A/B/C/D"(删除 E,v9.16 已合并到 C)
- id 24(L145):"方案1/2选择在阶段五" → "方案1/2选择在阶段四"
- id 30(L181):"v8 五阶段架构下" → "v8 四阶段架构下"
- id 36(L217):"进入阶段五扣代码" → "进入阶段四扣代码"
- id 50(L300-301):prompt 重写(删除 stage4-scheme.md 引用,"完成阶段四"改为"完成阶段四的代码实现");expected_output 重写(`--stage 6` 删除,改为 `--stage 5` 单次检查,删除 stage4-scheme.md 检查描述)
- JSON 语法验证通过

### 设计决策

- **方案 A 彻底合并 vs 方案 B 逻辑合并保留文件**:选方案 A。stage4.md 内容(分支判定矩阵 + Gotchas + 分支实现指引)分别迁移到 stage3.md(判定)和 stage5.md(实现指引),无内容丢失;stage4-scheme.md 模板内容(分支选择 + 依据)合并到 stage3-labels.md §5 + §5.1。方案 B 保留文件会导致"阶段四"语义歧义(文件名 stage5.md 但内容是阶段四),增加认知负担。
- **stage5.md 保留文件名只改标题**:避免 git 历史断裂 + 避免外部引用断链(stage5.md 被多个文件引用)。文件名 stage5.md 是历史遗产,内容标题已改为"阶段四"。
- **stage5-verify.md 保留文件名**:同理,被 stage_gate.py 硬编码引用(key 5 检查 stage5-verify.md),重命名需同步改脚本,增加风险。
- **深函数原则**:stage_gate.py `check_stage()` 签名不变,`_STAGE_RULES` 字典调整藏在内部,调用者无感知。
- **确定性分支逻辑**:stage3.md §3.6.1 分支判定矩阵是 If/Then 状态机(载体形态 → 分支),无"看情况"模糊措辞。

### 验证

- stage_gate.py 语法检查通过(`python -c "import ast; ast.parse(...)"`)
- evals.json JSON 语法验证通过(`python -c "import json; json.load(...)"`)
- 全局 grep 验证:搜索 "stage4" / "阶段五" / "--stage 6" / "stage4-scheme" 确认无遗漏(详见执行报告)
- 功能测试:创建临时任务目录,放齐 4 个产物文件,运行 `--stage 5` 应 PASS;缺"分支选择"字段 `--stage 4` 应 BLOCK
- 版本号:SKILL.md v9.25 → v9.26

### v9.26-8:iv8 止损规则「同类错误」从同分类改为同 API 同错误(P0-3)

**修改文件**:`references/modules/iv8-env-patching.md` + `references/templates/stage5-verify.md` + `SKILL.md`

**问题**:实战中不同 API 的桩函数问题(WebRTC reject + ReadableStream 返回 null + strData 异步生成)虽同属"桩函数"类,却各有解法,按"同分类"止损会导致任务过早失败。

**改动**:
- iv8-env-patching.md "iv8 失败止损规则":
  - "同类错误"定义从"同分类连续 3 次"改为"**同 API 同错误连续 3 次**"(二维定义:API 标识 + 错误分类)
  - 新增"桩函数"错误分类(原 5 类 → 6 类)
  - 累计兜底从 6 次上调到 8 次(避免误触发)
  - 归类规则细化:同 API 不同分类 / 不同 API 同分类均不算同类,各组合独立计数
- stage5-verify.md §5.2:失败记录改为逐条记录(API 标识 + 错误分类 + 错误信息),累计 8 次同步
- SKILL.md L167:累计失败次数同步更新为 8 次

### v9.26-9:stage5-verify.md 新增「iv8 桩函数踩坑记录」字段(P1-1)

**修改文件**:`references/templates/stage5-verify.md`

**问题**:实战中 WebRTC reject / ReadableStream 返回 null / strData 异步生成等问题只能塞进 §4 验证结果备注,没有结构化字段承载。

**改动**:新增 §5.3 "iv8 桩函数踩坑记录(若方案 2 且遇桩函数)":
- 桩函数清单(逐条记录:API + 形态 1-4 + 补丁方式)
- 桩函数探测方法(unhandledrejection hook / 检查 resolve 值 / drainMicrotasks 后回调 state)
- 桩函数补丁是否已注入 page.load 之前
- 原 §5.3 回溯动作顺延为 §5.4

### v9.26-10:stage2-output.md 新增「最小调用链」字段(P1-2)

**修改文件**:`references/templates/stage2-output.md`

**问题**:bdms.js ↔ acrawler.js ↔ runtime_bundler_52.js 的协作关系只能散落在备注中,阶段四扣代码时缺乏结构化调用链参考。

**改动**:新增 §5.1 "最小调用链(强制)":
- 加密函数入口(函数名 + file:line)
- 一级依赖(加密函数直接调用的函数 + 职责)
- 二级依赖(一级依赖调用的关键函数,可选)
- 跨文件调用关系(如"bdms.js require(5245) → acrawler.js module.exports")
- 深度限制 2 层,替代原完整依赖链图谱(v9.18 删除)

### v9.26-11:参数溯源表新增「失效周期」列(P1-3)

**修改文件**:`references/templates/stage5-verify.md`

**问题**:msToken 由服务器实时签发(5-10 分钟过期)、cookie 2 小时过期,下游使用者不知道这些参数何时需要重新获取。

**改动**:stage5-verify.md §6.2 参数溯源表:
- 新增"失效周期"列
- 失效周期枚举:长期有效 / 会话级 / 短期(分钟级) / 每次请求重新获取 / 自定义
- 示例新增 msToken(短期,5-10 分钟过期)行

### v9.26-12:stage5.md Recovery Level 增加 IIFE 闭包单体例外(P1-4)

**修改文件**:`references/modules/stage5.md`

**问题**:实战中 bdms.js(JSVMP + IIFE 闭包单体)Level A 起步,但实际 iv8 补环境时根本没走"关键 opcode 卡片 + I/O 对照"流程,直接 page.load 整文件跑通。Recovery Level 概念在 IIFE 闭包单体场景下基本失效。

**改动**:stage5.md §5.1.2 分支 B Recovery Level 后新增"IIFE 闭包单体例外(v9.26 新增)":
- 说明 IIFE 闭包单体场景下 Recovery Level 失效原因(整文件加载,无需逐 opcode 恢复)
- 新增 IIFE 闭包单体处理流程(跳过 Recovery Level → page.load 整文件 → iv8 debug → 补环境 → 源码注入 hook → 验证)
- 引用 stage3.md §3.3.1 IIFE 闭包单体判定

### v9.26-13:SKILL.md 模块索引表增加「关键词反查」列(P2-2)

**修改文件**:`SKILL.md`

**问题**:9 个文档约 3000 行,Agent 有"找不到在哪"的情况(如"iv8 桩函数检测方法"在 v9.22 前完全缺失)。

**改动**:SKILL.md 模块索引表:
- 新增"关键词反查"列
- 每个文档标注关键词标签(如:iv8-env-patching.md → "iv8 / page.load / 补环境 / 止损规则 / 桩函数 / wrapNative")
- 新增说明:"当你在找某个具体概念/问题/工具时,用关键词反查列快速定位文档"

### v9.26 审查结果

审查完成(基于 toutiao-list-feed 实战反馈 9 项评估),确认:
- 忽略项 P0-2(阶段六删除)/ P0-4(iv8 桩函数检测入口)/ P1-5(IIFE 判定步骤 2 修改)均未执行 ✓
- 修复项 P0-1 / P0-3 / P1-1 / P1-2 / P1-3 / P1-4 / P2-2 全部验证通过 ✓
- 全局一致性检查通过(stage4.md / stage4-scheme.md / 五阶段 / --stage 6 / 阶段五 仅在历史 changelog + v9.26 变更说明注释中残留,豁免)✓
- SKILL.md L167 累计失败次数 6→8 同步修复 ✓

## v9.25

**核心变更**:基于 toutiao a_bogus 逆向实战复盘反馈(9 项评估),修复 2 个 P0 问题:① stage4.md 缺 §4 Gotchas 章节(唯一缺 Gotchas 的阶段文档,分支判定阶段无避坑防护栏)+ 裸标题未遵循 §6/§7/§8 大纲规范;② stage5 iv8 调试过程管控偏松(止损规则是软约束,stage_gate.py 不检查 iv8 调试轮次,Agent 可能无限循环)。实战反馈确认:v9.22 桩函数清单、v9.24 产物整理规则已在本次实战中生效,不再重复修复。

### v9.25-1:stage4.md 补 §4 Gotchas + §6/§7/§8 编号对齐(P0)

**修改文件**:`references/modules/stage4.md`

**问题**:stage4.md 是唯一缺 §4 Gotchas 的阶段文档(stage1/2/3/5 都有),实战反馈问题 2(骨架对齐)和问题 7(八大章节读取)均指出此结构缺失。分支判定阶段缺少避坑防护栏,Agent 无法读取不存在的章节。同时 stage4.md 用裸标题"产物/GATE/回执"而非 §6/§7/§8,违反 v9.19 大纲规范。

**改动**:
- 新增 §4 Gotchas(4 条):
  - Gotcha 1(JSVMP 误判为分支 C):JSVMP 代码"看起来像普通 JS"就误判分支 C → 必须用 stage3 §3.3.2 五条检查清单复核
  - Gotcha 2(分支选择与方案 1/2 混淆):分支选择(A/B/C/D)≠ 方案 1/2 选择(阶段五做)
  - Gotcha 3(载体形态不明确时自行重新判定):→ 停止,回阶段三检查 stage3-labels.md
  - Gotcha 4(分支 B Recovery Level 硬性升级):JSVMP 不得跳级,Recovery Level 按 stage3 §3.3.2 判定
- 顶层标题全部加 §X 编号:使用时机→§1 / 输入→§2 前置条件 / 目标与边界→§3 / 执行规则→§5 执行规则与流程 / 流程→降级为 §5 子节 / 产物→§6 / GATE→§7 / 回执→§8
- 与 stage1/2/3/5 大纲完全对齐(§1-§8 八章节齐全)

### v9.25-2:stage5 iv8 调试轮次强制记录(P0)

**修改文件**:`references/templates/stage5-verify.md` + `scripts/stage_gate.py`

**问题**:实战反馈问题 6(stage_gate.py 阻断松紧度)指出"stage5 gate 对 iv8 调试过程的管控偏松(iv8 连续多轮调试未触发§7止损动作)"。根因:§5.4.2 止损规则(连续 3 次同类错误 / 超过 5 轮)是软约束,stage_gate.py 不检查 iv8 调试轮次,完全依赖 Agent 自觉。

**改动**:
- stage5-verify.md §5.2(iv8 失败止损检查)增加"iv8 调试总轮次"强制字段(方案 2 必填)
- stage_gate.py `_STAGE_RULES[6]` 增加 `conditional_fields` 字段:
  - 触发条件:stage5-verify.md 含"方案 2"/"方案2"/"iv8"
  - 额外检查:必须含"iv8 调试总轮次"字段且非占位符
  - 缺失 → BLOCK,action 指明补齐
- `check_stage()` 增加检查 4(条件字段检查),辅助函数 `_check_conditional_fields()` 嵌套定义(深函数原则)
- 功能验证:
  - 方案 2 含"iv8"但缺"iv8 调试总轮次" → BLOCK,missing 指明缺条件字段
  - 含"iv8 调试总轮次: 8" → PASS

**设计决策**:
- 不阻断超 5 轮(技术难度可能合理超过,如本次 WebRTC 桩函数问题)
- 强制记录轮次 → 记录行为本身抑制无限循环(Agent 知道要记录,会更自觉控制轮次)
- 与 §5.4.2 软约束止损规则配合:硬记录 + 软止损,双层防护

### 实战反馈对照(已修复 vs 本次修复)

| 反馈问题 | 状态 | 修复版本 |
|---------|------|---------|
| 9. iv8 桩函数系统性检测方法缺失(最高优先级) | ✅ 已修复(实战前) | v9.22(api-reference.md 桩函数清单) |
| 任务完成前产物整理(隐含) | ✅ 已修复(实战前) | v9.24(SKILL.md 产物整理 + stage6 全产物核对) |
| stage1 产物文件名 bug | ✅ 已修复(实战前) | v9.24(stage1.md param-analysis.md → stage1-params.md) |
| 2/7. stage4 缺 §4 Gotchas | ✅ 本次修复 | v9.25-1 |
| 6. stage5 iv8 调试管控偏松 | ✅ 本次修复 | v9.25-2 |
| 5. WASM/Worker/gcaptcha4 指导不足 | ⏳ 未修复(P1,用户选择仅 P0) | — |

### 规范化依据

- **agent-skills-creation ch04 - Gotchas Are Highest Value**:stage4 分支判定是关键决策点(JSVMP 误判分支 C 会走错路径),Gotcha 防护栏必须存在
- **agent-skills-creation ch04 - Calibrate Control to Fragility**:iv8 调试无限循环是高风险(耗时长 + 无回退),控制强度必须匹配 → 软约束(§5.4.2 止损)+ 硬记录(stage_gate.py 条件字段)双层防护
- **v9.19 大纲规范**:所有阶段文档必须遵循 §1-§8 八章节结构,stage4 是最后一个未对齐的
- **深函数原则**:`check_stage()` 签名不变,`conditional_fields` 检查逻辑藏在内部 `_check_conditional_fields()` 辅助函数中

### 验证

- stage4.md:§1-§8 八章节齐全,§4 Gotchas 4 条
- stage5-verify.md:§5.2 增加"iv8 调试总轮次"强制字段
- stage_gate.py:`_STAGE_RULES[6]` conditional_fields + `check_stage()` 检查 4 + 语法 OK + 功能验证(缺字段 BLOCK + 含字段 PASS)
- 版本号:SKILL.md v9.24 → v9.25

## v9.24

**核心变更**:修复"任务完成后不整理前序阶段产物"问题。用户反馈"在完成任务后需要返回各个阶段的产出文档,需要整理文档补充未写完的。这个没有做。"——根因是 SKILL.md 只有"任务失败交付物"章节,没有"任务成功后产物整理"全局规则;stage_gate.py `--stage 6` 只检查 stage5-verify.md 单文件,不核对前序 4 个产物;stage5.md 引用的 SKILL.md "交付物"章节是断链(不存在)。本版本三件同步修复:SKILL.md 新增全局规则 + stage_gate.py 扩展 stage6 全产物核对 + stage5.md 修断链。附带修复 stage1.md 产物文件名 bug(写错为 param-analysis.md,应为 stage1-params.md)。

### v9.24-1:SKILL.md 新增"任务完成前产物整理"章节(P0)

**修改文件**:`SKILL.md`

- 在"任务失败交付物"章节之后新增"任务完成前产物整理(If/Then,强制)"章节
- 与"任务失败交付物"对称——失败有失败报告,成功有产物整理
- 4 步状态机(顺序执行,不允许跳步):
  - Step 1: 全产物清单核对(5 个文件 + 强制字段 + 占位符判定规则)
  - Step 2: 缺失/不完整产物补全(回对应阶段补齐 + 重跑 stage6)
  - Step 3: 代码与证据产物核对(code/ + evidence/deobfuscated/)
  - Step 4: 输出"任务完成报告"(标准化格式,固定字段)
- 占位符判定规则:`<...>` / `____` / `☐` / "待定位"/"待补充"/"待填写"/"TODO" 任一命中即视为"未写完"
- 禁止项:跳过 Step 1-3 直接交付 / 保留占位符 / 写"待补充"代替补齐 / 仅交付 stage5-verify.md

### v9.24-2:stage5.md 修断链引用(P0)

**修改文件**:`references/modules/stage5.md`

- L415:`进入阶段六(交付,见 [SKILL.md](../../SKILL.md) "交付物")` → `进入产物整理流程(见 [SKILL.md](../../SKILL.md) "任务完成前产物整理")`
  - 原"交付物"章节在 SKILL.md 不存在(断链),现已由 v9.24-1 新章节替代
- L437:`进入阶段六交付。` → `进入产物整理流程(见 SKILL.md '任务完成前产物整理')。`
  - SKILL.md 五阶段工作流没有"阶段六",原引用指向不存在的阶段

### v9.24-3:stage_gate.py 扩展 _STAGE_RULES[6] 全产物核对(P0)

**修改文件**:`scripts/stage_gate.py`

- `_STAGE_RULES[6]` 增加 `extra_files` 字段,列出前序 4 个产物文件 + 各自 required_fields + 回退阶段号:
  - stage1-params.md(参数溯源表 / 透传链路图 / _initiator.stack,回阶段 1)
  - stage2-output.md(加密点位 / 变换台账 / 载体清晰度初判,回阶段 2)
  - stage3-labels.md(载体形态判定结论 / 载体清晰度最终判定 / 判定依据,回阶段 3)
  - stage4-scheme.md(分支选择 / 分支选择依据,回阶段 4)
- `check_stage()` 增加检查 3:当 rule 含 `extra_files` 时,逐一核对前序文件存在 + 字段非占位符
- 遵循深函数原则:`check_stage()` 只负责编排,`_check_extra_files()` + `_build_extra_block_message()` 为内部辅助函数(嵌套定义,作用域限于 check_stage)
- 任一前序文件缺失/含占位符 → BLOCK,action 指明回到哪个阶段补齐
- 功能验证:
  - 只放 stage5-verify.md(缺前序 4 个)→ BLOCK,missing 列出 4 个缺失文件
  - 5 个文件齐全且字段完整 → PASS

### v9.24-4:stage1.md 修产物文件名 bug(P0)

**修改文件**:`references/modules/stage1.md`

- L47:`./<task>/param-analysis.md` → `./<task>/stage1-params.md`(与 stage_gate.py / contract.md / stage-gate-rules.md 对齐)
- L126:`./<task>/param-analysis.md` → `./<task>/stage1-params.md`
- L136:`param-analysis.md 草稿` → `stage1-params.md 草稿`
- L90 模板引用 `param-analysis.md` 保留不变(模板文件确实叫这名)
- **原 bug 后果**:Agent 读 stage1.md 把产物写到 `param-analysis.md`,跑 `stage_gate.py --stage 2` 检查 `stage1-params.md` → 文件不存在 → BLOCK

### 规范化依据

- **用户反馈根因**:Agent 通过 stage5 验证后直接交付,前序阶段产物残留占位符/TODO 未清。根因是三层缺失:SKILL.md 无成功交付物规则(软约束)+ stage_gate.py stage6 只查单文件(脚本不拦截)+ stage5.md 断链(Agent 找不到交付流程)。三者因果:断链 → Agent 不知该做什么 → 脚本不拦截 → Agent 跳过整理
- **agent-skills-creation ch04 - Calibrate Control to Fragility**:产物整理是高风险(交付半成品 → 用户拿到残缺产物集),控制强度必须匹配风险 → SKILL.md 全局规则(软约束)+ stage_gate.py 全产物核对(硬阻断)双层防护
- **深函数原则**:`check_stage()` 签名不变(调用者无感知),`extra_files` 检查逻辑藏在内部 `_check_extra_files()` 辅助函数中,调用者只需面对 `--stage 6` 不变
- **对称设计**:"任务失败交付物"(失败报告)+ "任务完成前产物整理"(成功整理)覆盖两种终态,消除原不对称设计

### 验证

- SKILL.md:新增"任务完成前产物整理"章节(4 步状态机 + 占位符判定 + 任务完成报告)
- stage5.md:L415/L437 断链已修,指向新章节
- stage_gate.py:`_STAGE_RULES[6]` extra_files + `check_stage()` 检查 3 + 语法 OK + 功能验证(缺文件 BLOCK + 全齐 PASS)
- stage1.md:L47/L126/L136 文件名修正为 stage1-params.md
- 版本号:SKILL.md v9.23 → v9.24

## v9.23

**核心变更**:针对 iv8 补环境场景的内存爆破风险,新增 3 层内存安全强制规范。用户反馈"防止使用 iv8 导致内存被爆破",明确要求是"规范"而非"脚本"——所有 iv8 使用场景必须设置最大内存限制(默认 512MB),把内存防护固化为 If/Then 强制规则 + 代码模板,嵌入 skill 文档,而非独立脚本。

**设计决策**:
- **不是脚本,是规范**:用户明确否决了 `scripts/iv8_sandbox.py` 脚本方案,要求把内存限制固化为 iv8 使用前的强制规范(类似"iv8 debug 大文件预警"的处理方式)
- **3 层策略,按风险递进**:第 1 层(必须,V8 堆 + GC)→ 第 2 层(推荐,子进程 + Job Object,Windows)→ 第 3 层(高安全,第 2 层 + psutil 监控)
- **不可信 JS / 大文件(200KB+)强制第 2 层**:OB 壳 Webpack bundle、JSVMP 文件是内存爆破高发场景,必须子进程隔离
- **Windows Job Object 代码模板**:用 `CreateJobObjectW` + `JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`,以 `CREATE_SUSPENDED` 启动子进程 → `AssignProcessToJobObject` → `ResumeThread` 的标准模式,确保子进程在分配超限内存时被 OS 直接 kill,不拖垮主进程

### v9.23-1:api-reference.md 新增"内存限制(必读,防内存爆破)"章节(P0)

**修改文件**:`references/api-reference.md`

- 在"开箱即用能力"之后新增"内存限制(必读,防内存爆破)"章节
- 3 层强制规范:
  - 第 1 层(必须):V8 堆上限 + `ctx.close(gc="low_memory")` 兜底
  - 第 2 层(推荐,Windows):子进程 + Job Object 进程级隔离,超内存直接 kill
  - 第 3 层(高安全):第 2 层 + psutil 实时监控,主动告警
- 完整代码模板:ctypes 结构体(JOBJECT_EXTENDED_LIMIT_INFORMATION / IO_COUNTERS / SECURITY_ATTRIBUTES)、`create_job_with_memory_limit()`、`run_iv8_in_subprocess()`(CREATE_SUSPENDED + AssignProcessToJobObject + ResumeThread 模式)、`run_iv8_with_monitor()`
- 强制约束块:`IF 使用 iv8 → 必须实施第 1 层;IF 不可信 JS / 大文件(200KB+) → 必须实施第 2 层`
- 风险场景清单:死循环分配 / 大数组构建 / 递归爆栈 / JSVMP 指令循环 / 混淆 dispatcher 未命中 case

### v9.23-2:iv8-env-patching.md 关键提醒新增内存爆破防护条目(P0)

**修改文件**:`references/modules/iv8-env-patching.md`

- "关键提醒 [跨阶段]"章节新增第 4 条:"内存爆破防护(v9.23 新增,强制规范)"
- 引用 api-reference.md "内存限制(必读,防内存爆破)"
- 摘要:3 层策略 + 触发条件(不可信 JS / 大文件 200KB+ 必须第 2 层)

### v9.23-3:stage5.md §4 Gotchas 新增 Gotcha 9 + §5.4 引用内存规范(P0)

**修改文件**:`references/modules/stage5.md`

- §4 Gotchas 新增 Gotcha 9:iv8 内存爆破(v9.23 新增,强制)
  - 症状:目标 JS 死循环分配/大数组构建/递归爆栈等导致内存爆破,拖垮主进程
  - 强制规范:所有 iv8 使用场景必须设置最大内存限制(默认 512MB)
  - 3 层策略摘要 + 引用 api-reference.md 完整规范
- §5.4 方案 2:iv8 补环境章节头部新增"⚠️ 内存限制(v9.23 强制)"引用块
  - 指向 api-reference.md "内存限制(必读,防内存爆破)"
  - 明确第 1 层必须、第 2 层(不可信 JS / 大文件 200KB+)推荐

### 规范化依据

- **用户明确决策**:不是脚本,是规范。理由:iv8 内存限制是所有 iv8 使用场景的通用约束,不是一次性脚本能覆盖的;规范嵌入 skill 文档后,Agent 在 §5.4 入口会被强制提醒,比脚本更可靠
- **agent-skills-creation ch04 - Calibrate Control to Fragility**:iv8 内存爆破是高风险(拖垮主进程 → 整个任务失败),控制强度必须匹配风险 → 第 1 层强制 + 第 2 层按风险递进 + 第 3 层高安全可选
- **agent-skills-creation ch04 - Gotchas Are Highest Value**:内存爆破是环境特定事实,Agent 不告知会踩坑(目标 JS 不可信,可能死循环分配)→ 写入 §4 Gotcha 9
- **Spend Context Wisely**:完整代码模板(Job Object ctypes 结构体)放在 api-reference.md(按需加载),stage5.md / iv8-env-patching.md 只放摘要 + 引用

### 验证

- api-reference.md:3 层规范完整 + Job Object 代码模板 + 强制约束块
- iv8-env-patching.md 关键提醒:4 条(含新增内存爆破防护)
- stage5.md §4 Gotchas:9 条(含新增 Gotcha 9)
- stage5.md §5.4:内存限制引用块
- 跨文件引用:stage5.md → api-reference.md;iv8-env-patching.md → api-reference.md
- 版本号:SKILL.md v9.22 → v9.23

## v9.22

**核心变更**:按 agent-skills-creation ch04 规范,把两个实战坑点(iv8 接口级桩函数 + trace `[Object Proxy]`)规范化写入 skill,在多个文档增加防踩坑提示。

### v9.22-1:api-reference.md 新增"社区版桩函数形态与实测清单"(P0)

**修改文件**:`references/api-reference.md`

- 社区版关键限制表新增第三行:"接口级桩函数(坑!)" — 重型浏览器 API 类存在但方法是空桩
- 新增"社区版桩函数形态与实测清单(必读,防踩坑)"章节:
  - 4 种桩函数形态(C++ 层 reject / JS 层 reject / 回调永不触发 / resolve 成 null)
  - 6 类已实测桩函数清单(网络/传输、硬件/传感器、图形/媒体、文件/存储、Streams API、其他)
  - 桩函数探测方法(4 步:hook unhandledrejection / 检查 reason / 判断 null / 检查回调)
- 章节顶部加 Gotcha 提示,引用 iv8-env-patching.md §4 Gotcha

### v9.22-2:trace-analysis.md 新增 §3.3 trace 日志 [Object Proxy] 说明(P0)

**修改文件**:`references/modules/trace-analysis.md`

- §3 能力边界后新增 §3.3 "trace 日志中 `Window.get` 返回 `[Object Proxy]` 是正常的"
- 判定规则:trace 出现 `[Object Proxy]` → 正常,等同于 window,不排查
- 反模式警示:Agent 误以为"window 异常/补环境出错"花时间排查 — 实际是浏览器 trace 序列化标准行为,与 iv8 补环境无关

### v9.22-3:iv8-env-patching.md 关键提醒增加桩函数坑点(P0)

**修改文件**:`references/modules/iv8-env-patching.md`

- "关键提醒 [跨阶段]"章节新增第三条:"接口级桩函数坑(v9.22 新增,防踩坑)"
- 引用 api-reference.md "社区版桩函数形态与实测清单"
- 重点提示形态 1(C++ 层 reject)最隐蔽 — 绕过 JS 层所有 Promise hook,必须 hook `unhandledrejection`

### v9.22-4:stage5.md §4 Gotchas 新增 Gotcha 8(iv8 接口级桩函数)(P0)

**修改文件**:`references/modules/stage5.md`

- §4 Gotchas 新增 Gotcha 8:iv8 接口级桩函数
- 症状:方案 2 iv8 补环境后加密参数生成失败/Promise 链中断/指纹采集异常,但无报错
- 对策:引用 api-reference.md 桩函数清单 + 探测方法

### v9.22-5:stage1.md §4 Gotchas 新增 Gotcha 4(trace 日志 [Object Proxy])(P1)

**修改文件**:`references/modules/stage1.md`

- §4 Gotchas 新增 Gotcha 4:trace 日志 `[Object Proxy]` 是正常现象
- 引用 trace-analysis.md §3.3 深度说明

### 规范化依据(agent-skills-creation ch04)

- **Gotchas Are Highest Value**:两个坑点都是环境特定事实,Agent 不告知会踩坑 — 桩函数静默中断 Promise 链、`[Object Proxy]` 误判为补环境出错
- **Calibrate Control to Fragility**:桩函数形态 1(C++ 层 reject)最隐蔽,给出精确探测方法(hook unhandledrejection);`[Object Proxy]` 给出确定性判定规则(正常,不排查)
- **Spend Context Wisely**:桩函数清单详细放在 api-reference.md(按需加载),stage5.md §4 Gotcha 8 只放症状+对策摘要 + 引用

### 验证

- api-reference.md:桩函数清单完整(4 形态 + 6 类 + 探测方法)
- trace-analysis.md §3.3:[Object Proxy] 判定规则 + 反模式
- iv8-env-patching.md 关键提醒:3 条(含新增桩函数坑)
- stage5.md §4 Gotchas:8 条(含新增 Gotcha 8)
- stage1.md §4 Gotchas:4 条(含新增 Gotcha 4)
- 跨文件引用:stage5.md → api-reference.md;stage1.md → trace-analysis.md §3.3;iv8-env-patching.md → api-reference.md

## v9.19

**核心变更**:基于 agent-skills-creation ch02/ch04 规范,为 5 个阶段流程文档(stage1/2/3/4/5.md)建立统一的 8 章节大纲规范并完成对齐。新增 `references/reference-outline-spec.md` 作为大纲规范,4 个待对齐文档(stage1/2/3/5.md)按规范对齐;stage4.md 作为样板保持原状(用户决策)。

**触发原因**:用户提出"reference 文档大纲"应包含 8 个章节(使用时机 / 输入 / 目标与边界 / 执行规则 / 流程 / 产物 / GATE / 回执),要求用 agent-skills-creation skill 审查。审查后基于 ch02(Specification)+ ch04(Best Practices)提出 5 项修订:① "输入"→"前置条件";② 新增 Gotchas 章节(ch04 最高价值内容);③ 执行规则与流程合并;④ GATE 补通过/不通过/降级三动作;⑤ 回执补成功/降级/失败三态。用户确认后执行修复。

### v9.19-1:新建大纲规范文档

**修改文件**:`references/reference-outline-spec.md`(新建)

- 定义 8 章节强制结构:§1 使用时机 / §2 前置条件 / §3 目标与边界 / §4 Gotchas / §5 执行规则与流程 / §6 产物 / §7 GATE / §8 回执
- 每章节给出 ch02/ch04 依据 + 内容要求
- 章节命名约束(不允许同义词替换)+ 章节顺序约束(不允许调整)
- 现有文档对齐状态表(stage4.md 标注"样板,不动;无 §4 Gotchas,用户决定保留原样")

### v9.19-2:stage1.md 全量重写对齐 8 章节大纲

**修改文件**:`references/modules/stage1.md`

- 全量重写为 §1-§8 结构(原 stage1.md 内容较薄,无外部锚点引用,可直接重写)
- §4 Gotchas 聚集 3 条:trace 加密点定位盲区 / HAR 浏览器兼容性 / trace 大文件
- §7 GATE 补通过/不通过/降级三动作
- §8 回执补成功/降级/失败三态

### v9.19-3:stage2-tracing.md 骨架对齐 8 章节大纲

**修改文件**:`references/modules/stage2-tracing.md`

- 骨架对齐(保留中段 2.1/2.2/2.3 不动,因有 31 处外部锚点引用)
- 顶部新增 §1 使用时机 / §2 前置条件 / §3 目标与边界 / §4 Gotchas(6 条)/ §5 执行规则与流程
- 底部用 §6 产物 / §7 GATE / §8 回执 替换原"阶段二产出物"+"禁止事项"章节
- 原"禁止事项"内容并入 §3 安全边界

### v9.19-4:stage3.md 骨架对齐 8 章节大纲

**修改文件**:`references/modules/stage3.md`

- 骨架对齐(保留中段 3.1-3.8 不动,因有 25 处外部锚点引用;§3.8 Webpack 判定 Gotcha 保留原位置)
- 顶部新增 §1 使用时机 / §2 前置条件 / §3 目标与边界 / §4 Gotchas(5 条)/ §5 执行规则与流程
- 底部用 §6 产物 / §7 GATE / §8 回执 替换原 §3.9 禁止事项 + §3.10 下一阶段入口
- 原 §3.9 禁止事项内容并入 §3 安全边界

### v9.19-5:stage5.md 骨架对齐 8 章节大纲

**修改文件**:`references/modules/stage5.md`

- 骨架对齐(保留中段 5.1-5.5 不动,因有外部锚点引用)
- 顶部新增 §1 使用时机 / §2 前置条件 / §3 目标与边界(含原"职责边界"作为 §3 子章节)/ §4 Gotchas(7 条)/ §5 执行规则与流程
- 底部用 §6 产物 / §7 GATE / §8 回执 替换原 5.6 交付前检查清单 + 5.7 禁止事项 + 5.8 下一阶段入口
- 原 5.6 交付前检查清单内容并入 §6 产物(强制字段表)
- 原 5.7 禁止事项内容并入 §3 安全边界
- 原"职责边界"作为 §3 目标与边界的子章节保留(SKILL.md 等外部引用仍有效)

### v9.19-6:验证

- stage_gate.py 运行正常(--help 退出码 0,v9.19 未修改脚本)
- 链接完整性:无内部引用指向已删除章节(stage3 §3.9/§3.10 / stage5 §5.6/§5.7/§5.8)
- 章节命名:4 个对齐文档均含完整 §1-§8 共 8 个章节
- Gotchas §4:4 个对齐文档均含 §4 Gotchas(stage4.md 样板不含,已知并记录于 spec 状态表)
- "职责边界"锚点在 stage5.md §3 子章节保留,SKILL.md 引用仍有效

### 已知遗留(stage4.md)

- stage4.md 作为样板保留原状,无 §4 Gotchas 章节
- spec 状态表已记录"样板,不动(注:无 §4 Gotchas,用户决定保留原样)"
- 如未来需要全面对齐,可参考 stage1/2/3/5.md 的对齐方式补全 stage4.md

## v9.18

**核心变更**:经实战验证,依赖链在本 skill 中作用很小,安全去除。旧版本(v9.17 及之前)留存于 `web-reverse-iv8-v9.15-archive` 存档目录。

**触发原因**:用户决策"经过实战依赖链在此skill作用很小,现在需要安全去除。旧版本留存,去除后作为新版本"。依赖链作为阶段二 §2.4/§2.5 的核心产物,在实战中产生以下问题:① 静态数据流追踪能力边界(三层表)导致大量节点被标 `[静态未验证]`,实际等同于"全部保留",剪枝标准失效;② 后续阶段(三/四/五)消费依赖链时,实际只用到加密点位 + 脱壳代码,依赖链图谱本身无消费者;③ Agent 维护依赖链清单成本高,大文件易漏节点。

### v9.18-1:删除阶段二 §2.4/§2.5 章节

**修改文件**:`references/modules/stage2-tracing.md`

- 删除 §2.4「相关性判定与依赖链扩展」(数据流追踪能力边界 / OB 壳 CFF 变量遮蔽 / 保守剪枝标准 / 依赖链扩展 / 终止条件)
- 删除 §2.5「两遍静态剪枝闭环」(增量剪枝 vs 全局剪枝 / 残留处理)
- 调整目录、核心策略、AST 使用边界说明中的"依赖链自动追踪"为"自动追踪跨函数调用"
- 调整阶段二产出物清单:6 项 → 4 项(删除"依赖链图谱"+"文件 URL 列表";§2.4 依赖链图谱 → §2.4 边界标记)
- 调整下一阶段入口描述:从"2.4 依赖链图谱 + 2.5 边界标记 + 2.6 文件 URL 列表"→"2.3 局部脱壳记录 + 2.4 边界标记"
- 删除禁止事项中"禁止提前建立完整依赖链"和"禁止把 [静态未验证] 节点当无关剪除"

### v9.18-2:阶段门检查字段瘦身

**修改文件**:`scripts/stage_gate.py`、`references/stage-gate-rules.md`、`SKILL.md`

- `_STAGE_RULES[3].required_fields`:从 `["加密点位", "依赖链", "变换台账", "载体清晰度初判"]` → `["加密点位", "变换台账", "载体清晰度初判"]`(4 字段 → 3 字段)
- stage-gate-rules.md 中阶段三入口检查同步调整
- SKILL.md 中 stage_gate.py 检查字段说明同步调整
- 出口验证表中"加密函数定位 + 局部脱壳后代码 + 依赖链清单 + 变换台账"→"加密函数定位 + 局部脱壳后代码 + 变换台账"

### v9.18-3:跨阶段引用全局替换

**修改文件**:`SKILL.md`、`references/contract.md`、`references/methodology.md`、`references/modules/stage3.md`、`references/modules/stage5.md`、`references/modules/code-extraction.md`、`references/modules/iv8-env-patching.md`、`references/modules/shell-removal.md`、`references/modules/trace-analysis.md`、`references/templates/stage2-output.md`、`references/templates/stage5-verify.md`、`evals/evals.json`

替换规则(全局统一):
- "依赖链" → "加密点位脱壳后代码" 或 "加密点位涉及的代码" 或 "脱壳代码"(按上下文择优)
- "依赖链完整性" → "脱壳代码完整性"
- "依赖链文件 URL 列表" → "加密点位涉及的文件 URL 列表"
- "回溯阶段二检查依赖链完整性" → "回溯阶段二检查脱壳代码完整性"
- "依赖链中存在 XX 调用" → "加密点位代码中存在 XX 调用"
- "按依赖链图谱提取节点" → "按加密点位涉及的代码提取相关节点"
- "整个依赖链放入 iv8" → "加密点位涉及的代码放入 iv8"
- "静态依赖链分析" → "静态脱壳代码分析"

### v9.18-4:阶段二产物模板瘦身

**修改文件**:`references/templates/stage2-output.md`

- 删除 §3「依赖链清单(2.4 产出)」整章
- 章节序号顺移:原 §4 变换台账 → §3,原 §5 边界标记 → §4,原 §6 载体清晰度初判结论 → §5,原 §7 未解决问题 → §6
- "强制字段"描述:从"加密点位、依赖链清单、变换台账、边界标记"→"加密点位、变换台账、边界标记"
- "边界标记"表格列名:从"节点|标记|原因"→"调用点|标记|原因"(节点是依赖链概念,调用点更通用)

### v9.18-5:其他文件中的依赖链引用调整

- `references/modules/code-extraction.md` §5.2.2「第一步:取加密点位与依赖链」→「第一步:取加密点位与脱壳代码」
- `references/modules/code-extraction.md` §5.8 禁止事项:"禁止跳过阶段二依赖链分析直接扣代码"→"禁止跳过阶段二脱壳分析直接扣代码"
- `references/templates/stage5-verify.md`:检查 1 名称"依赖链完整性"→"脱壳代码完整性";回溯动作"阶段二(依赖链)"→"阶段二(脱壳代码)"
- `evals/evals.json` ID=35/36/49:更新 prompt 和 expected_output 中的"依赖链"措辞

### v9.18-6:旧版本存档

- 旧版本(v9.17 及之前所有历史)完整留存于 `web-reverse-iv8-v9.15-archive` 目录
- 新版本目录仍为 `web-reverse-iv8`,版本号 v9.18
- 历史变更记录(changelog.md 中 v9.17 及之前的内容)保留不修改,作为历史可追溯

### 影响范围

- **不破坏现有阶段流程**:阶段一/二/三/四/五的入口和出口检查仍然成立,只是阶段二产物少了"依赖链清单"字段
- **下游阶段无影响**:阶段三载体形态判定原本就基于"变换台账 + 加密点位脱壳后代码"(不是依赖链图谱);阶段五方案 1/2 原本就基于"加密点位 + 脱壳代码集"(不是依赖链图谱)
- **阶段门检查通过性**:旧任务目录中已写好的 stage2-output.md 不含"依赖链"字段也能通过新规则(检查项减少)
- **失败止损规则保留**:iv8 失败 3 次仍触发回溯,只是回溯检查项从"依赖链完整性"→"脱壳代码完整性",检查目标不变(确认是否有遗漏的下层函数)

## v9.17

**核心变更**:阶段五"职责边界"根本性重构——skill 只逆向算法,被加密数据由用户提供。

**触发原因**:用户指出"在阶段5,skill 只负责逆向加密函数的算法,被加密的值是需要用户提供的,所以这是方案一错过的原因之一。比如加密函数已经清晰是 AES 但是被加密参数是依赖浏览器,那么走了方案 2 其实方案一就可以。所以只要算法,被加密数据由用户提供。用户提供后可以对被加密数据进行溯源"。v9.16 之前把"参数生成依赖浏览器运行时"作为方案 1 阻碍条件,导致大量本可走方案 1 的场景被误判走方案 2,绕弯路做 iv8 补环境。

**用户决策**(3 个关键点全部按推荐方案):
- 关键点1:算法代码路径调用浏览器 API 生成输入参数(如 crypto.getRandomValues 生成 IV)→ 输入参数可由用户用 Python 等价生成(os.urandom)→ 走方案 1
- 关键点2:参数溯源表作为 §5.6 交付前检查清单的必填项(方案1+方案2 都填)
- 关键点3:保留极验4 w 参数历史案例,把教训改为"参数来自浏览器不阻碍方案 1,数据由用户提供"

### v9.17-1:新增"职责边界"声明

**问题**:stage5.md 没有声明 skill 的职责边界,导致方案 1/2 判定逻辑混淆了"算法可还原性"和"数据来源"两个维度。

**修复**:在 stage5.md 文件开头(§5.1 之前)新增"职责边界(强制,先读)"章节:
- 明确"skill 只负责逆向加密函数的算法,被加密数据由用户提供"
- 列出"对方案 1/2 判定的根本影响"(参数依赖浏览器不再阻碍方案 1)
- 列出"用户数据提供方式"(HAR/trace/Python 等价生成/手动传入)

### v9.17-2:方案 1/2 判定逻辑根本性重构

**问题**:§5.2.1 必试清单 4 条中含"参数生成逻辑不依赖浏览器运行时";§5.2.2 整张判定表是"参数依赖浏览器"判定;§5.2.4 Gotcha 讲"数据来自浏览器 vs 参数生成依赖浏览器"。这些都基于"参数依赖浏览器阻碍方案 1"的错误前提。

**修复**:
- **§5.2.1 必试清单**:4 条 → 3 条(删除"参数生成逻辑不依赖浏览器运行时")。新增"参数依赖浏览器不阻碍方案 1"的明确说明。
- **§5.2.2 判定条件**:删除整张"参数依赖浏览器"判定表,改为"算法可静态还原判定"(3 条 If/Then:纯计算/调用浏览器 API 不可替代/调用浏览器 API 仅生成输入参数)。
- **§5.2.3 方案 2 触发条件**:删除"参数生成逻辑依赖浏览器运行时"条;新增"算法代码路径调用浏览器 API 且无法用 Python 等价替代"条。
- **§5.2.4 Gotcha**:保留极验4 w 参数历史案例,重写教训为"v9.17 彻底删除'参数生成依赖浏览器运行时'判定维度,被加密数据由用户提供"。

### v9.17-3:新增参数溯源机制

**问题**:方案 1 的 Python 函数需要用户传入输入参数,但没有告诉用户"每个参数从哪拿/怎么生成"。用户拿到 Python 函数后无法调用。

**修复**:
- **§5.3.1 重写流程 Step 2**:从原"整理参数来源"重写为"参数溯源(强制)",列出 6 种来源类型(HAR 接口返回/trace 字段/用户操作/固定常量/浏览器 API 生成/运行时生成)+ 用户获取方式。
- **§5.6 交付前检查清单**:新增"参数溯源表(强制)"必填项,明确"方案 1 + 方案 2 共同必填"(方案 2 iv8 补环境也需要用户传入输入参数)。
- **stage5-verify.md §6.2 参数溯源表**:新增标准化表格(参数名/来源类型/用户获取方式/备注)+ 来源类型枚举。
- **§5.7 P0 禁令**:新增"禁止跳过参数溯源表"。

### v9.17-4:P0 禁令改写

**问题**:原 P0 禁令"禁止把'参数数据来自浏览器'等同于'参数生成依赖浏览器运行时'"基于已删除的判定逻辑。

**修复**:
- SKILL.md + stage5.md §5.7 P0 禁令改写为:"禁止因'被加密数据依赖浏览器'而跳过方案 1——skill 只逆向算法,数据由用户提供,参数依赖浏览器不阻碍方案 1"。

### v9.17-5:影响范围(11 处)

| 文件 | 变更 |
|------|------|
| `references/modules/stage5.md` | 新增"职责边界"章节 + §5.2.1-§5.2.4 全部重写 + §5.3.1 Step 2 重写 + §5.6 新增溯源表必填 + §5.7 P0 禁令改写 |
| `references/templates/stage5-verify.md` | §1 方案选择依据示例更新 + §6.2 新增参数溯源表 + 原 §6.2/§6.3 重编号为 §6.3/§6.4 |
| `SKILL.md` | 版本号 v9.16 → v9.17 + 五阶段表格阶段五描述更新 + 模块索引阶段五描述更新 + P0 禁令改写 |
| `changelog.md` | 新增 v9.17 entry |

### v9.17-6:与 v9.16 的对比

| 维度 | v9.16 | v9.17 |
|------|-------|-------|
| 方案 1 必试清单 | 4 条(含"参数生成逻辑不依赖浏览器运行时") | 3 条(只看算法本身) |
| 参数依赖浏览器是否阻碍方案 1 | 是(若参数生成需实时调用浏览器 API 则阻碍) | 否(数据由用户提供) |
| 真正阻碍方案 1 的条件 | 算法不可静态还原 + 参数依赖浏览器运行时 | 只有"算法本身不可静态还原" |
| 参数溯源 | 无 | 强制必填(方案1+方案2) |
| Gotcha 教训 | "数据来自浏览器 ≠ 参数生成依赖浏览器" | "参数来自浏览器不阻碍方案 1,数据由用户提供" |

---

## v9.16

**核心变更**:阶段四/阶段五职责根本性重构 + reference 文档大纲标准化。

**触发原因**:用户提问"阶段4和阶段5他的区别在哪里?阶段4就不能有方案 1:Python 重写方案2这些具体实现"。v9.14/v9.15 虽然把方案1/2判定的"实现内容"清理到阶段五,但"判定逻辑"本身仍在阶段四(§4.2),职责划分仍不彻底。用户要求:阶段四只判分支(A/B/C/D),方案1/2降级链属于"分支方案",是阶段五的事。同时用户给出新的 reference 文档大纲(使用时机/输入/目标与边界/执行规则/流程/产物/GATE/回执),要求 stage4.md 按此大纲重写。

**用户决策**:
- 方案1/2判定整块从阶段四移到阶段五
- 分支 C/E 合并为分支 C(都走方案1/2降级链)
- Webpack 特有处理作为分支 C 子分支保留
- P0 禁令跟随方案1/2判定移到阶段五
- 新大纲先只重写 stage4.md 验证可行性

### v9.16-1:阶段四/阶段五职责根本性重构

**问题**:stage4.md §4.2 越界包含方案1/2判定(状态机 + 必试清单 + 判定条件 + Gotcha),与"阶段四纯判定"原则矛盾。分支 C/E 都走方案1/2降级链,却分成两个分支,增加 Agent 决策负担。

**修复**:
- **stage4.md 重写**(按新大纲:使用时机/输入/目标与边界/执行规则/流程/产物/GATE/回执):
  - 删除 §4.2 方案1/2判定(整块移到 stage5.md §5.2)
  - 删除 §4.1.5 分支 E(无附加保护),合并到分支 C(§4.4)
  - 分支数量:5个(A/B/C/D/E)→ 4个(A/B/C/D)
  - 分支 C 判定条件:"除 A/B/D 之外的所有情况"(Webpack + 无附加保护)
  - Webpack 特有处理作为分支 C 子分支保留(§4.4.1)
  - 新增"本文件不负责"明确边界 + GATE + 回执章节
- **stage5.md 重构**:
  - 新增 §5.2 方案1/2选择判定(分支 C 专用)(从 stage4.md §4.2 移入)
  - 原 §5.2 Python 重写 → §5.3
  - 原 §5.3 iv8 补环境 → §5.4
  - 原 §5.4 验证策略 → §5.5
  - 原 §5.5/§5.6/§5.7 → §5.6/§5.7/§5.8
  - §5.7 新增"禁止跳过方案1必试清单"和"禁止数据来自浏览器误判"两条 P0 禁令(从 stage4.md §4.3 移入)

### v9.16-2:stage4-scheme.md 模板简化(只保留分支选择)

**问题**:v9.15 模板仍含 §2 方案选择状态机 / §3 方案选择结论,与"阶段四纯判定"矛盾。

**修复**:
- 删除 §2 方案选择状态机(移到 stage5-verify.md §1)
- 删除 §3 方案选择结论(移到 stage5-verify.md §1)
- §1 分支选择:选项从 A/B/C/D/E/全量 iv8 改为 A/B/C/D
- §2 分支选择依据(新增,2-3 句话)
- §3 进入阶段五:分支 A/B/D 直接按阶段四流程实现;分支 C 由阶段五做方案1/2选择

### v9.16-3:stage5-verify.md 新增方案选择记录字段

**问题**:方案1/2判定移到阶段五后,stage5-verify.md 需要承接方案选择记录。

**修复**:
- 新增 §1 方案选择(分支 C 必填,分支 A/B/D 跳过):来自 stage4-scheme.md 的分支选择 + 方案选择(1/2)+ 方案选择依据
- §1.1 方案1试跑失败处理引用:§5.2.3 → §5.3.3
- 原 §1-§6 重编号为 §2-§7
- §5.3 回溯动作:新增"阶段五(方案选择)"选项

### v9.16-4:stage_gate.py 阶段5入口检查字段调整

**问题**:阶段5入口检查字段"方案选择+方案选择依据"已不适用(方案选择移到阶段五)。

**修复**:
- stage_gate.py 阶段5入口检查字段:"方案选择"/"方案选择依据" → "分支选择"/"分支选择依据"

### v9.16-5:SKILL.md 更新

**修复**:
- 版本号 v9.15 → v9.16
- 五阶段工作流表格:阶段四"按载体形态走分支 A/B/C/D/E;分支 C/E 按方案 1/2 降级链" → "按载体形态走分支 A/B/C/D(分支 C 合并原 C+E,含 Webpack + 无附加保护);**纯判定,只产出分支选择**"
- 阶段五"本地复现加密参数并验证" → "方案 1/2 判定(分支 C)+ Python 重写 / iv8 补环境 + 验证"
- 模块索引阶段四/阶段五描述同步
- stage_gate.py 检查字段说明同步
- P0 禁令归属:3 条方案1/2相关 P0 禁令的引用从 stage4.md §4.2.x 改为 stage5.md §5.2.x / §5.3.3

### v9.16-6:stage-gate-rules.md 跨文件引用同步

**修复**:
- L34 阶段5入口检查字段:"方案选择+方案选择依据" → "分支选择+分支选择依据"
- L60-63 阶段5入口检查:"方案选择(1 或 2)" → "分支选择(A/B/C/D)";代码文件路径引用 §5.1 → §6.1
- L67-70 阶段5验证不通过:回溯目标从"阶段四"改为"阶段五";方案1失败引用从 §5.2.3 改为 §5.3.3
- L85 阶段四出口验证:删除"方案选择",改为"分支选择(A/B/C/D)"
- L86 阶段五入口 checklist:"方案选择+方案选择依据" → "分支选择+分支选择依据"
- L91 跳步阻断规则:回溯目标从"阶段四(方案选择)"改为"阶段五(方案1/2选择)"

### v9.16-7:跨文件分支引用同步(stage3 / webpack / contract / code-extraction / code-conventions / stage3-labels / iv8-env-patching / evals)

**修复**:
- **stage3.md**:11 处"分支 E"或"分支 C/E"改为"分支 C"(§3.1.1 表格 / §3.1.2 流程 / §3.2 判定规则 / §3.4 兜底规则 / §3.6 标签到分支的映射 / §3.8 Gotcha);§3.4 兜底规则"进入阶段四后,直接走方案2" → "进入阶段五后,直接走方案2";引用 stage4.md §4.2 改为 stage5.md §5.2
- **webpack.md**:"无附加保护(分支 E)" → "无附加保护(v9.16 合并到分支 C)"
- **contract.md**:stage4-scheme.md 注释"方案选择 + 依据(纯判定,不含代码)" → "分支选择 + 依据(纯判定,不含方案1/2选择和代码)"
- **code-extraction.md**:5 处引用更新(头部说明 / §5.1 概述表 / §5.2.1 前置条件 / §5.3 / §5.3.1 / §5.3.2);"分支 C/E" → "分支 C";引用 stage4.md §4.2 改为 stage5.md §5.2
- **code-conventions.md**:引用"stage4.md §4.1、§4.2" → "stage4.md §4.1-§4.5(分支判定)+ stage5.md §5.2(方案 1/2 判定)"
- **stage3-labels.md 模板**:§8 进入阶段四,分支选项从 A/B/C/D/E/全量 iv8 改为 A/B/C/D;"方案选择前置条件已确认"勾选删除;下一步引用 §4.1+§4.2 改为 §4.1
- **iv8-env-patching.md**:检查 2 方案选择回读对象从 stage4-scheme.md 改为 stage5-verify.md §1;回阶段四走方案1 → 回阶段五走方案1
- **evals.json**:eval #17 expected_output "分支 C/E" → "分支 C(v9.16 合并原 C+E)"

## v9.15

**核心变更**:stage4-scheme.md 模板清理——彻底落实"阶段四纯判定"原则,删除模板中残留的阶段五实现内容。

**触发原因**:用户提问"阶段4和阶段5他的区别在哪里?阶段4就不能有方案 1:Python 重写方案2这些具体实现。"v9.14 已修复 stage4.md 主文档的职责越界,但 stage4-scheme.md 模板仍残留 §4 方案1试跑记录 / §5 代码文件路径 / §6 代码文件已创建勾选,与"阶段四纯判定"原则矛盾。同步修复 stage-gate-rules.md / contract.md 中的跨文件引用。

**用户决策**:方案A 彻底清理(删除 §4/§5/§6,试跑记录和代码路径都移到 stage5-verify.md)。

### v9.15-1:stage4-scheme.md 模板清理

**问题**:模板 §4 方案1试跑记录(§4.1 试跑参数 / §4.2 试跑结果 / §4.3 试跑失败处理)+ §5 代码文件路径 + §6 "代码文件已创建"勾选,都是阶段五的实现内容,却出现在阶段四模板里。

**修复**:
- 删除 §4 方案1试跑记录(移到 stage5-verify.md §1.1)
- 删除 §5 代码文件路径(代码文件在阶段五创建,记录在 stage5-verify.md §5.1)
- §6 "进入阶段五"重编号为 §4,删除"代码文件已创建"勾选,只保留"方案选择已记录",下一步指向 stage5.md
- 头部说明:强制字段删除"代码文件路径",新增"本模板仅记录方案判定结论(阶段四纯判定)"说明
- §2.2 表格"方案1已试跑失败"依据:"失败记录见 §4" → "试跑失败记录见 stage5-verify.md §1.1"
- 文件从 73 行缩减到 52 行

### v9.15-2:stage5-verify.md 补全试跑失败处理字段

**问题**:stage4-scheme.md §4.3 试跑失败处理移除后,stage5-verify.md 需要承接该字段。

**修复**:
- §1 验证输入:代码文件来源引用"来自 stage4-scheme.md §5" → "阶段五创建,见 stage5.md §5.2/§5.3"
- 新增 §1.1 方案1试跑失败处理(若曾试方案1且失败):不一致参数 / 是否笔误 / 降级方案2原因 / 禁止动态调试根因分析

### v9.15-3:stage-gate-rules.md 跨文件引用修复

**问题**:4 处引用与"阶段四纯判定"原则冲突。

**修复**:
- L63(阶段5入口说明):"code/ 下代码文件存在性由 stage4-scheme.md §5 记录的路径决定" → "由 stage5-verify.md §5.1 记录的路径决定"
- L69(阶段5验证不通过处理):"IF 方案1失败 → 降级方案2(需在 stage4-scheme.md 更新方案选择)" → "在 stage5-verify.md §1.1 记录降级原因...不回 stage4-scheme.md 更新方案选择,阶段四判定结论为历史记录"
- L85(阶段四出口验证):删除"执行结果(可运行代码或补环境脚本)"和"产物已写入 ./<task>/code/",改为"方案选择 + 方案选择依据 + 产物已写入 stage4-scheme.md(纯判定,代码文件在阶段五创建)"
- L86(阶段五入口 checklist):"阶段四产物文件 stage4-scheme.md 和代码文件存在" → "stage4-scheme.md 存在且齐全(方案选择 + 方案选择依据)";出口"不通过则回溯到阶段四调整方案" → "在 stage5-verify.md §1.1 记录降级原因或回溯上游检查";新增"产物已写入 ./<task>/code/"

### v9.15-4:contract.md 产物目录结构修复

**问题**:stage4-scheme.md 注释含"执行结果"(阶段五内容),code/ 注释为"阶段四产出的代码"(应为阶段五)。

**修复**:
- L37:"stage4-scheme.md # 阶段四:方案选择 + 执行结果" → "阶段四:方案选择 + 依据(纯判定,不含代码)"
- L39:"code/ # 阶段四产出的代码" → "code/ # 阶段五产出的代码"

## v9.14

**核心变更**:阶段四/阶段五职责严格分层 + 修复方案 1 判定条件(浏览器环境动态产生误判)。

**触发原因**:实战中 Agent 把"参数数据来自浏览器"误读为"参数生成依赖浏览器环境",直接跳方案 2,但加密算法本身是纯计算(RSA+AES),输入数据可从 HAR 捕获后传给 Python,方案 1 完全可行。同时发现 stage4.md §4.2 越界包含方案 1/2 的具体实现,与 stage5.md 重复。

**用户决策**:
- 方案A:严格分层(stage4 纯判定,stage5 实现)
- 按"生成逻辑是否依赖浏览器运行时"重构判定
- Gotcha 放 stage4.md §4.2.4
- P0 硬约束

### v9.14-1:阶段四/阶段五职责严格分层

**问题**:stage4.md §4.2 越界包含方案 1/2 的具体实现(产出、重写退出条件、试跑验证、iv8 失败止损规则),与 stage5.md §5.2/§5.3 重复。阶段四应该是纯判定,阶段五才是实现。

**修复**:
- stage4.md §4.2 标题:"方案 1/2 降级链" → "方案 1/2 选择判定"
- stage4.md §4.2.2:删除"实现/重写过程退出条件/试跑验证"(已在 stage5.md §5.2),只保留判定条件
- stage4.md §4.2.3:原"方案 1 试跑失败处理" → 改为"方案 2 触发条件"(试跑失败处理移到 stage5.md §5.2.3)
- stage4.md §4.2.4:原"方案 2:iv8 补环境"(含实现) → 改为"方案 1 判定 Gotcha"
- stage5.md:新增 §5.2.3 试跑失败处理(从 stage4.md 移入)
- stage5.md §5.6:加"禁止方案 1 试跑失败后搭建动态调试环境"禁令(从 stage4.md §4.3 移入)
- stage4.md §4.3:删除阶段五的禁令(iv8 调试无回退、试跑失败禁令),保留阶段四判定禁令 + 新增"禁止把数据来自浏览器等同于生成依赖浏览器"禁令

### v9.14-2:方案 1 判定条件重构(浏览器环境动态产生误判修复)

**问题**:原 §4.2.1 步骤 1 "参数来源全部明确(非浏览器环境动态产生)" 措辞有歧义——Agent 把"数据来自浏览器"误读为"参数生成依赖浏览器",直接跳方案 2。但加密算法本身是纯计算,输入数据可从 HAR 捕获后传给 Python,方案 1 完全可行。

**修复**(stage4.md):
- §4.2.1 步骤 1:"参数来源全部明确(非浏览器环境动态产生)" → "参数生成逻辑不依赖浏览器运行时(见 §4.2.2 判定)"
- §4.2.1 步骤 2:"参数含浏览器环境动态产生" → "参数生成逻辑依赖浏览器运行时"
- §4.2.2:参数来源表重构为"参数生成逻辑是否依赖浏览器运行时"判定表 + If/Then 判定
  - 新增"浏览器环境字段(可从 trace/HAR 捕获)"行,明确不阻碍方案 1
  - 加显式 If/Then:可捕获 → 不阻碍;生成依赖浏览器 → 阻碍
- §4.2.4 新增 Gotcha:极验4 w 参数误判案例(历史教训)

### v9.14-3:SKILL.md P0 禁令新增

- ⛔ 禁止把"参数数据来自浏览器"等同于"参数生成依赖浏览器运行时"(数据可捕获 → 不阻碍方案 1;生成逻辑依赖浏览器 → 阻碍方案 1)
- 更新"禁止方案 1 试跑失败后搭建动态调试环境"引用:stage4.md → stage5.md §5.2.3
- 版本号 v9.13 → v9.14

### v9.14-4:跨文件措辞同步

- stage4-scheme.md §2.1/§2.2:判定条件措辞同步("参数来源全部明确" → "参数生成逻辑不依赖浏览器运行时";"参数含浏览器环境动态产生" → "参数生成逻辑依赖浏览器运行时")
- stage5.md §5.2.1 Step 2:"排除浏览器环境动态产生参数" → "确认参数生成逻辑不依赖浏览器运行时(阶段四已判定,此处复核)"
- code-extraction.md §5.1 概述表:"参数来源明确" → "参数生成逻辑不依赖浏览器运行时";"参数浏览器动态产生" → "参数生成依赖浏览器运行时"

### 兼容性

- 旧任务目录(demo/geetest4 等)无需迁移——模板字段未变,只是判定条件措辞更新
- 历史版本产物文件模板格式不变
- scripts/stage_gate.py 不受影响(阶段门校验逻辑未变)

## v9.13

**核心变更**:按 skill-creator-anthropic 规范重构阶段文档结构——每阶段一个主文档(< 500 行,编排 + 核心规则),深度内容作为子模块按需加载;拆分 decision-tree.md(阶段三/四共用 → 各自独立);同步修复 Webpack 判定问题(特征核对清单 W1-W4 + 模板强制引用特征编号 + Gotcha)。

**用户决策**:
- "想要每个阶段有每个阶段的文档,最好是一个文档"(主文档 + 子模块模式)
- 待确认事项答案:1.b(选项b简短命名) / 2.合并 / 3.a / 4.a / 5.是
- "按推荐方案执行"

### v9.13-1:阶段主文档拆分(4 个新增 + 1 个删除)

- **新增** `references/modules/stage1.md`(阶段一主文档,~120 行):合并 har + trace 编排,含 trace 速查表跨阶段引用
- **新增** `references/modules/stage3.md`(阶段三主文档,~200 行):含载体形态判定矩阵 §3.1 + Webpack 特征核对 §3.2 + Gotcha §3.8
- **新增** `references/modules/stage4.md`(阶段四主文档,~140 行):含分支 A/B/C/D/E §4.1 + 方案 1/2 降级链 §4.2
- **新增** `references/modules/stage5.md`(阶段五主文档,~120 行):含方案 1/2 + iv8 止损 + 验证策略
- **删除** `references/decision-tree.md`:内容已拆分到 stage3.md(§2/§3)+ stage4.md(§4/§6),无独占内容

**目录结构变更**:
- 主文档(stage1/3/4/5.md)< 500 行,负责编排 + 核心规则
- 子模块(har-analysis / trace-analysis / shell-removal / webpack / depend-js-content / code-extraction / iv8-env-patching)保留为深度内容,按需加载
- 跨阶段基础设施(stage-gate-rules / scope / contract / methodology / api-reference / code-conventions)不变

### v9.13-2:Webpack 判定修复(方向 A + B + C 组合)

**触发原因**:实战教训——Agent 看到"无 `__webpack_require__` 字符串"就否定 Webpack,忽略决策树"或模块表对象"备份判定,凭印象写"不符 Webpack 标准"模糊理由。gcaptcha4.js 完全符合 W1-W3 三项结构特征但被误判。若载体清晰度判错就会走错分支,整个产物废。

**修复内容**(stage3.md):
- **方向 A(特征核对清单 W1-W4)**:重构 Webpack 判定为 4 个结构化特征
  - W1:模块表对象(`{0: fn, 1: fn, ...}` 或 `[fn, fn, ...]`)
  - W2:require 函数(`function i(idx) { return modules[idx](...); }`)
  - W3:IIFE 三段式(模块表定义 + require 函数 + 入口调用)
  - W4:`__webpack_require__` 标识(可选,OB 场景常缺失)
  - 判定规则:`IF W1 AND W2 AND W3 均命中 → Webpack`(确定性 If/Then)
- **方向 B(模板强制引用特征编号)**:[stage3-labels.md](references/templates/stage3-labels.md) §2.1 加 W1-W4 必填字段
  - 4 行表格(特征 / 命中状态 / 证据 file:line 引用)
  - 判定理由逐条引用特征编号,**禁止模糊措辞如"不符 Webpack 标准"**
- **方向 C(历史教训写入 Gotcha)**:stage3.md §3.8 加 gcaptcha4.js 误判案例
  - 作为前置警示,阶段三启动时必读
  - 通用启示:任何载体形态判定都必须逐条核对特征清单,禁止凭单一字符串特征下结论

### v9.13-3:SKILL.md 模块索引同步

- 五阶段工作流表:阶段一/三/四/五的"参考模块文件"列更新为新主文档路径
- 模块索引表:
  - 新增"阶段一主文档"行(references/modules/stage1.md)
  - "决策树(含载体形态 §2)"→"阶段三主文档(含载体形态 §3.1 + Webpack 特征核对 §3.2)"
  - 新增"阶段四主文档(含分支 §4.1 + 方案降级链 §4.2)"行
  - 新增"阶段五主文档(含方案 1/2 + 验证)"行
  - HAR 分析 / trace 分析 / 扣代码与本地模拟 / iv8 补环境 标注"子模块,深度内容"
- P0 禁令:`decision-tree.md §6.1` → `stage4.md §4.2.1`

### v9.13-4:跨文件引用同步(11 处)

批量修复 decision-tree.md 残留引用(除 changelog 历史记录外全部修复):
- `templates/stage3-labels.md`:§2/§3/§7/§8 的 decision-tree §2.2/§2.3.1/§3.3/§4 引用 → stage3.md §3.1/§3.4/§3.5 + stage4.md §4.1/§4.2
- `templates/stage4-scheme.md`:§2 方案选择状态机 decision-tree §6.1 → stage4.md §4.2.1
- `methodology.md`:文件头操作步骤引用补充 stage1/3/4/5.md
- `code-conventions.md`:动手前分析引用 decision-tree §4/§6/§8 → stage4.md §4.1/§4.2
- `modules/stage2-tracing.md`:2 处 decision-tree §2 引用 → stage3.md §3.1
- `modules/shell-removal.md`:2 处 decision-tree §3.1 引用 → stage3.md §3.7
- `modules/code-extraction.md`:5 处 decision-tree §2/§4/§6 引用 → stage3.md §3.1 / stage4.md §4.1/§4.2
- `evals/evals.json`:2 处 eval 测试用例 decision-tree §2/§3.3 → stage3.md §3.1/§3.5

### v9.13-5:stage3-labels.md 模板加 W1-W4 必填字段

- §2 载体形态判定矩阵:Webpack 行"必要特征是否命中"列加"(见 §2.1 W1-W4)"指引
- 新增 §2.1 Webpack 特征核对清单(若 Webpack 行勾选"是",必填本节):
  - 判定结论:Webpack / 疑似 Webpack / 非 Webpack
  - 特征核对表(4 行):W1/W2/W3/W4 + 命中状态 + 证据(file:line 引用)
  - 判定理由:逐条引用特征编号,禁止模糊措辞

### v9.13-6:stage3.md §3.9 阶段三专属禁止事项

- ⛔ 禁止凭单一字符串特征(如"无 `__webpack_require__`")否定载体形态(必须按 §3.2 等特征清单逐条核对)
- ⛔ 禁止用"不符 X 标准"等模糊措辞作为判定理由(必须引用特征编号)

### v9.13-7:第二轮审查修复(1 P0 + 4 P1 + 2 P2 + 章节编号一致性)

**触发原因**:v9.13 第一轮完成后再次审查发现 1 P0 + 4 P1 + 2 P2 问题,用户要求"全部修复再次审查"。

**修复内容**:

- **P0-1(stage3.md §3.1.2)**:重写 Webpack 分支与 §3.2 W1-W4 判定规则对齐
  - 原:§3.1.2 用"命中 Webpack 充分特征"模糊措辞,§3.2 用 W1-W3 命中判定,三路径互不一致
  - 修:重写为 W1-W3 均命中 → 确认 Webpack;部分命中 → 疑似;全不命中 → 排除(确定性 If/Then)
- **P1-1(stage3.md)**:修复 Gotcha "决策树"措辞残留(L67, L283)
  - 原:Gotcha 引用"决策树的'或模块表对象'备份判定",但 decision-tree.md 已删除
  - 修:改为"§3.2 的 W1 模块表对象特征"
- **P1-2(stage3-labels.md §2.1)**:W4 必填与可选矛盾
  - 原:模板要求 W4 必填证据,但 stage3.md §3.2 说 W4 可选
  - 修:W4 加"未检查"选项 + 判定理由 W4 标可选
- **P1-3(stage3.md §3.1.1 矩阵)**:矩阵未覆盖"部分清晰"场景
  - 原:矩阵"无附加保护"充分特征只写"清晰",但 §3.1.2 流程有"部分清晰 → 分支 E"
  - 修:矩阵充分特征加"OR 部分清晰(部分清晰时按需补脱 CFF,仍走分支 E)"
- **P1-4(stage5.md §5.1)**:方案入口 IF 逻辑不清晰
  - 原:三个 IF 并列(方案 1 / 方案 2 / 分支 A/B/D),但分支与方案的关系未明确
  - 修:重写为"分支与方案的映射"互斥表,明确分支 A/B/D 不走 §5.2/§5.3
- **P2-2(stage3.md)**:§3.6.3 多特征叠加位置混乱
  - 原:§3.6.3 是判定规则,放在"特征扫描关键词"章节下结构混乱
  - 修:移到独立 §3.5(在 §3.4 兜底规则和标签映射之间)
- **章节编号一致性(本次修复新发现)**:stage3.md 出现两个 §3.6(标签到分支的映射 + 特征扫描关键词)
  - 原因:P2-2 移动 §3.6.3 到新 §3.5 时,未同步把"特征扫描关键词"从 §3.6 顺延为 §3.7
  - 修:特征扫描关键词 §3.6 → §3.7(含 §3.7.1/§3.7.2 子节),Gotcha §3.7 → §3.8,禁止事项 §3.8 → §3.9,下一阶段入口 §3.9 → §3.10
  - 同步更新跨文件引用:stage3-labels.md(§3.7 Gotcha → §3.8 / §3.6.3 → §3.5,共 3 处)、evals.json(§3.6.3 → §3.5,1 处)、shell-removal.md(§3.6 → §3.7,2 处)、changelog.md 历史引用(§3.7/§3.8/§3.6.3/§3.6 共 6 处)

### 兼容性

- 旧任务目录(demo/geetest4 等)无需迁移——模板字段未变,只是引用路径更新
- 历史版本产物文件(stage1-params.md / stage2-output.md / stage3-labels.md / stage4-scheme.md / stage5-verify.md)模板格式不变
- scripts/stage_gate.py 不受影响(阶段门校验逻辑未变)
- depend-js-content.md / deobfuscate.js(v9.12 新增)不受影响

### 不修复内容

- decision-tree.md 在 changelog.md 历史记录中的引用(保留为历史快照,不修改)
- har-analysis.md / trace-analysis.md / code-extraction.md / iv8-env-patching.md 的内部章节编号(仅修改对 decision-tree 的引用,不重构内部结构)

---

## v9.12

**核心变更**:在 `references/modules/stage2-tracing.md §2.1.2-A 字符串数组还原` 主路径第一步集成 Node.js+babel 脚本还原方案,构建"脚本 → 5 步手工 → iv8 动态拉取"三级降级链,并配套 depend.js 编写指南与确定性达标判定标准。

**用户决策**:
- 脚本类型:"nodejs+astbabel"
- 集成位置:"在章节 2.1 字符串可读性恢复(全文件)下的 2.1.2-A 字符串数组还原,第一步改为使用 js 脚本先还原,还原失败就用原本的"
- 失败检测:"无需你创建,我提供给你"(脚本已自带 report.json 字段)
- 作用域限制:"严格只字符串还原"
- 5 次调整:"运行了脚本他是否成功按照我们项目字符串数组还原标准来,如果没有结合项目进行制定,然后没有达到标准进行 5 次机会调整 depend 依赖,没有就方案二"

### v9.12-1:脚本与依赖入仓(3 个新增文件)

- **新增** `scripts/deobfuscate.js`(86716 字节,2569 行):Node.js+babel 字符串数组还原脚本
  - 主函数 `De_string_arraying_obfuscation(ast, DECNAME, dependJsContent)`
  - 自动识别 direct calls / aliases / wrappers / container aliases / object literal maps
  - 内联 wrapper 深度限制 12
  - `eval(dependJsContent)` 执行解密运行时
  - 自检模式 `--self-check`(56 个测试用例,实际运行输出 `deobfuscate self-check passed (56 checks)`)
- **新增** `scripts/package.json`:依赖声明(@babel/parser ^7.29.2 / @babel/traverse ^7.29.0 / @babel/types ^7.29.0 / @babel/generator ^7.29.1)
- **新增** `references/modules/depend-js-content.md`(10766 字节,457 行):AI 编写 depend.js 的配套指南
  - 4 类组件识别:字符串数组 / 旋转 IIFE / 解密函数 / helper
  - 组装顺序规则(基于声明提升)
  - 反调试处理 / 浏览器 API 最小 stub / 安全边界
  - 自检清单 13 项 + 验证标准

### v9.12-2:§2.1.2-A 重构为三级降级链

- **旧版**:主路径(5 步静态执行)+ 降级路径(iv8 动态拉取),二级结构
- **新版**:方案一(脚本)+ 方案二(5 步手工)+ 方案三(iv8 动态拉取),三级降级链
- **方案一 CLI 签名**:`node scripts/deobfuscate.js --input <in.js> --output <out.js> --depend <depend.js> --decrypt <name> [--report-out <report.json>]`
- **原"主路径"重命名**:"方案二:5 步手工路径(降级路径)"
- **原"降级路径"重命名**:"方案三:iv8 动态拉取(降级路径)"
- **循环依赖检测规则**适用范围收窄:"仅适用于方案二/方案三"

### v9.12-3:达标判定标准(双重,确定性 If/Then)

- **标准 A(机器判定,基于 report.json,三级)**:
  - 完全达标:`replacedCalls == targetCalls` AND 3 项失败计数 == 0
  - 部分达标:`replacedCalls / targetCalls >= 0.95` AND `staticArgumentFailures == (targetCalls - replacedCalls)`(剩余走方案二手工补,不进入 depend 调整循环)
  - 未达标:`replacedCalls / targetCalls < 0.95` OR `evalFailures > 0` OR `unsupportedResultFailures > 0` → 进入 depend 调整循环
- **标准 B(人工抽检,确定性抽样)**:
  - 抽样数量分层:`targetCalls <= 10` 全抽 / `10 < targetCalls <= 100` 抽 10 个 / `targetCalls > 100` 抽 5 个
  - 抽样方法:分层(头部/中部/尾部)
  - 验证方法:AST 提取字面量 + iv8 Hook 解密函数返回值 + 比对

### v9.12-4:depend 调整循环(最多 5 次,含首次运行)

- **立即降级**(不消耗次数):首次运行 `staticArgumentFailures > 0` 且 `replacedCalls / targetCalls < 0.95` → 直接降级方案二
- **提前降级**(消耗 1 次后判定):连续 2 次相同失败字段(`evalFailures > 0` 或 `unsupportedResultFailures > 0`)→ 提前降级方案二
- **正常降级**:5 次调整后仍未达标 → 降级方案二
- **每次 attempt 流程**:诊断 → 修订 depend.js → 单测 → 重跑脚本 → 达标判定

### v9.12-5:§2.1.4 终止条件对齐脚本路径

- **旧版**:终止条件 1 为"所有 `_0xabc(idx)` / `_0xdef("密文")` 调用点已替换为字符串字面量"(不区分路径)
- **新版**:终止条件 1 按路径判定:
  - 方案一(脚本):`report.json replacedCalls == targetCalls` OR 部分达标且剩余走方案二补全
  - 方案二(手工):所有调用点已替换为字符串字面量
  - 方案三(iv8):iv8 dump 的字符串表已回填全文件调用点
- 终止条件 2(结构可辨识)保持不变

### v9.12-6:P0 禁令(脚本作用域硬约束)

- 脚本必须严格只做字符串数组还原
- 禁止启用变量重命名 / CFF 还原 / 死代码消除 / helper 内联 / 属性访问标准化 / 全量 beautify
- 脚本不得修改原文件的非字符串调用点
- 违反 → 阶段二产物失效,触发阶段门阻断
- **依据**:脚本实际行为已天然满足此约束,无需修改脚本

### 兼容性承诺(未变更)

- 方案二(5 步手工路径)的 5 个步骤内容不变,仅从"主路径"重命名为"方案二(降级路径)"
- 方案三(iv8 动态拉取)的触发条件与动作不变,仅从"降级路径"重命名为"方案三(降级路径)"
- 循环依赖检测规则的 3 个 If/Then + 兜底不变,仅适用范围收窄为"方案二/方案三"
- §2.1.2-B 字符串解密还原不变
- §2.1.3 输出定型不变
- §2.1.5 范围说明不变

### 新增前置依赖

- Node.js ≥ 18(原 compatibility 字段已提及 Node.js 为可选依赖,本次升级为方案一必需)
- babel 4 件套(@babel/parser / @babel/traverse / @babel/types / @babel/generator ^7.29.x)
- 安装方式:在 `scripts/` 目录下 `npm install`(package.json 已声明)

### 不修复的内容(本次不动)

- **方案二/方案三的内部逻辑**:仅重命名和适用范围收窄,不改动判定规则
- **SKILL.md compatibility 字段**:不在 frontmatter 加 babel 依赖(避免污染 Python 主依赖语义),babel 依赖在 `scripts/package.json` 与 `stage2-tracing.md §2.1.2-A 方案一` 内声明
- **depend-js-content.md 内容**:直接复制自 `e:\temp\AST\references\`,保持原样不修改(文档已自成体系)

## v9.11

**核心变更**:基于用户实战反馈重构 `scripts/stage_gate.py`,解决阶段门检测机制的三个脆弱性问题(用户评分"易用性 6/10",最想改进的一点)。

**用户反馈**:
- "stage_gate.py 在 Windows 下中文匹配有编码问题"
- "### 子标题会打断 ## 父节的内容扫描,需要加 summary 段落绕过,有点绕"
- "_has_real_content 的清洗逻辑过于激进"
- "中文编码处理不够健壮"

### v9.11-1:Windows 编码鲁棒性(_read_md_robust)

- **旧版**:`read_text(encoding="utf-8", errors="ignore")` 在 GBK 文件下吞字符,导致中文匹配失效
- **新版**:新增 `_read_md_robust(path)`,编码 fallback 链 utf-8(strict)→ gb18030(strict)→ utf-8(replace)
- **关键**:`errors="replace"` 用 � 替换不可解码字节(可识别),不再用 `errors="ignore"`(吞字符)
- **新增内部常量** `_ENCODING_FALLBACK`,新增编码只改此常量

### v9.11-2:### 子标题不再打断 ## 父节(_extract_section)

- **旧版**:`re.match(r"^#{1,3}\s", lines[j])` 一刀切扫描到任何 heading 就 break,`###` 子节被排除在 `##` 父节判定外
- **新版**:新增 `_extract_section(lines, heading_idx, heading_level)`,break 规则改为"同级或更高级 heading"(level <= current_level),更低级 heading(如 `###` 在 `##` 之下)被包含进父节内容
- **新增辅助函数** `_parse_heading_level(line)`,解析 ATX heading 级别(1-6)
- **效果**:用户不再需要加 summary 段落绕过

### v9.11-3:_has_real_content 清洗规则收窄(逐行判定)

- **旧版**:`re.sub(r"[\s\|☐✓\-—>*]", "", cleaned)` 一刀切吞表格分隔符、bullet、复选框 → 假阳性(空结构也能过)+ 假阴性(合法格式被误清洗)
- **新版**:逐行清洗,只剔除行首 markdown 标记(bullet / checkbox / 表格 `|`),保留单元格内容;纯分隔线行(`|---|---|`)跳过
- **关键判定**:清理后必须含至少一个字母数字字符(`any(ch.isalnum() for ch in line)`)才算实际内容,避免"加密点位: <file>:<line>"清理后剩 `: :` 被误判为有内容
- **效果**:表格内容保留,占位符识别为空,纯占位符表格识别为空

### v9.11-4:stdout 强制 UTF-8(_ensure_utf8_stdout)

- **旧版**:Windows 默认 stdout GBK,输出 JSON 中文乱码
- **新版**:新增 `_ensure_utf8_stdout()`,启动时 `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`(Python 3.7+)
- **降级**:低版本无 reconfigure 方法或重配失败时静默降级(不影响主流程)

### v9.11-5:公开 check_stage API

- **旧版**:`_check_stage` 为私有函数(带下划线),其他脚本/测试无法直接调用
- **新版**:改为公开 `check_stage(task_dir, stage) -> CheckResult`,供程序化调用
- **签名**:`(task_dir: Path, stage: int) -> CheckResult`,2 个参数均为最小必要集
- **签名变更**:`_find_field_in_md(md_path, field_name)` → `_find_field_in_md(md_text, field_name)`,解耦文件 IO 与文本扫描(便于单测)

### v9.11-6:验证(8 个测试全过)

- 测试 1:标准 utf-8 markdown → PASS
- 测试 2:`###` 子节不打断 `##` 父节 → PASS
- 测试 3:`_extract_section` 单元测试 — `###` 子节内容包含进 `##` 父节
- 测试 4:`_has_real_content` 表格内容保留 → True
- 测试 5:纯占位符(`<file>:<line>` / `____` / `☐`)识别为空 → False
- 测试 5b:字段名+占位符行清理后识别为空 → False
- 测试 6:纯占位符表格(`| <file> | <line> |` + `| ____ | ____ |`)识别为空 → False
- 测试 7:gb18030 编码文件 fallback 读取 → 含中文正确
- 测试 8:GBK 文件 stage 2 检查 → PASS
- CLI 端到端:PASS 退出码 0 / BLOCK 退出码 1 / JSON 中文正常输出

### 兼容性承诺(未变更)

- CLI 命令 `uv run scripts/stage_gate.py --stage N --task-dir ./xxx` 不变
- 退出码 0/1/2 不变
- stdout JSON 字段(status/stage/checked_file/missing/action)不变
- 阶段规则表 `_STAGE_RULES` 内容不变

### 不修复的内容(用户反馈其他 3 个难题,本次不动)

- **iv8 debug 日志量**:v9.10 已改大文件工作流(prod → debug + 日志分离 → grep 过滤),独立于 stage_gate.py
- **IIFE 闭包单体不可拆分**:设计允许(走 iv8 兜底是预期路径),非脚本 bug
- **跨平台 shell/uv run/LC_ALL**:stage_gate.py 本身不依赖 shell/LC_ALL,Python 跨平台已处理;其他模块的 shell 假设是独立问题

## v9.10

**核心变更**:删除并禁用两个不再支持的概念:`with_devtools`(DevTools 相关 API)+ `Black-box reuse` 模式。用户反馈两个概念在实战中产生混淆(iv8 反调试走 vdebugger + vconsole,不走 DevTools;iv8 补环境失败应触发阶段门阻断,不走 Black-box 兜底)。

**用户决策**:
- `with_devtools`:"彻底删除 + 禁用"
- `Black-box reuse`:"删除模式 + 触发阶段门阻断"(iv8 跑不通时触发阶段门阻断 → 回溯阶段二检查依赖链完整性 → 无法修复则走"任务失败交付物"流程)

### v9.10-1:新增 2 条 P0 禁令(SKILL.md L139-140)

- ⛔ 禁止使用 `with_devtools` / `watch_apis` / `enable_console` 等 DevTools 相关 API(iv8 反调试走 `vdebugger;` + `vconsole.log` + `wrapNative`,不走 DevTools;定位环境探测点用 `mode='debug'` + 日志分离 + grep 过滤)
- ⛔ 禁止使用 Black-box reuse 模式(已删除)。iv8 补环境失败时触发阶段门阻断 → 回溯阶段二检查依赖链完整性 → 无法修复则走"任务失败交付物"流程,不允许走 Black-box 兜底

### v9.10-2:删除 with_devtools API 定义与用途说明

- `api-reference.md`:删除 with_devtools 方法行 + 用途说明章节;mode 描述"启用 API 监控 + DevTools" → "启用 API 监控"
- `iv8-env-patching.md`:wrapNative 示例改用 `with iv8.JSContext(mode='debug', js_api="__ZY__") as ctx:`;诊断章节改用 `mode='debug'` + 日志分离 + grep;API 速查删除 with_devtools 行;大文件 debug 工作流改写(prod → debug + 日志分离 → grep 过滤)

### v9.10-3:删除 Black-box reuse 模式整章

- `code-extraction.md`:§5.4 Black-box reuse 整章删除(§5.4.1 适用场景 / §5.4.2 输入输出边界 / §5.4.3 实现方式)
- §5.1 模式表删除 Black-box reuse 行;§5.3.2 子模式从"两种(透明+Black-box)"→"只有透明模式";§5.7 与禁止事项改为"已禁用"

### v9.10-4:改写降级路径为阶段门阻断

- `decision-tree.md` §2.3.1:"转 Black-box reuse 模式" → "触发阶段门阻断,回溯阶段二检查依赖链完整性"
- `decision-tree.md` §4.4:"主线程 Hook postMessage 拿输入输出做 black-box" → "全量 iv8 兜底;若仍失败触发阶段门阻断,Black-box 模式已禁用"
- `iv8-env-patching.md` L298:Black-box 降级路径 → "触发阶段门阻断"
- `SKILL.md` 失败报告示例:删除"考虑 Black-box reuse 模式"行
- `SKILL.md` 模块索引:"扣代码模式 + Black-box reuse" → "扣代码模式 + iv8 补环境模式"

### v9.10-5:修复 watch_apis/enable_console 推荐使用残留(11 处)

**残留位置**(均在推荐使用语境,改为"日志分离 + grep"或不提):
- `api-reference.md` L90:用 vdebugger + vconsole + watch_apis 调试 → + 日志分离
- `iv8-env-patching.md` L23:同上
- `iv8-env-patching.md` L152:用 watch_apis 在这些点断下 → 日志分离 + grep 定位
- `iv8-env-patching.md` L315:用 watch_apis 断点确认具体 API → 日志分离 + grep
- `iv8-env-patching.md` L327:用 watch_apis 断点 → 日志分离 + grep 定位
- `iv8-env-patching.md` L356:用 watch_apis 断点对比 → 日志分离 + grep 对比
- `iv8-env-patching.md` L486:OB 壳 DOM 代理映射 用 watch_apis 断点确认 → 日志分离 + grep
- `shell-removal.md` L135:page.load + watch_apis 动态溯源 → + 日志分离动态溯源
- `shell-removal.md` L279:enable_console=False+vconsole 隐藏日志 → vconsole 隐藏日志(不走 console.log)
- `code-conventions.md` L205+L211:`enable_console=False` 时禁止用 console.log → 无条件禁止用 console.log
- `stage2-tracing.md` L234-236:watch_apis 断点监控 → 日志分离 + grep 监控

### v9.10-6:evals.json 6 个条目同步更新

id 3 / id 4 / id 8 / id 20 / id 25 / id 42:删除 with_devtools/watch_apis 推荐,改为"禁止使用 with_devtools/watch_apis(已禁用)"声明

**效果**:
- with_devtools/watch_apis/enable_console 在 skill 当前文件中只剩禁令声明("已禁用")与 changelog 历史记录
- Black-box reuse 在 skill 当前文件中只剩禁令声明("已禁用")与 changelog 历史记录
- iv8 反调试路径统一为:vdebugger; + vconsole.log + wrapNative + mode='debug' + 日志分离 + grep
- iv8 补环境失败路径统一为:触发阶段门阻断 → 回溯阶段二 → 无法修复走"任务失败交付物"流程

## v9.9

**核心变更**:基于 agent-skills-creation 规范严格审查后修复 6 项缺陷(1 P0 + 4 P1 + 1 P2)。SKILL.md token 从 ~13501 降至 ~5969(-56%),接近 ch02/ch08 <5000 tokens 硬约束。

**规范依据**:agent-skills-creation ch02(Specification:Progressive Disclosure Token Budget + frontmatter 字段表)+ ch04(Best Practices:Calibrate Control + Spend Context Wisely)+ ch07(Using Scripts:PEP 723)+ ch08(Adding Support:Three-Tier Loading)。

### v9.9-1:P0-1 SKILL.md 瘦身(token 超预算修复)

**触发原因**:审查发现 SKILL.md 字符数 20252 / 估算 tokens ~13501,严重超出 ch02/ch08 规定的 Instructions <5000 tokens 硬约束(超 60%+)。

**修复**(SKILL.md 重写 + 新建 3 个 references/ 文件 + 追加 2 个现有文件):
- SKILL.md 行数 459 → 192(-58%),字符 20252 → 8954(-56%),tokens 13501 → 5969(-56%)
- 外移 5 个章节到 references/:
  - 阶段门 L1 文档层(人类可读规则)→ 新建 `references/stage-gate-rules.md`(80 行)
  - 适用范围与边界 → 新建 `references/scope.md`(33 行)
  - 输入/输出契约 + 产物持久化 → 新建 `references/contract.md`(52 行)
  - 壳(Shell)定义 → 追加到 `references/modules/shell-removal.md` §0(43 行,5 个子章节 §0.1-§0.5)
  - OB 壳 DOM 代理映射 Gotcha → 追加到 `references/modules/iv8-env-patching.md` "关键提醒"
- 删除 4 个重复章节:
  - "阶段门:入口 checklist 与出口验证"(与 L10-42 阶段门阻断规则重复)
  - "核心方法论"(已有 references/methodology.md)
  - "参数分析模板"(与模块索引重复)
  - "代码模板"(与模块索引重复)
  - "关键提醒"(与 P0/P1 禁令 + 正例返例重复,仅 L455 Gotcha 外移保留)
- 删除"正例/返例对照"章节(与 P1 流程约束内容重复,无信息损失)
- 模块索引扩展:新增"阶段门规则""适用范围与边界""输入/输出契约"3 行,SKILL.md 顶部即可索引到所有外移内容
- 版本号 v9.8 → v9.9

**效果**:SKILL.md 符合 ch02/ch08 三层加载 token 预算;Agent 激活时只加载核心执行规则,详细规则按需从 references/ 加载(Progressive Disclosure)。

### v9.9-2:P1-1 frontmatter version 移到 metadata

**触发原因**:审查发现 frontmatter 使用非标字段 `version`(ch02 Reference Table 仅列:name / description 必需 + license / compatibility / metadata / allowed-tools 可选)。

**修复**(SKILL.md L1-7):
- `version: "v9.8"`(L3)→ `metadata:\n  version: "v9.9"`(L5-6)

**效果**:frontmatter 符合 ch02 规范字段表;version 作为 metadata 子字段保留(维护者查阅)。

### v9.9-3:P1-2 删除 deobfuscation.md.bak

**触发原因**:审查发现 `references/modules/deobfuscation.md.bak`(303 行)残留,.bak 是临时备份文件,不应进入 skill 发布物,且部分 agent 扫描 .md 时可能误读老版本内容。

**修复**:删除 `references/modules/deobfuscation.md.bak`。

**效果**:references/modules/ 目录清洁,无冗余文件。

### v9.9-4:P1-3 code-conventions.md L119 模糊词"合理"违规规则一

**触发原因**:审查发现 L119 "返回合理默认值" 违反规则一(严禁使用"合理"/"适当"/"必要时"等模糊修饰词)。

**修复**(references/code-conventions.md L120):
- "返回合理默认值:桩函数返回目标 JS 不会因解构/属性访问报错的默认值(空数组、空对象、null)。"
- → "返回安全默认值(三选一):桩函数返回以下三类默认值之一——空数组 `[]` / 空对象 `{}` / `null`,确保目标 JS 不会因解构/属性访问报错。"

**效果**:符合规则一(确定性分支逻辑),三类默认值显式枚举。

### v9.9-5:P1-4 shell-removal.md L235 模糊词"合理"违规规则一

**触发原因**:审查发现 L235 "内置 navigator/window/document 等浏览器环境有合理默认值" 违反规则一。

**修复**(references/modules/shell-removal.md L235):
- "内置 navigator/window/document 等浏览器环境有合理默认值"
- → "内置 navigator/window/document 等浏览器环境默认值已对齐 Chrome/Windows 基线(详见 [api-reference.md](../api-reference.md) 安装与运行环境)"

**效果**:符合规则一;模糊词"合理"替换为可验证的"对齐 Chrome/Windows 基线"+ 引用 api-reference.md。

### v9.9-6:P2-1 trace_analyzer.py 加 PEP 723 头(最小修复)

**触发原因**:审查发现 trace_analyzer.py 不完全符合 ch07 自包含脚本规范——缺 PEP 723 头(`# /// script` + `# dependencies = []`)。

**修复**(scripts/trace_analyzer.py L1-3 + L640):
- 文件顶部加 PEP 723 头(声明无外部依赖,符合规范形式):
  ```python
  # /// script
  # dependencies = []
  # ///
  ```
- usage 提示从 `python trace_analyzer.py` 改为 `uv run scripts/trace_analyzer.py`(与 stage_gate.py 一致,符合 ch07 用法约定)
- 测试:无参数运行仍返回 exit code 2 + usage 提示到 stderr(符合 ch07 Data vs Diagnostics)

**遗留**(后续迭代):
- argparse --help 完整支持(当前用 sys.argv 手工解析)
- 关键命令(stats/diff)JSON 输出(当前是自由文本表格)

**效果**:trace_analyzer.py 符合 ch07 PEP 723 形式规范;两个 scripts/ 脚本(stage_gate.py + trace_analyzer.py)统一用 `uv run scripts/xxx.py` 调用方式。

## v9.8

**核心变更**:针对实战中 AI 多次跳过阶段门直接进入下一阶段的问题,把阶段门从"文档式 If/Then 软约束"升级为"脚本运行时硬阻断"。新增 `scripts/stage_gate.py`,每个阶段进入前必须运行该脚本看到 `PASS` 才能继续,看到 `BLOCK` 必须回退补齐。Agent 无法绕过。

**规范依据**:agent-skills-creation ch04(Calibrate Control to Fragility:阶段门是脆弱操作,必须 prescriptive,不能给 freedom)+ ch07(Self-contained Scripts:PEP 723 内联依赖 + --help + 结构化 JSON 输出 + 数据到 stdout/诊断到 stderr)+ ch04 Validation Loops(做工作 → 运行验证器 → 修复 → 重复直到通过)。

### v9.8-1:新增 scripts/stage_gate.py 自包含检查脚本

**触发原因**:用户反馈"AI 不按照 skill 走,老是越级,必须强制"。v9.7 之前阶段门是 If/Then 文档式 checklist,实战中 AI 多次跳过(SKILL.md L10 的状态机是软约束,被忽略)。

**修复**(scripts/stage_gate.py 新增,PEP 723 自包含):
- 用法:`uv run scripts/stage_gate.py --stage N --task-dir <path>`
- 退出码:0=PASS / 1=BLOCK / 2=ARGS
- 输出:stdout JSON `{"status","stage","checked_file","missing","action"}`
- 检查规则(内部常量,Agent 不需记忆):
  - stage 2 入口:stage1-params.md 含「参数溯源表」「透传链路图」「_initiator.stack」
  - stage 3 入口:stage2-output.md 含「加密点位」「依赖链」「变换台账」「载体清晰度初判」
  - stage 4 入口:stage3-labels.md 含「载体形态判定结论」「载体清晰度最终判定」「判定依据」
  - stage 5 入口:stage4-scheme.md 含「方案选择」「方案选择依据」
  - stage 6 入口(交付前):stage5-verify.md 含「验证方式」「验证结果」「最终交付物」
- 字段匹配:markdown heading(## 字段名)+ section 内容非占位符;占位符过滤(`<file>:<line>` / `____` / `☐` 未勾选复选框)
- BLOCK 时 action 字段给回退指令:"必须回到阶段 N-1 补齐产物文件,然后重新运行本检查"

**设计原则**(深函数):
- 对外只暴露 `main()`,调用者只需知道命令 + 退出码
- 检查规则在 `_STAGE_RULES` 内部常量,修改不影响调用方
- `_check_stage` / `_find_field_in_md` / `_is_placeholder` / `_has_real_content` / `_build_block_message` 全部内部函数

**测试**:
- PASS 场景(完整 stage1-params.md):exit 0 + JSON `{"status":"PASS"}`
- BLOCK 场景(缺「透传链路图」「_initiator.stack」):exit 1 + JSON `{"status":"BLOCK","missing":["透传链路图","_initiator.stack"]}`
- 缺任务目录:exit 1 + JSON `{"missing":["任务目录 ./xxx 不存在"]}`
- `--help` 正常输出

**修复的 Bug**:
- heading 正则缺 `#`(原 `^{{1,3}}` → 修复为 `^#{{1,3}}`)→ re.error "nothing to repeat"
- 删除规则 3(字段名直接出现):过宽,文档注释中提到字段名时误报 PASS

### v9.8-2:SKILL.md 阶段门章节升级为脚本硬阻断

**触发原因**:原"阶段门阻断规则(启动前必读,If/Then 状态机)"是文档软约束,AI 可跳过。

**修复**(SKILL.md L10-80 重写):
- 章节标题:"阶段门阻断规则(启动前必读,If/Then 状态机)" → "阶段门阻断规则(启动前必读,脚本硬阻断)"
- 新增"强制前置(L3 指令层,违反 → 产物无效 + 阶段门阻断)":If/Then 状态机要求进入阶段 N 前必须运行 `uv run scripts/stage_gate.py --stage N`,看到 PASS 才能继续;跳过 → 产物无效 + P0 阶段门阻断
- 新增"stage_gate.py 检查范围"清单(5 个阶段入口 + 检查字段)
- 原 If/Then 状态机降级为"人类可读规则(L1 文档层,供维护者查阅;实际执行以脚本为准)"
- 版本号 v9.7 → v9.8
- P0 硬约束新增:"⛔ 禁止跳过 `scripts/stage_gate.py`(进入阶段 N 前必须运行 `uv run scripts/stage_gate.py --stage N --task-dir <path>`,看到 PASS 才能继续;跳过 → 产物无效)"

**三层强制机制**:
| 层 | 机制 | 强制度 |
|----|------|--------|
| L1 文档 | SKILL.md If/Then 状态机(降级为说明) | 软约束 |
| L2 脚本 | stage_gate.py 检查产物文件 + 字段,返回 PASS/BLOCK | 硬检查 |
| L3 指令 | "调用任何阶段 N 工具前必须先运行 stage_gate.py N 通过"(SKILL.md P0) | 固化前置 |

### v9.8-3:5 个 stage 模板顶部加入口提示

**修复**(references/templates/):
- stage2-output.md:顶部加"入口前必读:进入阶段二前,必须运行 `uv run scripts/stage_gate.py --stage 2 --task-dir <path>` 并看到 `PASS`。看到 `BLOCK` 必须按 `action` 字段回退到阶段一补齐。跳过本检查 → 产物无效。"
- stage3-labels.md:同上,回退到阶段二
- stage4-scheme.md:同上,回退到阶段三
- stage5-verify.md:同上,回退到阶段四 + 新增"任务交付前最终检查:填写完毕后,运行 `uv run scripts/stage_gate.py --stage 6 --task-dir <path>` 确认交付物齐全"
- param-analysis.md(阶段一):无前置,不加

**效果**:每个阶段模板顶部都有显式入口提示,AI 在加载模板时就能看到强制前置,不会忽略。

### v9.8-4:evals.json 新增 3 个越级阻断测试用例

**修复**(evals/evals.json,id 48-50):
- id 48:跳过阶段一直接溯源 → 必须 stage_gate.py --stage 2,未写 stage1-params.md → BLOCK,回退补齐
- id 49:stage2-output.md 缺「变换台账」「载体清晰度初判」直接进阶段三 → 必须 stage_gate.py --stage 3,BLOCK,JSON.missing 列出缺失字段
- id 50:完成阶段四直接交付代码 → 必须 stage_gate.py --stage 6 检查 stage5-verify.md,BLOCK,回退阶段五写验证报告

**效果**:evals 覆盖越级阻断场景,可验证 AI 是否按 stage_gate.py 强制前置执行。

### v9.8-5:修复 v9.7 重命名遗漏(stage4-scheme.md L5)

**触发原因**:v9.7 全局重命名"方案 3" → "方案 2" 时,L5 写的是"方案选择(1 或 3)"而非"方案 3"完整模式,replace_all 未命中。

**修复**(references/templates/stage4-scheme.md L5):
- "方案选择(1 或 3)" → "方案选择(1 或 2)"

**效果**:方案编号表述全局统一。

### v9.8-6:IIFE 闭包单体判定条件放宽(识别"前缀赋值 + IIFE"混合结构)

**触发原因**:实战中 gcaptcha4.js 结构是"前缀全局辅助函数赋值 + 核心 IIFE",原判定条件"文件以 IIFE 或立即执行函数开头"不满足(文件以 `_xxx.$_AA = function(){...}();` 开头),导致 IIFE 闭包单体漏判,无法触发 page.load 整个 JS 例外条款。

**修复**(SKILL.md L95-126 + stage3-labels.md §4):
- 判定条件从"文件以 IIFE 开头"放宽为两步判定:
  - 步骤 1 结构识别(任一命中):纯 IIFE 结构(原条件)/ 混合结构(grep 命中 `!function(` 或 `(function(` 且核心加密逻辑落在 IIFE 内)
  - 步骤 2 闭包不可独立提取性:grep 搜不到模块导出语句 + 函数不可独立提取(copy 到独立文件报错缺闭包变量)
- 混合结构典型形态(gcaptcha4.js)写入 SKILL.md 作为参考:
  ```
  _xxx.$_AA = function(){...}();    // 前缀:全局辅助函数赋值
  function _xxx(){}
  !function(){                      // 核心 IIFE 从此处开始
     !function(){...}()
  }();
  ```
- stage3-labels.md §4 模板判定依据项扩展为"三项全填":
  - 步骤 1 结构识别(纯 IIFE / 混合结构二选一,混合结构需填 IIFE 行号 + 核心加密逻辑 file+line+col)
  - 步骤 2 闭包不可独立提取性(grep 模块导出语句 + 函数可独立提取性检查)

**效果**:gcaptcha4.js 这类"前缀赋值 + IIFE"混合结构能正确判定为 IIFE 闭包单体,触发 page.load 整个 JS 例外条款;同时保持严格性(步骤 2 防止把可拆分的模块化代码误判为 IIFE 闭包单体)。

### v9.8-7:iv8 debug 模式大文件日志量预警 + 3 步调试工作流

**触发原因**:实战中 mode='debug' 加载 676KB gcaptcha4.js 输出 7MB+ "实例访问"日志(每个 `_xxx` 属性访问打印一行),有效信息(字符串表、错误信息)被淹没。原 skill 只在"日志分离"小节提了 stderr 重定向,但没有预警大文件场景下日志量量级,也没有给出"先 prod 再 watch_apis 再全量 debug"的分级调试工作流。

**修复**(references/modules/iv8-env-patching.md "补环境标准工作流"第一步后):
- 新增 Gotcha:"大文件 debug 日志量预警"——500KB+ 混淆文件 debug 模式日志可达数 MB(实测 gcaptcha4.js 676KB → 7MB+)
- 新增强制工作流(If/Then):
  ```
  IF 目标 JS ≥ 500KB
     THEN 禁止直接 mode='debug' 全量加载
     1. 先 mode='prod' 加载,确认无报错
     2. 需追踪特定 API → mode='debug' + watch_apis 过滤(精准打印,日志量可控)
     3. watch_apis 无法定位 → 全量 mode='debug' + 日志分离(stderr 重定向到文件,grep 过滤)
  ```
- 新增禁止项:✗ 500KB+ 文件直接 `mode='debug'` 不重定向 stderr;✗ 用全量 debug 模式去"看看到底访问了什么"(用 watch_apis 精准过滤)

**效果**:大文件场景下 AI 按分级工作流调试,避免被 7MB+ 日志淹没;watch_apis 精准过滤成为首选,全量 debug + 日志分离降为兜底方案。

## v9.7

**核心变更**:基于 v9.6 skill 执行后 18 题校验问卷反馈,修复 2 个 P1 缺陷 + 3 个 P2 缺陷;同时把"方案 1/3 降级链"重命名为"方案 1/2 降级链",消除序号断档(原方案 2 在 v9.0 已删除,序号 3 改为 2 更自然)。

**规范依据**:agent-skills-creation ch04(Calibrate Control to Fragility:脆弱操作必须 prescriptive)+ ch06(Eval-Driven Iteration:基于执行反馈迭代)。

### v9.7-1:P1-1 stage2-trace.md 文件名混淆修复

**触发原因**:AI 在 18 题问卷中,把流程文件 stage2-tracin**g**.md 的子章节序号(§2.1-§2.6)错填进产物模板 stage2-trac**e**.md,导致下游阶段引用错位。两文件名仅差一个 "ing",认知歧义高。

**修复**:
- 重命名模板文件 `references/templates/stage2-trace.md` → `references/templates/stage2-output.md`
- 同步重命名产物文件名:`./<task-name>/stage2-trace.md` → `./<task-name>/stage2-output.md`
- 6 个文件(SKILL.md / stage2-tracing.md / stage3-labels.md / iv8-env-patching.md / stage2-output.md 自身)的引用全部更新
- stage2-output.md 顶部加显式标注:"本模板是 stage2-output.md(产物),流程文件是 stage2-tracing.md(流程),两者职责不同,不要混淆"

**效果**:产物文件名(output)与流程文件名(tracing)语义清晰区分,AI 不再混淆。

### v9.7-2:P1-2 iv8 失败止损规则"同类错误"定义模糊修复

**触发原因**:AI 在 18 题问卷中,把 3 个不同报错信息(沙箱 exit code 49 / UnicodeEncodeError / 构造函数缺少 config 属性)都归为"不同类",规避 3 次止损规则,在 iv8 调试循环中耗 30-40 分钟。原规则"同类错误连续 3 次"未定义"同类",AI 可任意归类。

**修复**(iv8-env-patching.md):
- 新增"同类错误分类清单"表(5 类):沙箱/进程错误、编码错误、属性缺失错误、类型错误、超时错误
- 每类列典型报错模式 + 归类依据
- 归类规则:报错信息匹配任一分类的"典型报错模式" → 归入该分类;同一分类内连续 3 次报错(报错信息可能不同) → 触发回退
- 跨分类切换:各分类独立计数,不重置;但累计总数持续累加至 6 次兜底(原有规则保留)
- 把"失败计数定义"中"同一报错信息或同一类缺失 API"改为"按 5 类分类清单归类"

**效果**:AI 不能再通过把每个错误都归为"不同类"来规避止损;同类(如属性缺失错误)内连续 3 次即触发回退。

### v9.7-3:P2-3 trace 必需性表述统一

**触发原因**:AI 在 18 题问卷中反馈"甚至没有读取 trace 文件",但仍跑了方案 2(原方案 3)。SKILL.md L122 写"无 trace 则方案 3 不可用",L273 写"trace value 仅作基准值参考"——表述矛盾。

**修复**(SKILL.md L122 + L125 + L258):
- L122:"无 trace 则方案 2(iv8 补环境)不可用" → "无 trace 则方案 2 环境补全缺少基准值,需在 iv8 debug 中逐步探测缺口(效率降低,但非不可用)"
- L125:"方案 3 不可用" → "方案 2 仍可用但环境补全效率降低(无基准值,需 iv8 debug 探测)"
- L258 checklist:"无 trace 则方案 3 后续不可用" → "无 trace 则方案 2 后续环境补全效率降低(非不可用)"

**效果**:trace 必需性表述统一为"强烈推荐;无 trace 方案 2 可用但效率降低",消除"不可用"过强表述。

### v9.7-4:P2-4 去壳终止标准加显式标注

**触发原因**:AI 在 18 题问卷中,把去壳终止标准第 1 项"字符串表已还原"答成"无附加隐藏层"(这是载体清晰度判定标准,不是去壳终止标准)。两项检查中"字符串表已还原"是 2.1 前置的复核,容易被忽略。

**修复**(shell-removal.md L212-217):
- 终止标准表格增加"性质"列:第 1 项标"前置复核(2.1 已完成,这里是回查)",第 2 项标"当下判定(2.3 去壳后当下的可读性状态)"
- 新增显式标注:"2 项区分——第 1 项是 2.1 字符串表还原的复核,第 2 项是 2.3 当下结构是否可辨识的判定。不要把'无附加隐藏层'(载体清晰度判定标准)与此处混淆——'无附加隐藏层'是阶段三的判定,不是 2.3 去壳终止标准。"

**效果**:两项检查的语义边界明确化,AI 不会把载体清晰度判定与去壳终止标准混了。

### v9.7-5:P2-5 "逻辑可读懂"判定时机明确

**触发原因**:AI 在 18 题问卷中,在 2.1 字符串表未完全还原时就判定"逻辑不可读",可能过早跳到方案 2(原方案 3),错过本可走方案 1 的场景。原 decision-tree.md L284 写"2.1 字符串还原后能理解加密流程",时机模糊。

**修复**(decision-tree.md §6.1 步骤 1):
- 条件 4 改为"逻辑可读懂(2.1 字符串表完全还原 + 2.3 局部去壳完成后能理解加密流程)"
- 新增"判定时机(强制)"标注:必须在 2.1 字符串表完全还原 + 2.3 局部去壳(若涉及)完成后判定;2.1 未完成时不得判定"逻辑不可读"
- 新增 3 步判定流程:2.1 完成 → 检查是否需要 2.3 → 2.3 完成(或无需 2.3)→ 此时判定"逻辑可读懂"还是"逻辑不可读"
- 步骤 2 触发条件中"静态不可读"改为"2.1 + 2.3 完成后仍静态不可读",与步骤 1 时机一致

**效果**:AI 不能在 2.1 未完成时判定"逻辑不可读",避免过早跳到方案 2。

### v9.7-6:方案 3 → 方案 2 全局重命名

**触发原因**:原 skill 用"方案 1(Python 重写)"和"方案 3(iv8 补环境)",中间的方案 2 在 v9.0 已删除,序号断档不自然。用户要求改为方案 1、2。

**修复**(12 个文件):
- SKILL.md / decision-tree.md / stage2-tracing.md / stage3-labels.md / stage4-scheme.md / stage5-verify.md / iv8-env-patching.md / shell-removal.md / code-extraction.md / methodology.md / trace-analysis.md / evals.json
- 全局替换:"方案 3" → "方案 2","方案3" → "方案2","方案 1/3" → "方案 1/2","方案1/3" → "方案1/2"
- decision-tree.md 目录锚点 `#6-方案-13-降级链` → `#6-方案-12-降级链`
- changelog.md(历史记录)和 deobfuscation.md.bak(备份)保留原"方案 3"不改

**效果**:方案编号连续(1, 2),消除断档;changelog 历史记录保留作为版本演进证据。

## v9.6

**核心变更**:删除 prettier/js-beautify 格式化步骤,清理所有"AI"冗余主语。理由:格式化仅供视觉舒适,非功能必需——AST 操作(babel/esprima)对压缩代码与格式化代码效果一致,字节偏移定位反而更准;原始压缩代码本身能跑,运行时无需格式化;格式化有副作用(行号失效、文件膨胀、可能引入语法变化)。

**规范依据**:用户反馈"AI需要格式化吗?没有格式化就看不懂了?去除格式化,还有不需要提到主语AI,AI怎么怎么。多余了"。AI 视角的"读者是 AI"是隐含前提,不需要在文档里反复声明;主语冗余反而稀释指令确定性。

### v9.6-1:删除 prettier 格式化步骤

**修改文件**:
- `SKILL.md` L88/L252/L259/L327/L346/L351/L392/L404:删除"格式化方案""prettier/js-beautify"提及,改为"原始代码直读"
- `references/modules/stage2-tracing.md` §核心策略 + 启动 checklist:删除格式化前置条件,改为"直接读原始压缩代码";§2.2 帧函数定位改为 AST 按字节偏移提取函数体,不需格式化搜索
- `references/modules/shell-removal.md`:删除"设计原则:给 AI 看,不是给人类看"中的格式化提及
- `references/modules/webpack.md` §bootstrap CFF 打散判定 + 拆 bundle 提取目标模块:删除"格式化后读代码"/"从格式化代码读"提及,改为"读原始压缩代码"
- `references/modules/trace-analysis.md` §1 trace 使用速查表 + §3.1 + §7:删除"格式化方案"/"基于格式化代码的结构特征扫描"提及,改为"原始代码直读"/"基于原始代码的结构特征扫描"
- `references/modules/har-analysis.md` §1.5 + §1.7:删除"格式化后需映射"/"格式化后会变化"提及,改为"按字节偏移直接定位"
- `references/modules/code-extraction.md` §5.3.2 运行时载体:删除"不用格式化代码"提及;§5.5 注入位置:删除"不是格式化代码"
- `references/methodology.md` §3 操作难度表:删除"格式化 + 局部变换",改为"局部变换(字符串还原 + eval/Function 解包)"
- `references/templates/stage2-trace.md` §1:删除"格式化结果"表格(原文件大小/格式化后大小/格式化工具),后续小节序号顺移
- `references/templates/stage4-scheme.md` §1 方案 1 必试清单:删除"AI 能理解"主语
- `references/decision-tree.md` §6.1 方案 1 必试清单:删除"AI 能理解"主语
- `evals/evals.json` id 26/27/30:删除"格式化对应 JS 文件""格式化代码显示"提及
- `SKILL.md` L351 反例表:"用格式化后的代码跑 iv8" → "改写/beautify 后的代码跑 iv8"(保留反例,但不再用"格式化"指代 prettier 步骤)

### v9.6-2:清理"AI"冗余主语

**修改文件**:
- `references/modules/shell-removal.md`:19 处 AI 主语清理
  - 章节重命名:"设计原则:给 AI 看,不是给人类看" → "设计原则:去壳深度控制"
  - "解混淆的读者是 AI(LLM),不是人类" → "去壳的目标是恢复语义可读性,不是产出人类美观代码"
  - "AI 视角,显式 If/Then" → "显式 If/Then"
  - "AI 仍读不懂"/"AI 能读懂"/"AI 能看出"/"AI 能查表理解"/"AI 不需要这些" 等冗余主语删除
- `references/modules/iv8-env-patching.md` L298:"(AI 视角,显式 If/Then)" → "(显式 If/Then)"
- `references/modules/webpack.md` L59/L81:"让 AI 能看到" → "能看到";"AI 能读 CFF" → "能读 CFF"
- `references/methodology.md` L3/L41/L64:"AI 容易做错" → "容易做错";"AI 容易假设" → "容易假设";"AI 容易误以为" → "实际差异很大,不能等同对待"
- `references/templates/stage4-scheme.md` L23 / `references/decision-tree.md` L284:"AI 能理解加密流程" → "能理解加密流程"
- `references/decision-tree.md` L106(审查补遗):"避免 AI 在阶段三反复重试" → "避免在阶段三反复重试"

**保留**:changelog.md 历史记录中的 AI/prettier 提及不动(历史不可改写);scripts/trace_analyzer.py 中"格式化输出"是 Python print format 动词,非 prettier;deobfuscation.md.bak 是备份文件,跳过。

### v9.6-3:跨文件引用错位修复(审查发现)

删除 `stage2-trace.md` §1 格式化结果表格后,后续小节序号顺移(原 §2-§8 → 现 §1-§7),导致 4 处跨文件引用错位:

- `SKILL.md` L161:"stage2-trace.md §2 依赖链图谱" → "stage2-trace.md §3 依赖链图谱"
- `references/templates/stage3-labels.md` L10:"stage2-trace.md §5" → "stage2-trace.md §4"(变换台账)
- `references/templates/stage3-labels.md` L11:"stage2-trace.md §7" → "stage2-trace.md §6"(载体清晰度初判)
- `references/modules/stage2-tracing.md` L125/L127:"stage2-trace.md §2.1 章节" → "§1.3 章节"(字符串表原映射关系) / "§4 章节"(变换台账)
- `references/templates/stage2-trace.md` 内部子章节序号:§1 下面的 §2.1/§2.2/§2.3 → §1.1/§1.2/§1.3

### v9.6-4:验证

- 全局搜索 `AI 视角|AI 能|AI 仍|AI 不|给 AI|AI 需要|AI 真正|AI 看不到|AI 才能|prettier|js-beautify|格式化`:除 changelog.md 历史记录 + scripts/trace_analyzer.py 的 print format + deobfuscation.md.bak 备份文件外,所有规则文档与模板已清理干净
- 运行时规则统一:"原始压缩代码本身能跑,运行时直接用;注入 hook 直接在原始代码上注入,不需重新压缩"
- 静态阅读规则统一:"直接读原始压缩代码;2.1 字符串还原调用点替换用 AST 节点替换;2.2 帧函数定位用 AST 按字节偏移提取函数体"
- 跨文件引用全部对齐:SKILL.md / stage3-labels.md / stage2-tracing.md 对 stage2-trace.md 的章节引用与模板实际序号一致

## v9.5

**核心变更**:基于极验4 滑块 w 参数逆向失败案例(E:\test\01\2026-07-19-174209)的 12 维度评估报告,修复 4 个 P0 致命缺陷 + 5 个 P1 重要缺陷。核心思路:把"文档式声明"重构为"If/Then 状态机",引入阶段门硬阻断机制,补全产物模板,增加 iv8 失败止损规则。

**规范依据**:agent-skills-creation ch04(Calibrate Control to Fragility:脆弱操作必须 prescriptive)+ ch04(Validation Loops:Plan-Validate-Execute)+ ch06(Eval-Driven Iteration:基于失败案例迭代)+ AI 规则一(确定性分支逻辑,无模糊修饰词)。

**失败案例驱动**:Agent 在极验4 任务中跳过阶段二格式化、跳过方案 1 直接 iv8、iv8 调试循环 30+ 分钟无回退、产物文件全部缺失,最终任务失败。本轮所有修复点对应 Agent 实际违规行为。

### v9.5-1:P0-1 阶段门 If/Then 状态机化(SKILL.md)

**触发原因**:Agent 跳过阶段一/二/三产物写入,直接进入阶段四。checklist 写在文档里但无强制力,Agent 视为建议。

**修复**:SKILL.md 顶部新增"阶段门阻断规则(启动前必读,If/Then 状态机)"章节:
- 全局规则:产物文件缺失 → 停下补齐,无兜底无临场发挥
- 4 个阶段门 If/Then 规则(阶段二/三/四/五),每门列出强制前置条件
- 阶段五验证不通过的回溯路径(方案 1→3 降级 + iv8 止损)
- 产物文件模板引用(指向 references/templates/)

**效果**:Agent 无法跳过阶段门——前置条件硬性检查,违反 = 产物无效。

### v9.5-2:P0-2 方案 1/3 降级链 If/Then 状态机化(decision-tree.md §6)

**触发原因**:Agent 未尝试方案 1(Python 重写)直接跳 iv8,违反"禁止跳级"。原 §6 用"禁止跳级"一句话带过,Agent 可绕过。

**修复**:decision-tree.md §6 重构为 4 个子章节:
- §6.1 方案选择状态机(If/Then,强制):3 步骤顺序判定,步骤 1 = 方案 1 必试清单(4 条件全满足必须方案 1)
- §6.2 方案 1:Python 重写(触发条件指向 §6.1 步骤 1)
- §6.3 方案 1 试跑失败处理(If/Then,强制):快速检查参数对齐 → 非笔误直接降级方案 3
- §6.4 方案 3:iv8 补环境(含 iv8 失败止损规则引用)

**效果**:Agent 必须先走方案 1 必试清单,清单不满足或试跑失败才能走方案 3。违反 = 违反 SKILL.md 阶段门阻断规则。

### v9.5-3:P0-3 iv8 失败止损规则(iv8-env-patching.md)

**触发原因**:Agent 在 iv8 调试循环中耗 30+ 分钟无回退,违反"禁止搭建动态调试环境做深入根因分析"。原 skill 无止损规则。

**修复**:iv8-env-patching.md 新增"iv8 失败止损规则 [阶段五,强制]"章节:
- 失败计数定义:同类错误连续 ≥3 次
- If/Then 状态机:连续失败 3 次 → 停止调试 → 4 项回溯检查(依赖链/方案选择/iv8 社区版限制/闭包变量)
- 累计 6 次失败 → 任务标记"iv8 路径失败",输出标准化失败报告
- 错误类型变化 → 计数清零(不同类错误独立尝试)
- 附"iv8 社区版已知限制"表(不发真实 HTTP/CryptoJS 不完整/DOM 映射不全/极验4 非标准混淆)

**效果**:Agent 在 iv8 失败时有明确回退路径,不再死循环。

### v9.5-4:P0-4 新增 4 个产物模板(templates/)

**触发原因**:templates/ 只有 stage1-params.md,Agent 不知如何写 stage2/3/4/5 产物,直接跳过。

**修复**:新增 4 个模板文件:
- `stage2-trace.md`:格式化结果 + 字符串还原 + 加密点位 + 依赖链 + 变换台账(4 字段) + 边界标记 + 初判结论
- `stage3-labels.md`:判定矩阵 + 兜底规则检查 + IIFE 闭包单体例外 + 载体形态结论(单一确定) + 最终判定
- `stage4-scheme.md`:分支选择 + 方案 1 必试清单 + 方案 3 触发条件 + 方案选择结论 + 试跑记录 + 代码路径
- `stage5-verify.md`:验证方式 + 参数级/接口级验证 + 失败处理 + iv8 止损检查 + 最终交付物 + 标准化失败报告

**效果**:Agent 按模板填写产物,字段齐全,阶段门可验证。

### v9.5-5:P1-1 stage2-tracing.md 顶部 trace 禁用 ⛔ 警告

**触发原因**:Agent 在阶段二用 trace 做加密点定位(违规)。原"禁止用 trace"在 SKILL.md 一句话,Agent 忽略。

**修复**:stage2-tracing.md 顶部新增"⛔ 阶段二硬性禁令(启动前必读)"区块:
- 3 条禁令(trace 禁用 / iv8 禁用 / prettier 必做)
- 违反后果:阶段二产物失效,触发阶段门阻断

**效果**:Agent 进入阶段二第一眼看到 ⛔ 警告,无法忽略。

### v9.5-6:P1-2 IIFE 闭包单体例外强制 stage3-labels.md 判定依据

**触发原因**:Agent 未做 IIFE 闭包单体判定就用 page.load 整个 JS,滥用例外条款。

**修复**:SKILL.md "page.load 整个 JS 的例外条款"改为:
- 判定规则后增加"必须写入 stage3-labels.md §4 才能生效"
- 强制约束:未写入 stage3-labels.md §4 就 page.load → 违反阶段门阻断规则,产物无效

**效果**:例外条款必须留下书面判定依据,无法口头滥用。

### v9.5-7:P1-3 概念重命名消除歧义

**触发原因**:Agent 混淆"单体混淆"(IIFE 闭包结构)与"自定义混淆"(无 OB 指纹但有混淆结构),两者正交但名称相似。

**修复**:全局重命名(6 个文件):
- "单体混淆" → "IIFE 闭包单体"(强调结构特征)
- "自定义混淆" → "非标准混淆"(强调非标准 OB 品牌)
- 旧术语保留括号注释(原"X",v9.5 重命名)便于历史 changelog 检索

**效果**:两个概念名称差异化,Agent 不再混用。

### v9.5-8:P1-5 禁止事项分级 P0/P1/P2(SKILL.md)

**触发原因**:SKILL.md 原 15 项禁止事项扁平列出,Agent 选择性执行。

**修复**:禁止事项章节重构为 3 级:
- P0 硬约束(⛔ 6 项):违反 → 阶段门阻断,产物无效
- P1 流程约束(⚠️ 6 项):违反 → 必须记录偏离理由
- P2 风格约束(📐 3 项):违反 → 影响交付物质量

每级用图标 + 简短违反后果说明,响应 ch04 "Calibrate Control to Fragility"。

**效果**:Agent 优先关注 P0 项,P0 项含本轮新增的"禁止跳过阶段门/禁止跳过方案 1 必试清单/禁止 iv8 无回退"。

### v9.5-9:任务失败交付物标准化(SKILL.md)

**触发原因**:Agent 失败后无标准报告格式,失败原因与已确认事实丢失。

**修复**:SKILL.md 新增"任务失败交付物(If/Then,强制)"章节:
- 4 个失败触发条件
- 标准化失败报告格式(任务/目标/状态/失败原因/已确认事实 ≥3 项/已排除原因/下一步建议 ≥2 项)
- 3 项禁止(仅写"任务失败"无原因/不记录已确认事实/下一步建议笼统)

**效果**:失败案例可复用,下游可基于已确认事实继续工作。

### v9.5-10:version 更新 + 跨文件引用一致性验证

- SKILL.md version: v9.4 → v9.5
- 验证本轮新增引用全部有效:
  - "iv8 失败止损规则" 4 处引用 → iv8-env-patching.md L236 ✅
  - "任务失败交付物" 3 处引用 → SKILL.md L355 ✅
  - "stage3-labels.md §4" 4 处引用 → stage3-labels.md L39 ✅
  - "decision-tree.md §6.1/6.2/6.3/6.4" 2 处引用 → decision-tree.md L274/300/324/340 ✅

### v9.5 规范符合性自检

| 规范项 | 状态 | 证据 |
|--------|------|------|
| ch02 SKILL.md <500 行 | ✅ | 410 行 |
| ch02 references/ 按需加载 | ✅ | 新增 4 模板按 stageN-*.md 触发加载 |
| ch04 Spend Context Wisely | ✅ | 7 项新增内容全部通过"Would the agent get this wrong?"测试 |
| ch04 Calibrate Control to Fragility | ✅ | P0 脆弱操作(阶段门/方案选择/iv8 调试)用 If/Then 状态机;P2 风格项给自由度 |
| ch04 Validation Loops | ✅ | 阶段门 = Plan-Validate-Execute 的硬实现 |
| ch06 Eval-Driven Iteration | ✅ | 基于极验4 失败案例迭代,所有修复点对应实际违规 |
| AI 规则一 确定性分支逻辑 | ✅ | 所有新规则用 If/Then 编码,无"适当"/"必要时"等模糊词 |

### v9.5 文件变更统计

| 文件 | 操作 | 行数变化 |
|------|------|---------|
| SKILL.md | 修改 | +101(313→410) |
| references/decision-tree.md | 修改 | -62(335→273) |
| references/modules/iv8-env-patching.md | 修改 | +39(301→340) |
| references/modules/stage2-tracing.md | 修改 | +8(388→396) |
| references/modules/shell-removal.md | 修改 | ±0(术语替换) |
| references/templates/stage2-trace.md | 新增 | +83 |
| references/templates/stage3-labels.md | 新增 | +60 |
| references/templates/stage4-scheme.md | 新增 | +60 |
| references/templates/stage5-verify.md | 新增 | +88 |

**总计**:新增/修改 +377 行,精简 -62 行,净增 +315 行。新增内容全部通过 Spend Context Wisely 测试。

---

## v9.4

**核心变更**:按 agent-skills-creation 规范化 references/ 目录,遵循"技能是 AI 的操作指令集"原则。清理非 AI 资源、消除跨文件冗余、对 6 个 300+ 行大文件做 Spend Context Wisely 审计、修复跨文件引用一致性。总计精简约 1100 行(-25%+)。

**规范依据**:agent-skills-creation ch02(references/ = 按需加载的 AI 操作资源)+ ch04(Spend Context Wisely:每段用"Would the agent get this wrong without this instruction?"测试)+ ch08(Tier 3 资源没被引用就不该存在)+ AI 规则一(确定性分支逻辑,无模糊修饰词)。

### v9.4-1:P0 清理(违规资源移出 references/)

**触发原因**:references/ 混入三类非 AI 操作指令内容,违反 ch02+ch04+ch08。

**修改内容**:
- 删除 `references/templates/__pycache__/`(6 个 .pyc 构建产物,AI 永远不读)
- `references/changelog.md`(465 行维护者版本历史)→ 根目录 `changelog.md`(人类维护者文档,非 AI 按需加载资源)
- SKILL.md 模块索引删除 changelog 行;底部注脚改为"版本变更记录见 [changelog.md](changelog.md)(根目录,非 AI 按需加载资源,供人类维护者查阅)"

### v9.4-2:methodology.md 重构(概念解释 → 程序性规则)

**触发原因**:原 methodology.md 184 行主要是概念解释(declaration),违反 ch04 反模式"Procedures over declarations"。§1-2 攻击面表格教 AI"CSS/DOM 与加密无关"(AI 已知);§3 单轨溯源与 stage2-tracing 重复;§5 载体形态与 SKILL 重复;§6 特征扫描与 decision-tree 重复;§8-9 与 SKILL 重复。

**修改内容**(184 行 → 74 行,-60%):
- 保留 3 个独有程序性规则:
  1. §1 数据流追踪能力边界(三层表 + 流向辨识 vs 精确追踪 + 第二层断裂条件)
  2. §2 HAR `_initiator.stack` 能力边界(含 If/Then 判定 + Fallback 全局搜索)
  3. §3 封装结构处理操作难度差异(4 操作对比表 + "不要把去壳和 Webpack 剥离当作同等难度处理"规则)
- 文件头部声明:"本文件收录 AI 容易做错、需要显式规则的程序性约束。操作步骤在对应阶段文件,本文件不重复。概念定义见 SKILL.md。"

### v9.4-3:跨文件冗余消除(单点权威 + 其他引用)

**触发原因**:载体清晰度概念在 5 处定义、变换台账字段在 3 处定义,违反单点权威原则。

**修改内容**:
- **载体清晰度**:SKILL.md 为概念权威(定义 + 判定标准),decision-tree §2.1 为判定时机权威(两阶段表),其他文件改简短引用
- **变换台账字段**:stage2-tracing 2.1.3 为权威(4 字段说明表),shell-removal 改 1 行引用
- SKILL.md 载体清晰度章节删除重复的"判定时机表"+"为什么需要两阶段判定"解释,改引用 decision-tree §2.1
- decision-tree §2.1 引用 methodology.md §5 → 改引用 SKILL.md(§5 已删除)

### v9.4-4:大文件 Spend Context Wisely 审计(6 个 300+ 行文件)

**触发原因**:6 个文件超 300 行,违反 ch04"少而精的指令优于详尽的文档"。逐段测试"Would the agent get this wrong without this instruction?",不通过就删。

**审计标准**:
- 必删:"Explaining what a PDF is"(教 AI 已知)、"Procedures over declarations"(纯概念解释)、跨文件重复
- 必保留:操作规则(If/Then 分支)、Gotchas、判定矩阵、禁止事项

**修改内容**(5 个由 subagent 审计,1 个主上下文审计):

| 文件 | 审计者 | 行数变化 | 主要删除内容 |
|------|--------|---------|------------|
| stage2-tracing.md | subagent | 523 → 388(-25.8%) | 5 处"为什么"动机段、重复 code block、2.3.1-3 精简为引用 shell-removal |
| iv8-env-patching.md | subagent | 462 → 301(-34.8%) | 目录、重复桩函数示例、重复原理说明、关键提醒从 13 项压为 1 项 |
| code-extraction.md | subagent | 532 → 388(-27%) | 目录、§5.1 选择依据(与 decision-tree 重复)、§5.3.2 方案 2 删除历史、冗余 Python 示例 |
| code-conventions.md | subagent | 432 → 244(-43.5%) | §0 动手前分析(与 SKILL/decision-tree 重复)、§6 完整 signer.py(与 templates 重复)、§4.4 错误诊断(与 iv8-env-patching 重复) |
| trace-analysis.md | subagent | 422 → 334(-20.9%) | §1 5 阶段列表(与 SKILL 重复)、§2 trace 是什么、§4.1 决定性事实、§4.3 能力清单表、§11 版本对比、§13 禁止 8 条(7 条与 SKILL 重复) |
| decision-tree.md | 主上下文 | 405 → 335(-17.3%) | §1 ASCII 图(与 SKILL 五阶段表重复)、§2.1 概念定义(与 SKILL 重复)、§2.5(§2.3/§2.4 已覆盖)、§5 历史占位、§7(合并到 §6)、§8 13/15 项(与 SKILL 重复) |

### v9.4-5:跨文件引用一致性验证与修复

**触发原因**:5 个 subagent + 主上下文分别编辑文件,可能引入失效引用。

**修改内容**(验证 12 个文件约 80 个引用):
- **修复 3 处失效引用**:
  - SKILL.md `code-extraction.md §5.3.3` → `§5.3.2`(code-extraction 无 §5.3.3)
  - decision-tree.md `code-extraction.md §3.1/§3.3` → `§5.3.1/§5.3.2`(code-extraction §3→§5 重编号未同步)
- **修复 4 处范围引用**:decision-tree.md §5/§7 删除后,`§4-§8`/`§4-§6` 范围引用含不存在的章节 → 改为精确列举 `§4、§6、§8` / `§4、§6`
- **修复 5 处命名不一致**:stage2-tracing.md §2.4 标题为"相关性判定与依赖链扩展",但 5 处引用为"流向辨识与依赖链扩展" → 统一为"相关性判定与依赖链扩展"
- **确认无残留失效**:methodology.md 旧编号(§4-§9)引用无残留;decision-tree.md §5/§7 引用无残留;trace-analysis.md §5.2→§4.2 修复正确

---

## v9.3

**核心变更**:基于实战反馈(gcaptcha4.js 自定义混淆案例)修复 6 个 skill 设计问题,全部采用显式 If/Then 规则,符合 AI 规则一(确定性分支逻辑)。

### v9.3-1:循环依赖检测规则(问题 1)

**触发原因**:gcaptcha4.js 的字符串表解码器 ↔ 代理函数 ↔ 闭包 ↔ 模块解析器 ↔ 控制流值 ↔ 排列函数 形成环依赖。原 skill 2.1.2-A 降级路径触发条件含"循环依赖",但未说怎么**检测**到是循环依赖——AI 会反复重试静态推导陷入死锁。

**修改内容**(stage2-tracing.md 2.1.2-A):
- 在降级路径之后新增"循环依赖检测规则"小节
- 4 条 If/Then 检测规则 + 兜底动作:
  - 执行链触达被 CFF 切碎的函数 → 循环依赖 → 触发降级
  - 超过 3 步未拿到字符串表 → 疑似循环依赖 → 触发降级
  - 报错 "xxx is not defined" → buggy 代码或运行时拉取 → 触发降级
  - 兜底:静态执行拿不到字符串表 → 默认走降级路径,不反复重试

### v9.3-2:自定义混淆 2.3 触发规则(问题 2)

**触发原因**:原 shell-removal.md 壳特征识别只列 OB 壳/eval-Function 壳两类,gcaptcha4.js 这类自定义混淆(无 _0x、无 eval)无规则可循。v9 已在 2.1 改为不限品牌,但 2.3 仍是 OB/eval 导向。

**修改内容**(shell-removal.md 壳特征识别):
- 改为"结构特征匹配即触发,不限混淆器品牌"(与 2.1 一致)
- 加 6 条 If/Then 壳特征触发规则:eval/Function、helper proxy、CFF、字符串数组残余、自定义混淆兜底、无壳
- 自定义混淆兜底动作:走 stage2-tracing.md "OB 壳静态完全不可读时的逃生路径"
- 加关键说明:自定义混淆的 CFF/helper proxy 在 2.3 同样处理,触发条件是结构特征不是品牌

### v9.3-3A:iv8 沙箱澄清(问题 3-A)

**触发原因**:用户实战反馈"page.load 有沙箱隔离,Hook 在沙箱外怎么通信?"——这是对 iv8 架构的误解,但 skill 没有显式澄清,导致 AI 也可能误判。

**修改内容**(iv8-env-patching.md 心智模型前):
- 新增"iv8 架构澄清(常见误解)"表
- 澄清 3 个误解:沙箱隔离(实际不隔离)、闭包访问不到(实际是 JS 作用域规则)、CORS/CSP 限制(实际无)
- 关键说明:iv8 是单 V8 Context 的 JS 运行时,所谓"沙箱"问题不存在

### v9.3-3B:buggy 代码处理(问题 3-B)

**触发原因**:gcaptcha4.js 实战中遇到 `$_HHEDE 未定义` 错误——混淆器生成的 buggy 代码,真实浏览器宽松行为掩盖了 bug,iv8 严格遵循 ES 规范暴露出来。skill 完全未覆盖。

**修改内容**(iv8-env-patching.md 加密参数生成失败排查):
- 新增"混淆器生成 buggy 代码的处理"小节
- If/Then 处理规则:
  - 报 "xxx is not defined" → grep 搜确认从未定义 → 预定义为 undefined
  - 闭包内定义外部引用 → 走闭包 hook 注入
  - 运行时动态定义 → 确保 page.load 顺序
  - 预定义后报错变化 → 继续排查
  - 预定义后能跑但参数不对 → watch_apis 对比浏览器值
- 关键判定:grep 搜不到定义 + 浏览器能跑 = buggy 代码
- 不要做的事:不修复混淆器的 bug,只补变量声明

### v9.3-4:阶段门表述澄清(问题 4)

**触发原因**:用户误以为 Stage 2 出口依赖 Stage 3 的载体形态判定(鸡生蛋)。实际 Stage 2 出口是"变换台账(原始观察记录)"非"判定结论",但表述易混淆。

**修改内容**(SKILL.md 阶段门):
- 阶段门前加"关键概念区分"说明:变换台账(原始观察)≠ 判定结论(阶段三做)
- 阶段二出口明标"变换台账(原始观察记录:载体形态特征观察 + 载体清晰度初判,非判定结论)"
- 阶段三出口明标"载体形态判定结论 + 载体清晰度最终判定"
- 阶段三入口"载体形态标签确定" → "载体形态判定结论确定"

### v9.3-5:page.load 整个 JS 禁令加单体混淆例外(问题 5)

**触发原因**:原 SKILL.md L15/L253 明禁"跳过依赖图分析直接 page.load 整个 JS",但 gcaptcha4.js 单体混淆(676KB 单 IIFE,函数无法独立提取)只能 page.load 整个 JS——与方案 3 / 2.2 Fallback / 2.1 iv8 降级路径的实际要求冲突。内部矛盾。

**修改内容**(SKILL.md 核心原则 + 禁止事项 + code-conventions.md + decision-tree.md):
- SKILL.md 核心原则加"page.load 整个 JS 的例外条款"
- 加 If/Then 单体混淆判定规则:单文件 + IIFE 开头 + 函数共享闭包变量 → 单体混淆 → 允许 page.load 整个 JS
- 列出 3 个典型场景:方案 3 iv8 补环境、2.2 Fallback 逃生路径、2.1/2.3 iv8 字符串表拉取
- 非例外场景(多文件、Webpack 多 chunk、可拆分模块化)禁令仍生效
- 禁止事项 L271 加"(例外:单体混淆,见核心原则例外条款)"
- code-conventions.md L39 / decision-tree.md L367 同步引用

### v9.3-6:decision-tree §2.3 兜底规则(问题 6)

**触发原因**:decision-tree §2.3 主流程最后分支"载体清晰度=不清晰?→ 有 OB/eval壳,脱壳后重新判定"假设了不清晰必然是 OB/eval 壳。自定义混淆不符合这个假设,会无限循环(脱壳后仍不清晰,反复重新判定)。

**修改内容**(decision-tree 新增 §2.3.1):
- §2.3 主流程最后分支改为"兜底分支(见 §2.3.1)"
- 新增 §2.3.1 "未命中特征 + 不清晰"兜底规则
- 两个 If/Then 子分支:
  - 有混淆结构(CFF/helper proxy/字符串数组残余)→ 自定义混淆 → 直接走方案 3 iv8 补环境 → iv8 跑不通转 Black-box
  - 无可识别混淆结构 → [未知,需运行时验证] → 阶段四全量 iv8 路径运行时判定
- 加关键说明:解决 gcaptcha4.js 在阶段三"卡住"的问题,把"自定义混淆"作为显式分支路由到方案 3

**符合 skill 编写规范**:
- ch04 Calibrate Control to Fragility:6 个问题全部用 If/Then 显式规则,不依赖 AI"看情况"
- AI 规则一(确定性分支逻辑):所有兜底动作明确,无模糊修饰词
- ch04 Gotchas Are Highest Value:buggy 代码、单体混淆例外、循环依赖检测都是实战 gotcha

**未修改项**:
- 壳类型清单仍为 2 类(OB/eval),自定义混淆作为"无标准壳特征但有混淆结构"在 §2.3.1 兜底处理,不新增壳类型(避免分类膨胀)
- 载体形态仍为 5 类,自定义混淆在阶段三标签为 [自定义混淆,载体清晰度=不清晰],不新增载体形态(避免分类膨胀,初判机制已能区分)

## v9.2

**核心变更**:两项澄清性修改——(1) AST 禁用范围收窄,(2) 载体清晰度判定拆为两阶段(初判 + 最终判定)。

### v9.2-A:AST 禁用范围收窄

**触发原因**:v9 写"不使用 AST 框架",但 2.1 字符串还原的调用点替换理论上需要 AST 节点替换(`obj[_0xabc(getKey(123))]()` 嵌套形式正则必错),表述有歧义——AI 读到全面禁用会把 2.1 调用点替换也改用正则。

**修改内容**(stage2-tracing.md):
- L44:"不使用 AST 框架" → "不使用 AST 做作用域分析(闭包变量补全/依赖链自动追踪);2.1 字符串还原调用点替换允许使用 AST 节点替换(babel/esprima,确定性变换不涉及作用域推断)"
- L256:同上,收窄到"作用域分析"禁用范围
- L502:保留原禁用(闭包作用域补全)
- 2.1.2-A 步骤 5:明确"用 AST 节点替换(babel/esprima)替换调用点为字符串字面量(不用正则)"
- 2.1.2-B 步骤 3:同上

**AI 视角原则**:把禁用范围显式收窄到任务类别(作用域分析),而非工具类别(AST 框架)。AI 读到禁用条目时立即知道边界,符合"AI 是概率模型,模糊指令会导致随机游走"原则。

### v9.2-B:载体清晰度判定拆为两阶段

**触发原因**:用户指出"载体清晰度是给阶段二使用的,清晰后才可以进行载体形态判断,形态判断给阶段4方案选择用"。当前设计把"载体清晰度判定"全部留到阶段三,但脱壳决策(2.1/2.3)本身就需要清晰度信号——存在隐性循环。

**问题分析**:
- 载体清晰度定义依赖载体形态("该载体形态下的最清晰状态")
- 但脱壳决策(阶段二)需要清晰度信号
- 直接切分"清晰度→阶段二、形态→阶段三"在逻辑上不成立(没有形态就没法定义清晰度)
- 真正问题是隐性循环未显式化

**修改内容**(方案 A:初判前置):

1. **stage2-tracing.md 2.1.3**:变换台账从 3 字段改为 4 字段,新增"载体清晰度初判"字段(清晰/部分清晰/不清晰,三选一)。加"载体清晰度初判判定规则"(基于脱壳后可读性的 If/Then 显式枚举)。加"初判与最终判定的关系"说明
2. **methodology.md §5.2**:加"判定时机(两阶段)"表——阶段二初判(基于脱壳后可读性,不依赖形态)+ 阶段三最终判定(基于形态 + 初判)。加"为什么需要两阶段判定"说明(把隐性循环显式化)
3. **decision-tree.md §2.1**:加"判定时机(两阶段)"表——阶段二初判记录在变换台账 + 阶段三最终判定基于初判 + 形态观察。加"最终判定不是从零开始——继承初判,冲突时以形态观察为准"
4. **SKILL.md**:
   - 载体清晰度章节加"判定时机(两阶段)"说明 + "为什么需要两阶段判定"说明
   - 五阶段工作流表:阶段二"变换台账记录载体清晰度初判";阶段三"基于变换台账(含载体清晰度初判)做载体形态判定 + 载体清晰度最终判定"(替换原"无初判,直接确认"表述)
5. **shell-removal.md**:
   - 变换台账从 3 字段改为 4 字段,新增"载体清晰度初判"字段,引用 stage2-tracing.md 2.1.3 判定规则
   - 交付物说明同步:变换台账记录增加"载体清晰度初判(供阶段三最终判定)"

**两阶段判定流程**:

```
阶段二(2.1/2.3 脱壳过程中):
  ├─ 观察代码可读性
  ├─ 变换台账记录载体清晰度初判(清晰/部分清晰/不清晰)
  └─ 初判作为脱壳决策依据(初判"清晰"停止脱壳;初判"部分清晰/不清晰"继续 2.3)

阶段三(decision-tree.md §2):
  ├─ 基于变换台账的载体形态特征观察 → 载体形态判定(客观分类)
  ├─ 基于变换台账的载体清晰度初判 + 形态判定结果 → 载体清晰度最终判定
  └─ 冲突处理:若初判与形态观察冲突,以形态观察为准重新判定
```

**未修改项**:
- 载体形态判定仍全部在阶段三(因为需要全链路观察完毕才能下结论,这是用户原方案也认可的)
- 载体清晰度的定义仍依赖载体形态(只在阶段三最终判定时显式使用此依赖)
- 阶段二初判的判定规则基于"脱壳后可读性",与载体形态解耦——这是把隐性循环显式化的关键

**符合 skill 编写规范**:
- ch04 Spend Context Wisely:初判规则用 If/Then 显式枚举,AI 不需"看情况"
- ch04 Calibrate Control to Fragility:初判是状态观察(自由度高),最终判定是分支选择(确定性)
- AI 规则一(确定性分支逻辑):初判 If/Then 显式枚举 + 三选一非空约束;冲突处理有明确兜底动作(以形态观察为准)

## v9

**核心变更**:阶段二流程重构,新增 2.1 字符串可读性恢复(全文件范围)作为阶段二第一步。

**触发原因**:原结构存在鸡生蛋矛盾——Step 1(栈帧溯源)"读代码查找加密逻辑"依赖代码可读,但若代码含 `obj[_0xabc(123)]()` 形式的索引访问或密文字面量,AI 读不懂,无法完成 Step 1 → 永远到不了 Step 2 的字符串表还原。

**重构内容**:

- **编号规则**:统一采用 `阶段.步骤` 编号(2.1, 2.2, 2.3, 2.4, 2.5),起始编号为 1,无 0 起始
- **新增 2.1 字符串可读性恢复**:
  - 范围:全文件(字符串表是全局共享,局部还原会导致后续溯源反复触发)
  - 触发条件:结构特征匹配即触发(`_0xabc(idx)` 索引访问 / 密文字面量),**不限 OB 品牌**
  - 旋转函数:**可选**(有则还原,无则跳过)
  - 包含原 shell-removal.md 的"字符串数组+旋转函数还原 + 字符串解密还原"
  - 含主路径(静态执行)+ 降级路径(iv8 动态拉取)
  - 含触发条件 If/Then 确定性分支、输出定型 3 项非空、终止条件 checklist
- **原 Step 1-4 改编号**:
  - Step 1 栈帧溯源 → 2.2(读 2.1 产出的可读代码做溯源)
  - Step 2 局部脱壳 → 2.3(剥离字符串表部分,仅处理 eval/Function 壳 + 其他壳层)
  - Step 3 相关性判定与依赖链扩展 → 2.4
  - Step 4 两遍静态剪枝 → 2.5
- **shell-removal.md 调整**:
  - "必须做"清单:字符串数组+旋转函数+字符串解密标记为已迁移至 2.1
  - 触发条件从"命中 OB 壳"放宽为"结构特征匹配,不限品牌"
  - 旋转函数从必做改为可选
  - 范围约束:"不做全文件去混淆" → "2.3 不做全文件去壳"(2.1 已是全文件字符串表还原)
  - 所有 Step 引用改为 N.M 编号
- **SKILL.md 调整**:
  - 阶段二描述更新为"字符串可读性恢复与迭代溯源"
  - 模块索引"去壳"条目改为"阶段二 2.3 局部去壳(eval/Function 壳 + 其他壳层;字符串表还原已在 2.1 完成)"
  - 关键提醒"去壳阶段 iv8 用于字符串表拉取"改为"阶段二 2.1/2.3 iv8 用于字符串表拉取"

**符合 skill 编写规范**:
- ch02 Progressive Disclosure:2.1 内嵌在 stage2-tracing.md(主流程文档),不引入新文件
- ch04 Spend Context Wisely:2.1 触发条件用 grep-able 结构特征,无壳场景零额外加载
- ch04 Calibrate Control to Fragility:2.1 主路径静态执行(自由度高),降级路径 iv8 拉取(确定性条件触发)
- AI 规则一(确定性分支逻辑):2.1.1 触发条件 If/Then 显式枚举 + 兜底动作;2.1.3 输出定型 3 项非空约束;2.1.4 终止条件 checklist 化

## v9.1

**核心变更**:跨文档编号体系统一(v9 后续完善),让每个章节号在全 skill 范围内可唯一定位到阶段。

**触发原因**:v9 只统一了 stage2-tracing.md 内部编号(2.1-2.5),其他阶段文档仍用 `1. 2. 3.` 平铺编号,跨文档引用时无法判断章节归属哪个阶段。

**统一方案(A 方案)**:

- **阶段专属文档**:章节加阶段前缀,起始编号为 1
  - har-analysis.md(阶段一):`1. ~ 10.` → `1.1 ~ 1.10`,子节 `5.1/5.2/5.3` → `1.5.1/1.5.2/1.5.3`,`6.1/6.2/6.3` → `1.6.1/1.6.2/1.6.3`,`7.1/7.2` → `1.7.1/1.7.2`;内部交叉引用 `§5.2` → `§1.5.2` 等
  - code-extraction.md(阶段五):`1. ~ 8.` → `5.1 ~ 5.8`,H3 子节同步加 5 前缀;TOC 与内部交叉引用同步更新
- **跨阶段文档**:保留原 `1. 2. ...` 编号 + 章节标题加 `[阶段X]` 后缀
  - trace-analysis.md:14 个 H2 加后缀(§5 [阶段一]、§9 [阶段四]、其余 [跨阶段]);§1 阶段列表"阶段二(迭代溯源与局部去壳)" → "阶段二(字符串可读性恢复与迭代溯源)"
  - decision-tree.md:7 个 H2 加后缀(§2/§6/§7 [阶段三]/[阶段四] 阶段标记,§1/§3/§8 [跨阶段]);原 `(阶段三)`/`(阶段四)` 括号注释统一为 `[阶段X]` 后缀格式;同步 TOC
  - iv8-env-patching.md:12 个 H2 加后缀(8 个实现性章节 [阶段五],4 个基础/参考性章节 [跨阶段])
- **基础概念文档**:保留原编号(methodology.md、code-conventions.md、api-reference.md)
- **跨文档引用同步**:methodology.md L87 `Step 1 "帧函数定位操作规范"` → `2.2 "帧函数定位操作规范"`

**后缀判定原则**:
- 章节有明确主要使用阶段 → 标 [阶段X](如 trace §5 主要在阶段一用、iv8-env-patching 实现性章节主要在阶段五做)
- 章节服务于多个阶段(基础概念、API 速查、禁止事项等)→ 标 [跨阶段]
- 已删除章节(如 decision-tree §5)不加后缀

**未修改项**:
- changelog.md 中的 `Step N` 历史记录保留原样(描述历史状态,不是当前编号)
- 代码块内的工作流步骤(如 `Step 1: stats` 命令序列)保留原样(是工作流步骤,非章节编号)

**审查修复(v9.1 后续)**:

对 v9/v9.1 改动做全局交叉引用审查,修复 6 处遗漏:

- stage2-tracing.md L54:`[har-analysis.md](har-analysis.md) §5.2` → `§1.5.2`(har-analysis.md 已重编号为 1.X)
- stage2-tracing.md L46/L403:`[code-extraction.md](code-extraction.md) §5 闭包 hook` → `§5.5 闭包 hook`(闭包 hook 在 5.5,原 §5 是旧编号)
- code-extraction.md L212:`§5 闭包 hook 注入` → `§5.5 闭包 hook 注入`(同上)
- trace-analysis.md §6 算法识别、§12 大文件处理:补充 `[跨阶段]` 后缀(v9.1 遗漏,这两节服务于多阶段)
- SKILL.md L133:`见去壳模块 §3.5` → `见 [shell-removal.md](references/modules/shell-removal.md) "去壳后验证与分层回退纠错"`(shell-removal.md 章节无编号,§3.5 是历史残留,改用章节名引用)

## v8.5.1

(基于 agent-skills-creation ch04 "Spend Context Wisely" 审查 shell-removal.md,删除过度教学内容)

**审查标准**:
- Spend Context Wisely:"Add what the agent lacks, omit what it knows" — 每段用"Would the agent get this wrong without this instruction?"测试
- Anti-pattern "Explaining what a PDF is":Agent 已知的内容不写入 skill
- Calibrate Control to Fragility:给自由当多种方法可行,给精确指令当操作脆弱

**P0 修复(过度教学 — 在教 AI 自己的能力):**
- "设计原则"章节:删除 AI/人类能力差异表(AI 在教自己的能力),精简"不需要做"为一行列表。35 行 → 12 行
- "壳特征识别":删除特征表(在教 AI 模式识别),改为段落保留决策点"命中即进入去壳"
- "主导壳层判断":从原"主导壳层指纹判断"改名并删除信号-壳层-首动作表(在教 AI 逻辑推理),保留约束"不做批量变换"

**P1 修复(冗余精简):**
- eval 递归去壳流程:删除步骤列表改为段落描述
- 去壳终止标准"不作为终止条件"6 项列表精简为一句话
- 合并"常见误判"和"禁止事项"去重(删除重复的"JSVMP 内部 eval"条目)
- 修复失效锚点链接:章节改名后 `[主导壳层指纹判断](#主导壳层指纹判断)` → `[主导壳层判断](#主导壳层判断)`
- 删除残留重复条目"禁止过度去壳"

**行数变化**:298 行 → 239 行(精简 59 行,约 20%)

**两版本同步**:`.trae/skills/` 与根目录 `web-reverse-iv8/` 哈希一致(SHA256: C0E65F...60A3E7)

## v8.5

(基于"解混淆是给 AI 看的,不是给人类看的"这一核心洞察,重构去壳文档结构,精简为 AI 视角)

**核心洞察**:解混淆的读者是 AI(LLM),不是人类。AI 能同时持有字符串表映射、分析所有 CFF case、忽略死代码、跟踪 Unicode 变量名——因此不需要做给人类看的"美化"(CFF 还原/死代码消除/变量重命名/helper 内联),只需要还原字符串表(语义载体)。

**文档结构重构:**
- 原 `deobfuscation.md`(303 行)备份为 `deobfuscation.md.bak`,保留历史记录
- 新建 `shell-removal.md`(298 行):去壳文件,涵盖 OB 壳 + eval/Function 壳,AI 视角精简版
- 新建 `webpack.md`(127 行):Webpack 模块边界提取 + 拆分 + require.c 注入模板,从原 deobfuscation.md L104-146 迁移

**shell-removal.md 的 AI 视角精简:**
- 新增"设计原则:给 AI 看,不是给人类看"章节,明确 AI 与人类阅读能力的差异
- 推荐变换顺序从 6 步精简为 2 步(字符串数组+旋转函数还原 + 字符串解密还原)
- CFF 还原/helper 内联/属性标准化/死代码消除降级为"可选,仅当 AI 读完字符串表还原后的代码仍读不懂时"
- 去壳终止标准从 4 项精简为 2 项(字符串表已还原 + 结构可辨识)
- 变换台账从 5 字段精简为 3 字段(保持不变项 + 验证证据 + 载体形态特征)
- 新增禁止事项:禁止过度去壳(AI 已能读懂后继续美化)、禁止字符串表未还原时做 CFF 还原

**webpack.md 的增强:**
- 新增"访问 Webpack 模块缓存(require.c)"章节,提供完整的注入模板和 iv8 使用示例
- 静态路径/动态路径明确分工,动态路径不还原 bootstrap CFF

**引用更新:**
- SKILL.md:4 处引用更新 + 模块索引新增 Webpack 条目
- stage2-tracing.md:4 处引用更新,Step 2 引用拆分为 shell-removal.md + webpack.md
- trace-analysis.md:2 处引用更新
- code-extraction.md:2 处引用更新
- methodology.md:2 处引用更新
- decision-tree.md:1 处引用更新
- evals.json:7 处 expected_output 引用更新

## v8.4

(基于"产物未写入本地"的修复:补全 Plan-Validate-Execute + Validation Loops 模式要求的产物持久化机制)

**产物持久化机制补全:**
- SKILL.md 新增"产物持久化(强制)"小节:定义统一的产物目录结构(`./<task-name>/stage1-params.md ~ stage5-verify.md` + `code/` + `evidence/`),4 条持久化规则(每阶段结束写入、阶段门出口验证加产物路径、跨阶段引用用文件路径、task-name 命名规范)
- 阶段门表更新:5 个阶段的入口 checklist 加"上一阶段产物文件存在"确认项,出口验证加"产物已写入 `./<task>/stage<N>-*.md`"
- har-analysis.md §9 加产物持久化提醒(写入 stage1-params.md)
- stage2-tracing.md 产出物末尾加产物持久化提醒(写入 stage2-trace.md + evidence/deobfuscated/)
- templates/param-analysis.md 头部加写入路径引导

**规范依据**:agent-skills-creation 的 Plan-Validate-Execute + Validation Loops 模式要求中间产物可被下一阶段读取和验证。只在对话里输出会导致:① 上下文压缩时丢失;② 下一阶段无法引用具体文件路径;③ 跨阶段验证无基准文件。

## v8.3

(基于实战测试报告的修复,核实后仅修属实/部分属实的 7 个点,跳过 5 处事实错误和 glossary 误解)

**P0 修复(Gotchas — agent 不告知会犯错):**

- D1-4 trace diff 依赖的 iv8 API 清单生成:trace-analysis.md 新增 §5.2.1 "生成 iv8 API 清单",提供 `gen_iv8_api_list.py` 脚本(用 `ctx.eval` 遍历 window 下的 interface 和 member 导出清单文件)
- D2-3 values 命令 member 前缀匹配问题:trace_analyzer.py `_values` 函数加智能降级——精确匹配无结果且 pattern 含点号时,自动用点号后的 member 部分做子串匹配;文档删除"脚本已知瑕疵"改为正常使用说明
- D3-1 OB 壳 DOM 代理映射兼容性:SKILL.md 关键提醒加 Gotcha——OB 壳通过原型内部映射(element.$_CFq)访问 DOM 时,iv8 可能不覆盖,需用 watch_apis 断点确认是 iv8 缺口还是 OB 壳内部映射
- D3-4 主 JS 依赖子 JS(如 gct4.js)处理:code-extraction.md §3.3 新增"二级依赖处理"小节,给出从 HAR 下载子 JS → 加入 resources → 重新 page.load 的完整流程和代码模板

**P1 修复(解释 WHY,补逃生路径):**

- D3-2 page.load 大文件性能预期:iv8-env-patching.md 第一步加 Gotcha——989KB 文件需 2-3 分钟,首次用 debug 模式看进度,超 5 分钟检查死循环/异步回调
- D5-1 OB 壳静态完全不可读时的逃生路径:stage2-tracing.md Fallback 新增"OB 壳静态完全不可读时的逃生路径"——先 page.load 跑原混淆代码 + watch_apis 拦截调用链 + 反向溯源到加密函数,再回静态做局部脱壳
- D1-3 Webpack 闭包注入模板:code-extraction.md §5.2 新增"访问 Webpack 模块缓存(require.c)的注入模板"——bootstrap 尾部 `return n.c=t,n.m=e` 注入 `window.__REQUIRE__=n`,Python 侧通过模块 ID 访问任意模块 exports

**核实为事实错误不改(5 处):**
- D1-1(column 映射方法已给,见 stage2 L99-105)
- D1-2(Webpack-in-OB 方案已给,见 deobfuscation L104-146)
- D2-4(文档明确说运行时用原始压缩代码,无自相矛盾)
- D4-3(deobfuscation L90 明确给了 OB 死代码判定依据)
- D5-4(文档明确说 Context 3ms 无需复用,报告混淆 Context 和 page.load)

**核实为非规范要求不改(1 处):**
- D2-1(glossary 是 agent-skills-creation 的 supporting file,非每个 skill 必须有)

## v8.2

(基于 5 个深度审查问题的修复:iv8 使用前提/运行环境/跳步现象/输入输出契约/边界定义)

**Q1 iv8 使用前提声明:**
- SKILL.md "环境补全原则"加 iv8 开箱能力声明:200+指纹+BOM/DOM/CSSOM/事件/Crypto/Canvas/WebGL,明确"补环境=补缺口,不是从零补全浏览器检测环境"
- 补充社区版不发真实 HTTP 请求的说明(XHR/fetch 响应通过 add_resource 注入)

**Q2 iv8 运行环境补全(事实修正+完整声明):**
- SKILL.md compatibility:Python 3.9→3.8(事实修正),加 manylinux 标准及发行版,加社区版标识,加 macOS 说明
- api-reference.md "安装"改为"安装与运行环境",新增 4 个小节:运行环境表(Python/Win/Linux/macOS)、社区版vs专业版、社区版关键限制(不发HTTP/反调试)、开箱即用能力清单(指纹/BOM-DOM-CSSOM/事件/Crypto/图形/网络/存储/Worker/可信事件)
- methodology.md §8 加交叉引用指向 api-reference.md "安装与运行环境"

**Q3 跳步解决方案(阶段门+Plan-Validate-Execute):**
- SKILL.md 新增"阶段门:入口 checklist 与出口验证"小节:五阶段各有入口 checklist(`- [ ]` 格式)和出口验证,加跳步阻断规则(入口未确认→停下;出口未通过→不进下一阶段;阶段五失败→回溯阶段四)
- 遵循 agent-skills-creation 的 Checklists for Multi-Step Workflows + Validation Loops 模式
- 关键提醒"失败案例驱动的硬约束"引用更新:从仅引用阶段二 checklist 改为引用"阶段门"系统

**Q4 输入输出契约 + 正例返例:**
- SKILL.md 新增"输入/输出契约"小节:输入(HAR必需+trace可选+目标JS)+ 输出(加密参数生成代码+验证结果),明确"无HAR→skill无法启动"
- SKILL.md 新增"正例/返例对照"小节:8 个决策点的✗返例/✓正例配对(加密点定位/补环境/加载JS/去壳判定/方案选择/运行时代码/trace用途/方案1失败)
- 遵循 agent-skills-creation 的 Gotchas Are Highest Value 模式(具体纠正比通用建议更有价值)

**Q5 边界定义清晰度修复:**
- description 修正:"client-side reverse engineering (frida)"→"frida-based runtime hooking"(消除自相矛盾:skill 本身是客户端逆向,只是不用 frida);"protocol reverse engineering"→"binary protocol reverse engineering (non-web-JS)"(明确非 web JS 范畴)
- SKILL.md 新增"适用范围与边界"小节:正面范围(5步完整链路)+ 负面边界表(5个不做的领域+原因+替代方案)+ 边界澄清表(5个重叠场景判定)

## v8.1

(在 v8 基础上基于失败案例分析和 skill-creator 审查做规范化迭代)

**失败案例驱动的硬约束(P0):**
- 阶段二新增"启动 checklist"独立小节(stage2-tracing.md),6 项硬前置:_initiator.stack 提取、格式化、trace 使用范围确认、column 优先、大文件预警、阻力预警
- 4 个文件的阶段产出物末尾加"下一阶段入口"指针(har-analysis.md §9 / stage2-tracing.md 产出物 / decision-tree.md §2.5 / §4.5 / code-extraction.md §7.3),建立阶段切换 checkpoint
- checklist 第三项修正:从"阶段二 trace 仅用于字符串表拉取"改为"阶段二不使用 trace,字符串表拉取用 iv8 不是 trace"(修复事实错误)

**column 定位详细规范(P1):**
- stage2-tracing.md Step 1 帧函数定位操作规范改写:从"优先用函数名,降级用行列号"改为"column 优先,函数名辅助"三分支逻辑
- methodology.md §3.3 栈帧定位对齐 column 优先
- 抬杠修复 2 处:函数名唯一性循环依赖、column 指向调用点非定义点

**trace 使用速查表(P1):**
- trace-analysis.md §1 加"trace 使用速查表(按阶段)",正面表述 5 阶段该用/不该用 trace
- 特别点明字符串表拉取用 iv8 不是 trace

**skill-creator 规范化(基于 agent-skills-creation 审查):**
- SKILL.md description 改为 "Use this skill when..." 祈使句式,嵌入中文触发示例,明确 Do NOT use 场景
- SKILL.md 五阶段三处重复合并:删除"方案决策树(速查)"ASCII 图,精简"核心方法论"
- SKILL.md compatibility 字段精简:移除实现细节,只保留兼容性声明
- SKILL.md 关键提醒开头加"失败案例驱动的硬约束"引用块
- SKILL.md 壳类型清单表 OB 壳特征列精简,引导到 decision-tree §3.1
- evals.json 清理 16 处过时引用(方案 2/分支 C/v6 迁移注释/§编号/需 trace 确认等)
- evals.json 加 5 个 near-miss 触发测试(eval 43-47):React 开发/Selenium 爬虫/frida 客户端逆向/协议逆向/服务端签名

**reference 文件一致性修复:**
- methodology.md §2/§7 章节编号引用改为名称引用(deobfuscation.md 无 §编号)
- trace-analysis.md §8.3 eval 检测:从"作为阶段二壳特征识别的输入"改为"参考",并加注阶段二不使用 trace
- har-analysis.md §10 注意事项加 column 优先引导

## v8

(在 v7 基础上重构为五阶段架构,引入载体形态+载体清晰度二维概念,方法论单轨化,方案降级链从 1/2/3 简化为 1/3,删除动态剪枝子步骤,新增 trace 前置补环境)

**架构变更:六阶段 → 五阶段:**
- 原阶段二(加密点定位+特征初判)+ 原阶段三(去壳)合并为新阶段二(迭代溯源与局部去壳),局部去壳嵌入溯源迭代
- 原阶段四(标签复核)→ 新阶段三(保护类型标签确认),改"复核"为"确认"(无初判,直接确认)
- 原阶段五(分支执行)→ 新阶段四(分支执行)
- 原阶段六(本地模拟)→ 新阶段五(本地模拟与验证)

**方法论单轨化:**
- 双轨(trace + iv8 交叉验证)→ 单轨(HAR `_initiator.stack`)+ fallback(全局搜索)
- trace 不再参与加密点定位(audit 已证纯 JS 加密函数在 trace 中隐形),定位为"环境指纹采集器",保留 A/B/C/D 四类 13 条能力
- 格式化方案替代 AST 框架:prettier/js-beautify 格式化压缩代码,读代码理解,不用 AST 框架
- 数据流追踪三层能力边界:第一层(函数内同步)静态可靠;第二层(跨函数同步)部分可行;第三层(异步/回调/状态)不可靠,标注[静态未验证]留阶段四动态验证
- 流向辨识 vs 精确追踪:阶段二只做流向辨识,不要求还原完整加密算法

**载体形态+载体清晰度二维概念(替代"原生JS"):**
- 去除"原生JS"标签(语义模糊),引入"载体形态"(Carrier Form):JS函数/Webpack模块/JSVMP字节码/WASM二进制/Worker算子(客观分类)
- 引入"载体清晰度"(Carrier Clarity):四项检查(结构可辨识/调用语义可辨识/第一层数据流流向可辨识/无附加隐藏层)(状态判断)
- 分支 E 标签从"原生JS"改为"无附加保护"
- 载体形态判定矩阵:必要特征 + 充分特征 + 排除条件
- 去壳失败节点处理:载体形态判定为[未知,需运行时验证],进入阶段四全量 iv8 路径运行时判定

**阶段二完整流程(新建 stage2-tracing.md):**
- Step 1:栈帧起点提取与逐帧溯源(优先级排序 + 格式化方案定位 + Fallback 全局搜索)
- Step 2:局部脱壳(引用 deobfuscation.md)
- Step 3:相关性判定与依赖链扩展(保守剪枝标准 + 终止条件)
- Step 4:两遍静态剪枝闭环(增量剪枝 vs 全局剪枝区分)
- 产出物:加密点位 + 依赖链图谱 + 脱壳代码集 + 变换台账 + 边界标记
- 与 deobfuscation.md 分工:stage2-tracing.md 负责流程编排,deobfuscation.md 仅负责 Step 2 局部脱壳

**deobfuscation.md 职责收窄:**
- 从"阶段三去壳完整流程"改为"阶段二 Step 2 局部脱壳"
- 新增 iv8 字符串表拉取独立章节(静态解不出 → iv8 跑原代码 Hook 字符串解密函数)
- 新增脱壳范围与深度预算(2层限制:当前函数 + 直接调用的下层函数)
- 新增脱壳后验证与分层回退纠错(三种失败原因:字符串表不完整/逻辑断裂/依赖未发现)
- 新增脱壳终止标准(充分锚点清单)四项检查
- 删除 Black-box reuse 判定(移到 code-extraction.md)
- 删除 JSVMP Recovery Level A/B/C(移到 decision-tree.md 分支 B)
- 删除 Worker 壳层判定要点和桥接层卡片模板(阶段二只标记 Worker 边界,具体处理交阶段四分支 D)

**方案降级链简化(1/2/3 → 1/3):**
- 删除方案 2(扣代码+Node.js/iv8):Node.js 路径与方案 1 边界模糊,iv8 路径与方案 3 重合
- 方案 1(Python 重写):标准算法+参数来源明确,或非标准但简单可读懂;新增 API 说明强制产出(函数签名+参数含义+获取方式)
- 方案 3(iv8 补环境):非标准+复杂,或参数浏览器动态产生,或方案 1 试跑失败
- 判定流程:标准算法?→参数来源明确?→方案1;非标准→简单可读懂?→方案1试跑→失败走方案3
- 禁止把魔改算法当标准算法走方案 1;禁止方案 1 试跑失败后花时间定位根因(直接降级方案 3)

**动态剪枝删除:**
- 原 v8 设计的动态剪枝子步骤(方案2/3/全量iv8 时 hook 加密参数赋值点验证依赖链)已删除
- 原因:方案 2 取消后,方案 3 跑整个依赖链不减少范围,动态剪枝的输出"验证后依赖链"无消费者
- 方案 3 的环境缺口探测改由 trace 前置(主)+ iv8 debug(辅)完成

**trace 前置补环境(新增):**
- iv8-env-patching.md 新增"trace 前置补环境(主)"章节
- trace 日志含 stack 字段(含 file/line/col),按依赖链涉及的文件 URL 过滤可精准定位目标 JS 的 API 调用清单
- 流程:trace 按文件过滤 → API 清单 → 对比 iv8 已有环境找缺口 → 预补环境 → iv8 debug 验证
- trace 前置为主,iv8 debug 为辅;trace 是"应该有什么"(静态),iv8 debug 是"实际缺什么"(运行时)

**har-analysis.md 扩展:**
- 新增 `_initiator.stack` 提取与字段化输出(字段结构 + 字段化输出格式 + 提取约束)
- 新增 WASM 加载存在标记(检测方式 + 输出字段 + 约束)
- 新增 HAR 来源校验(Chrome 完整/Firefox/Safari 部分/抓包工具无 _initiator + 校验规则 + 校验输出)
- 新增阶段二启动条件

**code-extraction.md 重写:**
- 三种实现模式:Python 重写模式(方案 1)+ iv8 补环境模式(方案 3)+ Black-box reuse 模式
- 方案 2(扣代码+Node.js/iv8)已删除:Node.js 路径与方案 1 边界模糊,iv8 路径与方案 3 重合
- 方案 1 新增 API 说明强制产出(函数签名+参数含义+类型+获取方式+返回值结构)
- Black-box reuse 从旧 deobfuscation.md 移入,独立章节(§4)
- 输入输出边界来源调整:v7 的 trace+HAR → v8 的 HAR+iv8 hook(trace 不再参与加密点定位)
- 修正分支引用对齐 v8(分支 C=Webpack不清晰/D=Worker/E=无附加保护)
- 修正定位方式(阶段二已定位,不重新做加密点定位和依赖分析)
- 保留原有代码示例(Python还原/webpack改写/验证策略)

**JSVMP Recovery Level 移至分支 B:**
- 从 deobfuscation.md 移到 decision-tree.md §4.2 分支 B
- 硬性升级规则:不能因代码脏/平坦化重/字符串表复杂直接跳 C;A→B 需满足关键 opcode 不恢复 dispatcher 语义无法解释;B→C 需满足下游要求重放多条执行路径

**禁止事项新增:**
- 禁止用 trace 做加密点定位(trace 对纯 JS 加密函数有结构性盲区,用 HAR `_initiator.stack` + 格式化方案)
- 禁止把 trace 当作"要补什么"的清单(以 iv8 debug 探测为准,trace value 仅作基准参考;但 trace 可用于前置补环境的 API 清单过滤)
- 禁止跳过载体形态判定直接选方案(阶段三确认载体形态后阶段四才选分支)
- 禁止 JSVMP 场景因代码脏/平坦化重直接跳 Recovery Level C
- 禁止 Black-box reuse 用 trace 作边界来源(v8 下 trace 仅环境指纹采集)
- 禁止跳过依赖图分析直接 page.load 整个 JS(先分析最小执行范围)
- 禁止跳过去壳后验证(去壳后必须检查业务逻辑完整性,不完整触发分层回退纠错)
- 禁止把 Worker 当壳(Worker 是算子物理隔离,不是语法变形)
- 禁止把 JSVMP/WASM/Webpack/Worker 当壳去处理(它们是保护类型/打包技术,非壳)
- 禁止把魔改算法当标准算法走方案 1(改 S 盒的 AES/自定义变形都不算标准)
- 禁止方案 1 试跑失败后花时间定位根因(不能动态调试,直接降级方案 3)

## v7

(在 v6 基础上修正壳定义/eval判定/去壳流程/标签分类/方案探测的多处逻辑漏洞,并按 skill-creator 规范化文档结构)

**OB 场景标识符加密检测加固:**
- Webpack 检测补充结构特征备份(明文 `__webpack_require__` 被字符串表加密时使用):模块表数字key→函数值映射、stack模块ID数字、IIFE三段式
- WASM 检测补说明:`WebAssembly` 标识符可能被加密,`.wasm`文件加载和大段Base64作为备份
- Worker 检测补说明:`Worker`/`postMessage` 标识符可能被加密,"主线程stack无算子+postMessage调用结构"作为备份
- JSVMP 不受影响(五条检查清单全结构特征)

**壳定义修正:**
- 删除"理论可逆性"论断——壳定义基于结构特征(混淆器指纹/eval包装),"能否还原"是工程结果不是定义的一部分
- OB壳合并为 1 类(不再区分标准/变种,处理方法相同)
- 判定分两层:事前识别(结构特征判疑似壳)+ 事后验证(去壳后检查业务完整性)

**eval判定方法重写:**
- 从"尝试去除eval层看能否运行"改为"hook eval拦截执行字符串,按内容性质判定"(OB壳/JSVMP组成/业务用法三类)
- 删除"视情况"模糊表述,业务函数内部eval归入统一判定方法

**去壳流程修正:**
- stack可靠性说明:stack是运行时调用栈,OB静态混淆不影响调用结构真实性;五条清单区分CFF和JSVMP
- "检查胶水层是否有壳"明确为扫描结构特征,不是读懂代码逻辑
- 加密点定位靠file+line+col,不靠func名
- 依赖发现优先用trace运行时调用链,静态发现用trace验证
- 终止标准"能识别"改为"特征信号足够清晰可进入复核环节"
- 补充扣代码失败回退路径(依赖未去壳→回退扩大范围;依赖扣不出→降级方案3)
- Black-box reuse输入输出边界来源明确为trace+HAR
- 去壳自检边界:仅验证还原正确性,不跑完整加密函数,不补环境

**Webpack整体被壳顺序约束:**
- 新增bootstrap CFF打散判定(静态为主,trace辅助)
- 静态路径(未打散):OB壳最小还原→拆bundle→对目标模块做OB还原
- 动态路径(打散):不还原CFF,iv8跑原代码→trace拿模块ID→hook __webpack_require__→dump exports

**标签二维化:**
- Worker从保护维度移到位置维度(主线程/Worker),保护维度4类(WASM/JSVMP/Webpack/原生JS)
- 标签输出格式改为组合标签`位置:保护`,如`Worker:JSVMP`
- 复核流程统一:不论位置维度如何,保护维度判定标准一致

**Worker分支修正:**
- 嵌套Worker:分支D内递归走D,深度警告≤3
- 删除"退回locate",改为blob反查/iv8 Hook Blob构造器/降级方案3
- blob URL反查统一走iv8运行时Hook(不靠静态反查)
- Worker与JSVMP同时命中时Worker优先(需确认postMessage指向Worker算子)

**方案探测修正:**
- 方案1启用条件新增第4项:运行时探测+输出校验(防间接依赖漏判)
- 方案2运行时探测必须配合输出校验(与trace比对),补静默分叉/API行为差异风险说明

**其他修正:**
- 删除"提取"上位概念,改为4种操作各自描述(含难度/失败模式)
- 置信度分去壳前(基于stack)/去壳后(基于代码)两层
- 字段名统一用feature_initial/protection_final
- bundle外壳从主导壳层删除(方案A,bundle是Webpack工程特征不是壳)
- 多特征叠加补充优先级规则(壳优先→Webpack→WASM胶水去壳→WASM/JSVMP)
- 阶段二与阶段三3.1职责切分(阶段二识别,阶段三3.1分流)
- 阶段三交付物定义为语义锚点片段+变换台账

**skill-creator规范化:**
- description精简至~100词(保留触发关键词,细节移到body)
- 为>300行的reference文件补目录(deobfuscation.md、decision-tree.md)

## v6

(在 v5 基础上引入壳的通用定义与独立去壳阶段,重构决策树为去壳通道+5分支)

- **壳的通用定义:** 新增"壳定义"章节(权威定义 + 2类壳:OB壳/eval-Function壳 + 非壳区分维度含Worker + eval 何时是壳 + 事前识别vs事后验证 + 封装结构处理操作4种)。壳定义基于结构特征(混淆器指纹/eval包装);"能否还原"是工程结果,触发纠错机制。判定分两层:事前识别(结构特征判疑似壳)+ 事后验证(去壳后检查业务完整性,断裂则回退纠错)。字符串加密/控制流平坦化等是 OB 壳的识别特征。
- **六阶段工作流:** v5 五阶段扩展为六阶段。新增阶段三"去壳"作为独立阶段(5个子环节:去壳入口判断/按需局部去壳/eval递归脱壳/终止标准/去壳失败纠错)。原阶段三/四/五顺延为四/五/六。
- **去壳模块接入:** 采纳 `deobfuscation-reference.md` 作为阶段三 reference(放入 `references/modules/deobfuscation.md`),替换原 ob-deobfuscation.md。内容含按需局部去壳、Webpack-in-OB 顺序约束、Black-box reuse、JSVMP Recovery Level A/B/C、字符串表运行时拉取、反调试干扰区分。
- **iv8 替换 Node.js(方案B):** 去壳阶段 iv8 为主(反调试自检/字符串表拉取/活路径证明),Node.js 仅在 Webpack bootstrap 拆解等纯计算场景备选。
- **Worker 新分支:** 保护类型标签从 4 类扩为 5 类(新增 Worker),分支编号 A=WASM/B=JSVMP/C=Webpack/D=Worker/E=原生JS。分支 D 先拿 Worker 源码→去壳→标签复核→走对应分支→桥接层处理。
- **决策树重构:** obfuscator 不再是独立分支,进去壳通道;去壳后标签复核(5类)。分支 C/E 共享方案 1/2/3 降级链(Python→扣代码+Node→扣代码+iv8→全量iv8兜底),方案 2 内部按运行时探测分流(先 Node 试跑报错转 iv8)。
- **特征初判前移:** JSVMP 在去壳前初判(基于 stack),命中直走分支 B 不去壳;五条检查清单在初判(去壳前)和复核(去壳后)都用。
- **去壳原则:** 按需局部去壳(从加密点出发,边去边发现依赖,不做全文件去混淆);终止标准=语义锚点支撑下一步即停(不是终止条件:变量名还原/代码完全可读)。
- **去壳失败纠错:** 工具解不开→eval规则判定→是壳但解不开:回退复核JSVMP→仍非JSVMP则兜底带壳iv8;逻辑断裂:按JSVMP处理。
- **删除经验规则:** 删除 v5 "WASM 与 obfuscator 不共存"经验规则(任何标签都可能带壳)。
- evals.json 新增用例 33-42(共10条),旧用例 24/25/30/31/32 考察点迁移。

## v5

(在 v4 基础上新增保护类型初判,解决 JSVMP vs obfuscator 误判问题,保持决策树低耦合)

- **保护类型初判(trace-cross-verify.md §3.7):** 在阶段二(trace 加密点定位)与阶段三(环境探测与算法还原)之间新增初判环节。利用 §3.2 输出的 file+func+stack 顺势判别,**不执行 JS、不读完整函数体**,只看 trace + 文件级静态特征。两步流程:
  - 第一步 stack 结构初判:WASM/Webpack/纯JS 直接出标签;指向 ob/jsvmp 场景进入第二步。
  - 第二步 JSVMP vs obfuscator 精确判别(五条检查清单:dispatch loop + 字节码数组 + 栈/寄存器 + case 抽象操作 + trace PC 单调递增,全满足才算 JSVMP)。
  - 默认策略:不确定时优先判 obfuscator(obfuscator 成本低可逆,误判 JSVMP 成本高;先走 C 再转 B)。
- **决策树低耦合:** decision-tree.md **不改**,只保留分支处理策略;判别逻辑全部在 trace-cross-verify.md §3.7。判别输出标签 → 决策树对应分支。
- **前置条件约束:** ob-deobfuscation.md §1 新增前置条件——进入本模块前标签必须为 obfuscator;若为 JSVMP 走分支 B。
- **SKILL.md 微调:** 五阶段工作流表阶段二/三说明补"输出/携带保护类型标签";禁止事项新增"禁止跳过保护类型初判直接进入阶段三"。
- evals.json 新增用例 30(JSVMP vs obfuscator 判别)、31(obfuscator 变种判别)、32(混合型 obfuscator+Webpack),共 32 条。

## v4

(在 v3 web 逆向 skill 基础上完善验证策略、指纹提取、日志分离,并修复一致性问题)

- **验证策略拆分(确定性 vs 非确定性):** code-extraction.md 新增 §2.5。确定性算法(AES/SHA/HMAC 固定 key+IV)用固定输入 + 全量相等(===)比对;非确定性算法(RSA 随机 padding、含 Math.random/微秒时间戳)用长度 + 结构 + 服务器接受度验证。
- **指纹预设值提取具体化:** trace-cross-verify.md §5 重写为 3 步流程(查 iv8 是否已有 → 从 trace 提取 value → 仅对 iv8 没有的 API 注入预设)。强调"不补 iv8 已有环境、不用劫持代码、直接从 trace 获取"——9 处引用一致贯彻此约束。
- **日志分离(iv8 debug 与 print 隔离):** iv8-env-patching.md 新增日志分离章节(原理 + 模板 + 使用建议表);single_context.py 模板新增 `debug_log` 参数;SKILL.md 关键提醒补充。原理:print 走 stdout(控制台),iv8 debug 走 stderr(重定向到文件),两条流物理隔离。
- **一致性修复:**
  - code-conventions.md 4.2 日志重定向方向错误(`sys.stdout` → `sys.stderr`,与日志分离原理对齐)。
  - calltree 命令格式统一为 `calltree --file <file>`(trace-cross-verify.md §3.2/§3.5、evals.json #26/#27 共 4 处修复,全局 12 处引用规范一致)。
  - v3 变更章节术语对齐("主轨/辅轨" → "trace 独立分析优先 + iv8 执行轨")。
- evals.json 新增用例 28(确定性 vs 非确定性验证策略)、用例 29(日志分离使用方法),共 29 条。

## v3

(从 v2 iv8 补环境 skill 升维为 web 逆向 skill)

- 新增五阶段工作流:HAR 溯源 → 加密点定位 → 环境探测 → 方案选择 → 本地模拟。
- 新增双轨交叉验证方法论(trace 独立分析优先 + iv8 执行轨,两轨交叉验证)。
- **决策树重构为特征驱动:** Step 0 动态脱壳 → Step 1 特征扫描 → 分支 A(WASM)/B(JSVMP)/C(obfuscator)/D(Webpack)/E(纯 JS)。
- 新增 obfuscator 去混淆模块(modules/ob-deobfuscation.md):AST 字符串还原、控制流平坦化还原、变换台账。
- 术语统一:统一使用 JSVMP(JavaScript 虚拟机保护)。
- iv8 内容迁移到 modules/iv8-env-patching.md(原样保留)。
- 新增 trace 交叉验证模块、扣代码模块、HAR 分析模块。
- 新增 trace_analyzer.py 脚本(处理大 trace 文件)。
- **trace 分析升级:** 从"交叉验证辅轨"升级为"独立分析方法 + 交叉验证双用途";脚本从 5 个命令扩展到 10 个(新增 chain/calltree/timeline/algo/filter)。
- 禁止 RPC/浏览器自动化。
