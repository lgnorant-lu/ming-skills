import { describe, expect, it } from 'vitest';
import {
  parseStaticEmbeddingTensor,
  StaticEmbeddingModel,
  type StaticTokenizer,
} from '@server/search/StaticEmbeddingModel';
import { getEmbeddingDimensionHint } from '@server/search/EmbeddingModels';
import { DEFAULT_SEARCH_VECTOR_MODEL_ID } from '@src/constants';

function createSafetensors(
  rows: number,
  dimensions: number,
  values: readonly number[],
  dtype: 'F16' | 'F32' = 'F16',
): Uint8Array {
  const bytesPerValue =
    dtype === 'F16' ? Uint16Array.BYTES_PER_ELEMENT : Float32Array.BYTES_PER_ELEMENT;
  const dataLength = values.length * bytesPerValue;
  const rawHeader = JSON.stringify({
    embeddings: {
      dtype,
      shape: [rows, dimensions],
      data_offsets: [0, dataLength],
    },
  });
  const unpaddedLength = new TextEncoder().encode(rawHeader).length;
  const headerLength = Math.ceil(unpaddedLength / 8) * 8;
  const bytes = new Uint8Array(8 + headerLength + dataLength);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(headerLength), true);
  bytes.fill(0x20, 8, 8 + headerLength);
  bytes.set(new TextEncoder().encode(rawHeader), 8);
  if (dtype === 'F16') {
    new Uint16Array(bytes.buffer, 8 + headerLength, values.length).set(values);
  } else {
    new Float32Array(bytes.buffer, 8 + headerLength, values.length).set(values);
  }
  return bytes;
}

const tokenizer: StaticTokenizer = {
  encode(text) {
    const idsByText: Record<string, number[]> = {
      '': [],
      one: [1],
      two: [2],
      both: [1, 2],
      invalid: [99],
    };
    return { ids: idsByText[text] ?? [] };
  },
};

describe('StaticEmbeddingModel', () => {
  const safetensors = createSafetensors(3, 2, [0, 0, 0x3c00, 0, 0, 0x4000]);

  it('parses the F16 embeddings tensor without expanding the stored matrix', () => {
    const tensor = parseStaticEmbeddingTensor(safetensors);

    expect(tensor.dtype).toBe('F16');
    expect(tensor.rows).toBe(3);
    expect(tensor.dimensions).toBe(2);
    expect(tensor.values).toBeInstanceOf(Uint16Array);
    expect(tensor.values).toHaveLength(6);
    expect(tensor.values[2]).toBe(0x3c00);
  });

  it('reads and embeds F32 Model2Vec tensors', () => {
    const float32 = createSafetensors(3, 2, [0, 0, 1, 0, 0, 2], 'F32');
    const tensor = parseStaticEmbeddingTensor(float32);
    const model = StaticEmbeddingModel.fromArtifacts(tokenizer, float32);

    expect(tensor.dtype).toBe('F32');
    expect(tensor.values).toBeInstanceOf(Float32Array);
    expect(model.embed('both')[0]).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(model.embed('both')[1]).toBeCloseTo(2 / Math.sqrt(5), 6);
  });

  it('mean-pools token rows and returns L2-normalized embeddings', () => {
    const model = StaticEmbeddingModel.fromArtifacts(tokenizer, safetensors);

    expect(Array.from(model.embed('one'))).toEqual([1, 0]);
    expect(Array.from(model.embed('two'))).toEqual([0, 1]);
    expect(model.embed('both')[0]).toBeCloseTo(1 / Math.sqrt(5), 6);
    expect(model.embed('both')[1]).toBeCloseTo(2 / Math.sqrt(5), 6);
  });

  it('does not add padding for empty input and ignores out-of-range token IDs', () => {
    const model = StaticEmbeddingModel.fromArtifacts(tokenizer, safetensors);

    expect(Array.from(model.embed(''))).toEqual([0, 0]);
    expect(Array.from(model.embed('invalid'))).toEqual([0, 0]);
  });

  it('rejects tensor shapes that do not match the payload', () => {
    const invalid = createSafetensors(4, 2, [0, 0, 0, 0]);
    expect(() => parseStaticEmbeddingTensor(invalid)).toThrow(/byte length/i);
  });
});

describe('embedding model metadata', () => {
  it('selects the static backend and reports dimensions for supported defaults', () => {
    expect(DEFAULT_SEARCH_VECTOR_MODEL_ID).toBe('minishlab/potion-code-16M-v2');
    expect(getEmbeddingDimensionHint(DEFAULT_SEARCH_VECTOR_MODEL_ID)).toBe(256);
    expect(getEmbeddingDimensionHint('minishlab/potion-base-2M')).toBe(64);
    expect(getEmbeddingDimensionHint('minishlab/potion-base-4M')).toBe(128);
    expect(getEmbeddingDimensionHint('minishlab/potion-base-8M')).toBe(256);
    expect(getEmbeddingDimensionHint('minishlab/unknown-static-model')).toBe(0);
  });
});
