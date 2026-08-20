/**
 * Integration tests for target-aware heap snapshot capture.
 *
 * When the browser domain has an attached CDP target (worker/SW via
 * browser_attach_cdp_target), v8_heap_snapshot_capture must snapshot THAT
 * target, record its provenance, and — critically — NOT detach the session
 * (it is collector-owned; detaching would tear down the browser attach state).
 * These tests pin that contract against a mock attached session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleHeapSnapshotCapture,
  clearSnapshotCache,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import type { CDPSessionLike } from '@server/domains/v8-inspector/handlers/cdp-session';

describe('handleHeapSnapshotCapture — attached CDP target', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  it('captures from the attached session, records worker provenance, and does not detach', async () => {
    const detach = vi.fn().mockResolvedValue(undefined);
    let chunkEmit: ((data: { chunk: string }) => void) | null = null;
    const send = vi.fn(async (method: string) => {
      if (method === 'HeapProfiler.takeHeapSnapshot') {
        // The listener is registered before this resolves (see
        // captureHeapSnapshotViaSession), so emit one snapshot chunk.
        chunkEmit?.({ chunk: '{"snapshot":{"nodes":[],"edges":[]}}' });
      }
      return {};
    });
    const on = vi.fn((event: string, listener: (data: { chunk: string }) => void) => {
      if (event === 'HeapProfiler.addHeapSnapshotChunk') {
        chunkEmit = listener;
      }
    });
    const off = vi.fn();
    const attachedSession = { send, detach, on, off } as CDPSessionLike;

    const result = await handleHeapSnapshotCapture(
      {},
      {
        getPage: async () => {
          throw new Error('page must not be used when an attached target is present');
        },
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
        resolver: {
          getAttachedTargetSession: () => attachedSession,
          getAttachedTargetInfo: () => ({
            type: 'service_worker',
            url: 'http://localhost:9999/sw.js',
            targetId: 'SW-1',
          }),
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(false);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.target).toEqual({
      type: 'service_worker',
      url: 'http://localhost:9999/sw.js',
      targetId: 'SW-1',
    });
    // Ownership contract: the attached session is collector-managed and must
    // survive the capture — detach must never be called on it.
    expect(detach).not.toHaveBeenCalled();
  });

  it('records the targetId on the stored snapshot for later listing', async () => {
    let chunkEmit: ((data: { chunk: string }) => void) | null = null;
    const attachedSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          chunkEmit?.({ chunk: '{"snapshot":{}}' });
        }
        return {};
      }),
      detach: vi.fn(),
      on: vi.fn((_e: string, l: (d: { chunk: string }) => void) => {
        chunkEmit = l;
      }),
      off: vi.fn(),
    } as CDPSessionLike;

    await handleHeapSnapshotCapture(
      {},
      {
        getPage: async () => undefined,
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
        resolver: {
          getAttachedTargetSession: () => attachedSession,
          getAttachedTargetInfo: () => ({
            type: 'worker',
            url: 'http://localhost:9999/worker.js',
            targetId: 'W-42',
          }),
        },
      },
    );

    // The capture stores into the shared snapshot cache; pull it back and
    // verify the worker provenance fields are persisted on the entry.
    const { getSnapshotCache } =
      await import('@server/domains/v8-inspector/handlers/heap-snapshot');
    const entries = Array.from(getSnapshotCache().values());
    const captured = entries[entries.length - 1];
    expect(captured).toBeDefined();
    if (!captured) throw new Error('snapshot was not stored');
    expect(captured.targetType).toBe('worker');
    expect(captured.targetId).toBe('W-42');
    expect(captured.simulated).toBe(false);
  });

  it('falls back with a warning when the attached snapshot fails', async () => {
    const attachedSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          throw new Error('target detached mid-capture');
        }
        return {};
      }),
      detach: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as CDPSessionLike;

    const result = await handleHeapSnapshotCapture(
      {},
      {
        getPage: async () => undefined, // no page either → minimal fallback
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
        resolver: { getAttachedTargetSession: () => attachedSession },
      },
    );

    expect(result.warnings.some((w) => /Attached-target heap snapshot failed/.test(w))).toBe(true);
  });
});
