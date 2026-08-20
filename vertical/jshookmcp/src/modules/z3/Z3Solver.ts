/**
 * Z3 SMT solver singleton.
 *
 * Wraps `z3-solver`'s WASM-backed high-level API behind:
 * - **Lazy init**: the WASM module loads on first use, never blocking server startup.
 * - **Cached failure**: if `init()` throws once, subsequent calls return `null`
 *   immediately so callers can fall back to legacy solvers without retry storms.
 * - **Mutex serialization**: although z3-solver's high-level API already queues
 *   long-running calls internally, we add an explicit promise-chain mutex so
 *   concurrent MCP tool calls are serialized at our boundary too — belt and
 *   suspenders, and it gives us a clean place to apply an outer hard timeout.
 * - **Fail-soft**: every entry point returns `null` (or a sentinel) when Z3 is
 *   unavailable, so callers degrade gracefully.
 *
 * @module @modules/z3/Z3Solver
 */

import { logger } from '@utils/logger';
import { Z3_ENABLED, Z3_INIT_TIMEOUT_MS } from '@src/constants';

/**
 * The resolved Z3 high-level + low-level API surface returned by `init()`.
 * Typed loosely (`Awaited<ReturnType<typeof initZ3>>`) to avoid leaking the
 * generated d.ts generics into every caller — callers get the typed API by
 * destructuring inside `withContext`.
 */
type Z3Module = typeof import('z3-solver');
export type Z3Api = Awaited<ReturnType<Z3Module['init']>>;

let apiPromise: Promise<Z3Api | null> | null = null;
let initFailed = false;
let mutex: Promise<unknown> = Promise.resolve();

/**
 * Whether Z3 is enabled by config. `false` → all calls short-circuit.
 */
export function isZ3Enabled(): boolean {
  return Z3_ENABLED;
}

/**
 * True once `init()` has succeeded at least once.
 */
export function isZ3Ready(): boolean {
  return apiPromise !== null && !initFailed;
}

/**
 * True if `init()` has been attempted and permanently failed.
 * Callers can use this to skip Z3 entirely (e.g. avoid building constraints).
 */
export function isZ3Failed(): boolean {
  return initFailed;
}

/**
 * Lazily initialize the Z3 WASM module. Resolves to the Z3 API surface, or
 * `null` if disabled or if init failed (failure is cached).
 *
 * Safe to call concurrently — the init promise is shared.
 */
export function getZ3Api(): Promise<Z3Api | null> {
  if (!Z3_ENABLED) return Promise.resolve(null);
  if (initFailed) return Promise.resolve(null);
  if (!apiPromise) {
    apiPromise = withInitTimeout(import('z3-solver').then(({ init }) => init()))
      .then((api) => {
        logger.info('[z3] WASM initialized');
        return api as Z3Api;
      })
      .catch((err) => {
        initFailed = true;
        logger.warn(`[z3] init failed, falling back to legacy solvers: ${stringifyErr(err)}`);
        return null;
      });
  }
  return apiPromise;
}

/**
 * Run a solver-using callback with the Z3 API, serialized by an internal
 * mutex and bounded by `timeoutMs`. Resolves to the callback's result, or
 * `null` if Z3 is unavailable, init failed, or the call timed out.
 *
 * The callback receives the typed Z3 API (destructure `{ Context, Solver,
 * Int, BitVec, Bool, And, Or, ... }` from it). Create a fresh `Context` per
 * call — context creation is cheap.
 *
 * @example
 * const r = await withZ3(async (api) => {
 *   const { Solver, Int, And } = new api.Context('main');
 *   const x = Int.const('x');
 *   const solver = new Solver();
 *   solver.add(And(x.ge(0), x.le(9)));
 *   if (await solver.check() !== 'sat') return null;
 *   return solver.model().get(x)?.toString() ?? null;
 * });
 */
export async function withZ3<T>(
  fn: (api: Z3Api) => Promise<T>,
  timeoutMs?: number,
): Promise<T | null> {
  const api = await getZ3Api();
  if (!api) return null;

  // Serialize: claim a place in the mutex chain, wait for the previous holder
  // to release, then run. `mutex` always points at the *current tail* (the
  // gate the next caller will wait on).
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = mutex;
  mutex = gate; // subsequent callers chain onto this gate
  await prev;

  try {
    return await withTimeout(fn(api), timeoutMs);
  } catch (err) {
    logger.warn(`[z3] withZ3 callback failed: ${stringifyErr(err)}`);
    return null;
  } finally {
    release();
  }
}

/**
 * Reset cached state. Intended for tests only — production code should never
 * call this once Z3 has initialized.
 */
export function resetZ3ForTests(): void {
  apiPromise = null;
  initFailed = false;
  mutex = Promise.resolve();
}

// --- internals ---

function withInitTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Z3 init timed out after ${Z3_INIT_TIMEOUT_MS}ms`));
    }, Z3_INIT_TIMEOUT_MS);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function withTimeout<T>(p: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Z3 call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function stringifyErr(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
