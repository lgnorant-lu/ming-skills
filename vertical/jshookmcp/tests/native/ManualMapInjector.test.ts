/**
 * ManualMapInjector tests.
 *
 * All koffi FFI calls are mocked at the module boundary. Tests verify:
 *   1. PE parsing from buffer (pure TS, no FFI)
 *   2. Safety gates (env var, admin, rate limit)
 *   3. Injection pipeline mock behavior
 *   4. Thread hijacking mock behavior
 *   5. Shellcode injection (stealth RW→RX) mock behavior
 *   6. Reflective DLL injection path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManualMapInjector, resetRateLimit } from '../../src/native/ManualMapInjector';

// ── Sample PE Data ──

/**
 * Build a minimal PE32+ DLL in a Buffer for testing parsePEFromBuffer.
 * This is a real valid PE structure with known header values.
 */
function buildMinimalPE64(): Buffer {
  // DOS header: 64 bytes
  const dosHeader = Buffer.alloc(64, 0);
  dosHeader.writeUInt16LE(0x5a4d, 0); // e_magic = MZ
  dosHeader.writeUInt32LE(0x80, 60); // e_lfanew = 128 (DOS header 64 + DOS stub 64)

  // DOS stub: 64 bytes (padding between DOS and NT headers)
  const dosStub = Buffer.alloc(64, 0);

  // NT headers start at offset 128 (0x80)
  // PE signature
  const peSig = Buffer.alloc(4, 0);
  peSig.writeUInt32LE(0x00004550, 0); // "PE\0\0"

  // File header: 20 bytes
  const fileHeader = Buffer.alloc(20, 0);
  fileHeader.writeUInt16LE(0x8664, 0); // Machine = x64
  fileHeader.writeUInt16LE(2, 2); // NumberOfSections = 2
  fileHeader.writeUInt16LE(0xf0, 16); // SizeOfOptionalHeader = 240 (PE32+)

  // Optional header: 240 bytes (PE32+)
  const optHeader = Buffer.alloc(240, 0);
  optHeader.writeUInt16LE(0x020b, 0); // Magic = PE32+
  optHeader.writeUInt32LE(0x1000, 16); // EntryPointRVA = 0x1000
  optHeader.writeBigUInt64LE(BigInt('0x180000000'), 24); // ImageBase
  optHeader.writeUInt32LE(0x3000, 56); // SizeOfImage = 3 pages
  optHeader.writeUInt32LE(0x400, 60); // SizeOfHeaders
  optHeader.writeUInt32LE(16, 108); // NumberOfRvaAndSizes
  // Data directories at offset 112: 16 * 8 = 128 bytes all zero

  // Section headers: 2 sections, each 40 bytes
  const sectionText = Buffer.alloc(40, 0);
  Buffer.from('.text\0\0\0').copy(sectionText, 0); // Name
  sectionText.writeUInt32LE(0x800, 8); // VirtualSize
  sectionText.writeUInt32LE(0x1000, 12); // VirtualAddress
  sectionText.writeUInt32LE(0x400, 16); // SizeOfRawData
  sectionText.writeUInt32LE(0x400, 20); // PointerToRawData
  sectionText.writeUInt32LE(0x60000020, 36); // Characteristics = CODE|EXECUTE|READ

  const sectionData = Buffer.alloc(40, 0);
  Buffer.from('.data\0\0\0').copy(sectionData, 0); // Name
  sectionData.writeUInt32LE(0x200, 8); // VirtualSize
  sectionData.writeUInt32LE(0x2000, 12); // VirtualAddress
  sectionData.writeUInt32LE(0x200, 16); // SizeOfRawData
  sectionData.writeUInt32LE(0x800, 20); // PointerToRawData
  sectionData.writeUInt32LE(0xc0000040, 36); // Characteristics = DATA|READ|WRITE

  return Buffer.concat([
    dosHeader,
    dosStub,
    peSig,
    fileHeader,
    optHeader,
    sectionText,
    sectionData,
  ]);
}

/** Build a minimal PE32+ with import directory pointing to a specific RVA */
function buildPEWithImports(): Buffer {
  const base = buildMinimalPE64();
  // Override the data directory for imports (index 1) at offset:
  // e_lfanew(128) + 4(PE sig) + 20(file hdr) + 112(data dir offset in PE32+)
  // data dir offset = 128 + 24 + 112 = 264
  // Import directory is at index 1 * 8 = 8 bytes into the data directory array
  const importDirOffset = 128 + 24 + 112 + 1 * 8;
  base.writeUInt32LE(0x2800, importDirOffset); // Import RVA
  base.writeUInt32LE(0x100, importDirOffset + 4); // Import size

  // Also add base relocations directory at index 5
  const relocDirOffset = 128 + 24 + 112 + 5 * 8;
  base.writeUInt32LE(0x2900, relocDirOffset); // Reloc RVA
  base.writeUInt32LE(0x100, relocDirOffset + 4); // Reloc size

  return base;
}

// ── Mock Helpers ──

const mockOpenProcess = vi.fn();
const mockCloseHandle = vi.fn();
const mockReadProcessMemory = vi.fn();
const mockWriteProcessMemory = vi.fn();
const mockVirtualAllocEx = vi.fn();
const mockVirtualProtectEx = vi.fn();
const mockFlushInstructionCache = vi.fn();
const mockEnumProcessModules = vi.fn();
const mockGetModuleBaseName = vi.fn();
const mockGetModuleInformation = vi.fn();
const mockCreateRemoteThread = vi.fn();
const mockNtCreateThreadExSafe = vi.fn();
const mockEnumerateProcessThreads = vi.fn();
const mockOpenThread = vi.fn();
const mockSuspendThread = vi.fn();
const mockResumeThread = vi.fn();
const mockGetThreadContext = vi.fn();
const mockSetThreadContext = vi.fn();

// Default mock returns
const DEFAULT_ALLOC_BASE = BigInt('0x1A00000000');

function setupDefaultMocks(): void {
  mockOpenProcess.mockReturnValue(BigInt('0x1000'));
  mockCloseHandle.mockReturnValue(true);
  mockVirtualAllocEx.mockReturnValue(DEFAULT_ALLOC_BASE);
  mockVirtualProtectEx.mockReturnValue({ success: true, oldProtect: 4 }); // RW->RX
  mockWriteProcessMemory.mockReturnValue(16);
  mockFlushInstructionCache.mockReturnValue(undefined);
  mockCreateRemoteThread.mockReturnValue({
    handle: BigInt('0x200'),
    threadId: 1234,
  });
  mockNtCreateThreadExSafe.mockReturnValue({
    status: 0,
    handle: BigInt('0x300'),
  });
  mockEnumerateProcessThreads.mockReturnValue([5678]);
  mockOpenThread.mockReturnValue(BigInt('0x400'));
  mockSuspendThread.mockReturnValue(0);
  mockResumeThread.mockReturnValue(0);

  // Default module enumeration
  mockEnumProcessModules.mockReturnValue({
    modules: [BigInt('0x7000')],
    count: 1,
  });
  mockGetModuleBaseName.mockReturnValue('kernel32.dll');
  mockGetModuleInformation.mockReturnValue({
    success: true,
    info: {
      lpBaseOfDll: BigInt('0x70000000000'),
      SizeOfImage: 0x100000,
      EntryPoint: BigInt('0x70000001000'),
    },
  });

  // Default thread context
  const ctxBuf = Buffer.alloc(1232, 0);
  ctxBuf.writeUInt32LE(0x0010001f, 0x30); // ContextFlags
  ctxBuf.writeBigUInt64LE(BigInt('0x7ff600001000'), 0xf8); // RIP
  ctxBuf.writeBigUInt64LE(BigInt('0x7ff600002000'), 0x98); // RSP
  mockGetThreadContext.mockReturnValue(ctxBuf);
  mockSetThreadContext.mockReturnValue(undefined);

  // Default read process memory — simulate valid PE headers
  mockReadProcessMemory.mockImplementation((_hProcess: bigint, _addr: bigint, size: number) => {
    const buf = Buffer.alloc(size, 0);
    // Return valid DOS header
    if (size >= 64) {
      buf.writeUInt16LE(0x5a4d, 0); // MZ
      buf.writeUInt32LE(0x80, 60); // e_lfanew
    }
    return buf;
  });
}

function clearAllMocks(): void {
  vi.clearAllMocks();
}

// ── Module mocking ──

vi.mock('../../src/native/Win32API', () => ({
  openProcessForMemory: (...args: unknown[]) => mockOpenProcess(...args),
  CloseHandle: (...args: unknown[]) => mockCloseHandle(...args),
  ReadProcessMemory: (...args: unknown[]) => mockReadProcessMemory(...args),
  WriteProcessMemory: (...args: unknown[]) => mockWriteProcessMemory(...args),
  VirtualAllocEx: (...args: unknown[]) => mockVirtualAllocEx(...args),
  VirtualProtectEx: (...args: unknown[]) => mockVirtualProtectEx(...args),
  EnumProcessModules: (...args: unknown[]) => mockEnumProcessModules(...args),
  GetModuleBaseName: (...args: unknown[]) => mockGetModuleBaseName(...args),
  GetModuleInformation: (...args: unknown[]) => mockGetModuleInformation(...args),
  PAGE: {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    EXECUTE_WRITECOPY: 0x80,
    GUARD: 0x100,
    NOCACHE: 0x200,
    WRITECOMBINE: 0x400,
  },
  MEM: {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    DECOMMIT: 0x4000,
    RELEASE: 0x8000,
    FREE: 0x10000,
    PRIVATE: 0x20000,
    MAPPED: 0x40000,
    RESET: 0x80000,
    TOP_DOWN: 0x100000,
    WRITE_WATCH: 0x200000,
    PHYSICAL: 0x400000,
    LARGE_PAGES: 0x20000000,
  },
  PROCESS_ACCESS: {
    VM_READ: 0x0010,
    VM_WRITE: 0x0020,
    VM_OPERATION: 0x0008,
    QUERY_INFORMATION: 0x0400,
    QUERY_LIMITED_INFORMATION: 0x1000,
    CREATE_THREAD: 0x0002,
    ALL_ACCESS: 0x1f0fff,
  },
  CreateRemoteThread: (...args: unknown[]) => mockCreateRemoteThread(...args),
  GetModuleHandle: () => BigInt('0x70000000000'),
  GetProcAddress: () => BigInt('0x70000001000'),
}));

vi.mock('../../src/native/Win32Debug', () => ({
  FlushInstructionCache: (...args: unknown[]) => mockFlushInstructionCache(...args),
  OpenThread: (...args: unknown[]) => mockOpenThread(...args),
  SuspendThread: (...args: unknown[]) => mockSuspendThread(...args),
  ResumeThread: (...args: unknown[]) => mockResumeThread(...args),
  GetThreadContext: (...args: unknown[]) => mockGetThreadContext(...args),
  SetThreadContext: (...args: unknown[]) => mockSetThreadContext(...args),
  EnumerateProcessThreads: (...args: unknown[]) => mockEnumerateProcessThreads(...args),
  CONTEXT_FLAGS: {
    AMD64: 0x00100000,
    CONTROL: 0x00100001,
    INTEGER: 0x00100002,
    SEGMENTS: 0x00100004,
    FLOATING_POINT: 0x00100008,
    DEBUG_REGISTERS: 0x00100010,
    FULL: 0x0010000b,
    ALL: 0x0010001f,
  },
  THREAD_ACCESS: {
    SUSPEND_RESUME: 0x0002,
    GET_CONTEXT: 0x0008,
    SET_CONTEXT: 0x0010,
    QUERY_INFORMATION: 0x0040,
    ALL_ACCESS: 0x1f03ff,
  },
  parseContext: (buf: Buffer) => ({
    contextFlags: buf.readUInt32LE(0x30),
    dr0: 0n,
    dr1: 0n,
    dr2: 0n,
    dr3: 0n,
    dr6: 0n,
    dr7: 0n,
    rax: 0n,
    rcx: 0n,
    rdx: 0n,
    rbx: 0n,
    rsp: buf.readBigUInt64LE(0x98),
    rbp: 0n,
    rsi: 0n,
    rdi: 0n,
    r8: 0n,
    r9: 0n,
    r10: 0n,
    r11: 0n,
    r12: 0n,
    r13: 0n,
    r14: 0n,
    r15: 0n,
    rip: buf.readBigUInt64LE(0xf8),
    eflags: buf.readUInt32LE(0x44),
  }),
  writeContext: () => undefined,
  openThreadForDebug: (...args: unknown[]) => mockOpenThread(...args),
}));

vi.mock('../../src/native/syscall/NtInjection', () => ({
  ntCreateThreadExSafe: (...args: unknown[]) => mockNtCreateThreadExSafe(...args),
  ntCreateThreadEx: (...args: unknown[]) => mockNtCreateThreadExSafe(...args),
  ntAllocateVirtualMemory: () => ({ status: 0, address: DEFAULT_ALLOC_BASE }),
  ntProtectVirtualMemory: () => ({ status: 0, oldProtect: 4 }),
  ntClose: () => 0,
  ntSuccess: (s: number) => s >= 0,
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Tests ──

describe('ManualMapInjector', () => {
  let injector: ManualMapInjector;

  beforeEach(() => {
    // Set env gate
    process.env.JSHOOK_INJECTION_ENABLE = '1';
    setupDefaultMocks();
    injector = new ManualMapInjector();
  });

  afterEach(() => {
    delete process.env.JSHOOK_INJECTION_ENABLE;
    resetRateLimit();
    clearAllMocks();
  });

  describe('Safety Gates', () => {
    it('throws if JSHOOK_INJECTION_ENABLE is not set', async () => {
      delete process.env.JSHOOK_INJECTION_ENABLE;
      const buf = buildMinimalPE64();
      // injectFromBuffer still gates on env var
      await expect(injector.injectFromBuffer(1234, buf, {})).rejects.toThrow(
        /JSHOOK_INJECTION_ENABLE=1/,
      );
    });

    it('throws if shellcode is empty', async () => {
      await expect(injector.injectShellcode(1234, Buffer.alloc(0))).rejects.toThrow(
        'Shellcode must be non-empty',
      );
    });

    it('throws if shellcode is empty for thread hijack', async () => {
      await expect(injector.injectViaThreadHijack(1234, Buffer.alloc(0))).rejects.toThrow(
        'Shellcode must be non-empty',
      );
    });

    it('throws if image size exceeds max alloc size', async () => {
      const buf = buildMinimalPE64();
      await expect(injector.injectFromBuffer(1234, buf, { maxAllocSize: 1 })).rejects.toThrow(
        /exceeds max allowed/,
      );
    });
  });

  describe('injectShellcode', () => {
    it('allocates RW memory and changes to RX (stealth)', async () => {
      const shellcode = Buffer.from([0x48, 0x31, 0xc0, 0xc3]); // xor rax,rax; ret
      const result = await injector.injectShellcode(1234, shellcode);

      expect(result.address).toBe('0x1A00000000');
      expect(result.method).toBe('NtCreateThreadEx');
      // Verify RW allocation (not RWX)
      expect(mockVirtualAllocEx).toHaveBeenCalledWith(
        expect.anything(),
        0n,
        shellcode.length,
        expect.any(Number), // MEM.COMMIT|MEM.RESERVE
        0x04, // PAGE.READWRITE
      );
    });

    it('calls NtCreateThreadEx for stealth thread creation', async () => {
      const shellcode = Buffer.from([0x90]);
      await injector.injectShellcode(1234, shellcode);
      expect(mockNtCreateThreadExSafe).toHaveBeenCalled();
    });
  });

  describe('injectViaThreadHijack', () => {
    it('suspends and resumes target thread', async () => {
      const shellcode = Buffer.from([0xc3]); // ret
      const result = await injector.injectViaThreadHijack(1234, shellcode);

      expect(mockOpenThread).toHaveBeenCalled();
      expect(mockSuspendThread).toHaveBeenCalled();
      expect(mockGetThreadContext).toHaveBeenCalled();
      expect(mockSetThreadContext).toHaveBeenCalled();
      expect(mockResumeThread).toHaveBeenCalled();
      expect(result.method).toBe('thread_hijack');
      expect(result.address).toBe('0x1A00000000');
    });

    it('throws if target process has no threads', async () => {
      mockEnumerateProcessThreads.mockReturnValue([]);
      await expect(injector.injectViaThreadHijack(1234, Buffer.from([0xc3]))).rejects.toThrow(
        /No threads found/,
      );
    });

    it('cleans up (resumes thread) on failure', async () => {
      mockGetThreadContext.mockImplementation(() => {
        throw new Error('Context read failed');
      });
      await expect(injector.injectViaThreadHijack(1234, Buffer.from([0xc3]))).rejects.toThrow(
        'Context read failed',
      );
      // Thread should be resumed
      expect(mockResumeThread).toHaveBeenCalled();
    });
  });

  describe('injectFromBuffer', () => {
    it('reads PE headers from buffer and maps sections', async () => {
      const buf = buildMinimalPE64();
      const result = await injector.injectFromBuffer(1234, buf, {});

      expect(result.imageBase).toBe('0x1A00000000');
      expect(result.imageSize).toBe(0x3000); // 3 pages
      expect(result.entryPoint).toBe('0x1A00001000');
      expect(result.headersWiped).toBe(true);
      expect(result.injectionMethod).toBe('NtCreateThreadEx');
    });

    it('writes headers and sections to target', async () => {
      const buf = buildMinimalPE64();
      await injector.injectFromBuffer(1234, buf, {});

      // Headers write + 2 section writes
      expect(mockWriteProcessMemory).toHaveBeenCalled();
    });

    it('wipes PE headers by default', async () => {
      const buf = buildMinimalPE64();
      await injector.injectFromBuffer(1234, buf, {});
      // Headers wiped: zero page written
      expect(mockWriteProcessMemory).toHaveBeenCalled();
    });

    it('preserves headers when wipeHeaders=false', async () => {
      const buf = buildMinimalPE64();
      const result = await injector.injectFromBuffer(1234, buf, { wipeHeaders: false });
      expect(result.headersWiped).toBe(false);
    });

    it('handles reflective DLL mode (skips import/reloc resolution)', async () => {
      const buf = buildMinimalPE64();
      const result = await injector.injectFromBuffer(1234, buf, { reflective: true });

      expect(result.injectionMethod).toBe('reflective');
      // Reflective loader gets image base as parameter
      expect(mockNtCreateThreadExSafe).toHaveBeenCalledWith(
        expect.any(BigInt), // hProcess
        expect.any(BigInt), // startAddr
        DEFAULT_ALLOC_BASE, // param = image base
        expect.any(Number),
      );
    });

    it('resolves imports when import directory is present', async () => {
      const buf = buildPEWithImports();
      // Setup kernel32 export table read
      mockReadProcessMemory.mockImplementation((_hProcess: bigint, _addr: bigint, size: number) => {
        const bufMem = Buffer.alloc(size, 0);
        if (size >= 64) {
          bufMem.writeUInt16LE(0x5a4d, 0); // MZ
          bufMem.writeUInt32LE(0x80, 60); // e_lfanew
        }
        return bufMem;
      });

      await injector.injectFromBuffer(1234, buf, {});
      // Module enumeration occurred for import resolution
      expect(mockEnumProcessModules).toHaveBeenCalled();
    });
  });

  describe('parsePEFromBuffer (internal, tested via public API)', () => {
    it('rejects invalid DOS header', async () => {
      const badBuf = Buffer.alloc(128, 0);
      // No MZ magic
      await expect(injector.injectFromBuffer(1234, badBuf, {})).rejects.toThrow(
        'Invalid DOS header',
      );
    });

    it('rejects invalid PE signature', async () => {
      const buf = buildMinimalPE64();
      // Corrupt PE signature at e_lfanew offset (0x80 = 128)
      buf.writeUInt32LE(0x0, 0x80);
      await expect(injector.injectFromBuffer(1234, buf, {})).rejects.toThrow(
        'Invalid PE signature',
      );
    });
  });
});
