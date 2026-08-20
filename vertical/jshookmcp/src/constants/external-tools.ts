/**
 * External tools: Frida, Ghidra, Unidbg, IDA, JADX, native bridge, Mojo, V8, syscall hooks.
 * Prefixes: EXTERNAL_*, FRIDA_*, GHIDRA_*, UNIDBG_*, NATIVE_*, MOJO_*, V8_*, SYSCALL_*, NEMU_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  External tool execution                                            */
/* ================================================================== */

export const EXTERNAL_TOOL_TIMEOUT_MS = int('EXTERNAL_TOOL_TIMEOUT_MS', 30_000);
export const EXTERNAL_TOOL_PROBE_TIMEOUT_MS = int('EXTERNAL_TOOL_PROBE_TIMEOUT_MS', 5_000);
export const EXTERNAL_TOOL_PROBE_CACHE_TTL_MS = int('EXTERNAL_TOOL_PROBE_CACHE_TTL_MS', 60_000);
export const EXTERNAL_TOOL_FORCE_KILL_GRACE_MS = int('EXTERNAL_TOOL_FORCE_KILL_GRACE_MS', 2_000);
export const EXTERNAL_TOOL_MAX_STDOUT_BYTES = int(
  'EXTERNAL_TOOL_MAX_STDOUT_BYTES',
  10 * 1024 * 1024,
);
export const EXTERNAL_TOOL_MAX_STDERR_BYTES = int(
  'EXTERNAL_TOOL_MAX_STDERR_BYTES',
  1 * 1024 * 1024,
);

/* ================================================================== */
/*  Binary instrumentation timeouts                                    */
/* ================================================================== */

/** Timeout for a single Frida CLI invocation (spawn/attach/detach helpers). */
export const FRIDA_TIMEOUT_MS = int('FRIDA_TIMEOUT_MS', 15_000);

/** Timeout for a Ghidra headless analyzer run (analyzeHeadless subprocess). */
export const GHIDRA_TIMEOUT_MS = int('GHIDRA_TIMEOUT_MS', 120_000);

/**
 * Timeout for a Unidbg subprocess invocation (spawn / call / trace).
 * The handler layer used to duplicate this with a tighter 30s ceiling which
 * caused premature failure when a module worked 31-59s. Unified here.
 */
export const UNIDBG_TIMEOUT_MS = int('UNIDBG_TIMEOUT_MS', 60_000);

/* ================================================================== */
/*  Native bridge (IDA/Ghidra REST)                                    */
/* ================================================================== */

/** Timeout for REST calls to the native bridge (IDA/Ghidra). */
export const NATIVE_BRIDGE_TIMEOUT_MS = int('NATIVE_BRIDGE_TIMEOUT_MS', 15_000);

/* ================================================================== */
/*  Mojo IPC                                                           */
/* ================================================================== */

/** Timeout for a Mojo-monitor helper subprocess. */
export const MOJO_MONITOR_TIMEOUT_MS = int('MOJO_MONITOR_TIMEOUT_MS', 10_000);

/* ================================================================== */
/*  V8 inspector                                                       */
/* ================================================================== */

/** Timeout for the V8 bytecode extraction subprocess helper. */
export const V8_BYTECODE_SUBPROC_TIMEOUT_MS = int('V8_BYTECODE_SUBPROC_TIMEOUT_MS', 60_000);

/* ================================================================== */
/*  Syscall hook (eBPF / bpftrace)                                     */
/* ================================================================== */

export const SYSCALL_TRACE_DURATION_DEFAULT_SEC = int('SYSCALL_TRACE_DURATION_DEFAULT_SEC', 10);
export const SYSCALL_TRACE_DURATION_MIN_SEC = int('SYSCALL_TRACE_DURATION_MIN_SEC', 1);
export const SYSCALL_TRACE_DURATION_MAX_SEC = int('SYSCALL_TRACE_DURATION_MAX_SEC', 300);

/* ================================================================== */
/*  Native emulator (in-process ARM64) session pool                   */
/* ================================================================== */

/** Idle TTL before an untouched native-emulator session is swept (ms). Default: 5 min. */
export const NEMU_SESSION_IDLE_TTL_MS = int('NEMU_SESSION_IDLE_TTL_MS', 300_000);
/** How often the native-emulator idle sweep runs (ms). Default: 1 min. */
export const NEMU_SESSION_SWEEP_MS = int('NEMU_SESSION_SWEEP_MS', 60_000);
/** Max concurrent native-emulator sessions (bounds memory). Default: 64. */
export const NEMU_MAX_SESSIONS = int('NEMU_MAX_SESSIONS', 64);

/* ================================================================== */
/*  Binary string extraction                                           */
/* ================================================================== */

export const BINARY_STRINGS_MIN_LENGTH_DEFAULT = int('BINARY_STRINGS_MIN_LENGTH_DEFAULT', 4);
export const BINARY_STRINGS_MIN_LENGTH_FLOOR = int('BINARY_STRINGS_MIN_LENGTH_FLOOR', 2);
export const BINARY_STRINGS_MIN_LENGTH_CEILING = int('BINARY_STRINGS_MIN_LENGTH_CEILING', 256);
export const BINARY_STRINGS_MAX_RESULTS_DEFAULT = int('BINARY_STRINGS_MAX_RESULTS_DEFAULT', 1_000);
export const BINARY_STRINGS_MAX_RESULTS_LIMIT = int('BINARY_STRINGS_MAX_RESULTS_LIMIT', 50_000);
export const BINARY_STRINGS_PRINTABLE_ASCII_MIN = int('BINARY_STRINGS_PRINTABLE_ASCII_MIN', 0x20);
export const BINARY_STRINGS_PRINTABLE_ASCII_MAX = int('BINARY_STRINGS_PRINTABLE_ASCII_MAX', 0x7e);
