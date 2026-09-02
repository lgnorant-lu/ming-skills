/**
 * Regression tests for b1-03 — v8-inspector CDP-heavy tools must be gated by
 * the shared `cdpLimit` concurrency limiter.
 *
 * Previously the v8-inspector domain had zero `cdpLimit` usage: concurrent
 * heap-snapshot captures double the peak memory, and CDP Tracing runs are
 * target-exclusive with no back-pressure. These tests pin that the capture and
 * tracing handler entry points all route through `cdpLimit`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Wrap the real cdpLimit so behavior is preserved but the call is observable.
vi.mock('@utils/concurrency', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@utils/concurrency')>();
  return {
    ...actual,
    cdpLimit: vi.fn((fn: () => unknown) => actual.cdpLimit(fn)),
  };
});

import { cdpLimit } from '@utils/concurrency';
import { V8InspectorHandlers } from '@server/domains/v8-inspector/handlers/impl';
import { clearSnapshotCache } from '@server/domains/v8-inspector/handlers/heap-snapshot';

function makeCdpDeps(): ConstructorParameters<typeof V8InspectorHandlers>[0] {
  const ctx = {
    pageController: { getPage: vi.fn().mockResolvedValue(undefined) },
    eventBus: { emit: vi.fn().mockResolvedValue(undefined) },
  } as unknown as import('@server/MCPServer.context').MCPServerContext;
  return {
    ctx,
    client:
      undefined as unknown as import('@modules/v8-inspector/V8InspectorClient').V8InspectorClient,
  };
}

describe('v8-inspector CDP-heavy handlers are gated by cdpLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSnapshotCache();
  });

  afterEach(() => {
    clearSnapshotCache();
  });

  it('gates v8_heap_snapshot_capture through cdpLimit', async () => {
    const handlers = new V8InspectorHandlers(makeCdpDeps());
    await handlers.v8_heap_snapshot_capture({ persist: false });
    expect(cdpLimit).toHaveBeenCalledTimes(1);
  });

  it('gates v8_allocation_track through cdpLimit', async () => {
    const handlers = new V8InspectorHandlers(makeCdpDeps());
    await handlers.v8_allocation_track({ durationMs: 100 });
    expect(cdpLimit).toHaveBeenCalledTimes(1);
  });

  it('gates v8_heap_sampling through cdpLimit', async () => {
    const handlers = new V8InspectorHandlers(makeCdpDeps());
    await handlers.v8_heap_sampling({ durationMs: 100 });
    expect(cdpLimit).toHaveBeenCalledTimes(1);
  });

  it('gates v8_deopt_trace through cdpLimit', async () => {
    const handlers = new V8InspectorHandlers({ ctx: {} } as never);
    await handlers.v8_deopt_trace({ durationMs: 100 });
    expect(cdpLimit).toHaveBeenCalledTimes(1);
  });

  it('gates v8_turbofan_graph through cdpLimit', async () => {
    const handlers = new V8InspectorHandlers({ ctx: {} } as never);
    await handlers.v8_turbofan_graph({});
    expect(cdpLimit).toHaveBeenCalledTimes(1);
  });
});
