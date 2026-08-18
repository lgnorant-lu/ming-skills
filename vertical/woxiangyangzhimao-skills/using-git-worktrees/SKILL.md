---
name: using-git-worktrees
description: Git worktree：开隔离工作区并行开发不同分支互不干扰。要并行多分支时用。
description_zh: Git工作区 — 隔离worktree
---

# Using Git Worktrees

Create an isolated workspace sharing the same repository for parallel branch development.

> Announce at start: *"Using the using-git-worktrees skill to set up an isolated workspace."*

---

## Step 1 — Resolve Worktree Directory

Follow this priority chain — stop at the first match:

| Priority | Check | Command |
|----------|-------|---------|
| 1 | Existing `.worktrees/` or `worktrees/` | `ls -d .worktrees worktrees 2>/dev/null` (`.worktrees` wins if both exist) |
| 2 | Preference in `CLAUDE.md` | `grep -i "worktree.*director" CLAUDE.md 2>/dev/null` |
| 3 | Ask user | Offer: (a) `.worktrees/` project-local hidden · (b) `~/.config/superpowers/worktrees/<project>/` global |

## Step 2 — Safety Gate (project-local dirs only)

**MUST verify the directory is git-ignored BEFORE creating any worktree:**

```bash
git check-ignore -q .worktrees 2>/dev/null   # or worktrees
```

If **NOT** ignored → add to `.gitignore`, commit, then proceed.
Global directories (`~/.config/...`) skip this step.

> **Why:** Prevents worktree contents from polluting `git status` and accidentally being committed.

## Step 3 — Create Worktree

```bash
project=$(basename "$(git rev-parse --show-toplevel)")

# Project-local
git worktree add ".worktrees/$BRANCH_NAME" -b "$BRANCH_NAME"

# OR global
git worktree add "$HOME/.config/superpowers/worktrees/$project/$BRANCH_NAME" -b "$BRANCH_NAME"

cd "<worktree-path>"
```

## Step 4 — Auto-Detect & Install Dependencies

```bash
[ -f package.json ]      && npm install
[ -f Cargo.toml ]        && cargo build
[ -f requirements.txt ]  && pip install -r requirements.txt
[ -f pyproject.toml ]    && poetry install
[ -f go.mod ]            && go mod download
```

No manifest file found → skip silently.

## Step 5 — Verify Clean Baseline

```bash
# Adapt to project: npm test | cargo test | pytest | go test ./...
<test-command>
```

| Result | Action |
|--------|--------|
| ✅ All pass | Report ready (see output format below) |
| ❌ Failures | Report failures + ask user whether to proceed or investigate |

### Output Format

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

---

## Decision Table

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it — verify ignored |
| `worktrees/` exists | Use it — verify ignored |
| Both exist | `.worktrees/` wins |
| Neither exists | Check `CLAUDE.md` → ask user |
| Dir not ignored | Add to `.gitignore` + commit |
| Tests fail on baseline | Report + ask before proceeding |
| No manifest file | Skip dependency install |

## Invariants (NEVER violate)

- **No unignored project-local worktrees.** Always `git check-ignore` first.
- **No assumed locations.** Follow priority: existing → `CLAUDE.md` → ask.
- **No skipped baselines.** Tests must run; failures must be reported.
- **Auto-detect toolchain.** Never hardcode setup commands.

## Integration Points

| Relationship | Skill | When |
|-------------|-------|------|
| **Called by** | `brainstorming` | After design approved, before implementation |
| **Called by** | `subagent-driven-development` | Before executing any tasks |
| **Called by** | `executing-plans` | Before executing any tasks |
| **Cleanup by** | `finishing-a-development-branch` | After work complete — removes worktree |
