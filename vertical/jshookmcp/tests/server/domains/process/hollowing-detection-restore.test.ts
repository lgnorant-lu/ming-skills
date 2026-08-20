/**
 * Regression tests for hollowing-detection restore/dump ordering and
 * restore-completeness bugs:
 *
 * 1. autoRestore (step 6) ran BEFORE the memory dump (step 8): the dump read
 *    already-restored bytes, so the forensic diff showed disk content on both
 *    sides — the "evidence" was falsified by the fix itself.
 * 2. restoreFromDisk restored only `min(sizeOfRawData, bytesCompared)` bytes:
 *    when a section's compared window was smaller than the on-disk section
 *    (common: virtualSize < sizeOfRawData), the tail of the section was left
 *    hollowed, leaving a mixed original+injected code region.
 *
 * The win32 path is forced via `processMgmt.platformValue` so the tests run
 * on any CI host (the FFI layer is fully mocked).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCompareMemoryWithDisk = vi.fn();
const mockParsePEFromBuffer = vi.fn();
const mockOpenProcessForMemory = vi.fn();
const mockCloseHandle = vi.fn();
const mockEnumProcessModules = vi.fn();
const mockGetModuleFileNameEx = vi.fn();
const mockGetModuleInformation = vi.fn();
const mockReadProcessMemory = vi.fn();
const mockWriteProcessMemory = vi.fn();
const mockVirtualProtectEx = vi.fn();
const mockReadFile = vi.fn();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('node:fs');
  return {
    ...actual,
    promises: {
      ...(actual as { promises: object }).promises,
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  };
});

vi.mock('@native/PEAnalyzer', () => ({
  PEAnalyzer: class {
    compareMemoryWithDisk = mockCompareMemoryWithDisk;
    parsePEFromBuffer = mockParsePEFromBuffer;
  },
}));

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: (...args: unknown[]) => mockOpenProcessForMemory(...args),
  CloseHandle: (...args: unknown[]) => mockCloseHandle(...args),
  EnumProcessModules: (...args: unknown[]) => mockEnumProcessModules(...args),
  GetModuleFileNameEx: (...args: unknown[]) => mockGetModuleFileNameEx(...args),
  GetModuleInformation: (...args: unknown[]) => mockGetModuleInformation(...args),
  ReadProcessMemory: (...args: unknown[]) => mockReadProcessMemory(...args),
  WriteProcessMemory: (...args: unknown[]) => mockWriteProcessMemory(...args),
  VirtualProtectEx: (...args: unknown[]) => mockVirtualProtectEx(...args),
  PAGE: { READWRITE: 0x04 },
}));

vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';

const SECTION = {
  name: '.text',
  virtualAddress: 0x1000,
  virtualSize: 0x4f000,
  pointerToRawData: 0x200,
  sizeOfRawData: 0x80000, // larger than the compared window → old code under-restored
};

const DIFF = {
  sectionName: '.text',
  offsetStart: 0x1000,
  offsetEnd: 0x1000 + 0x4f000,
  memoryHash: 'deadbeef',
  diskHash: 'cafebabe',
  bytesCompared: 0x4f000,
};

function setupMocks(overrides: { differences?: (typeof DIFF)[] } = {}) {
  vi.clearAllMocks();
  mockOpenProcessForMemory.mockReturnValue(BigInt(0x1234));
  mockCloseHandle.mockImplementation(() => {});
  mockEnumProcessModules.mockReturnValue({
    success: true,
    modules: [BigInt(0x400000)],
    count: 1,
  });
  mockGetModuleFileNameEx.mockReturnValue('C:\\Windows\\System32\\notepad.exe');
  mockGetModuleInformation.mockReturnValue({
    success: true,
    info: { lpBaseOfDll: BigInt(0x400000), SizeOfImage: 0x100000, EntryPoint: BigInt(0x401000) },
  });
  mockReadProcessMemory.mockReturnValue(Buffer.alloc(0x1000, 0xde));
  mockReadFile.mockResolvedValue(Buffer.alloc(0x200 + SECTION.sizeOfRawData, 0xca));
  mockParsePEFromBuffer.mockReturnValue({
    fileHeader: { machine: 0x8664, numberOfSections: 1, timeDateStamp: 0 },
    sections: [SECTION],
  });
  mockVirtualProtectEx.mockReturnValue({ oldProtect: 0x40 });
  mockWriteProcessMemory.mockReturnValue(undefined);
  mockCompareMemoryWithDisk.mockResolvedValue({
    isMatch: false,
    confidence: 45,
    differences: overrides.differences ?? [DIFF],
  });
}

describe('HollowingDetectionHandlers — restore/dump interplay', () => {
  let handlers: HollowingDetectionHandlers;

  beforeEach(() => {
    // Force the Win32 fast path on every CI host.
    handlers = new HollowingDetectionHandlers({ platformValue: 'win32' } as never);
  });

  it('captures the memory dump BEFORE restoring from disk', async () => {
    setupMocks();
    const result = (await handlers.handleDetectHollowing({
      pid: 5678,
      includeMemoryDump: true,
      autoRestore: true,
    })) as {
      success: boolean;
      restored: boolean;
      memoryDump?: { included: boolean; totalBytes: number };
    };

    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.memoryDump?.included).toBe(true);

    const reads = mockReadProcessMemory.mock.invocationCallOrder;
    const writes = mockWriteProcessMemory.mock.invocationCallOrder;
    expect(reads.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
    // Every forensic read must precede the first restoration write.
    expect(Math.max(...reads)).toBeLessThan(Math.min(...writes));
  });

  it('restores the FULL on-disk section, not just the compared window', async () => {
    setupMocks();
    const result = (await handlers.handleDetectHollowing({
      pid: 5678,
      autoRestore: true,
    })) as { success: boolean; restored: boolean };

    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);

    // Restore must cover the whole raw section (sizeOfRawData) even though
    // the comparison window (bytesCompared) was smaller — otherwise the
    // section tail stays hollowed and the process runs mixed code.
    expect(mockWriteProcessMemory).toHaveBeenCalledTimes(1);
    const [handle, addr, bytes] = mockWriteProcessMemory.mock.calls[0]!;
    expect(handle).toBe(BigInt(0x1234));
    expect(addr).toBe(BigInt(0x400000) + BigInt(DIFF.offsetStart));
    expect((bytes as Buffer).length).toBe(SECTION.sizeOfRawData);
    expect((bytes as Buffer).length).toBeGreaterThan(DIFF.bytesCompared);
  });

  it('restores without a memory dump when only autoRestore is set', async () => {
    setupMocks();
    const result = (await handlers.handleDetectHollowing({
      pid: 5678,
      autoRestore: true,
    })) as { success: boolean; restored: boolean; memoryDump?: unknown };

    expect(result.success).toBe(true);
    expect(result.restored).toBe(true);
    expect(result.memoryDump).toBeUndefined();
    expect(mockReadProcessMemory).not.toHaveBeenCalled();
  });
});
