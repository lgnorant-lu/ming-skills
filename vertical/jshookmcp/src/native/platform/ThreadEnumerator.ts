/**
 * ThreadEnumerator — cross-platform thread (TID) enumeration.
 *
 * Win32 uses `EnumerateProcessThreads` (koffi, Toolhelp32Snapshot) directly in
 * the process handler. This module provides the Linux/macOS fallback paths so
 * `process_enum_threads` works on all platforms (E5-B-style cross-platform
 * parity — see `.ccg/tasks/military-grade-audit/handoff.md`).
 *
 * - Linux:  reads `/proc/{pid}/task` — the canonical kernel thread list.
 * - macOS:  shells out to `ps -M -p {pid}` and parses the hex thread IDs from
 *           the indented per-thread lines.
 *
 * Both paths are fail-loud: a missing/unreadable process raises a clear error
 * naming the cause and the privilege fix (root / CAP_SYS_PTRACE on Linux).
 */

import { readdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function safePid(pid: number): number {
  const n = Math.trunc(Number(pid));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid PID: ${pid}`);
  return n;
}

/**
 * Enumerate thread IDs for a Linux process via `/proc/{pid}/task`.
 *
 * Each numeric subdirectory of `/proc/{pid}/task` is a kernel TID. Returns the
 * TIDs sorted ascending. Throws a contextual error if the directory cannot be
 * read (process gone, or lacking privilege — needs root or CAP_SYS_PTRACE).
 */
export function enumerateThreadsLinux(pid: number): number[] {
  const p = safePid(pid);
  const taskDir = `/proc/${p}/task`;
  let entries: readonly string[];
  try {
    entries = readdirSync(taskDir) as readonly string[];
  } catch (error) {
    throw new Error(
      `Cannot read ${taskDir}: ${error instanceof Error ? error.message : String(error)}` +
        ' (process may not exist, or lacks permission — run as root / CAP_SYS_PTRACE)',
      { cause: error },
    );
  }
  return entries
    .filter((entry) => /^\d+$/.test(entry))
    .map((entry) => parseInt(entry, 10))
    .toSorted((a, b) => a - b);
}

/**
 * Enumerate thread IDs for a macOS process via `ps -M -p {pid}`.
 *
 * `ps -M` prints the main process row followed by one indented row per thread,
 * whose first field is a hex thread id (`0x...`). Returns the parsed TIDs
 * sorted ascending.
 */
export async function enumerateThreadsMacos(pid: number): Promise<number[]> {
  const p = safePid(pid);
  let stdout: string;
  try {
    const result = await execAsync(`ps -M -p ${p}`, { maxBuffer: 1024 * 1024 });
    stdout = result.stdout;
  } catch (error) {
    throw new Error(
      `ps -M -p ${p} failed: ${error instanceof Error ? error.message : String(error)}` +
        ' (process may not exist, or ps unavailable)',
      { cause: error },
    );
  }

  const tids: number[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Thread rows are the ones beginning with a hex TID (0x...). The process
    // row and header have decimal/non-hex first fields, so they won't match.
    const match = line.match(/^(0x[0-9a-fA-F]+)\b/);
    if (match?.[1]) {
      const tid = parseInt(match[1], 16);
      if (Number.isFinite(tid) && tid > 0) tids.push(tid);
    }
  }
  return tids.toSorted((a, b) => a - b);
}

/**
 * Platform dispatcher for thread enumeration. Win32 is handled by the caller
 * (which uses the synchronous koffi `EnumerateProcessThreads`); this function
 * covers `linux` and `darwin`.
 */
export async function enumerateThreadsByPlatform(platform: string, pid: number): Promise<number[]> {
  switch (platform) {
    case 'linux':
      return enumerateThreadsLinux(pid);
    case 'darwin':
      return enumerateThreadsMacos(pid);
    default:
      throw new Error(`Thread enumeration not supported on platform "${platform}"`);
  }
}
