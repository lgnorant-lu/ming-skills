---
name: compressing-memory
description: 压缩归档 docs/ 记忆：去噪/去重/修乱码/重分层。docs 膨胀或乱码时用，说「压缩记忆/修复乱码」。
description_zh: 记忆压缩 — 去噪去重归档
when_to_use: Use when the user says /compressing-memory, "清理日志", "压缩记忆", "归档文档", "docs太大了", "整理记忆", "修复乱码", "encoding fix", or when docs/ files exceed 10KB with visible noise or contain NUL bytes (encoding corruption). This skill batch-compresses existing accumulated docs/ memory files (短期记忆.md, 长期记忆.md, 永久记忆.md, 日志.md, 问题.md). NOT for extracting new insights from the current session — that is /remember's job.
---

# 🗜️ Compressing Memory — Batch Docs Dehydration (记忆压缩归档)

Batch-scan a project's `docs/` directory, strip noise, deduplicate, and rewrite compressed high-density memory files. Ensures future AI sessions consume minimal tokens while retaining 100% of actionable context.

> [!CAUTION]
> **PROPOSE FIRST, REWRITE SECOND**: You are FORBIDDEN from modifying any docs/ file before presenting a compression report and receiving explicit user approval. Destructive compression without review = data loss.

**Relationship to `/remember`**: `/remember` extracts NEW insights from the current session and appends. This skill COMPRESSES existing accumulated docs — dedup, strip noise, re-sort tiers.

**Also covers: Authority File Consolidation** — when multiple near-identical authoritative docs (e.g. `AGENTS.md` + `CLAUDE.md`) have diverged through edits by multiple AIs, this skill provides the methodology to merge them into a single source of truth by scanning the actual codebase. Includes validation metrics (before/after line counts), new directive injection during restructuring, and post-patch duplicate detection. See `references/authority-consolidation.md`.

---

## Process (流程)

### Step 1: Scan & Inventory (扫描盘点)

Read all docs/ files + project root `CLAUDE.md`. For each file, record:

| Metric | How to Measure |
|--------|---------------|
| **File size** | Bytes / line count |
| **Encoding health** | Read raw bytes — count NUL (`0x00`) bytes per file. Any NUL > 0 = **encoding corruption** (typically UTF-16 content mixed into UTF-8 file) |
| **BOM marker** | Check first 2-3 bytes: `FF FE` = UTF-16 LE, `FE FF` = UTF-16 BE, `EF BB BF` = UTF-8 BOM. Target: no BOM (clean UTF-8) |
| **Duplication blocks** | Identical text blocks >3 lines appearing more than once |
| **Inline images** | Count of `![...](...)` and `<img` tags |
| **Raw log lines** | Lines matching timestamp patterns like `[HH:MM:SS]` or verbose console output |
| **Stale WIP** | Entries in 短期记忆.md older than 7 days |
| **Tier misplacement** | Content in the wrong file per classification rules below |

**Success criteria**: Inventory table output with per-file noise metrics (encoding column marked 🔴/🟢).

---

### Step 1.5: Smart Skip Gate (智能跳过判定)

After completing the scan, evaluate whether compression is actually needed. **Do NOT force cleanup every invocation.**

**Skip conditions** — if ALL of the following are true, skip directly to reporting "already clean":
- Zero encoding corruption (all files 🟢)
- Zero duplication blocks detected
- Zero inline images in memory files
- Zero raw log lines (no timestamp-pattern noise)
- Zero stale WIP (nothing older than 7 days in 短期记忆.md)
- Zero tier misplacements
- All files < 15KB (no individual file bloat)

If skip conditions met, output:
```
✅ docs/ 状态健康，无需压缩。
📊 快检: 6文件 | 编码🟢 | 重复×0 | 图片×0 | 噪音×0 | 过期WIP×0
⏭️ 跳过压缩流程。
```

**Then STOP** — do not proceed to Step 2. No report, no approval gate, no file writes.

> [!TIP]
> The point is: if it's already clean and readable for both humans and AI, don't touch it. Compression is medicine, not vitamins — only apply when symptoms exist.

---

### Step 2: Classify & Compress (分类压缩)

Apply these compression rules **in order**:

#### Rule 0: Encoding Repair — 乱码修复 (MUST RUN FIRST)

If any file from Step 1 has NUL bytes or encoding anomalies, **repair before all other rules**:

1. **Detect boundary**: Scan bytes sequentially, find the first `0x00` byte offset — everything before is valid UTF-8, everything after is corrupted (typically UTF-16LE interleaved with NUL bytes).
2. **Decode segments**:
   - `bytes[0..firstNul-1]` → decode as **UTF-8**
   - `bytes[firstNul..]` → decode as **UTF-16LE** (Little Endian)
3. **Concatenate & rewrite**: Merge both decoded strings, rewrite the entire file as **UTF-8 without BOM** (`new UTF8Encoding(false)`).
4. **Verify**: Re-read the written file and assert NUL count = 0.

**PowerShell reference implementation**:
```powershell
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$firstNul = -1
for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 0) { $firstNul = $i; break }
}
if ($firstNul -ge 0) {
    $utf8Part = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $firstNul)
    $start = $firstNul
    if (($bytes.Length - $start) % 2 -eq 1) { $start++ }  # align to 2-byte boundary
    $utf16Part = [System.Text.Encoding]::Unicode.GetString($bytes, $start, $bytes.Length - $start)
    $fixed = $utf8Part + $utf16Part
    $enc = New-Object System.Text.UTF8Encoding($false)  # no BOM
    [System.IO.File]::WriteAllText($filePath, $fixed, $enc)
}
```

**Root cause**: Windows tools (e.g., `Out-File`, `Set-Content` without `-Encoding utf8`) default to UTF-16LE. When an AI agent or script appends to an existing UTF-8 file using these commands, the appended portion becomes UTF-16LE while the original stays UTF-8, creating a "mixed encoding" chimera that displays as 乱码 + NUL red blocks in editors.

**Prevention**: Always use `[System.IO.File]::WriteAllText(path, content, [System.Text.Encoding]::UTF8)` or `Set-Content -Encoding utf8` when writing docs files.

#### Rule 1: Image Annihilation (图片肃清)
- **Delete** all `![...](...)` and `<img src...>` markup
- If the image described a critical error or UI state, replace with **one-line plain text**: `[截图描述: 货源信息输入框未填入链接导致页面被关闭]`
- Physical `.png/.jpg` files in docs/: flag for user decision (delete or archive)

#### Rule 2: Raw Log Distillation (原始日志蒸馏)
- **Delete** all verbose console output (timestamp lines, status emoji, module trigger banners)
- **Preserve only**: `问题描述 → 根本原因 → 最终方案` 的三元组
- Example compression:
  ```
  ❌ 256 lines of "[21:08:23] ➤ ✅ 已点击..." console output
  ✅ "wxw-fill-skus 阶段卡顿2分钟; 货源链接注入失败导致页面被关闭"
  ```

#### Rule 3: Deduplication (去重)
- Detect and merge identical/near-identical text blocks
- Keep the **more complete** version; delete the duplicate
- Flag merged entries in the report

#### Rule 4: Tier Re-Sort (分层重归类)

| Tier | File | What Belongs | What Doesn't |
|------|------|-------------|--------------|
| **CORE** | `CLAUDE.md` | 不可违背的全局约束、技术栈、红线规则 | 具体Bug记录、WIP状态 |
| **SHORT** | `短期记忆.md` | 最近7天的WIP、下一步TODO、中断断点 | 已完成的历史任务 |
| **LONG** | `长期记忆.md` | 已沉淀的大模块、Epic路线图、架构演进 | 排障细节、原始日志 |
| **PERM** | `永久记忆.md` | 深度排障教训、根因分析、防病红线 | 成功的操作日志、WIP |
| **ISSUES** | `问题.md` | 未解决的Bug、已知技术债、明确TODO | 已解决的问题（移至PERM）、原始日志 |

#### Rule 5: Tech Anchor Retention (技术锚点保留)
**Never compress away** these elements, even during aggressive dehydration:
- Core file paths (e.g., `lib/core/browser-manager.js`, `routes/ads.ts`)
- Technical decisions with causality (为什么引入X → 因为Y)
- Database schema changes (新增列、索引变更)
- API interface contracts (端点、鉴权方式、参数格式)

**Success criteria**: Compressed content draft generated per file with before/after line counts.

---

### Step 3: Present Compression Report (呈现压缩报告)

Output a structured report:

```markdown
🗜️ Memory Compression Report
================================

📊 Overview:
| File | Before | After | Reduction | Actions |
|------|--------|-------|-----------|---------|
| 永久记忆.md | 189 lines | ~95 lines | -50% | 去重×2, 日志蒸馏×3 |
| 长期记忆.md | 101 lines | ~55 lines | -45% | 去重×1 |
| 问题.md | 256 lines | ~30 lines | -88% | 日志删除, 图片肃清×3 |

🔍 Detailed Actions:
- [D1] 永久记忆.md: 删除 L1-45 与 L23-45 重复块 (保留首次出现版本)
- [D2] 问题.md: 256行原始控制台日志 → 3行问题摘要
- [I1] 问题.md: 3处 ![image](...) → 纯文本描述
- [M1] 问题.md: 已解决的问题迁移至 永久记忆.md
- [S1] 短期记忆.md: 清除7天前的过期WIP

📁 Physical Files:
- [ ] 删除 docs/image.png (55KB) — 已转为文本描述
- [ ] 删除 docs/image-1.png (85KB)
- [ ] 删除 docs/image-2.png (10KB)
```

End with:
> "请审阅压缩方案。回复 '全部批准' 或指定接受/拒绝的项目（如 '批准 D1, D2, I1。跳过 M1'）。"

**⏸️ GATE G1**: Wait for explicit user approval. Do NOT modify any file until approved.

---

### Step 4: Execute Compression (执行压缩)

Only after approval:

1. **Backup**: If any file >5KB, create `docs/archive/YYYY-MM-DD/` and copy originals before overwriting
2. **Rewrite** approved files with compressed content
3. **Auto-create** missing files/directories (never fail on missing path)
4. **Report**:

```markdown
✅ Compression Complete
========================
📝 Rewritten:
  ✅ 永久记忆.md: 189 → 93 lines (-51%)
  ✅ 问题.md: 256 → 28 lines (-89%)
🗄️ Archived:
  ✅ docs/archive/2026-04-22/永久记忆.md (original backup)
🗑️ Cleaned:
  ✅ 3 inline images → text descriptions
  ✅ 1 duplicate block removed
```

---

### Step 5: Write Operation Changelog (写入操作日志)

After compression is complete, create a changelog file in `docs/` so the **next AI session** can immediately understand what was reorganized.

**File path**: `docs/压缩日志/YYYY-MM-DD-压缩日志.md`

**Template**:
```markdown
# 📋 docs/ 压缩操作日志 — YYYY-MM-DD

> 本文件由 /compressing-memory 技能自动生成。
> 下一个 AI 在首次阅读 docs/ 时，应先读此文件了解最近一次文件变动。

## 操作摘要
- **执行时间**: YYYY-MM-DD HH:MM
- **触发原因**: (e.g., 用户手动调用 / 编码乱码修复 / docs膨胀)
- **总体效果**: X 文件压缩, Y 行删减 (-Z%)

## 文件变动明细
| 操作 | 源文件 | 目标/说明 | 行数变化 |
|------|--------|-----------|----------|
| 压缩 | 永久记忆.md | 去重×2, 日志蒸馏×3 | 189→93 (-51%) |
| 迁移 | 问题.md → 永久记忆.md | 已解决问题归档 | 移出15行 |
| 修复 | 短期记忆.md | UTF-16→UTF-8 乱码修复 | 内容不变 |
| 清除 | 问题.md | 删除3处内嵌截图 | -28行 |
| 备份 | → docs/archive/YYYY-MM-DD/ | 原始文件留档 | — |

## 当前 docs/ 结构快照
- `CLAUDE.md` — 核心约束 (X lines)
- `短期记忆.md` — 当前WIP (X lines)
- `长期记忆.md` — 架构演进 (X lines)
- `永久记忆.md` — 排障教训 (X lines)
- `问题.md` — 未解决问题 (X lines)
- `日志.md` — 操作日志 (X lines)
```

**Rules for this changelog**:
- One file per compression session (not cumulative)
- If the same day has multiple compressions, append a counter: `2026-04-22-压缩日志-2.md`
- Auto-create `docs/压缩日志/` directory if missing
- Written as UTF-8 without BOM
- This file itself is **exempt from future compression** — it's a historical record

---

## 🔥 Hard Rules (铁律)

1. **Propose First, Rewrite Second**: ALL compression actions must be presented and approved before ANY file modification.
2. **Backup Before Overwrite**: Always archive originals to `docs/archive/YYYY-MM-DD/` before destructive rewrites.
3. **Never Delete Tech Anchors**: File paths, schema changes, API contracts, and causal decisions survive all compression passes.
4. **Images Die, Descriptions Live**: Zero tolerance for `![](...)` in compressed output. If it described something critical, one-line text replaces it.
5. **Raw Logs → Three-Tuple Only**: `问题 → 根因 → 方案`. Everything else is noise.
6. **Dedup Keeps the Better Version**: When merging duplicates, retain the more complete/accurate version.
7. **Stale WIP Gets Purged**: 短期记忆.md entries older than 7 days are either promoted to 长期记忆.md or deleted.
8. **This Is Not /remember**: Do NOT extract new insights from the current conversation. Only compress existing files.
9. **UTF-8 Enforced**: All docs/ output files MUST be written as UTF-8 without BOM. Any NUL byte in any `.md` file = encoding corruption that MUST be repaired in Rule 0 before any other compression rule executes. Never use PowerShell's default `Out-File` or `>` redirect for docs files — they produce UTF-16LE.
10. **Smart Skip — Don't Over-Clean**: If the scan shows all metrics are clean, report healthy and STOP. Never compress for the sake of compressing. Clean docs that are already readable = wasted tokens + risk of data loss.
11. **Always Leave a Changelog**: Every compression session MUST produce a `docs/压缩日志/YYYY-MM-DD-压缩日志.md`. This is the first thing the next AI reads. No changelog = invisible surgery = context loss for future sessions.

---

## Common Mistakes (常见错误)

| Mistake | Fix |
|---------|-----|
| Aggressively compressing tech decisions into vague summaries | Keep the WHY: "用 $queryRaw 因为 Prisma Client 缓存穿透" |
| Leaving solved problems in 问题.md | Move to 永久记忆.md as gotcha/pitfall entries |
| Treating all logs equally | Distinguish: raw console output (delete) vs. root cause analysis (keep) |
| Compressing without backup | Always `docs/archive/` first |
| Merging files that should stay separate | Each tier file has a distinct purpose — compress within files, not across |
| Ignoring NUL bytes / 乱码 in scan results | Run Rule 0 (Encoding Repair) FIRST — decode the UTF-16LE tail, rewrite entire file as clean UTF-8 |
| Using PowerShell `Out-File` / `>` / `Set-Content` without `-Encoding utf8` | These default to UTF-16LE on Windows. Always use `[System.IO.File]::WriteAllText()` with explicit `UTF8Encoding(false)` |
| Forcing cleanup on already-clean docs | Check Smart Skip gate first — if all metrics green, report healthy and stop |
| Skipping the operation changelog | Always write `docs/压缩日志/YYYY-MM-DD-压缩日志.md` — it's the breadcrumb trail for the next AI session |
