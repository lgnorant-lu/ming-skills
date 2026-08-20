import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('search/EmbeddingCache', () => {
  let cacheDir: string;

  beforeEach(async () => {
    vi.resetModules();
    cacheDir = await mkdtemp(join(tmpdir(), 'jshook-emb-cache-'));
    process.env.JSHOOK_EMBEDDING_CACHE_DIR = cacheDir;
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      SEARCH_VECTOR_CACHE_ENABLED: true,
      SEARCH_VECTOR_MODEL_ID: 'test-model',
    }));
  });

  afterEach(async () => {
    delete process.env.JSHOOK_EMBEDDING_CACHE_DIR;
    vi.doUnmock('@src/constants');
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('round-trips aligned embeddings through the disk cache', async () => {
    const {
      buildEmbeddingFingerprint,
      decodeEmbeddings,
      encodeEmbeddings,
      loadToolEmbeddingsCache,
      saveToolEmbeddingsCache,
    } = await import('@server/search/EmbeddingCache');
    const descriptions = ['page navigate: open url', 'page click: click element'];
    const embeddings = [
      new Float32Array([0.1, 0.2, 0.3, 0.4]),
      new Float32Array([0.5, 0.6, 0.7, 0.8]),
    ];

    expect(buildEmbeddingFingerprint('test-model', descriptions)).toHaveLength(64);
    const encoded = encodeEmbeddings(embeddings);
    const decoded = decodeEmbeddings(encoded.data, embeddings.length, encoded.dim);
    expect(decoded?.[0]?.[0]).toBeCloseTo(0.1, 5);
    expect(decoded?.[1]?.[3]).toBeCloseTo(0.8, 5);

    await saveToolEmbeddingsCache('test-model', descriptions, embeddings);
    const loaded = await loadToolEmbeddingsCache('test-model', descriptions);
    expect(loaded).toHaveLength(2);
    expect(loaded?.[0]?.[1]).toBeCloseTo(0.2, 5);
    expect(loaded?.[1]?.[2]).toBeCloseTo(0.7, 5);
  });

  it('misses when the model or catalog fingerprint changes', async () => {
    const { loadToolEmbeddingsCache, saveToolEmbeddingsCache } =
      await import('@server/search/EmbeddingCache');
    const descriptions = ['a: one', 'b: two'];
    const embeddings = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    await saveToolEmbeddingsCache('test-model', descriptions, embeddings);

    expect(await loadToolEmbeddingsCache('test-model', ['a: one', 'b: changed'])).toBeNull();
    expect(await loadToolEmbeddingsCache('other-model', descriptions)).toBeNull();
  });

  it('rejects malformed dimensions without allocating unsafe typed arrays', async () => {
    const { decodeEmbeddings } = await import('@server/search/EmbeddingCache');
    expect(decodeEmbeddings('AAAA', 1, 1)).toBeNull();
    expect(decodeEmbeddings('', 0, 0)).toEqual([]);
    expect(decodeEmbeddings('AAAA', Number.MAX_SAFE_INTEGER, 2)).toBeNull();
  });
});
