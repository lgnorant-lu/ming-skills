---
name: continuous-agent-loop
description: 自律智能体循环 — 无人值守持续开发循环/CI 驱动迭代/RFC 驱动多智能体 DAG 并行编排；智能体自主持续执行与自我纠正
description_en: Patterns for autonomous continuous agent loops — sequential pipelines, CI-driven PR iterations, RFC-driven multi-agent DAG orchestration, infinite generation, and quality gates with recovery controls.
description_zh: 自律智能体循环 — 无人值守持续开发循环/CI 驱动迭代/RFC 驱动多智能体 DAG 并行编排；智能体自主持续执行与自我纠正
origin: ECC
---

# Continuous Agent Loop

无人值守持续开发循环的方法论集：顺序管道、持久会话 REPL、无限智能体循环、CI 驱动的 PR 迭代、De-Sloppify 清理、以及 RFC 驱动的多智能体 DAG 编排。

## Loop Selection Flow

```text
Start
  |
  +-- Need strict CI/PR control? -- yes --> continuous-pr
  |
  +-- Need RFC decomposition? -- yes --> rfc-dag
  |
  +-- Need exploratory parallel generation? -- yes --> infinite
  |
  +-- default --> sequential
```

## Combined Pattern

Recommended production stack:
1. RFC decomposition (见下方 [Ralphinho / RFC 驱动 DAG 编排](#ralphinho--rfc-驱动-dag-编排))
2. quality gates (见下方 [De-Sloppify 模式](#de-sloppify-模式) + 提交前用 `/verify` 门控)
3. eval loop (以可复现的验收标准/测试套件作为每次迭代的通过闸)
4. session persistence (用 `SHARED_TASK_NOTES.md` 或文件系统状态跨迭代桥接上下文)

## Failure Modes

- loop churn without measurable progress
- repeated retries with same root cause
- merge queue stalls
- cost drift from unbounded escalation

## Recovery

- freeze loop
- 审计当前循环的成本/进度/失败根因
- reduce scope to failing unit
- replay with explicit acceptance criteria

---

## 六种循环模式参考实现

以下内容覆盖从最简到最复杂的完整循环模式谱系。

### 模式速览

| 模式 | 复杂度 | 最适合 |
|------|--------|--------|
| [顺序管道](#顺序管道sequential-pipeline) | 低 | 每日开发步骤、脚本化工作流 |
| [持久会话 REPL](#持久会话-repl) | 低 | 交互式持久会话 |
| [无限智能体循环](#无限智能体循环infinite-agentic-loop) | 中 | 并行内容生成、规格驱动工作 |
| [Continuous Claude PR 循环](#continuous-claude-pr-循环) | 中 | 多天迭代项目 + CI 门控 |
| [De-Sloppify 模式](#de-sloppify-模式) | 附加项 | 任何实现步骤后的质量清理 |
| [Ralphinho / RFC 驱动 DAG](#ralphinho--rfc-驱动-dag-编排) | 高 | 大型功能、多单元并行 + 合并队列 |

---

### 顺序管道（Sequential Pipeline）

**最简循环。** 将每日开发拆分为一系列非交互式 `claude -p` 调用，每次调用聚焦于一个清晰步骤。

> 如果你连这种循环都搞不定，说明你还没法在交互模式下驱动 LLM 修复代码。

```bash
#!/bin/bash
# daily-dev.sh — 功能分支的顺序管道

set -e

# 步骤 1：实现功能
claude -p "Read the spec in docs/auth-spec.md. Implement OAuth2 login in src/auth/. Write tests first (TDD). Do NOT create any new documentation files."

# 步骤 2：De-sloppify（清理通道）
claude -p "Review all files changed by the previous commit. Remove any unnecessary type tests, overly defensive checks, or testing of language features. Keep real business logic tests. Run the test suite after cleanup."

# 步骤 3：验证
claude -p "Run the full build, lint, type check, and test suite. Fix any failures. Do not add new features."

# 步骤 4：提交
claude -p "Create a conventional commit for all staged changes. Use 'feat: add OAuth2 login flow' as the message."
```

**设计原则：**
1. **每步隔离** — 每次 `claude -p` 调用有独立上下文窗口，步骤间无上下文泄漏。
2. **顺序重要** — 步骤依次执行，每步基于上一步留下的文件系统状态。
3. **避免负面指令** — 不要说"不要测试类型系统"，而是加单独的清理步骤（见 De-Sloppify）。
4. **退出码传播** — `set -e` 遇到失败即停止管道。

**变体——模型路由：**
```bash
# 用 Opus 做研究（深度推理）
claude -p --model opus "Analyze the codebase architecture and write a plan for adding caching..."

# 用 Sonnet 实现（快速、有能力）
claude -p "Implement the caching layer according to the plan in docs/caching-plan.md..."

# 用 Opus 审查（彻底）
claude -p --model opus "Review all changes for security issues, race conditions, and edge cases..."
```

**变体——工具限制：**
```bash
# 只读分析通道
claude -p --allowedTools "Read,Grep,Glob" "Audit this codebase for security vulnerabilities..."

# 只写实现通道
claude -p --allowedTools "Read,Write,Edit,Bash" "Implement the fixes from security-audit.md..."
```

---

### 持久会话 REPL

**一个会话感知的 REPL 模式。** 用一层薄封装同步调用 `claude -p`，并在每轮携带完整对话历史，实现跨重启的持久交互式循环。

**工作原理（自建即可，约几十行脚本）：**
1. 从一个会话文件（如 `history/{session}.md`）加载对话历史
2. 每条用户消息携带完整历史发给 `claude -p`
3. 响应追加回会话文件（Markdown 即数据库）
4. 会话跨重启持久化

| 场景 | 持久 REPL | 顺序管道 |
|------|-----------|---------|
| 交互式探索 | 是 | 否 |
| 脚本化自动化 | 否 | 是 |
| 会话持久化 | 内置 | 手动 |
| 上下文累积 | 每轮增长 | 每步新鲜 |
| CI/CD 集成 | 差 | 优秀 |

---

### 无限智能体循环（Infinite Agentic Loop）

**双提示系统**，为并行子智能体的规格驱动生成而设计（credit: @disler）。

```
PROMPT 1（编排器）                    PROMPT 2（子智能体）
┌──────────────────────┐             ┌──────────────────────┐
│ 解析规格文件          │             │ 接收完整上下文        │
│ 扫描输出目录          │  部署       │ 读取分配的编号        │
│ 规划迭代              │────────────│ 严格遵循规格          │
│ 分配创意方向          │  N 个智能体 │ 生成唯一输出          │
│ 管理波次              │             │ 保存到输出目录        │
└──────────────────────┘             └──────────────────────┘
```

**核心洞察：靠分配保唯一性** — 不依赖智能体自我区分，由编排器为每个智能体**指定**具体创意方向和迭代编号，防止并行智能体产生重复概念。

创建 `.claude/commands/infinite.md`：

```markdown
Parse the following arguments from $ARGUMENTS:
1. spec_file — path to the specification markdown
2. output_dir — where iterations are saved
3. count — integer 1-N or "infinite"

PHASE 1: Read and deeply understand the specification.
PHASE 2: List output_dir, find highest iteration number. Start at N+1.
PHASE 3: Plan creative directions — each agent gets a DIFFERENT theme/approach.
PHASE 4: Deploy sub-agents in parallel (Task tool). Each receives:
  - Full spec text
  - Current directory snapshot
  - Their assigned iteration number
  - Their unique creative direction
PHASE 5 (infinite mode): Loop in waves of 3-5 until context is low.
```

**批次策略：**

| 数量 | 策略 |
|------|------|
| 1-5 | 全部同时 |
| 6-20 | 每批 5 个 |
| infinite | 每波 3-5 个，逐步提升复杂度 |

---

### Continuous Claude PR 循环

**生产级 shell 脚本**，持续运行 Claude Code、创建 PR、等待 CI、自动合并（credit: @AnandChowdhary）。

```
┌─────────────────────────────────────────────────────┐
│  CONTINUOUS CLAUDE 迭代                              │
│                                                     │
│  1. 创建分支 (continuous-claude/iteration-N)         │
│  2. 运行 claude -p（含增强提示）                     │
│  3.（可选）审查通道 — 单独的 claude -p              │
│  4. 提交更改（claude 生成提交信息）                  │
│  5. Push + 创建 PR（gh pr create）                  │
│  6. 等待 CI 检查（轮询 gh pr checks）               │
│  7. CI 失败？→ 自动修复通道（claude -p）             │
│  8. 合并 PR（squash/merge/rebase）                  │
│  9. 返回 main → 重复                                │
│                                                     │
│  限制方式：--max-runs N | --max-cost $X             │
│            --max-duration 2h | completion signal    │
└─────────────────────────────────────────────────────┘
```

```bash
# 基础：10 次迭代
continuous-claude --prompt "Add unit tests for all untested functions" --max-runs 10

# 成本限制
continuous-claude --prompt "Fix all linter errors" --max-cost 5.00

# 时间限制
continuous-claude --prompt "Improve test coverage" --max-duration 8h

# 带代码审查通道
continuous-claude \
  --prompt "Add authentication feature" \
  --max-runs 10 \
  --review-prompt "Run npm test && npm run lint, fix any failures"

# 通过 worktree 并行执行
continuous-claude --prompt "Add tests" --max-runs 5 --worktree tests-worker &
continuous-claude --prompt "Refactor code" --max-runs 5 --worktree refactor-worker &
wait
```

**跨迭代上下文：`SHARED_TASK_NOTES.md`**

关键创新：一个 `SHARED_TASK_NOTES.md` 文件在迭代间持久化。Claude 在迭代开始时读取，结束时更新，桥接独立 `claude -p` 调用间的上下文差距。

**CI 失败自动恢复：**
1. 通过 `gh run list` 获取失败的 run ID
2. 启动新的 `claude -p` 并注入 CI 修复上下文
3. Claude 通过 `gh run view` 检查日志、修复代码、提交、推送
4. 重新等待检查（最多 `--ci-retry-max` 次）

**完成信号：**
```bash
continuous-claude \
  --prompt "Fix all bugs in the issue tracker" \
  --completion-signal "CONTINUOUS_CLAUDE_PROJECT_COMPLETE" \
  --completion-threshold 3  # 连续 3 次信号后停止
```

**关键参数：**

| 参数 | 用途 |
|------|------|
| `--max-runs N` | N 次成功迭代后停止 |
| `--max-cost $X` | 花费 $X 后停止 |
| `--max-duration 2h` | 时间到后停止 |
| `--merge-strategy squash` | squash、merge 或 rebase |
| `--worktree <name>` | 通过 git worktree 并行执行 |
| `--disable-commits` | 干跑模式（无 git 操作） |
| `--review-prompt "..."` | 每次迭代添加审查通道 |
| `--ci-retry-max N` | 自动修复 CI 失败（默认：1） |

---

### De-Sloppify 模式

**任何循环的附加模式。** 在每个实现步骤后添加专用清理/重构步骤。

**问题：** 要求 LLM 用 TDD 实现时，它会把"写测试"理解得太字面：
- 验证 TypeScript 类型系统是否工作的测试
- 类型系统已保证的东西的过度防御性运行时检查
- 框架行为而非业务逻辑的测试
- 掩盖实际代码的过多错误处理

**为何不用负面指令？** 在实现提示中加"不要测试类型系统"会导致：模型对所有测试都变得犹豫、跳过合法的边界案例测试、质量不可预测地下降。

**解决方案：独立通道**

```bash
# 步骤 1：实现（让它彻底）
claude -p "Implement the feature with full TDD. Be thorough with tests."

# 步骤 2：De-sloppify（独立上下文，专注清理）
claude -p "Review all changes in the working tree. Remove:
- Tests that verify language/framework behavior rather than business logic
- Redundant type checks that the type system already enforces
- Over-defensive error handling for impossible states
- Console.log statements
- Commented-out code

Keep all business logic tests. Run the test suite after cleanup to ensure nothing breaks."
```

**在循环中使用：**
```bash
for feature in "${features[@]}"; do
  claude -p "Implement $feature with TDD."
  claude -p "Cleanup pass: review changes, remove test/code slop, run tests."
  claude -p "Run build + lint + tests. Fix any failures."
  claude -p "Commit with message: feat: add $feature"
done
```

> 关键洞察：与其加负面指令（有下游质量影响），不如加单独的 de-sloppify 通道。两个专注的智能体优于一个受限的智能体。

---

### Ralphinho / RFC 驱动 DAG 编排

**最复杂的模式。** RFC 驱动、多智能体管道，将规格分解为依赖 DAG，每个单元经过分级质量管道，通过智能体驱动的合并队列落地（credit: @enitrat）。

```
RFC/PRD 文档
       │
       ▼
  分解（AI）
  将 RFC 拆分为带依赖 DAG 的工作单元
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  RALPH 循环（最多 3 次）                              │
│                                                      │
│  对每个 DAG 层（按依赖顺序执行）：                    │
│                                                      │
│  ┌── 质量管道（每单元并行）─────────────────────────┐ │
│  │  每个单元在自己的 worktree 中：                  │ │
│  │  研究 → 计划 → 实现 → 测试 → 审查               │ │
│  │  （深度因复杂度层级而异）                        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
│  ┌── 合并队列──────────────────────────────────────┐ │
│  │  Rebase 到 main → 运行测试 → 落地或驱逐         │ │
│  │  被驱逐的单元带冲突上下文重新进入               │ │
│  └──────────────────────────────────────────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**工作单元结构：**

```typescript
interface WorkUnit {
  id: string;              // kebab-case 标识符
  name: string;            // 人类可读名称
  rfcSections: string[];   // 该单元对应的 RFC 章节
  description: string;     // 详细描述
  deps: string[];          // 依赖（其他单元 ID）
  acceptance: string[];    // 具体验收标准
  tier: "trivial" | "small" | "medium" | "large";
}
```

**分解规则：**
- 优先更少、更内聚的单元（最小化合并风险）
- 最小化跨单元文件重叠（避免冲突）
- 测试与实现放在一起（不要分开"实现 X"和"测试 X"）
- 仅在真实代码依赖存在时才建立依赖关系

**DAG 层执行：**
```
层 0：[unit-a, unit-b]     ← 无依赖，并行运行
层 1：[unit-c]             ← 依赖 unit-a
层 2：[unit-d, unit-e]     ← 依赖 unit-c
```

**复杂度层级：**

| 层级 | 管道阶段 |
|------|---------|
| **trivial** | implement → test |
| **small** | implement → test → code-review |
| **medium** | research → plan → implement → test → PRD-review + code-review → review-fix |
| **large** | research → plan → implement → test → PRD-review + code-review → review-fix → final-review |

**独立上下文窗口（消除作者偏见）：**

| 阶段 | 模型 | 目的 |
|------|------|------|
| Research | Sonnet | 阅读代码库 + RFC，产出上下文文档 |
| Plan | Opus | 设计实现步骤 |
| Implement | Codex | 按计划编写代码 |
| Test | Sonnet | 运行构建 + 测试套件 |
| PRD Review | Sonnet | 规格符合性检查 |
| Code Review | Opus | 质量 + 安全检查 |
| Review Fix | Codex | 处理审查问题 |
| Final Review | Opus | 质量门控（仅 large 层级） |

**关键设计：** 审查者永远不是代码的编写者。这消除了作者偏见——自我审查中最常见的问题来源。

**带驱逐的合并队列：**

```
单元分支
    │
    ├─ Rebase 到 main
    │   └─ 冲突？→ 驱逐（捕获冲突上下文）
    │
    ├─ 运行构建 + 测试
    │   └─ 失败？→ 驱逐（捕获测试输出）
    │
    └─ 通过 → Fast-forward main，推送，删除分支
```

- 非重叠单元推测性并行落地
- 重叠单元逐个落地，每次重新 rebase

**被驱逐时**，完整上下文（冲突文件、diff、测试输出）被捕获并在下次 Ralph 通道反馈给实现者。

**阶段间数据流：**
```
research.contextFilePath ──────────────────→ plan
plan.implementationSteps ──────────────────→ implement
implement.{filesCreated, whatWasDone} ─────→ test, reviews
test.failingSummary ───────────────────────→ reviews, implement（下次）
reviews.{feedback, issues} ────────────────→ review-fix → implement（下次）
evictionContext ───────────────────────────→ implement（合并冲突后）
```

**Worktree 隔离：** 每个单元在独立 worktree 中运行（`/tmp/workflow-wt-{unit-id}/`）。同一单元的管道阶段**共享** worktree，跨 research → plan → implement → test → review 保留状态。

**关键设计原则：**
1. **确定性执行** — 预先分解锁定并行性和顺序
2. **在杠杆点进行人工审查** — 工作计划是最高杠杆干预点
3. **关注点分离** — 每个阶段独立上下文窗口
4. **带上下文的冲突恢复** — 完整驱逐上下文支持智能重跑，而非盲目重试
5. **层级驱动深度** — 简单变更跳过研究/审查；大型变更获得最大审查
6. **可恢复工作流** — 完整状态持久化到 SQLite；可从任意点恢复

**何时用 Ralphinho vs 更简单的模式：**

| 信号 | 用 Ralphinho | 用更简单模式 |
|------|-------------|------------|
| 多个相互依赖的工作单元 | 是 | 否 |
| 需要并行实现 | 是 | 否 |
| 合并冲突可能性高 | 是 | 否（顺序即可） |
| 单文件变更 | 否 | 是（顺序管道） |
| 多天项目 | 是 | 也许（continuous-claude） |
| 规格/RFC 已写好 | 是 | 也许 |
| 快速迭代单个事项 | 否 | 是（持久 REPL 或管道） |

---

## 选择模式的决策树

```
任务是单个聚焦变更？
├─ 是 → 顺序管道 或 持久会话 REPL
└─ 否 → 有书面规格/RFC？
         ├─ 是 → 需要并行实现？
         │        ├─ 是 → Ralphinho（DAG 编排）
         │        └─ 否 → Continuous Claude（迭代 PR 循环）
         └─ 否 → 需要同一事物的多个变体？
                  ├─ 是 → 无限智能体循环（规格驱动生成）
                  └─ 否 → 顺序管道 + De-Sloppify
```

## 模式组合

这些模式可以良好组合：

1. **顺序管道 + De-Sloppify** — 最常见的组合。每个实现步骤都有清理通道。
2. **Continuous Claude + De-Sloppify** — 在 `--review-prompt` 中加入 de-sloppify 指令。
3. **任何循环 + 验证** — 在提交前用 `/verify` 技能作为门控。
4. **在简单循环中用 Ralphinho 的分级方法** — 简单任务路由到 Haiku，复杂任务路由到 Opus。

## 反模式

1. **没有退出条件的无限循环** — 始终设置 max-runs、max-cost、max-duration 或 completion signal。
2. **迭代间无上下文桥接** — 每次 `claude -p` 调用重新开始。用 `SHARED_TASK_NOTES.md` 或文件系统状态桥接上下文。
3. **用相同根因重试失败** — 如果迭代失败，不要只是重试。捕获错误上下文并反馈到下次尝试。
4. **负面指令代替清理通道** — 不要说"不要做 X"。加单独的通道来移除 X。
5. **所有智能体在一个上下文窗口** — 对复杂工作流，将关注点分到不同智能体进程。审查者不应是作者。
6. **并行工作中忽略文件重叠** — 如果两个并行智能体可能编辑同一文件，需要合并策略（顺序落地、rebase 或冲突解决）。

## 参考

| 项目 | 作者 | 备注 |
|------|------|------|
| Ralphinho | enitrat | credit: @enitrat |
| Infinite Agentic Loop | disler | credit: @disler |
| Continuous Claude | AnandChowdhary | credit: @AnandChowdhary |
