/**
 * Call Stack Walker (Win32-only).
 *
 * Uses koffi to call kernel32 Toolhelp32 + ReadProcessMemory to walk the
 * x64 frame-pointer chain (RBP-based) of a target process thread.
 *
 * Architecture: x64 only. Reads RBP from thread CONTEXT, then follows the
 * linked list: [saved_RBP][return_address] through ReadProcessMemory.
 * Resolves module names via Toolhelp32 module snapshots.
 *
 * This is x64dbg's "standard" call stack mode — disciplined frame-pointer
 * walking. Suspected-frame scanning (heuristic RSP range scan) is NOT
 * implemented.
 */

import {
  requireKoffi,
  type KoffiLibraryHandle,
  type KoffiCallable,
  type Koffi,
} from './koffi-loader';
import { parseContext, CONTEXT_SIZE, CONTEXT_FLAGS, IS_ARM64_WINDOWS } from './Win32Debug';

export interface CallStackFrame {
  frameIndex: number;
  returnAddress: string;
  moduleName: string | null;
  functionName: string | null;
}

// ── Lazy-loaded koffi handles ──

let _kernel32: KoffiLibraryHandle | null = null;
function kernel32(): KoffiLibraryHandle {
  if (!_kernel32) _kernel32 = requireKoffi().load('kernel32.dll');
  return _kernel32;
}

// ── Constants ──

const TH32CS_SNAPTHREAD = 0x00000004;
const THREAD_QUERY_INFORMATION = 0x0040;
const THREAD_GET_CONTEXT = 0x0008;
const THREAD_SUSPEND_RESUME = 0x0002;
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const PROCESS_VM_OPERATION = 0x0008;
// CONTEXT_FULL is sourced from Win32Debug (arch-aware: AMD64 vs ARM64).
const MAX_FRAMES = 128;

// ── koffi struct type definitions ──
// NOTE: These types are passed as opaque pointers to FFI functions.
// Field access is via koffi-alloc'd object property syntax (dot notation),
// not koffi.read/koffi.write (those are not available in the koffi API).

type KoffiStructType = ReturnType<Koffi['struct']>;

let _THREADENTRY32: KoffiStructType | null = null;
function getThreadEntry32Type(): KoffiStructType {
  if (!_THREADENTRY32) {
    _THREADENTRY32 = requireKoffi().struct({
      dwSize: 'uint32',
      cntUsage: 'uint32',
      th32ThreadID: 'uint32',
      th32OwnerProcessID: 'uint32',
      tpBasePri: 'int32',
      tpDeltaPri: 'int32',
      dwFlags: 'uint32',
    });
  }
  return _THREADENTRY32;
}

let _MODULEENTRY32W: KoffiStructType | null = null;
function getModuleEntry32Type(): KoffiStructType {
  if (!_MODULEENTRY32W) {
    _MODULEENTRY32W = requireKoffi().struct({
      dwSize: 'uint32',
      th32ModuleID: 'uint32',
      th32ProcessID: 'uint32',
      GlblcntUsage: 'uint32',
      ProccntUsage: 'uint32',
      modBaseAddr: 'uint64',
      modBaseSize: 'uint32',
      hModule: 'uint64',
      szModule: requireKoffi().array('char16', 256),
      szExePath: requireKoffi().array('char16', 260),
    });
  }
  return _MODULEENTRY32W;
}

// ── FFI function bindings ──

type KoffiFunc = KoffiCallable;

let _OpenProcess: KoffiFunc | null = null;
function getOpenProcess() {
  if (!_OpenProcess) {
    _OpenProcess = kernel32().func('void *OpenProcess(uint32, int32, uint32)');
  }
  return _OpenProcess;
}

let _CloseHandle: KoffiFunc | null = null;
function getCloseHandle() {
  if (!_CloseHandle) {
    _CloseHandle = kernel32().func('int32 CloseHandle(void *)');
  }
  return _CloseHandle;
}

let _CreateToolhelp32Snapshot: KoffiFunc | null = null;
function getCreateToolhelp32Snapshot() {
  if (!_CreateToolhelp32Snapshot) {
    _CreateToolhelp32Snapshot = kernel32().func('void *CreateToolhelp32Snapshot(uint32, uint32)');
  }
  return _CreateToolhelp32Snapshot;
}

let _Thread32First: KoffiFunc | null = null;
function getThread32First() {
  if (!_Thread32First) {
    _Thread32First = kernel32().func('int32 Thread32First(void *, _Out_ void *)');
  }
  return _Thread32First;
}

let _Thread32Next: KoffiFunc | null = null;
function getThread32Next() {
  if (!_Thread32Next) {
    _Thread32Next = kernel32().func('int32 Thread32Next(void *, _Out_ void *)');
  }
  return _Thread32Next;
}

let _Module32FirstW: KoffiFunc | null = null;
function getModule32FirstW() {
  if (!_Module32FirstW) {
    _Module32FirstW = kernel32().func('int32 Module32FirstW(void *, _Out_ void *)');
  }
  return _Module32FirstW;
}

let _Module32NextW: KoffiFunc | null = null;
function getModule32NextW() {
  if (!_Module32NextW) {
    _Module32NextW = kernel32().func('int32 Module32NextW(void *, _Out_ void *)');
  }
  return _Module32NextW;
}

let _OpenThread: KoffiFunc | null = null;
function getOpenThread() {
  if (!_OpenThread) {
    _OpenThread = kernel32().func('void *OpenThread(uint32, int32, uint32)');
  }
  return _OpenThread;
}

let _SuspendThread: KoffiFunc | null = null;
function getSuspendThread() {
  if (!_SuspendThread) {
    _SuspendThread = kernel32().func('uint32 SuspendThread(void *)');
  }
  return _SuspendThread;
}

let _ResumeThread: KoffiFunc | null = null;
function getResumeThread() {
  if (!_ResumeThread) {
    _ResumeThread = kernel32().func('uint32 ResumeThread(void *)');
  }
  return _ResumeThread;
}

let _GetThreadContext: KoffiFunc | null = null;
function getGetThreadContext() {
  if (!_GetThreadContext) {
    _GetThreadContext = kernel32().func('int32 GetThreadContext(void *, _Out_ void *)');
  }
  return _GetThreadContext;
}

let _ReadProcessMemory: KoffiFunc | null = null;
function getReadProcessMemory() {
  if (!_ReadProcessMemory) {
    _ReadProcessMemory = kernel32().func(
      'int32 ReadProcessMemory(void *, _In_ void *, _Out_ void *, uint64, _Out_ uint64 *)',
    );
  }
  return _ReadProcessMemory;
}

// ── Typed wrappers for koffi-alloc'd struct access ──

/**
 * requireKoffi().alloc(struct) returns an object with typed properties.
 * We use `as any` to access fields since the return type is opaque.
 */

interface ThreadEntryAccessor {
  dwSize: number;
  th32OwnerProcessID: number;
  th32ThreadID: number;
}

interface ModuleEntryAccessor {
  dwSize: number;
  modBaseAddr: bigint;
  modBaseSize: number;
  szModule: number[];
}

function allocThreadEntry(): ThreadEntryAccessor {
  const te = requireKoffi().alloc(getThreadEntry32Type(), 1) as unknown as ThreadEntryAccessor;
  te.dwSize = requireKoffi().sizeof(getThreadEntry32Type());
  return te;
}

function allocModuleEntry(): ModuleEntryAccessor {
  const me = requireKoffi().alloc(getModuleEntry32Type(), 1) as unknown as ModuleEntryAccessor;
  me.dwSize = requireKoffi().sizeof(getModuleEntry32Type());
  return me;
}

// ── Module name cache ──

interface ModuleInfo {
  base: bigint;
  size: number;
  name: string;
}

function buildModuleMap(pid: number): ModuleInfo[] {
  const hModuleSnap = getCreateToolhelp32Snapshot()(0x00000008 /* TH32CS_SNAPMODULE */, pid);
  if (Number(hModuleSnap) === -1) return [];

  const modules: ModuleInfo[] = [];
  const me32 = allocModuleEntry();

  if (getModule32FirstW()(hModuleSnap, me32)) {
    do {
      const name = String.fromCharCode(...(me32.szModule ?? []).filter((c: number) => c !== 0));
      if (name.length > 0) {
        modules.push({ base: me32.modBaseAddr, size: me32.modBaseSize, name });
      }
    } while (getModule32NextW()(hModuleSnap, me32));
  }
  getCloseHandle()(hModuleSnap);
  return modules;
}

function resolveModule(
  address: bigint,
  modules: ModuleInfo[],
): { moduleName: string | null; offset: string | null } {
  for (const mod of modules) {
    const end = mod.base + BigInt(mod.size);
    if (address >= mod.base && address < end) {
      return {
        moduleName: mod.name,
        offset: `0x${(address - mod.base).toString(16).toUpperCase()}`,
      };
    }
  }
  return { moduleName: null, offset: null };
}

// ── Internal helpers ──

function openProcess(pid: number): bigint {
  const desiredAccess = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_VM_OPERATION;
  const hProcess = getOpenProcess()(desiredAccess, 0, pid) as number | bigint;
  const handle = BigInt(typeof hProcess === 'number' ? hProcess : hProcess);
  if (handle === 0n) {
    throw new Error(`Failed to open process ${pid}. Run as Administrator.`);
  }
  return handle;
}

function getThreadIds(pid: number): number[] {
  const hSnapshot = getCreateToolhelp32Snapshot()(TH32CS_SNAPTHREAD, 0);
  if (Number(hSnapshot) === -1) return [];

  const threadIds: number[] = [];
  const te32 = allocThreadEntry();

  if (getThread32First()(hSnapshot, te32)) {
    do {
      if (te32.th32OwnerProcessID === pid) {
        threadIds.push(te32.th32ThreadID);
      }
    } while (getThread32Next()(hSnapshot, te32));
  }
  getCloseHandle()(hSnapshot);
  return threadIds;
}

/** Read a uint64 from target process memory (returns 0n on failure). */
function readQword(hProcess: bigint, address: bigint): bigint {
  const buf = Buffer.alloc(8);
  const bytesReadBuf = Buffer.alloc(8);
  const ok = getReadProcessMemory()(
    hProcess,
    address as unknown as bigint,
    requireKoffi().address(buf),
    8n,
    requireKoffi().address(bytesReadBuf),
  ) as number;
  if (!ok || bytesReadBuf.readBigUInt64LE(0) !== 8n) return 0n;
  return buf.readBigUInt64LE(0);
}

// ── Public API ──

/**
 * Walk the call stack of a target process thread.
 *
 * Uses the x64 frame-pointer chain (RBP-based). The thread is suspended
 * during the walk and resumed before returning.
 *
 * @param pid Target process ID
 * @param threadId Specific thread ID (optional; defaults to the first thread)
 * @returns Array of call stack frames, deepest frame first
 */
export function walkCallStack(pid: number, threadId?: number): CallStackFrame[] {
  if (process.platform !== 'win32') {
    throw new Error('Call stack walking is only supported on Windows (x64).');
  }

  const hProcess = openProcess(pid);
  const modules = buildModuleMap(pid);

  // Resolve thread
  const threadIds = getThreadIds(pid);
  if (threadIds.length === 0) {
    getCloseHandle()(hProcess);
    throw new Error(`No threads found in process ${pid}.`);
  }

  const targetTid = threadId ?? threadIds[0]!;
  if (!threadIds.includes(targetTid)) {
    getCloseHandle()(hProcess);
    throw new Error(`Thread ${targetTid} not found in process ${pid}.`);
  }

  const hThreadRaw = getOpenThread()(
    THREAD_QUERY_INFORMATION | THREAD_GET_CONTEXT | THREAD_SUSPEND_RESUME,
    0,
    targetTid,
  ) as number;
  const hThread = BigInt(hThreadRaw);
  if (hThread === 0n) {
    getCloseHandle()(hProcess);
    throw new Error(`Failed to open thread ${targetTid} in process ${pid}.`);
  }

  // Suspend + get context
  getSuspendThread()(hThread);

  const ctx = parseContext(
    (() => {
      const buf = Buffer.alloc(CONTEXT_SIZE);
      // CONTEXT_FULL is arch-aware (AMD64 vs ARM64 flag values + offsets).
      buf.writeUInt32LE(CONTEXT_FLAGS.FULL, IS_ARM64_WINDOWS ? 0x00 : 0x30);
      if (!getGetThreadContext()(hThread, requireKoffi().address(buf))) {
        getResumeThread()(hThread);
        getCloseHandle()(hThread);
        getCloseHandle()(hProcess);
        throw new Error(`Failed to get thread context for thread ${targetTid}.`);
      }
      return buf;
    })(),
  );

  const rip = ctx.rip;
  const rbp = ctx.rbp;

  // Walk the frame-pointer chain
  const frames: CallStackFrame[] = [];
  let currentRbp = rbp;

  // Frame 0 = current instruction
  const ripResolved = resolveModule(rip, modules);
  frames.push({
    frameIndex: 0,
    returnAddress: `0x${rip.toString(16).toUpperCase()}`,
    moduleName: ripResolved.moduleName,
    functionName: ripResolved.offset ? `${ripResolved.moduleName}!${ripResolved.offset}` : null,
  });

  // Walk RBP chain: [saved_RBP][return_address]
  for (let i = 0; i < MAX_FRAMES; i++) {
    if (currentRbp === 0n) break;

    const savedRbp = readQword(hProcess, currentRbp);
    const retAddr = readQword(hProcess, currentRbp + 8n);

    if (retAddr === 0n) break;

    // Sanity check: frame pointer should point upward in stack
    if (savedRbp !== 0n && savedRbp <= currentRbp) break;

    const resolved = resolveModule(retAddr, modules);
    frames.push({
      frameIndex: frames.length,
      returnAddress: `0x${retAddr.toString(16).toUpperCase()}`,
      moduleName: resolved.moduleName,
      functionName: resolved.offset ? `${resolved.moduleName}!${resolved.offset}` : null,
    });

    currentRbp = savedRbp;
  }

  // Resume + cleanup
  getResumeThread()(hThread);
  getCloseHandle()(hThread);
  getCloseHandle()(hProcess);

  return frames;
}
