# Authority File Consolidation (权威文档合并)

When a project has **two or more near-identical authoritative docs** (e.g. `AGENTS.md` + `CLAUDE.md`) that have diverged through edits by multiple AI sessions, use this procedure to merge them into a single source of truth.

## When This Applies

- User says "清理文档", "重构文档", "合并 AGENTS.md 和 CLAUDE.md"
- Two large docs files share >50% identical content
- Other AIs have added sections to one file but not the other
- Content describes architecture that no longer matches the codebase

## Procedure

### Phase 1: Codebase Ground Truth Scan

**Always scan the actual codebase BEFORE trusting documentation.** Docs lie; code doesn't.

```
1. List all files in key directories (routes/, services/, lib/, scripts/)
2. Grep for deprecated patterns (e.g. "playwright", "CDP", "9222", old tool names)
3. Grep for current patterns (e.g. "fetch", "axios", new module names)
4. Read import statements in key files to confirm actual dependencies
5. Count files per module to understand real scope
```

Build a **reality table**:

| Doc Claims | Actual Code | Action |
|---|---|---|
| Uses Playwright | Only 1 file imports it (token extraction) | Mark as "residual" |
| CDP everywhere | Only wxwTokenManager uses CDP | Scope down |
| Missing module X | X exists in codebase | Add to docs |

### Phase 2: Diff the Documents

For each file, identify:
1. **Shared blocks** — identical content in both files (dedup target)
2. **Unique to File A** — content only in the "older" file
3. **Unique to File B** — content only in the "newer" file (often added by other AIs)
4. **Stale content** — describes architecture that codebase scan proved outdated
5. **Missing content** — modules/features in codebase but not in any doc

### Phase 3: Consolidate

**Pattern: One Authority + Thin References**

- Choose the **more complete** file as the single authority (usually the one with more unique current content)
- Rewrite it: remove stale sections, add missing modules, reorganize by current architecture
- Convert the other file to a **thin reference layer** — only non-duplicate supplementary content, with a pointer to the authority file

```
# CLAUDE.md (thin)
> **主文档**: `AGENTS.md`（唯一的架构与规则权威源）
> 本文件仅包含补充约定，与 AGENTS.md 不重复。
```

### Phase 4: Validation

After writing:
- Verify no stale patterns remain (grep for deprecated terms)
- Verify all current modules are covered
- Verify the thin reference doesn't duplicate the authority

## Pitfalls

| Pitfall | Fix |
|---------|-----|
| Trusting docs over code | Always scan codebase first; docs are stale by default |
| Deleting content added by other AIs | Diff carefully; other AIs' additions may be valid current work |
| Keeping outdated sections "just in case" | If code proves it's gone, remove it; git history preserves it |
| Two files both claiming authority | Pick one, make the other a reference; never maintain two authorities |
| Not noting residual usage | If a deprecated tool has ONE remaining use case, note it explicitly rather than claiming full removal |
| Patch creating duplicates | When using `patch` to replace a section, the old text may partially match the replacement, creating a duplicate block. Always `grep` for the section header after patching — if count > 1, delete the orphan |
| Injecting new directives without version bump | Always update the version/date marker in the file header so future sessions know it changed |

### Phase 5: Validation Metrics

After consolidation, report before/after metrics:

```
AGENTS.md: 297 lines (20KB) → 352 lines (14.7KB) — stale content removed, current modules added
CLAUDE.md: 469 lines (36KB) → 38 lines (1.3KB) — thin reference layer
```

Net reduction in total bytes proves the cleanup removed more than it added. If total bytes increase significantly, you may have added bloat.

### Phase 6: New Directive Injection

Sometimes during restructuring, the user wants to inject a **new architectural principle** (e.g. "all features serve the AI agent first"). This is a valid addition, not just cleanup:

- Add new directives as **P0 iron rules** near the top of the authority file
- Use `> [!CAUTION]` blocks for maximum visibility
- Keep directives concise and actionable (bullet points, not essays)
- Update the file version marker to reflect the change
