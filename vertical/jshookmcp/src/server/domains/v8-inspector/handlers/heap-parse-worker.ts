/**
 * Off-thread heap-snapshot parsing for `v8_allocation_track`.
 *
 * `parseAllocationSnapshot` in allocation-track.ts does the heavy work —
 * `JSON.parse(chunks.join(''))` on a full tracking heap snapshot (GB-scale for
 * a large browser) plus building the live-allocation records — synchronously on
 * the event loop. That freezes the process for seconds to tens of seconds.
 *
 * This module moves that work into a `WorkerPool`-backed worker thread (the
 * same `eval: true` self-contained-script pattern as the transform domain's
 * crypto harness, `CRYPTO_TEST_WORKER_SCRIPT`). The main thread only posts the
 * raw `chunks` array; `join('')`, `JSON.parse`, allocation building and the
 * size sort all run in the worker (which also keeps the 3-copy join peak off
 * the main thread, b1-08 for the allocation-track path).
 *
 * ── IMPORTANT: keep the inlined parse logic in `HEAP_PARSE_WORKER_SCRIPT` in
 * sync with `parseAllocationSnapshot` in `./allocation-track` — they are the
 * same parser; the worker copy additionally sorts before returning. Any change
 * to one must be mirrored in the other. ──
 */

import { WorkerPool } from '@utils/WorkerPool';
import type { ParsedAllocationSnapshot } from './allocation-track';

/**
 * Pool sizing / timeouts for heap-snapshot parsing. `min 1` keeps a worker warm
 * (no cold-start latency on the first capture), `max 2` caps CPU oversubscription
 * (parse is CPU-bound; two concurrent GB parses is the ceiling). The job timeout
 * is deliberately longer than WorkerPool's 15s default because a multi-GB
 * snapshot can take tens of seconds to parse.
 */
const HEAP_PARSE_POOL_MIN_WORKERS = 1;
const HEAP_PARSE_POOL_MAX_WORKERS = 2;
const HEAP_PARSE_POOL_IDLE_TIMEOUT_MS = 30_000;
export const HEAP_PARSE_JOB_TIMEOUT_MS = 60_000;
/**
 * Old-gen heap cap (MB) for heap-parse workers. A full tracking snapshot can
 * be GB-scale, but the worker is deliberately capped at 512MB old-gen: a
 * snapshot whose parsed representation exceeds this cap OOM-crashes the worker,
 * which surfaces as a failed job (`success: false`) rather than a partial
 * result. The ceiling trades the largest (multi-GB) captures for a bounded,
 * predictable worker memory footprint — contrast the transform crypto-harness's
 * 64MB cap, which only runs small test snippets.
 */
const HEAP_PARSE_POOL_MAX_OLD_GEN_MB = 512;
/** Young-gen heap cap (MB) for heap-parse workers. */
const HEAP_PARSE_POOL_MAX_YOUNG_GEN_MB = 64;

/**
 * Minimal pool surface the allocation-track handler depends on. Decoupled from
 * the concrete `WorkerPool` so tests can inject a plain `{ submit }` mock.
 */
export interface HeapParsePool {
  submit(payload: { chunks: string[] }, timeoutMs?: number): Promise<ParsedAllocationSnapshot>;
}

/**
 * Self-contained worker script. Runs inside `new Worker(source, { eval: true })`
 * (see `WorkerPool.spawnWorker`), so it carries no imports — it bootstraps
 * `parentPort` via dynamic import exactly like the crypto harness worker.
 *
 * Message protocol (matches `WorkerPool`):
 *   → { jobId, payload: { chunks: string[] } }
 *   ← { jobId, ok: true,  result: ParsedAllocationSnapshot }  (allocations sorted by size desc)
 *   ← { jobId, ok: false, error: string }
 */
export const HEAP_PARSE_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('worker parentPort is unavailable');

  const TRACE_TREE_LOOKUP_BUDGET = 10000;

  function isRecord(value) {
    return typeof value === 'object' && value !== null;
  }
  function toStringArray(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  }
  function resolveStringIndex(strings, index) {
    if (typeof index === 'string') return index;
    if (
      typeof index === 'number' &&
      Number.isInteger(index) &&
      index >= 0 &&
      Array.isArray(strings) &&
      index < strings.length
    ) {
      const value = strings[index];
      return typeof value === 'string' ? value : '';
    }
    return '';
  }
  function parseTraceFunctionInfos(raw) {
    const infos = raw['trace_function_infos'];
    if (!Array.isArray(infos)) return [];
    if (infos.length > 0 && isRecord(infos[0])) return infos;
    const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
    const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;
    const fields = meta ? toStringArray(meta['trace_function_info_fields']) : [];
    if (fields.length === 0) return [];
    const stride = fields.length;
    const result = [];
    for (let i = 0; i + stride <= infos.length; i += stride) {
      const entry = {};
      for (let j = 0; j < stride; j += 1) {
        const field = fields[j];
        if (field) entry[field] = infos[i + j];
      }
      result.push(entry);
    }
    return result;
  }
  function parseTraceTree(raw) {
    const tree = raw['trace_tree'];
    if (!Array.isArray(tree) || tree.length === 0) return null;
    const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
    const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;
    if (isRecord(tree[0])) {
      const parseObjectNode = (node) => {
        const id = node['id'];
        const functionInfoIndex = node['function_info_index'];
        if (typeof id !== 'number' || typeof functionInfoIndex !== 'number') return null;
        const children = [];
        const kids = node['children'];
        if (Array.isArray(kids)) {
          for (const kid of kids) {
            if (isRecord(kid)) {
              const parsed = parseObjectNode(kid);
              if (parsed) children.push(parsed);
            }
          }
        }
        return { id, functionInfoIndex, children };
      };
      return parseObjectNode(tree[0]);
    }
    const fields = meta ? toStringArray(meta['trace_node_fields']) : [];
    const idIndex = fields.indexOf('id');
    const functionInfoIndexField = fields.indexOf('function_info_index');
    const childrenField = fields.indexOf('children');
    if (idIndex < 0 || functionInfoIndexField < 0 || childrenField < 0) return null;
    const stride = fields.length;
    const parseFlatNode = (arr, offset) => {
      const id = arr[offset + idIndex];
      const functionInfoIndex = arr[offset + functionInfoIndexField];
      if (typeof id !== 'number' || typeof functionInfoIndex !== 'number') return null;
      const children = [];
      const kids = arr[offset + childrenField];
      if (Array.isArray(kids)) {
        for (let c = 0; c + stride <= kids.length; c += stride) {
          const parsed = parseFlatNode(kids, c);
          if (parsed) children.push(parsed);
        }
      }
      return { id, functionInfoIndex, children };
    };
    return parseFlatNode(tree, 0);
  }
  function findTraceNodeById(root, id) {
    if (!root) return null;
    const stack = [root];
    let visited = 0;
    while (stack.length > 0 && visited < TRACE_TREE_LOOKUP_BUDGET) {
      const node = stack.pop();
      visited += 1;
      if (node && node.id === id) return node;
      if (node) {
        for (const child of node.children) stack.push(child);
      }
    }
    return null;
  }
  function frameFromInfo(info, strings) {
    const name = resolveStringIndex(strings, info['name']);
    if (!name) return null;
    const scriptId = info['script_id'];
    return {
      functionName: name,
      scriptId: typeof scriptId === 'number' || typeof scriptId === 'string' ? scriptId : '?',
      url: resolveStringIndex(strings, info['script_name']),
      lineNumber: typeof info['line'] === 'number' ? info['line'] : -1,
    };
  }
  function resolveStackFrame(infos, tree, stackValue, strings, nodeName) {
    const fallback = { functionName: nodeName, scriptId: '?', url: '', lineNumber: -1 };
    if (stackValue < infos.length) {
      return frameFromInfo(infos[stackValue] || {}, strings) || fallback;
    }
    const treeNode = findTraceNodeById(tree, stackValue);
    if (treeNode && treeNode.functionInfoIndex >= 0 && treeNode.functionInfoIndex < infos.length) {
      return frameFromInfo(infos[treeNode.functionInfoIndex] || {}, strings) || fallback;
    }
    return fallback;
  }

  function parseAllocationSnapshot(chunks) {
    const empty = { ok: false, allocations: [], totalLiveBytes: 0, trackedNodeCount: 0 };
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return Object.assign({}, empty, { error: 'no snapshot chunks received from the CDP session' });
    }
    let raw;
    try {
      raw = JSON.parse(chunks.join(''));
    } catch (err) {
      return Object.assign({}, empty, {
        error: 'heap snapshot JSON parse failed: ' + (err && err.message ? err.message : String(err)),
      });
    }
    if (!isRecord(raw)) {
      return Object.assign({}, empty, { error: 'heap snapshot is not a JSON object' });
    }
    const snapshot = isRecord(raw['snapshot']) ? raw['snapshot'] : null;
    const meta = snapshot && isRecord(snapshot['meta']) ? snapshot['meta'] : null;
    const nodeFields = meta ? toStringArray(meta['node_fields']) : [];
    const stackFieldIndex = nodeFields.indexOf('allocation_stack');
    if (stackFieldIndex < 0) {
      return Object.assign({}, empty, {
        error:
          'heap snapshot has no allocation_stack node field — allocation-tracking data is absent from this snapshot',
      });
    }
    const nameFieldIndex = nodeFields.indexOf('name');
    const idFieldIndex = nodeFields.indexOf('id');
    const selfSizeFieldIndex = nodeFields.indexOf('self_size');
    const nodes = raw['nodes'];
    if (!Array.isArray(nodes)) {
      return Object.assign({}, empty, { error: 'heap snapshot missing nodes array' });
    }
    const strings = raw['strings'];
    const stride = nodeFields.length;
    const infos = parseTraceFunctionInfos(raw);
    const tree = parseTraceTree(raw);

    const allocations = [];
    let totalLiveBytes = 0;
    let trackedNodeCount = 0;

    for (let offset = 0; offset + stride <= nodes.length; offset += stride) {
      const stackValue = nodes[offset + stackFieldIndex];
      const hasStack =
        typeof stackValue === 'number' && Number.isFinite(stackValue) && stackValue >= 0;
      if (!hasStack) continue;
      trackedNodeCount += 1;
      const selfSize =
        typeof nodes[offset + selfSizeFieldIndex] === 'number'
          ? nodes[offset + selfSizeFieldIndex]
          : 0;
      const objectId =
        idFieldIndex >= 0 && typeof nodes[offset + idFieldIndex] === 'number'
          ? nodes[offset + idFieldIndex]
          : offset / stride;
      const nodeName =
        nameFieldIndex >= 0 ? resolveStringIndex(strings, nodes[offset + nameFieldIndex]) : '';
      const frame = resolveStackFrame(infos, tree, stackValue, strings, nodeName);
      allocations.push({
        objectId,
        sizeBytes: selfSize,
        functionName: frame.functionName || '(unknown)',
        scriptId: frame.scriptId,
        url: frame.url,
        lineNumber: frame.lineNumber,
      });
      totalLiveBytes += selfSize;
    }

    allocations.sort((a, b) => b.sizeBytes - a.sizeBytes);
    return { ok: true, allocations, totalLiveBytes, trackedNodeCount };
  }

  parentPort.on('message', (msg) => {
    const jobId = msg && msg.jobId;
    const payload = msg && msg.payload;
    try {
      const chunks = payload && Array.isArray(payload.chunks) ? payload.chunks : [];
      const result = parseAllocationSnapshot(chunks);
      parentPort.postMessage({ jobId, ok: true, result });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      parentPort.postMessage({ jobId, ok: false, error: message });
    }
  });
};
__bootstrap().catch((error) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(
      'heap parse worker bootstrap failed:',
      error && error.message ? error.message : String(error),
    );
  }
});
`;

let sharedPool: WorkerPool<Record<string, unknown>, ParsedAllocationSnapshot> | null = null;

/**
 * Lazily create (and reuse) the shared heap-parse worker pool. Workers are
 * unref'd by `WorkerPool` so the pool never blocks process exit (matching the
 * transform domain's crypto-harness pool lifecycle).
 */
export function getHeapParsePool(): HeapParsePool {
  if (!sharedPool) {
    sharedPool = new WorkerPool<Record<string, unknown>, ParsedAllocationSnapshot>({
      name: 'heap-parse',
      workerScript: HEAP_PARSE_WORKER_SCRIPT,
      minWorkers: HEAP_PARSE_POOL_MIN_WORKERS,
      maxWorkers: HEAP_PARSE_POOL_MAX_WORKERS,
      idleTimeoutMs: HEAP_PARSE_POOL_IDLE_TIMEOUT_MS,
      resourceLimits: {
        maxOldGenerationSizeMb: HEAP_PARSE_POOL_MAX_OLD_GEN_MB,
        maxYoungGenerationSizeMb: HEAP_PARSE_POOL_MAX_YOUNG_GEN_MB,
      },
    });
  }
  return sharedPool as HeapParsePool;
}

/**
 * Close the shared heap-parse pool and reset the singleton (idempotent — a
 * no-op when never created). Wired into `closeServer()` so the min-1 warm
 * worker is released on shutdown (see `disposeWebcrackPool`).
 */
export async function disposeHeapParsePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.close();
    sharedPool = null;
  }
}
