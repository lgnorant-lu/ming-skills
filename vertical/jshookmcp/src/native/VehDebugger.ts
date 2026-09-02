/**
 * VEH (Vectored Exception Handler) Debugger Engine.
 *
 * Unlike the Win32 DebugActiveProcess backend (which freezes the ENTIRE process on every
 * debug event), VEH mode injects a small shellcode trampoline into the target that registers
 * a Vectored Exception Handler via AddVectoredExceptionHandler. When a hardware breakpoint
 * (DR0-DR3) or INT3 fires, the VEH handler inside the target process self-reports the hit
 * via shared memory + a named event -- only the faulting thread pauses, not the whole process.
 *
 * ## Architecture
 *
 * ```
 * +----------------+     shared memory      +-------------------+
 * |  Node.js       | <--- (memcpy) -------- |  Target Process   |
 * |  (this mod)    |                        |                   |
 * |                |     named event        |  VEH Handler      |
 * |  poll event ---+-- WaitForSingleObject -+> (shellcode)      |
 * |  read ctx      |                        |  SetEvent()       |
 * +----------------+                        +-------------------+
 * ```
 *
 * ## IPC Protocol
 *
 * 1. Node.js creates a named file-mapping (shared memory) and a named event.
 * 2. Shellcode is injected into the target (VirtualAllocEx + WriteProcessMemory +
 *    CreateRemoteThread).
 * 3. The shellcode calls AddVectoredExceptionHandler(1, handler) to register a
 *    first-chance VEH handler.
 * 4. When EXCEPTION_SINGLE_STEP (hardware BP) or EXCEPTION_BREAKPOINT (INT3) fires,
 *    the VEH handler copies the CPU context to shared memory, writes the DR index,
 *    increments the sequence number, signals the named event, and returns
 *    EXCEPTION_CONTINUE_EXECUTION.
 * 5. Node.js polls WaitForMultipleObjects on the event, reads the context from
 *    shared memory via memcpy, and surfaces it as a BreakpointHit.
 *
 * ## Advantages vs Win32 Debug API
 *
 * - **No process-wide freeze** -- only the faulting thread pauses briefly inside the VEH handler.
 * - **PEB.BeingDebugged stays 0** -- the target is not marked as "being debugged."
 * - **Supports both hardware (DR0-DR3) and software (INT3) breakpoints.**
 *
 * ## Limitations
 *
 * - **Requires code injection** -- a small shellcode stub (~400 bytes) is injected via
 *   VirtualAllocEx / WriteProcessMemory / CreateRemoteThread. Some anti-cheat systems
 *   (EAC, BattlEye, Vanguard) detect this.
 * - **Shared-memory latency** -- polling introduces ~1-5ms latency per hit vs the
 *   synchronous WaitForDebugEvent of the Win32 debug API.
 * - **Win32-only** -- VEH is a Windows kernel construct with no Linux/macOS equivalent.
 * - **Thread-id not captured** -- the VEH handler receives EXCEPTION_POINTERS which
 *   does not include the faulting thread ID; the hit reports threadId=0.
 *
 * @module VehDebugger
 */

import { randomUUID } from 'node:crypto';
import { BREAKPOINT_HIT_TIMEOUT_MS, BREAKPOINT_TRACE_MAX_HITS } from '@src/constants';
import { ToolError } from '@errors/ToolError';
import type {
  BreakpointAccess,
  BreakpointConfig,
  BreakpointHit,
  BreakpointListEntry,
  BreakpointSize,
} from './HardwareBreakpoint.types';
import {
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  EnumerateProcessThreads,
  openThreadForDebug,
  parseContext,
  writeContext,
  encodeDR7,
  writeBreakpointRegisters,
  CONTEXT_FLAGS,
  CONTEXT_SIZE,
  IS_ARM64_WINDOWS,
} from './Win32Debug';
import {
  CloseHandle,
  openProcessForMemory,
  VirtualAllocEx,
  VirtualFreeEx,
  WriteProcessMemory,
  PAGE,
  MEM,
} from './Win32API';
import { requireKoffi } from './koffi-loader';
import { formatAddress } from './formatAddress';
import { allocateDR as allocateDebugRegister } from './platform/utils';

// ── Shared memory layout ──
// +0x000: CONTEXT (1232 bytes) — full x64 thread context at hit
// +0x4D0: hitDrIndex  (4 bytes) — which DR0-3 triggered (0-3), or -1 for INT3
// +0x4D4: seqNumber   (4 bytes) — monotonic hit counter
// +0x4D8: readyFlag   (4 bytes) — 0x01 when VEH handler is installed
// +0x4DC: eventHandle (8 bytes) — handle to the named event (written by shellcode)
// +0x4E4: reserved    (28 bytes)
const VEHMEM_CONTEXT_OFFSET = 0x000;
const VEHMEM_DRINDEX_OFFSET = 0x4d0;
// +0x4D4 = seqNumber (documented above; baked into shellcode, not referenced in TS)
const VEHMEM_READY_OFFSET = 0x4d8;
const VEHMEM_EVENT_OFFSET = 0x4dc;
const VEHMEM_TOTAL_SIZE = 0x500;

interface ActiveBreakpoint extends BreakpointConfig {
  drIndex: number;
  hitCount: number;
  lastHit?: number;
}

interface VehSession {
  pid: number;
  hProcess: bigint;
  hMapping: bigint;
  pView: bigint | null;
  hEvent: bigint;
  hThread: bigint;
  pCode: bigint;
}

/**
 * Resolve a kernel32 function address for use in the injected shellcode's
 * parameter block. These addresses are stable within a process session and
 * identical across all processes on the same Windows build.
 */
function getProcAddr(name: string): bigint {
  const lib = requireKoffi().load('kernel32.dll');
  const hMod = lib.func('void *GetModuleHandleA(const char *)')('kernel32.dll');
  const fn = lib.func('void *GetProcAddress(void *, const char *)');
  return BigInt(fn(hMod, name) as unknown as number | bigint);
}

/**
 * Build an x64 shellcode payload that installs a VEH handler and keeps the
 * injector thread alive. The shellcode uses relative addressing and patched
 * immediates -- no hardcoded kernel32 addresses.
 */
function buildShellcode(pSharedMem: bigint, pSetEvent: bigint): Buffer {
  // Layout (offsets decimal, 384 bytes total):
  //   0x00: main thread entry -- save params, call AddVectoredExceptionHandler
  //   0x30: set ready flag
  //   0x50: exit thread
  //   0x80: veh_handler -- check exception code
  //   0xA0: copy CONTEXT loop
  //   0xE0: determine DR index
  //   0x110: increment seq, signal event
  //   0x140: set RF, return EXCEPTION_CONTINUE_EXECUTION
  const buf = Buffer.alloc(384);
  let off = 0;

  // Helper: encode little-endian immediate 64-bit at offset
  const imm64 = (o: number, v: bigint) => buf.writeBigUInt64LE(v, o);

  // ===== Main thread entry (rcx = params ptr) =====
  // Save params: mov r15, rcx
  buf[off++] = 0x4c;
  buf[off++] = 0x89;
  buf[off++] = 0xf9;

  // Shadow space + alignment: sub rsp, 0x28
  buf[off++] = 0x48;
  buf[off++] = 0x83;
  buf[off++] = 0xec;
  buf[off++] = 0x28;

  // Call AddVectoredExceptionHandler(1, &veh_handler)
  // lea rdx, [rip + delta_to_handler]
  const handlerTarget = 0x80;
  const leaRip = off + 7;
  buf[off++] = 0x48;
  buf[off++] = 0x8d;
  buf[off++] = 0x15;
  buf.writeInt32LE(handlerTarget - leaRip, off);
  off += 4;
  // mov rcx, 1
  buf[off++] = 0x48;
  buf[off++] = 0xc7;
  buf[off++] = 0xc1;
  buf[off++] = 0x01;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  // mov rax, [r15]  ; params[0] = pAddVectoredExceptionHandler
  buf[off++] = 0x49;
  buf[off++] = 0x8b;
  buf[off++] = 0x07;
  // call rax
  buf[off++] = 0xff;
  buf[off++] = 0xd0;

  // Set ready flag: write 1 to pSharedMem + VEHMEM_READY_OFFSET
  // mov rbx, <pSharedMem + VEHMEM_READY_OFFSET>
  buf[off++] = 0x48;
  buf[off++] = 0xbb;
  imm64(off, pSharedMem + BigInt(VEHMEM_READY_OFFSET));
  off += 8;
  // mov dword [rbx], 1
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0x01;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;

  // Thread exit cleanly
  // add rsp, 0x28
  buf[off++] = 0x48;
  buf[off++] = 0x83;
  buf[off++] = 0xc4;
  buf[off++] = 0x28;
  // xor eax, eax ; ret
  buf[off++] = 0x31;
  buf[off++] = 0xc0;
  buf[off++] = 0xc3;

  // Pad to 0x80
  while (off < 0x80) buf[off++] = 0xcc; // INT3 padding

  // ===== VEH Handler (LONG CALLBACK(PEXCEPTION_POINTERS ExceptionInfo)) =====
  // rcx = PEXCEPTION_POINTERS
  // Load ExceptionRecord: mov r10, [rcx]
  buf[off++] = 0x4c;
  buf[off++] = 0x8b;
  buf[off++] = 0x11;
  // Load ExceptionCode: mov eax, [r10]
  buf[off++] = 0x41;
  buf[off++] = 0x8b;
  buf[off++] = 0x02;

  // cmp eax, EXCEPTION_SINGLE_STEP (0x80000004)
  buf[off++] = 0x3d;
  buf.writeUInt32LE(0x80000004, off);
  off += 4;
  // jz handle_hit (patch later)
  const jzSsOff = off;
  buf[off++] = 0x74;
  buf[off++] = 0x00;

  // cmp eax, EXCEPTION_BREAKPOINT (0x80000003)
  buf[off++] = 0x3d;
  buf.writeUInt32LE(0x80000003, off);
  off += 4;
  const jzBpOff = off;
  buf[off++] = 0x74;
  buf[off++] = 0x00;

  // Not ours: xor eax, eax ; ret (EXCEPTION_CONTINUE_SEARCH = 0)
  buf[off++] = 0x31;
  buf[off++] = 0xc0;
  buf[off++] = 0xc3;

  // ===== Handle hit =====
  const handleHitOff = off;
  buf[jzSsOff + 1] = handleHitOff - (jzSsOff + 2);
  buf[jzBpOff + 1] = handleHitOff - (jzBpOff + 2);

  // Load ContextRecord: mov r8, [rcx + 8]
  buf[off++] = 0x4c;
  buf[off++] = 0x8b;
  buf[off++] = 0x41;
  buf[off++] = 0x08;

  // Copy CONTEXT to shared memory (1232 bytes = 154 qwords)
  // Set dest: mov r9, <pSharedMem + VEHMEM_CONTEXT_OFFSET>
  buf[off++] = 0x49;
  buf[off++] = 0xb9;
  imm64(off, pSharedMem + BigInt(VEHMEM_CONTEXT_OFFSET));
  off += 8;
  // Set count: mov ecx, 154
  buf[off++] = 0xb9;
  buf.writeUInt32LE(154, off);
  off += 4;
  // rep movsq
  buf[off++] = 0xf3;
  buf[off++] = 0x48;
  buf[off++] = 0xa5;

  // Determine DR index from DR6 in ContextRecord
  // r8 (= rsi after rep movsq) is ContextRecord + CONTEXT_SIZE
  // Go back to DR6 offset: sub r8, CONTEXT_SIZE - 0x68
  // 0x68 = DR6 offset in CONTEXT
  const dr6Backoff = CONTEXT_SIZE - 0x68;
  buf[off++] = 0x49;
  buf[off++] = 0x81;
  buf[off++] = 0xe8;
  buf.writeUInt32LE(dr6Backoff, off);
  off += 4;
  // Load DR6: mov rax, [r8]
  buf[off++] = 0x49;
  buf[off++] = 0x8b;
  buf[off++] = 0x00;

  // Set dest for drIndex write: mov r11, <pSharedMem + VEHMEM_DRINDEX_OFFSET>
  buf[off++] = 0x49;
  buf[off++] = 0xbb;
  imm64(off, pSharedMem + BigInt(VEHMEM_DRINDEX_OFFSET));
  off += 8;

  // Check DR6 bits 0-3, write corresponding index
  // test al, 1; jnz dr0
  buf[off++] = 0xa8;
  buf[off++] = 0x01;
  const jnz0Off = off;
  buf[off++] = 0x75;
  buf[off++] = 0x00;
  // test al, 2; jnz dr1
  buf[off++] = 0xa8;
  buf[off++] = 0x02;
  const jnz1Off = off;
  buf[off++] = 0x75;
  buf[off++] = 0x00;
  // test al, 4; jnz dr2
  buf[off++] = 0xa8;
  buf[off++] = 0x04;
  const jnz2Off = off;
  buf[off++] = 0x75;
  buf[off++] = 0x00;
  // Default: dr3 (or INT3 -> drIndex = -1)
  // test al, 8 ; jz int3
  buf[off++] = 0xa8;
  buf[off++] = 0x08;
  buf[off++] = 0x74;
  buf[off++] = 0x06; // jz int3
  // dr3: mov dword [r11], 3
  buf[off++] = 0x41;
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0x03;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  const jmpSeqOff = off;
  buf[off++] = 0xeb;
  buf[off++] = 0x00;

  // int3 fallthrough: mov dword [r11], 0xFFFFFFFF (-1)
  buf[off++] = 0x41;
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[jmpSeqOff + 1] = off - (jmpSeqOff + 2);

  // dr0: mov dword [r11], 0
  buf[jnz0Off + 1] = off - (jnz0Off + 2);
  buf[off++] = 0x41;
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0xeb;
  buf[off++] = 12; // jmp to seq

  // dr1: mov dword [r11], 1
  buf[jnz1Off + 1] = off - (jnz1Off + 2);
  buf[off++] = 0x41;
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0x01;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0xeb;
  buf[off++] = 5; // jmp to seq

  // dr2: mov dword [r11], 2
  buf[jnz2Off + 1] = off - (jnz2Off + 2);
  buf[off++] = 0x41;
  buf[off++] = 0xc7;
  buf[off++] = 0x03;
  buf[off++] = 0x02;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;

  // Increment seqNumber (at r11 + 4 = pSharedMem + VEHMEM_SEQ_OFFSET)
  // inc dword [r11 + 4]
  buf[off++] = 0x41;
  buf[off++] = 0xff;
  buf[off++] = 0x43;
  buf[off++] = 0x04;

  // Signal the event
  // Load event handle from shared memory
  // mov rcx, <pSharedMem + VEHMEM_EVENT_OFFSET>
  buf[off++] = 0x48;
  buf[off++] = 0xb9;
  imm64(off, pSharedMem + BigInt(VEHMEM_EVENT_OFFSET));
  off += 8;
  // mov rcx, [rcx]  ; dereference to get event handle
  buf[off++] = 0x48;
  buf[off++] = 0x8b;
  buf[off++] = 0x09;
  // mov rax, <pSetEvent>
  buf[off++] = 0x48;
  buf[off++] = 0xb8;
  imm64(off, pSetEvent);
  off += 8;
  // call rax
  buf[off++] = 0xff;
  buf[off++] = 0xd0;

  // Set RF (Resume Flag, bit 16) in EFlags to prevent immediate re-trigger
  // mov r10, [rcx + 8]  ; reload ContextRecord (rcx still = EXCEPTION_POINTERS)
  buf[off++] = 0x4c;
  buf[off++] = 0x8b;
  buf[off++] = 0x51;
  buf[off++] = 0x08;
  // or dword [r10 + 0x44], 0x10000  ; EFlags at CONTEXT+0x44
  buf[off++] = 0x41;
  buf[off++] = 0x81;
  buf[off++] = 0x4a;
  buf[off++] = 0x44;
  buf.writeUInt32LE(0x10000, off);
  off += 4;
  // Clear DR6 in ContextRecord
  // mov qword [r10 + 0x68], 0
  buf[off++] = 0x49;
  buf[off++] = 0xc7;
  buf[off++] = 0x42;
  buf[off++] = 0x68;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;
  buf[off++] = 0x00;

  // Return EXCEPTION_CONTINUE_EXECUTION (-1)
  buf[off++] = 0xb8;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[off++] = 0xff;
  buf[off++] = 0xc3;

  return Buffer.from(buf.subarray(0, off));
}

export class VehDebuggerEngine {
  private breakpoints = new Map<string, ActiveBreakpoint>();
  private sessions = new Map<number, VehSession>();
  private drAllocation = [false, false, false, false];

  /** Inject VEH handler into target, create shared memory + named event. */
  async attach(pid: number): Promise<void> {
    if (IS_ARM64_WINDOWS) {
      // This engine injects an x86-64 shellcode (VEH stub + shared-memory header)
      // into the target — not portable to a native ARM64 process. The honest
      // boundary is to refuse rather than inject wrong-arch bytes. Watchpoint
      // access-breakpoints on WOA are served by HardwareBreakpointEngine (Bcr/Wvr).
      throw new ToolError(
        'PREREQUISITE',
        'VEH debugger injection is x64-only and is not supported on Windows-on-ARM64; ' +
          'use memory_breakpoint (hardware watchpoint) instead',
      );
    }
    if (this.sessions.has(pid)) return;

    const hProcess = openProcessForMemory(pid, true);
    const kernel32 = requireKoffi().load('kernel32.dll');

    // Create named event (auto-reset, initially non-signaled)
    const eventName = `jshook_veh_${pid}`;
    const eventNameW = Buffer.alloc((eventName.length + 1) * 2);
    for (let i = 0; i < eventName.length; i++) {
      eventNameW.writeUInt16LE(eventName.charCodeAt(i), i * 2);
    }
    const createEventW = kernel32.func('void *CreateEventW(void *, int, int, _In_ uint16_t *)');
    const hEvent = createEventW(0, 0, 0, eventNameW);
    const hEventN = BigInt(hEvent as unknown as number | bigint);
    if (hEventN === 0n) {
      CloseHandle(hProcess);
      throw new ToolError('PREREQUISITE', `CreateEventW failed for VEH session (pid ${pid})`);
    }

    // Create shared file mapping (pagefile-backed)
    const mappingName = `jshook_veh_mem_${pid}`;
    const mappingNameW = Buffer.alloc((mappingName.length + 1) * 2);
    for (let i = 0; i < mappingName.length; i++) {
      mappingNameW.writeUInt16LE(mappingName.charCodeAt(i), i * 2);
    }
    const createFileMappingW = kernel32.func(
      'void *CreateFileMappingW(void *, void *, uint32, uint32, uint32, _In_ uint16_t *)',
    );
    const hMapping = createFileMappingW(
      BigInt('0xFFFFFFFFFFFFFFFF'),
      0,
      0x04, // PAGE_READWRITE
      0,
      VEHMEM_TOTAL_SIZE,
      mappingNameW,
    );
    const hMappingN = BigInt(hMapping as unknown as number | bigint);
    if (hMappingN === 0n) {
      CloseHandle(hEventN);
      CloseHandle(hProcess);
      throw new ToolError('PREREQUISITE', `CreateFileMappingW failed for VEH session (pid ${pid})`);
    }

    // Map view in Node.js process
    const mapViewOfFile = kernel32.func(
      'void *MapViewOfFile(void *, uint32, uint32, uint32, size_t)',
    );
    const pView = mapViewOfFile(hMappingN, 0x0006, 0, 0, BigInt(VEHMEM_TOTAL_SIZE));
    const pViewN = BigInt(pView as unknown as number | bigint);
    if (pViewN === 0n) {
      CloseHandle(hMappingN);
      CloseHandle(hEventN);
      CloseHandle(hProcess);
      throw new ToolError('PREREQUISITE', `MapViewOfFile failed for VEH session (pid ${pid})`);
    }

    // Write event handle into shared memory (shellcode reads it to set the event)
    const kernelMemcpy = kernel32.func('void *memcpy(void *, void *, size_t)');
    const eventHandleBuf = Buffer.alloc(8);
    eventHandleBuf.writeBigUInt64LE(hEventN, 0);
    kernelMemcpy(pViewN + BigInt(VEHMEM_EVENT_OFFSET), eventHandleBuf, BigInt(8));

    // Resolve function addresses for the shellcode
    const pAddVectoredExceptionHandler = getProcAddr('AddVectoredExceptionHandler');
    const pSetEvent = getProcAddr('SetEvent');

    // Build shellcode and params block
    const shellcode = buildShellcode(pViewN, pSetEvent);
    const paramSize = 16; // pAddVectoredExceptionHandler (8) + pSharedMem (8)

    // Allocate RWX memory in target
    const totalSize = shellcode.length + paramSize;
    const pRemote = VirtualAllocEx(
      hProcess,
      0n,
      totalSize,
      MEM.COMMIT | MEM.RESERVE,
      PAGE.EXECUTE_READWRITE,
    );
    if (pRemote === 0n) {
      const unmap = kernel32.func('int UnmapViewOfFile(void *)');
      unmap(pViewN);
      CloseHandle(hMappingN);
      CloseHandle(hEventN);
      CloseHandle(hProcess);
      throw new ToolError('PREREQUISITE', `VirtualAllocEx failed in target (pid ${pid})`);
    }

    // Write shellcode
    WriteProcessMemory(hProcess, pRemote, shellcode);

    // Write params block
    const params = Buffer.alloc(paramSize);
    params.writeBigUInt64LE(pAddVectoredExceptionHandler, 0);
    params.writeBigUInt64LE(pViewN, 8);
    WriteProcessMemory(hProcess, pRemote + BigInt(shellcode.length), params);

    // Create remote thread
    const createRemoteThread = kernel32.func(
      'void *CreateRemoteThread(void *, void *, size_t, void *, void *, uint32, void *)',
    );
    const hThread = createRemoteThread(
      hProcess,
      0,
      0n,
      pRemote,
      pRemote + BigInt(shellcode.length),
      0,
      0,
    );
    const hThreadN = BigInt(hThread as unknown as number | bigint);
    if (hThreadN === 0n) {
      VirtualFreeEx(hProcess, pRemote, 0, MEM.RELEASE);
      const unmap = kernel32.func('int UnmapViewOfFile(void *)');
      unmap(pViewN);
      CloseHandle(hMappingN);
      CloseHandle(hEventN);
      CloseHandle(hProcess);
      throw new ToolError('PREREQUISITE', `CreateRemoteThread failed in target (pid ${pid})`);
    }

    // Wait for thread to complete (shellcode exits after registering VEH)
    const waitForSingleObject = kernel32.func('uint32 WaitForSingleObject(void *, uint32)');
    waitForSingleObject(hThreadN, 5000);
    CloseHandle(hThreadN);

    this.sessions.set(pid, {
      pid,
      hProcess,
      hMapping: hMappingN,
      pView: pViewN,
      hEvent: hEventN,
      hThread: 0n, // handle already closed above; keep field for type compatibility
      pCode: pRemote,
    });
  }

  /** Detach: un-inject shellcode, close handles, release breakpoints. */
  async detach(pid: number): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) return;

    for (const [id, bp] of this.breakpoints) {
      if (bp.pid === pid) {
        this.breakpoints.delete(id);
        this.clearDR(pid, bp.drIndex);
        this.drAllocation[bp.drIndex] = false;
      }
    }

    const kernel32 = requireKoffi().load('kernel32.dll');
    try {
      VirtualFreeEx(session.hProcess, session.pCode, 0, MEM.RELEASE);
    } catch {
      /* best effort */
    }

    if (session.pView) {
      const unmap = kernel32.func('int UnmapViewOfFile(void *)');
      unmap(session.pView);
    }
    CloseHandle(session.hMapping);
    CloseHandle(session.hEvent);
    CloseHandle(session.hProcess);
    this.sessions.delete(pid);
  }

  /** Set a hardware breakpoint using DR registers. */
  async setBreakpoint(
    pid: number,
    address: string,
    access: BreakpointAccess,
    size: BreakpointSize = 4,
  ): Promise<BreakpointConfig> {
    if (!this.sessions.has(pid)) {
      await this.attach(pid);
    }

    const drIndex = this.allocateDR();
    const targetAddr = BigInt(address.startsWith('0x') ? address : `0x${address}`);

    this.applyDRToAllThreads(pid, drIndex, targetAddr, access, size, true);

    const config: ActiveBreakpoint = {
      id: randomUUID(),
      pid,
      address: `0x${targetAddr.toString(16).toUpperCase()}`,
      access,
      size,
      enabled: true,
      drIndex,
      hitCount: 0,
    };

    this.breakpoints.set(config.id, config);
    return config;
  }

  /** Remove a breakpoint. */
  async removeBreakpoint(id: string): Promise<boolean> {
    const bp = this.breakpoints.get(id);
    if (!bp) return false;

    this.breakpoints.delete(id);
    this.clearDR(bp.pid, bp.drIndex);
    this.drAllocation[bp.drIndex] = false;
    return true;
  }

  /** List all active breakpoints. */
  listBreakpoints(): BreakpointListEntry[] {
    return Array.from(this.breakpoints.values()).map((bp) => ({
      id: bp.id,
      address: bp.address,
      access: bp.access,
      size: bp.size,
      enabled: bp.enabled,
      hitCount: bp.hitCount,
      lastHit: bp.lastHit,
    }));
  }

  /** Poll shared-memory event for breakpoint hits. */
  async waitForHit(timeoutMs?: number): Promise<BreakpointHit | null> {
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;
    const kernel32 = requireKoffi().load('kernel32.dll');
    const waitForMultipleObjects = kernel32.func(
      'uint32 WaitForMultipleObjects(uint32, void **, int, uint32)',
    );
    const memcpy = kernel32.func('void *memcpy(void *, void *, size_t)');

    const sessions = Array.from(this.sessions.values());
    if (sessions.length === 0) return null;

    while (Date.now() < deadline) {
      const remaining = Math.max(100, deadline - Date.now());

      // Build handle array in Buffer
      const handlesBuf = Buffer.alloc(sessions.length * 8);
      for (let i = 0; i < sessions.length; i++) {
        handlesBuf.writeBigUInt64LE(sessions[i]!.hEvent, i * 8);
      }

      const result = waitForMultipleObjects(
        sessions.length,
        handlesBuf,
        0,
        Math.min(remaining, 500),
      );

      if (result >= 0 && result < sessions.length) {
        const session = sessions[result];
        if (!session?.pView) continue;

        const hit = this.readHit(session, memcpy);
        if (hit) {
          // Rearm by clearing DR6+RF on all threads
          this.rearmDR(session.pid);
          return hit;
        }
      }
    }

    return null;
  }

  /** Collect multiple hits. */
  async traceAccess(
    pid: number,
    address: string,
    access: BreakpointAccess,
    maxHits?: number,
    timeoutMs?: number,
  ): Promise<BreakpointHit[]> {
    const max = maxHits ?? BREAKPOINT_TRACE_MAX_HITS;
    const timeout = timeoutMs ?? BREAKPOINT_HIT_TIMEOUT_MS;
    const bp = await this.setBreakpoint(pid, address, access);
    const hits: BreakpointHit[] = [];

    const deadline = Date.now() + timeout;
    while (hits.length < max && Date.now() < deadline) {
      const hit = await this.waitForHit(Math.min(1000, deadline - Date.now()));
      if (hit?.breakpointId === bp.id) {
        hits.push(hit);
      }
    }

    await this.removeBreakpoint(bp.id);
    return hits;
  }

  // ── Private ──

  private allocateDR(): number {
    return allocateDebugRegister(this.drAllocation);
  }

  /** Read a hit from shared memory after event signal. */
  private readHit(
    session: VehSession,
    memcpy: (...args: unknown[]) => unknown,
  ): BreakpointHit | null {
    if (!session.pView) return null;

    try {
      // Read context buffer
      const ctxBuf = Buffer.alloc(CONTEXT_SIZE);
      memcpy(ctxBuf, session.pView + BigInt(VEHMEM_CONTEXT_OFFSET), BigInt(CONTEXT_SIZE));

      // Read drIndex
      const idxBuf = Buffer.alloc(4);
      memcpy(idxBuf, session.pView + BigInt(VEHMEM_DRINDEX_OFFSET), BigInt(4));
      const drIndex = idxBuf.readInt32LE(0);

      const ctx = parseContext(ctxBuf);

      // Find matching breakpoint
      for (const [id, bp] of this.breakpoints) {
        if (bp.pid !== session.pid) continue;
        if (bp.drIndex === drIndex) {
          bp.hitCount++;
          bp.lastHit = Date.now();
          return {
            breakpointId: id,
            address: bp.address,
            accessAddress: bp.address,
            instructionAddress: formatAddress(ctx.rip),
            threadId: 0, // VEH EXCEPTION_POINTERS does not include thread ID
            accessType: bp.access,
            timestamp: Date.now(),
            registers: {
              rax: formatAddress(ctx.rax),
              rbx: formatAddress(ctx.rbx),
              rcx: formatAddress(ctx.rcx),
              rdx: formatAddress(ctx.rdx),
              rsi: formatAddress(ctx.rsi),
              rdi: formatAddress(ctx.rdi),
              rsp: formatAddress(ctx.rsp),
              rbp: formatAddress(ctx.rbp),
              r8: formatAddress(ctx.r8),
              r9: formatAddress(ctx.r9),
              r10: formatAddress(ctx.r10),
              r11: formatAddress(ctx.r11),
              r12: formatAddress(ctx.r12),
              r13: formatAddress(ctx.r13),
              r14: formatAddress(ctx.r14),
              r15: formatAddress(ctx.r15),
              rip: formatAddress(ctx.rip),
              rflags: `0x${ctx.eflags.toString(16).toUpperCase()}`,
            },
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /** Rearm DR registers after a hit: clear DR6 + set RF on all threads. */
  private rearmDR(pid: number): void {
    if (IS_ARM64_WINDOWS) {
      // On ARM64 there is no DR6 or EFLAGS.RF — watchpoints auto-disable on the
      // faulting access and are re-armed by the next writeBreakpointRegisters.
      // Nothing else to reset here.
      void pid;
      return;
    }
    const threads = EnumerateProcessThreads(pid);
    for (const tid of threads) {
      let hThread: bigint;
      try {
        hThread = openThreadForDebug(tid);
      } catch {
        continue;
      }
      try {
        SuspendThread(hThread);
        const ctxBuf = GetThreadContext(hThread, CONTEXT_FLAGS.ALL);
        ctxBuf.writeBigUInt64LE(0n, 0x68); // clear DR6
        const eflags = ctxBuf.readUInt32LE(0x44);
        ctxBuf.writeUInt32LE(eflags | 0x10000, 0x44); // set RF
        SetThreadContext(hThread, ctxBuf);
        ResumeThread(hThread);
      } catch {
        try {
          ResumeThread(hThread);
        } catch {
          /* ignore */
        }
      } finally {
        CloseHandle(hThread);
      }
    }
  }

  private applyDRToAllThreads(
    pid: number,
    drIndex: number,
    address: bigint,
    access: BreakpointAccess,
    size: BreakpointSize,
    enable: boolean,
  ): void {
    const threads = EnumerateProcessThreads(pid);
    const drAccessMap: Record<BreakpointAccess, 'execute' | 'write' | 'readwrite' | 'read'> = {
      execute: 'execute',
      write: 'write',
      readwrite: 'readwrite',
      read: 'read',
    };

    for (const tid of threads) {
      let hThread: bigint;
      try {
        hThread = openThreadForDebug(tid);
      } catch {
        continue;
      }

      try {
        SuspendThread(hThread);
        const ctxBuf = GetThreadContext(hThread, CONTEXT_FLAGS.ALL);

        // Arch-aware debug-register write (AMD64: DR0-3+DR7; ARM64: Wvr/Wcr).
        writeBreakpointRegisters(ctxBuf, drIndex, enable ? address : null, enable, access);

        if (!IS_ARM64_WINDOWS) {
          const entries = Array.from(this.breakpoints.values())
            .filter((bp) => bp.enabled && bp.pid === pid)
            .map((bp) => ({
              drIndex: bp.drIndex,
              enabled: true,
              access: drAccessMap[bp.access],
              size: bp.size,
            }));

          if (enable) {
            entries.push({
              drIndex,
              enabled: true,
              access: drAccessMap[access],
              size,
            });
          }

          const dr7 = encodeDR7(entries);
          ctxBuf.writeBigUInt64LE(dr7, 0x70);
        }

        writeContext(ctxBuf, { contextFlags: CONTEXT_FLAGS.ALL });
        SetThreadContext(hThread, ctxBuf);
        ResumeThread(hThread);
      } catch {
        try {
          ResumeThread(hThread);
        } catch {
          /* ignore */
        }
      } finally {
        CloseHandle(hThread);
      }
    }
  }

  private clearDR(pid: number, drIndex: number): void {
    const dummyAccess: BreakpointAccess = 'write';
    this.applyDRToAllThreads(pid, drIndex, 0n, dummyAccess, 1, false);
  }
}

export const vehDebuggerEngine = new VehDebuggerEngine();
