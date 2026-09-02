/**
 * Off-thread JScrambler deobfuscation for the `deobfuscate` tool's
 * `engine: 'jscrambler'` path.
 *
 * `JScramblerDeobfuscator.deobfuscate` runs a Babel parse plus five
 * traverse/generate passes (self-defending removal, string decryption,
 * control-flow restoration, dead-code removal, expression simplification) —
 * ~189ms of event-loop blocking on real samples. This module moves that work
 * into a `WorkerPool`-backed worker thread (the same `eval: true`
 * self-contained script pattern as the v8-inspector heap-parse worker and
 * `webcrack-worker`).
 *
 * ── Single source of truth ──
 * The pass logic lives in `jscrambler-core.ts`. The worker no longer inlines a
 * plain-JS port of `JScramblerDeobfuscator`; instead it loads that shared
 * module from the `file://` URL the main thread resolved (`coreUrl`) — the
 * same mechanism `webcrack-worker` uses for the `webcrack` package. Because
 * `jscrambler-core.ts` has zero runtime imports (Babel is injected through
 * `babelUrls`, logging through a collector callback) and only erasable TS
 * syntax, Node >= 22.18 strips its types natively and executes the raw `.ts`
 * source. Any change to the passes is now made in one place. ──
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { WorkerPool } from '@utils/WorkerPool';
import type { BabelWorkerUrls } from './babel-urls';
import type { JscramblerLogEntry } from './jscrambler-core';

export interface JscramblerWorkerOptions {
  removeDeadCode: boolean;
  restoreControlFlow: boolean;
  decryptStrings: boolean;
  simplifyExpressions: boolean;
}

export interface JscramblerWorkerPayload extends Record<string, unknown> {
  code: string;
  babelUrls: BabelWorkerUrls;
  /** `file://` URL of the shared core module (see {@link resolveJscramblerCoreUrl}). */
  coreUrl: string;
  options: JscramblerWorkerOptions;
}

export interface JscramblerWorkerResult {
  code: string;
  success: boolean;
  transformations: string[];
  warnings: string[];
  confidence: number;
  /**
   * Log entries the core emitted inside the worker. The main thread replays
   * them through `@utils/logger` so the off-thread path keeps the same logging
   * instrumentation as the main-thread path.
   */
  logs?: JscramblerLogEntry[];
}

/** Minimal pool surface the handler depends on; injectable for tests. */
export interface JscramblerPool {
  submit(payload: JscramblerWorkerPayload, timeoutMs?: number): Promise<JscramblerWorkerResult>;
}

const JSCRAMBLER_POOL_MIN_WORKERS = 1;
const JSCRAMBLER_POOL_MAX_WORKERS = 2;
const JSCRAMBLER_POOL_IDLE_TIMEOUT_MS = 30_000;
export const JSCRAMBLER_JOB_TIMEOUT_MS = 60_000;
/** Babel parse + five traverse passes over up-to-5MB code. */
const JSCRAMBLER_POOL_MAX_OLD_GEN_MB = 512;
const JSCRAMBLER_POOL_MAX_YOUNG_GEN_MB = 64;

/**
 * Self-contained worker script. Bootstraps `parentPort` via dynamic import,
 * loads `@babel/*` from the `file://` URLs the main thread resolved (see
 * `babel-urls.ts`), then loads the shared `jscrambler-core.ts` from `coreUrl`
 * and runs `createJscramblerCore(babel).deobfuscate(...)`. Logs are collected
 * into a plain array and returned with the result (an eval worker has no
 * `@utils/logger`).
 *
 * Message protocol (matches `WorkerPool`):
 *   → { jobId, payload: { code, babelUrls, coreUrl, options } }
 *   ← { jobId, ok: true,  result: JscramblerWorkerResult }
 *   ← { jobId, ok: false, error: string }
 */
export const JSCRAMBLER_WORKER_SCRIPT = `
const __bootstrap = async () => {
  const { parentPort } = await import('node:worker_threads');
  if (!parentPort) throw new Error('worker parentPort is unavailable');

  let parser;
  let traverse;
  let generate;
  let t;
  let core;
  let loadedBabelUrls = '';
  let loadedCoreUrl = '';

  async function loadBabel(babelUrls) {
    if (!babelUrls || loadedBabelUrls === babelUrls.parser) return;
    const parserNs = await import(babelUrls.parser);
    parser = parserNs.default ?? parserNs;
    const traverseNs = await import(babelUrls.traverse);
    traverse = traverseNs.default ?? traverseNs;
    const genNs = await import(babelUrls.generator);
    generate = genNs.default ?? genNs;
    t = await import(babelUrls.types);
    loadedBabelUrls = babelUrls.parser;
  }

  async function loadCore(coreUrl) {
    if (!coreUrl || loadedCoreUrl === coreUrl) return;
    let coreMod;
    try {
      coreMod = await import(coreUrl);
    } catch (err) {
      throw new Error(
        'jscrambler worker failed to load the shared core module ' +
        '(requires Node >= 22.18 for native TS type stripping): ' +
        (err && err.message ? err.message : String(err)),
      );
    }
    const createCore = coreMod.createJscramblerCore;
    if (typeof createCore !== 'function') {
      throw new Error('jscrambler-core export createJscramblerCore is not callable');
    }
    core = createCore({ parser, traverse, generate, types: t });
    loadedCoreUrl = coreUrl;
  }

  function makeLogCollector() {
    const logs = [];
    const log = (level, message, error) => {
      logs.push({
        level,
        message,
        error: error instanceof Error
          ? error.message
          : error === undefined
            ? undefined
            : String(error),
      });
    };
    return { logs, log };
  }

  parentPort.on('message', async (msg) => {
    const jobId = msg && msg.jobId;
    const payload = msg && msg.payload;
    try {
      await loadBabel(payload && payload.babelUrls);
      await loadCore(payload && payload.coreUrl);
      const code = payload && typeof payload.code === 'string' ? payload.code : '';
      const options = (payload && payload.options) || {};
      const collector = makeLogCollector();
      const result = core.deobfuscate(
        code,
        {
          removeDeadCode: options.removeDeadCode !== false,
          restoreControlFlow: options.restoreControlFlow !== false,
          decryptStrings: options.decryptStrings !== false,
          simplifyExpressions: options.simplifyExpressions !== false,
        },
        collector.log,
      );
      parentPort.postMessage({ jobId, ok: true, result: Object.assign({}, result, { logs: collector.logs }) });
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
      'jscrambler worker bootstrap failed:',
      error && error.message ? error.message : String(error),
    );
  }
});
`;

let sharedPool: WorkerPool<Record<string, unknown>, JscramblerWorkerResult> | null = null;

/** Lazily create (and reuse) the shared JScrambler worker pool. */
export function getJscramblerPool(): JscramblerPool {
  if (!sharedPool) {
    sharedPool = new WorkerPool<Record<string, unknown>, JscramblerWorkerResult>({
      name: 'jscrambler',
      workerScript: JSCRAMBLER_WORKER_SCRIPT,
      minWorkers: JSCRAMBLER_POOL_MIN_WORKERS,
      maxWorkers: JSCRAMBLER_POOL_MAX_WORKERS,
      idleTimeoutMs: JSCRAMBLER_POOL_IDLE_TIMEOUT_MS,
      resourceLimits: {
        maxOldGenerationSizeMb: JSCRAMBLER_POOL_MAX_OLD_GEN_MB,
        maxYoungGenerationSizeMb: JSCRAMBLER_POOL_MAX_YOUNG_GEN_MB,
      },
    });
  }
  return sharedPool as JscramblerPool;
}

/**
 * Close the shared JScrambler pool and reset the singleton (idempotent — a
 * no-op when never created). Wired into `closeServer()` so the min-1 warm
 * worker is released on shutdown (see `disposeWebcrackPool`).
 */
export async function disposeJscramblerPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.close();
    sharedPool = null;
  }
}

let cachedCoreUrl: string | undefined;

/**
 * Resolve the absolute `file://` URL of the shared `jscrambler-core.ts` module
 * on the main thread. `createRequire(import.meta.url).resolve()` finds the
 * file even when the process cwd is not the repo root (global install /
 * packaged dist), and `pathToFileURL` turns the Windows absolute path into a
 * URL that ESM `import()` can load from the eval worker (mirrors
 * `resolveWebcrackUrl`). Node >= 22.18 executes the `.ts` source via native
 * type stripping; older Node reports a clear error from the worker.
 */
export function resolveJscramblerCoreUrl(): string {
  if (!cachedCoreUrl) {
    const require = createRequire(import.meta.url);
    cachedCoreUrl = pathToFileURL(require.resolve('./jscrambler-core.ts')).href;
  }
  return cachedCoreUrl;
}
