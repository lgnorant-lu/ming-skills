import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WatchExpressionManager } from '@modules/debugger/WatchExpressionManager';

function makeManager() {
  const runtimeInspector = {
    evaluate: vi.fn(),
  } as any;
  return new WatchExpressionManager(runtimeInspector);
}

describe('WatchExpressionManager bug fixes', () => {
  it('detects Map changes via deepEqual', async () => {
    const manager = makeManager() as any;
    expect(manager.deepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(manager.deepEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true);
    expect(manager.deepEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false);
  });

  it('detects Set changes via deepEqual', async () => {
    const manager = makeManager() as any;
    expect(manager.deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(manager.deepEqual(new Set([1, 2]), new Set([1, 2]))).toBe(true);
    expect(manager.deepEqual(new Set([1]), new Set([1, 2]))).toBe(false);
  });

  it('compares RegExp by source and flags', async () => {
    const manager = makeManager() as any;
    expect(manager.deepEqual(/abc/g, /abc/g)).toBe(true);
    expect(manager.deepEqual(/abc/g, /abc/i)).toBe(false);
    expect(manager.deepEqual(/abc/g, /abd/g)).toBe(false);
  });

  it('compares Dates by timestamp', async () => {
    const manager = makeManager() as any;
    expect(manager.deepEqual(new Date(1000), new Date(1000))).toBe(true);
    expect(manager.deepEqual(new Date(1000), new Date(2000))).toBe(false);
  });

  it('reports valueChanged for Map values in evaluateAll', async () => {
    const manager = makeManager();
    const runtime = (manager as any).runtimeInspector;
    runtime.evaluate
      .mockResolvedValueOnce(new Map([['k', 1]]))
      .mockResolvedValueOnce(new Map([['k', 2]]));

    manager.addWatch('m');
    const first = await manager.evaluateAll();
    const second = await manager.evaluateAll();

    expect(first[0]?.valueChanged).toBe(true); // undefined -> Map
    expect(second[0]?.valueChanged).toBe(true); // Map changed
  });
});
