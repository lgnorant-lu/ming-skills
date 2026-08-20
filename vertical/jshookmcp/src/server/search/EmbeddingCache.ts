import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { SEARCH_VECTOR_CACHE_ENABLED, SEARCH_VECTOR_MODEL_ID } from '@src/constants';
import { logger } from '@utils/logger';

const CACHE_VERSION = 1;

export interface EmbeddingCachePayload {
  version: number;
  modelId: string;
  fingerprint: string;
  dim: number;
  count: number;
  data: string;
}

export function buildEmbeddingFingerprint(
  modelId: string,
  descriptions: readonly string[],
): string {
  const hash = createHash('sha256');
  hash.update(modelId);
  hash.update('\0');
  hash.update(String(descriptions.length));
  hash.update('\0');
  for (const description of descriptions) {
    hash.update(description);
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function getEmbeddingCachePath(modelId: string = SEARCH_VECTOR_MODEL_ID): string {
  const overridden = process.env.JSHOOK_EMBEDDING_CACHE_DIR?.trim();
  const base = overridden
    ? resolve(overridden)
    : resolve(homedir(), '.jshookmcp', 'cache', 'embeddings');
  const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const modelHash = createHash('sha256').update(modelId).digest('hex').slice(0, 12);
  return resolve(base, `${safeModel}-${modelHash}.json`);
}

export function encodeEmbeddings(embeddings: readonly Float32Array[]): {
  dim: number;
  data: string;
} {
  if (embeddings.length === 0) return { dim: 0, data: '' };

  const dim = embeddings[0]!.length;
  if (dim <= 0) throw new Error('Embedding dimension must be positive');
  const packed = new Float32Array(embeddings.length * dim);
  for (let i = 0; i < embeddings.length; i++) {
    const row = embeddings[i]!;
    if (row.length !== dim) {
      throw new Error(`Embedding dim mismatch at index ${i}: expected ${dim}, got ${row.length}`);
    }
    packed.set(row, i * dim);
  }
  return {
    dim,
    data: Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength).toString('base64'),
  };
}

export function decodeEmbeddings(data: string, count: number, dim: number): Float32Array[] | null {
  if (count === 0 && dim === 0 && data === '') return [];
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(dim) || dim <= 0 || !data) {
    return null;
  }

  const buf = Buffer.from(data, 'base64');
  const expectedBytes = count * dim * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expectedBytes) || buf.byteLength !== expectedBytes) return null;

  const alignedBytes = new Uint8Array(expectedBytes);
  alignedBytes.set(buf);
  const packed = new Float32Array(alignedBytes.buffer);
  return Array.from({ length: count }, (_, index) =>
    packed.subarray(index * dim, (index + 1) * dim),
  );
}

export async function loadToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
): Promise<Float32Array[] | null> {
  if (!SEARCH_VECTOR_CACHE_ENABLED) return null;

  const fingerprint = buildEmbeddingFingerprint(modelId, descriptions);
  const path = getEmbeddingCachePath(modelId);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as EmbeddingCachePayload;
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.modelId !== modelId ||
      parsed.fingerprint !== fingerprint ||
      parsed.count !== descriptions.length
    ) {
      return null;
    }

    const decoded = decodeEmbeddings(parsed.data, parsed.count, parsed.dim);
    if (!decoded || decoded.length !== descriptions.length) return null;
    logger.debug(`[embedding-cache] hit model=${modelId} tools=${decoded.length}`);
    return decoded;
  } catch {
    return null;
  }
}

export async function saveToolEmbeddingsCache(
  modelId: string,
  descriptions: readonly string[],
  embeddings: readonly Float32Array[],
): Promise<void> {
  if (!SEARCH_VECTOR_CACHE_ENABLED || embeddings.length !== descriptions.length) return;

  const path = getEmbeddingCachePath(modelId);
  const { dim, data } = encodeEmbeddings(embeddings);
  const payload: EmbeddingCachePayload = {
    version: CACHE_VERSION,
    modelId,
    fingerprint: buildEmbeddingFingerprint(modelId, descriptions),
    dim,
    count: embeddings.length,
    data,
  };
  const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await rename(tmpPath, path);
    logger.debug(`[embedding-cache] wrote model=${modelId} tools=${embeddings.length}`);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    logger.warn(
      `[embedding-cache] write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
