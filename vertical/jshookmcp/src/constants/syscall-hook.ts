/**
 * Syscall hook / monitoring configuration.
 * Prefixes: SYSCALL_TRACE_*
 */

import { int } from './helpers.js';

/** Timeout (ms) for strace/dtrace/ETW subprocess spawn readiness. */
export const SYSCALL_TRACE_SPAWN_TIMEOUT_MS = int('JSHOOK_SYSCALL_TRACE_SPAWN_TIMEOUT_MS', 3_000);

/**
 * Timeout (ms) for the Windows `logman query providers` probe used to detect
 * Administrator / Performance Monitor Users before starting an ETW session.
 */
export const LOGON_PROBE_TIMEOUT_MS = int('LOGON_PROBE_TIMEOUT_MS', 5_000);
