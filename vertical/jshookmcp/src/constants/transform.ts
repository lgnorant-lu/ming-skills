/**
 * Code transformation: worker pools, crypto, VM execution.
 * Prefixes: TRANSFORM_*, EMULATOR_*, ADV_DEOBF_*, VM_DEOBF_*, DEOBF_*, CRYPTO_DETECT_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Transform worker pool                                              */
/* ================================================================== */

export const TRANSFORM_WORKER_TIMEOUT_MS = int('TRANSFORM_WORKER_TIMEOUT_MS', 15_000);
export const TRANSFORM_VM_SCRIPT_TIMEOUT_MS = int('TRANSFORM_VM_SCRIPT_TIMEOUT_MS', 5_000);
export const TRANSFORM_CRYPTO_POOL_MAX_WORKERS = int('TRANSFORM_CRYPTO_POOL_MAX_WORKERS', 4);
export const TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS = int(
  'TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS',
  30_000,
);
export const TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB = int('TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB', 64);
export const TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB = int(
  'TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB',
  16,
);

/* ================================================================== */
/*  Emulator fetch                                                     */
/* ================================================================== */

export const EMULATOR_FETCH_GOTO_TIMEOUT_MS = int('EMULATOR_FETCH_GOTO_TIMEOUT_MS', 30_000);

/* ================================================================== */
/*  LLM-assisted deobfuscation                                         */
/* ================================================================== */

export const ADV_DEOBF_LLM_MAX_TOKENS = int('ADV_DEOBF_LLM_MAX_TOKENS', 3_000);
export const VM_DEOBF_LLM_MAX_TOKENS = int('VM_DEOBF_LLM_MAX_TOKENS', 4_000);
export const DEOBF_LLM_MAX_TOKENS = int('DEOBF_LLM_MAX_TOKENS', 2_000);
export const CRYPTO_DETECT_LLM_MAX_TOKENS = int('CRYPTO_DETECT_LLM_MAX_TOKENS', 2_000);
