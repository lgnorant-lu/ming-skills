/**
 * Code analysis: GraphQL, WASM, sourcemap, miniapp, debugger, process.
 * Prefixes: GRAPHQL_*, WASM_*, ANALYSIS_*, MINIAPP_*, DEBUGGER_*, WATCH_*, PROCESS_*, WIN_*, SOURCEMAP_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  GraphQL                                                            */
/* ================================================================== */

export const GRAPHQL_MAX_PREVIEW_CHARS = int('GRAPHQL_MAX_PREVIEW_CHARS', 4_000);
export const GRAPHQL_MAX_SCHEMA_CHARS = int('GRAPHQL_MAX_SCHEMA_CHARS', 120_000);
export const GRAPHQL_MAX_QUERY_CHARS = int('GRAPHQL_MAX_QUERY_CHARS', 12_000);
export const GRAPHQL_MAX_GRAPH_NODES = int('GRAPHQL_MAX_GRAPH_NODES', 2_000);
export const GRAPHQL_MAX_GRAPH_EDGES = int('GRAPHQL_MAX_GRAPH_EDGES', 5_000);

/** Abort timeout for a graphql_replay POST (Node-side fetch or in-page fetch). */
export const GRAPHQL_REPLAY_FETCH_TIMEOUT_MS = int('GRAPHQL_REPLAY_FETCH_TIMEOUT_MS', 10_000);

/* ================================================================== */
/*  WASM                                                               */
/* ================================================================== */

export const WASM_TOOL_TIMEOUT_MS = int('WASM_TOOL_TIMEOUT_MS', 60_000);
export const WASM_OFFLINE_RUN_TIMEOUT_MS = int('WASM_OFFLINE_RUN_TIMEOUT_MS', 10_000);
export const WASM_OPTIMIZE_TIMEOUT_MS = int('WASM_OPTIMIZE_TIMEOUT_MS', 120_000);

/** WASM obfuscation detection thresholds */
export const WASM_DEAD_CODE_MIN_MATCHES = int('WASM_DEAD_CODE_MIN_MATCHES', 10);
export const WASM_BITWISE_OPS_THRESHOLD = int('WASM_BITWISE_OPS_THRESHOLD', 20);
export const WASM_VM_DISPATCH_MIN_LOOPS = int('WASM_VM_DISPATCH_MIN_LOOPS', 3);

/* ================================================================== */
/*  Analysis                                                           */
/* ================================================================== */

export const ANALYSIS_MAX_SUMMARY_FILES = int('ANALYSIS_MAX_SUMMARY_FILES', 40);
export const ANALYSIS_MAX_SAFE_COLLECTED_BYTES = int(
  'ANALYSIS_MAX_SAFE_COLLECTED_BYTES',
  256 * 1024,
);
export const ANALYSIS_MAX_SAFE_RESPONSE_BYTES = int('ANALYSIS_MAX_SAFE_RESPONSE_BYTES', 220 * 1024);

/* ================================================================== */
/*  Miniapp unpacking                                                  */
/* ================================================================== */

export const MINIAPP_UNPACK_TIMEOUT_MS = int('MINIAPP_UNPACK_TIMEOUT_MS', 180_000);

/* ================================================================== */
/*  Debugger                                                           */
/* ================================================================== */

export const DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS = int(
  'DEBUGGER_WAIT_FOR_PAUSED_TIMEOUT_MS',
  30_000,
);
export const WATCH_EVAL_TIMEOUT_MS = int('WATCH_EVAL_TIMEOUT_MS', 5_000);

/* ================================================================== */
/*  Process operations                                                 */
/* ================================================================== */

/** Launch wait after spawning a debug process (Linux/Mac). */
export const PROCESS_LAUNCH_WAIT_MS = int('PROCESS_LAUNCH_WAIT_MS', 2_000);

/** Poll attempts when waiting for a debug port (Windows). */
export const WIN_DEBUG_PORT_POLL_ATTEMPTS = int('WIN_DEBUG_PORT_POLL_ATTEMPTS', 20);
export const WIN_DEBUG_PORT_POLL_INTERVAL_MS = int('WIN_DEBUG_PORT_POLL_INTERVAL_MS', 500);

/* ================================================================== */
/*  Sourcemap                                                          */
/* ================================================================== */

/** Timeout for the sourcemap-extension fetch helper. */
export const SOURCEMAP_EXT_TIMEOUT_MS = int('SOURCEMAP_EXT_TIMEOUT_MS', 15_000);

/** Sourcemap v4 parsing */
export const SOURCEMAP_V4_RAW_FIELD_MAX_LEN = int('SOURCEMAP_V4_RAW_FIELD_MAX_LEN', 200);
export const SOURCEMAP_V4_RETRY_DELAY_MS = int('SOURCEMAP_V4_RETRY_DELAY_MS', 250);
