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

import { ProtectHandlers } from '../../../../src/server/domains/memory/handlers/protect';

describe('ProtectHandlers', () => {
  let handlers: ProtectHandlers;
  let mockApi: Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);

    mockApi = {
      platform: 'win32',
      openProcess: vi.fn().mockReturnValue({ pid: 1234, writeAccess: true }),
      closeProcess: vi.fn(),
    };
    factoryState.createPlatformProvider.mockReturnValue(mockApi);

    handlers = new ProtectHandlers();
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('handleProtect', () => {
    it('changes protection from rwx to r and returns old protection', async () => {
      mockApi.changeProtection = vi.fn().mockReturnValue({
        oldProtection: 7, // ReadWriteExecute = 0x07
      });

      const response = await handlers.handleProtect({
        pid: 1234,
        address: '0x7FF612340000',
        size: 4096,
        protection: 'r',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.oldProtection).toBe('rwx');
      expect(parsed.newProtection).toBe('r');
      expect(parsed.platform).toBe('win32');

      // Verify the API was called correctly
      expect(mockApi.changeProtection).toHaveBeenCalledWith(
        expect.objectContaining({ pid: 1234, writeAccess: true }),
        0x7ff612340000n,
        4096,
        1, // Read
      );
    });

    it('rejects invalid protection values and reports errors gracefully', async () => {
      // Invalid protection should throw
      const response = await handlers.handleProtect({
        pid: 1234,
        address: '0x7FF612340000',
        size: 4096,
        protection: 'invalid',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('protection');

      // API failure should propagate
      mockApi.changeProtection = vi.fn().mockImplementation(() => {
        throw new Error('Access denied');
      });

      const failResp = await handlers.handleProtect({
        pid: 1234,
        address: '0x10000000',
        size: 4096,
        protection: 'rwx',
      });
      const failParsed = parseResponse(failResp);

      expect(failParsed.success).toBe(false);
      expect(failParsed.error).toContain('Access denied');
    });
  });
});
