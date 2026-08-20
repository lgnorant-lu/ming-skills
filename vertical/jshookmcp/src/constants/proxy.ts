/**
 * Proxy domain: HTTP proxy, CA certificates, ADB device setup, request interception.
 * Prefixes: PROXY_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  Proxy                                                              */
/* ================================================================== */

/** Max captured request/response records kept in memory by the proxy domain. */
export const PROXY_CAPTURE_BUFFER_MAX = int('PROXY_CAPTURE_BUFFER_MAX', 5_000);

/** Max captured request/response records returned by proxy_get_requests. */
export const PROXY_CAPTURE_RETURN_LIMIT = int('PROXY_CAPTURE_RETURN_LIMIT', 100);

/** Max decoded request/response body preview bytes stored per captured proxy record. */
export const PROXY_CAPTURE_BODY_PREVIEW_BYTES = int('PROXY_CAPTURE_BODY_PREVIEW_BYTES', 16 * 1024);

/** Timeout for adb commands issued by proxy_setup_adb_device. */
export const PROXY_ADB_TIMEOUT_MS = int('PROXY_ADB_TIMEOUT_MS', 60_000);

/** Max stdout/stderr captured from adb commands issued by proxy_setup_adb_device. */
export const PROXY_ADB_MAX_BUFFER_BYTES = int('PROXY_ADB_MAX_BUFFER_BYTES', 8 * 1024 * 1024);
