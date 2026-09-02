import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanHandlers } from '../../../../../src/server/domains/memory/handlers/scan';

const factoryState = vi.hoisted(() => ({
  openProcess: vi.fn(),
  readMemory: vi.fn(),
  closeProcess: vi.fn(),
}));

// Lock the search-string memory-read path onto a fake provider so the
// b3-09/a4-01 createPlatformProvider() migration is exercised (not the real
// Win32/Darwin/Linux FFI provider). Mirrors structure.test.ts:13.
vi.mock('@native/platform/factory.js', () => ({
  createPlatformProvider: vi.fn(() => ({
    openProcess: factoryState.openProcess,
    readMemory: factoryState.readMemory,
    closeProcess: factoryState.closeProcess,
  })),
}));

describe('ScanHandlers', () => {
  let handlers: ScanHandlers;
  // Valid args covering every field the handlers read. Individual tests override
  // only the fields relevant to the scenario under test.
  const dummyArgs = {
    pid: 1234,
    value: '1.2',
    valueType: 'float',
    mode: 'exact',
    sessionId: 'test-session',
    targetAddress: '0x7FF612340000',
    alignment: 4,
    maxResults: 100,
    pattern: [
      { offset: 0, value: '100', type: 'int32' },
      { offset: 4, value: '3.14', type: 'float' },
    ],
  };

  const mockscanner = {/* mock */} as any;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockscanner).forEach((key) => delete mockscanner[key]);
    handlers = new ScanHandlers(mockscanner);
  });

  it('instantiates correctly', async () => {
    expect(handlers).toBeInstanceOf(ScanHandlers);
  });

  describe('handleFirstScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.firstScan = vi
        .fn()
        .mockReturnValue({ totalMatches: 0, sessionId: 's1', results: [] });

      const response = await handlers.handleFirstScan(dummyArgs);
      expect(response).toEqual({
        content: [expect.objectContaining({ type: 'text' })],
        // ResponseBuilder.json() carries a top-level success flag (a1-02 fix).
        success: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.firstScan).toHaveBeenCalledWith(
        1234,
        '1.2',
        expect.objectContaining({ valueType: 'float', alignment: 4, maxResults: 100 }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.firstScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleFirstScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing valueType with a contextual error', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({ pid: 1234, value: '1.2' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_first_scan');
      expect(parsed.error).toContain('valueType');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('rejects invalid valueType with the allowed set in the message', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({
        pid: 1234,
        value: '1.2',
        valueType: 'bogus',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid valueType');
      expect(parsed.error).toContain('"bogus"');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('rejects missing value', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleFirstScan({ pid: 1234, valueType: 'float' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"value"');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });
  });

  describe('handleNextScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.nextScan = vi.fn().mockReturnValue({ totalMatches: 0, addresses: [] });

      const response = await handlers.handleNextScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.nextScan).toHaveBeenCalledWith(
        'test-session',
        'exact',
        '1.2',
        undefined,
        undefined,
        undefined,
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.nextScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleNextScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing sessionId', async () => {
      mockscanner.nextScan = vi.fn();
      const response = await handlers.handleNextScan({ mode: 'exact' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_next_scan');
      expect(parsed.error).toContain('sessionId');
      expect(mockscanner.nextScan).not.toHaveBeenCalled();
    });

    it('rejects invalid mode', async () => {
      mockscanner.nextScan = vi.fn();
      const response = await handlers.handleNextScan({ sessionId: 's1', mode: 'bogus' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid mode');
      expect(mockscanner.nextScan).not.toHaveBeenCalled();
    });

    it('normalizes not_equal_to to not_equal for the native scanner', async () => {
      mockscanner.nextScan = vi.fn().mockReturnValue({ totalMatches: 5, addresses: [] });

      const response = await handlers.handleNextScan({
        sessionId: 'test-session',
        mode: 'not_equal_to',
        value: '100',
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.nextScan).toHaveBeenCalledWith(
        'test-session',
        'not_equal',
        '100',
        undefined,
        undefined,
        undefined,
      );
    });

    it('skips excludeValues post-filter when addresses array is empty', async () => {
      mockscanner.nextScan = vi.fn().mockReturnValue({ totalMatches: 0, addresses: [] });

      const response = await handlers.handleNextScan({
        sessionId: 'test-session',
        mode: 'exact',
        value: '100',
        excludeValues: ['aabb'],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      // excludeValues is a no-op when addresses are empty
      expect(parsed.totalMatches).toBe(0);
    });
  });

  describe('handleUnknownScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handleUnknownScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.unknownInitialScan).toHaveBeenCalledWith(
        1234,
        expect.objectContaining({ valueType: 'float' }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.unknownInitialScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleUnknownScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects missing valueType', async () => {
      mockscanner.unknownInitialScan = vi.fn();
      const response = await handlers.handleUnknownScan({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_unknown_scan');
      expect(parsed.error).toContain('valueType');
      expect(mockscanner.unknownInitialScan).not.toHaveBeenCalled();
    });
  });

  describe('handlePointerScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.pointerScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handlePointerScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.pointerScan).toHaveBeenCalledWith(
        1234,
        '0x7FF612340000',
        expect.objectContaining({ moduleOnly: false }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.pointerScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handlePointerScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects invalid targetAddress', async () => {
      mockscanner.pointerScan = vi.fn();
      const response = await handlers.handlePointerScan({ pid: 1234, targetAddress: 'not-hex' });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('targetAddress must be a hex address');
      expect(mockscanner.pointerScan).not.toHaveBeenCalled();
    });
  });

  describe('handleGroupScan', () => {
    it('returns success response on happy path', async () => {
      mockscanner.groupScan = vi.fn().mockReturnValue({ totalMatches: 0, results: [] });

      const response = await handlers.handleGroupScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(mockscanner.groupScan).toHaveBeenCalledWith(
        1234,
        [
          { offset: 0, value: '100', type: 'int32' },
          { offset: 4, value: '3.14', type: 'float' },
        ],
        expect.objectContaining({ alignment: 4, maxResults: 100 }),
      );
    });

    it('returns error response on failure', async () => {
      mockscanner.groupScan = vi.fn().mockImplementation(() => {
        throw new Error('Native error');
      });

      const response = await handlers.handleGroupScan(dummyArgs);
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Native error');
    });

    it('rejects empty pattern', async () => {
      mockscanner.groupScan = vi.fn();
      const response = await handlers.handleGroupScan({ pid: 1234, pattern: [] });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('memory_group_scan');
      expect(parsed.error).toContain('pattern');
      expect(mockscanner.groupScan).not.toHaveBeenCalled();
    });

    it('rejects pattern element with invalid type', async () => {
      mockscanner.groupScan = vi.fn();
      const response = await handlers.handleGroupScan({
        pid: 1234,
        pattern: [{ offset: 0, value: '1', type: 'bogus' }],
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('index 0');
      expect(parsed.error).toContain('"type"');
      expect(mockscanner.groupScan).not.toHaveBeenCalled();
    });
  });

  describe('handleSearchString', () => {
    const handle = { pid: 1234, writeAccess: false };

    /** Serve NUL-terminated UTF-8 strings keyed by address hex from the fake provider. */
    const serveStrings = (map: Record<string, string>) => {
      factoryState.readMemory.mockImplementation(async (_h, addr, size) => {
        const buf = Buffer.alloc(size, 0);
        const hex = `0x${(addr as bigint).toString(16).toUpperCase()}`;
        const value = map[hex];
        if (value) buf.write(value, 'utf8');
        return { data: buf, bytesRead: size };
      });
    };

    beforeEach(() => {
      factoryState.openProcess.mockReturnValue(handle);
      factoryState.closeProcess.mockClear();
    });

    it('returns a real hit by reading NUL-terminated bytes at matched addresses', async () => {
      mockscanner.firstScan = vi.fn().mockResolvedValue({ addresses: ['0x1000'] });
      serveStrings({ '0x1000': 'hello_world' });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'hello',
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(1);
      expect(parsed.results[0]).toMatchObject({
        address: '0x1000',
        value: 'hello_world',
        encoding: 'utf8',
        length: 11,
      });
      expect(mockscanner.firstScan).toHaveBeenCalledWith(
        1234,
        'hello',
        expect.objectContaining({ valueType: 'string', alignment: 1 }),
      );
      expect(factoryState.openProcess).toHaveBeenCalledWith(1234, false);
      expect(factoryState.closeProcess).toHaveBeenCalledWith(handle);
    });

    it('parses unprefixed addresses as hex when reading strings', async () => {
      // Scanner addresses are normally 0x-prefixed, but the read path must not
      // depend on that: "1000" must resolve to 0x1000 (hex), not 1000 (decimal).
      mockscanner.firstScan = vi.fn().mockResolvedValue({ addresses: ['1000'] });
      serveStrings({ '0x1000': 'hello_world' });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'hello',
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(1);
      expect(parsed.results[0]).toMatchObject({
        address: '1000',
        value: 'hello_world',
        encoding: 'utf8',
        length: 11,
      });
    });

    it('post-filters results by substring match', async () => {
      mockscanner.firstScan = vi.fn().mockResolvedValue({
        addresses: ['0x1000', '0x2000', '0x3000'],
      });
      serveStrings({
        '0x1000': 'TargetValue',
        '0x2000': 'OtherStuff',
        '0x3000': 'target_again',
      });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'target',
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(2);
      expect(parsed.results.map((r: any) => r.value)).toEqual(['TargetValue', 'target_again']);
    });

    it('supports regex mode', async () => {
      mockscanner.firstScan = vi.fn().mockResolvedValue({
        addresses: ['0x1000', '0x2000', '0x3000'],
      });
      serveStrings({ '0x1000': 'foo123', '0x2000': 'bar456', '0x3000': 'baz789' });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: '^[a-z]+\\d+$',
        regex: true,
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(3);
      expect(parsed.isRegex).toBe(true);
    });

    it('rejects invalid regex pattern', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: '[invalid(regex',
        regex: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('invalid regex pattern');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('rejects missing pattern', async () => {
      mockscanner.firstScan = vi.fn();
      const response = await handlers.handleSearchString({ pid: 1234 });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('"pattern"');
      expect(mockscanner.firstScan).not.toHaveBeenCalled();
    });

    it('enforces minLength filter', async () => {
      mockscanner.firstScan = vi.fn().mockResolvedValue({
        addresses: ['0x1000', '0x2000', '0x3000'],
      });
      serveStrings({ '0x1000': 'ab', '0x2000': 'abc', '0x3000': 'abcd' });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'ab',
        minLength: 3,
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(2);
    });

    it('scans wide strings when wide=true', async () => {
      mockscanner.firstScan = vi
        .fn()
        .mockResolvedValueOnce({ addresses: [] })
        .mockResolvedValueOnce({ addresses: ['0x4000'] });
      factoryState.readMemory.mockImplementation(async (_h, addr, size) => {
        const buf = Buffer.alloc(size, 0);
        if ((addr as bigint) === 0x4000n) buf.write('Hello', 'utf16le');
        return { data: buf, bytesRead: size };
      });

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'Hello',
        wide: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.totalFound).toBe(1);
      expect(parsed.results[0].encoding).toBe('utf16le');
      expect(parsed.results[0].value).toBe('Hello');
    });

    it('caps results to maxResults', async () => {
      const addresses = Array.from(
        { length: 100 },
        (_, i) => `0x${(0x1000 + i * 8).toString(16).toUpperCase()}`,
      );
      const map: Record<string, string> = {};
      for (let i = 0; i < addresses.length; i += 1) {
        map[addresses[i]!] = `pattern_match_${i}`;
      }
      mockscanner.firstScan = vi.fn().mockResolvedValue({ addresses });
      serveStrings(map);

      const response = await handlers.handleSearchString({
        pid: 1234,
        pattern: 'pattern',
        maxResults: 10,
        wide: false,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.results.length).toBe(10);
      expect(parsed.truncated).toBe(true);
      expect(parsed.totalFound).toBe(100);
    });
  });

  describe('Encrypted value search (GameGuardian parity)', () => {
    it('returns encryptedAddresses when encrypted=true with int32', async () => {
      mockscanner.firstScan = vi
        .fn()
        .mockResolvedValueOnce({
          totalMatches: 1,
          sessionId: 's1',
          addresses: ['0x7FF612340010'],
          matchCount: 1,
          scanNumber: 1,
          truncated: false,
          elapsed: '2ms',
        })
        .mockResolvedValueOnce({
          totalMatches: 1,
          sessionId: 's2',
          addresses: ['0x7FF612340020'],
          matchCount: 1,
          scanNumber: 1,
          truncated: false,
          elapsed: '1ms',
        });

      const response = await handlers.handleFirstScan({
        pid: 1234,
        value: '100',
        valueType: 'int32',
        encrypted: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.encryptedScan).toBe(true);
      expect(parsed.encryptedAddresses).toEqual(['0x7FF612340020']);
      expect(parsed.xorKey).toBe(0xff);
    });

    it('skips encrypted scan for float type (not supported)', async () => {
      mockscanner.firstScan = vi.fn().mockResolvedValue({
        totalMatches: 3,
        sessionId: 's1',
        addresses: ['0x1000', '0x2000', '0x3000'],
        matchCount: 3,
        scanNumber: 1,
        truncated: false,
        elapsed: '4ms',
      });

      const response = await handlers.handleFirstScan({
        pid: 1234,
        value: '3.14',
        valueType: 'float',
        encrypted: true,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      // encryptedAddresses should not be set for float
      expect(parsed.encryptedAddresses).toBeUndefined();
    });

    it('uses custom xorKey parameter', async () => {
      mockscanner.firstScan = vi
        .fn()
        .mockResolvedValueOnce({
          totalMatches: 0,
          sessionId: 's1',
          addresses: [],
          matchCount: 0,
          scanNumber: 1,
          truncated: false,
          elapsed: '1ms',
        })
        .mockResolvedValueOnce({
          totalMatches: 1,
          sessionId: 's2',
          addresses: ['0x5000'],
          matchCount: 1,
          scanNumber: 1,
          truncated: false,
          elapsed: '1ms',
        });

      const response = await handlers.handleFirstScan({
        pid: 1234,
        value: '42',
        valueType: 'int32',
        encrypted: true,
        xorKey: 0xaa,
      });
      const parsed = JSON.parse((response.content[0] as any).text);
      expect(parsed.success).toBe(true);
      expect(parsed.xorKey).toBe(0xaa);
      expect(parsed.encryptedAddresses).toEqual(['0x5000']);
    });
  });

  describe('Custom scan types (CE parity)', () => {
    it('registers and lists custom types', async () => {
      const regResp = await handlers.handleRegisterType({
        name: 'custom_hp',
        size: 4,
        encoding: 'int',
        endian: 'le',
      });
      const regParsed = JSON.parse((regResp.content[0] as any).text);
      expect(regParsed.success).toBe(true);
      expect(regParsed.type.name).toBe('custom_hp');

      const listResp = await handlers.handleListTypes({});
      const listParsed = JSON.parse((listResp.content[0] as any).text);
      expect(listParsed.success).toBe(true);
      expect(listParsed.count).toBeGreaterThanOrEqual(1);
      expect(listParsed.types.some((t: any) => t.name === 'custom_hp')).toBe(true);
    });

    it('unregisters a custom type', async () => {
      await handlers.handleRegisterType({
        name: 'tmp_type',
        size: 2,
        encoding: 'uint',
      });

      const unregResp = await handlers.handleUnregisterType({ name: 'tmp_type' });
      const unregParsed = JSON.parse((unregResp.content[0] as any).text);
      expect(unregParsed.success).toBe(true);
      expect(unregParsed.name).toBe('tmp_type');
    });

    it('rejects duplicate type name', async () => {
      await handlers.handleRegisterType({
        name: 'dup_type',
        size: 1,
        encoding: 'hex',
      });

      const dupResp = await handlers.handleRegisterType({
        name: 'dup_type',
        size: 4,
        encoding: 'int',
      });
      const dupParsed = JSON.parse((dupResp.content[0] as any).text);
      expect(dupParsed.success).toBe(false);
      expect(dupParsed.error).toContain('already registered');
    });
  });
});
