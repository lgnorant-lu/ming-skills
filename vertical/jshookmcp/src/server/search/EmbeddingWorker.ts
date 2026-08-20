/**
 * Worker thread script for static Model2Vec embedding inference.
 *
 * Keeps model loading and embedding work outside the main event loop using
 * static F16/F32 token embeddings.
 *
 * Message protocol:
 *   → { type: 'embed',       id: number, text: string }
 *   → { type: 'embed_batch', id: number, texts: string[] }
 *   ← { type: 'result',      id: number, embedding: Float32Array | Float32Array[] }
 *   ← { type: 'error',       id: number, message: string }
 */
import { parentPort } from 'worker_threads';
import { DEFAULT_SEARCH_VECTOR_MODEL_ID } from '../../constants/search-model.ts';
import { StaticEmbeddingModel } from './StaticEmbeddingModel.ts';

// ── Lazy model singleton ──

let staticModel: StaticEmbeddingModel | null = null;
let staticModelPromise: Promise<StaticEmbeddingModel> | null = null;
let loadedStaticModelId: string | null = null;
const DEFAULT_MODEL_ID = DEFAULT_SEARCH_VECTOR_MODEL_ID;

async function getStaticModel(modelId: string): Promise<StaticEmbeddingModel> {
  if (loadedStaticModelId && loadedStaticModelId !== modelId) {
    throw new Error(
      `Embedding worker already loaded model ${loadedStaticModelId}; cannot switch to ${modelId}`,
    );
  }
  if (staticModel) return staticModel;
  if (!staticModelPromise) {
    loadedStaticModelId = modelId;
    staticModelPromise = StaticEmbeddingModel.load(modelId)
      .then((model) => {
        staticModel = model;
        return model;
      })
      .catch((error: unknown) => {
        loadedStaticModelId = null;
        staticModelPromise = null;
        throw error;
      });
  }
  return staticModelPromise;
}

// ── Message handler ──

parentPort?.on(
  'message',
  async (msg: { type: string; id: number; modelId?: string; text?: string; texts?: string[] }) => {
    try {
      const modelId = msg.modelId?.trim() || DEFAULT_MODEL_ID;
      if (msg.type === 'embed_batch' && msg.texts!.length === 0) {
        parentPort!.postMessage({ type: 'result', id: msg.id, embedding: [] });
        return;
      }
      const model = await getStaticModel(modelId);
      if (msg.type === 'embed') {
        const embedding = model.embed(msg.text!);
        parentPort!.postMessage({ type: 'result', id: msg.id, embedding }, [
          embedding.buffer as ArrayBuffer,
        ]);
      } else if (msg.type === 'embed_batch') {
        parentPort!.postMessage({
          type: 'result',
          id: msg.id,
          embedding: model.embedBatch(msg.texts!),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ type: 'error', id: msg.id, message });
    }
  },
);
