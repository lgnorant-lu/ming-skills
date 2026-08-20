import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerState = vi.hoisted(() => ({ workers: [] as any[] }));

vi.mock('node:worker_threads', () => {
  class MockWorker {
    private readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
    private terminateResolve: (() => void) | null = null;
    readonly messages: any[] = [];

    constructor() {
      workerState.workers.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): this {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    once(event: string, handler: (...args: any[]) => void): this {
      return this.on(event, handler);
    }

    unref(): void {}

    postMessage(message: unknown): void {
      this.messages.push(message);
    }

    terminate(): Promise<void> {
      return new Promise((resolve) => {
        this.terminateResolve = resolve;
      });
    }

    emit(event: string, ...args: any[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    finishTerminate(): void {
      this.terminateResolve?.();
    }
  }

  return { Worker: MockWorker };
});

describe('EmbeddingEngine worker lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    workerState.workers.length = 0;
  });

  it('passes the configured model id to the worker', async () => {
    const { EmbeddingEngine } = await import('@server/search/EmbeddingEngine');
    const engine = new EmbeddingEngine({ idleMs: 0, modelId: 'custom/model' });
    const pending = engine.embed('hello');
    const worker = workerState.workers[0]!;
    expect(worker.messages[0]).toMatchObject({ modelId: 'custom/model', text: 'hello' });
    worker.emit('message', { type: 'result', id: 0, embedding: new Float32Array([1]) });
    await pending;
    const terminating = engine.terminate();
    worker.finishTerminate();
    await terminating;
  });

  it('does not let an old worker exit reject requests owned by its replacement', async () => {
    const { EmbeddingEngine } = await import('@server/search/EmbeddingEngine');
    const engine = new EmbeddingEngine({ idleMs: 0 });

    const first = engine.embed('first');
    const oldWorker = workerState.workers[0]!;
    oldWorker.emit('message', { type: 'result', id: 0, embedding: new Float32Array([1]) });
    await first;

    const terminating = engine.terminate();
    const second = engine.embed('second');
    const replacement = workerState.workers[1]!;
    oldWorker.emit('exit', 1);
    oldWorker.finishTerminate();
    replacement.emit('message', { type: 'result', id: 1, embedding: new Float32Array([2]) });

    await expect(second).resolves.toEqual(new Float32Array([2]));
    await terminating;
    const finalTermination = engine.terminate();
    replacement.finishTerminate();
    await finalTermination;
  });
});
