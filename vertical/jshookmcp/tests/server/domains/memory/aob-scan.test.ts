import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScanHandlers } from '../../../../src/server/domains/memory/handlers/scan';

describe('ScanHandlers — AOB Scan', () => {
  let handlers: ScanHandlers;

  const mockscanner = {
    aobScan: vi.fn(),
    firstScan: vi.fn(),
    nextScan: vi.fn(),
    unknownInitialScan: vi.fn(),
    pointerScan: vi.fn(),
    groupScan: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ScanHandlers(mockscanner);
  });

  // ── Helper ──

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('handleAobScan', () => {
    it('1. basic pattern with no wildcards finds exact match', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340010', '0x7FF612340120'],
        totalMatches: 2,
        elapsed: '5ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8B 05 00 00 00 00',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.matches).toEqual(['0x7FF612340010', '0x7FF612340120']);
      expect(parsed.totalMatches).toBe(2);
      expect(mockscanner.aobScan).toHaveBeenCalledWith(
        1234,
        '48 8B 05 00 00 00 00',
        expect.objectContaining({ maxResults: 10000 }),
      );
    });

    it('2. pattern with ?? wildcards matches', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340010'],
        totalMatches: 1,
        elapsed: '3ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8B ?? ?? 00 00',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.totalMatches).toBe(1);
      expect(mockscanner.aobScan).toHaveBeenCalledWith(
        1234,
        '48 8B ?? ?? 00 00',
        expect.any(Object),
      );
    });

    it('3. invalid pattern format returns error (non-hex chars)', async () => {
      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 GG 05 00',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid AOB pattern');
    });

    it('4. pattern with mixed hex and wildcards', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340050'],
        totalMatches: 1,
        elapsed: '4ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '0x48 0x8B ?? 00 00 00 0xFF',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(parsed.totalMatches).toBe(1);
    });

    it('5. empty pattern string returns error', async () => {
      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('pattern');
    });

    it('6. moduleName filter works', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340100'],
        totalMatches: 1,
        elapsed: '2ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8B 05',
        moduleName: 'kernel32.dll',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(mockscanner.aobScan).toHaveBeenCalledWith(
        1234,
        '48 8B 05',
        expect.objectContaining({ moduleName: 'kernel32.dll' }),
      );
    });

    it('7. pattern with case-insensitive hex', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340100'],
        totalMatches: 1,
        elapsed: '1ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8b 05 0a ff',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(mockscanner.aobScan).toHaveBeenCalledWith(1234, '48 8b 05 0a ff', expect.any(Object));
    });

    it('8. missing pid falls back to session pid', async () => {
      // When pid is undefined, resolvePid should handle it
      // With no processManager, it should error on invalid pid
      const response = await handlers.handleAobScan({
        pattern: '48 8B 05',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid PID');
    });

    it('9. pattern with single byte works', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x7FF612340010'],
        totalMatches: 1,
        elapsed: '1ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: 'CC',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
    });

    it('10. maxResults option is respected', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: ['0x1'],
        totalMatches: 1,
        elapsed: '1ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '90 90',
        maxResults: 50,
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
      expect(mockscanner.aobScan).toHaveBeenCalledWith(
        1234,
        '90 90',
        expect.objectContaining({ maxResults: 50 }),
      );
    });

    it('11. null bytes in pattern are accepted', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: [],
        totalMatches: 0,
        elapsed: '0ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '00 00 00 00 FF 00',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
    });

    it('12. wildcard-only pattern is valid (any 1-byte wildcard)', async () => {
      mockscanner.aobScan = vi.fn().mockResolvedValue({
        matches: [],
        totalMatches: 0,
        elapsed: '0ms',
      });

      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '?? ??',
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(true);
    });
  });

  describe('AOB pattern validation', () => {
    it('rejects pattern with odd number of hex chars', async () => {
      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8 B5', // "8" is single char, "B5" is valid
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid AOB pattern');
    });

    it('rejects pattern with 3-character hex', async () => {
      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 8B5 00', // "8B5" is 3 chars
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid AOB pattern');
    });

    it('rejects pattern with single wildcard ?', async () => {
      const response = await handlers.handleAobScan({
        pid: 1234,
        pattern: '48 ?8 05', // single ? is not valid; wildcard is ??
      });
      const parsed = parseResponse(response);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Invalid AOB pattern');
    });
  });
});
