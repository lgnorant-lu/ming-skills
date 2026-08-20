import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
}));

import { takeHeapSnapshot } from '@modules/monitor/PerformanceMonitor.snapshot';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeCdp() {
  const listeners = new Set<(params: unknown) => void>();
  return {
    send: vi.fn(),
    on: vi.fn((_event: string, handler: (params: unknown) => void) => {
      listeners.add(handler);
    }),
    off: vi.fn((_event: string, handler: (params: unknown) => void) => {
      listeners.delete(handler);
    }),
    emitChunk(params: unknown) {
      listeners.forEach((handler) => handler(params));
    },
    listenerCount: () => listeners.size,
  };
}

describe('takeHeapSnapshot concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializes concurrent snapshots on the same session', async () => {
    const cdp = makeCdp() as any;
    const gate = deferred<void>();
    cdp.send.mockImplementation(async (method: string) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        await gate.promise;
      }
      return {};
    });

    const first = takeHeapSnapshot(cdp);
    const second = takeHeapSnapshot(cdp);

    // The second call must reuse the in-flight snapshot — only one
    // takeHeapSnapshot round-trip and exactly one chunk listener.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cdp.listenerCount()).toBe(1);

    cdp.emitChunk({ chunk: 'x'.repeat(100) });
    gate.resolve();
    await Promise.all([first, second]);

    const takeCalls = cdp.send.mock.calls.filter(
      (c: unknown[]) => c[0] === 'HeapProfiler.takeHeapSnapshot',
    );
    expect(takeCalls).toHaveLength(1);

    const [sizeA, sizeB] = await Promise.all([first, second]);
    expect(sizeA).toBe(sizeB);
  });
});
