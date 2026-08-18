---
name: goal
description: 目标锚定（goal-keeper）：开工前把模糊意图固化成一个可验证、可量化的目标——写清成功证据、范围边界与停止条件，宣称完成前按验证标准核对。多步/目标型任务的起点，说「目标是/我想要/实现/修复/设个目标」或 /goal 时用。
description_zh: 目标锚定 — 长期任务持续推进
when_to_use: |
  Use at the start of any goal-oriented or multi-step task to shape vague intent into a concrete, measurable objective an agent can pursue honestly — with explicit success evidence, scope bounds, and a stop condition. Triggers on "/goal", "$define-goal", "set/create a goal", "the goal is", "I want to", "implement", "fix", "build", or whenever the user describes an outcome with no way to verify it. For goal definition/refinement only — not durable snapshots, decision logs, or long-running execution artifacts.
other_metadata:
  source: ported & adapted from OpenAI Codex curated skill "define-goal" (the methodology behind Codex's /goal feature)
---

# Goal — 目标锚定 (define-goal)

> 移植自 OpenAI Codex 官方 curated 技能 `define-goal`（即 Codex `/goal` 长程自主特性的方法论内核）。Codex 里它用 `get_goal`/`create_goal` 把目标落库到 `~/.codex/goals_1.sqlite`；Claude Code 没有这两个工具，所以这里改成在会话中**显式声明该目标并全程锚定**。

## Overview

Shape the user's intent into an objective an agent can pursue honestly. Prefer measurable outcomes, explicit evidence, and bounded scope over activity descriptions.

This skill covers goal definition and refinement only. Do not create intermediate planning artifacts, durable snapshots, ledgers, decision logs, or resume files from this skill.

## Workflow

1. **Confirm goal definition is actually needed.**
   - Use when the user says `/goal` / `$define-goal`, asks to create or set a goal, or wants help turning an intention into a clear objective.
   - If the user only asks for ordinary implementation work, do the work directly instead of forcing goal creation.

2. **Restate the likely goal in concrete terms.** A usable goal names:
   - the specific outcome that will be true
   - the main artifact, system, repo, environment, or user-facing behavior involved
   - how completion will be verified
   - what is in scope
   - what is out of scope when ambiguity would matter
   - the stop condition for asking the user instead of grinding

3. **Make it quantitative when the domain supports it.** Prefer numbers that represent real success, not decorative precision:
   - pass/fail validators: exact tests, checks, CI jobs, evals, commands, or acceptance criteria
   - quality thresholds: latency, error rate, cost, accuracy, recall, precision, coverage, flake rate, bundle size, memory, uptime, completion rate
   - artifact constraints: file paths, affected modules, allowed commands, output formats, target environments, deadlines, maximum blast radius
   - evidence counts: reproduced failures, successful reruns, reviewed examples, migrated records, addressed comments, verified cases

4. **Repair weak goals before setting them.**
   - Rewrite vague goals into measurable objectives when local context makes the rewrite safe.
   - Ask ONE concise clarification question when the missing detail changes the intended outcome or validation.
   - Reject pure activity goals such as "make progress," "keep investigating," "improve things," or "work on X" unless sharpened into a verifiable outcome.

5. **Anchor the goal** *(Claude Code adaptation of Codex `get_goal`/`create_goal`)*:
   - State the single concise objective out loud, with its verification evidence and scope bounds, and keep it visible as you work.
   - If a goal is already active and still matches intent, keep using it — don't duplicate.
   - If a new request conflicts with the active goal, ask whether to finish the current one, mark it done, or start a separate goal-backed thread.

6. **Lock the goal only after it passes the Quality Bar** (below):
   - One concise objective string, with the verification evidence inside the objective.
   - Include scope bounds when they constrain the work; include a budget only if the user asked.
   - Don't force a goal onto an ordinary multi-step task unless the user explicitly asked for goal-backed work.

## Goal Quality Bar

Before locking, the objective should answer:
- What concrete thing will be true when this is done?
- What evidence will prove it?
- What quantitative or binary threshold defines success?
- What scope boundaries matter?
- What should cause the agent to stop and ask?

**Good:**
> Reduce checkout API p95 latency below 250 ms for the documented slow path by making the smallest safe server-side change, then verify with `npm run test:checkout` and the existing latency benchmark showing p95 under 250 ms across 3 consecutive runs.

**Good:**
> Resolve the open change-request comments on PR 123, update only the affected auth files and tests, and verify with the targeted auth test command plus `gh pr view 123` showing no unresolved change-request threads.

**Weak:** "Make checkout faster." · "Keep investigating the PR comments."

## Quantification Heuristics

- **Bugs:** reproduction first, fix second, a failing-then-passing validator when possible.
- **Tests:** name the exact command and required pass condition.
- **Performance:** name the metric, target threshold, measurement method, and number of runs.
- **Quality work:** define an observable acceptance bar (reviewed examples, lint/typecheck/test pass, user-approved artifact).
- **Research:** define the decision it must enable, the sources/systems in scope, the evidence standard.
- **Operations:** define healthy state, monitoring window, failure threshold, rollback/escalation trigger.

## Clarifying Questions

Ask only when a reasonable rewrite would risk pursuing the wrong outcome. Keep it short, oriented around the missing validator or scope boundary:
- "What metric should define success here: latency, cost, accuracy, or user-visible behavior?"
- "Which environment should I verify against: local, staging, or production?"
- "What is the minimum evidence you want before I mark this goal complete?"

If the user cannot provide a metric, propose the most honest binary validator available and ask for confirmation.

## Integration (Claude Code)

- **00-four-principles** — "Goal-Driven Execution" is Principle 4
- **a5-agent-coding** — run the autonomous loop toward the locked goal
- **test-driven-development** — the verifier is often a test
- **verification-before-completion** — enforces the final check before "done"
