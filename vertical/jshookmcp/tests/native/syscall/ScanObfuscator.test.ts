import { describe, expect, it } from 'vitest';

import { createScanWalker, DEFAULT_OBFUSCATION_CONFIG } from '@src/native/syscall/ScanObfuscator';

describe('createScanWalker', () => {
  it('produces chunk sizes within the configured bounds', () => {
    const walker = createScanWalker(DEFAULT_OBFUSCATION_CONFIG, 42);
    for (let i = 0; i < 50; i++) {
      const size = walker.chunkSize;
      expect(size).toBeGreaterThanOrEqual(DEFAULT_OBFUSCATION_CONFIG.minChunkBytes);
      expect(size).toBeLessThanOrEqual(DEFAULT_OBFUSCATION_CONFIG.maxChunkBytes);
    }
  });

  it('normalizes a reversed min/max chunk config instead of producing a huge size', () => {
    // minChunkBytes > maxChunkBytes: prng.range(max - min + 1) goes negative,
    // and `>>> 0` turns it into a ~4 GiB modulus — chunkSize would explode.
    const walker = createScanWalker(
      {
        ...DEFAULT_OBFUSCATION_CONFIG,
        minChunkBytes: 32 * 1024 * 1024,
        maxChunkBytes: 4 * 1024 * 1024,
      },
      7,
    );
    for (let i = 0; i < 50; i++) {
      const size = walker.chunkSize;
      expect(size).toBeGreaterThanOrEqual(4 * 1024 * 1024);
      expect(size).toBeLessThanOrEqual(32 * 1024 * 1024);
    }
  });

  it('keeps the walk stride positive even with a large jitter', () => {
    const walker = createScanWalker(
      {
        ...DEFAULT_OBFUSCATION_CONFIG,
        stridePages: 4,
        jitterPages: 100,
      },
      3,
    );
    const last = walker.address;
    expect(walker.next()).toBe(true);
    expect(walker.address).toBeGreaterThan(last);
  });
});
