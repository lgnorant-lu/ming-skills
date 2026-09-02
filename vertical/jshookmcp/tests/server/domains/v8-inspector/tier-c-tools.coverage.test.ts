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
    // sampleCount = total call-tree node count (root + 2 leaves), not the
    // non-CDP identityGroups field.
    expect(r.sampleCount).toBe(3);
    expect(r.sites[0]!.sampleCount).toBe(0); // leaf node — no children
    // Default sampling interval passed to CDP.
    expect(send).toHaveBeenCalledWith('HeapProfiler.startSampling', {
      samplingInterval: 32768,
    });
    expect(session.detach).toHaveBeenCalled();
  });

  it('passes a custom samplingInterval through to CDP', async () => {
    const send = vi.fn().mockResolvedValue({
      profile: { head: { callFrame: {}, selfSize: 0, children: [] } },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleHeapSampling(
      { durationMs: 50, samplingInterval: 1024 },
      async () => page,
    );

    expect(r.success).toBe(true);
    expect(send).toHaveBeenCalledWith('HeapProfiler.startSampling', { samplingInterval: 1024 });
  });

  it('clamps samplingInterval to the CDP range 256..1048576', async () => {
    const send = vi.fn().mockResolvedValue({
      profile: { head: { callFrame: {}, selfSize: 0, children: [] } },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    await handleHeapSampling({ durationMs: 50, samplingInterval: 1 }, async () => page);
    expect(send).toHaveBeenCalledWith('HeapProfiler.startSampling', { samplingInterval: 256 });

    await handleHeapSampling({ durationMs: 50, samplingInterval: 2_000_000 }, async () => page);
    expect(send).toHaveBeenCalledWith('HeapProfiler.startSampling', {
      samplingInterval: 1048576,
    });
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
  // Real CDP behavior: stopTrackingHeapObjects/takeHeapSnapshot return the
  // empty object `{}` — snapshot data arrives via HeapProfiler.addHeapSnapshotChunk
  // events. The tracking snapshot carries the allocation_stack node field for
  // objects allocated while tracking was active.
  function buildAllocationSnapshotJson(): string {
    return JSON.stringify({
      snapshot: {
        meta: {
          node_fields: [
            'type',
            'name',
            'id',
            'self_size',
            'edge_count',
            'trace_node_id',
            'detachedness',
            'allocation_stack',
          ],
          node_types: [
            [
              'hidden',
              'array',
              'string',
              'object',
              'code',
              'closure',
              'regexp',
              'number',
              'native',
              'synthetic',
              'concatenated string',
              'sliced string',
              'symbol',
              'bigint',
              'object shape',
            ],
            'string',
            'number',
            'number',
            'number',
            'number',
            'number',
            ['object', 'number'],
          ],
          edge_fields: ['type', 'name_or_index', 'to_node'],
          edge_types: [
            ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'],
            'string_or_number',
            'node',
          ],
          trace_function_info_fields: [
            'function_id',
            'name',
            'script_name',
            'script_id',
            'line',
            'column',
          ],
          trace_node_fields: ['id', 'function_info_index', 'count', 'size', 'children'],
        },
        node_count: 5,
        edge_count: 0,
        trace_function_count: 3,
      },
      nodes: [
        // [type, name, id, self_size, edge_count, trace_node_id, detachedness, allocation_stack]
        4,
        0,
        1,
        0,
        0,
        0,
        0,
        null, // system root — no stack, skipped
        4,
        1,
        2,
        5000,
        0,
        1,
        0,
        1, // object (Foo) allocated in makeRequest
        1,
        2,
        3,
        500,
        0,
        1,
        0,
        1, // array (Bar) allocated in makeRequest
        4,
        3,
        4,
        50000,
        0,
        2,
        0,
        2, // object (Baz) allocated in parseResponse
        4,
        1,
        5,
        100,
        0,
        0,
        0,
        0, // root stack frame only (empty name → class-name fallback)
      ],
      edges: [],
      trace_function_infos: [
        // Object shape: name/script_name are indices into `strings`.
        { function_info_index: 0, name: 0, script_id: 0, script_name: 0, line: 0, column: 0 },
        { function_info_index: 1, name: 4, script_id: 10, script_name: 5, line: 12, column: 3 },
        { function_info_index: 2, name: 6, script_id: 10, script_name: 5, line: 40, column: 1 },
      ],
      trace_tree: [
        {
          id: 0,
          function_info_index: 0,
          count: 0,
          size: 0,
          children: [
            { id: 1, function_info_index: 1, count: 2, size: 5500, children: [] },
            { id: 2, function_info_index: 2, count: 1, size: 50000, children: [] },
          ],
        },
      ],
      strings: ['', 'Foo', 'Bar', 'Baz', 'makeRequest', 'app.js', 'parseResponse'],
    });
  }

  // Session mock that dispatches CDP events to the registered handlers, like
  // a real CDPSession does: each method maps to an implementation that may
  // emit events (snapshot chunks, lastSeenObjectId) before resolving.
  function makeSessionMock(
    impls: Record<string, (emitEvent: (event: string, data: unknown) => void) => Promise<unknown>>,
  ) {
    const registered: Array<{ event: string; handler: (data: unknown) => void }> = [];
    const on = vi.fn((event: string, handler: (data: unknown) => void) => {
      registered.push({ event, handler });
    });
    const off = vi.fn();
    const emitEvent = (event: string, data: unknown) => {
      for (const h of registered) {
        if (h.event === event) {
          h.handler(data);
        }
      }
    };
    const send = vi.fn().mockImplementation((method: string) => {
      const impl = impls[method];
      return impl ? impl(emitEvent) : Promise.resolve({});
    });
    return { send, on, off };
  }

  it('returns unavailable when no CDP session', async () => {
    const r = await handleAllocationTrack({ durationMs: 100 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/CDP session/);
  });

  it('collects live allocations from the stop-tracking snapshot and sorts by size', async () => {
    const snapshotJson = buildAllocationSnapshotJson();
    const { send, on, off } = makeSessionMock({
      // Chrome streams the tracking snapshot during the stop call; the
      // response itself is the empty object.
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.lastSeenObjectId', { lastSeenObjectId: 42, timestamp: 1 });
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: snapshotJson });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50, topN: 10 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(4);
    // Sorted by size descending — parseResponse (50000) first.
    expect(r.allocations[0]!.sizeBytes).toBe(50000);
    expect(r.allocations[0]!.functionName).toBe('parseResponse');
    expect(r.allocations[0]!.url).toBe('app.js');
    expect(r.allocations[0]!.lineNumber).toBe(40);
    expect(r.allocations[1]!.functionName).toBe('makeRequest');
    expect(r.allocations[1]!.sizeBytes).toBe(5000);
    expect(r.allocations[2]!.functionName).toBe('makeRequest');
    // Root-only stack frame resolves to the node's class name, never empty.
    expect(r.allocations[3]!.functionName).toBe('Foo');
    expect(r.totalLiveBytes).toBe(55600);
    expect(r.trackedCount).toBe(1);
    expect(r.summary).toMatch(/4 live objects \(55600 bytes\)/);
    // Correct CDP method names are used for start and stop.
    expect(send).toHaveBeenCalledWith('HeapProfiler.startTrackingHeapObjects', {
      trackAllocations: true,
    });
    expect(send).toHaveBeenCalledWith('HeapProfiler.stopTrackingHeapObjects', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
      captureNumericValue: true,
    });
    // The explicit snapshot fallback must NOT run when stop streamed chunks.
    expect(send).not.toHaveBeenCalledWith('HeapProfiler.takeHeapSnapshot', expect.anything());
    // Enable is paired with a disable before the session is released.
    expect(send).toHaveBeenCalledWith('HeapProfiler.disable');
    expect(session.detach).toHaveBeenCalled();
    // lastSeenObjectId listener registered + torn down.
    expect(on).toHaveBeenCalledWith('HeapProfiler.lastSeenObjectId', expect.any(Function));
    expect(off).toHaveBeenCalled();
  });

  it('falls back to takeHeapSnapshot when the stop call returns no chunks', async () => {
    const snapshotJson = buildAllocationSnapshotJson();
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': () => Promise.resolve({}),
      'HeapProfiler.takeHeapSnapshot': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: snapshotJson });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50, topN: 10 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(4);
    expect(r.allocations[0]!.functionName).toBe('parseResponse');
    expect(send).toHaveBeenCalledWith('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      treatGlobalObjectsAsRoots: true,
      captureNumericValue: true,
    });
  });

  it('resolves stack frames from flat trace_function_infos and trace_tree node ids', async () => {
    // Some serializations use flat trace_function_infos and put a trace-tree
    // node id in each node's allocation_stack field.
    const flatSnapshot = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: [
            'type',
            'name',
            'id',
            'self_size',
            'edge_count',
            'trace_node_id',
            'detachedness',
            'allocation_stack',
          ],
          trace_function_info_fields: [
            'function_id',
            'name',
            'script_name',
            'script_id',
            'line',
            'column',
          ],
          trace_node_fields: ['id', 'function_info_index', 'count', 'size', 'children'],
        },
        node_count: 2,
        edge_count: 0,
        trace_function_count: 2,
      },
      nodes: [
        4,
        0,
        1,
        0,
        0,
        0,
        0,
        null,
        4,
        1,
        2,
        7000,
        0,
        0,
        0,
        501, // allocation_stack is a trace node id
      ],
      edges: [],
      trace_function_infos: [
        0,
        0,
        0,
        0,
        0,
        0, // root entry (empty name)
        1,
        4,
        5,
        10,
        7,
        0, // makeRequest / app.js / script 10 / line 7
      ],
      trace_tree: [100, 0, 0, 0, [501, 1, 1, 7000, []]],
      strings: ['', 'Foo', 'Bar', 'Baz', 'makeRequest', 'app.js'],
    });
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: flatSnapshot });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50, topN: 10 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.functionName).toBe('makeRequest');
    expect(r.allocations[0]!.url).toBe('app.js');
    expect(r.allocations[0]!.lineNumber).toBe(7);
    expect(r.allocations[0]!.sizeBytes).toBe(7000);
    expect(r.totalLiveBytes).toBe(7000);
  });

  it('reports a meaningful error when no snapshot data arrives at all', async () => {
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': () => Promise.resolve({}),
      'HeapProfiler.takeHeapSnapshot': () => Promise.resolve({}),
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no snapshot chunks received/);
    expect(r.allocations).toHaveLength(0);
    expect(send).toHaveBeenCalledWith('HeapProfiler.takeHeapSnapshot', expect.anything());
  });

  it('reports a meaningful error when the snapshot lacks allocation_stack data', async () => {
    const plainSnapshot = JSON.stringify({
      snapshot: {
        meta: { node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'] },
      },
      nodes: [4, 0, 1, 0, 0],
      strings: [],
    });
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: plainSnapshot });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no allocation_stack node field/);
    expect(r.allocations).toHaveLength(0);
  });

  it('reports a meaningful error when the snapshot JSON is malformed', async () => {
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: '{not-valid-json' });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/JSON parse failed/);
    expect(r.allocations).toHaveLength(0);
  });

  it('succeeds with an empty list when no node carries an allocation stack', async () => {
    const noStacksSnapshot = JSON.stringify({
      snapshot: {
        meta: {
          node_fields: [
            'type',
            'name',
            'id',
            'self_size',
            'edge_count',
            'trace_node_id',
            'detachedness',
            'allocation_stack',
          ],
        },
      },
      nodes: [4, 0, 1, 0, 0, 0, 0, null, 4, 1, 2, 50, 0, 0, 0, null],
      strings: ['', 'Foo'],
    });
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: noStacksSnapshot });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(0);
    expect(r.totalLiveBytes).toBe(0);
    expect(r.summary).toMatch(/No live objects with allocation stacks found/);
  });

  it('returns failure when startTrackingHeapObjects throws', async () => {
    const send = vi.fn().mockImplementation((method: string) => {
      if (method === 'HeapProfiler.startTrackingHeapObjects') {
        return Promise.reject(new Error('already tracking'));
      }
      return Promise.resolve({});
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already tracking/);
    // Tracking never started — the finally block must not issue the stop command.
    expect(send).not.toHaveBeenCalledWith('HeapProfiler.stopTrackingHeapObjects');
    // The enable is still paired with a disable.
    expect(send).toHaveBeenCalledWith('HeapProfiler.disable');
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
