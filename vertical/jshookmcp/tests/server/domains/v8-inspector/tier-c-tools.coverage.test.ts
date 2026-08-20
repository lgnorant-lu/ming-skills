/**
 * Tests for the 3 Tier C v8-inspector tools (heap-sampling, allocation-track,
 * weakrefs-inspect). Exercises the no-CDP-session early return, the happy
 * path with a mocked CDP session, and the error path.
 */

import { describe, expect, it, vi } from 'vitest';
import { handleHeapSampling } from '@server/domains/v8-inspector/handlers/heap-sampling';
import { handleAllocationTrack } from '@server/domains/v8-inspector/handlers/allocation-track';
import { handleWeakRefsInspect } from '@server/domains/v8-inspector/handlers/weakrefs-inspect';

// Capped durations so the test suite doesn't actually wait 5s.
vi.stubEnv('VITEST', 'true');

describe('handleHeapSampling', () => {
  it('returns unavailable when getPage resolves to undefined', async () => {
    const r = await handleHeapSampling({ durationMs: 100 }, async () => undefined);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/CDP session/);
    expect(r.sites).toHaveLength(0);
  });

  it('returns unavailable when getPage is omitted', async () => {
    const r = await handleHeapSampling({ durationMs: 100 });
    expect(r.success).toBe(false);
  });

  it('collects sampling profile and sorts sites by totalSize', async () => {
    // Two-level call tree: root → [bigAlloc (self 10000), smallAlloc (self 100)]
    const profileHead = {
      callFrame: {
        functionName: '(root)',
        scriptId: '0',
        url: '',
        lineNumber: -1,
        columnNumber: -1,
      },
      selfSize: 0,
      children: [
        {
          callFrame: {
            functionName: 'bigAlloc',
            scriptId: '1',
            url: 'a.js',
            lineNumber: 10,
            columnNumber: 0,
          },
          selfSize: 10000,
          children: [],
        },
        {
          callFrame: {
            functionName: 'smallAlloc',
            scriptId: '2',
            url: 'b.js',
            lineNumber: 20,
            columnNumber: 0,
          },
          selfSize: 100,
          children: [],
        },
      ],
    };
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'HeapProfiler.getSamplingProfile') {
        return Promise.resolve({ profile: { head: profileHead } });
      }
      return Promise.resolve({});
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleHeapSampling({ durationMs: 50, topN: 10 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.sites).toHaveLength(2);
    // bigAlloc must sort first (higher totalSize).
    expect(r.sites[0]!.functionName).toBe('bigAlloc');
    expect(r.sites[0]!.totalSize).toBe(10000);
    expect(r.sites[1]!.functionName).toBe('smallAlloc');
    expect(r.totalSampledBytes).toBe(10100);
    expect(session.detach).toHaveBeenCalled();
  });

  it('handles empty profile gracefully', async () => {
    const send = vi.fn().mockResolvedValue({ profile: {} });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleHeapSampling({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.sites).toHaveLength(0);
    expect(r.summary).toMatch(/empty/);
  });

  it('returns failure when getSamplingProfile throws', async () => {
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'HeapProfiler.getSamplingProfile') {
        return Promise.reject(new Error('profiler not enabled'));
      }
      return Promise.resolve({});
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleHeapSampling({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/profiler not enabled/);
    expect(session.detach).toHaveBeenCalled();
  });
});

describe('handleAllocationTrack', () => {
  it('returns unavailable when no CDP session', async () => {
    const r = await handleAllocationTrack({ durationMs: 100 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/CDP session/);
  });

  it('collects live allocations and sorts by size', async () => {
    const entries = [{ bytes: 5000 }, { bytes: 500 }, { bytes: 50000 }];
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'HeapProfiler.stopObjectTracking') {
        return Promise.resolve({ entries });
      }
      return Promise.resolve({});
    });
    const on = vi.fn();
    const off = vi.fn();
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50, topN: 10 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(3);
    // Sorted by size descending — 50000 first.
    expect(r.allocations[0]!.sizeBytes).toBe(50000);
    expect(r.allocations[1]!.sizeBytes).toBe(5000);
    expect(r.totalLiveBytes).toBe(55500);
    // lastSeenObjectId listener registered + torn down.
    expect(on).toHaveBeenCalledWith('HeapProfiler.lastSeenObjectId', expect.any(Function));
    expect(off).toHaveBeenCalled();
  });

  it('returns failure when startObjectTracking throws', async () => {
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'HeapProfiler.startObjectTracking') {
        return Promise.reject(new Error('already tracking'));
      }
      return Promise.resolve({});
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already tracking/);
  });
});

describe('handleWeakRefsInspect', () => {
  it('returns unavailable when no CDP session', async () => {
    const r = await handleWeakRefsInspect({});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/CDP session/);
  });

  it('aggregates live/cleared WeakRefs and FinalizationRegistries', async () => {
    const weakRefsValue = {
      weakRefs: [
        { source: 'global', isLive: true, targetClassName: 'BigCache' },
        { source: 'global', isLive: false, targetClassName: null },
        { source: 'nested', isLive: true, targetClassName: 'Socket' },
      ],
      registries: [
        { source: 'global', constructorName: 'FinalizationRegistry', isRegistered: true },
      ],
    };
    const send = vi.fn().mockResolvedValue({ result: { value: weakRefsValue } });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleWeakRefsInspect({ scanDepth: 3 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.weakRefCount).toBe(3);
    expect(r.liveWeakRefs).toBe(2);
    expect(r.clearedWeakRefs).toBe(1);
    expect(r.finalizationRegistries).toBe(1);
    expect(r.summary).toMatch(/3 WeakRefs/);
  });

  it('handles evaluate returning undefined value', async () => {
    const send = vi.fn().mockResolvedValue({ result: { value: undefined } });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleWeakRefsInspect({}, async () => page);

    expect(r.success).toBe(true);
    expect(r.weakRefCount).toBe(0);
    expect(r.finalizationRegistries).toBe(0);
  });

  it('returns failure when evaluate throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('context destroyed'));
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleWeakRefsInspect({}, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/context destroyed/);
  });
});
