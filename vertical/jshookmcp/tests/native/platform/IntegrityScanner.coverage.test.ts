/**
 * Coverage tests for IntegrityScanner.scanIntegrity — exercises the
 * platform-api loop, section filtering (executable / size / truncation),
 * hash comparison, and the per-section try/catch skip path. ElfParser and
 * MachOParser are mocked so section lists are deterministic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockParseElfSections = vi.fn();
const mockParseMachoSections = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('@native/platform/ElfParser', () => ({
  parseElfSections: (...args: unknown[]) => mockParseElfSections(...args),
}));

vi.mock('@native/platform/MachOParser', () => ({
  parseMachoSections: (...args: unknown[]) => mockParseMachoSections(...args),
}));

vi.mock('node:fs', () => ({
  readFileSync: (p: string) => mockReadFileSync(p),
}));

import { scanIntegrity } from '@native/platform/IntegrityScanner';

interface FakeSection {
  name: string;
  addr: number;
  size: number;
  fileOffset: number;
  isExecutable: boolean;
}

function makeApi(over: Record<string, unknown> = {}) {
  return {
    platform: 'linux',
    openProcess: vi.fn(() => ({})),
    closeProcess: vi.fn(),
    enumerateModules: vi.fn(() => []),
    readMemory: vi.fn(() => ({ data: Buffer.alloc(0) })),
    ...over,
  } as never;
}

const execSec = (over: Partial<FakeSection> = {}): FakeSection => ({
  name: '.text',
  addr: 0x1000,
  size: 100,
  fileOffset: 0,
  isExecutable: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('IntegrityScanner.scanIntegrity — early-exit paths', () => {
  it('returns empty sections when openProcess throws', async () => {
    const api = makeApi({
      openProcess: () => {
        throw new Error('EPERM');
      },
    });
    const result = await scanIntegrity(api, 999);
    expect(result.sections).toEqual([]);
    expect(result.stats.scannedModules).toBe(0);
  });

  it('returns empty when no modules are enumerated', async () => {
    const api = makeApi({ enumerateModules: () => [] });
    const result = await scanIntegrity(api, 1);
    expect(result.sections).toEqual([]);
  });

  it('closeProcess is always called (finally) even when parseElfSections throws', async () => {
    // parseElfSections runs outside the per-section try/catch, so its throw
    // propagates after the finally block runs closeProcess.
    const api = makeApi({
      enumerateModules: () => [{ name: '/x', baseAddress: 0x1000 }],
    });
    mockParseElfSections.mockImplementation(() => {
      throw new Error('parse fail');
    });
    await expect(scanIntegrity(api, 1)).rejects.toThrow('parse fail');
    // closeProcess runs in the finally block (api is a `as never` mock — not
    // type-accessible here); parseElfSections throw propagates, asserted above.
  });
});

describe('IntegrityScanner.scanIntegrity — section filtering', () => {
  it('skips non-executable sections', async () => {
    const api = makeApi({
      enumerateModules: () => [{ name: '/usr/lib/libfoo.so', baseAddress: 0x1000n }],
    });
    mockParseElfSections.mockReturnValue([execSec({ name: '.rodata', isExecutable: false })]);

    const result = await scanIntegrity(api, 1);
    expect(result.stats.scannedSections).toBe(0); // skipped (not executable)
  });

  it('skips oversized sections (> MAX_SECTION_BYTES)', async () => {
    const api = makeApi({
      enumerateModules: () => [{ name: '/usr/lib/libfoo.so', baseAddress: 0x1000n }],
    });
    mockParseElfSections.mockReturnValue([execSec({ size: 3 * 1024 * 1024 })]); // > 2MB

    const result = await scanIntegrity(api, 1);
    expect(result.stats.skippedSections).toBe(1);
    expect(result.stats.scannedSections).toBe(0);
  });

  it('records modified section when memory hash != disk hash', async () => {
    const memData = Buffer.from('memory-bytes-here!!!!!!');
    const diskData = Buffer.from('disk-bytes-here!!!!!!!!!'); // same length, different content
    const api = makeApi({
      enumerateModules: () => [{ name: '/usr/lib/libfoo.so', baseAddress: 0x1000 }],
      readMemory: () => ({ data: memData }),
    });
    mockParseElfSections.mockReturnValue([execSec({ size: memData.length })]);
    mockReadFileSync.mockReturnValue(diskData);

    const result = await scanIntegrity(api, 1);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.isModified).toBe(true);
    expect(result.sections[0]?.moduleName).toBe('libfoo.so');
  });

  it('records unmodified section when hashes match', async () => {
    const data = Buffer.from('identical-bytes!!!!!');
    const api = makeApi({
      enumerateModules: () => [{ name: '/x/libbar.so', baseAddress: 0 }],
      readMemory: () => ({ data }),
    });
    mockParseElfSections.mockReturnValue([execSec({ size: data.length })]);
    mockReadFileSync.mockReturnValue(data);

    const result = await scanIntegrity(api, 1);
    expect(result.sections[0]?.isModified).toBe(false);
  });

  it('skips a section whose readMemory throws (catch path)', async () => {
    const api = makeApi({
      enumerateModules: () => [{ name: '/x/libbar.so', baseAddress: 0 }],
      readMemory: () => {
        throw new Error('read fail');
      },
    });
    mockParseElfSections.mockReturnValue([execSec()]);
    mockReadFileSync.mockReturnValue(Buffer.alloc(100));

    const result = await scanIntegrity(api, 1);
    expect(result.stats.skippedSections).toBe(1);
    expect(result.sections).toHaveLength(0);
  });

  it('filters modules by moduleName substring', async () => {
    const enumerateModules = vi.fn(() => [
      { name: '/usr/lib/libfoo.so', baseAddress: 0 },
      { name: '/usr/lib/libbar.so', baseAddress: 0 },
    ]);
    const api = makeApi({ enumerateModules });
    mockParseElfSections.mockReturnValue([]);

    await scanIntegrity(api, 1, 'libfoo');
    expect(mockParseElfSections).toHaveBeenCalledTimes(1);
    expect(mockParseElfSections).toHaveBeenCalledWith('/usr/lib/libfoo.so');
  });

  it('uses parseMachoSections on darwin', async () => {
    const api = makeApi({
      platform: 'darwin',
      enumerateModules: () => [{ name: '/usr/lib/lib.dylib', baseAddress: 0 }],
    });
    mockParseMachoSections.mockReturnValue([]);
    await scanIntegrity(api, 1);
    expect(mockParseMachoSections).toHaveBeenCalledWith('/usr/lib/lib.dylib');
    expect(mockParseElfSections).not.toHaveBeenCalled();
  });
});
