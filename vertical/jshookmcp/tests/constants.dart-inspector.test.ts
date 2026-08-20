import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadConstants(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return import('@src/constants');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('dart-inspector constants', () => {
  describe('DART_MIN_LENGTH (minimum string length)', () => {
    it('defaults to 4', async () => {
      expect((await loadConstants({ DART_MIN_LENGTH: undefined })).DART_MIN_LENGTH).toBe(4);
    });
    it('accepts integer env override', async () => {
      expect((await loadConstants({ DART_MIN_LENGTH: '8' })).DART_MIN_LENGTH).toBe(8);
    });
    it('falls back on non-integer env', async () => {
      expect((await loadConstants({ DART_MIN_LENGTH: 'abc' })).DART_MIN_LENGTH).toBe(4);
    });
    it('falls back on empty env', async () => {
      expect((await loadConstants({ DART_MIN_LENGTH: '' })).DART_MIN_LENGTH).toBe(4);
    });
  });

  describe('DART_MIN_LENGTH_FLOOR / CEILING (minLength input bounds)', () => {
    it('floor defaults to 2', async () => {
      expect(
        (await loadConstants({ DART_MIN_LENGTH_FLOOR: undefined })).DART_MIN_LENGTH_FLOOR,
      ).toBe(2);
    });
    it('ceiling defaults to 64', async () => {
      expect(
        (await loadConstants({ DART_MIN_LENGTH_CEILING: undefined })).DART_MIN_LENGTH_CEILING,
      ).toBe(64);
    });
  });

  describe('DART_MAX_CHUNK_BYTES (streaming chunk size)', () => {
    it('defaults to 16 MB', async () => {
      expect((await loadConstants({ DART_MAX_CHUNK_BYTES: undefined })).DART_MAX_CHUNK_BYTES).toBe(
        16 * 1024 * 1024,
      );
    });
    it('accepts integer env override', async () => {
      expect((await loadConstants({ DART_MAX_CHUNK_BYTES: '8388608' })).DART_MAX_CHUNK_BYTES).toBe(
        8_388_608,
      );
    });
  });

  describe('DART_CHUNK_OVERLAP_BYTES (cross-chunk safety margin)', () => {
    it('defaults to 128 (covers UTF-16LE strings up to DART_MIN_LENGTH_CEILING chars)', async () => {
      expect(
        (await loadConstants({ DART_CHUNK_OVERLAP_BYTES: undefined })).DART_CHUNK_OVERLAP_BYTES,
      ).toBe(128);
    });
  });

  describe('DART_PRINTABLE_ASCII_MIN / MAX (ASCII printable range)', () => {
    it('min defaults to 0x20 (space)', async () => {
      expect(
        (await loadConstants({ DART_PRINTABLE_ASCII_MIN: undefined })).DART_PRINTABLE_ASCII_MIN,
      ).toBe(0x20);
    });
    it('max defaults to 0x7E (tilde)', async () => {
      expect(
        (await loadConstants({ DART_PRINTABLE_ASCII_MAX: undefined })).DART_PRINTABLE_ASCII_MAX,
      ).toBe(0x7e);
    });
  });

  describe('DART_DEFAULT_ENCODING (default scan encoding)', () => {
    it("defaults to 'both'", async () => {
      expect(
        (await loadConstants({ DART_DEFAULT_ENCODING: undefined })).DART_DEFAULT_ENCODING,
      ).toBe('both');
    });
    it("accepts 'ascii'", async () => {
      expect((await loadConstants({ DART_DEFAULT_ENCODING: 'ascii' })).DART_DEFAULT_ENCODING).toBe(
        'ascii',
      );
    });
    it("accepts 'utf16le'", async () => {
      expect(
        (await loadConstants({ DART_DEFAULT_ENCODING: 'utf16le' })).DART_DEFAULT_ENCODING,
      ).toBe('utf16le');
    });
    it('falls back on empty env', async () => {
      expect((await loadConstants({ DART_DEFAULT_ENCODING: '' })).DART_DEFAULT_ENCODING).toBe(
        'both',
      );
    });
  });

  describe('DART_MAX_OFFSETS_PER_STRING (offset array cap)', () => {
    it('defaults to 1000', async () => {
      expect(
        (await loadConstants({ DART_MAX_OFFSETS_PER_STRING: undefined }))
          .DART_MAX_OFFSETS_PER_STRING,
      ).toBe(1000);
    });
    it('accepts env override', async () => {
      expect(
        (await loadConstants({ DART_MAX_OFFSETS_PER_STRING: '50' })).DART_MAX_OFFSETS_PER_STRING,
      ).toBe(50);
    });
  });

  describe('DART_MAX_REGEX_PATTERN_LENGTH (customRule safety)', () => {
    it('defaults to 256', async () => {
      expect(
        (await loadConstants({ DART_MAX_REGEX_PATTERN_LENGTH: undefined }))
          .DART_MAX_REGEX_PATTERN_LENGTH,
      ).toBe(256);
    });
  });

  describe('DART_REGEX_TIMEOUT_MS (per-regex runtime guard)', () => {
    it('defaults to 50', async () => {
      expect(
        (await loadConstants({ DART_REGEX_TIMEOUT_MS: undefined })).DART_REGEX_TIMEOUT_MS,
      ).toBe(50);
    });
  });

  describe('DART_ALLOWED_REGEX_FLAGS (customRule flag whitelist)', () => {
    it("defaults to 'iu'", async () => {
      expect(
        (await loadConstants({ DART_ALLOWED_REGEX_FLAGS: undefined })).DART_ALLOWED_REGEX_FLAGS,
      ).toBe('iu');
    });
    it('accepts env override', async () => {
      expect(
        (await loadConstants({ DART_ALLOWED_REGEX_FLAGS: 'i' })).DART_ALLOWED_REGEX_FLAGS,
      ).toBe('i');
    });
  });

  describe('DART_MAX_EXTRACT_DURATION_MS (overall budget)', () => {
    it('defaults to 30000', async () => {
      expect(
        (await loadConstants({ DART_MAX_EXTRACT_DURATION_MS: undefined }))
          .DART_MAX_EXTRACT_DURATION_MS,
      ).toBe(30_000);
    });
    it('accepts env override', async () => {
      expect(
        (await loadConstants({ DART_MAX_EXTRACT_DURATION_MS: '60000' }))
          .DART_MAX_EXTRACT_DURATION_MS,
      ).toBe(60_000);
    });
  });

  describe('DART_MAX_RESULT_BYTES (JSON payload cap)', () => {
    it('defaults to 16 MB', async () => {
      expect(
        (await loadConstants({ DART_MAX_RESULT_BYTES: undefined })).DART_MAX_RESULT_BYTES,
      ).toBe(16 * 1024 * 1024);
    });
  });

  describe('consistency invariants', () => {
    it('CHUNK_OVERLAP_BYTES is less than MAX_CHUNK_BYTES', async () => {
      const c = await loadConstants();
      expect(c.DART_CHUNK_OVERLAP_BYTES).toBeLessThan(c.DART_MAX_CHUNK_BYTES);
    });

    it('MIN_LENGTH default sits within [FLOOR, CEILING]', async () => {
      const c = await loadConstants();
      expect(c.DART_MIN_LENGTH).toBeGreaterThanOrEqual(c.DART_MIN_LENGTH_FLOOR);
      expect(c.DART_MIN_LENGTH).toBeLessThanOrEqual(c.DART_MIN_LENGTH_CEILING);
    });

    it('PRINTABLE_ASCII_MIN is less than MAX', async () => {
      const c = await loadConstants();
      expect(c.DART_PRINTABLE_ASCII_MIN).toBeLessThan(c.DART_PRINTABLE_ASCII_MAX);
    });
  });
});
