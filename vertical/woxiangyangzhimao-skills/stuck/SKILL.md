---
name: stuck
description: 死锁急救：会话/dev server/子进程卡死挂起时的紧急脱困与恢复。卡住不动时用 /stuck。
description_zh: 死锁急救 — 卡死脱困恢复
---

# /stuck — Diagnose Frozen / Hung Processes

Investigate when a session, dev server, or child process appears frozen, stuck, or
abnormally slow. **This is diagnostic-only — NEVER kill or signal any process.**

---

## Triage Table

| Symptom | Likely Cause | Priority Check |
|---------|-------------|----------------|
| CPU ≥ 90% sustained (≥ 2 samples, 2s apart) | Infinite loop / runaway computation | Confirm with double-sample |
| Process state `D` (Linux) | Uninterruptible I/O hang | Check blocked syscall |
| Process state `T` | Accidental `Ctrl+Z` / stopped | Resume with `fg` or `kill -CONT` |
| Process state `Z` (zombie) | Parent not reaping child | Inspect parent process |
| RSS ≥ 4 GB | Memory leak / OOM pressure | Check growth rate over time |
| Hung child process | Blocked `git`, `node`, or shell subprocess freezing parent | Inspect child tree |

---

## Investigation Pipeline

### Step 1 — List Suspect Processes

**Exclude current session PID.** Adapt command to OS:

````
# Linux / macOS
ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '<target-process>' | grep -v grep

# Windows (PowerShell)
Get-Process | Where-Object { $_.ProcessName -match '<target-process>' } |
  Select-Object Id, CPU, WorkingSet64, StartTime, Responding, ProcessName |
  Format-Table -AutoSize
````

### Step 2 — Deep Inspection (for each suspect)

| Check | Linux / macOS | Windows (PowerShell) |
|-------|--------------|----------------------|
| Child processes | `pgrep -lP <pid>` | `Get-CimInstance Win32_Process \| Where ParentProcessId -eq <pid>` |
| CPU sustained? | Sample twice, 2s apart | `Get-Process -Id <pid> \| Select CPU` × 2 |
| Hung child cmdline | `ps -p <child_pid> -o command=` | `(Get-CimInstance Win32_Process -Filter "ProcessId=<pid>").CommandLine` |
| Debug logs | `~/.claude/debug/<session-id>.txt` (tail last 200 lines) | Same path under `%USERPROFILE%` |

### Step 3 — Stack Dump (optional, advanced)

Only if process is clearly hung and root cause is unknown:

| OS | Command |
|----|---------|
| macOS | `sample <pid> 3` (3-second native stack sample) |
| Linux | `strace -p <pid> -c -t` or `gdb -batch -ex bt -p <pid>` |
| Windows | `procdump -ma <pid>` or Task Manager → Create dump file |

> ⚠ Stack dumps can be large. Capture only when the process is confirmed hung.

---

## Report Format

### If nothing stuck found:

Tell the user directly: *"All inspected processes appear healthy — no stuck sessions detected."*

**Do NOT post an all-clear to any channel.**

### If stuck process confirmed:

Produce a structured diagnostic report:

```
## Stuck Process Report

**Host:** <hostname>  |  **OS:** <os>  |  **Time:** <timestamp>

### Summary
<one-line symptom, e.g. "PID 12345 pegged at 100% CPU for 10 min">

### Diagnostic Detail
| Field | Value |
|-------|-------|
| PID | … |
| CPU % | … |
| RSS (MB) | … |
| State | … |
| Uptime | … |
| Command | … |
| Children | … |

### Probable Cause
<your diagnosis>

### Evidence
<debug log tail, sample output, or relevant stack trace>
```

**If Slack MCP is available:** Post summary as top-level message, full report as threaded reply.
**If not:** Format for user to copy-paste.

---

## Invariants

- **NEVER kill, signal, or terminate** any process — diagnostic only.
- **Double-sample CPU** before declaring "sustained high" — single readings can be transient.
- **If user provides a specific PID or symptom**, focus there first before broad scanning.
- **Adapt all commands to the detected OS** — do not blindly run Linux commands on Windows.