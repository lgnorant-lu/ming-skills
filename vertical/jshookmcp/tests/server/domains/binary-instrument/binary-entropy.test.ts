import { mkdtemp, rm, writeFile as fsWriteFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BinaryScanHandlers } from '@server/domains/binary-instrument/handlers/binary-scan';

function parseJson(res: unknown): Record<string, unknown> {
  const r = res as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text);
}

describe('BinaryScanHandlers — handleBinaryEntropyProfile', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    tempDirs.length = 0;
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeTemp(data: Uint8Array): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'entropy-'));
    tempDirs.push(dir);
    const path = join(dir, 'blob.bin');
    await fsWriteFile(path, data);
    return path;
  }

  it('classifies a uniform-zero buffer as low entropy', async () => {
    const handlers = new BinaryScanHandlers();
    const path = await writeTemp(new Uint8Array(1024).fill(0));
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    expect(result.success).toBe(true);
    const stats = result.stats as { minEntropy: number; maxEntropy: number; avgEntropy: number };
    expect(stats.maxEntropy).toBe(0);
    expect(stats.avgEntropy).toBe(0);
    expect(result.highEntropyRegionCount).toBe(0);
  });

  it('flags a high-entropy (random-looking) region', async () => {
    const handlers = new BinaryScanHandlers();
    // Pseudo-random high-entropy bytes.
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) {
      data[i] = (i * 1103515245 + 12345) & 0xff; // LCG, looks random byte-wise
    }
    const path = await writeTemp(data);
    const result = parseJson(await handlers.handleBinaryEntropyProfile({ filePath: path }));

    const stats = result.stats as { maxEntropy: number };
    expect(stats.maxEntropy).toBeGreaterThan(7.0);
    expect(result.highEntropyRegionCount as number).toBeGreaterThan(0);
    const regions = result.highEntropyRegions as Array<{ entropy: number }>;
    expect(regions[0]!.entropy).toBeGreaterThan(7.0);
  });

  it('respects chunkSize to control sampling resolution', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(1024).fill(0);
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 128 }),
    );

    expect(result.chunkSize).toBe(128);
    expect(result.totalChunks).toBe(8); // 1024 / 128
  });

  it('caps analysis at maxChunks for large files', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(10000).fill(0xaa);
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 64, maxChunks: 50 }),
    );

    expect(result.chunksAnalyzed).toBe(50);
    expect(result.totalChunks).toBe(Math.ceil(10000 / 64));
    expect(result.truncated).toBe(true);
  });

  it('returns offsets as hex for cross-referencing', async () => {
    const handlers = new BinaryScanHandlers();
    const data = new Uint8Array(512);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
    const path = await writeTemp(data);
    const result = parseJson(
      await handlers.handleBinaryEntropyProfile({ filePath: path, chunkSize: 256 }),
    );

    const regions = result.highEntropyRegions as Array<{ offsetHex: string }>;
    if (regions.length > 0) {
      expect(regions[0]!.offsetHex).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it('returns a structured error when filePath is missing', async () => {
    const handlers = new BinaryScanHandlers();
    await expect(handlers.handleBinaryEntropyProfile({})).rejects.toThrow();
  });
});
