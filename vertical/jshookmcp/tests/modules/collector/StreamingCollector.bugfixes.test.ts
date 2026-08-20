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

import { StreamingCollector, type StreamChunk } from '@modules/collector/StreamingCollector';

describe('StreamingCollector bug fixes', () => {
  it('flags a maxChunks-capped stream as truncated instead of claiming isLast', async () => {
    const collector = new StreamingCollector();
    const file = {
      url: 'big.js',
      content: 'x'.repeat(10000),
      size: 10000,
      type: 'external' as const,
    };

    const chunks: StreamChunk[] = [];
    for await (const chunk of collector.streamFile(file, { chunkSize: 100, maxChunks: 5 })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(5);
    // The file did not fully stream: the final emitted chunk must not lie about
    // completion, and must carry the truncated marker instead.
    const last = chunks[chunks.length - 1]!;
    expect(last.isLast).toBe(false);
    expect(last.truncated).toBe(true);
  });

  it('marks complete streams with isLast and no truncated flag', async () => {
    const collector = new StreamingCollector();
    const file = { url: 'small.js', content: 'abcdef', size: 6, type: 'external' as const };

    const chunks: StreamChunk[] = [];
    for await (const chunk of collector.streamFile(file, { chunkSize: 2, maxChunks: 5 })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[chunks.length - 1]?.isLast).toBe(true);
    expect(chunks[chunks.length - 1]?.truncated).toBeUndefined();
  });
});
