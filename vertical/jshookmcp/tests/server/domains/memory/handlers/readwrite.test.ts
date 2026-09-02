import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReadWriteHandlers } from '../../../../../src/server/domains/memory/handlers/readwrite';
import { MemoryAuditTrail } from '../../../../../src/modules/process/memory/AuditTrail';

// Mock MemoryScanSession for batch_edit tests — the handler dynamically imports it
vi.mock('@native/MemoryScanSession', () => ({
  scanSessionManager: {
    getSession: vi.fn(),
  },
}));

vi.mock('@native/formatAddress', () => ({
  formatAddress: vi.fn((addr: bigint) => `0x${addr.toString(16).toUpperCase()}`),
}));

describe('ReadWriteHandlers', () => {
  let handlers: ReadWriteHandlers;
  const dummyArgs = {
    pid: 1234,
    address: '0x7FF612340000',
    value: '100',
    valueType: 'int32',
    intervalMs: 100,
    size: 256,
    freezeId: 'freeze-1',
  };

  const mockmemCtrl = {/* mock */} as any;
  let auditTrail: MemoryAuditTrail;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockmemCtrl).forEach((key) => delete mockmemCtrl[key]);
    // Default: no active freezes — freeze-concurrency guard passes.
    mockmemCtrl.listFreezes = vi.fn().mockReturnValue([]);
    auditTrail = new MemoryAuditTrail();
    handlers = new ReadWriteHandlers(mockmemCtrl, undefined, undefined, auditTrail);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(ReadWriteHandlers);
  });

  describe('handleWriteValue', () => {
    it('returns success response on happy path', async () => {
      mockmemCtrl.writeValue = vi.fn().mockReturnValue({
        id: 'w1',
        address: '0x7FF612340000',
        oldValue: [0],
        newValue: [100],
        pid: 1234,
      });

      const response = await handlers.handleWriteValue(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockmemCtrl.writeValue).toHaveBeenCalledWith(1234, '0x7FF612340000', '100', 'int32');
    });

    it('records a success audit entry on happy path', async () => {
      mockmemCtrl.writeValue = vi.fn().mockReturnValue({
        id: 'w1',
        newValue: [100],
        address: '0x7FF612340000',
      });
      await handlers.handleWriteValue(dummyArgs);
      const entries = JSON.parse(auditTrail.exportJson());
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('write_value');
      expect(entries[0].result).toBe('success');
      expect(entries[0].size).toBe(1);
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.writeValue = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleWriteValue(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('records a failure audit entry on native throw', async () => {
      mockmemCtrl.writeValue = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });
      await handlers.handleWriteValue(dummyArgs);
      const entries = JSON.parse(auditTrail.exportJson());
      expect(entries).toHaveLength(1);
      expect(entries[0].result).toBe('failure');
      expect(entries[0].error).toContain('Native error');
    });

    it('rejects invalid address', async () => {
      mockmemCtrl.writeValue = vi.fn();
      const response = await handlers.handleWriteValue({
        pid: 1234,
        address: 'xyz',
        value: '1',
        valueType: 'int32',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address must be a hex address');
      expect(mockmemCtrl.writeValue).not.toHaveBeenCalled();
    });

    it('rejects invalid valueType', async () => {
      mockmemCtrl.writeValue = vi.fn();
      const response = await handlers.handleWriteValue({
        pid: 1234,
        address: '0x1',
        value: '1',
        valueType: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid valueType');
      expect(mockmemCtrl.writeValue).not.toHaveBeenCalled();
    });
  });

  describe('handleFreeze', () => {
    it('returns success response on happy path', async () => {
      mockmemCtrl.freeze = vi.fn().mockReturnValue({ id: 'f1', address: '0x1' });

      const response = await handlers.handleFreeze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockmemCtrl.freeze).toHaveBeenCalledWith(1234, '0x7FF612340000', '100', 'int32', 100);
    });

    it('records audit on success and failure', async () => {
      mockmemCtrl.freeze = vi.fn().mockReturnValue({ id: 'f1' });
      await handlers.handleFreeze(dummyArgs);
      mockmemCtrl.freeze = vi.fn().mockImplementation(() => {
        throw new Error('boom');
      });
      await handlers.handleFreeze(dummyArgs);
      const entries = JSON.parse(auditTrail.exportJson());
      expect(entries).toHaveLength(2);
      expect(entries[0].result).toBe('success');
      expect(entries[1].result).toBe('failure');
      expect(entries[1].error).toContain('boom');
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.freeze = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleFreeze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing value', async () => {
      mockmemCtrl.freeze = vi.fn();
      const response = await handlers.handleFreeze({
        pid: 1234,
        address: '0x1',
        valueType: 'int32',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"value"');
      expect(mockmemCtrl.freeze).not.toHaveBeenCalled();
    });
  });

  describe('handleUnfreeze', () => {
    it('returns success response on happy path', async () => {
      mockmemCtrl.unfreeze = vi.fn().mockReturnValue(true);

      const response = await handlers.handleUnfreeze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.unfrozen).toBe(true);
      expect(mockmemCtrl.unfreeze).toHaveBeenCalledWith('freeze-1');
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.unfreeze = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleUnfreeze(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing freezeId', async () => {
      mockmemCtrl.unfreeze = vi.fn();
      const response = await handlers.handleUnfreeze({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_freeze');
      expect(parsed.error).toContain('freezeId');
      expect(mockmemCtrl.unfreeze).not.toHaveBeenCalled();
    });
  });

  describe('handleDump', () => {
    it('returns success response on happy path', async () => {
      mockmemCtrl.dumpMemoryHex = vi.fn().mockReturnValue('deadbeef');

      const response = await handlers.handleDump(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.dump).toBe('deadbeef');
      expect(mockmemCtrl.dumpMemoryHex).toHaveBeenCalledWith(1234, '0x7FF612340000', 256);
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.dumpMemoryHex = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleDump(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects non-positive size', async () => {
      mockmemCtrl.dumpMemoryHex = vi.fn();
      const response = await handlers.handleDump({ pid: 1234, address: '0x1', size: 0 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"size" must be a positive number');
      expect(mockmemCtrl.dumpMemoryHex).not.toHaveBeenCalled();
    });
  });

  describe('handleWriteUndo', () => {
    it('returns success response when an entry exists', async () => {
      mockmemCtrl.undo = vi.fn().mockReturnValue({ id: 'w1', pid: 1234, newValue: [1] });

      const response = await handlers.handleWriteUndo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.undone).toBe(true);
    });

    it('returns success response when nothing to undo', async () => {
      mockmemCtrl.undo = vi.fn().mockReturnValue(null);

      const response = await handlers.handleWriteUndo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.undone).toBe(false);
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.undo = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleWriteUndo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleWriteRedo', () => {
    it('returns success response on happy path', async () => {
      mockmemCtrl.redo = vi.fn().mockReturnValue({ id: 'w1', pid: 1234, newValue: [1] });

      const response = await handlers.handleWriteRedo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.redone).toBe(true);
    });

    it('returns error response on failure', async () => {
      mockmemCtrl.redo = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleWriteRedo(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('audit trail integration', () => {
    it('does not throw when no auditTrail is configured', async () => {
      handlers = new ReadWriteHandlers(mockmemCtrl, undefined, undefined, null);
      mockmemCtrl.writeValue = vi.fn().mockReturnValue({ id: 'w1', newValue: [1] });
      const response = await handlers.handleWriteValue(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
    });
  });

  describe('handleBatchEdit', () => {
    const batchEditDummy = { sessionId: 'test-session', value: '999', valueType: 'int32' };

    beforeEach(async () => {
      const { scanSessionManager } = await import('@native/MemoryScanSession');
      (scanSessionManager.getSession as ReturnType<typeof vi.fn>).mockReset();
      mockmemCtrl.writeValue = vi.fn();
    });

    it('rejects missing sessionId', async () => {
      const response = await handlers.handleBatchEdit({
        value: '999',
        valueType: 'int32',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_batch_edit');
      expect(parsed.error).toContain('sessionId');
    });

    it('rejects when session has no addresses', async () => {
      const { scanSessionManager } = await import('@native/MemoryScanSession');
      (scanSessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
        pid: 1234,
        addresses: [],
        valueType: 'int32',
      });

      const response = await handlers.handleBatchEdit(batchEditDummy);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('no addresses');
    });

    it('rejects when session exceeds 1000 address cap', async () => {
      const { scanSessionManager } = await import('@native/MemoryScanSession');
      const bigAddresses = Array.from({ length: 1500 }, (_, i) => BigInt(0x1000 + i * 8));
      (scanSessionManager.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
        pid: 1234,
        addresses: bigAddresses,
        valueType: 'int32',
      });

      const response = await handlers.handleBatchEdit(batchEditDummy);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('exceeds maximum');
    });
  });

  describe('handleWatch', () => {
    const watchDummy = {
      pid: 1234,
      address: '0x7FF612340000',
      valueType: 'int32',
      intervalMs: 100,
      timeoutMs: 2000,
    };

    it('rejects missing address', async () => {
      mockmemCtrl.dumpMemory = vi.fn();
      const response = await handlers.handleWatch({
        pid: 1234,
        valueType: 'int32',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('address must be a hex address');
    });

    it('rejects invalid valueType', async () => {
      mockmemCtrl.dumpMemory = vi.fn();
      const response = await handlers.handleWatch({
        pid: 1234,
        address: '0x7FF612340000',
        valueType: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid valueType');
    });

    it('returns changed=true when value changes', async () => {
      let callCount = 0;
      mockmemCtrl.dumpMemory = vi.fn().mockImplementation(() => {
        callCount++;
        // Return different hex on second call
        if (callCount === 1) return Promise.resolve(Buffer.from([0x64, 0x00, 0x00, 0x00]));
        return Promise.resolve(Buffer.from([0xc8, 0x00, 0x00, 0x00]));
      });

      const response = await handlers.handleWatch(watchDummy);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.changed).toBe(true);
      expect(parsed.oldValue).toBe('64000000');
      expect(parsed.newValue).toBe('c8000000');
      expect(typeof parsed.elapsedMs).toBe('number');
    });

    it('returns changed=false on timeout', async () => {
      mockmemCtrl.dumpMemory = vi
        .fn()
        .mockReturnValue(Promise.resolve(Buffer.from([0x64, 0x00, 0x00, 0x00])));

      const response = await handlers.handleWatch({
        ...watchDummy,
        intervalMs: 100,
        timeoutMs: 300,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.changed).toBe(false);
      expect(parsed.value).toBe('64000000');
    });
  });

  describe('handleFreezeExport', () => {
    it('exports all active freezes as structured JSON', async () => {
      mockmemCtrl.listFreezes = vi.fn().mockReturnValue([
        {
          id: 'f1',
          pid: 1234,
          address: '0x7FF612340000',
          value: [100, 0, 0, 0],
          valueType: 'int32',
          intervalMs: 50,
          isActive: true,
        },
        {
          id: 'f2',
          pid: 1234,
          address: '0x7FF612340008',
          value: [200, 0, 0, 0],
          valueType: 'int32',
          intervalMs: 100,
          isActive: true,
        },
      ]);

      const response = await handlers.handleFreezeExport({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(2);
      expect(parsed.filtered).toBe(false);
      expect(parsed.freezes).toEqual([
        {
          freezeId: 'f1',
          pid: 1234,
          address: '0x7FF612340000',
          value: [100, 0, 0, 0],
          valueType: 'int32',
          intervalMs: 50,
          active: true,
        },
        {
          freezeId: 'f2',
          pid: 1234,
          address: '0x7FF612340008',
          value: [200, 0, 0, 0],
          valueType: 'int32',
          intervalMs: 100,
          active: true,
        },
      ]);
    });

    it('filters by pid when pid argument is provided', async () => {
      mockmemCtrl.listFreezes = vi.fn().mockReturnValue([
        {
          id: 'f1',
          pid: 1234,
          address: '0x1000',
          value: [1],
          valueType: 'byte',
          intervalMs: 50,
          isActive: true,
        },
        {
          id: 'f2',
          pid: 5678,
          address: '0x2000',
          value: [2],
          valueType: 'byte',
          intervalMs: 100,
          isActive: true,
        },
      ]);

      const response = await handlers.handleFreezeExport({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);
      expect(parsed.filtered).toBe(true);
      expect(parsed.freezes[0].freezeId).toBe('f1');
      expect(parsed.freezes[0].pid).toBe(1234);
    });
  });
});
