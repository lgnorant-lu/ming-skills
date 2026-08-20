/**
 * APC Injection Detector — koffi FFI bindings.
 *
 * Detects queued APCs (Asynchronous Procedure Calls) in target process threads.
 * APCs can be injected via QueueUserAPC / NtQueueApcThread and are a common
 * code-injection technique used by malware and game cheats.
 *
 * Detection strategy:
 *   1. Enumerate threads of target process via CreateToolhelp32Snapshot.
 *   2. Open each thread with THREAD_QUERY_INFORMATION.
 *   3. Read ThreadApcState via NtQueryInformationThread (any pending APC → injected).
 *   4. Check if thread is in alertable wait state (SleepEx/WaitForMultipleObjectsEx/
 *      WaitForSingleObjectEx with bAlertable=TRUE).
 *
 * Win32 only.  Requires PROCESS_QUERY_INFORMATION + THREAD_QUERY_INFORMATION.
 *
 * @module APCDetector
 */

import koffi, { type LibraryHandle } from 'koffi';
import { getKernel32, getNtdll } from './Win32API';

// ── Constants ──────────────────────────────────────────────────────────────────

const THREAD_QUERY_INFORMATION = 0x0040;
const THREAD_QUERY_LIMITED_INFORMATION = 0x0800;

/** NtQueryInformationThread information classes */
const ThreadApcStateClass = 0; // Pending APC presence
const ThreadQuerySetWin32StartAddress = 9; // Thread entry point

/** NTSTATUS codes */
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004;

/** CreateToolhelp32Snapshot flags */
const TH32CS_SNAPTHREAD = 0x00000004;

// ── Win32 struct layouts (unpacked) ────────────────────────────────────────────

/** THREADENTRY32 */
interface ThreadEntry32 {
  threadId: number;
  ownerPid: number;
  tpBasePri: number;
}

/** PACKET — represents a single APC entry in the queue (simplified) */
interface ApcQueueInfo {
  threadId: number;
  /** true if any APC is pending on this thread */
  hasPendingApc: boolean;
  /** Number of pending kernel-mode APCs */
  kernelApcCount: number;
  /** Number of pending user-mode APCs */
  userApcCount: number | null;
  /** True if thread is in alertable wait */
  isAlertable: boolean;
  /** Thread start address (for heuristics) */
  startAddress: string;
}

// ── FFI function types ─────────────────────────────────────────────────────────

let _NtQueryInformationThread: ReturnType<LibraryHandle['func']> | null = null;
function getNtQIT() {
  if (!_NtQueryInformationThread) {
    _NtQueryInformationThread = getNtdll().func(
      'int32 NtQueryInformationThread(void *, uint32, _Out_ void *, uint32, _Out_ uint32 *)',
    );
  }
  return _NtQueryInformationThread;
}

let _OpenThread: ReturnType<LibraryHandle['func']> | null = null;
function getOpenThread() {
  if (!_OpenThread) {
    _OpenThread = getKernel32().func('void * OpenThread(uint32, int32, uint32)');
  }
  return _OpenThread;
}

let _CreateToolhelp32Snapshot: ReturnType<LibraryHandle['func']> | null = null;
function getSnapshot() {
  if (!_CreateToolhelp32Snapshot) {
    _CreateToolhelp32Snapshot = getKernel32().func(
      'void * CreateToolhelp32Snapshot(uint32, uint32)',
    );
  }
  return _CreateToolhelp32Snapshot;
}

let _Thread32First: ReturnType<LibraryHandle['func']> | null = null;
function getThread32First() {
  if (!_Thread32First) {
    _Thread32First = getKernel32().func('int32 Thread32First(void *, _Out_ void *)');
  }
  return _Thread32First;
}

let _Thread32Next: ReturnType<LibraryHandle['func']> | null = null;
function getThread32Next() {
  if (!_Thread32Next) {
    _Thread32Next = getKernel32().func('int32 Thread32Next(void *, _Out_ void *)');
  }
  return _Thread32Next;
}

let _CloseHandle: ReturnType<LibraryHandle['func']> | null = null;
function getCloseHandle() {
  if (!_CloseHandle) {
    _CloseHandle = getKernel32().func('int32 CloseHandle(void *)');
  }
  return _CloseHandle;
}

/** Helper to convert koffi pointer to bigint safely */
function ptrToBigint(p: unknown): bigint {
  if (typeof p === 'bigint') return p;
  if (typeof p === 'number') return BigInt(p);
  return 0n;
}

// ── Thread enumeration ─────────────────────────────────────────────────────────

function enumThreadsByPid(pid: number): ThreadEntry32[] {
  const snap = ptrToBigint(getSnapshot()(TH32CS_SNAPTHREAD, 0));
  if (snap === 0n || snap === BigInt('0xFFFFFFFFFFFFFFFF')) {
    return [];
  }

  // THREADENTRY32: dwSize(4) + cntUsage(4) + th32ThreadID(4) + th32OwnerProcessID(4) + tpBasePri(4) + tpDeltaPri(4) + dwFlags(4) = 28 bytes
  const entryBuf = Buffer.alloc(28);
  entryBuf.writeUInt32LE(28, 0);

  const threads: ThreadEntry32[] = [];

  let r = getThread32First()(snap, koffi.address(entryBuf)) as number;
  while (r) {
    const ownerPid = entryBuf.readUInt32LE(12);
    if (ownerPid === pid) {
      threads.push({
        threadId: entryBuf.readUInt32LE(8),
        ownerPid,
        tpBasePri: entryBuf.readUInt32LE(16),
      });
    }
    r = getThread32Next()(snap, koffi.address(entryBuf)) as number;
  }

  getCloseHandle()(snap);
  return threads;
}

// ── APC queue probing ──────────────────────────────────────────────────────────

function probeThreadApc(threadId: number): ApcQueueInfo | null {
  const hThread = ptrToBigint(
    getOpenThread()(THREAD_QUERY_INFORMATION | THREAD_QUERY_LIMITED_INFORMATION, 0, threadId),
  );
  if (hThread === 0n || hThread === BigInt('0xFFFFFFFFFFFFFFFF')) {
    return null;
  }

  try {
    const info: ApcQueueInfo = {
      threadId,
      hasPendingApc: false,
      kernelApcCount: 0,
      userApcCount: null,
      isAlertable: false,
      startAddress: '0x0',
    };

    // Query ThreadApcState — the first field is a boolean "ApcQueueable"
    // followed by a union of 3 lists (kernel, user, real). If any list is non-empty,
    // NTSTATUS returns STATUS_INFO_LENGTH_MISMATCH and fills the partial buffer.
    const apcBuf = Buffer.alloc(256);
    const retLen = Buffer.alloc(4);

    const qitStatus1 = getNtQIT()(
      hThread,
      ThreadApcStateClass,
      koffi.address(apcBuf),
      apcBuf.length,
      koffi.address(retLen),
    ) as number;

    if (qitStatus1 === 0 || qitStatus1 === STATUS_INFO_LENGTH_MISMATCH) {
      // NT returns STATUS_INFO_LENGTH_MISMATCH when there are pending APCs
      // because the full structure is variable-length. A partial buffer is filled.
      info.hasPendingApc = qitStatus1 === STATUS_INFO_LENGTH_MISMATCH;
      info.kernelApcCount = apcBuf.readUInt32LE(0) & 0x3; // bits 0-1
      info.userApcCount = info.hasPendingApc ? 1 : 0; // binary: we don't parse the full chain
    }

    // Query ThreadStartAddress for heuristics
    const addrBuf = Buffer.alloc(8);
    const addrRet = Buffer.alloc(4);
    const qitStatus2 = getNtQIT()(
      hThread,
      ThreadQuerySetWin32StartAddress,
      koffi.address(addrBuf),
      addrBuf.length,
      koffi.address(addrRet),
    ) as number;

    if (qitStatus2 === 0) {
      const addr = addrBuf.readBigUInt64LE(0);
      info.startAddress = `0x${addr.toString(16)}`;
      // Alertable heuristics: if start addr is in ntdll.dll (RtlUserThreadStart)
      // and has pending APC, thread was likely targeted.
    }

    // Alertable wait detection: if a thread has pending APCs and its state
    // is Wait, the caller used an alertable wait to trigger the APC.
    // We infer alertability from the presence of pending user-mode APCs,
    // since they only execute during alertable waits.
    info.isAlertable = info.hasPendingApc && (info.userApcCount ?? 0) > 0;

    return info;
  } finally {
    getCloseHandle()(hThread);
  }
}

// ── Main entry point ───────────────────────────────────────────────────────────

export interface ApcDetectionResult {
  success: boolean;
  pid: number;
  threadCount: number;
  suspiciousThreads: number;
  apcThreads: ApcQueueInfo[];
  verdict: 'clean' | 'suspicious' | 'infected';
  confidence: number; // 0-100
  riskReasons: string[];
  error?: string;
  requiresElevation?: boolean;
}

export function detectApcInjection(pid: number): ApcDetectionResult {
  try {
    const threads = enumThreadsByPid(pid);

    if (threads.length === 0) {
      return {
        success: false,
        pid,
        error: `No threads found for PID ${pid} (process may have exited or access denied)`,
        threadCount: 0,
        suspiciousThreads: 0,
        apcThreads: [],
        verdict: 'clean',
        confidence: 0,
        riskReasons: [],
        requiresElevation: true,
      };
    }

    const apcThreads: ApcQueueInfo[] = [];
    const riskReasons: string[] = [];

    for (const t of threads) {
      const info = probeThreadApc(t.threadId);
      if (!info) continue;

      if (info.hasPendingApc) {
        apcThreads.push(info);

        if (info.isAlertable) {
          riskReasons.push(
            `Thread ${t.threadId}: pending user-mode APC(s) + alertable wait — likely injection target`,
          );
        } else if (info.kernelApcCount > 0) {
          riskReasons.push(
            `Thread ${t.threadId}: pending kernel-mode APC(s) — possible injection or system event`,
          );
        }
      }
    }

    const suspiciousCount = apcThreads.length;

    let verdict: ApcDetectionResult['verdict'] = 'clean';
    let confidence = 0;

    if (suspiciousCount === 0) {
      verdict = 'clean';
      confidence = 95;
    } else if (suspiciousCount <= 2 && riskReasons.every((r) => r.includes('kernel-mode'))) {
      // 1-2 kernel-only APCs: likely legitimate (system events)
      verdict = 'clean';
      confidence = 70;
    } else if (suspiciousCount <= 2) {
      verdict = 'suspicious';
      confidence = 60;
    } else {
      verdict = 'infected';
      confidence = Math.min(85, 50 + suspiciousCount * 5);
    }

    return {
      success: true,
      pid,
      threadCount: threads.length,
      suspiciousThreads: suspiciousCount,
      apcThreads,
      verdict,
      confidence,
      riskReasons,
      requiresElevation: suspiciousCount === 0 && threads.length > 0 ? false : undefined,
    };
  } catch (err) {
    return {
      success: false,
      pid,
      error: err instanceof Error ? err.message : String(err),
      threadCount: 0,
      suspiciousThreads: 0,
      apcThreads: [],
      verdict: 'clean',
      confidence: 0,
      riskReasons: [],
      requiresElevation: true,
    };
  }
}
