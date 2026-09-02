/**
 * Regression tests for b1-01 — the in-memory snapshot cache must be bounded.
 *
 * The v8 heap snapshot cache (`snapshotCache` in heap-snapshot.ts) previously
 * retained every captured snapshot's chunks forever, and `enforceSnapshotRetention`
 * only evicted disk files. These tests pin the memory-side cap: the retention
 * enforcement evicts oldest-by-capturedAt entries from the in-memory cache, and
 * the capture flow bounds the cache to `MCP_V8_HEAP_SNAPSHOT_MAX_COUNT`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleHeapSnapshotCapture,
  enforceSnapshotCacheRetention,
  clearSnapshotCache,
  getSnapshotCache,
  getSnapshot,
  storeSnapshot,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import { MCP_V8_HEAP_SNAPSHOT_MAX_COUNT } from '@src/constants/server';

function iso(offsetMs: number): string {
  return new Date(1_700_000_000_000 + offsetMs).toISOString();
}

describe('enforceSnapshotCacheRetention', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  afterEach(() => {
    clearSnapshotCache();
  });

  it('is a no-op when the cap is non-positive', () => {
    storeSnapshot({ id: 'a', chunks: ['{}'], capturedAt: iso(0), sizeBytes: 0 });
    const evicted = enforceSnapshotCacheRetention(0);
    expect(evicted).toEqual([]);
    expect(getSnapshotCache().size).toBe(1);
  });

  it('is a no-op when the cache is at or under the cap', () => {
    storeSnapshot({ id: 'a', chunks: ['{}'], capturedAt: iso(0), sizeBytes: 0 });
    storeSnapshot({ id: 'b', chunks: ['{}'], capturedAt: iso(1), sizeBytes: 0 });
    const evicted = enforceSnapshotCacheRetention(3);
    expect(evicted).toEqual([]);
    expect(getSnapshotCache().size).toBe(2);
  });

  it('evicts oldest-by-capturedAt entries and keeps the newest maxCount', () => {
    storeSnapshot({ id: 'oldest', chunks: ['{}'], capturedAt: iso(0), sizeBytes: 0 });
    storeSnapshot({ id: 'mid', chunks: ['{}'], capturedAt: iso(10), sizeBytes: 0 });
    storeSnapshot({ id: 'newest', chunks: ['{}'], capturedAt: iso(20), sizeBytes: 0 });
    storeSnapshot({ id: 'fourth', chunks: ['{}'], capturedAt: iso(30), sizeBytes: 0 });

    const evicted = enforceSnapshotCacheRetention(3);

    expect(evicted).toEqual(['oldest']);
    expect(getSnapshotCache().size).toBe(3);
    expect(getSnapshot('oldest')).toBeUndefined();
    expect(getSnapshot('mid')).toBeDefined();
    expect(getSnapshot('newest')).toBeDefined();
    expect(getSnapshot('fourth')).toBeDefined();
  });

  it('returns the default cap of 3 from the constants layer', () => {
    expect(MCP_V8_HEAP_SNAPSHOT_MAX_COUNT).toBe(3);
  });
});

describe('handleHeapSnapshotCapture — memory cap enforcement', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSnapshotCache();
  });

  it('bounds the in-memory cache across repeated captures', async () => {
    // Distinct ids via Date.now; capturedAt may tie under the real clock, in
    // which case the stable sort keeps insertion order and evicts first-in.
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));

    const capturedIds: string[] = [];
    const results: Array<{ evicted?: string[] }> = [];

    for (let i = 0; i < 4; i++) {
      const client = {
        takeHeapSnapshot: vi.fn(async (onChunk: (c: string) => void) => {
          onChunk('chunk');
          return 1;
        }),
      };
      const result = await handleHeapSnapshotCapture(
        {},
        {
          getPage: async () => ({}),
          getSnapshot: () => null,
          setSnapshot: () => undefined,
          client: client as never,
          persist: false,
        },
      );
      capturedIds.push(result.snapshotId);
      results.push(result);
    }

    expect(getSnapshotCache().size).toBe(3);
    // The first (oldest) snapshot is evicted from memory.
    expect(getSnapshot(capturedIds[0]!)).toBeUndefined();
    // The final capture reports the evicted id.
    expect(results[3]!.evicted).toEqual([capturedIds[0]!]);
  });
});
