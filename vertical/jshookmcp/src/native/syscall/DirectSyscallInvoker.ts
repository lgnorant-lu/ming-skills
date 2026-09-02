/**
 * DirectSyscallInvoker — executes NT syscalls via real `syscall` instructions,
 * bypassing all user-mode hooks (ntdll inline hooks, IAT hooks).
 *
 * Uses SyscallResolver (on-disk ntdll parsing) to extract SSNs, and
 * SyscallStubBuilder to create JIT-executable stubs that call through a
 * clean `syscall;ret` gadget (allocated in a separate RX page to avoid
 * hooks in the OS-loaded ntdll).
 *
 * Does NOT bypass kernel callbacks (ObRegisterCallbacks) or ETW-TI.
 *
 * Win32-only; no-op on other platforms.
 */

import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../koffi-loader';
import { DLL, ds } from '@utils/obfuscated-strings';
import { resolveNtdll } from './SyscallResolver';
import type { ResolvedNtdll } from './SyscallResolver';
import { logger } from '@utils/logger';

// ── Win32 API declarations (for gadget page allocation) ─────────────────────

let k32Handle: KoffiLibraryHandle | null = null;
function k32(): KoffiLibraryHandle {
  if (!k32Handle) k32Handle = requireKoffi().load(ds(DLL.kernel32));
  return k32Handle;
}

let vaFn: KoffiCallable | null = null;
function Va() {
  if (!vaFn) {
    vaFn = k32().func('void * VirtualAlloc(void *, size_t, uint32, uint32)');
  }
  return vaFn;
}

let vfFn: KoffiCallable | null = null;
function Vf() {
  if (!vfFn) vfFn = k32().func('int VirtualFree(void *, size_t, uint32)');
  return vfFn;
}

let vpFn: KoffiCallable | null = null;
function Vp() {
  if (!vpFn) {
    vpFn = k32().func('int VirtualProtect(void *, size_t, uint32, _Out_ uint32 *)');
  }
  return vpFn;
}

let gcpFn: KoffiCallable | null = null;
function Gcp() {
  if (!gcpFn) gcpFn = k32().func('void * GetCurrentProcess()');
  return gcpFn;
}

let wpmFn: KoffiCallable | null = null;
function Wpm() {
  if (!wpmFn) {
    wpmFn = k32().func(
      'int WriteProcessMemory(void *, void *, _In_ uint8_t *, size_t, _Out_ size_t *)',
    );
  }
  return wpmFn;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;
const MEM_RELEASE = 0x8000;
const PAGE_READWRITE = 0x04;
const PAGE_EXECUTE_READ = 0x20;
const STUB_PAGE = 64; // minimum allocation granularity is 64KB, but VirtualAlloc rounds up
const STUB_SIZE = 24; // 4 (mov r10,rcx) + 5 (mov eax,imm32) + 6 (jmp [rip+2]) + 2 (filler) + 8 (gadget addr) = 25... use 24 for alignment safety

/** NTSTATUS success: high bit clear → signed >= 0. */
function ntSuccess(status: number): boolean {
  return status >= 0;
}

function ntStatusToHex(status: number): string {
  return `0x${(status >>> 0).toString(16).padStart(8, '0')}`;
}

// ── NativeCallable type ──────────────────────────────────────────────────────

/** A koffi-callable native function pointer. */
type NativeCallable<T extends (...args: any[]) => any> = T;

/** Allocated pages to free on shutdown. */
const allocatedPages: bigint[] = [];

// ── Stub signatures (must match the Windows x64 syscall ABI) ─────────────────
//
// Syscall convention on x64: r10=arg1, rdx=arg2, r8=arg3, r9=arg4,
// stack args at [rsp+0x28]+. Our stub does `mov r10,rcx` then jumps to
// `syscall;ret`, so koffi's normal x64 calling convention (rcx=arg1,
// rdx=arg2, r8=arg3, r9=arg4) maps directly.
//
// Signatures use koffi C type strings with _Out_ / _Inout_ qualifiers.

const SIG_NT_OPEN_PROCESS = 'int32 NtOpenProcess(_Out_ void **, uint32, _In_ void *, _In_ void *)';
const SIG_NT_READ_VIRTUAL_MEMORY =
  'int32 NtReadVirtualMemory(void *, _In_ void *, _Out_ void *, uint64, _Out_ uint64 *)';
const SIG_NT_WRITE_VIRTUAL_MEMORY =
  'int32 NtWriteVirtualMemory(void *, _In_ void *, _In_ void *, uint64, _Out_ uint64 *)';
const SIG_NT_ALLOCATE_VIRTUAL_MEMORY =
  'int32 NtAllocateVirtualMemory(void *, _Inout_ void **, uint32, _Inout_ uint64 *, uint32, uint32)';
const SIG_NT_PROTECT_VIRTUAL_MEMORY =
  'int32 NtProtectVirtualMemory(void *, _Inout_ void **, _Inout_ uint64 *, uint32, _Out_ uint32 *)';
const SIG_NT_FREE_VIRTUAL_MEMORY =
  'int32 NtFreeVirtualMemory(void *, _Inout_ void **, _Inout_ uint64 *, uint32)';
const SIG_NT_CLOSE = 'int32 NtClose(void *)';

// ── Implementation ───────────────────────────────────────────────────────────

export class DirectSyscallInvoker {
  private resolved: ResolvedNtdll | null = null;
  private gadgetAddr: bigint = 0n;
  private initialized = false;
  private initError: string | null = null;

  // Cached stubs
  private ntOpenProcessStub: NativeCallable<
    (handleBuf: unknown, access: number, oa: unknown, cid: unknown) => number
  > | null = null;
  private ntReadVirtualMemoryStub: NativeCallable<
    (
      handle: unknown,
      baseAddr: unknown,
      buf: unknown,
      size: bigint | number,
      bytesRead: unknown,
    ) => number
  > | null = null;
  private ntWriteVirtualMemoryStub: NativeCallable<
    (
      handle: unknown,
      baseAddr: unknown,
      data: unknown,
      size: bigint | number,
      bytesWritten: unknown,
    ) => number
  > | null = null;
  private ntAllocateVirtualMemoryStub: NativeCallable<
    (
      handle: unknown,
      baseAddr: unknown,
      zeroBits: number,
      regionSize: unknown,
      allocType: number,
      protect: number,
    ) => number
  > | null = null;
  private ntProtectVirtualMemoryStub: NativeCallable<
    (
      handle: unknown,
      baseAddr: unknown,
      regionSize: unknown,
      newProtect: number,
      oldProtect: unknown,
    ) => number
  > | null = null;
  private ntFreeVirtualMemoryStub: NativeCallable<
    (handle: unknown, baseAddr: unknown, regionSize: unknown, freeType: number) => number
  > | null = null;
  private ntCloseStub: NativeCallable<(handle: unknown) => number> | null = null;

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize: parse ntdll SSNs and allocate a clean `syscall;ret` gadget page.
   * Idempotent — subsequent calls return immediately.
   */
  initialize(): void {
    if (this.initialized) return;
    if (process.platform !== 'win32') {
      this.initError = 'DirectSyscallInvoker requires Windows';
      return;
    }

    try {
      // 1. Parse ntdll on disk for SSNs
      this.resolved = resolveNtdll();

      // 2. Allocate a clean gadget page (unhooked syscall;ret)
      this.gadgetAddr = this.allocateGadgetPage();

      // 3. Build stubs for each needed syscall
      this.buildStubs();

      this.initialized = true;
      logger.debug(
        `DirectSyscallInvoker: initialized with ${this.resolved.syscalls.length} SSNs, ` +
          `gadget at 0x${this.gadgetAddr.toString(16)}`,
      );
      if (this.resolved.warnings.length > 0) {
        logger.debug(
          `DirectSyscallInvoker: ntdll parse warnings: ${this.resolved.warnings.join('; ')}`,
        );
      }
    } catch (err) {
      this.initError = err instanceof Error ? err.message : String(err);
      logger.warn(`DirectSyscallInvoker: initialization failed — ${this.initError}`);
      this.initialized = false;
    }
  }

  get isAvailable(): boolean {
    return this.initialized && this.initError === null;
  }

  get lastError(): string | null {
    return this.initError;
  }

  // ── Public memory-operation API ──────────────────────────────────────────

  /**
   * NtOpenProcess → returns handle (bigint).
   * Signature: NTSTATUS NtOpenProcess(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PCLIENT_ID)
   */
  ntOpenProcess(pid: number, desiredAccess: number, inheritHandle = false): bigint {
    this.ensureReady();
    const cid = Buffer.alloc(16);
    cid.writeBigUInt64LE(BigInt(pid), 0);
    const handleBuf = Buffer.alloc(8);
    const oa = buildObjectAttributes(inheritHandle ? 0x00000002 : 0x00000000);
    const status = this.ntOpenProcessStub!(
      requireKoffi().address(handleBuf),
      desiredAccess,
      requireKoffi().address(oa),
      requireKoffi().address(cid),
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtOpenProcess(syscall) failed for PID ${pid}: ${ntStatusToHex(status)}`);
    }
    return handleBuf.readBigUInt64LE(0);
  }

  /**
   * NtReadVirtualMemory → returns Buffer.
   * Signature: NTSTATUS NtReadVirtualMemory(HANDLE, PVOID, PVOID, SIZE_T, PSIZE_T)
   */
  ntReadVirtualMemory(hProcess: bigint, baseAddress: bigint, size: number): Buffer {
    this.ensureReady();
    const buf = Buffer.alloc(size);
    const bytesRead = Buffer.alloc(8);
    const status = this.ntReadVirtualMemoryStub!(
      hProcess,
      baseAddress,
      requireKoffi().address(buf),
      BigInt(size),
      requireKoffi().address(bytesRead),
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtReadVirtualMemory(syscall) failed: ${ntStatusToHex(status)}`);
    }
    return buf.subarray(0, Number(bytesRead.readBigUInt64LE(0)));
  }

  /**
   * NtWriteVirtualMemory → returns bytes written count.
   * Signature: NTSTATUS NtWriteVirtualMemory(HANDLE, PVOID, PVOID, SIZE_T, PSIZE_T)
   */
  ntWriteVirtualMemory(hProcess: bigint, baseAddress: bigint, data: Buffer): number {
    this.ensureReady();
    const bytesWritten = Buffer.alloc(8);
    const status = this.ntWriteVirtualMemoryStub!(
      hProcess,
      baseAddress,
      requireKoffi().address(data),
      BigInt(data.length),
      requireKoffi().address(bytesWritten),
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtWriteVirtualMemory(syscall) failed: ${ntStatusToHex(status)}`);
    }
    return Number(bytesWritten.readBigUInt64LE(0));
  }

  /**
   * NtAllocateVirtualMemory → returns allocated address.
   * Signature: NTSTATUS NtAllocateVirtualMemory(HANDLE, PVOID*, ULONG_PTR, PSIZE_T, ULONG, ULONG)
   */
  ntAllocateVirtualMemory(
    hProcess: bigint,
    size: number,
    allocType: number,
    protect: number,
  ): bigint {
    this.ensureReady();
    const addrBuf = Buffer.alloc(8); // PVOID* → zero-initialised = let kernel choose
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(size), 0);
    const status = this.ntAllocateVirtualMemoryStub!(
      hProcess,
      requireKoffi().address(addrBuf),
      0, // ZeroBits
      requireKoffi().address(sizeBuf),
      allocType,
      protect,
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtAllocateVirtualMemory(syscall) failed: ${ntStatusToHex(status)}`);
    }
    return addrBuf.readBigUInt64LE(0);
  }

  /**
   * NtProtectVirtualMemory → returns old protection.
   * Signature: NTSTATUS NtProtectVirtualMemory(HANDLE, PVOID*, PSIZE_T, ULONG, PULONG)
   */
  ntProtectVirtualMemory(
    hProcess: bigint,
    addr: bigint,
    size: number,
    newProtect: number,
  ): { oldProtect: number } {
    this.ensureReady();
    const addrBuf = Buffer.alloc(8);
    addrBuf.writeBigUInt64LE(addr, 0);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(size), 0);
    const old = Buffer.alloc(4);
    const status = this.ntProtectVirtualMemoryStub!(
      hProcess,
      requireKoffi().address(addrBuf),
      requireKoffi().address(sizeBuf),
      newProtect,
      requireKoffi().address(old),
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtProtectVirtualMemory(syscall) failed: ${ntStatusToHex(status)}`);
    }
    return { oldProtect: old.readUInt32LE(0) };
  }

  /**
   * NtFreeVirtualMemory.
   * Signature: NTSTATUS NtFreeVirtualMemory(HANDLE, PVOID*, PSIZE_T, ULONG)
   */
  ntFreeVirtualMemory(hProcess: bigint, addr: bigint, size: number, freeType: number): void {
    this.ensureReady();
    const addrBuf = Buffer.alloc(8);
    addrBuf.writeBigUInt64LE(addr, 0);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(size), 0);
    const status = this.ntFreeVirtualMemoryStub!(
      hProcess,
      requireKoffi().address(addrBuf),
      requireKoffi().address(sizeBuf),
      freeType,
    );
    if (!ntSuccess(status)) {
      throw new Error(`NtFreeVirtualMemory(syscall) failed: ${ntStatusToHex(status)}`);
    }
  }

  /**
   * NtClose.
   * Signature: NTSTATUS NtClose(HANDLE)
   */
  ntClose(handle: bigint): void {
    this.ensureReady();
    const status = this.ntCloseStub!(handle);
    if (!ntSuccess(status)) {
      throw new Error(`NtClose(syscall) failed: ${ntStatusToHex(status)}`);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private ensureReady(): void {
    if (!this.initialized) {
      const reason = this.initError ?? 'not initialized';
      throw new Error(`DirectSyscallInvoker: ${reason}`);
    }
  }

  /**
   * Allocate a dedicated RX page containing only `syscall;ret` (0F 05 C3).
   * This avoids using the OS-loaded ntdll .text which may be hooked.
   */
  private allocateGadgetPage(): bigint {
    const page = Va()(null, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (page === 0n || page === null || typeof page === 'undefined') {
      throw new Error('DirectSyscallInvoker: VirtualAlloc failed for gadget page');
    }
    const base = page as unknown as bigint;
    allocatedPages.push(base);

    // Write the gadget bytes
    const gadgetBytes = Buffer.from([0x0f, 0x05, 0xc3]); // syscall; ret
    const self = Gcp()() as unknown as bigint;
    const wrote = Buffer.alloc(8);
    const wret = Wpm()(
      self,
      base,
      requireKoffi().address(gadgetBytes),
      3,
      requireKoffi().address(wrote),
    );
    if (!wret) {
      throw new Error('DirectSyscallInvoker: WriteProcessMemory failed for gadget page');
    }

    // Protect to RX
    const old = Buffer.alloc(4);
    const pret = Vp()(base, 4096, PAGE_EXECUTE_READ, requireKoffi().address(old));
    if (!pret) {
      throw new Error('DirectSyscallInvoker: VirtualProtect RX failed for gadget page');
    }

    return base;
  }

  /**
   * Build a syscall stub: allocate RW page, write the stub machine code,
   * protect to RX, and return the callable function decoded with the given
   * koffi C signature.
   */
  private buildStub<T extends (...args: any[]) => any>(
    ssn: number,
    sig: string,
  ): NativeCallable<T> {
    const page = Va()(null, STUB_PAGE, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (page === 0n || page === null || typeof page === 'undefined') {
      throw new Error('DirectSyscallInvoker: VirtualAlloc failed for stub page');
    }
    const base = page as unknown as bigint;
    allocatedPages.push(base);

    // Build the stub (same layout as SyscallStubBuilder):
    //   offset 0:  4C 8B D1          mov r10, rcx
    //   offset 3:  B8 XX XX XX XX    mov eax, SSN
    //   offset 8:  FF 25 02 00 00 00 jmp [rip+2]  → indirect jump through qword at offset 16
    //   offset 14: EB 00             jmp $+2       (filler, never executed)
    //   offset 16: <gadget addr>     qword pointer to syscall;ret
    const stub = Buffer.alloc(STUB_SIZE);
    stub[0] = 0x4c;
    stub[1] = 0x8b;
    stub[2] = 0xd1; // mov r10, rcx
    stub[3] = 0xb8; // mov eax, imm32
    stub.writeUInt32LE(ssn, 4);
    // jmp [rip+2] — FF /4 with ModRM=25, disp32=2
    stub[8] = 0xff;
    stub[9] = 0x25;
    stub[10] = 0x02;
    stub[11] = 0x00;
    stub[12] = 0x00;
    stub[13] = 0x00;
    // filler (2 bytes, never executed because jmp takes it)
    stub[14] = 0xeb;
    stub[15] = 0x00;
    // gadget address (8 bytes)
    stub.writeBigUInt64LE(this.gadgetAddr, 16);

    // Write stub to allocated page
    const self = Gcp()() as unknown as bigint;
    const wrote = Buffer.alloc(8);
    const wret = Wpm()(
      self,
      base,
      requireKoffi().address(stub),
      STUB_SIZE,
      requireKoffi().address(wrote),
    );
    if (!wret) {
      throw new Error('DirectSyscallInvoker: WriteProcessMemory failed for stub page');
    }

    // Protect to RX
    const old = Buffer.alloc(4);
    const pret = Vp()(base, STUB_PAGE, PAGE_EXECUTE_READ, requireKoffi().address(old));
    if (!pret) {
      throw new Error('DirectSyscallInvoker: VirtualProtect RX failed for stub page');
    }

    // Decode with the given signature — koffi creates a callable wrapper
    return requireKoffi().decode(base, sig) as unknown as NativeCallable<T>;
  }

  /** Build all needed stubs from the resolved SSN table. */
  private buildStubs(): void {
    const byName = this.resolved!.byName;

    const resolve = (name: string): number => {
      const entry = byName[name];
      if (!entry) throw new Error(`DirectSyscallInvoker: SSN not found for ${name}`);
      return entry.ssn;
    };

    this.ntOpenProcessStub = this.buildStub(resolve('NtOpenProcess'), SIG_NT_OPEN_PROCESS);
    this.ntReadVirtualMemoryStub = this.buildStub(
      resolve('NtReadVirtualMemory'),
      SIG_NT_READ_VIRTUAL_MEMORY,
    );
    this.ntWriteVirtualMemoryStub = this.buildStub(
      resolve('NtWriteVirtualMemory'),
      SIG_NT_WRITE_VIRTUAL_MEMORY,
    );
    this.ntAllocateVirtualMemoryStub = this.buildStub(
      resolve('NtAllocateVirtualMemory'),
      SIG_NT_ALLOCATE_VIRTUAL_MEMORY,
    );
    this.ntProtectVirtualMemoryStub = this.buildStub(
      resolve('NtProtectVirtualMemory'),
      SIG_NT_PROTECT_VIRTUAL_MEMORY,
    );
    this.ntFreeVirtualMemoryStub = this.buildStub(
      resolve('NtFreeVirtualMemory'),
      SIG_NT_FREE_VIRTUAL_MEMORY,
    );
    this.ntCloseStub = this.buildStub(resolve('NtClose'), SIG_NT_CLOSE);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Free all allocated pages (stubs + gadget). Call on shutdown. */
  destroy(): void {
    for (const p of allocatedPages) {
      try {
        Vf()(p, 0, MEM_RELEASE);
      } catch {
        // Best-effort cleanup
      }
    }
    allocatedPages.length = 0;
    this.initialized = false;
    this.ntOpenProcessStub = null;
    this.ntReadVirtualMemoryStub = null;
    this.ntWriteVirtualMemoryStub = null;
    this.ntAllocateVirtualMemoryStub = null;
    this.ntProtectVirtualMemoryStub = null;
    this.ntFreeVirtualMemoryStub = null;
    this.ntCloseStub = null;
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Build an OBJECT_ATTRIBUTES structure (x64) in a Buffer.
 * Layout: Length(0) RootDirectory(8) ObjectName(16) Attributes(24)
 * SecurityDescriptor(32) SecurityQualityOfService(40).
 * Size: 48 bytes.
 */
function buildObjectAttributes(attr: number, length = 48): Buffer {
  const oa = Buffer.alloc(length);
  oa.writeUInt32LE(length, 0);
  oa.writeUInt32LE(attr, 24);
  return oa;
}

// ── Singleton ────────────────────────────────────────────────────────────────

let invokerInstance: DirectSyscallInvoker | null = null;

/** Get or create the singleton DirectSyscallInvoker. */
export function getDirectSyscallInvoker(): DirectSyscallInvoker {
  if (!invokerInstance) {
    invokerInstance = new DirectSyscallInvoker();
  }
  return invokerInstance;
}

/** Reset the singleton (for testing). */
export function resetDirectSyscallInvoker(): void {
  if (invokerInstance) {
    invokerInstance.destroy();
    invokerInstance = null;
  }
}

// Re-export types
export type { NativeCallable };
