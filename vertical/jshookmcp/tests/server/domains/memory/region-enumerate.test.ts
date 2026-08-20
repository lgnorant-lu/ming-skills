import { describe, it, expect, vi, beforeEach } from 'vitest';

const factoryState = vi.hoisted(() => ({
  createPlatformProvider: vi.fn(),
}));

vi.mock('../../../../src/native/platform/factory', () => ({
  createPlatformProvider: factoryState.createPlatformProvider,
}));

import { RegionHandlers } from '../../../../src/server/domains/memory/handlers/region-enumerate';

/** Convenience accessor so tests don't scatter factoryState.createPlatformProvider everywhere. */
const mcpp = () => factoryState.createPlatformProvider;

describe('RegionHandlers', () => {
  let handlers: RegionHandlers;
  let mockApi: Record<string, any>;

  const dummyArgs = {
    pid: 1234,
    moduleName: undefined,
    protection: undefined,
    maxRegions: 500,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = {
      platform: 'win32',
      openProcess: vi.fn().mockReturnValue({ pid: 1234, writeAccess: false }),
      closeProcess: vi.fn(),
      enumerateModules: vi.fn().mockReturnValue([]),
    };
    mcpp().mockReturnValue(mockApi);
    handlers = new RegionHandlers();
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  // ── Tests ──

  it('instantiates correctly', () => {
    expect(handlers).toBeInstanceOf(RegionHandlers);
  });

  describe('handleRegionEnumerate', () => {
    it('1. returns regions with expected fields (base, size, protection, type)', async () => {
      const regions = [
        {
          baseAddress: 0x1000000n,
          size: 0x2000,
          protection: 5, // Read | Execute
          state: 'committed' as const,
          type: 'image' as const,
          isReadable: true,
          isWritable: false,
          isExecutable: true,
        },
        {
          baseAddress: 0x1002000n,
          size: 0x1000,
          protection: 3, // Read | Write
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        },
        {
          baseAddress: 0x2000000n,
          size: 0x4000,
          protection: 6, // Write | Execute
          state: 'committed' as const,
          type: 'mapped' as const,
          isReadable: false,
          isWritable: true,
          isExecutable: true,
        },
      ];

      let callIndex = 0;
      mockApi.queryRegion = vi.fn().mockImplementation(() => {
        const region = regions[callIndex] ?? null;
        callIndex++;
        return region;
      });

      mockApi.enumerateModules = vi.fn().mockReturnValue([
        { name: 'test.exe', baseAddress: 0x1000000n, size: 0x2000 },
        { name: 'test.dll', baseAddress: 0x2000000n, size: 0x4000 },
      ]);

      const response = await handlers.handleRegionEnumerate(dummyArgs);
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.regions).toBeInstanceOf(Array);
      expect(parsed.regions.length).toBe(3);
      expect(parsed.totalRegions).toBe(3);

      const r0 = parsed.regions[0];
      expect(r0).toHaveProperty('base');
      expect(r0).toHaveProperty('size');
      expect(r0).toHaveProperty('protection');
      expect(r0).toHaveProperty('type');
      expect(r0.protection).toBe('rx');
      expect(r0.type).toBe('image');
      expect(r0.moduleName).toBe('test.exe');

      const r1 = parsed.regions[1];
      expect(r1.protection).toBe('rw');
      expect(r1.type).toBe('private');
      expect(r1.moduleName).toBeNull();

      const r2 = parsed.regions[2];
      expect(r2.protection).toBe('wx');
      expect(r2.type).toBe('mapped');
      expect(r2.moduleName).toBe('test.dll');

      expect(mockApi.openProcess).toHaveBeenCalledWith(1234, false);
      expect(mockApi.closeProcess).toHaveBeenCalled();
    });

    it('2. moduleName filter works (case insensitive)', async () => {
      const regions = [
        {
          baseAddress: 0x1000000n,
          size: 0x1000,
          protection: 5,
          state: 'committed' as const,
          type: 'image' as const,
          isReadable: true,
          isWritable: false,
          isExecutable: true,
        },
        {
          baseAddress: 0x2000000n,
          size: 0x2000,
          protection: 5,
          state: 'committed' as const,
          type: 'image' as const,
          isReadable: true,
          isWritable: false,
          isExecutable: true,
        },
      ];

      let callIndex = 0;
      mockApi.queryRegion = vi.fn().mockImplementation(() => {
        const region = regions[callIndex] ?? null;
        callIndex++;
        return region;
      });

      mockApi.enumerateModules = vi.fn().mockReturnValue([
        { name: 'KERNEL32.DLL', baseAddress: 0x1000000n, size: 0x1000 },
        { name: 'ntdll.dll', baseAddress: 0x2000000n, size: 0x2000 },
      ]);

      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        moduleName: 'kernel',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.regions.length).toBe(1);
      expect(parsed.regions[0].moduleName).toBe('KERNEL32.DLL');
      expect(parsed.totalRegions).toBe(1);
    });

    it('3. protection filter works', async () => {
      const regions = [
        {
          baseAddress: 0x1000000n,
          size: 0x1000,
          protection: 5, // rx
          state: 'committed' as const,
          type: 'image' as const,
          isReadable: true,
          isWritable: false,
          isExecutable: true,
        },
        {
          baseAddress: 0x2000000n,
          size: 0x1000,
          protection: 3, // rw
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        },
      ];

      let callIndex = 0;
      mockApi.queryRegion = vi.fn().mockImplementation(() => {
        const region = regions[callIndex] ?? null;
        callIndex++;
        return region;
      });

      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        protection: 'rw',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.regions.length).toBe(1);
      expect(parsed.regions[0].protection).toBe('rw');
    });

    it('4. maxRegions cap works', async () => {
      mockApi.queryRegion = vi.fn().mockImplementation(() => {
        // Always return same template but different addresses
        const idx = (mockApi.queryRegion as ReturnType<typeof vi.fn>).mock.calls.length - 1;
        if (idx >= 5) return null;
        return {
          baseAddress: BigInt(0x1000000 + idx * 0x2000),
          size: 0x1000,
          protection: 3,
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        };
      });

      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        maxRegions: 3,
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.regions.length).toBe(3);
      expect(parsed.truncated).toBe(true);
    });

    it('5. invalid pid returns error', async () => {
      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        pid: -1,
      });
      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid PID');
    });

    it('6. empty result when no regions match filter', async () => {
      mockApi.queryRegion = vi
        .fn()
        .mockReturnValueOnce({
          baseAddress: 0x1000000n,
          size: 0x1000,
          protection: 3, // rw
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        })
        .mockReturnValueOnce(null);

      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        protection: 'x',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.regions.length).toBe(0);
      expect(parsed.totalRegions).toBe(0);
    });

    it('7. returns error when no platform memory provider is available', async () => {
      mcpp().mockImplementationOnce(() => {
        throw new Error('Unsupported platform');
      });

      const h2 = new RegionHandlers();
      const response = await h2.handleRegionEnumerate(dummyArgs);
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('no platform memory provider');
    });

    it('8. handles PID undefined (falls back to invalid pid error)', async () => {
      const response = await handlers.handleRegionEnumerate({ maxRegions: 500 });
      const parsed = parseResponse(response);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid PID');
    });

    it('9. protection filter with "r" matches read-only regions', async () => {
      mockApi.queryRegion = vi
        .fn()
        .mockReturnValueOnce({
          baseAddress: 0x1000000n,
          size: 0x1000,
          protection: 1, // r
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: false,
          isExecutable: false,
        })
        .mockReturnValueOnce({
          baseAddress: 0x2000000n,
          size: 0x1000,
          protection: 3, // rw
          state: 'committed' as const,
          type: 'private' as const,
          isReadable: true,
          isWritable: true,
          isExecutable: false,
        })
        .mockReturnValueOnce(null);

      const response = await handlers.handleRegionEnumerate({
        ...dummyArgs,
        protection: 'r',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      for (const r of parsed.regions) {
        expect(r.protection).toBe('r');
      }
    });
  });

  describe('protection string conversion', () => {
    it('maps protection flags to human-readable strings', async () => {
      const testCases = [
        { protectionNum: 1, expected: 'r' },
        { protectionNum: 2, expected: 'w' },
        { protectionNum: 3, expected: 'rw' },
        { protectionNum: 4, expected: 'x' },
        { protectionNum: 5, expected: 'rx' },
        { protectionNum: 6, expected: 'wx' },
        { protectionNum: 7, expected: 'rwx' },
        { protectionNum: 0, expected: '---' },
      ];

      for (const { protectionNum, expected } of testCases) {
        mockApi.queryRegion = vi
          .fn()
          .mockReturnValueOnce({
            baseAddress: BigInt(0x1000000),
            size: 0x1000,
            protection: protectionNum,
            state: 'committed' as const,
            type: 'private' as const,
            isReadable: (protectionNum & 1) !== 0,
            isWritable: (protectionNum & 2) !== 0,
            isExecutable: (protectionNum & 4) !== 0,
          })
          .mockReturnValueOnce(null);

        mockApi.openProcess = vi.fn().mockReturnValue({ pid: 1234, writeAccess: false });
        mockApi.closeProcess = vi.fn();
        mockApi.enumerateModules = vi.fn().mockReturnValue([]);
        mcpp().mockReturnValue(mockApi);

        const response = await handlers.handleRegionEnumerate(dummyArgs);
        const parsed = parseResponse(response);
        expect(parsed.success).toBe(true);
        expect(parsed.regions[0].protection).toBe(expected);
      }
    });
  });

  describe('type string conversion', () => {
    it('maps type enums to strings', async () => {
      const testCases = ['image', 'mapped', 'private', 'unknown'] as const;

      for (const type of testCases) {
        mockApi.queryRegion = vi
          .fn()
          .mockReturnValueOnce({
            baseAddress: BigInt(0x1000000),
            size: 0x1000,
            protection: 3,
            state: 'committed' as const,
            type,
            isReadable: true,
            isWritable: true,
            isExecutable: false,
          })
          .mockReturnValueOnce(null);

        mockApi.openProcess = vi.fn().mockReturnValue({ pid: 1234, writeAccess: false });
        mockApi.closeProcess = vi.fn();
        mockApi.enumerateModules = vi.fn().mockReturnValue([]);
        mcpp().mockReturnValue(mockApi);

        const response = await handlers.handleRegionEnumerate(dummyArgs);
        const parsed = parseResponse(response);
        expect(parsed.success).toBe(true);
        expect(parsed.regions[0].type).toBe(type);
      }
    });
  });
});
