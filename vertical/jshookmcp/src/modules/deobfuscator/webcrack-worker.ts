/**
 * Off-thread webcrack execution for `runWebcrack` (analysis deobfuscation).
 *
 * `webcrack()` runs the whole deobfuscate/unpack/unminify pipeline — Babel
 * parse + AST transforms + isolated-vm sandbox evaluation — synchronously in
 * one shot. On real obfuscated bundles that blocks the event loop for
 * 150-430ms (the `cpuLimit` gate caps *concurrency* but cannot stop the actual
 * parse/transform from freezing the loop while it runs). This module moves the
 * `import('webcrack')` + `webcrack(code, …)` call into a `WorkerPool`-backed
 * worker thread (the same `eval: true` self-contained-script pattern as the
 * v8-inspector heap-parse worker), so the main thread only posts `{ code,
 * options }` and gets back `{ code, bundle }`.
 *
 * ── IMPORTANT: keep the inlined webcrack invocation in
 * `WEBCRACK_WORKER_SCRIPT` in sync with the fallback path in `./webcrack.ts` —
 * they issue the same `webcrack(code, { jsx, unpack, deobfuscate: true,
 * unminify, mangle })` call. The worker additionally serializes `result.bundle`
 * (a `Map<string, Module>` with private Babel AST state) into plain
 * `{ id, path, isEntry, code }` records so it can cross the structured-clone
 * boundary; the main thread rebuilds the bundle for mappings/summary/save. ──
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { WorkerPool } from '@utils/WorkerPool';

/**
 * Runtime options forwarded to `webcrack()` inside the worker. The main thread
 * resolves `mangle` from `renameVariables` and defaults before posting.
 */
export interface WebcrackWorkerOptions {
  jsx: boolean;
  unpack: boolean;
  unminify: boolean;
  mangle: boolean;
}

export interface WebcrackWorkerPayload extends Record<string, unknown> {
  code: string;
  /** `file://` URL of the resolved webcrack entry (see {@link resolveWebcrackUrl}). */
  webcrackUrl: string;
  options: WebcrackWorkerOptions;
}

/** Serialized bundle — plain objects only, no `Map`/class instances/functions. */
export interface WebcrackWorkerBundle {
  type: 'webpack' | 'browserify';
  entryId: string;
  modules: Array<{ id: string; path: string; isEntry: boolean; code: string }>;
}

export interface WebcrackWorkerResult {
  code: string;
  bundle?: WebcrackWorkerBundle;
}

/**
 * Minimal pool surface `runWebcrack` depends on. Decoupled from the concrete
 * `WorkerPool` so tests can inject a plain `{ submit }` mock.
 */
export interface WebcrackPool {
  submit(payload: WebcrackWorkerPayload, timeoutMs?: number): Promise<WebcrackWorkerResult>;
}

/**
 * Pool sizing / timeouts for webcrack. `min 1` keeps a worker thread alive
 * between calls — it avoids a per-call worker-thread spawn, though the first
 * job still pays the one-time webcrack + isolated-vm import inside the worker.
 * `max 2` caps CPU oversubscription (webcrack is CPU-bound). The job timeout is
 * longer than WorkerPool's 15s default because a large obfuscated bundle can
 * take tens of seconds; the idle timeout mirrors the heap-parse worker.
 */
const WEBCRACK_POOL_MIN_WORKERS = 1;
const WEBCRACK_POOL_MAX_WORKERS = 2;
const WEBCRACK_POOL_IDLE_TIMEOUT_MS = 30_000;
export const WEBCRACK_JOB_TIMEOUT_MS = 60_000;
/**
 * Old-gen heap cap (MB) for webcrack workers. Webcrack runs Babel over up to
 * `MAX_ANALYSIS_CODE_BYTES` (5MB) of source plus the isolated-vm sandbox, so
 * the worker needs a generous old-gen ceiling — contrast the transform
 * crypto-harness's 64MB cap, which only runs small test snippets.
 */
const WEBCRACK_POOL_MAX_OLD_GEN_MB = 512;
/** Young-gen heap cap (MB) for webcrack workers. */
const WEBCRACK_POOL_MAX_YOUNG_GEN_MB = 64;

/**
 * Self-contained worker script. Runs inside `new Worker(source, { eval: true })`
 * (see `WorkerPool.spawnWorker`), so it carries no imports — it bootstraps
 * `parentPort` via dynamic import and loads webcrack from the `file://` URL the
 * main thread resolved (an eval worker has no `__dirname`, and a packaged/global
 * install has a cwd that is not the package root, so a bare `import('webcrack')`
 * would not resolve).
 *
 * Message protocol (matches `WorkerPool`):
 *   → { jobId, payload: { code, webcrackUrl, options } }
 *   ← { jobId, ok: true,  result: { code, bundle } }
 *   ← { jobId, ok: false, error: string }
 */
export const WEBCRACK_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('worker parentPort is unavailable');

  parentPort.on('message', async (msg) => {
    const jobId = msg && msg.jobId;
    const payload = msg && msg.payload;
    try {
      const code = payload && typeof payload.code === 'string' ? payload.code : '';
      const webcrackUrl =
        payload && typeof payload.webcrackUrl === 'string' ? payload.webcrackUrl : '';
      const options = (payload && payload.options) || {};
      if (!webcrackUrl) throw new Error('webcrackUrl is required');
      if (!webcrackUrl.startsWith('file://'))
        throw new Error('webcrackUrl must be a file:// URL');

      const mod = await import(webcrackUrl);
      const webcrack = mod.webcrack ?? (mod.default && mod.default.webcrack) ?? mod.default;
      if (typeof webcrack !== 'function') throw new Error('webcrack export is not callable');

      const result = await webcrack(code, {
        jsx: options.jsx,
        unpack: options.unpack,
        deobfuscate: true,
        unminify: options.unminify,
        mangle: options.mangle,
      });

      const bundle =
        result && result.bundle
          ? {
              type: result.bundle.type,
              entryId: result.bundle.entryId,
              modules: Array.from(result.bundle.modules.values(), (module) => ({
                id: module.id,
                path: module.path,
                isEntry: module.isEntry,
                code: module.code,
              })),
            }
          : undefined;

      parentPort.postMessage({ jobId, ok: true, result: { code: result.code, bundle } });
    } catch (err) {
      parentPort.postMessage({
        jobId,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  });
};
__bootstrap().catch((error) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(
      'webcrack worker bootstrap failed:',
      error && error.message ? error.message : String(error),
    );
  }
});
`;

let sharedPool: WorkerPool<Record<string, unknown>, WebcrackWorkerResult> | null = null;

/**
 * Lazily create (and reuse) the shared webcrack worker pool. Workers are
 * unref'd by `WorkerPool` so the pool never blocks process exit (matching the
 * heap-parse / crypto-harness pool lifecycle).
 */
export function getWebcrackPool(): WebcrackPool {
  if (!sharedPool) {
    sharedPool = new WorkerPool<Record<string, unknown>, WebcrackWorkerResult>({
      name: 'webcrack',
      workerScript: WEBCRACK_WORKER_SCRIPT,
      minWorkers: WEBCRACK_POOL_MIN_WORKERS,
      maxWorkers: WEBCRACK_POOL_MAX_WORKERS,
      idleTimeoutMs: WEBCRACK_POOL_IDLE_TIMEOUT_MS,
      resourceLimits: {
        maxOldGenerationSizeMb: WEBCRACK_POOL_MAX_OLD_GEN_MB,
        maxYoungGenerationSizeMb: WEBCRACK_POOL_MAX_YOUNG_GEN_MB,
      },
    });
  }
  return sharedPool as WebcrackPool;
}

/**
 * Close the shared webcrack pool and reset the singleton so a subsequent
 * `getWebcrackPool()` starts fresh. Idempotent — a no-op when the pool was
 * never created. Wired into `closeServer()` so the min-1 warm worker (which
 * `WorkerPool` never idle-evicts at the `minWorkers` floor) is released on
 * shutdown instead of living for the server's lifetime.
 */
export async function disposeWebcrackPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.close();
    sharedPool = null;
  }
}

let cachedWebcrackUrl: string | undefined;

/**
 * Resolve the absolute `file://` URL of the webcrack entry point on the main
 * thread. `createRequire(import.meta.url).resolve('webcrack')` finds the
 * package even when the process cwd is not the repo root (global install /
 * packaged dist), and `pathToFileURL` turns the Windows absolute path into a
 * URL that ESM `import()` can load from a worker.
 */
export function resolveWebcrackUrl(): string {
  if (!cachedWebcrackUrl) {
    const require = createRequire(import.meta.url);
    cachedWebcrackUrl = pathToFileURL(require.resolve('webcrack')).href;
  }
  return cachedWebcrackUrl;
}
