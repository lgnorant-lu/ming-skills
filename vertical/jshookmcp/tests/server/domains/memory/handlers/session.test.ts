import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionHandlers } from '../../../../../src/server/domains/memory/handlers/session';

describe('SessionHandlers', () => {
  let handlers: SessionHandlers;
  const dummyArgs = {
    sessionId: 'test-session',
    pattern: '12 34',
    pid: 1234,
    structure: '{"fields":[]}',
    name: 'test',
    type: 'float',
    size: 4,
    value: '1.2',
  };

  const mocksessionManager = {/* mock */} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocksessionManager).forEach((key) => delete mocksessionManager[key]);
    handlers = new SessionHandlers(mocksessionManager);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(SessionHandlers);
  });

  describe('handleScanList', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.listSessions = vi.fn().mockReturnValue([{ id: 's1' }]);

      const response = await handlers.handleScanList(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
        // ResponseBuilder.json() carries a top-level success flag (a1-02 fix).
        success: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.count).toBe(1);
    });

    it('returns error response on failure', async () => {
      mocksessionManager.listSessions = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanList(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });
  });

  describe('handleScanDelete', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.deleteSession = vi.fn().mockReturnValue(true);

      const response = await handlers.handleScanDelete(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.deleted).toBe(true);
      expect(mocksessionManager.deleteSession).toHaveBeenCalledWith('test-session');
    });

    it('returns error response on failure', async () => {
      mocksessionManager.deleteSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanDelete(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing sessionId', async () => {
      mocksessionManager.deleteSession = vi.fn();
      const response = await handlers.handleScanDelete({});
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_scan_session');
      expect(parsed.error).toContain('sessionId');
      expect(mocksessionManager.deleteSession).not.toHaveBeenCalled();
    });
  });

  describe('handleScanExport', () => {
    it('returns success response on happy path', async () => {
      mocksessionManager.exportSession = vi.fn().mockReturnValue('exported-blob');

      const response = await handlers.handleScanExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.exportedData).toBe('exported-blob');
      expect(mocksessionManager.exportSession).toHaveBeenCalledWith('test-session');
    });

    it('returns error response on failure', async () => {
      mocksessionManager.exportSession = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleScanExport(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects empty sessionId', async () => {
      mocksessionManager.exportSession = vi.fn();
      const response = await handlers.handleScanExport({ sessionId: '' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_scan_session');
      expect(mocksessionManager.exportSession).not.toHaveBeenCalled();
    });
  });

  describe('handleSessionExportData', () => {
    it('exports a session as structured JSON with addresses and values', async () => {
      const addrBig1 = BigInt(0x7ff612340000);
      const addrBig2 = BigInt(0x7ff612340008);
      mocksessionManager.getSession = vi.fn().mockReturnValue({
        id: 'test-session',
        pid: 1234,
        valueType: 'int32',
        scanCount: 3,
        addresses: [addrBig1, addrBig2],
        previousValues: new Map([
          [addrBig1, Buffer.from([0x64, 0x00, 0x00, 0x00])],
          [addrBig2, Buffer.from([0xc8, 0x00, 0x00, 0x00])],
        ]),
        createdAt: 1700000000000,
        lastScanAt: 1700000001000,
        alignment: 4,
      });

      const response = await handlers.handleSessionExportData({
        sessionId: 'test-session',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.sessionId).toBe('test-session');
      expect(parsed.pid).toBe(1234);
      expect(parsed.valueType).toBe('int32');
      expect(parsed.scanCount).toBe(3);
      expect(parsed.addresses).toEqual(['0x7FF612340000', '0x7FF612340008']);
      expect(parsed.values).toBeTypeOf('object');
      expect(parsed.metadata.totalAddresses).toBe(2);
      expect(parsed.metadata.truncated).toBe(false);
      expect(mocksessionManager.getSession).toHaveBeenCalledWith('test-session');
    });

    it('sets truncated flag when address count exceeds 100K cap', async () => {
      const addrBig = BigInt(0x1000);
      const addrs: bigint[] = [];
      const vals = new Map<bigint, Buffer>();
      for (let i = 0; i < 150_000; i++) {
        const a = addrBig + BigInt(i * 8);
        addrs.push(a);
        vals.set(a, Buffer.from([0x00, 0x00, 0x00, 0x00]));
      }
      mocksessionManager.getSession = vi.fn().mockReturnValue({
        id: 'big-session',
        pid: 5678,
        valueType: 'int64',
        scanCount: 1,
        addresses: addrs,
        previousValues: vals,
        createdAt: 1700000000000,
        lastScanAt: 1700000001000,
        alignment: 8,
      });

      const response = await handlers.handleSessionExportData({
        sessionId: 'big-session',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.metadata.totalAddresses).toBe(150_000);
      expect(parsed.metadata.truncated).toBe(true);
      expect(parsed.addresses.length).toBe(100_000);
    });
  });
});
