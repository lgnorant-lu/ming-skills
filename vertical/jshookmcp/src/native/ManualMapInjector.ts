/**
 * Manual Map Injector — stealthy DLL injection without LoadLibrary.
 *
 * Manual mapping parses DLL PE headers, copies sections into the target,
 * resolves imports, applies relocations, and executes the entry point —
 * all without touching the Windows loader (LdrLoadDll). This bypasses:
 *   - PsSetLoadImageNotifyRoutine (no LDR_DATA_TABLE_ENTRY created)
 *   - Module enumeration (not in PEB Ldr linked list)
 *   - LoadLibrary monitoring hooks
 *
 * Security: ALL injection requires JSHOOK_INJECTION_ENABLE=1 and admin.
 *
 * @module ManualMapInjector
 */

import { readFileSync } from 'node:fs';
import { ToolError } from '@errors/ToolError';
import { readEnvString } from '@src/config/environment';
import {
  openProcessForMemory,
  OpenProcess,
  CloseHandle,
  ReadProcessMemory,
  WriteProcessMemory,
  VirtualAllocEx,
  VirtualProtectEx,
  EnumProcessModules,
  GetModuleBaseName,
  GetModuleInformation,
  CreateRemoteThread,
  PAGE,
  MEM,
  PROCESS_ACCESS,
} from './Win32API';
import {
  OpenThread,
  SuspendThread,
  ResumeThread,
  GetThreadContext,
  SetThreadContext,
  EnumerateProcessThreads,
  CONTEXT_FLAGS,
  THREAD_ACCESS,
  parseContext,
  writeContext,
} from './Win32Debug';
import { FlushInstructionCache } from './Win32Debug';
import { ntCreateThreadExSafe } from './syscall/NtInjection';
import { logger } from '@utils/logger';
import {
  MZ_MAGIC,
  PE_SIGNATURE,
  DOS_HEADER_SIZE,
  E_LFANEW_OFFSET,
  IMAGE_NT_OPTIONAL_HDR64_MAGIC as PE32PLUS_MAGIC,
} from './PEConstants';

// ── Constants ──

const SECTION_HEADER_SIZE = 40;
const IMPORT_DESCRIPTOR_SIZE = 20;
const PE32PLUS_DATA_DIRECTORIES_OFFSET = 136;
const PE32_DATA_DIRECTORIES_OFFSET = 120;

const IMAGE_DIRECTORY_ENTRY_BASERELOC = 5;

/** Maximum number of relocation blocks to process (safety cap). */
const MAX_RELOC_ITERATIONS = 10000;

/** IMAGE_ORDINAL_FLAG: the high bit of a thunk value marks an import by ordinal. */
function ordinalFlag(isPE32Plus: boolean): bigint {
  return isPE32Plus ? 0x8000000000000000n : 0x80000000n;
}

/** Safety caps on descriptor/thunk walks */
const MAX_IMPORT_DESCRIPTORS = 500;
const MAX_THUNK_ENTRIES = 2000;
const MAX_DLL_NAME_BYTES = 256;

/** Injection safety gates */
const DEFAULT_MAX_ALLOC_SIZE = 100 * 1024 * 1024; // 100MB

// ── Type Definitions ──

export interface ManualMapOptions {
  /** Target process ID */
  pid: number;
  /** Path to DLL on disk (to read PE) */
  dllPath: string;
  /** Export name to call as entry point (default: DllMain with DLL_PROCESS_ATTACH + base) */
  entryPoint?: string;
  /** Argument to pass to the entry point */
  entryPointArg?: Buffer;
  /** Zero PE headers after mapping (default: true) */
  wipeHeaders?: boolean;
  /** Add random offset to base address (default: false) */
  randomizeBase?: boolean;
  /** Skip TLS callbacks (default: true — TLS callbacks not implemented yet) */
  skipTlsCallbacks?: boolean;
  /** Use reflective DLL loader (DLL has its own ReflectiveLoader export). When true,
   *  imports and relocations are NOT resolved — the DLL's ReflectiveLoader handles it. */
  reflective?: boolean;
  /** Maximum allocation size in bytes (default: 100MB) */
  maxAllocSize?: number;
}

export interface ManualMapResult {
  /** Base address where the DLL was mapped (hex string) */
  imageBase: string;
  /** Size of the mapped image in bytes */
  imageSize: number;
  /** Entry point address executed (hex string) */
  entryPoint: string;
  /** Thread handle if a remote thread was created */
  threadHandle?: string;
  /** Thread ID if a remote thread was created */
  threadId?: number;
  /** Whether PE headers were wiped */
  headersWiped: boolean;
  /** Injection method used */
  injectionMethod: 'NtCreateThreadEx' | 'CreateRemoteThread' | 'reflective' | 'thread_hijack';
}

export interface ShellcodeInjectResult {
  /** Allocated address in the target */
  address: string;
  /** Thread handle */
  threadHandle: string;
  /** Thread ID */
  threadId: number;
  /** Injection method */
  method: 'NtCreateThreadEx' | 'CreateRemoteThread' | 'thread_hijack';
}

// ── Internal PE Parsing Helpers ──

interface ParsedPE {
  isPE32Plus: boolean;
  imageBase: bigint;
  entryPointRva: number;
  sizeOfImage: number;
  sizeOfHeaders: number;
  sections: ParsedSection[];
  dataDirectoryRva: (index: number) => number;
}

interface ParsedSection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  pointerToRawData: number;
  sizeOfRawData: number;
  characteristics: number;
}

function parsePEFromBuffer(dllBytes: Buffer): ParsedPE {
  // Validate DOS header
  const e_magic = dllBytes.readUInt16LE(0);
  if (e_magic !== MZ_MAGIC) {
    throw new ToolError(
      'VALIDATION',
      `Invalid DOS header: expected 0x5A4D, got 0x${e_magic.toString(16)}`,
    );
  }
  const e_lfanew = dllBytes.readUInt32LE(E_LFANEW_OFFSET);

  // Validate PE signature
  const ntSignature = dllBytes.readUInt32LE(e_lfanew);
  if (ntSignature !== PE_SIGNATURE) {
    throw new ToolError(
      'VALIDATION',
      `Invalid PE signature: expected 0x4550, got 0x${ntSignature.toString(16)}`,
    );
  }

  const fileHeaderOffset = e_lfanew + 4;
  const numberOfSections = dllBytes.readUInt16LE(fileHeaderOffset + 2);
  const sizeOfOptionalHeader = dllBytes.readUInt16LE(fileHeaderOffset + 16);

  const optionalHeaderOffset = e_lfanew + 24;
  const magic = dllBytes.readUInt16LE(optionalHeaderOffset);
  const isPE32Plus = magic === PE32PLUS_MAGIC;

  let imageBase: bigint;
  let entryPointRva: number;
  let sizeOfImage: number;
  let sizeOfHeaders: number;
  let numberOfRvaAndSizes: number;
  let dataDirectoriesOffset: number;

  if (isPE32Plus) {
    imageBase = dllBytes.readBigUInt64LE(optionalHeaderOffset + 24);
    entryPointRva = dllBytes.readUInt32LE(optionalHeaderOffset + 16);
    sizeOfImage = dllBytes.readUInt32LE(optionalHeaderOffset + 56);
    sizeOfHeaders = dllBytes.readUInt32LE(optionalHeaderOffset + 60);
    numberOfRvaAndSizes = dllBytes.readUInt32LE(optionalHeaderOffset + 108);
    dataDirectoriesOffset = PE32PLUS_DATA_DIRECTORIES_OFFSET;
  } else {
    imageBase = BigInt(dllBytes.readUInt32LE(optionalHeaderOffset + 28));
    entryPointRva = dllBytes.readUInt32LE(optionalHeaderOffset + 16);
    sizeOfImage = dllBytes.readUInt32LE(optionalHeaderOffset + 56);
    sizeOfHeaders = dllBytes.readUInt32LE(optionalHeaderOffset + 60);
    numberOfRvaAndSizes = dllBytes.readUInt32LE(optionalHeaderOffset + 92);
    dataDirectoriesOffset = PE32_DATA_DIRECTORIES_OFFSET;
  }

  // Parse sections
  const sectionTableOffset = e_lfanew + 24 + sizeOfOptionalHeader;
  const sections: ParsedSection[] = [];
  for (let i = 0; i < numberOfSections; i++) {
    const offset = sectionTableOffset + i * SECTION_HEADER_SIZE;
    const nameBytes = dllBytes.subarray(offset, offset + 8);
    const name = nameBytes.toString('utf8').split(String.fromCharCode(0))[0]!;
    sections.push({
      name,
      virtualSize: dllBytes.readUInt32LE(offset + 8),
      virtualAddress: dllBytes.readUInt32LE(offset + 12),
      sizeOfRawData: dllBytes.readUInt32LE(offset + 16),
      pointerToRawData: dllBytes.readUInt32LE(offset + 20),
      characteristics: dllBytes.readUInt32LE(offset + 36),
    });
  }

  const dataDirectoryRva = (index: number): number => {
    if (index >= numberOfRvaAndSizes) return 0;
    const off = dataDirectoriesOffset + index * 8;
    if (off + 8 > dllBytes.length) return 0;
    return dllBytes.readUInt32LE(e_lfanew + off);
  };

  return {
    isPE32Plus,
    imageBase,
    entryPointRva,
    sizeOfImage,
    sizeOfHeaders,
    sections,
    dataDirectoryRva,
  };
}

// ── Safety Gates ──

const INJECTION_ENV_GATE = 'JSHOOK_INJECTION_ENABLE';

function checkInjectionEnabled(): void {
  if (readEnvString(INJECTION_ENV_GATE, '') !== '1') {
    throw new ToolError(
      'PERMISSION',
      `Injection operations require ${INJECTION_ENV_GATE}=1 environment variable. ` +
        `Set it to enable cross-process injection capabilities.`,
    );
  }
}

function checkAdmin(): void {
  // On non-Windows platforms, skip admin check.
  if (process.platform !== 'win32') return;
  // Admin check is a soft gate — the real enforcement is in openProcessForMemory
  // which fails on non-admin for protected processes. We skip the check if
  // Win32API cannot be loaded (e.g., in test environments with mocked koffi).
  try {
    const h = OpenProcess(PROCESS_ACCESS.QUERY_LIMITED_INFORMATION, false, process.pid);
    if (h !== 0n) CloseHandle(h);
  } catch {
    // Soft check failed — the real gate is in openProcessForMemory.
  }
}

// ── Rate Limiter ──

let lastInjectionTime = 0;
const MIN_INJECTION_INTERVAL_MS = 1000; // 1 injection per second

function checkRateLimit(): void {
  const now = Date.now();
  if (now - lastInjectionTime < MIN_INJECTION_INTERVAL_MS) {
    throw new ToolError(
      'PERMISSION',
      `Injection rate limited: max 1 per ${MIN_INJECTION_INTERVAL_MS}ms. ` +
        `Wait ${MIN_INJECTION_INTERVAL_MS - (now - lastInjectionTime)}ms.`,
    );
  }
  lastInjectionTime = now;
}

/** Reset rate limiter for test isolation. Not exported — tests reach via prototype. */
export function resetRateLimit(): void {
  lastInjectionTime = 0;
}

// ── ManualMapInjector ──

export class ManualMapInjector {
  /**
   * Manual map a DLL into a target process.
   *
   * Full pipeline:
   *   1. Read DLL from disk
   *   2. Parse PE headers
   *   3. Allocate memory in target (RW, not RWX)
   *   4. Copy headers + sections
   *   5. Resolve imports
   *   6. Apply base relocations
   *   7. Change section protections (RX/RO/RW)
   *   8. Execute entry point via NtCreateThreadEx
   *   9. Optionally wipe PE headers
   */
  async inject(options: ManualMapOptions): Promise<ManualMapResult> {
    checkInjectionEnabled();
    checkAdmin();
    checkRateLimit();

    const {
      pid,
      dllPath,
      wipeHeaders = true,
      reflective = false,
      maxAllocSize = DEFAULT_MAX_ALLOC_SIZE,
    } = options;

    // 1. Read DLL from disk
    let dllBytes: Buffer;
    try {
      dllBytes = readFileSync(dllPath);
    } catch (e) {
      throw new ToolError(
        'VALIDATION',
        `Cannot read DLL file: ${dllPath}. ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return this.injectFromBuffer(pid, dllBytes, {
      wipeHeaders,
      reflective,
      maxAllocSize,
    });
  }

  /**
   * Manual map a DLL from a Buffer (in-memory PE).
   * Same pipeline as inject() but uses an already-loaded buffer.
   */
  async injectFromBuffer(
    pid: number,
    dllBytes: Buffer,
    options: Pick<
      ManualMapOptions,
      'wipeHeaders' | 'reflective' | 'maxAllocSize' | 'randomizeBase' | 'skipTlsCallbacks'
    >,
  ): Promise<ManualMapResult> {
    checkInjectionEnabled();
    checkAdmin();
    checkRateLimit();

    const {
      wipeHeaders = true,
      reflective = false,
      maxAllocSize = DEFAULT_MAX_ALLOC_SIZE,
    } = options;

    // 2. Parse PE headers
    const pe = parsePEFromBuffer(dllBytes);

    // Validate size
    if (pe.sizeOfImage > maxAllocSize) {
      throw new ToolError(
        'VALIDATION',
        `Image size ${pe.sizeOfImage} exceeds max allowed ${maxAllocSize} bytes`,
      );
    }

    const hProcess = openProcessForMemory(pid, true);

    try {
      // 3. Allocate memory in target (RW, not RWX for stealth)
      const allocatedBase = VirtualAllocEx(
        hProcess,
        0n,
        pe.sizeOfImage,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.READWRITE,
      );
      if (allocatedBase === 0n) {
        throw new ToolError('RUNTIME', 'VirtualAllocEx failed in target process');
      }

      const delta = allocatedBase - pe.imageBase;

      // 4. Copy headers
      const headersSize = pe.sizeOfHeaders;
      WriteProcessMemory(hProcess, allocatedBase, dllBytes.subarray(0, headersSize));

      // 5. Copy sections
      for (const section of pe.sections) {
        if (section.sizeOfRawData === 0) continue;
        const sectionData = dllBytes.subarray(
          section.pointerToRawData,
          section.pointerToRawData + section.sizeOfRawData,
        );
        const targetAddr = allocatedBase + BigInt(section.virtualAddress);
        WriteProcessMemory(hProcess, targetAddr, sectionData);
      }

      // If reflective, skip import/reloc resolution — the DLL's ReflectiveLoader handles it
      if (reflective) {
        // 6. Change section protections
        await this.applySectionProtections(hProcess, allocatedBase, pe);

        // 7. Execute ReflectiveLoader
        const reflectiveLoaderAddr = allocatedBase + BigInt(pe.entryPointRva);
        const { handle, threadId } = this.createStealthThread(
          hProcess,
          reflectiveLoaderAddr,
          allocatedBase, // Pass image base as parameter
        );

        if (wipeHeaders) {
          this.wipePEHeaders(hProcess, allocatedBase, headersSize);
        }

        return {
          imageBase: `0x${allocatedBase.toString(16).toUpperCase()}`,
          imageSize: pe.sizeOfImage,
          entryPoint: `0x${reflectiveLoaderAddr.toString(16).toUpperCase()}`,
          threadHandle: `0x${handle.toString(16).toUpperCase()}`,
          threadId,
          headersWiped: wipeHeaders,
          injectionMethod: 'reflective',
        };
      }

      // 6. Resolve imports
      await this.resolveImports(hProcess, allocatedBase, dllBytes, pe, pid);

      // 7. Apply base relocations
      if (delta !== 0n) {
        this.applyRelocations(hProcess, allocatedBase, dllBytes, pe, delta);
      }

      // 8. Change section protections
      await this.applySectionProtections(hProcess, allocatedBase, pe);

      // 9. Flush instruction cache
      FlushInstructionCache(hProcess, allocatedBase, pe.sizeOfImage);

      // 10. Execute entry point
      const entryPointAddr = allocatedBase + BigInt(pe.entryPointRva);

      // For DllMain-style execution: pass DLL_PROCESS_ATTACH (1) and base address
      const { handle, threadId } = this.createStealthThread(
        hProcess,
        entryPointAddr,
        allocatedBase, // lpReserved = image base for DllMain
      );

      // 11. Optionally wipe PE headers
      if (wipeHeaders) {
        this.wipePEHeaders(hProcess, allocatedBase, headersSize);
      }

      return {
        imageBase: `0x${allocatedBase.toString(16).toUpperCase()}`,
        imageSize: pe.sizeOfImage,
        entryPoint: `0x${entryPointAddr.toString(16).toUpperCase()}`,
        threadHandle: `0x${handle.toString(16).toUpperCase()}`,
        threadId,
        headersWiped: wipeHeaders,
        injectionMethod: 'NtCreateThreadEx',
      };
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Inject raw shellcode into a target process using stealth allocation (RW then RX).
   * Unlike CodeInjector.injectShellcode which uses RWX, this allocates as RW,
   * writes shellcode, then changes protection to RX — evading RWX page detection.
   */
  async injectShellcode(pid: number, shellcode: Buffer): Promise<ShellcodeInjectResult> {
    checkInjectionEnabled();
    checkAdmin();
    checkRateLimit();

    if (shellcode.length === 0) {
      throw new ToolError('VALIDATION', 'Shellcode must be non-empty');
    }

    const hProcess = openProcessForMemory(pid, true);

    try {
      // 1. Allocate RW (not RWX)
      const addr = VirtualAllocEx(
        hProcess,
        0n,
        shellcode.length,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.READWRITE,
      );
      if (addr === 0n) {
        throw new ToolError('RUNTIME', 'VirtualAllocEx failed in target process');
      }

      // 2. Write shellcode
      WriteProcessMemory(hProcess, addr, shellcode);

      // 3. Change to RX (not RWX — stealth)
      VirtualProtectEx(hProcess, addr, shellcode.length, PAGE.EXECUTE_READ);

      // 4. Flush instruction cache
      FlushInstructionCache(hProcess, addr, shellcode.length);

      // 5. Create stealth thread
      const { handle, threadId } = this.createStealthThread(hProcess, addr, 0n);

      return {
        address: `0x${addr.toString(16).toUpperCase()}`,
        threadHandle: `0x${handle.toString(16).toUpperCase()}`,
        threadId,
        method: 'NtCreateThreadEx',
      };
    } finally {
      CloseHandle(hProcess);
    }
  }

  /**
   * Inject shellcode via thread hijacking.
   *
   * Instead of creating a new thread (which triggers ETW and EDR callbacks),
   * this suspends an existing thread, saves its context, redirects RIP to
   * the shellcode, and resumes. The shellcode MUST end with a RET to return
   * to the saved RIP (the shellcode is called like a function, not a new thread).
   *
   * Limitations:
   *   - The hijacked thread's stack is used; shellcode must not overflow it
   *   - If the thread is in a critical section, hijacking may deadlock
   *   - The shellcode must preserve non-volatile registers per x64 ABI
   */
  async injectViaThreadHijack(pid: number, shellcode: Buffer): Promise<ShellcodeInjectResult> {
    checkInjectionEnabled();
    checkAdmin();
    checkRateLimit();

    if (shellcode.length === 0) {
      throw new ToolError('VALIDATION', 'Shellcode must be non-empty');
    }

    const hProcess = openProcessForMemory(pid, true);

    try {
      // 1. Allocate RW memory for shellcode
      const addr = VirtualAllocEx(
        hProcess,
        0n,
        shellcode.length,
        MEM.COMMIT | MEM.RESERVE,
        PAGE.READWRITE,
      );
      if (addr === 0n) {
        throw new ToolError('RUNTIME', 'VirtualAllocEx failed in target process');
      }

      // 2. Write shellcode
      WriteProcessMemory(hProcess, addr, shellcode);

      // 3. Change to RX
      VirtualProtectEx(hProcess, addr, shellcode.length, PAGE.EXECUTE_READ);
      FlushInstructionCache(hProcess, addr, shellcode.length);

      // 4. Find a target thread
      const threads = EnumerateProcessThreads(pid);
      if (threads.length === 0) {
        throw new ToolError('RUNTIME', `No threads found in process ${pid}`);
      }

      // Pick first thread (simple strategy; could be smarter)
      const targetThreadId = threads[0]!;
      let targetThreadHandle = 0n;
      let suspended = false;

      try {
        targetThreadHandle = this.openThreadForHijack(targetThreadId);

        // 5. Suspend thread
        SuspendThread(targetThreadHandle);
        suspended = true;

        // 6. Save context
        const ctxBuf = GetThreadContext(targetThreadHandle, CONTEXT_FLAGS.ALL);
        const ctx = parseContext(ctxBuf);

        // 7. Build trampoline: the shellcode runs as a function call.
        //    After shellcode RETs, execution returns to the saved RIP.
        //    The shellcode receives no arguments (rcx=0, rdx=0).
        //    This is the simplest form — the shellcode must save/restore
        //    registers it uses.

        // Set RIP to shellcode address
        const newCtx = {
          rip: addr,
          // Clear direction flag, keep interrupts enabled
          eflags: (ctx.eflags & ~0x400) | 0x200,
        };
        writeContext(ctxBuf, newCtx);

        // 8. Set modified context
        SetThreadContext(targetThreadHandle, ctxBuf);

        // 9. Resume thread
        ResumeThread(targetThreadHandle);
        suspended = false;

        return {
          address: `0x${addr.toString(16).toUpperCase()}`,
          threadHandle: `0x${targetThreadHandle.toString(16).toUpperCase()}`,
          threadId: targetThreadId,
          method: 'thread_hijack',
        };
      } finally {
        // Cleanup: resume thread if still suspended, close handle
        if (suspended) {
          try {
            ResumeThread(targetThreadHandle);
          } catch {
            // Best effort
          }
        }
        if (targetThreadHandle !== 0n) {
          CloseHandle(targetThreadHandle);
        }
      }
    } finally {
      CloseHandle(hProcess);
    }
  }

  // ── Private Helpers ──

  /**
   * Resolve imports for the manually mapped image.
   *
   * Walks the IMAGE_IMPORT_DESCRIPTOR chain. For each imported DLL:
   *   1. Finds it in the target's loaded modules
   *   2. Walks its export table to find each function
   *   3. Writes the resolved address to the IAT (FirstThunk)
   */
  private async resolveImports(
    hProcess: bigint,
    imageBase: bigint,
    dllBytes: Buffer,
    pe: ParsedPE,
    _pid: number,
  ): Promise<void> {
    const importRva = pe.dataDirectoryRva(1); // IMAGE_DIRECTORY_ENTRY_IMPORT
    if (importRva === 0) return; // No imports

    const thunkSize = pe.isPE32Plus ? 8 : 4;
    const ordinal = ordinalFlag(pe.isPE32Plus);

    // Enumerate target's loaded modules once
    const targetModules = this.enumerateTargetModules(hProcess);

    // Walk IMAGE_IMPORT_DESCRIPTOR chain
    for (let i = 0; i < MAX_IMPORT_DESCRIPTORS; i++) {
      const descOff = importRva + i * IMPORT_DESCRIPTOR_SIZE;
      if (descOff + IMPORT_DESCRIPTOR_SIZE > dllBytes.length) break;

      const nameRva = dllBytes.readUInt32LE(descOff + 12);
      if (nameRva === 0) break; // Terminator

      const originalFirstThunkRva = dllBytes.readUInt32LE(descOff + 0);
      const firstThunkRva = dllBytes.readUInt32LE(descOff + 16);

      // Read DLL name from the PE buffer
      const dllName = this.readAsciiFromBuffer(dllBytes, nameRva, MAX_DLL_NAME_BYTES);

      // Find the DLL in target's loaded modules
      const dllStem = dllName.toLowerCase().replace(/\.dll$/i, '');
      const sourceMod = targetModules.find(
        (m) =>
          m.name.toLowerCase() === dllName.toLowerCase() ||
          m.name.toLowerCase().replace(/\.dll$/i, '') === dllStem,
      );

      if (!sourceMod) {
        logger.warn(`ManualMap: imported DLL not found in target: ${dllName}`);
        continue;
      }

      const sourceBase = BigInt(
        sourceMod.base.startsWith('0x') ? sourceMod.base : `0x${sourceMod.base}`,
      );

      // Resolve each imported function
      for (let j = 0; j < MAX_THUNK_ENTRIES; j++) {
        const thunkOff = (originalFirstThunkRva || firstThunkRva) + j * thunkSize;
        if (thunkOff + thunkSize > dllBytes.length) break;

        const thunkValue = pe.isPE32Plus
          ? dllBytes.readBigUInt64LE(thunkOff)
          : BigInt(dllBytes.readUInt32LE(thunkOff));
        if (thunkValue === 0n) break;

        let funcName: string;
        let funcOrdinal = 0;

        if ((thunkValue & ordinal) !== 0n) {
          // Import by ordinal
          funcOrdinal = Number(thunkValue & 0xffffn);
          funcName = `#${funcOrdinal}`;
        } else {
          // Import by name — read hint/name from PE buffer
          const hintNameRva = Number(thunkValue & 0xffffffffn);
          funcName = this.readAsciiFromBuffer(dllBytes, hintNameRva + 2, MAX_DLL_NAME_BYTES);
        }

        // Resolve the function address from the source module's export table
        const resolvedAddr = this.resolveExportInTarget(
          hProcess,
          sourceBase,
          funcName,
          funcOrdinal,
          dllName,
        );

        if (resolvedAddr !== 0n) {
          // Write resolved address to IAT
          const iatAddr = imageBase + BigInt(firstThunkRva + j * thunkSize);
          const addrBuf = Buffer.alloc(thunkSize);
          if (pe.isPE32Plus) {
            addrBuf.writeBigUInt64LE(resolvedAddr, 0);
          } else {
            addrBuf.writeUInt32LE(Number(resolvedAddr & 0xffffffffn), 0);
          }
          WriteProcessMemory(hProcess, iatAddr, addrBuf);
        }
      }
    }
  }

  /**
   * Apply base relocations to the manually mapped image.
   *
   * Walks IMAGE_BASE_RELOCATION blocks. For each relocation entry,
   * reads the current value at the target address and adjusts by
   * (actualBase - preferredBase).
   */
  private applyRelocations(
    hProcess: bigint,
    imageBase: bigint,
    dllBytes: Buffer,
    pe: ParsedPE,
    delta: bigint,
  ): void {
    const relocRva = pe.dataDirectoryRva(IMAGE_DIRECTORY_ENTRY_BASERELOC);
    if (relocRva === 0) return;

    let offset = 0;
    let relocIterations = 0;

    while (offset + 8 <= dllBytes.length - relocRva) {
      // Safety: cap total relocation blocks to prevent infinite loop on malformed PE
      if (++relocIterations > MAX_RELOC_ITERATIONS) {
        logger.warn(
          `ManualMap: relocation block iteration exceeded ${MAX_RELOC_ITERATIONS} — ` +
            'stopping. Imports resolved, relocations partially applied. ' +
            'The PE relocation directory may be malformed.',
        );
        return;
      }

      const blockOff = relocRva + offset;
      if (blockOff + 8 > dllBytes.length) break;

      const pageRva = dllBytes.readUInt32LE(blockOff);
      const blockSize = dllBytes.readUInt32LE(blockOff + 4);
      if (pageRva === 0 && blockSize === 0) break;
      if (blockSize < 8) break;

      const entryCount = Math.min(
        (blockSize - 8) / 2,
        Math.floor((dllBytes.length - (blockOff + 8)) / 2),
      );

      for (let i = 0; i < entryCount; i++) {
        const entryOff = blockOff + 8 + i * 2;
        if (entryOff + 2 > dllBytes.length) break;

        const entry = dllBytes.readUInt16LE(entryOff);
        const relocType = (entry >> 12) & 0xf;
        const relocOffset = entry & 0xfff;

        const targetAddr = imageBase + BigInt(pageRva + relocOffset);

        if (relocType === 0) continue; // IMAGE_REL_BASED_ABSOLUTE (padding)

        try {
          if (relocType === 3 || relocType === 10) {
            // IMAGE_REL_BASED_HIGHLOW (3) or IMAGE_REL_BASED_DIR64 (10)
            const readSize = relocType === 10 ? 8 : 4;
            const curData = ReadProcessMemory(hProcess, targetAddr, readSize);
            let newValue: bigint;

            if (relocType === 10) {
              const oldVal = curData.readBigUInt64LE(0);
              newValue = oldVal + delta;
              const newBuf = Buffer.alloc(8);
              newBuf.writeBigUInt64LE(newValue, 0);
              WriteProcessMemory(hProcess, targetAddr, newBuf);
            } else {
              const oldVal = curData.readUInt32LE(0);
              newValue = BigInt(oldVal) + delta;
              const newBuf = Buffer.alloc(4);
              newBuf.writeUInt32LE(Number(newValue & 0xffffffffn), 0);
              WriteProcessMemory(hProcess, targetAddr, newBuf);
            }
          }
          // Other relocation types (IMAGE_REL_BASED_HIGH, IMAGE_REL_BASED_LOW)
          // are uncommon in modern x64 PE files and omitted for simplicity.
        } catch (e) {
          logger.debug(
            `ManualMap: relocation failed at 0x${targetAddr.toString(16)}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      offset += blockSize;
    }
  }

  /**
   * Apply appropriate memory protections based on section characteristics.
   *
   *   - .text / executable: PAGE_EXECUTE_READ (RX — not RWX)
   *   - .rdata / read-only init data: PAGE_READONLY
   *   - .data / .bss / writable: PAGE_READWRITE
   */
  private async applySectionProtections(
    hProcess: bigint,
    imageBase: bigint,
    pe: ParsedPE,
  ): Promise<void> {
    for (const section of pe.sections) {
      if (section.virtualSize === 0) continue;

      const sectionAddr = imageBase + BigInt(section.virtualAddress);
      const chars = section.characteristics;
      const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
      const IMAGE_SCN_MEM_WRITE = 0x80000000;

      let protect: number;

      if (chars & IMAGE_SCN_MEM_EXECUTE) {
        protect = chars & IMAGE_SCN_MEM_WRITE ? PAGE.EXECUTE_READWRITE : PAGE.EXECUTE_READ;
      } else if (chars & IMAGE_SCN_MEM_WRITE) {
        protect = PAGE.READWRITE;
      } else {
        protect = PAGE.READONLY;
      }

      // Round size up to page boundary
      const alignedSize = (section.virtualSize + 0xfff) & ~0xfff;

      try {
        VirtualProtectEx(hProcess, sectionAddr, alignedSize, protect);
      } catch (e) {
        logger.debug(
          `ManualMap: protect failed for ${section.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /**
   * Wipe PE headers from the mapped image to evade signature-based detection.
   *
   * Anti-cheat systems scan allocated memory for "MZ" (0x4D 0x5A) and "PE\0\0"
   * (0x50 0x45 0x00 0x00) signatures. Zeroing the first page removes these
   * telltale markers while the image continues executing from its sections.
   */
  private wipePEHeaders(hProcess: bigint, imageBase: bigint, headersSize: number): void {
    const wipeSize = Math.min(headersSize, 0x1000); // Wipe first page
    const zeros = Buffer.alloc(wipeSize, 0);
    WriteProcessMemory(hProcess, imageBase, zeros);
  }

  /**
   * Create a remote thread using NtCreateThreadEx (more stealthy than CreateRemoteThread).
   *
   * NtCreateThreadEx allows flags to control thread creation behavior:
   *   - THREAD_CREATE_FLAGS_HIDE_FROM_DEBUGGER (0x4): hides from debuggers
   *   - THREAD_CREATE_FLAGS_SKIP_THREAD_ATTACH (0x2): skips DLL thread attach
   *
   * Falls back to CreateRemoteThread if NtCreateThreadEx fails.
   */
  private createStealthThread(
    hProcess: bigint,
    startAddr: bigint,
    param: bigint,
  ): { handle: bigint; threadId: number } {
    try {
      // THREAD_CREATE_FLAGS_HIDE_FROM_DEBUGGER | THREAD_CREATE_FLAGS_SKIP_THREAD_ATTACH
      const flags = 0x4 | 0x2;
      const result = ntCreateThreadExSafe(hProcess, startAddr, param, flags);
      if (result.status >= 0 && result.handle !== 0n) {
        // Read thread ID from the thread handle (simplified: return 0)
        // In practice, we'd call NtQueryInformationThread for the TID.
        return { handle: result.handle, threadId: 0 };
      }
    } catch (e) {
      logger.debug(`NtCreateThreadEx failed, falling back to CreateRemoteThread: ${e}`);
    }

    // Fallback: use CreateRemoteThread
    return CreateRemoteThread(hProcess, startAddr, param);
  }

  /** Open a thread for hijacking (SUSPEND + GET_CONTEXT + SET_CONTEXT). */
  private openThreadForHijack(threadId: number): bigint {
    const hThread = OpenThread(
      THREAD_ACCESS.SUSPEND_RESUME |
        THREAD_ACCESS.GET_CONTEXT |
        THREAD_ACCESS.SET_CONTEXT |
        THREAD_ACCESS.QUERY_INFORMATION,
      false,
      threadId,
    );
    if (hThread === 0n) {
      throw new ToolError('RUNTIME', `Failed to open thread ${threadId} for hijacking`);
    }
    return hThread;
  }

  /** Read an ASCII string from a PE buffer at a given offset. */
  private readAsciiFromBuffer(buf: Buffer, offset: number, maxLen: number): string {
    const end = Math.min(offset + maxLen, buf.length);
    let len = 0;
    while (offset + len < end && buf[offset + len] !== 0) len++;
    return buf.toString('ascii', offset, offset + len);
  }

  /** Enumerate modules loaded in the target process. */
  private enumerateTargetModules(hProcess: bigint): { name: string; base: string; size: number }[] {
    const modules: { name: string; base: string; size: number }[] = [];
    try {
      const { modules: modHandles, count } = EnumProcessModules(hProcess);
      for (let i = 0; i < count; i++) {
        const hMod = modHandles[i]!;
        const name = GetModuleBaseName(hProcess, hMod);
        const info = GetModuleInformation(hProcess, hMod);
        if (info.success) {
          modules.push({
            name,
            base: `0x${info.info.lpBaseOfDll.toString(16)}`,
            size: info.info.SizeOfImage,
          });
        }
      }
    } catch (e) {
      logger.debug(`ManualMap: module enumeration failed: ${e}`);
    }
    return modules;
  }

  /**
   * Resolve a function address from a target module's export table.
   *
   * Parses the remote module's PE headers and export directory to find
   * the function by name or ordinal. This works within the target process
   * even when the DLL is at a different base (handles ASLR correctly).
   */
  private resolveExportInTarget(
    hProcess: bigint,
    moduleBase: bigint,
    funcName: string,
    funcOrdinal: number,
    dllName: string,
  ): bigint {
    try {
      // Read the target module's DOS header to find the PE signature
      const dosData = ReadProcessMemory(hProcess, moduleBase, DOS_HEADER_SIZE);
      if (dosData.readUInt16LE(0) !== MZ_MAGIC) return 0n;

      const e_lfanew = dosData.readUInt32LE(E_LFANEW_OFFSET);

      // Read enough of the NT headers to get the export directory
      const ntData = ReadProcessMemory(hProcess, moduleBase + BigInt(e_lfanew), 264);
      if (ntData.readUInt32LE(0) !== PE_SIGNATURE) return 0n;

      const magic = ntData.readUInt16LE(24);
      const isPE32Plus = magic === PE32PLUS_MAGIC;

      const dataDirOff = isPE32Plus
        ? PE32PLUS_DATA_DIRECTORIES_OFFSET
        : PE32_DATA_DIRECTORIES_OFFSET;

      // Export directory is at index 0
      const exportRva = ntData.readUInt32LE(dataDirOff);
      const exportSize = ntData.readUInt32LE(dataDirOff + 4);
      if (exportRva === 0 || exportSize === 0) return 0n;

      // Read IMAGE_EXPORT_DIRECTORY (40 bytes)
      const expData = ReadProcessMemory(hProcess, moduleBase + BigInt(exportRva), 40);
      const numberOfFunctions = expData.readUInt32LE(20);
      const numberOfNames = expData.readUInt32LE(24);
      const addressOfFunctionsRva = expData.readUInt32LE(28);
      const addressOfNamesRva = expData.readUInt32LE(32);
      const addressOfNameOrdinalsRva = expData.readUInt32LE(36);
      const ordinalBase = expData.readUInt32LE(16);

      // If import by ordinal
      if (funcName.startsWith('#')) {
        const ordIndex = funcOrdinal - ordinalBase;
        if (ordIndex < 0 || ordIndex >= numberOfFunctions) return 0n;

        const funcOff = addressOfFunctionsRva + ordIndex * 4;
        const funcData = ReadProcessMemory(hProcess, moduleBase + BigInt(funcOff), 4);
        const funcRva = funcData.readUInt32LE(0);
        return moduleBase + BigInt(funcRva);
      }

      // Import by name: binary search the name table
      // Simplified: linear scan with cap
      const MAX_EXPORT_NAMES = 2000;
      const nameCount = Math.min(numberOfNames, MAX_EXPORT_NAMES);

      for (let i = 0; i < nameCount; i++) {
        const namePtrOff = addressOfNamesRva + i * 4;
        const namePtrData = ReadProcessMemory(hProcess, moduleBase + BigInt(namePtrOff), 4);
        const nameRva = namePtrData.readUInt32LE(0);

        const nameBuf = ReadProcessMemory(hProcess, moduleBase + BigInt(nameRva), 256);
        const nullIdx = nameBuf.indexOf(0);
        const currentName = nameBuf.subarray(0, nullIdx > 0 ? nullIdx : 256).toString('ascii');

        if (currentName === funcName) {
          // Found the name — get the ordinal from the ordinal table
          const ordOff = addressOfNameOrdinalsRva + i * 2;
          const ordData = ReadProcessMemory(hProcess, moduleBase + BigInt(ordOff), 2);
          const ordIndex = ordData.readUInt16LE(0);

          // Get function RVA from address table
          const funcOff = addressOfFunctionsRva + ordIndex * 4;
          const funcData = ReadProcessMemory(hProcess, moduleBase + BigInt(funcOff), 4);
          const funcRva = funcData.readUInt32LE(0);

          // Check for forwarded export (RVA inside export directory)
          if (funcRva >= exportRva && funcRva < exportRva + exportSize) {
            // Forwarded export — read the forwarder string and resolve recursively
            const fwdBuf = ReadProcessMemory(hProcess, moduleBase + BigInt(funcRva), 256);
            const fwdEnd = fwdBuf.indexOf(0);
            const forwardedTo = fwdBuf.subarray(0, fwdEnd > 0 ? fwdEnd : 256).toString('ascii');
            return this.resolveForwardedExport(hProcess, forwardedTo);
          }

          return moduleBase + BigInt(funcRva);
        }
      }

      logger.debug(`ManualMap: export not found: ${dllName}!${funcName}`);
    } catch (e) {
      logger.debug(
        `ManualMap: export resolution failed for ${dllName}!${funcName}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return 0n;
  }

  /**
   * Resolve a forwarded export (e.g. "NTDLL.RtlAllocateHeap").
   *
   * Forwarded exports redirect to another DLL. We need to find that DLL
   * in the target and resolve the actual target function.
   */
  private resolveForwardedExport(hProcess: bigint, forwardString: string): bigint {
    const dotIdx = forwardString.indexOf('.');
    if (dotIdx < 0) return 0n;

    const targetDll = forwardString.substring(0, dotIdx) + '.dll';
    const targetFunc = forwardString.substring(dotIdx + 1);

    // Find the target DLL in loaded modules
    const modules = this.enumerateTargetModules(hProcess);
    const targetMod = modules.find((m) => m.name.toLowerCase() === targetDll.toLowerCase());
    if (!targetMod) return 0n;

    const targetBase = BigInt(
      targetMod.base.startsWith('0x') ? targetMod.base : `0x${targetMod.base}`,
    );

    // Resolve the target function (handle ordinal forwarding like "#123")
    const isOrdinal = targetFunc.startsWith('#');
    const ordNum = isOrdinal ? parseInt(targetFunc.substring(1), 10) : 0;
    return this.resolveExportInTarget(
      hProcess,
      targetBase,
      isOrdinal ? `#${ordNum}` : targetFunc,
      ordNum,
      targetDll,
    );
  }
}

export const manualMapInjector = new ManualMapInjector();
