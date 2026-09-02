/**
 * Tests for off-thread heap-snapshot parsing (b1-02).
 *
 * Two concerns:
 *   1. The allocation-track handler submits the snapshot parse to an injected
 *      worker pool instead of running JSON.parse on the main thread.
 *   2. The self-contained worker script parses a real multi-MB tracking
 *      snapshot correctly (sorted allocations, correct totals).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@utils/WorkerPool';
import {
  HEAP_PARSE_WORKER_SCRIPT,
  type HeapParsePool,
} from '@server/domains/v8-inspector/handlers/heap-parse-worker';
import {
  handleAllocationTrack,
  type ParsedAllocationSnapshot,
} from '@server/domains/v8-inspector/handlers/allocation-track';

// Capped durations so the capture window does not dominate test time.
vi.stubEnv('VITEST', 'true');

/** Minimal CDP session mock that dispatches events to registered handlers. */
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
      if (h.event === event) h.handler(data);
    }
  };
  const send = vi.fn().mockImplementation((method: string) => {
    const impl = impls[method];
    return impl ? impl(emitEvent) : Promise.resolve({});
  });
  return { send, on, off };
}

describe('handleAllocationTrack worker-pool path', () => {
  it('submits the snapshot parse to the pool instead of parsing on the main thread', async () => {
    const mockResult: ParsedAllocationSnapshot = {
      ok: true,
      allocations: [
        {
          objectId: 1,
          sizeBytes: 500,
          functionName: 'makeRequest',
          scriptId: 10,
          url: 'app.js',
          lineNumber: 12,
        },
      ],
      totalLiveBytes: 500,
      trackedNodeCount: 1,
    };
    const mockPool: HeapParsePool = { submit: vi.fn().mockResolvedValue(mockResult) };

    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        // Malformed JSON: a main-thread JSON.parse would fail the call, so a
        // success here proves the parse actually ran through the mock pool.
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: '{not-valid-json' });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    const r = await handleAllocationTrack({ durationMs: 50, topN: 10 }, async () => page, mockPool);

    expect(mockPool.submit).toHaveBeenCalledTimes(1);
    expect(mockPool.submit).toHaveBeenCalledWith(
      { chunks: ['{not-valid-json'] },
      expect.any(Number),
    );
    // The handler surfaces the pool's result rather than parsing the chunks.
    expect(r.success).toBe(true);
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]!.functionName).toBe('makeRequest');
  });

  it('falls back to synchronous parsing when no pool is wired in', async () => {
    const { send, on, off } = makeSessionMock({
      'HeapProfiler.stopTrackingHeapObjects': (emit) => {
        emit('HeapProfiler.addHeapSnapshotChunk', { chunk: '{not-valid-json' });
        return Promise.resolve({});
      },
    });
    const session = { send, detach: vi.fn().mockResolvedValue(undefined), on, off };
    const page = { createCDPSession: async () => session };

    // No pool → the sync fallback runs and reports the JSON parse error.
    const r = await handleAllocationTrack({ durationMs: 50 }, async () => page);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/JSON parse failed/);
  });
});

interface LargeSnapshotFixture {
  json: string;
  expectedTotalBytes: number;
  expectedTop: Array<{ functionName: string; sizeBytes: number; url: string; lineNumber: number }>;
}

/**
 * Build a tracking heap snapshot whose serialized JSON is at least `targetBytes`
 * (bulk = padding no-stack nodes, like a real browser snapshot), with three
 * tracked nodes carrying allocation stacks.
 */
function buildLargeSnapshotJson(targetBytes: number): LargeSnapshotFixture {
  const nodeFields = [
    'type',
    'name',
    'id',
    'self_size',
    'edge_count',
    'trace_node_id',
    'detachedness',
    'allocation_stack',
  ];
  const strings = [
    '',
    'BigObject',
    'SmallArray',
    'MediumMap',
    'makeRequest',
    'app.js',
    'parseResponse',
  ];
  const traceFunctionInfos = [
    { function_info_index: 0, name: 0, script_id: 0, script_name: 0, line: 0, column: 0 },
    { function_info_index: 1, name: 4, script_id: 10, script_name: 5, line: 12, column: 3 },
    { function_info_index: 2, name: 6, script_id: 10, script_name: 5, line: 40, column: 1 },
  ];

  const nodes: unknown[] = [];
  // Padding no-stack nodes dominate the size (mirrors a real snapshot's bulk).
  let padId = 1000;
  const PAD_NODES = 250_000;
  for (let i = 0; i < PAD_NODES; i += 1) {
    nodes.push(4, 0, padId++, 1, 0, 0, 0, null);
  }
  // Three tracked nodes (allocation_stack set) resolve via trace_function_infos.
  nodes.push(4, 1, 1, 900000, 0, 1, 0, 1); // BigObject   → makeRequest
  nodes.push(1, 2, 2, 500, 0, 1, 0, 1); //     SmallArray  → makeRequest
  nodes.push(4, 3, 3, 50000, 0, 2, 0, 2); //   MediumMap   → parseResponse

  const snapshot = {
    snapshot: {
      meta: { node_fields: nodeFields },
      node_count: PAD_NODES + 3,
      edge_count: 0,
      trace_function_count: 3,
    },
    nodes,
    edges: [],
    trace_function_infos: traceFunctionInfos,
    strings,
  };
  const json = JSON.stringify(snapshot);
  expect(json.length).toBeGreaterThanOrEqual(targetBytes);

  return {
    json,
    expectedTotalBytes: 900000 + 500 + 50000,
    expectedTop: [
      { functionName: 'makeRequest', sizeBytes: 900000, url: 'app.js', lineNumber: 12 },
      { functionName: 'parseResponse', sizeBytes: 50000, url: 'app.js', lineNumber: 40 },
      { functionName: 'makeRequest', sizeBytes: 500, url: 'app.js', lineNumber: 12 },
    ],
  };
}

describe('heap parse worker runtime', () => {
  const pools: Array<WorkerPool<Record<string, unknown>, ParsedAllocationSnapshot>> = [];

  afterEach(async () => {
    await Promise.allSettled(pools.splice(0).map((pool) => pool.close()));
  });

  it('parses a ~5MB tracking snapshot in the worker with sorted allocations', async () => {
    const fixture = buildLargeSnapshotJson(5_000_000);
    const pool = new WorkerPool<Record<string, unknown>, ParsedAllocationSnapshot>({
      name: 'heap-parse-runtime-test',
      workerScript: HEAP_PARSE_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });
    pools.push(pool);

    const result = await pool.submit({ chunks: [fixture.json] }, 30_000);

    expect(result.ok).toBe(true);
    expect(result.trackedNodeCount).toBe(3);
    expect(result.totalLiveBytes).toBe(fixture.expectedTotalBytes);
    expect(result.allocations).toHaveLength(3);
    // Sorted descending by sizeBytes; stack frames resolve to the right names.
    expect(result.allocations[0]!.functionName).toBe(fixture.expectedTop[0]!.functionName);
    expect(result.allocations[0]!.sizeBytes).toBe(fixture.expectedTop[0]!.sizeBytes);
    expect(result.allocations[0]!.url).toBe(fixture.expectedTop[0]!.url);
    expect(result.allocations[0]!.lineNumber).toBe(fixture.expectedTop[0]!.lineNumber);
    expect(result.allocations[1]!.functionName).toBe(fixture.expectedTop[1]!.functionName);
    expect(result.allocations[1]!.sizeBytes).toBe(fixture.expectedTop[1]!.sizeBytes);
    expect(result.allocations[2]!.functionName).toBe(fixture.expectedTop[2]!.functionName);
    expect(result.allocations[2]!.sizeBytes).toBe(fixture.expectedTop[2]!.sizeBytes);
  });
});
