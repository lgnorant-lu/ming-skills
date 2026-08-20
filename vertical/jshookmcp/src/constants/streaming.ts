/**
 * Streaming protocols: WebSocket, SSE, fetch()-based streams.
 * Prefixes: WS_*, SSE_*, STREAMING_*
 */

import { int } from './helpers.js';

/* ================================================================== */
/*  WebSocket                                                          */
/* ================================================================== */

export const WS_PAYLOAD_PREVIEW_LIMIT = int('WS_PAYLOAD_PREVIEW_LIMIT', 200);
export const WS_PAYLOAD_SAMPLE_LIMIT = int('WS_PAYLOAD_SAMPLE_LIMIT', 2_000);

/* ================================================================== */
/*  Generic stream monitors                                            */
/* ================================================================== */

/** Default event/message cap for the fetch-stream and WebRTC monitors. */
export const STREAMING_MAX_EVENTS = int('STREAMING_MAX_EVENTS', 2_000);

/** Hard upper bound for monitor maxEvents / maxCalls args across streaming tools. */
export const STREAMING_MAX_EVENTS_CAP = int('STREAMING_MAX_EVENTS_CAP', 50_000);

/** Default `limit` for *_get_events / *_get_frames / grpc_get_calls pagination. */
export const STREAMING_QUERY_LIMIT_DEFAULT = int('STREAMING_QUERY_LIMIT_DEFAULT', 100);

/** Upper bound for the pagination `limit` arg. */
export const STREAMING_QUERY_LIMIT_MAX = int('STREAMING_QUERY_LIMIT_MAX', 5_000);

/**
 * Cap on the fetch-stream reassembly buffer. A stream that never emits an SSE
 * dispatch separator would otherwise grow its buffer without bound; on
 * overflow the TAIL is kept so a separator arriving later still yields the
 * newest events. Passed into the in-page injection script via config.
 */
export const SSE_BUFFER_MAX_BYTES = int('SSE_BUFFER_MAX_BYTES', 1 * 1024 * 1024);
