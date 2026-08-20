import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  provider: {
    platform: 'linux' as const,
    checkAvailability: vi.fn(async () => ({ available: true, platform: 'linux' as const })),
    openProcess: vi.fn((pid: number, writeAccess: boolean) => ({ pid, writeAccess })),
    closeProcess: vi.fn(),
    readMemory: vi.fn((_handle: unknown, _address: bigint, size: number) => ({
      data: Buffer.alloc(size, 0x41),
      bytesRead: size,
    })),
    writeMemory: vi.fn((_handle: unknown, _address: bigint, data: Buffer) => ({
      bytesWritten: data.length,
    })),
    queryRegion: vi.fn(() => ({
      baseAddress: 0x1000n,
      size: 0x1000,
      protection: 1,
      state: 'committed' as const,
      type: 'private' as const,
      isReadable: true,
      isWritable: false,
      isExecutable: false,
    })),
    changeProtection: vi.fn(() => ({ oldProtection: 1 })),
    allocateMemory: vi.fn(),
    freeMemory: vi.fn(),
    enumerateModules: vi.fn(() => []),
  },
  win32Open: vi.fn(() => {
    throw new Error('Win32 path must not run on Linux');
  }),
}));

vi.mock('@native/platform/factory', () => ({
  createPlatformProvider: () => state.provider,
}));

vi.mock('@native/Win32API', () => ({
  openProcessForMemory: state.win32Open,
  CloseHandle: vi.fn(),
  ReadProcessMemory: vi.fn(),
  WriteProcessMemory: vi.fn(),
  VirtualProtectEx: vi.fn(),
  PAGE: { READWRITE: 0x04 },
}));

vi.mock('@native/NativeMemoryManager.utils', () => ({
  parsePattern: vi.fn(() => ({ patternBytes: [0x2a, 0, 0, 0] })),
}));

vi.mock('@src/constants', () => ({
  FREEZE_DEFAULT_INTERVAL_MS: 100,
  WRITE_HISTORY_MAX: 50,
}));

import { MemoryController } from '@native/MemoryController';

describe('MemoryController portable provider path', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  it('uses PlatformMemoryAPI for read/write and restores protection', async () => {
    const controller = new MemoryController();

    const entry = await controller.writeValue(42, '0x1000', '42', 'int32');
    const dump = await controller.dumpMemory(42, '0x1000', 4);

    expect(entry.oldValue).toEqual([0x41, 0x41, 0x41, 0x41]);
    expect(dump).toEqual(Buffer.alloc(4, 0x41));
    expect(state.provider.writeMemory).toHaveBeenCalledOnce();
    expect(state.provider.changeProtection).toHaveBeenCalledTimes(2);
    expect(state.provider.closeProcess).toHaveBeenCalledTimes(3);
    expect(state.win32Open).not.toHaveBeenCalled();
  });
});
