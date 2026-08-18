---
name: systematic-debugging
description: "系统级调试（应用逻辑层）：逻辑 bug / 测试失败 / 行为异常 / 回归 / 构建报错 → 优先用我；环境故障 / 进程挂起 / 资源泄漏 → 升级到 /debug；investigate 侧重信息收集，本技能侧重根因定位与修复闭环。铁律：没有根因不许改代码。触发词：bug、测试失败、行为异常、报错、复现、根因、为什么不对、fix、reproduce。"
description_zh: 系统调试 — 深入排障分析
---

# Systematic Debugging

> **Iron Law:** NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
> Violating the letter of this process is violating the spirit of debugging.

---

## When to Invoke

Use for **any** technical issue: test failures, production bugs, unexpected behavior,
performance regressions, build errors, integration breakdowns.

**Especially when** you feel tempted to skip it — time pressure, "obvious" fix,
or multiple failed attempts are all signals that systematic debugging is mandatory.

---

## The Four Phases (strictly sequential)

### Phase 1 — Root Cause Investigation

**Complete ALL applicable steps BEFORE proposing any fix.**

| Step | Action | Key Discipline |
|------|--------|----------------|
| 1.1 | **Read error messages completely** — stack traces, line numbers, error codes | Do NOT skip or skim |
| 1.2 | **Reproduce consistently** — exact steps, deterministic trigger | If not reproducible → gather more data, never guess |
| 1.3 | **Check recent changes** — `git diff`, new deps, config, env differences | Narrow the blast radius |
| 1.4 | **Instrument component boundaries** (multi-layer systems) | Log entry/exit data at EACH boundary; run once to locate failing layer |
| 1.5 | **Trace data flow backward** — where does the bad value originate? | See `root-cause-tracing.md` for full technique |

**Step 1.4 — Instrumentation Pattern (multi-component systems):**

```bash
# For EACH component boundary, add:
echo "=== [Layer N] entry ===" && echo "VAR=${VAR:+SET}${VAR:-UNSET}"
# Run once → evidence reveals WHERE it breaks
# THEN investigate that specific component
```

---

### Phase 2 — Pattern Analysis

| Step | Action |
|------|--------|
| 2.1 | **Find working examples** — similar working code in the same codebase |
| 2.2 | **Read reference implementations COMPLETELY** — no skimming |
| 2.3 | **List every difference** between working and broken — no "that can't matter" |
| 2.4 | **Map dependencies** — settings, config, environment, implicit assumptions |

---

### Phase 3 — Hypothesis & Testing

| Step | Action | Gate |
|------|--------|------|
| 3.1 | **State hypothesis explicitly**: *"X is root cause because Y"* | Must be specific, not vague |
| 3.2 | **Make the SMALLEST possible change** to test it | One variable at a time |
| 3.3 | **Evaluate result** | ✅ Confirmed → Phase 4 · ❌ Rejected → new hypothesis, do NOT stack fixes |

**If you don't understand something:** Say so. Do not pretend. Research or ask for help.

---

### Phase 4 — Implementation

| Step | Action | Gate |
|------|--------|------|
| 4.1 | **Create failing test** — simplest reproduction; use `test-driven-development` skill | MUST exist before fixing |
| 4.2 | **Implement single fix** — address root cause only; no "while I'm here" changes | ONE change at a time |
| 4.3 | **Verify** — failing test now passes? No regressions? Use `verification-before-completion` | Green required |
| 4.4 | **If fix fails** — count attempts (see escalation rule below) | |

#### Escalation Rule: 3-Strike Architecture Check

| Attempt Count | Action |
|---------------|--------|
| < 3 | Return to Phase 1 with new information |
| **≥ 3** | **STOP. Question the architecture.** |

**3+ failures signal architectural rot, not missing fixes.** Indicators:
- Each fix reveals new coupling / shared-state issues in different locations
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

→ **Discuss with user before any further attempts.** This is NOT a failed hypothesis — this is a wrong architecture.

---

## Anti-Pattern Detector

**If you catch yourself thinking any of these → STOP → return to Phase 1:**

| Anti-Pattern Thought | Why It's Wrong |
|---------------------|----------------|
| "Quick fix now, investigate later" | First fix sets the pattern — do it right |
| "Just try changing X and see" | Guess-and-check is the #1 time waster |
| "Add multiple changes then test" | Can't isolate what worked; creates new bugs |
| "Skip the test, verify manually" | Untested fixes don't stick |
| "It's probably X, let me fix it" | Seeing symptoms ≠ understanding root cause |
| "Reference too long, I'll adapt" | Partial understanding guarantees bugs |
| "One more fix attempt" (after 2+) | 3+ failures = architectural problem |
| Proposing solutions before tracing data flow | Phase 1 not complete |

---

## User Signal Detection

When user says these things, it means **your process is breaking down**:

| User Signal | Translation |
|-------------|-------------|
| "Is that not happening?" | You assumed without verifying |
| "Will it show us…?" | You should have added instrumentation |
| "Stop guessing" | Proposing fixes without root cause |
| "Ultrathink this" | Question fundamentals, not symptoms |
| Frustrated "We're stuck?" | Your approach isn't working |

→ **STOP. Return to Phase 1.**

---

## Edge Case: No Root Cause Found

If systematic investigation genuinely rules out code bugs (environmental, timing,
external dependency):

1. Document what was investigated and ruled out
2. Implement defensive handling (retry, timeout, error message)
3. Add monitoring / logging for future investigation

> **But:** 95% of "no root cause" conclusions are incomplete investigations.

---

## Supporting Techniques

| File | Purpose |
|------|---------|
| `root-cause-tracing.md` | Backward call-stack tracing to find original trigger |
| `defense-in-depth.md` | Multi-layer validation after root cause is found |
| `condition-based-waiting.md` | Replace arbitrary timeouts with condition polling |

**Related skills:**
- `test-driven-development` — Phase 4.1 failing test creation
- `verification-before-completion` — Phase 4.3 fix verification
