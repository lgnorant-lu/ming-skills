---
name: repo-scan
description: "仓库扫描 — 跨栈(C/C++/Android/iOS/Web)遗留代码库源码审计:逐文件打标(自有/三方/构建产物)、识别内嵌第三方库、四级评级加 HTML 报告。接手大型遗留仓库、重构前扫依赖时用。"
description_en: Cross-stack source code asset audit — classifies every file, detects embedded third-party libraries, and delivers actionable four-level verdicts per module with interactive HTML reports.
description_zh: "仓库扫描 — 跨栈遗留代码审计:文件打标、内嵌库识别、HTML 报告"
origin: community
---

# repo-scan

> **前置条件 / 降级说明**：真正干活的分类逻辑、50+ 库检测规则与 HTML 报告生成器都在外部仓库 `haibindev/repo-scan` 中，本机默认未 clone。**必须先按下方 Installation 步骤 clone 对应仓库，才能产出四级评级与 HTML 报告**；否则本技能只提供方法论骨架（When to Use / How It Works 里的流程与判断维度），无法生成评级或报告产物。

> Every ecosystem has its own dependency manager, but no tool looks across C++, Android, iOS, and Web to tell you: how much code is actually yours, what's third-party, and what's dead weight.

## When to Use

- Taking over a large legacy codebase and need a structural overview
- Before major refactoring — identify what's core, what's duplicate, what's dead
- Auditing third-party dependencies embedded directly in source (not declared in package managers)
- Preparing architecture decision records for monorepo reorganization

## Installation

```bash
# Fetch only the pinned commit for reproducibility
mkdir -p ~/.claude/skills/repo-scan
git init repo-scan
cd repo-scan
git remote add origin https://github.com/haibindev/repo-scan.git
git fetch --depth 1 origin 2742664
git checkout --detach FETCH_HEAD
cp -r . ~/.claude/skills/repo-scan
```

> Review the source before installing any agent skill.

## Core Capabilities

| Capability | Description |
|---|---|
| **Cross-stack scanning** | C/C++, Java/Android, iOS (OC/Swift), Web (TS/JS/Vue) in one pass |
| **File classification** | Every file tagged as project code, third-party, or build artifact |
| **Library detection** | 50+ known libraries (FFmpeg, Boost, OpenSSL…) with version extraction |
| **Four-level verdicts** | Core Asset / Extract & Merge / Rebuild / Deprecate |
| **HTML reports** | Interactive dark-theme pages with drill-down navigation |
| **Monorepo support** | Hierarchical scanning with summary + sub-project reports |

## Analysis Depth Levels

| Level | Files Read | Use Case |
|---|---|---|
| `fast` | 1-2 per module | Quick inventory of huge directories |
| `standard` | 2-5 per module | Default audit with full dependency + architecture checks |
| `deep` | 5-10 per module | Adds thread safety, memory management, API consistency |
| `full` | All files | Pre-merge comprehensive review |

## How It Works

1. **Classify the repo surface**: enumerate files, then tag each as project code, embedded third-party code, or build artifact.
2. **Detect embedded libraries**: inspect directory names, headers, license files, and version markers to identify bundled dependencies and likely versions.
3. **Score each module**: group files by module or subsystem, then assign one of the four verdicts based on ownership, duplication, and maintenance cost.
4. **Highlight structural risks**: call out dead-weight artifacts, duplicated wrappers, outdated vendored code, and modules that should be extracted, rebuilt, or deprecated.
5. **Produce the report**: return a concise summary plus the interactive HTML output with per-module drill-down so the audit can be reviewed asynchronously.

## Examples

On a 50,000-file C++ monorepo:
- Found FFmpeg 2.x (2015 vintage) still in production
- Discovered the same SDK wrapper duplicated 3 times
- Identified 636 MB of committed Debug/ipch/obj build artifacts
- Classified: 3 MB project code vs 596 MB third-party

## Best Practices

- Start with `standard` depth for first-time audits
- Use `fast` for monorepos with 100+ modules to get a quick inventory
- Run `deep` incrementally on modules flagged for refactoring
- Review the cross-module analysis for duplicate detection across sub-projects

## Links

- [GitHub Repository](https://github.com/haibindev/repo-scan)
