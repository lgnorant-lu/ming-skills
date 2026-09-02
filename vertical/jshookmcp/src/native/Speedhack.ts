/**
 * Speedhack — process time manipulation via API hooking.
 *
 * Hooks QueryPerformanceCounter, GetTickCount64 and GetTickCount in the target
 * process to scale time by a multiplier (e.g., 2.0 = 2x speed, 0.5 = half speed).
 *
 * ## Architecture (military-grade trampoline)
 *
 * For each hooked API the target process receives a **two-layer detour**:
 *
 *   1. `orig_trampoline` (at sharedMem + trampOffset):
 *        [14 bytes of original prologue][JMP funcAddr+14]
 *      Executes the saved original bytes then jumps back to the function body,
 *      effectively reconstructing the original call. (Saved bytes are captured
 *      *before* the entry patch, so this is the genuine original code.)
 *
 *   2. `scale_handler` (at sharedMem + scaleOffset):
 *        CALL orig_trampoline          ; obtain real time value
 *        scale: scaled = base + (real - base) * speed   (SSE2)
 *        RET
 *
 *   The function entry is patched with `JMP scale_handler` (14-byte abs JMP).
 *
 * On the first call after hook install, `base` (stored in sharedMem) is 0, so
 * the handler initialises `base = real` and returns the unmodified value — this
 * avoids a time discontinuity at hook activation. Subsequent calls apply the
 * multiplier relative to that base, matching Cheat Engine's semantics.
 *
 * ## GetTickCount64 / GetTickCount / QueryPerformanceCounter
 *
 *  - GetTickCount64(): no args, returns ULONGLONG in RAX → scale RAX directly.
 *  - GetTickCount():   no args, returns DWORD in EAX      → scale RAX (low 32).
 *  - QueryPerformanceCounter(LARGE_INTEGER*): writes the counter to [RCX] and
 *    returns BOOL in RAX → scale the value at [RCX], preserve RAX (BOOL).
 *
 * ## Known limitation (documented)
 *
 * The detour copies the first 14 bytes of the target function verbatim. This is
 * safe only when those 14 bytes fall on an instruction boundary and contain no
 * RIP-relative addressing. For the Windows kernel32 time APIs this holds on
 * stock Windows 10/11/Server (they read KUSER_SHARED_DATA via absolute 64-bit
 * loads). If a future Windows revision changes the prologue, re-validation is
 * required. There is no in-process x86 disassembler available to compute the
 * exact prologue length, so 14 bytes (the abs-JMP detour size) is used.
 *
 * @module Speedhack
 */

import type { SpeedhackState } from './Speedhack.types';
import {
  openProcessForMemory,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualAllocEx,
  VirtualFreeEx,
  VirtualProtectEx,
  GetModuleHandle,
  GetProcAddress,
  PAGE,
  MEM,
} from './Win32API';
import { FlushInstructionCache } from './Win32Debug';

// ── sharedMem layout (4096-byte allocation) ──
//   +0      speed            (double, 8)   — current multiplier
//   +8      baseTick64       (double, 8)   — GetTickCount64 anchor (lazy)
//   +16     baseQPC          (double, 8)   — QueryPerformanceCounter anchor
//   +24     baseTick32       (double, 8)   — GetTickCount anchor
//   +32     baseQPF          (double, 8)   — QueryPerformanceFrequency anchor (lazy)
//   +40     baseTgTime       (double, 8)   — timeGetTime anchor (lazy)
//   +48     baseSft          (double, 8)   — GetSystemTimeAsFileTime anchor (lazy)
//   +56..   reserved
//   +256    scale_handler_gtc64   (≤128B slot)
//   +384    orig_trampoline_gtc64 (28B)
//   +448    scale_handler_qpc     (≤128B slot)
//   +576    orig_trampoline_qpc   (28B)
//   +640    scale_handler_gtc32   (≤128B slot)
//   +768    orig_trampoline_gtc32 (28B)
//   +832    scale_handler_qpf     (≤128B slot)
//   +960    orig_trampoline_qpf   (28B)
//   +1024   scale_handler_tgtime  (≤128B slot)
//   +1152   orig_trampoline_tgtime (28B)
//   +1216   scale_handler_sft     (≤128B slot)
//   +1344   orig_trampoline_sft   (28B)
//   +3072   restore metadata (6 × 32B: [origAddr(8)|origSize(4)|origBytes(12+pad)])
const OFF_SPEED = 0;
const OFF_BASE_TICK64 = 8;
const OFF_BASE_QPC = 16;
const OFF_BASE_TICK32 = 24;
const OFF_BASE_QPF = 32;
const OFF_BASE_TGTIME = 40;
const OFF_BASE_SFT = 48;
const OFF_ONE_CONST = 56; // double 1.0 — used by QPF zero-guard

const SCALE_OFF_GTC64 = 256;
const TRAMP_OFF_GTC64 = 384;
const SCALE_OFF_QPC = 448;
const TRAMP_OFF_QPC = 576;
const SCALE_OFF_GTC32 = 640;
const TRAMP_OFF_GTC32 = 768;
const SCALE_OFF_QPF = 832;
const TRAMP_OFF_QPF = 960;
const SCALE_OFF_TGTIME = 1024;
const TRAMP_OFF_TGTIME = 1152;
const SCALE_OFF_SFT = 1216;
const TRAMP_OFF_SFT = 1344;

const RESTORE_META_OFF = 3072;
const RESTORE_META_SLOT = 32;
const DETOUR_BYTES = 14; // abs JMP size + bytes saved for orig trampoline

type ScaleKind = 'gtc64' | 'qpc' | 'gtc32' | 'qpf' | 'tgtime' | 'sft';

interface HookTarget {
  kind: ScaleKind;
  apiName: string;
  /** DLL module to resolve the API from (default: 'kernel32.dll'). */
  module?: string;
  scaleOff: number;
  trampOff: number;
  baseOff: number;
}

const HOOK_TARGETS: HookTarget[] = [
  {
    kind: 'gtc64',
    apiName: 'GetTickCount64',
    scaleOff: SCALE_OFF_GTC64,
    trampOff: TRAMP_OFF_GTC64,
    baseOff: OFF_BASE_TICK64,
  },
  {
    kind: 'qpc',
    apiName: 'QueryPerformanceCounter',
    scaleOff: SCALE_OFF_QPC,
    trampOff: TRAMP_OFF_QPC,
    baseOff: OFF_BASE_QPC,
  },
  {
    kind: 'gtc32',
    apiName: 'GetTickCount',
    scaleOff: SCALE_OFF_GTC32,
    trampOff: TRAMP_OFF_GTC32,
    baseOff: OFF_BASE_TICK32,
  },
  {
    kind: 'qpf',
    apiName: 'QueryPerformanceFrequency',
    module: 'kernel32.dll',
    scaleOff: SCALE_OFF_QPF,
    trampOff: TRAMP_OFF_QPF,
    baseOff: OFF_BASE_QPF,
  },
  {
    kind: 'tgtime',
    apiName: 'timeGetTime',
    module: 'winmm.dll',
    scaleOff: SCALE_OFF_TGTIME,
    trampOff: TRAMP_OFF_TGTIME,
    baseOff: OFF_BASE_TGTIME,
  },
  {
    kind: 'sft',
    apiName: 'GetSystemTimeAsFileTime',
    module: 'kernel32.dll',
    scaleOff: SCALE_OFF_SFT,
    trampOff: TRAMP_OFF_SFT,
    baseOff: OFF_BASE_SFT,
  },
];

export class Speedhack {
  private states = new Map<number, SpeedhackState>();
  /**
   * Per-pid mutex chain. `apply`/`remove`/`setSpeed` must not interleave: a
   * re-apply calls `remove()` internally, and `remove` awaits nothing today but
   * a concurrent apply's `await this.remove(pid)` is still a yield point — two
   * interleaved applies would double-free the same allocation, restore each
   * other's hooks, and leak the earlier apply's shared memory.
   */
  private locks = new Map<number, Promise<unknown>>();

  private withLock<T>(pid: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(pid) ?? Promise.resolve();
    // Run even when the previous op rejected; the chain stays live.
    const run = prev.then(fn, fn);
    const cleanup = run.then(
      () => {
        if (this.locks.get(pid) === cleanup) this.locks.delete(pid);
      },
      () => {
        if (this.locks.get(pid) === cleanup) this.locks.delete(pid);
      },
    );
    this.locks.set(pid, cleanup);
    return run;
  }

  /** Apply speedhack to process with multiplier (1.0 = normal). */
  apply(pid: number, speed: number): Promise<{ success: boolean; hookedApis: string[] }> {
    return this.withLock(pid, () => this.applyInternal(pid, speed));
  }

  private async applyInternal(
    pid: number,
    speed: number,
  ): Promise<{ success: boolean; hookedApis: string[] }> {
    // Re-apply on an already-hooked process: tear down first to avoid double
    // hooks. Uses the lock-free internal variant — we already hold the pid lock.
    if (this.states.has(pid)) {
      await this.removeInternal(pid);
    }

    const handle = openProcessForMemory(pid, true);
    const hookedApis: string[] = [];
    const patchIds: string[] = [];

    try {
      // Pre-resolve module bases to avoid repeated GetModuleHandle calls.
      const moduleBases = new Map<string, bigint>();
      for (const target of HOOK_TARGETS) {
        const modName = target.module ?? 'kernel32.dll';
        if (!moduleBases.has(modName)) {
          const base = GetModuleHandle(modName);
          if (base === 0n) continue; // Module not loaded — skip targets in this module.
          moduleBases.set(modName, base);
        }
      }

      // Allocate shared memory (RWX) for state + trampolines.
      const sharedMem = VirtualAllocEx(
        handle,
        0n,
        4096,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.EXECUTE_READWRITE,
      );
      if (sharedMem === 0n) {
        throw new Error('VirtualAllocEx failed for speedhack shared memory');
      }

      try {
        // Initialise speed multiplier and zero all base anchors (lazy init in-shellcode).
        const speedBuf = Buffer.alloc(8);
        speedBuf.writeDoubleLE(speed, 0);
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_SPEED), speedBuf);
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_TICK64), Buffer.alloc(8, 0));
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_QPC), Buffer.alloc(8, 0));
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_TICK32), Buffer.alloc(8, 0));
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_QPF), Buffer.alloc(8, 0));
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_TGTIME), Buffer.alloc(8, 0));
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_BASE_SFT), Buffer.alloc(8, 0));
        // Pre-write 1.0 constant for QPF zero-guard (speed==0 → divide by 1.0).
        const oneBuf = Buffer.alloc(8);
        oneBuf.writeDoubleLE(1.0, 0);
        WriteProcessMemory(handle, sharedMem + BigInt(OFF_ONE_CONST), oneBuf);

        let metaIdx = 0;
        for (const target of HOOK_TARGETS) {
          const modName = target.module ?? 'kernel32.dll';
          const modBase = moduleBases.get(modName);
          if (modBase === undefined) continue; // Module not loaded — skip.

          const funcAddr = GetProcAddress(modBase, target.apiName);
          if (funcAddr === 0n) continue; // API not available — skip cleanly.

          try {
            const installed = this.installHook(handle, funcAddr, sharedMem, target, metaIdx);
            if (installed) {
              hookedApis.push(target.apiName);
              patchIds.push(target.kind);
              metaIdx += 1;
            }
          } catch {
            // Best-effort: a single hook failure should not abort the others.
          }
        }
      } catch (error) {
        // The shared allocation is ours alone — release it so the target
        // process never keeps an orphaned 4096B PAGE_EXECUTE_READWRITE region.
        try {
          VirtualFreeEx(handle, sharedMem, 0, MEM.RELEASE);
        } catch {
          // Best-effort cleanup — do not mask the original error.
        }
        throw error;
      }

      this.states.set(pid, {
        pid,
        speed,
        hookedApis,
        isActive: true,
        allocatedMemory: `0x${sharedMem.toString(16).toUpperCase()}`,
        patchIds,
      });

      return { success: hookedApis.length > 0, hookedApis };
    } finally {
      CloseHandle(handle);
    }
  }

  /** Update speed multiplier (without re-hooking). */
  setSpeed(pid: number, speed: number): Promise<boolean> {
    return this.withLock(pid, () => this.setSpeedInternal(pid, speed));
  }

  private async setSpeedInternal(pid: number, speed: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state || !state.isActive || !state.allocatedMemory) return false;

    const addr = BigInt(state.allocatedMemory);
    const handle = openProcessForMemory(pid, true);
    try {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(speed, 0);
      WriteProcessMemory(handle, addr + BigInt(OFF_SPEED), buf);
      state.speed = speed;
      return true;
    } finally {
      CloseHandle(handle);
    }
  }

  /** Get current speed multiplier. */
  getSpeed(pid: number): number | null {
    const state = this.states.get(pid);
    return state?.isActive ? state.speed : null;
  }

  /** Remove speedhack, restore original functions. Alias of {@link remove}. */
  async restore(pid: number): Promise<boolean> {
    return await this.remove(pid);
  }

  /** Remove speedhack, restore original functions. */
  remove(pid: number): Promise<boolean> {
    return this.withLock(pid, () => this.removeInternal(pid));
  }

  private async removeInternal(pid: number): Promise<boolean> {
    const state = this.states.get(pid);
    if (!state) return false;

    const handle = openProcessForMemory(pid, true);
    try {
      if (state.allocatedMemory) {
        const allocAddr = BigInt(state.allocatedMemory);

        // Restore original bytes for each hooked function from saved metadata.
        for (let i = 0; i < state.patchIds.length; i++) {
          try {
            const metaOffset = BigInt(RESTORE_META_OFF + i * RESTORE_META_SLOT);
            const metaBuf = ReadProcessMemory(handle, allocAddr + metaOffset, RESTORE_META_SLOT);
            const origAddr = metaBuf.readBigUInt64LE(0);
            const origSize = metaBuf.readUInt32LE(8);
            if (origAddr !== 0n && origSize > 0 && origSize <= DETOUR_BYTES) {
              const origBytes = metaBuf.subarray(12, 12 + origSize);
              const { success: protOk, oldProtect } = VirtualProtectEx(
                handle,
                origAddr,
                origSize,
                PAGE.EXECUTE_READWRITE,
              );
              if (!protOk) continue; // cannot write — keep going with the rest
              try {
                WriteProcessMemory(handle, origAddr, origBytes);
                FlushInstructionCache(handle, origAddr, origSize);
              } finally {
                // Never leave the function entry PAGE_EXECUTE_READWRITE.
                VirtualProtectEx(handle, origAddr, origSize, oldProtect);
              }
            }
          } catch {
            // Best-effort restore — continue with remaining hooks.
          }
        }

        VirtualFreeEx(handle, allocAddr, 0, MEM.RELEASE);
      }
    } finally {
      CloseHandle(handle);
    }

    state.isActive = false;
    this.states.delete(pid);
    return true;
  }

  /** Check if speedhack is active for a process. */
  isActive(pid: number): boolean {
    return this.states.get(pid)?.isActive ?? false;
  }

  /** List all active speedhacks. */
  listActive(): SpeedhackState[] {
    return Array.from(this.states.values()).filter((s) => s.isActive);
  }

  // ── Private ──

  /**
   * Install the two-layer detour for one time API.
   * Returns true on success, false if the prologue could not be read.
   */
  private installHook(
    handle: bigint,
    funcAddr: bigint,
    sharedMem: bigint,
    target: HookTarget,
    metaIdx: number,
  ): boolean {
    // 1. Capture original prologue BEFORE patching (entry will become JMP).
    const origBytes = ReadProcessMemory(handle, funcAddr, DETOUR_BYTES);

    // 2. Build orig_trampoline: [orig 14 bytes][JMP funcAddr+14]
    const trampolineAddr = sharedMem + BigInt(target.trampOff);
    WriteProcessMemory(handle, trampolineAddr, origBytes);
    const jumpBack = this.buildAbsoluteJump(funcAddr + BigInt(DETOUR_BYTES));
    WriteProcessMemory(handle, trampolineAddr + BigInt(DETOUR_BYTES), Buffer.from(jumpBack));

    // 3. Build scale_handler (calls orig_trampoline, scales result, returns).
    const scaleHandler = this.buildScaleHandler(
      target.kind,
      sharedMem,
      target.scaleOff,
      target.trampOff,
    );
    WriteProcessMemory(handle, sharedMem + BigInt(target.scaleOff), scaleHandler);

    // 4. Patch function entry: JMP scale_handler (14-byte abs JMP).
    const scaleHandlerAddr = sharedMem + BigInt(target.scaleOff);
    const jumpToScale = this.buildAbsoluteJump(scaleHandlerAddr);
    const { success: protOk, oldProtect } = VirtualProtectEx(
      handle,
      funcAddr,
      DETOUR_BYTES,
      PAGE.EXECUTE_READWRITE,
    );
    if (!protOk) {
      // Writing into an unwritable page would fail anyway — report the failed
      // hook so apply() skips it instead of recording it as installed.
      throw new Error(`speedhack: VirtualProtectEx failed for ${target.apiName}`);
    }
    try {
      WriteProcessMemory(handle, funcAddr, Buffer.from(jumpToScale));
      FlushInstructionCache(handle, funcAddr, DETOUR_BYTES);
    } finally {
      // Restore protection even on write failure — never leave the function
      // entry PAGE_EXECUTE_READWRITE in the target process.
      VirtualProtectEx(handle, funcAddr, DETOUR_BYTES, oldProtect);
    }

    // 5. Save restore metadata: [origAddr(8) | origSize(4) | origBytes(14) | pad(2)]
    const metaBuf = Buffer.alloc(RESTORE_META_SLOT, 0);
    metaBuf.writeBigUInt64LE(funcAddr, 0);
    metaBuf.writeUInt32LE(DETOUR_BYTES, 8);
    origBytes.copy(metaBuf, 12);
    WriteProcessMemory(
      handle,
      sharedMem + BigInt(RESTORE_META_OFF + metaIdx * RESTORE_META_SLOT),
      metaBuf,
    );

    FlushInstructionCache(handle, scaleHandlerAddr, scaleHandler.length);
    return true;
  }

  /**
   * Assemble the scale_handler shellcode for one time API kind.
   *
   * Layout ( offsets documented per kind; see class header for full design ):
   *   push <saved regs> ; sub rsp, shadow
   *   call orig_trampoline          ; E8 rel32  → real value
   *   mov r8, <sharedMem imm64>     ; absolute base for speed/base anchors
   *   cvtsi2sd xmm0, real           ; (double)real
   *   movsd xmm1, [r8+baseOff]      ; base (0 on first call)
   *   movsd xmm2, [r8]              ; speed
   *   pxor xmm3,xmm3 ; ucomisd xmm1,xmm3 ; jne scale
   *   first-call: store base=real ; return real unmodified
   *   scale: xmm0 = base + (real-base)*speed ; cvttsd2si rax
   *   restore regs ; ret
   *
   * QPC additionally preserves the BOOL return in RSI and writes the scaled
   * counter back through the caller's [RCX] pointer.
   */
  private buildScaleHandler(
    kind: ScaleKind,
    sharedMem: bigint,
    scaleOff: number,
    origTrampOff: number,
  ): Buffer {
    const isQpc = kind === 'qpc';
    const isQpf = kind === 'qpf';
    const isSft = kind === 'sft';
    const isPointerParam = isQpc || isQpf || isSft;
    const baseOffMap: Record<ScaleKind, number> = {
      gtc64: OFF_BASE_TICK64,
      qpc: OFF_BASE_QPC,
      gtc32: OFF_BASE_TICK32,
      qpf: OFF_BASE_QPF,
      tgtime: OFF_BASE_TGTIME,
      sft: OFF_BASE_SFT,
    };
    const baseOff = baseOffMap[kind];
    const b: number[] = [];

    // ── QPF special path: division (frequency / speed), no base anchor ──
    if (isQpf) {
      return this.buildQpfScaleHandler(sharedMem, scaleOff, origTrampOff);
    }

    // push rbx (all kinds); push rsi (pointer-param — preserves BOOL; sft is void so no BOOL)
    b.push(0x53);
    if (isQpc) b.push(0x56);
    // sub rsp, 0x20 (gtc) / 0x28 (pointer-param — extra 8 for rsi push alignment)
    b.push(0x48, 0x83, 0xec, isPointerParam ? 0x28 : 0x20);
    if (isPointerParam) {
      b.push(0x48, 0x89, 0xcb); // mov rbx, rcx  (save out-pointer arg)
    }
    // call orig_trampoline (E8 rel32) — placeholder, backfilled below
    const callIdx = b.length;
    b.push(0xe8, 0, 0, 0, 0);
    if (isQpc) {
      b.push(0x48, 0x89, 0xc6); // mov rsi, rax  (save BOOL)
      b.push(0x48, 0x8b, 0x03); // mov rax, [rbx] (real counter)
    } else if (isSft) {
      // void return — no BOOL to save. Read FILETIME from [rbx] into rax.
      b.push(0x48, 0x8b, 0x03); // mov rax, [rbx] (real FILETIME, 64-bit)
    } else {
      b.push(0x48, 0x89, 0xc3); // mov rbx, rax  (save real tick)
    }
    // mov r8, <sharedMem>  (49 B8 imm64)
    b.push(0x49, 0xb8);
    for (let i = 0; i < 8; i += 1) b.push(Number((sharedMem >> BigInt(i * 8)) & 0xffn));
    // cvtsi2sd xmm0, rax(qpc/sft) / rbx(gtc)
    if (isSft) {
      b.push(0xf2, 0x48, 0x0f, 0x2a, 0xc0); // cvtsi2sd xmm0, rax
    } else {
      b.push(0xf2, 0x48, 0x0f, 0x2a, isQpc ? 0xc0 : 0xc3);
    }
    // movsd xmm1, [r8+baseOff]   (F2 41 0F 10 48 disp8)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x48, baseOff);
    // movsd xmm2, [r8]           (F2 41 0F 10 10)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x10);
    // pxor xmm3, xmm3            (66 0F EF DB)
    b.push(0x66, 0x0f, 0xef, 0xdb);
    // ucomisd xmm1, xmm3         (66 0F 2E CB)
    b.push(0x66, 0x0f, 0x2e, 0xcb);
    // jne scale (rel8) — placeholder
    const jneIdx = b.length;
    b.push(0x75, 0);
    // — first-call path: base==0 → init base=real, return real —
    // movsd [r8+baseOff], xmm0   (F2 41 0F 11 40 disp8)
    b.push(0xf2, 0x41, 0x0f, 0x11, 0x40, baseOff);
    if (isPointerParam) {
      b.push(0x48, 0x89, 0x03); // mov [rbx], rax  (write real unchanged)
    } else {
      b.push(0x48, 0x89, 0xd8); // mov rax, rbx    (return real)
    }
    // jmp done (rel8) — placeholder
    const jmpDoneIdx = b.length;
    b.push(0xeb, 0);
    // — scale path —
    const scaleStart = b.length;
    b.push(0xf2, 0x0f, 0x5c, 0xc1); // subsd xmm0, xmm1
    b.push(0xf2, 0x0f, 0x59, 0xc2); // mulsd xmm0, xmm2
    b.push(0xf2, 0x0f, 0x58, 0xc1); // addsd xmm0, xmm1
    b.push(0xf2, 0x48, 0x0f, 0x2c, 0xc0); // cvttsd2si rax, xmm0
    if (isPointerParam) {
      b.push(0x48, 0x89, 0x03); // mov [rbx], rax  (write scaled value)
    }
    // — done —
    const doneStart = b.length;
    if (isQpc) {
      b.push(0x48, 0x89, 0xf0); // mov rax, rsi  (restore BOOL)
    } else if (isSft) {
      b.push(0x48, 0x31, 0xc0); // xor rax, rax  (void — return 0 for safety)
    }
    b.push(0x48, 0x83, 0xc4, isPointerParam ? 0x28 : 0x20); // add rsp, ...
    if (isQpc) b.push(0x5e); // pop rsi
    b.push(0x5b); // pop rbx
    b.push(0xc3); // ret

    // Backfill call rel32: target = origTrampOff (absolute within sharedMem)
    const rel32 = origTrampOff - (scaleOff + callIdx + 5);
    b[callIdx + 1] = rel32 & 0xff;
    b[callIdx + 2] = (rel32 >> 8) & 0xff;
    b[callIdx + 3] = (rel32 >> 16) & 0xff;
    b[callIdx + 4] = (rel32 >> 24) & 0xff;
    // Backfill jne rel8: target = scaleStart
    b[jneIdx + 1] = scaleStart - (jneIdx + 2);
    // Backfill jmp done rel8: target = doneStart
    b[jmpDoneIdx + 1] = doneStart - (jmpDoneIdx + 2);

    return Buffer.from(b);
  }

  /**
   * Build the QPF (QueryPerformanceFrequency) scale handler.
   *
   * Unlike other time APIs which use additive scaling (base + (real-base)*speed),
   * frequency must be divided by speed: if speed=2, frequency should be halved so
   * that QPC/freq appears to advance twice as fast.
   *
   * Layout:
   *   push rbx; push rsi; sub rsp, 0x28
   *   mov rbx, rcx              ; save LPFREQUENCY* out
   *   call orig_trampoline       ; fills [rbx], returns BOOL
   *   mov rsi, rax              ; save BOOL
   *   mov rax, [rbx]            ; read real frequency
   *   mov r8, <sharedMem>
   *   movsd xmm1, [r8]          ; load speed
   *   pxor xmm2, xmm2; ucomisd xmm1, xmm2; jne divide
   *   movsd xmm1, [r8+OFF_ONE_CONST] ; zero-guard: speed→1.0
   *   divide: cvtsi2sd xmm0, rax ; freq→double
   *   divsd xmm0, xmm1          ; freq / speed
   *   cvttsd2si rax, xmm0
   *   mov [rbx], rax            ; write scaled frequency
   *   mov rax, rsi              ; restore BOOL
   *   add rsp, 0x28; pop rsi; pop rbx; ret
   */
  private buildQpfScaleHandler(sharedMem: bigint, scaleOff: number, origTrampOff: number): Buffer {
    const b: number[] = [];

    // push rbx; push rsi; sub rsp, 0x28
    b.push(0x53, 0x56, 0x48, 0x83, 0xec, 0x28);
    // mov rbx, rcx
    b.push(0x48, 0x89, 0xcb);
    // call orig_trampoline (E8 rel32) — placeholder
    const callIdx = b.length;
    b.push(0xe8, 0, 0, 0, 0);
    // mov rsi, rax (save BOOL)
    b.push(0x48, 0x89, 0xc6);
    // mov rax, [rbx] (read real frequency)
    b.push(0x48, 0x8b, 0x03);
    // mov r8, <sharedMem> (49 B8 imm64)
    b.push(0x49, 0xb8);
    for (let i = 0; i < 8; i += 1) b.push(Number((sharedMem >> BigInt(i * 8)) & 0xffn));
    // movsd xmm1, [r8] — load speed (F2 41 0F 10 08)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x08);
    // pxor xmm2, xmm2 (66 0F EF D2)
    b.push(0x66, 0x0f, 0xef, 0xd2);
    // ucomisd xmm1, xmm2 (66 0F 2E CA)
    b.push(0x66, 0x0f, 0x2e, 0xca);
    // jne divide (rel8) — placeholder
    const jneIdx = b.length;
    b.push(0x75, 0);
    // — zero-guard: speed==0 → use 1.0 —
    // movsd xmm1, [r8+OFF_ONE_CONST] (F2 41 0F 10 48 <disp8>)
    b.push(0xf2, 0x41, 0x0f, 0x10, 0x48, OFF_ONE_CONST);
    // — divide —
    const divideStart = b.length;
    // cvtsi2sd xmm0, rax (F2 48 0F 2A C0)
    b.push(0xf2, 0x48, 0x0f, 0x2a, 0xc0);
    // divsd xmm0, xmm1 (F2 0F 5E C1)
    b.push(0xf2, 0x0f, 0x5e, 0xc1);
    // cvttsd2si rax, xmm0 (F2 48 0F 2C C0)
    b.push(0xf2, 0x48, 0x0f, 0x2c, 0xc0);
    // mov [rbx], rax (write scaled frequency)
    b.push(0x48, 0x89, 0x03);
    // mov rax, rsi (restore BOOL)
    b.push(0x48, 0x89, 0xf0);
    // add rsp, 0x28; pop rsi; pop rbx; ret
    b.push(0x48, 0x83, 0xc4, 0x28, 0x5e, 0x5b, 0xc3);

    // Backfill call rel32
    const rel32 = origTrampOff - (scaleOff + callIdx + 5);
    b[callIdx + 1] = rel32 & 0xff;
    b[callIdx + 2] = (rel32 >> 8) & 0xff;
    b[callIdx + 3] = (rel32 >> 16) & 0xff;
    b[callIdx + 4] = (rel32 >> 24) & 0xff;
    // Backfill jne rel8
    b[jneIdx + 1] = divideStart - (jneIdx + 2);

    return Buffer.from(b);
  }

  /** Build a 14-byte absolute JMP for x64: FF 25 00 00 00 00 [8-byte addr]. */
  private buildAbsoluteJump(target: bigint): number[] {
    const buf = Buffer.alloc(14);
    buf[0] = 0xff;
    buf[1] = 0x25;
    buf.writeUInt32LE(0, 2); // RIP-relative offset = 0 (address follows immediately)
    buf.writeBigUInt64LE(target, 6);
    return Array.from(buf);
  }
}

export const speedhack = new Speedhack();
