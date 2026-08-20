/**
 * Mojo IPC configuration.
 * Prefixes: MOJO_*
 */

import { int } from './helpers.js';

/** Timeout for Frida subprocess attach probe (spawn frida + wait for first message). */
export const MOJO_FRIDA_PROBE_TIMEOUT_MS = int('JSHOOK_FRIDA_PROBE_TIMEOUT_MS', 10_000);
