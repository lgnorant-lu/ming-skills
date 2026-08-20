import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockParentPort = {
  on: vi.fn(),
  postMessage: vi.fn(),
};
const mockStaticLoad = vi.fn();

vi.mock('node:worker_threads', () => ({
  parentPort: mockParentPort,
}));

vi.mock('@server/search/StaticEmbeddingModel', () => ({
  StaticEmbeddingModel: { load: mockStaticLoad },
}));

describe('EmbeddingWorker', () => {
  let messageHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandler = null;
    mockParentPort.on.mockImplementation((event: string, handler: (msg: any) => Promise<void>) => {
      if (event === 'message') messageHandler = handler;
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function loadWorker(): Promise<void> {
    await import('@server/search/EmbeddingWorker');
    expect(mockParentPort.on).toHaveBeenCalledWith('message', expect.any(Function));
  }

  it('uses the Potion static model by default', async () => {
    const embedding = new Float32Array([1, 0]);
    const embed = vi.fn(() => embedding);
    mockStaticLoad.mockResolvedValue({ embed, embedBatch: vi.fn() });

    await loadWorker();
    await messageHandler!({ type: 'embed', id: 1, text: 'tool query' });

    expect(mockStaticLoad).toHaveBeenCalledWith('minishlab/potion-code-16M-v2');
    expect(embed).toHaveBeenCalledWith('tool query');
    expect(mockParentPort.postMessage).toHaveBeenCalledWith({ type: 'result', id: 1, embedding }, [
      embedding.buffer,
    ]);
  });

  it('supports another Model2Vec-compatible static model ID', async () => {
    const embed = vi.fn(() => new Float32Array([0, 1]));
    mockStaticLoad.mockResolvedValue({ embed, embedBatch: vi.fn() });

    await loadWorker();
    await messageHandler!({
      type: 'embed',
      id: 2,
      modelId: 'minishlab/other-static-model',
      text: 'query',
    });

    expect(mockStaticLoad).toHaveBeenCalledWith('minishlab/other-static-model');
  });

  it('shares one model load across concurrent first requests', async () => {
    const embed = vi.fn(() => new Float32Array([1, 0]));
    mockStaticLoad.mockResolvedValue({ embed, embedBatch: vi.fn() });

    await loadWorker();
    await Promise.all([
      messageHandler!({ type: 'embed', id: 3, text: 'first' }),
      messageHandler!({ type: 'embed', id: 4, text: 'second' }),
    ]);

    expect(mockStaticLoad).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('embeds batches through the static model', async () => {
    const embeddings = [new Float32Array([1, 0]), new Float32Array([0, 1])];
    const embedBatch = vi.fn(() => embeddings);
    mockStaticLoad.mockResolvedValue({ embed: vi.fn(), embedBatch });

    await loadWorker();
    await messageHandler!({ type: 'embed_batch', id: 5, texts: ['first', 'second'] });

    expect(embedBatch).toHaveBeenCalledWith(['first', 'second']);
    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'result',
      id: 5,
      embedding: embeddings,
    });
  });

  it('returns an empty batch without loading the model', async () => {
    await loadWorker();
    await messageHandler!({ type: 'embed_batch', id: 6, texts: [] });

    expect(mockStaticLoad).not.toHaveBeenCalled();
    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'result',
      id: 6,
      embedding: [],
    });
  });

  it('reports model failures and allows a later load retry', async () => {
    mockStaticLoad.mockRejectedValueOnce(new Error('static model failed')).mockResolvedValueOnce({
      embed: vi.fn(() => new Float32Array([1])),
      embedBatch: vi.fn(),
    });

    await loadWorker();
    await messageHandler!({ type: 'embed', id: 7, text: 'first' });
    await messageHandler!({ type: 'embed', id: 8, text: 'second' });

    expect(mockStaticLoad).toHaveBeenCalledTimes(2);
    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'error',
      id: 7,
      message: 'static model failed',
    });
    expect(mockParentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'result', id: 8 }),
      expect.any(Array),
    );
  });

  it('reports non-Error throws', async () => {
    mockStaticLoad.mockRejectedValue('string error');

    await loadWorker();
    await messageHandler!({ type: 'embed', id: 9, text: 'query' });

    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'error',
      id: 9,
      message: 'string error',
    });
  });

  it('rejects switching model IDs after a model is loaded', async () => {
    mockStaticLoad.mockResolvedValue({
      embed: vi.fn(() => new Float32Array([1])),
      embedBatch: vi.fn(),
    });

    await loadWorker();
    await messageHandler!({ type: 'embed', id: 10, modelId: 'static/model-a', text: 'first' });
    await messageHandler!({ type: 'embed', id: 11, modelId: 'static/model-b', text: 'second' });

    expect(mockParentPort.postMessage).toHaveBeenCalledWith({
      type: 'error',
      id: 11,
      message:
        'Embedding worker already loaded model static/model-a; cannot switch to static/model-b',
    });
  });
});
