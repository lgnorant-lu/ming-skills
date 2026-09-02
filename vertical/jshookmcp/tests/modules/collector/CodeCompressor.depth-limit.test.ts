import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CodeCompressor } from '@modules/collector/CodeCompressor';

describe('CodeCompressor recursion depth limit', () => {
  it('rejects chunked payloads nested beyond MAX_RECURSION_DEPTH', async () => {
    const compressor = new CodeCompressor();

    // Build a deeply-nested chunked envelope (depth 17 > 16 limit). Nesting
    // beyond ~20 levels would blow up the string exponentially via JSON
    // escaping, so 17 (just past the limit) is the sweet spot.
    let payload = JSON.stringify({ format: 'code-compressor-chunks', chunks: ['x'] });
    for (let i = 0; i < 16; i++) {
      payload = JSON.stringify({ format: 'code-compressor-chunks', chunks: [payload] });
    }

    await expect(compressor.decompress(payload)).rejects.toThrow(/chunked payload/i);
  });

  it('still decompresses legitimately nested chunked payloads (depth 1)', async () => {
    const compressor = new CodeCompressor();
    const source = 'depth-guard-'.repeat(200);

    const compressed = await compressor.compressStream(source, { chunkSize: 64 });
    expect(compressed.chunks).toBeGreaterThan(1);

    const restored = await compressor.decompress(compressed.compressed);
    expect(restored).toBe(source);
  });

  it('keeps the plain single-chunk decompress path working', async () => {
    const compressor = new CodeCompressor();
    const source = 'plain-payload-'.repeat(10);

    const compressed = await compressor.compress(source);
    const restored = await compressor.decompress(compressed.compressed);

    expect(restored).toBe(source);
  });
});
