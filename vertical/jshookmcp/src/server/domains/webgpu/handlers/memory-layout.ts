import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { argBool } from '@server/domains/shared/parse-args';
import { getPageLockManager } from '@modules/webgpu/PageLockManager';
import { getGPUMemoryStats } from '@modules/webgpu/CDPIntegration';
import type { StateEntry } from '@server/domains/coordination/state-board/handlers.impl.core';
import type { MCPServerContext } from '@server/domains/shared/registry';
import type { WebGPUDomainDependencies } from '../types';

/** Namespace used for memory snapshots on the shared state board. */
const TRACK_NAMESPACE = 'webgpu';

/**
 * A point-in-time GPU memory snapshot stored for trend analysis.
 */
interface MemorySnapshot {
  timestamp: number;
  heapSize: number;
  usedHeapSize: number;
  trackedBytes: number;
  allocationCount: number;
  memorySource: string;
}

/**
 * Fallback snapshot store used when the coordination domain (state board) is
 * not present in the server context (e.g. minimal test contexts). Module-level
 * so multiple handler instances share the same trend history, mirroring the
 * process-wide state board singleton.
 */
const fallbackSnapshots = new Map<string, MemorySnapshot>();

/**
 * Handler for webgpu_memory_layout tool
 * Analyzes GPU memory allocations and buffer usage patterns.
 *
 * With `track: true`, each call snapshots the current stats to the shared
 * state board (`webgpu_memory_<canvasId>` in the `webgpu` namespace) and
 * reports the delta + growth rate versus the previous snapshot. With
 * `track` omitted/false the behavior is unchanged (single point snapshot).
 */
export class MemoryLayoutHandler {
  private ctx: MCPServerContext;
  private deps: WebGPUDomainDependencies;
  private pageLockManager = getPageLockManager();

  constructor(ctx: MCPServerContext, deps: WebGPUDomainDependencies) {
    this.ctx = ctx;
    this.deps = deps;
  }

  async handle(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => {
      const track = argBool(args, 'track', false);

      const page = await this.getActivePage();
      if (!page) {
        throw new Error('No active page. Call browser_launch or browser_attach first.');
      }

      const pageId = page.url();

      // Acquire page lock to prevent concurrent GPU context access.
      // Snapshot read/write are inside the lock to prevent interleaving
      // under HTTP/SSE transport (Bug #3 fix).
      const result = await this.pageLockManager.withLock(pageId, async () => {
        // Use real CDP integration to get GPU memory stats
        const memoryStats = await getGPUMemoryStats(page);

        const base = {
          heapSize: memoryStats.heapSize,
          usedHeapSize: memoryStats.usedHeapSize,
          allocations: memoryStats.allocations,
          // Provenance of usedHeapSize so consumers can gauge data quality:
          // 'cdp' = Performance.getMetrics GPUMemoryUsedKB (most accurate),
          // 'tracked' = sum of live WeakRef-tracked allocations (lower bound),
          // 'estimated' = no signal available (conservative fallback).
          memorySource: memoryStats.memorySource,
          trackedBytes: memoryStats.trackedBytes,
        };

        if (!track) {
          return base;
        }

        // Trend mode: snapshot + compare against the previous reading.
        const canvasId = page.url();
        const key = `webgpu_memory_${canvasId}`;
        const snapshot: MemorySnapshot = {
          timestamp: Date.now(),
          heapSize: base.heapSize,
          usedHeapSize: base.usedHeapSize,
          trackedBytes: base.trackedBytes,
          allocationCount: base.allocations.length,
          memorySource: base.memorySource,
        };

        const previous = this.readSnapshot(key);
        this.writeSnapshot(key, snapshot);

        const delta = previous
          ? {
              usedHeapSizeDelta: snapshot.usedHeapSize - previous.usedHeapSize,
              trackedBytesDelta: snapshot.trackedBytes - previous.trackedBytes,
              allocationCountDelta: snapshot.allocationCount - previous.allocationCount,
              elapsedMs: snapshot.timestamp - previous.timestamp,
            }
          : null;

        // Growth rate uses trackedBytes (the reliable lower bound) — KB/s.
        const growthRateKbPerSec =
          delta && delta.elapsedMs > 0
            ? delta.trackedBytesDelta / (delta.elapsedMs / 1000) / 1024
            : null;

        return {
          ...base,
          tracking: {
            enabled: true,
            namespace: TRACK_NAMESPACE,
            key,
            snapshot,
            previous: previous ?? null,
            delta,
            growthRateKbPerSec,
          },
        };
      });

      return result;
    });
  }

  // Bug #1 fix: async + await so try/catch traps promise rejections, not
  // just synchronous throws. Matches the pattern used by all 8 other
  // webgpu handlers (adapter-info, shader-compile, timing-analysis,
  // command-capture, frame-timing, error-capture, shader-source-capture,
  // pipeline-dump).
  private async getActivePage(): Promise<any> {
    if (!this.deps.pageController) {
      return null;
    }

    try {
      return await this.deps.pageController.getActivePage();
    } catch {
      return null;
    }
  }

  /** Shared state board store, or null when the coordination domain is absent. */
  private getStateStore(): {
    state: Map<string, StateEntry>;
  } | null {
    const handlers = (this.ctx as { sharedStateBoardHandlers?: { getStore?: () => unknown } })
      .sharedStateBoardHandlers;
    const store = handlers?.getStore?.() as { state: Map<string, StateEntry> } | undefined;
    return store ?? null;
  }

  private readSnapshot(key: string): MemorySnapshot | undefined {
    const store = this.getStateStore();
    if (store) {
      const entry = store.state.get(`${TRACK_NAMESPACE}:${key}`);
      return entry?.value as MemorySnapshot | undefined;
    }
    return fallbackSnapshots.get(key);
  }

  // Bug #2 fix: read existing version and increment, matching the canonical
  // handleSet pattern (existing?.version ?? 0) + 1. The hardcoded version:1
  // caused the watch subsystem to never fire change events after the first
  // write because entry.version never changed.
  private writeSnapshot(key: string, snapshot: MemorySnapshot): void {
    const store = this.getStateStore();
    if (store) {
      const now = Date.now();
      const fullKey = `${TRACK_NAMESPACE}:${key}`;
      const existing = store.state.get(fullKey);
      const entry: StateEntry = {
        key,
        namespace: TRACK_NAMESPACE,
        value: snapshot,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        version: (existing?.version ?? 0) + 1,
      };
      store.state.set(fullKey, entry);
      return;
    }
    fallbackSnapshots.set(key, snapshot);
  }
}
