# 🧰 技能库 (Skills Library)

> 统一的 AI 编码技能库，覆盖开发全生命周期。每个技能包含 `SKILL.md` 定义文件和附属资源。

**总计: 78 个技能** | 最后更新: 2026-07-02

---

## 📋 技能总览

| 技能名 | 中文说明 |
|--------|---------|
| 00-four-principles | Karpathy 四大编码原则：想清楚再写、简单优先、外科手术式改动、目标驱动验证（治隐性假设/过度… |
| 01-feature | 从 0 到 1 开发新功能的一条龙：头脑风暴→设计→TDD→验证→审查→记忆，中途不停自动跑到验证通过 |
| 02-quality | 代码质量两段式体检：先审查出优化计划书（只读不改）→你批准后再自动修复+测试+排障 |
| 03-refactor | 大规模并行重构：子智能体把跨文件机械改动拆成独立单元并行替换，带回滚与验证闸（高危流程） |
| 04-agent-coding | 高自主智能体编码：把命令式指令换成可验证目标，让 agent 死磕测试循环直到通过 |
| 05-knowledge-base-manager | Obsidian 双链知识库主理人：原料整理/Ingest/蒸馏、聊天脑转储、深度调研入库、断链与孤… |
| 06-html-visualize | 把输出编译成单文件交互式 HTML：报告/架构图/UI 原型/数据面板/幻灯，可导出可 diff |
| 07-project-handoff | 项目交接协议：维护根目录 HANDOFF.md（按业务域分区、多窗口不冲突、只追加），任何 AI 接… |
| api-design | API 设计 — REST/GraphQL 接口设计规范:资源命名、URL 结构、HTTP 状态码… |
| app-reverse | 移动端(Android/iOS)加密参数逆向 — 当 Web 抓包发现某 sign/token/加密… |
| architecture-decision-records | 架构决策记录(ADR)— 把编码会话中的架构决策实时写成结构化 docs/adr/ 文档，记录背景… |
| ast-deobfuscation | AST反混淆 — 基于抽象语法树的代码反混淆与还原 |
| batch | 大规模改动·单机串行版：无并行底座时把大改动拆成可控步骤逐个执行验证 |
| brainstorming | 头脑风暴：写代码前探讨需求意图、比选设计方案、产出经批准的设计规格 |
| browser-qa | 浏览器手动QA — 上线/PR前在真实浏览器中验证页面 |
| captcha-solver | 验证码识别 — 自动化验证码破解与识别 |
| claude-in-chrome | Chrome 浏览器自动化：点击/填表/截图/读控制台做 E2E 验证 |
| code-tour | 代码导览 — 交互式代码库漫游与结构理解 |
| codebase-onboarding | 代码库上手 — 快速理解新项目的结构与关键路径 |
| compressing-memory | 压缩归档 docs/ 记忆：去噪/去重/修乱码/重分层 |
| context-budget | 上下文预算 — 审计当前会话各组件(skills/agents/MCP/规则)的 token 开销… |
| continuous-agent-loop | 自律智能体循环 — 无人值守持续开发循环/CI 驱动迭代/RFC 驱动多智能体 DAG 并行编排；智… |
| data-scraper-agent | 数据抓取智能体 — 自动化网页数据采集与结构化提取 |
| debug | 深层排障：底层追踪+日志全景，专治复杂崩溃/环境故障/进程挂起 |
| deep-research | 深度调研 — 利用并行智能体进行深入技术调研 |
| deployment-patterns | 部署模式 — 生产部署策略与 CI/CD:滚动/蓝绿/金丝雀发布、health check 与 K8… |
| design-system | 设计系统 — 生成/审计/slop-check 三模式:扫码库提取设计 token、按 10 维给现… |
| desktop-client-reverse | 桌面客户端逆向（主要 Windows）— 当目标是 PC 桌面客户端（.exe/.dll），请求里的… |
| dispatching-parallel-agents | 并发分发：3+ 个互相独立无共享状态的任务同时推进 |
| docker-patterns | Docker 模式 — Docker 与 Compose 最佳实践:本地多服务开发环境一键搭建、网络… |
| e2e-testing | 端到端测试(E2E)— 用 Playwright 写 E2E 自动化测试:Page Object M… |
| env-patcher | 补环境 — 为 Node.js VM 沙箱生成浏览器 API mock 脚本(browser.js)… |
| executing-plans | 计划执行器：照已批准计划逐条落地，带断点+TDD+进度跟踪 |
| finishing-a-development-branch | 开发收尾：功能完成+测试全绿后，决定合并/建 PR/保留/丢弃分支 |
| git-workflow | Git 参考手册，手动 /git-workflow 查分支策略/提交规范/merge vs reba… |
| goal | 目标锚定（goal-keeper）：开工前把模糊意图固化成一个可验证、可量化的目标——写清成功证据… |
| gsap-core | GSAP 核心动画 — gsap.to/from/fromTo、缓动 easing、时长、stagg… |
| gsap-frameworks | GSAP × 非 React 框架 — Vue/Nuxt/Svelte/SvelteKit 里的生命… |
| gsap-performance | GSAP 性能优化 — 减卡顿/掉帧/布局抖动：优先 transform/opacity、避免 la… |
| gsap-plugins | GSAP 插件 — 导入/注册/授权与正确用法：Flip、Draggable、SplitText、M… |
| gsap-react | GSAP × React/Next — useGSAP、refs、scope、gsap.contex… |
| gsap-scrolltrigger | GSAP 滚动动画 — ScrollTrigger：滚动触发、pin 固定、scrub 进度绑定、视… |
| gsap-timeline | GSAP 时间线 — gsap.timeline()、position 参数、标签、嵌套时间线、播放… |
| gsap-utils | GSAP 工具函数 — gsap.utils：clamp、mapRange、normalize、in… |
| jsvmp-bytecode-recovery | JSVMP/VMP 虚拟机保护逆向方法论 — 面对大数组+解释器+派发循环这类把原始逻辑编译成字节码… |
| liquid-glass-design | 液态玻璃设计 — Apple风格Liquid Glass毛玻璃UI |
| loop | 循环执行器 |
| make-interfaces-feel-better | UI体验优化 — 改善用户界面交互体验的微调模式 |
| param-encryptor | | |
| production-audit | 生产环境审计 — 对线上系统进行全面质量与安全审计 |
| prompt-optimizer | 提示词优化 — 分析你给的提示词草稿，诊断问题并输出一份可直接粘贴使用的优化版；只产出改进建议和成品… |
| receiving-code-review | 接收代码评审：收到 review 反馈后分诊→评估→落实修改 |
| remember | 固化记忆排坑：把会话里的排坑/架构决策/习惯写入 CLAUDE.md 和 docs/ 记忆 |
| repo-scan | 仓库扫描 — 跨栈(C/C++/Android/iOS/Web)遗留代码库源码审计:逐文件打标(自有… |
| requesting-code-review | 发起代码评审：功能做完请独立视角把关再合并 |
| reverse-parity-gate | >- |
| reverse-traffic-triage | 逆向流量诊断与参数溯源 — 抓到包之后、动手扣代码之前的强制纪律：把目标参数从「请求里出现」一路反查… |
| schedule | 定时任务流调度 |
| security-bounty-hunter | 安全漏洞猎手 — 触发词：找可利用漏洞/这个洞能打吗/准备 Huntr 或 HackerOne 报告… |
| security-review | 安全审查 — 实现认证/处理用户输入/新建API端点/操作密钥或凭证/接入支付或敏感功能时触发；提供… |
| security-scan | 配置安全扫描(手动)— npx ecc-agentshield 扫 .claude/ 配置(sett… |
| simplify | 代码坏味道清理 |
| stuck | 死锁急救：会话/dev server/子进程卡死挂起时的紧急脱困与恢复 |
| subagent-driven-development | 子智能体驱动开发：当前会话用独立子 agent 逐任务执行，每个带规格+质量双审查 |
| systematic-debugging | 系统级调试（应用逻辑层）：逻辑 bug / 测试失败 / 行为异常 / 回归 / 构建报错 → 优先… |
| test-driven-development | 测试驱动开发：先写测试→全绿→再写实现 |
| using-git-worktrees | Git worktree：开隔离工作区并行开发不同分支互不干扰 |
| using-superpowers | 超能力指南：管所有技能如何被发现和调用的元技能，会话起始常驻 |
| verification-before-completion | 完工前验证：宣称完成或提交前必须跑出真实测试证据（铁律·无证据不许说完成） |
| verify | 全量红绿验收 |
| web-reverse-brainstorming | >- |
| web-reverse-executing-plans | Web逆向计划执行 — 逆向工程计划的逐步执行 |
| web-reverse-master | Web逆向大师 — Web逆向工程的综合技能集 |
| web-reverse-systematic-debugging | Web逆向调试 — 逆向工程中的系统级排障 |
| web-reverse-test-driven-development | Web逆向TDD — 逆向工程的测试驱动开发 |
| web-reverse-writing-plans | Web逆向计划编写 — 逆向工程的分步计划编写 |
| writing-plans | 写施工计划：把已批准设计规格转成可逐步执行的 TDD 实施计划 |
| writing-skills | 技能编写元技能：用 TDD 创建/加固 SKILL.md 技能包；含访谈提取流程，能从会话中捕捉可复… |

---

## 🏷️ 分类索引

### 🕸️ Web逆向工程
| 技能 | 说明 |
|------|------|
| web-reverse-master | Web逆向大师 — Web逆向工程的综合技能集 |
| reverse-traffic-triage | 逆向流量诊断与参数溯源 — 抓到包之后、动手扣代码之前的强制纪律：把目标参数从「请求里出现」一路反查… |
| param-encryptor | | |
| ast-deobfuscation | AST反混淆 — 基于抽象语法树的代码反混淆与还原 |
| captcha-solver | 验证码识别 — 自动化验证码破解与识别 |
| env-patcher | 补环境 — 为 Node.js VM 沙箱生成浏览器 API mock 脚本(browser.js)… |
| jsvmp-bytecode-recovery | JSVMP/VMP 虚拟机保护逆向方法论 — 面对大数组+解释器+派发循环这类把原始逻辑编译成字节码… |
| reverse-parity-gate | >- |
| app-reverse | 移动端(Android/iOS)加密参数逆向 — 当 Web 抓包发现某 sign/token/加密… |
| desktop-client-reverse | 桌面客户端逆向（主要 Windows）— 当目标是 PC 桌面客户端（.exe/.dll），请求里的… |
| data-scraper-agent | 数据抓取智能体 — 自动化网页数据采集与结构化提取 |
| web-reverse-brainstorming | >- |
| web-reverse-writing-plans | Web逆向计划编写 — 逆向工程的分步计划编写 |
| web-reverse-executing-plans | Web逆向计划执行 — 逆向工程计划的逐步执行 |
| web-reverse-test-driven-development | Web逆向TDD — 逆向工程的测试驱动开发 |
| web-reverse-systematic-debugging | Web逆向调试 — 逆向工程中的系统级排障 |

### 🎬 动画与前端 (GSAP)
| 技能 | 说明 |
|------|------|
| gsap-core | GSAP 核心动画 — gsap.to/from/fromTo、缓动 easing、时长、stagg… |
| gsap-timeline | GSAP 时间线 — gsap.timeline()、position 参数、标签、嵌套时间线、播放… |
| gsap-scrolltrigger | GSAP 滚动动画 — ScrollTrigger：滚动触发、pin 固定、scrub 进度绑定、视… |
| gsap-react | GSAP × React/Next — useGSAP、refs、scope、gsap.contex… |
| gsap-frameworks | GSAP × 非 React 框架 — Vue/Nuxt/Svelte/SvelteKit 里的生命… |
| gsap-plugins | GSAP 插件 — 导入/注册/授权与正确用法：Flip、Draggable、SplitText、M… |
| gsap-utils | GSAP 工具函数 — gsap.utils：clamp、mapRange、normalize、in… |
| gsap-performance | GSAP 性能优化 — 减卡顿/掉帧/布局抖动：优先 transform/opacity、避免 la… |

### 🎯 目标与开发主链
| 技能 | 说明 |
|------|------|
| goal | 目标锚定（goal-keeper）：开工前把模糊意图固化成一个可验证、可量化的目标——写清成功证据… |
| brainstorming | 头脑风暴：写代码前探讨需求意图、比选设计方案、产出经批准的设计规格 |
| writing-plans | 写施工计划：把已批准设计规格转成可逐步执行的 TDD 实施计划 |
| executing-plans | 计划执行器：照已批准计划逐条落地，带断点+TDD+进度跟踪 |
| subagent-driven-development | 子智能体驱动开发：当前会话用独立子 agent 逐任务执行，每个带规格+质量双审查 |
| 01-feature | 从 0 到 1 开发新功能的一条龙：头脑风暴→设计→TDD→验证→审查→记忆，中途不停自动跑到验证通过 |
| 04-agent-coding | 高自主智能体编码：把命令式指令换成可验证目标，让 agent 死磕测试循环直到通过 |

### 🔧 排障调试
| 技能 | 说明 |
|------|------|
| debug | 深层排障：底层追踪+日志全景，专治复杂崩溃/环境故障/进程挂起 |
| systematic-debugging | 系统级调试（应用逻辑层）：逻辑 bug / 测试失败 / 行为异常 / 回归 / 构建报错 → 优先… |
| stuck | 死锁急救：会话/dev server/子进程卡死挂起时的紧急脱困与恢复 |

### 🧪 测试与验证
| 技能 | 说明 |
|------|------|
| test-driven-development | 测试驱动开发：先写测试→全绿→再写实现 |
| e2e-testing | 端到端测试(E2E)— 用 Playwright 写 E2E 自动化测试:Page Object M… |
| browser-qa | 浏览器手动QA — 上线/PR前在真实浏览器中验证页面 |
| verify | 全量红绿验收 |
| verification-before-completion | 完工前验证：宣称完成或提交前必须跑出真实测试证据（铁律·无证据不许说完成） |
| simplify | 代码坏味道清理 |

### 🔄 重构与质量
| 技能 | 说明 |
|------|------|
| 02-quality | 代码质量两段式体检：先审查出优化计划书（只读不改）→你批准后再自动修复+测试+排障 |
| 03-refactor | 大规模并行重构：子智能体把跨文件机械改动拆成独立单元并行替换，带回滚与验证闸（高危流程） |
| receiving-code-review | 接收代码评审：收到 review 反馈后分诊→评估→落实修改 |
| requesting-code-review | 发起代码评审：功能做完请独立视角把关再合并 |

### 🤖 智能体与自动化
| 技能 | 说明 |
|------|------|
| dispatching-parallel-agents | 并发分发：3+ 个互相独立无共享状态的任务同时推进 |
| continuous-agent-loop | 自律智能体循环 — 无人值守持续开发循环/CI 驱动迭代/RFC 驱动多智能体 DAG 并行编排；智… |
| batch | 大规模改动·单机串行版：无并行底座时把大改动拆成可控步骤逐个执行验证 |
| loop | 循环执行器 |
| schedule | 定时任务流调度 |
| prompt-optimizer | 提示词优化 — 分析你给的提示词草稿，诊断问题并输出一份可直接粘贴使用的优化版；只产出改进建议和成品… |
| context-budget | 上下文预算 — 审计当前会话各组件(skills/agents/MCP/规则)的 token 开销… |

### 🎨 设计与UI
| 技能 | 说明 |
|------|------|
| design-system | 设计系统 — 生成/审计/slop-check 三模式:扫码库提取设计 token、按 10 维给现… |
| liquid-glass-design | 液态玻璃设计 — Apple风格Liquid Glass毛玻璃UI |
| make-interfaces-feel-better | UI体验优化 — 改善用户界面交互体验的微调模式 |
| 06-html-visualize | 把输出编译成单文件交互式 HTML：报告/架构图/UI 原型/数据面板/幻灯，可导出可 diff |

### 🚀 部署与协作
| 技能 | 说明 |
|------|------|
| deployment-patterns | 部署模式 — 生产部署策略与 CI/CD:滚动/蓝绿/金丝雀发布、health check 与 K8… |
| docker-patterns | Docker 模式 — Docker 与 Compose 最佳实践:本地多服务开发环境一键搭建、网络… |
| api-design | API 设计 — REST/GraphQL 接口设计规范:资源命名、URL 结构、HTTP 状态码… |
| git-workflow | Git 参考手册，手动 /git-workflow 查分支策略/提交规范/merge vs reba… |
| using-git-worktrees | Git worktree：开隔离工作区并行开发不同分支互不干扰 |
| finishing-a-development-branch | 开发收尾：功能完成+测试全绿后，决定合并/建 PR/保留/丢弃分支 |
| architecture-decision-records | 架构决策记录(ADR)— 把编码会话中的架构决策实时写成结构化 docs/adr/ 文档，记录背景… |

### 🔍 代码库理解
| 技能 | 说明 |
|------|------|
| code-tour | 代码导览 — 交互式代码库漫游与结构理解 |
| codebase-onboarding | 代码库上手 — 快速理解新项目的结构与关键路径 |
| repo-scan | 仓库扫描 — 跨栈(C/C++/Android/iOS/Web)遗留代码库源码审计:逐文件打标(自有… |
| deep-research | 深度调研 — 利用并行智能体进行深入技术调研 |

### 🛡️ 安全审计
| 技能 | 说明 |
|------|------|
| security-review | 安全审查 — 实现认证/处理用户输入/新建API端点/操作密钥或凭证/接入支付或敏感功能时触发；提供… |
| security-scan | 配置安全扫描(手动)— npx ecc-agentshield 扫 .claude/ 配置(sett… |
| security-bounty-hunter | 安全漏洞猎手 — 触发词：找可利用漏洞/这个洞能打吗/准备 Huntr 或 HackerOne 报告… |
| production-audit | 生产环境审计 — 对线上系统进行全面质量与安全审计 |

### 📦 记忆与元技能
| 技能 | 说明 |
|------|------|
| remember | 固化记忆排坑：把会话里的排坑/架构决策/习惯写入 CLAUDE.md 和 docs/ 记忆 |
| compressing-memory | 压缩归档 docs/ 记忆：去噪/去重/修乱码/重分层 |
| 05-knowledge-base-manager | Obsidian 双链知识库主理人：原料整理/Ingest/蒸馏、聊天脑转储、深度调研入库、断链与孤… |
| 07-project-handoff | 项目交接协议：维护根目录 HANDOFF.md（按业务域分区、多窗口不冲突、只追加），任何 AI 接… |
| writing-skills | 技能编写元技能：用 TDD 创建/加固 SKILL.md 技能包；含访谈提取流程，能从会话中捕捉可复… |
| using-superpowers | 超能力指南：管所有技能如何被发现和调用的元技能，会话起始常驻 |
| 00-four-principles | Karpathy 四大编码原则：想清楚再写、简单优先、外科手术式改动、目标驱动验证（治隐性假设/过度… |

### 📎 其它
| 技能 | 说明 |
|------|------|
| claude-in-chrome | Chrome 浏览器自动化：点击/填表/截图/读控制台做 E2E 验证 |

---

## 📝 技能来源

| 项 | 技能数 |
|----------|-----------|
| v1.0 基线 | 75 |
| 本轮移除（合并/依赖未装工具，如 skillify·tdd-workflow·scrape·investigate 等 12 个） | −12 |
| 本轮新增（逆向 5 + GSAP 8 + goal + 07-project-handoff） | +15 |
| **总计** | **78** |

---

## 使用说明

每个技能目录包含 `SKILL.md` 文件，其 YAML frontmatter 中有：
- `name` — 技能标识名
- `description` — 英文描述
- `description_zh` — 中文描述

将本目录配置为 AI 编码助手的技能目录即可使用。
