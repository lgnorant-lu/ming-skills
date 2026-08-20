import type { HostFunction } from '../host-context';

/** Runtime capabilities required by the complete bionic symbol set. */
export interface BionicRuntime {
  mapMemory(addr: number, size: number): void;
  lookupSymbol(name: string): number | undefined;
  bindImportStub(name: string, fn: HostFunction): number;
  callGuestFunction(address: number, args?: readonly bigint[]): number;
}

/** @deprecated Use BionicRuntime. */
export type BionicMemoryMapper = BionicRuntime;

export interface BionicStubAddresses {
  strlen?: number;
  memcpy?: number;
  memset?: number;
  malloc?: number;
  free?: number;
}

export interface BionicOptions {
  /** Override the heap base for malloc/calloc/realloc (default 0x100000). */
  heapBase?: number;
  files?: Map<string, Uint8Array>;
  onLog?: (priority: number, tag: string, message: string) => void;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onAssetOpen?: (path: string) => Uint8Array | null;
  onSystemPropertyGet?: (name: string) => string | null;
  onSyscall?: (
    num: number,
    arg0: bigint,
    arg1: bigint,
    arg2: bigint,
    arg3: bigint,
    arg4: bigint,
    arg5: bigint,
  ) => bigint | undefined;
  /** Extra symbol→address mappings for dlsym resolution (e.g. VM handler addresses not in .dynsym). */
  extraSymbols?: Map<string, number>;
}

export type BionicAllocator = (size: number) => number;
export type BionicAlignedAllocator = (size: number, alignment: number) => number;
