/**
 * Sandbox execution, JSVMP deobfuscation, symbolic execution.
 * Prefixes: SANDBOX_*, JSVMP_*, SYMBOLIC_*, PACKER_*
 */

import { bool, int } from './helpers.js';

/* ================================================================== */
/*  Sandbox execution                                                  */
/* ================================================================== */

export const SANDBOX_EXEC_TIMEOUT_MS = int('SANDBOX_EXEC_TIMEOUT_MS', 5_000);
export const SANDBOX_MEMORY_LIMIT_MB = int('SANDBOX_MEMORY_LIMIT_MB', 128);
export const SANDBOX_STACK_SIZE_MB = int('SANDBOX_STACK_SIZE_MB', 4);
export const SANDBOX_TERMINATE_GRACE_MS = int('SANDBOX_TERMINATE_GRACE_MS', 2_000);
export const SANDBOX_MIN_MEMORY_LIMIT_BYTES = int('SANDBOX_MIN_MEMORY_LIMIT_BYTES', 256 * 1024);
export const SANDBOX_MAX_MEMORY_LIMIT_MB = int('SANDBOX_MAX_MEMORY_LIMIT_MB', 512);

/** Hard ceiling applied to user-supplied sandbox exec timeouts. */
export const SANDBOX_MAX_TIMEOUT_MS = int('SANDBOX_MAX_TIMEOUT_MS', 30_000);

/** Default cap on bridge tool calls per orchestrated sandbox run. */
export const SANDBOX_MAX_BRIDGE_CALLS = int('SANDBOX_MAX_BRIDGE_CALLS', 10);

/* ================================================================== */
/*  Symbolic execution                                                 */
/* ================================================================== */

export const SYMBOLIC_EXEC_MAX_PATHS = int('SYMBOLIC_EXEC_MAX_PATHS', 100);
export const SYMBOLIC_EXEC_MAX_DEPTH = int('SYMBOLIC_EXEC_MAX_DEPTH', 50);
export const SYMBOLIC_EXEC_TIMEOUT_MS = int('SYMBOLIC_EXEC_TIMEOUT_MS', 30_000);
/** Per-path Z3 solver timeout (distinct from the overall exec timeout). */
export const SYMBOLIC_EXEC_Z3_TIMEOUT_MS = int('SYMBOLIC_EXEC_Z3_TIMEOUT_MS', 5_000);

/* ================================================================== */
/*  JSVMP deobfuscation                                                */
/* ================================================================== */

export const JSVMP_DEOBFUSCATE_TIMEOUT_MS = int('JSVMP_DEOBFUSCATE_TIMEOUT_MS', 30_000);
export const JSVMP_MAX_ITERATIONS = int('JSVMP_MAX_ITERATIONS', 100);
export const JSVMP_SYMBOLIC_MAX_STEPS = int('JSVMP_SYMBOLIC_MAX_STEPS', 1_000);
export const JSVMP_SYMBOLIC_TIMEOUT_MS = int('JSVMP_SYMBOLIC_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  Z3 SMT solver                                                      */
/* ================================================================== */

/**
 * Master switch for the Z3 SMT solver integration.
 * When disabled (or when the WASM module fails to initialize), callers
 * fall back to their legacy solvers (greedy ROP heuristics / regex SMT).
 *
 * @env Z3_ENABLED
 * @default true
 */
export const Z3_ENABLED = bool('Z3_ENABLED', true);

/**
 * Timeout for the one-time Z3 WASM `init()` call.
 *
 * @env Z3_INIT_TIMEOUT_MS
 * @default 5000
 */
export const Z3_INIT_TIMEOUT_MS = int('Z3_INIT_TIMEOUT_MS', 5_000);

/**
 * Default per-solve timeout passed to `solver.set('timeout', N)`.
 * Individual callers may override.
 *
 * @env Z3_SOLVE_TIMEOUT_MS
 * @default 10000
 */
export const Z3_SOLVE_TIMEOUT_MS = int('Z3_SOLVE_TIMEOUT_MS', 10_000);

/**
 * Upper bound on the bounded-model-checking chain length used by the
 * ROP chain builder. The builder tries K=1..N until Z3 returns sat.
 *
 * @env Z3_BMC_MAX_GADGETS
 * @default 12
 */
export const Z3_BMC_MAX_GADGETS = int('Z3_BMC_MAX_GADGETS', 12);

/* ================================================================== */
/*  ROP gadget search                                                  */
/* ================================================================== */

/**
 * Gadget-search limits used by the ROP chain builder (`exploit_build_rop_chain`):
 * maxDepth is the number of instructions a candidate gadget may span,
 * maxGadgets caps the returned candidate set per architecture.
 *
 * @env ROP_GADGET_SEARCH_MAX_DEPTH
 * @default 6
 */
export const ROP_GADGET_SEARCH_MAX_DEPTH = int('ROP_GADGET_SEARCH_MAX_DEPTH', 6);

/**
 * @env ROP_GADGET_SEARCH_MAX_GADGETS
 * @default 5000
 */
export const ROP_GADGET_SEARCH_MAX_GADGETS = int('ROP_GADGET_SEARCH_MAX_GADGETS', 5_000);

/* ================================================================== */
/*  Packer sandbox                                                     */
/* ================================================================== */

export const PACKER_SANDBOX_TIMEOUT_MS = int('PACKER_SANDBOX_TIMEOUT_MS', 3_000);
