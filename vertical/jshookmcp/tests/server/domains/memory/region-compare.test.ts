import { describe, it, expect, vi, beforeEach } from 'vitest';

const factoryState = vi.hoisted(() => ({
  createPlatformProvider: vi.fn(),
}));

vi.mock('../../../../src/native/platform/factory', () => ({
  createPlatformProvider: factoryState.createPlatformProvider,
}));

const resolvePidState = vi.hoisted(() => ({
  resolveMemoryDomainPid: vi.fn(),
}));

vi.mock('../../../../src/server/domains/memory/pid-resolver', () => ({
  resolveMemoryDomainPid: resolvePidState.resolveMemoryDomainPid,
}));

import { RegionCompareHandlers } from '../../../../src/server/domains/memory/handlers/region-compare';

describe('RegionCompareHandlers', () => {
  let handlers: RegionCompareHandlers;
  let mockApi: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);

    mockApi = {
      platform: 'win32',
      openProcess: vi.fn().mockReturnValue({ pid: 1234, writeAccess: false }),
      closeProcess: vi.fn(),
    };
    factoryState.createPlatformProvider.mockReturnValue(mockApi);

    handlers = new RegionCompareHandlers();
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('handleRegionCompare', () => {
    it('detects identical regions correctly', async () => {
      const identicalData = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      mockApi.readMemory = vi.fn().mockReturnValue({
        data: identicalData,
        bytesRead: 5,
      });

      const response = await handlers.handleRegionCompare({
        pid: 1234,
        address1: '0x10000000',
        address2: '0x20000000',
        size: 5,
      });
      const parsed = parseResponse(response);

      expect(parsed.identical).toBe(true);
      expect(parsed.diffCount).toBe(0);
      expect(parsed.diffs).toHaveLength(0);
    });

    it('detects and lists byte differences between regions', async () => {
      const data1 = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05]);
      const data2 = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e]);
      mockApi.readMemory = vi
        .fn()
        .mockReturnValueOnce({ data: data1, bytesRead: 5 })
        .mockReturnValueOnce({ data: data2, bytesRead: 5 });

      const response = await handlers.handleRegionCompare({
        pid: 1234,
        address1: '0x10000000',
        address2: '0x20000000',
        size: 5,
      });
      const parsed = parseResponse(response);

      expect(parsed.identical).toBe(false);
      expect(parsed.diffCount).toBe(5);
      expect(parsed.diffs).toBeInstanceOf(Array);
      expect(parsed.diffs).toHaveLength(5);

      // First diff should be at offset 0: 0x01 vs 0x0a
      expect(parsed.diffs[0].offset).toBe(0);
      expect(parsed.diffs[0].byte1).toBe(0x01);
      expect(parsed.diffs[0].byte2).toBe(0x0a);
    });
  });
});
