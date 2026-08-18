---
name: 07-project-handoff
description: 项目交接协议：维护根目录 HANDOFF.md（按业务域分区、多窗口不冲突、只追加），任何 AI 接手都能零损耗续上。说「交接/记录进度/先到这里」时用。
description_zh: 项目交接 — 零损耗上下文恢复
when_to_use: Use when the user says /a8-project-handoff, /handoff, "交接", "更新交接文档", "更新HANDOFF", "记录进度", "先到这里", or when a significant milestone is reached and a handoff record is needed.
---

# Project Handoff — State Machine Protocol

---

## Purpose

AI amnesia across sessions is the #1 productivity killer. This skill defines a **protocol** for maintaining a single structured state file (`HANDOFF.md`) that serves as the authoritative project handoff document.

**Key properties**:
- **AI-agnostic**: Works across Gemini, Codex, Claude, or any LLM that reads it.
- **Multi-window safe**: State is partitioned by business domain; parallel AI sessions don't conflict
- **Human-reviewable**: Users manually delete completed items after review; AI only appends
- **On-Demand**: Only triggers when you explicitly invoke it.

---

## Activation Chain

This skill is manually invoked when a handoff is needed:

```
User finishes a stage of work
  → User invokes /a8-project-handoff
  → AI reads current project state and HANDOFF.md
  → AI updates the YAML state and changelog
  → AI presents the updated handoff state
```

---

## HANDOFF.md Specification

### Location

Workspace root, alongside `CLAUDE.md`.

### Format

YAML frontmatter (wrapped in `---`) for machine-readable state + Markdown body for changelog.

### YAML Schema

```yaml
---
project: string            # Project identifier
mission: string            # One-line ultimate goal (in Chinese)
server: string             # Production URL (if any)
stack: string              # Tech stack summary
updated: ISO8601           # Last update timestamp
updated_by: string         # Session/AI identifier that last updated

domains:                   # Business domains, isolated for multi-agent safety
  <domain_name>:
    status: active | stable | blocked | planned
    current: string | null   # Task currently in progress (null = idle)
    done:                    # Completed tasks — AI appends, user deletes after review
      - "Task description (YYYY-MM-DD)"
    next:                    # Backlog, ordered by priority
      - "Next task to do"
    blockers:                # What's preventing progress
      - "Blocker description"
    key_files:               # Core file paths for this domain
      - "path/to/dir/"

danger_zones:              # Global forbidden zones — all AIs must respect
  - "Description of constraint"
---
```

### Markdown Body

The body contains a **changelog limited to 10 entries**. When exceeding 10, move the oldest to `docs/archive/handoff-changelog.md`.

```markdown
# 📋 最近变更日志

## [YYYY-MM-DD] Change title → domain_name
- What changed
- Files affected
```

**Language rule**: All HANDOFF.md content (YAML values, changelog entries) MUST be written in **Chinese**, matching the user's working language. Only the YAML keys remain in English.

---

## AI Behavior Protocol

### 1. 🟢 Session Start

Read `HANDOFF.md` and output a status line in the first reply:

```
✅ HANDOFF 已读取 | products: active (当前: XXX) | ads: stable | hermes: blocked
```

If `HANDOFF.md` does not exist, **silently create** a skeleton by scanning the project structure (package.json, directory layout, CLAUDE.md, docs/).

### 2. 🔵 After Completing Code Changes

After any meaningful code change (not single-line typos), update `HANDOFF.md`:

- Move completed task from `next` to `done` with date suffix `(YYYY-MM-DD)`
- If `current` task is finished, set to `null` or promote next item from `next`
- Update `updated` timestamp and `updated_by` field
- Append a changelog entry to the Markdown body

**Critical rules**:
- **Only update the domain you worked on** — never touch other domains
- **Only append to `done`** — never delete items (user reviews and deletes manually)
- **Keep changelog entries concise** — 2-4 bullet points per entry
- **Write all content in Chinese**

### 3. 🟡 Before Session Ends

When the user signals session end ("先到这里", "今天到此为止", etc.), verify `HANDOFF.md` is up to date. If not, update it as a final action.

---

## Multi-Agent Concurrency

```
Window A (Gemini)  → works on products domain → updates products only
Window B (Codex)   → works on ads domain      → updates ads only
Window C (Claude)  → works on hermes domain   → updates hermes only
```

Each window reads the full file but only writes to its own domain block. If two windows happen to work on the same domain (rare), last-write-wins applies.

---

## Cold Start (HANDOFF.md Missing)

When an AI opens a project with no `HANDOFF.md`:

1. Scan `CLAUDE.md`, `docs/`, `package.json`, directory structure
2. Infer reasonable domain partitioning
3. Generate skeleton `HANDOFF.md` with `status: planned` for all domains
4. Tell the user: "已为本项目创建 HANDOFF.md 骨架，请审核 domain 划分是否合理。"

---

## Relationship to Existing Memory System

| File | Purpose | Relationship |
|---|---|---|
| `CLAUDE.md` | Iron rules, code style, deploy conventions | References HANDOFF.md |
| `HANDOFF.md` | **State machine**: who's doing what, what's done, what's next | This skill's core artifact |
| `docs/短期记忆.md` | Intra-session breakpoints | More granular than HANDOFF |
| `docs/长期记忆.md` | Multi-stage goals, module evolution | More strategic than HANDOFF |
| `docs/永久记忆.md` | Debugging lessons, deadlock root causes | Knowledge-level, complements HANDOFF |

**HANDOFF.md replaces**: verbose handoff documents and scattered TODO lists. It does NOT replace the memory layer files.



---

## Iron Rules

1. **HANDOFF.md is a state machine, not a narrative log** — YAML stores structured facts only. No prose.
2. **AI appends to `done`, never deletes** — User reviews and cleans up manually.
3. **Only update your own domain** — Foundation of multi-window safety.
4. **Changelog capped at 10 entries** — Overflow archived to `docs/archive/handoff-changelog.md`.
5. **Missing file = create it** — Cold start auto-generates skeleton. Never error out.
6. **All HANDOFF.md content in Chinese** — YAML keys in English, values in Chinese.
