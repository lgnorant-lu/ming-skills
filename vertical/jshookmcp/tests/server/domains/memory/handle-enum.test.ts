import { describe, it, expect, vi, beforeEach } from 'vitest';

const factoryState = vi.hoisted(() => ({
  enumerateProcessHandles: vi.fn(),
}));

vi.mock('../../../../src/native/HandleEnumerator', () => ({
  enumerateProcessHandles: factoryState.enumerateProcessHandles,
}));

const resolvePidState = vi.hoisted(() => ({
  resolveMemoryDomainPid: vi.fn(),
}));

vi.mock('../../../../src/server/domains/memory/pid-resolver', () => ({
  resolveMemoryDomainPid: resolvePidState.resolveMemoryDomainPid,
}));

import { HandleEnumHandlers } from '../../../../src/server/domains/memory/handlers/handle-enum';

describe('HandleEnumHandlers', () => {
  let handlers: HandleEnumHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);
    handlers = new HandleEnumHandlers();
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('handleHandleEnum', () => {
    it('returns handles with type summary on success', async () => {
      factoryState.enumerateProcessHandles.mockReturnValue({
        success: true,
        entries: [
          {
            object: 0x1000000n,
            processId: 1234,
            handleValue: 0x100,
            grantedAccess: 0x1fffff,
            objectTypeIndex: 7,
            handleAttributes: 0,
            typeName: 'Process',
            objectName: 'target.exe',
          },
          {
            object: 0x1000001n,
            processId: 1234,
            handleValue: 0x104,
            grantedAccess: 0x12019f,
            objectTypeIndex: 8,
            handleAttributes: 2,
            typeName: 'Thread',
            objectName: 'MainThread',
          },
        ],
        totalSystemHandles: 50000,
        typeIndexCache: new Map(),
      });

      const response = await handlers.handleHandleEnum({ pid: 1234 });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.pid).toBe(1234);
      expect(parsed.totalSystemHandles).toBe(50000);
      expect(parsed.totalHandles).toBe(2);
      expect(parsed.handles).toBeInstanceOf(Array);
      expect(parsed.handles).toHaveLength(2);
      expect(parsed.handles[0].objectType).toBe('Process');
      expect(parsed.handles[0].handleValue).toBe(0x100);
      expect(parsed.handles[1].objectType).toBe('Thread');
      expect(parsed.handles[1].inheritable).toBe(true);
      expect(parsed.typeSummary).toEqual({ Process: 1, Thread: 1 });
    });

    it('filters by type and returns error for unsupported platform', async () => {
      // Filter by type: only Process handles
      factoryState.enumerateProcessHandles.mockReturnValue({
        success: true,
        entries: [
          {
            object: 0x1000000n,
            processId: 1234,
            handleValue: 0x100,
            grantedAccess: 0x1fffff,
            objectTypeIndex: 7,
            handleAttributes: 0,
            typeName: 'Process',
            objectName: 'target.exe',
          },
        ],
        totalSystemHandles: 50000,
        typeIndexCache: new Map(),
      });

      const response = await handlers.handleHandleEnum({
        pid: 1234,
        filterType: 'Process',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.totalHandles).toBe(1);
      expect(parsed.handles[0].objectType).toBe('Process');

      // Error case: elevation required
      factoryState.enumerateProcessHandles.mockReturnValue({
        success: false,
        entries: [],
        totalSystemHandles: 0,
        typeIndexCache: new Map(),
        error: 'Run as Administrator',
        requiresElevation: true,
      });

      const failResp = await handlers.handleHandleEnum({ pid: 9999 });
      const failParsed = parseResponse(failResp);

      expect(failParsed.success).toBe(false);
      expect(failParsed.requiresElevation).toBe(true);
    });
  });
});
