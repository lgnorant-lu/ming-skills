import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../koffi-loader';

let _ntdll: KoffiLibraryHandle | null = null;
function ntdll(): KoffiLibraryHandle {
  if (!_ntdll) _ntdll = requireKoffi().load('ntdll.dll');
  return _ntdll;
}

export function ntSuccess(s: number): boolean {
  return s >= 0;
}

// Lazy function resolvers

let _NtCreateThreadEx: KoffiCallable | null = null;
function getNtCTE() {
  if (!_NtCreateThreadEx) {
    _NtCreateThreadEx = ntdll().func(
      'int32 NtCreateThreadEx(_Out_ void **, uint32, _In_ void *, void *, _In_ void *, void *, uint32, uint32, ulonglong, ulonglong, _In_ void *)',
    );
  }
  return _NtCreateThreadEx;
}

let _NtAllocateVirtualMemory: KoffiCallable | null = null;
function getNtAVM() {
  if (!_NtAllocateVirtualMemory) {
    _NtAllocateVirtualMemory = ntdll().func(
      'int32 NtAllocateVirtualMemory(void *, _Inout_ void **, uint32, _Inout_ ulonglong *, uint32, uint32)',
    );
  }
  return _NtAllocateVirtualMemory;
}

let _NtWriteVirtualMemory: KoffiCallable | null = null;
function getNtWVM() {
  if (!_NtWriteVirtualMemory) {
    _NtWriteVirtualMemory = ntdll().func(
      'int32 NtWriteVirtualMemory(void *, _In_ void *, _In_ void *, ulonglong, _Out_ ulonglong *)',
    );
  }
  return _NtWriteVirtualMemory;
}

let _NtProtectVirtualMemory: KoffiCallable | null = null;
function getNtPVM() {
  if (!_NtProtectVirtualMemory) {
    _NtProtectVirtualMemory = ntdll().func(
      'int32 NtProtectVirtualMemory(void *, _Inout_ void **, _Inout_ ulonglong *, uint32, _Out_ uint32 *)',
    );
  }
  return _NtProtectVirtualMemory;
}

let _NtClose: KoffiCallable | null = null;
function getNtClose() {
  if (!_NtClose) _NtClose = ntdll().func('int32 NtClose(void *)');
  return _NtClose;
}

const MEM_COMMIT = 0x1000;
const MEM_RESERVE = 0x2000;

/**
 * NtCreateThreadEx ThreadDesiredAccess mask. Note: the Windows SDK defines
 * THREAD_ALL_ACCESS as 0x1F03FF; 0x1FFFFF is the PROCESS_ALL_ACCESS mask.
 * Passing the broader mask requests every thread access right at once, which
 * NtCreateThreadEx accepts; kept as-is for behavioral compatibility.
 */
const THREAD_DESIRED_ACCESS = 0x1fffff;

export function ntCreateThreadEx(
  hProcess: bigint,
  startAddr: bigint,
  param: bigint,
  flags = 0,
): { status: number; handle: bigint } {
  const handleBuf = Buffer.alloc(8);
  const status = getNtCTE()(
    requireKoffi().address(handleBuf),
    THREAD_DESIRED_ACCESS,
    null,
    hProcess,
    startAddr as unknown as bigint,
    param as unknown as bigint,
    flags,
    0,
    0n,
    0n,
    null,
  ) as number;
  return { status, handle: status >= 0 ? handleBuf.readBigUInt64LE(0) : 0n };
}

export function ntAllocateVirtualMemory(
  hProcess: bigint,
  size: number,
  protect: number,
): { status: number; address: bigint } {
  let addr = 0n;
  const addrBuf = Buffer.alloc(8);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const status = getNtAVM()(
    hProcess,
    requireKoffi().address(addrBuf),
    0,
    requireKoffi().address(sizeBuf),
    MEM_COMMIT | MEM_RESERVE,
    protect,
  ) as number;
  if (status >= 0) addr = addrBuf.readBigUInt64LE(0);
  return { status, address: addr };
}

export function ntWriteVirtualMemory(hProcess: bigint, targetAddr: bigint, data: Buffer): number {
  const wrote = Buffer.alloc(8);
  return getNtWVM()(
    hProcess,
    targetAddr as unknown as bigint,
    requireKoffi().address(data),
    BigInt(data.length),
    requireKoffi().address(wrote),
  ) as number;
}

export function ntProtectVirtualMemory(
  hProcess: bigint,
  addr: bigint,
  size: number,
  newProtect: number,
): { status: number; oldProtect: number } {
  const addrBuf = Buffer.alloc(8);
  addrBuf.writeBigUInt64LE(addr, 0);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(BigInt(size), 0);
  const oldBuf = Buffer.alloc(4);
  const status = getNtPVM()(
    hProcess,
    requireKoffi().address(addrBuf),
    requireKoffi().address(sizeBuf),
    newProtect,
    requireKoffi().address(oldBuf),
  ) as number;
  return { status, oldProtect: oldBuf.readUInt32LE(0) };
}

export function ntClose(handle: bigint): number {
  return getNtClose()(handle as unknown as bigint) as number;
}

export function ntCreateThreadExSafe(
  hProcess: bigint,
  startAddr: bigint,
  param: bigint,
  flags = 0,
): { status: number; handle: bigint } {
  return ntCreateThreadEx(hProcess, startAddr, param, flags);
}
