import { describe, it, expect, vi } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { WebGPUHandlers } from '@server/domains/webgpu/index';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import { TEST_URLS } from '@tests/shared/test-urls';

/**
 * Build a mock page whose `evaluate` returns `allocations` for the hook-state
 * query (detected via the `webgpuHookState` substring in the function body),
 * and whose CDP session reports the given metrics.
 */
function makeMockPage(allocations: any[], metrics: any[] = []) {
  return {
    url: () => 'https://example.com/',
    evaluate: vi.fn().mockImplementation(async (fn: any, ..._args: any[]) => {
      if (typeof fn === 'function' && String(fn).includes('webgpuHookState')) {
        return allocations;
      }
      return undefined;
    }),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    createCDPSession: vi.fn().mockResolvedValue({
      send: vi.fn().mockResolvedValue({ metrics }),
      detach: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function makeHandlers(page: any): WebGPUHandlers {
  const ctx = {
    eventBus: { emit: () => {} },
    pageController: { getActivePage: async () => page },
  } as unknown as MCPServerContext;
  return new WebGPUHandlers(ctx);
}

describe('webgpu_memory_layout', () => {
  it('should require active page', async () => {
    const ctx = {
      eventBus: { emit: () => {} },
      pageController: {
        getActivePage: async () => {
          throw new Error('No active page');
        },
      },
    } as unknown as MCPServerContext;
    const handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should handle rejected promise from getActivePage (async catch)', async () => {
    // Bug #1: getActivePage must be async with await so the try/catch
    // can trap promise rejections, not just synchronous throws.
    const ctx = {
      eventBus: { emit: () => {} },
      pageController: {
        // Returns a rejected promise directly (not via async throw) —
        // only an async getActivePage with await can catch this.
        getActivePage: () => Promise.reject(new Error('page gone')),
      },
    } as unknown as MCPServerContext;
    const handlers = new WebGPUHandlers(ctx);

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/page/i),
    });
  });

  it('should return live GPU memory allocations with memorySource and trackedBytes', async () => {
    const allocations = [
      { size: 1024, usage: 'VERTEX | COPY_DST', label: 'vbuf', type: 'buffer', alive: true },
      { size: 4096, usage: 'UNIFORM', type: 'buffer', alive: true },
    ];
    // No GPUMemoryUsedKB metric → memorySource should be 'tracked'.
    const handlers = makeHandlers(makeMockPage(allocations, []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty('heapSize');
    expect(result).toHaveProperty('usedHeapSize');
    expect(result).toHaveProperty('allocations');
    expect(result.allocations).toBeInstanceOf(Array);
    expect(result.allocations.length).toBe(2);

    // New fields: memorySource + trackedBytes.
    expect(result.memorySource).toBe('tracked');
    expect(result.trackedBytes).toBe(1024 + 4096);
    // In tracked mode usedHeapSize == trackedBytes (lower bound).
    expect(result.usedHeapSize).toBe(result.trackedBytes);
    expect(result.heapSize).toBeGreaterThan(0);

    const aliveAllocations = result.allocations.filter((a: any) => a.alive);
    expect(aliveAllocations.length).toBe(2);
  });

  it('should report memorySource=cdp when GPUMemoryUsedKB is available', async () => {
    const allocations = [{ size: 2048, usage: 'INDEX', type: 'buffer', alive: true }];
    const handlers = makeHandlers(
      makeMockPage(allocations, [{ name: 'GPUMemoryUsedKB', value: 512 }]),
    );

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.memorySource).toBe('cdp');
    // 512 KB → 524288 bytes.
    expect(result.usedHeapSize).toBe(512 * 1024);
    // trackedBytes is still computed from allocations.
    expect(result.trackedBytes).toBe(2048);
  });

  it('should report memorySource=estimated when no allocations and no CDP metric', async () => {
    const handlers = makeHandlers(makeMockPage([], []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.memorySource).toBe('estimated');
    expect(result.usedHeapSize).toBe(0);
    expect(result.trackedBytes).toBe(0);
    expect(result.heapSize).toBeGreaterThan(0);
  });

  it('should track buffer usage flags', async () => {
    const allocations = [
      { size: 1024, usage: 'VERTEX | COPY_DST', type: 'buffer', alive: true },
      { size: 2048, usage: 'INDEX', type: 'buffer', alive: true },
    ];
    const handlers = makeHandlers(makeMockPage(allocations, []));

    const response = await handlers.webgpu_memory_layout({});
    const result = ResponseBuilder.parse(response);

    expect(result.success).toBe(true);
    expect(result.allocations.some((a: any) => a.usage.includes('VERTEX'))).toBe(true);
  });

  describe('track mode (trending)', () => {
    it('returns the snapshot with no previous data on first tracked call', async () => {
      const allocations = [{ size: 1024, usage: 'VERTEX', type: 'buffer', alive: true }];
      const handlers = makeHandlers(makeMockPage(allocations, []));

      const response = await handlers.webgpu_memory_layout({ track: true });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      expect(result.tracking).toMatchObject({
        enabled: true,
        namespace: 'webgpu',
        key: 'webgpu_memory_https://example.com/',
      });
      expect(result.tracking.previous).toBeNull();
      expect(result.tracking.delta).toBeNull();
      expect(result.tracking.growthRateKbPerSec).toBeNull();
      expect(result.tracking.snapshot.trackedBytes).toBe(1024);
      expect(typeof result.tracking.snapshot.timestamp).toBe('number');
    });

    it('computes delta and growth rate against the previous snapshot on second call', async () => {
      // Two snapshots: trackedBytes grows from 1024 → 3072 over 1000ms.
      const page1 = makeMockPage([{ size: 1024, usage: 'VERTEX', type: 'buffer', alive: true }]);
      const handlers1 = makeHandlers(page1);
      const first = ResponseBuilder.parse(await handlers1.webgpu_memory_layout({ track: true }));
      expect(first.success).toBe(true);

      const page2 = makeMockPage([
        { size: 1024, usage: 'VERTEX', type: 'buffer', alive: true },
        { size: 2048, usage: 'UNIFORM', type: 'buffer', alive: true },
      ]);
      const handlers2 = makeHandlers(page2);
      const second = ResponseBuilder.parse(await handlers2.webgpu_memory_layout({ track: true }));
      expect(second.success).toBe(true);

      expect(second.tracking.previous).toMatchObject({ trackedBytes: 1024 });
      expect(second.tracking.delta.trackedBytesDelta).toBe(2048);
      expect(second.tracking.delta.allocationCountDelta).toBe(1);
      expect(second.tracking.snapshot.trackedBytes).toBe(3072);
    });

    it('keeps behavior unchanged when track is false or omitted', async () => {
      const allocations = [{ size: 1024, usage: 'VERTEX', type: 'buffer', alive: true }];
      const handlers = makeHandlers(makeMockPage(allocations, []));

      const response = await handlers.webgpu_memory_layout({});
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      expect(result.tracking).toBeUndefined();
      expect(result).toHaveProperty('usedHeapSize');
    });

    it('keeps per-page snapshots isolated by canvas id (page url)', async () => {
      const pageA = {
        ...makeMockPage([{ size: 64, usage: 'VERTEX', type: 'buffer', alive: true }]),
        url: () => TEST_URLS.a,
      };
      const pageB = {
        ...makeMockPage([{ size: 128, usage: 'VERTEX', type: 'buffer', alive: true }]),
        url: () => TEST_URLS.b,
      };

      const firstA = ResponseBuilder.parse(
        await makeHandlers(pageA).webgpu_memory_layout({ track: true }),
      );
      expect(firstA.tracking.previous).toBeNull();

      const firstB = ResponseBuilder.parse(
        await makeHandlers(pageB).webgpu_memory_layout({ track: true }),
      );
      expect(firstB.tracking.previous).toBeNull();

      const secondA = ResponseBuilder.parse(
        await makeHandlers(pageA).webgpu_memory_layout({ track: true }),
      );
      expect(secondA.tracking.previous).toMatchObject({ trackedBytes: 64 });
    });

    it('stores snapshots on the shared state board when coordination is present', async () => {
      // Real StateBoardStore from the coordination domain.
      const { SharedStateBoardHandlers } =
        await import('@server/domains/coordination/state-board/handlers.impl.core');
      const stateBoard = new SharedStateBoardHandlers();

      const allocations = [{ size: 512, usage: 'VERTEX', type: 'buffer', alive: true }];
      const page = makeMockPage(allocations, []);
      const ctx = {
        eventBus: { emit: () => {} },
        pageController: { getActivePage: async () => page },
        sharedStateBoardHandlers: stateBoard,
      } as unknown as MCPServerContext;
      const handlers = new WebGPUHandlers(ctx);

      const response = await handlers.webgpu_memory_layout({ track: true });
      const result = ResponseBuilder.parse(response);

      expect(result.success).toBe(true);
      const entry = stateBoard.getStore().state.get('webgpu:webgpu_memory_https://example.com/');
      expect(entry).toBeDefined();
      expect(entry).not.toBeUndefined();
      const value = entry!.value as any;
      expect(value.trackedBytes).toBe(512);
      expect(entry!.namespace).toBe('webgpu');
    });

    it('increments state board version on each write (Bug #2 fix)', async () => {
      // Bug #2: writeSnapshot hardcoded version:1 — second write produced
      // no change event because version didn't increment. Verify monotonic
      // version progression matches handleSet semantics.
      const { SharedStateBoardHandlers } =
        await import('@server/domains/coordination/state-board/handlers.impl.core');
      const stateBoard = new SharedStateBoardHandlers();

      const allocations1 = [{ size: 100, usage: 'VERTEX', type: 'buffer', alive: true }];
      const page1 = makeMockPage(allocations1, []);
      const ctx1 = {
        eventBus: { emit: () => {} },
        pageController: { getActivePage: async () => page1 },
        sharedStateBoardHandlers: stateBoard,
      } as unknown as MCPServerContext;
      const handlers1 = new WebGPUHandlers(ctx1);

      // First write → version 1.
      const r1 = ResponseBuilder.parse(await handlers1.webgpu_memory_layout({ track: true }));
      expect(r1.success).toBe(true);
      const e1 = stateBoard.getStore().state.get('webgpu:webgpu_memory_https://example.com/');
      expect(e1).toBeDefined();
      expect(e1!.version).toBe(1);

      // Second write → version 2 (was stuck at 1 before Bug #2 fix).
      const allocations2 = [{ size: 200, usage: 'VERTEX', type: 'buffer', alive: true }];
      const page2 = makeMockPage(allocations2, []);
      const ctx2 = {
        eventBus: { emit: () => {} },
        pageController: { getActivePage: async () => page2 },
        sharedStateBoardHandlers: stateBoard,
      } as unknown as MCPServerContext;
      const handlers2 = new WebGPUHandlers(ctx2);

      const r2 = ResponseBuilder.parse(await handlers2.webgpu_memory_layout({ track: true }));
      expect(r2.success).toBe(true);
      const e2 = stateBoard.getStore().state.get('webgpu:webgpu_memory_https://example.com/');
      expect(e2).toBeDefined();
      expect(e2!.version).toBe(2);

      // Third write → version 3.
      const allocations3 = [{ size: 300, usage: 'VERTEX', type: 'buffer', alive: true }];
      const page3 = makeMockPage(allocations3, []);
      const ctx3 = {
        eventBus: { emit: () => {} },
        pageController: { getActivePage: async () => page3 },
        sharedStateBoardHandlers: stateBoard,
      } as unknown as MCPServerContext;
      const handlers3 = new WebGPUHandlers(ctx3);

      const r3 = ResponseBuilder.parse(await handlers3.webgpu_memory_layout({ track: true }));
      expect(r3.success).toBe(true);
      const e3 = stateBoard.getStore().state.get('webgpu:webgpu_memory_https://example.com/');
      expect(e3).toBeDefined();
      expect(e3!.version).toBe(3);

      // createdAt must not change across writes (preserved from first write).
      expect(e2!.createdAt).toBe(e1!.createdAt);
      expect(e3!.createdAt).toBe(e1!.createdAt);
    });
  });
});
