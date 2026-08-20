import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

interface TokenizerEncoding {
  ids: number[];
}

export interface StaticTokenizer {
  encode(text: string, options?: { add_special_tokens?: boolean }): TokenizerEncoding;
}

interface SafeTensorDescriptor {
  dtype?: unknown;
  shape?: unknown;
  data_offsets?: unknown;
}

interface SafeTensorHeader {
  embeddings?: SafeTensorDescriptor;
}

export interface StaticEmbeddingTensor {
  dtype: 'F16' | 'F32';
  rows: number;
  dimensions: number;
  values: Uint16Array | Float32Array;
}

const MODEL_FILENAMES = ['tokenizer.json', 'model.safetensors'] as const;
type ModelFilename = (typeof MODEL_FILENAMES)[number];
const FETCH_TIMEOUT_MS = Math.max(
  1,
  Number.parseInt(process.env.SEARCH_VECTOR_FETCH_TIMEOUT_MS ?? '15000', 10) || 15_000,
);

let float16Lookup: Float32Array | null = null;

function getFloat16Lookup(): Float32Array {
  if (float16Lookup) return float16Lookup;

  const lookup = new Float32Array(1 << 16);
  for (let bits = 0; bits < lookup.length; bits++) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >>> 10) & 0x1f;
    const fraction = bits & 0x03ff;
    if (exponent === 0) {
      lookup[bits] = sign * fraction * 2 ** -24;
    } else if (exponent === 0x1f) {
      lookup[bits] = fraction === 0 ? sign * Infinity : Number.NaN;
    } else {
      lookup[bits] = sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
    }
  }
  float16Lookup = lookup;
  return lookup;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function parseStaticEmbeddingTensor(bytes: Uint8Array): StaticEmbeddingTensor {
  if (bytes.byteLength < 8) throw new Error('Invalid safetensors file: missing header length');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLengthBigInt = view.getBigUint64(0, true);
  if (headerLengthBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid safetensors file: header is too large');
  }
  const headerLength = Number(headerLengthBigInt);
  const dataStart = 8 + headerLength;
  if (headerLength <= 0 || dataStart > bytes.byteLength) {
    throw new Error('Invalid safetensors file: header exceeds file size');
  }

  let header: SafeTensorHeader;
  try {
    const headerText = new TextDecoder().decode(bytes.subarray(8, dataStart)).trimEnd();
    header = JSON.parse(headerText) as SafeTensorHeader;
  } catch (error) {
    throw new Error(
      `Invalid safetensors header: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const descriptor = header.embeddings;
  if (!descriptor || (descriptor.dtype !== 'F16' && descriptor.dtype !== 'F32')) {
    throw new Error('Static embedding model must contain an F16 or F32 "embeddings" tensor');
  }
  if (
    !Array.isArray(descriptor.shape) ||
    descriptor.shape.length !== 2 ||
    !isPositiveInteger(descriptor.shape[0]) ||
    !isPositiveInteger(descriptor.shape[1])
  ) {
    throw new Error('Static embedding tensor must have a two-dimensional positive shape');
  }
  if (
    !Array.isArray(descriptor.data_offsets) ||
    descriptor.data_offsets.length !== 2 ||
    !Number.isSafeInteger(descriptor.data_offsets[0]) ||
    !Number.isSafeInteger(descriptor.data_offsets[1])
  ) {
    throw new Error('Static embedding tensor has invalid data offsets');
  }

  const rows = descriptor.shape[0];
  const dimensions = descriptor.shape[1];
  const startOffset = descriptor.data_offsets[0] as number;
  const endOffset = descriptor.data_offsets[1] as number;
  const valueCount = rows * dimensions;
  const dtype = descriptor.dtype;
  const bytesPerValue =
    dtype === 'F16' ? Uint16Array.BYTES_PER_ELEMENT : Float32Array.BYTES_PER_ELEMENT;
  const expectedBytes = valueCount * bytesPerValue;
  if (
    !Number.isSafeInteger(valueCount) ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset - startOffset !== expectedBytes ||
    dataStart + endOffset > bytes.byteLength
  ) {
    throw new Error('Static embedding tensor byte length does not match its shape');
  }

  const absoluteOffset = bytes.byteOffset + dataStart + startOffset;
  let values: Uint16Array | Float32Array;
  if (dtype === 'F16' && absoluteOffset % Uint16Array.BYTES_PER_ELEMENT === 0) {
    values = new Uint16Array(bytes.buffer, absoluteOffset, valueCount);
  } else if (dtype === 'F32' && absoluteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    values = new Float32Array(bytes.buffer, absoluteOffset, valueCount);
  } else {
    const copy = bytes.slice(dataStart + startOffset, dataStart + endOffset);
    values =
      dtype === 'F16'
        ? new Uint16Array(copy.buffer, copy.byteOffset, valueCount)
        : new Float32Array(copy.buffer, copy.byteOffset, valueCount);
  }
  return { dtype, rows, dimensions, values };
}

function getModelCacheDirectory(modelId: string): string {
  const overridden = process.env.JSHOOK_EMBEDDING_MODEL_CACHE_DIR?.trim();
  const root = overridden
    ? resolve(overridden)
    : resolve(homedir(), '.jshookmcp', 'cache', 'models');
  const safeModel = modelId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const modelHash = createHash('sha256').update(modelId).digest('hex').slice(0, 12);
  return resolve(root, `${safeModel}-${modelHash}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getModelUrl(modelId: string, filename: ModelFilename): string {
  const endpoint = (process.env.HF_ENDPOINT?.trim() || 'https://huggingface.co').replace(/\/$/, '');
  const encodedModelId = modelId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${endpoint}/${encodedModelId}/resolve/main/${filename}`;
}

async function downloadModelFile(modelId: string, filename: ModelFilename, path: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(getModelUrl(modelId, filename), {
      headers: { 'user-agent': 'jshookmcp-embedding-worker' },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok || !response.body) {
      throw new Error(`Hugging Face returned HTTP ${response.status} for ${filename}`);
    }
    await pipeline(response.body, createWriteStream(temporaryPath, { flags: 'wx' }));
    try {
      await rename(temporaryPath, path);
    } catch (error) {
      if (!(await fileExists(path))) throw error;
      await unlink(temporaryPath).catch(() => undefined);
    }
  } catch (error) {
    clearTimeout(timeout);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function ensureModelFile(modelId: string, filename: ModelFilename): Promise<string> {
  const path = resolve(getModelCacheDirectory(modelId), filename);
  if (!(await fileExists(path))) await downloadModelFile(modelId, filename, path);
  return path;
}

export class StaticEmbeddingModel {
  private readonly tokenizer: StaticTokenizer;
  private readonly tensor: StaticEmbeddingTensor;

  private constructor(tokenizer: StaticTokenizer, tensor: StaticEmbeddingTensor) {
    this.tokenizer = tokenizer;
    this.tensor = tensor;
  }

  static fromArtifacts(tokenizer: StaticTokenizer, safetensors: Uint8Array): StaticEmbeddingModel {
    return new StaticEmbeddingModel(tokenizer, parseStaticEmbeddingTensor(safetensors));
  }

  static async load(modelId: string): Promise<StaticEmbeddingModel> {
    const [tokenizerPath, modelPath] = await Promise.all([
      ensureModelFile(modelId, 'tokenizer.json'),
      ensureModelFile(modelId, 'model.safetensors'),
    ]);
    const [{ Tokenizer }, tokenizerJson, safetensors] = await Promise.all([
      import('@huggingface/tokenizers'),
      readFile(tokenizerPath, 'utf8'),
      readFile(modelPath),
    ]);
    const tokenizer = new Tokenizer(JSON.parse(tokenizerJson) as object, {});
    return StaticEmbeddingModel.fromArtifacts(tokenizer, safetensors);
  }

  get dimensions(): number {
    return this.tensor.dimensions;
  }

  embed(text: string): Float32Array {
    const tokenIds = this.tokenizer.encode(text, { add_special_tokens: false }).ids;
    const output = new Float32Array(this.tensor.dimensions);
    if (tokenIds.length === 0) return output;

    const lookup = this.tensor.dtype === 'F16' ? getFloat16Lookup() : null;
    let includedTokens = 0;
    for (const tokenId of tokenIds) {
      if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= this.tensor.rows) continue;
      const rowOffset = tokenId * this.tensor.dimensions;
      for (let dimension = 0; dimension < this.tensor.dimensions; dimension++) {
        const rawValue = this.tensor.values[rowOffset + dimension]!;
        output[dimension] = output[dimension]! + (lookup ? lookup[rawValue]! : rawValue);
      }
      includedTokens++;
    }
    if (includedTokens === 0) return output;

    let squaredNorm = 0;
    for (const value of output) squaredNorm += value * value;
    if (squaredNorm === 0 || !Number.isFinite(squaredNorm)) return output.fill(0);
    const inverseNorm = 1 / Math.sqrt(squaredNorm);
    for (let dimension = 0; dimension < output.length; dimension++) {
      output[dimension] = output[dimension]! * inverseNorm;
    }
    return output;
  }

  embedBatch(texts: readonly string[]): Float32Array[] {
    return texts.map((text) => this.embed(text));
  }
}
