import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheInstance } from '@utils/UnifiedCacheManager';
import { UnifiedCacheManager } from '@utils/UnifiedCacheManager';

function mb(value: number): number {
  return value * 1024 * 1024;
}

class TestUnifiedCacheManager extends UnifiedCacheManager {
  static resetInstance() {
    // Must reset on the parent class directly, since UnifiedCacheManager.getInstance()
    // reads `this.instance` where `this` is UnifiedCacheManager, not the subclass.
    (UnifiedCacheManager as any).instance = undefined;
  }
}

describe('UnifiedCacheManager', () => {
  afterEach(() => {
    TestUnifiedCacheManager.resetInstance();
    vi.restoreAllMocks();
  });

  it('returns singleton instance', () => {
    const first = UnifiedCacheManager.getInstance();
    const second = UnifiedCacheManager.getInstance();
    expect(first).toBe(second);
  });

  it('aggregates global stats and ignores failing cache stats', async () => {
    const manager = UnifiedCacheManager.getInstance();
    const okCache: CacheInstance = {
      name: 'ok-cache',
      getStats: vi.fn(async () => ({
        entries: 3,
        size: 300,
        hits: 9,
        misses: 1,
        hitRate: 0.9,
      })),
    };
    const badCache: CacheInstance = {
      name: 'bad-cache',
      getStats: vi.fn(async () => {
        throw new Error('boom');
      }),
    };

    manager.registerCache(okCache);
    manager.registerCache(badCache);

    const stats = await manager.getGlobalStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.totalSize).toBe(300);
    expect(stats.hitRate).toBeCloseTo(0.9);
    expect(stats.caches.map((cache) => cache.name)).toEqual(['ok-cache']);
  });

  it('generates critical size and low hit-rate recommendations', async () => {
    const manager = UnifiedCacheManager.getInstance();
    manager.registerCache({
      name: 'big-cache',
      getStats: vi.fn(async () => ({
        entries: 1,
        size: mb(460),
        hits: 1,
        misses: 20,
        hitRate: 0.05,
      })),
    });

    const stats = await manager.getGlobalStats();
    expect(stats.recommendations.some((item) => item.includes('CRITICAL'))).toBe(true);
    expect(stats.recommendations.some((item) => item.includes('Low cache hit rate'))).toBe(true);
  });

  it('returns no-op cleanup result when under target', async () => {
    const manager = UnifiedCacheManager.getInstance();
    manager.registerCache({
      name: 'small',
      getStats: vi.fn(async () => ({ entries: 1, size: mb(5), hits: 9, misses: 1, hitRate: 0.9 })),
      clear: vi.fn(async () => undefined),
      cleanup: vi.fn(async () => undefined),
    });

    const result1 = await manager.smartCleanup(mb(10));
    expect(result1.freed).toBe(0);

    const result2 = await manager.smartCleanup();
    expect(result2.freed).toBe(0);
  });

  it('smart cleanup clears low hit-rate cache when over target', async () => {
    const manager = UnifiedCacheManager.getInstance();

    const highCacheState = { size: mb(220), entries: 2, hits: 80, misses: 20, hitRate: 0.8 };
    const lowCacheState = { size: mb(220), entries: 2, hits: 2, misses: 18, hitRate: 0.1 };
    const lowClear = vi.fn(async () => {
      lowCacheState.size = 0;
      lowCacheState.entries = 0;
      lowCacheState.hits = 0;
      lowCacheState.misses = 0;
      lowCacheState.hitRate = 0;
    });

    manager.registerCache({
      name: 'high-cache',
      getStats: vi.fn(async () => ({ ...highCacheState })),
    });
    manager.registerCache({
      name: 'low-cache',
      getStats: vi.fn(async () => ({ ...lowCacheState })),
      clear: lowClear,
    });

    const result = await manager.smartCleanup(mb(250));
    expect(lowClear).toHaveBeenCalled();
    expect(result.after).toBeLessThanOrEqual(mb(250));
  });

  it('clearAll invokes clear on each cache and tolerates errors', async () => {
    const manager = UnifiedCacheManager.getInstance();
    const clearA = vi.fn(async () => undefined);
    const clearB = vi.fn(async () => {
      throw new Error('fail');
    });

    manager.registerCache({
      name: 'a',
      getStats: vi.fn(async () => ({ entries: 0, size: 0 })),
      clear: clearA,
    });
    manager.registerCache({
      name: 'b',
      getStats: vi.fn(async () => ({ entries: 0, size: 0 })),
      clear: clearB,
    });

    await expect(manager.clearAll()).resolves.toBeUndefined();
    expect(clearA).toHaveBeenCalledOnce();
    expect(clearB).toHaveBeenCalledOnce();
  });

  it('namespace-scoped smartCleanup only touches whitelisted caches', async () => {
    const manager = UnifiedCacheManager.getInstance();

    const protectedState = { size: mb(220), entries: 2, hits: 1, misses: 19, hitRate: 0.05 };
    const protectedClear = vi.fn(async () => undefined);
    const largeState = { size: mb(220), entries: 2, hits: 1, misses: 19, hitRate: 0.05 };
    const largeClear = vi.fn(async () => {
      largeState.size = 0;
      largeState.entries = 0;
    });

    manager.registerCache({
      name: 'protected-namespace',
      getStats: vi.fn(async () => ({ ...protectedState })),
      clear: protectedClear,
      cleanup: vi.fn(async () => undefined),
    });
    manager.registerCache({
      name: 'target-namespace',
      getStats: vi.fn(async () => ({ ...largeState })),
      clear: largeClear,
      cleanup: vi.fn(async () => undefined),
    });

    const result = await manager.smartCleanup(mb(10), {
      namespaces: ['target-namespace'],
    });

    // The whitelisted cache is cleared; the protected one is never touched.
    expect(largeClear).toHaveBeenCalled();
    expect(protectedClear).not.toHaveBeenCalled();
    // `after` reflects only the filtered subset (target-namespace went to 0).
    expect(result.after).toBeLessThanOrEqual(mb(10));
  });

  it('smartCleanup with empty namespaces array behaves like the unfiltered path', async () => {
    const manager = UnifiedCacheManager.getInstance();
    const clearA = vi.fn(async () => undefined);
    const clearB = vi.fn(async () => undefined);

    manager.registerCache({
      name: 'cache-a',
      getStats: vi.fn(async () => ({ entries: 1, size: mb(300), hits: 0, misses: 5, hitRate: 0 })),
      clear: clearA,
      cleanup: vi.fn(async () => undefined),
    });
    manager.registerCache({
      name: 'cache-b',
      getStats: vi.fn(async () => ({ entries: 1, size: mb(300), hits: 0, misses: 5, hitRate: 0 })),
      clear: clearB,
      cleanup: vi.fn(async () => undefined),
    });

    await manager.smartCleanup(mb(10), { namespaces: [] });
    // No namespace restriction → both caches are eligible for cleanup.
    expect(clearA).toHaveBeenCalled();
    expect(clearB).toHaveBeenCalled();
  });

  it('smartCleanup with a namespace matching nothing is a no-op', async () => {
    const manager = UnifiedCacheManager.getInstance();
    const clear = vi.fn(async () => undefined);
    manager.registerCache({
      name: 'untouchable',
      getStats: vi.fn(async () => ({ entries: 1, size: mb(500), hits: 0, misses: 1, hitRate: 0 })),
      clear,
    });

    const result = await manager.smartCleanup(mb(10), { namespaces: ['does-not-exist'] });
    expect(clear).not.toHaveBeenCalled();
    expect(result.freed).toBe(0);
  });
});
