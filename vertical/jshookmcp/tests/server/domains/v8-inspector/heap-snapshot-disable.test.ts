/**
 * Regression tests: every HeapProfiler.enable must be paired with a
 * HeapProfiler.disable — both on the attached-target path (whose session
 * lifecycle is collector-managed, so the enable must not leak) and on the
 * page-evaluate fallback (which creates its own session).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleHeapSnapshotCapture,
  clearSnapshotCache,
} from '@server/domains/v8-inspector/handlers/heap-snapshot';
import type { CDPSessionLike } from '@server/domains/v8-inspector/handlers/cdp-session';

describe('heap snapshot capture — HeapProfiler.enable/disable pairing', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  it('disables HeapProfiler on the attached-target path after a successful capture', async () => {
    const methods: string[] = [];
    let chunkEmit: ((data: { chunk: string }) => void) | null = null;
    const attachedSession = {
      send: vi.fn(async (method: string) => {
        methods.push(method);
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
        getPage: async () => {
          throw new Error('page must not be used');
        },
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
        resolver: { getAttachedTargetSession: () => attachedSession },
      },
    );

    expect(methods.filter((m) => m === 'HeapProfiler.enable')).toHaveLength(1);
    expect(methods.filter((m) => m === 'HeapProfiler.disable')).toHaveLength(1);
    expect(methods.indexOf('HeapProfiler.disable')).toBeGreaterThan(
      methods.indexOf('HeapProfiler.takeHeapSnapshot'),
    );
  });

  it('disables HeapProfiler on the attached-target path even when capture fails', async () => {
    const methods: string[] = [];
    const attachedSession = {
      send: vi.fn(async (method: string) => {
        methods.push(method);
        if (method === 'HeapProfiler.takeHeapSnapshot') {
          throw new Error('target gone');
        }
        return {};
      }),
      detach: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    } as CDPSessionLike;

    await handleHeapSnapshotCapture(
      {},
      {
        getPage: async () => undefined,
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
        resolver: { getAttachedTargetSession: () => attachedSession },
      },
    );

    // enable must still be paired with disable on the failure path.
    expect(methods.filter((m) => m === 'HeapProfiler.enable')).toHaveLength(1);
    expect(methods.filter((m) => m === 'HeapProfiler.disable')).toHaveLength(1);
  });

  it('disables HeapProfiler on the page-evaluate fallback session before detach', async () => {
    const sessionMethods: string[] = [];
    const detach = vi.fn().mockResolvedValue(undefined);
    const cdpSession = {
      send: vi.fn(async (method: string) => {
        sessionMethods.push(method);
        if (method === 'Runtime.evaluate') {
          return { result: { value: JSON.stringify({ jsHeapSizeUsed: 1234 }) } };
        }
        return {};
      }),
      detach,
    };
    const page = {
      createCDPSession: vi.fn(async () => cdpSession),
      evaluate: vi.fn(),
    };

    await handleHeapSnapshotCapture(
      {},
      {
        getPage: async () => page,
        getSnapshot: () => null,
        setSnapshot: () => undefined,
        persist: false,
      },
    );

    expect(sessionMethods.filter((m) => m === 'HeapProfiler.enable')).toHaveLength(1);
    expect(sessionMethods.filter((m) => m === 'HeapProfiler.disable')).toHaveLength(1);
    // Order: enable → evaluate → disable, then detach.
    expect(sessionMethods.indexOf('HeapProfiler.disable')).toBeGreaterThan(
      sessionMethods.indexOf('Runtime.evaluate'),
    );
    expect(detach).toHaveBeenCalled();
  });
});
