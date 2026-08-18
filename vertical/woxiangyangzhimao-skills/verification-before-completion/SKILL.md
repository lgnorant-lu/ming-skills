---
name: verification-before-completion
description: 完工前验证：宣称完成或提交前必须跑出真实测试证据（铁律·无证据不许说完成）。
description_zh: 完成前验证 — 强制运行测试
---

# Verification Before Completion

> **Iron Law:** NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
> Claiming work is complete without evidence is dishonesty, not efficiency.

---

## The Gate Protocol

Execute this **5-step gate** BEFORE making ANY positive status claim — success,
completion, satisfaction, or readiness to proceed:

```
1. IDENTIFY → What command proves this claim?
2. RUN      → Execute the FULL command (fresh, this message, not cached)
3. READ     → Full output + exit code + failure count
4. VERIFY   → Does output actually confirm the claim?
               YES → state claim WITH evidence
               NO  → state actual status with evidence
5. CLAIM    → Only NOW may you make the statement
```

**Skip any step = lying, not verifying.**

---

## Evidence Requirements Matrix

| Claim | Required Evidence | NOT Sufficient |
|-------|-------------------|----------------|
| "Tests pass" | Test command output showing 0 failures | Previous run, "should pass", assumption |
| "Linter clean" | Linter output showing 0 errors | Partial check, extrapolation |
| "Build succeeds" | Build command exit code 0 | Linter passing, "logs look good" |
| "Bug fixed" | Original symptom test passes | Code changed → assumed fixed |
| "Regression test works" | Red-green cycle verified (fail → fix → pass) | Test passes once without red phase |
| "Agent completed" | VCS diff confirms changes exist | Agent self-reports "success" |
| "Requirements met" | Line-by-line plan checklist verified | "Tests pass" ≠ requirements covered |

---

## Verification Patterns

### Tests
```
✅  [run test command] → [output: 34/34 pass] → "All tests pass"
❌  "Should pass now" / "Looks correct"
```

### Regression (TDD Red-Green)
```
✅  Write test → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌  "I've written a regression test" (no red phase proof)
```

### Build
```
✅  [run build] → [exit 0] → "Build passes"
❌  "Linter passed" (linter ≠ compiler)
```

### Requirements
```
✅  Re-read plan → create checklist → verify each item → report gaps or completion
❌  "Tests pass, phase complete"
```

### Agent Delegation
```
✅  Agent reports success → check VCS diff → verify changes → report actual state
❌  Trust agent report at face value
```

---

## Anti-Pattern Detector

**If you catch ANY of these → STOP → run the Gate Protocol:**

| Anti-Pattern | Why It Fails |
|-------------|--------------|
| Using "should", "probably", "seems to" | Hedging language = no evidence |
| Expressing satisfaction before verification ("Great!", "Done!") | Emotion ≠ proof |
| About to commit / push / PR without fresh run | Shipping unverified code |
| Trusting agent success reports | Agents can hallucinate success |
| "I'm confident" / "Just this once" | Confidence ≠ evidence; no exceptions |
| "Linter passed" as build proof | Different tools verify different things |
| "Partial check is enough" | Partial proves nothing about the whole |
| Paraphrasing success to dodge the rule | Spirit over letter, always |

---

## Scope

**This gate applies to ALL of the following — no exceptions:**

- Any success / completion / satisfaction claim
- Any commit, push, PR creation, or task-completion declaration
- Any "moving to next task" transition
- Any delegation result acceptance
- Any positive statement about work state, in any phrasing

**Non-negotiable. Run the command. Read the output. THEN claim the result.**
