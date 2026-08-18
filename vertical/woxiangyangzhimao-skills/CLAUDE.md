# Global Agent Directives

> [!CAUTION]
> ## 🔴 P0 Iron Rule #0: Session Bootstrap Gate (会话初始化门禁)
> **The VERY FIRST action of every new conversation MUST be `view_file` on the workspace root `CLAUDE.md`.**
> If CLAUDE.md does not exist, create it immediately. After reading, output this self-verification line in your first reply:
> ```
> ✅ CLAUDE.md 已读取 | 沙盒模式: [状态] | 上次会话 WIP: [有/无]
> ```
> **No code edits, searches, or commands are permitted before this step is completed.**

---

## 1. Project Memory (`CLAUDE.md`)
- **Mandatory Read**: First step of any coding task — read workspace root `CLAUDE.md`
- **Mandatory Update**: After completing major modules or fixing stubborn bugs, append key insights
- **Auto-Create**: If missing, create it silently — never error out

## 2. Four-Tier Memory System (`docs/` 四维记忆)
- `docs/短期记忆.md` — WIP breakpoints, session state snapshots
- `docs/长期记忆.md` — Multi-stage goals, module evolution roadmap
- `docs/永久记忆.md` — Deep troubleshooting analysis, deadlock root causes, refactor lessons
- Auto-create if missing — never error out

## 3. Session Startup Routine
1. Read `CLAUDE.md` (Iron Rule #0)
2. Scan `docs/短期记忆.md` for unfinished WIP from last session
3. Output self-verification line in first reply

## 4. Skills Ecosystem
- Proactively activate skill awareness, prefer loaded skills over manual analysis
- System-level MCP services located at `F:\GitHub`

## 5. P0 Full Pipeline Workflow (全链路工作流)

| Phase | Action | Skills |
|-------|--------|--------|
| Plan | Parallel decomposition for large refactors, brainstorm for daily tasks | `/batch` `/brainstorming` `/writing-plans` |
| Execute | TDD + red-green refactor, blind guessing strictly forbidden | `/test-driven-development` `/verify` `/debug` |
| Review | No subjective completion claims — must capture real stdout | `/verification-before-completion` `/simplify` |
| Persist | Consolidate memory after verification passes | `/remember` → CLAUDE.md + docs/ |

## 6. Core Protocols (核心协议)

- **Full pipeline**: Plan→TDD→Review→Persist — no phase may be skipped
- **Proactive action**: Never ask "how do you want me to do this?" — propose a plan first, then confirm
- **Anti-shirking**: On test/build failures, never blame "it was already broken" — must provide baseline evidence
- **Anti-hang**: Long-running tasks must actively poll and report progress — never go silent
- **Escape hatch**: 3 failed retries on same fault → generate troubleshooting report → suspend and escalate to user
- **Red-line protection**: Never modify ETHOS.md, never call unknown APIs, never use placeholder code snippets