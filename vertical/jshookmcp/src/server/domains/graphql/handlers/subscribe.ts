/**
 * GraphQL subscription handler.
 *
 * Opens a WebSocket to a GraphQL subscription endpoint, performs the
 * `graphql-transport-ws` (or legacy `graphql-ws`) handshake, sends a subscribe
 * frame, and collects frames for `collectMs` before sending `complete` and
 * closing the socket. Runs in-page by default so the browser session's cookies
 * and auth headers are preserved; Node-side WebSocket is not supported because
 * subscriptions are inherently a browser-session transport (the in-page branch
 * preserves the same-origin auth context that makes subscriptions work).
 *
 * Wire protocols:
 * - `graphql-transport-ws` (the modern standard): connection_init / connection_ack /
 *   connection_error / subscribe / next / error / complete / ping / pong.
 * - `graphql-ws` (legacy `subscriptions-transport-ws`): connection_init /
 *   connection_ack / connection_error / start / data / error / complete / stop /
 *   connection_terminate. `data`→`next` and `start`→`subscribe` are normalised.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import {
  toResponse,
  toError,
  normalizeHeaders,
  validateBrowserEndpoint,
  serializeForPreview,
} from '@server/domains/graphql/handlers/shared';
import { GRAPHQL_MAX_SCHEMA_CHARS } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString, argObject, argNumber, argEnum } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export const GRAPHQL_TRANSPORT_WS_PROTOCOL = 'graphql-transport-ws';
export const GRAPHQL_WS_PROTOCOL = 'graphql-ws';

/** Canonical frame types (legacy types normalised into this set). */
export type CanonicalFrameType =
  | 'connection_init'
  | 'connection_ack'
  | 'connection_error'
  | 'subscribe'
  | 'next'
  | 'error'
  | 'complete'
  | 'ping'
  | 'pong'
  | 'unknown';

/** Map a raw wire `type` to the canonical (graphql-transport-ws) name. */
export function normalizeFrameType(type: string | undefined): CanonicalFrameType {
  switch (type) {
    case 'connection_init':
    case 'connection_ack':
    case 'connection_error':
    case 'complete':
    case 'ping':
    case 'pong':
      return type;
    case 'subscribe':
    case 'start':
      return 'subscribe';
    case 'next':
    case 'data':
      return 'next';
    case 'error':
      return 'error';
    case 'stop':
    case 'connection_terminate':
      return 'complete';
    default:
      return 'unknown';
  }
}

export interface GraphqlOperation {
  query: string;
  variables?: Record<string, unknown> | null;
  operationName?: string | null;
}

/** Build the `connection_init` frame string. (Protocol-agnostic — both dialects use the same shape.) */
export function buildConnectionInit(payload?: Record<string, unknown> | null): string {
  const frame: Record<string, unknown> = { type: 'connection_init' };
  if (payload && typeof payload === 'object') {
    frame.payload = payload;
  }
  return JSON.stringify(frame);
}

/** Build the subscribe/start frame string. */
export function buildSubscribe(protocol: string, id: string, operation: GraphqlOperation): string {
  const type = protocol === GRAPHQL_WS_PROTOCOL ? 'start' : 'subscribe';
  const payload: Record<string, unknown> = { query: operation.query };
  if (operation.variables && typeof operation.variables === 'object') {
    payload.variables = operation.variables;
  }
  if (operation.operationName) {
    payload.operationName = operation.operationName;
  }
  return JSON.stringify({ id, type, payload });
}

/** Build the complete/stop frame string. */
export function buildComplete(protocol: string, id: string): string {
  const type = protocol === GRAPHQL_WS_PROTOCOL ? 'stop' : 'complete';
  return JSON.stringify({ id, type });
}

export interface ParsedWsFrame {
  type: string;
  id?: string;
  payload?: unknown;
}

/** Lenient JSON parse of a WebSocket text frame; returns null on non-JSON. */
export function parseWsFrame(rawData: string): ParsedWsFrame | null {
  if (typeof rawData !== 'string' || rawData.length === 0) return null;
  try {
    const parsed = JSON.parse(rawData);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      const type = typeof rec.type === 'string' ? rec.type : 'unknown';
      const id = typeof rec.id === 'string' ? rec.id : undefined;
      return { type, id, payload: 'payload' in rec ? rec.payload : undefined };
    }
  } catch {
    // Non-JSON frame (e.g. binary or plain text) — return null.
  }
  return null;
}

/** Normalise ws/wss/http/https endpoint; returns the ws URL + an http-equiv for SSRF. */
export function normalizeWsEndpoint(
  endpoint: string,
): { wsUrl: string; httpEquiv: string } | { error: string } {
  const trimmed = endpoint.trim();
  if (!trimmed) return { error: 'Missing required argument: endpoint' };

  let wsUrl: string;
  let httpEquiv: string;
  if (trimmed.startsWith('ws://')) {
    wsUrl = trimmed;
    httpEquiv = `http://${trimmed.slice(5)}`;
  } else if (trimmed.startsWith('wss://')) {
    wsUrl = trimmed;
    httpEquiv = `https://${trimmed.slice(6)}`;
  } else if (trimmed.startsWith('http://')) {
    wsUrl = `ws://${trimmed.slice(7)}`;
    httpEquiv = trimmed;
  } else if (trimmed.startsWith('https://')) {
    wsUrl = `wss://${trimmed.slice(8)}`;
    httpEquiv = trimmed;
  } else {
    return {
      error: `Unsupported endpoint protocol: "${trimmed}" — only ws/wss/http/https allowed`,
    };
  }

  return { wsUrl, httpEquiv };
}

interface CollectedFrame {
  type: string;
  canonicalType: CanonicalFrameType;
  id?: string;
  payload?: unknown;
  direction: 'sent' | 'received';
  timestamp: number;
}

export interface SubscribeInPageInput {
  endpoint: string;
  protocols: string[];
  initFrame: string;
  subscribeFrame: string;
  completeFrame: string;
  subscribeId: string;
  collectMs: number;
  connectTimeoutMs: number;
  /** Largest individual frame payload to retain verbatim (chars). */
  maxPayloadChars: number;
}

export interface SubscribeInPageResult {
  error: string | null;
  frames: Array<Omit<CollectedFrame, 'canonicalType'>>;
}

export class SubscribeHandlers {
  constructor(private collector: CodeCollector) {}

  async handleGraphqlSubscribe(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const normalized = normalizeWsEndpoint(endpoint);
      if ('error' in normalized) {
        return toError(normalized.error);
      }

      const queryRaw = argString(args, 'query');
      const query = typeof queryRaw === 'string' ? queryRaw.trim() : '';
      if (query.length === 0) {
        return toError('Missing required argument: query');
      }

      const variables = argObject(args, 'variables') ?? {};
      const operationNameRaw = argString(args, 'operationName');
      const operationName =
        operationNameRaw && operationNameRaw.trim().length > 0 ? operationNameRaw.trim() : null;

      const connectionPayload = argObject(args, 'connectionPayload') ?? null;
      const protocol = argEnum(
        args,
        'protocol',
        new Set([GRAPHQL_TRANSPORT_WS_PROTOCOL, GRAPHQL_WS_PROTOCOL] as const),
        GRAPHQL_TRANSPORT_WS_PROTOCOL,
      );
      const collectMs = argNumber(args, 'collectMs', 3000);
      const connectTimeoutMs = argNumber(args, 'connectTimeoutMs', 5000);

      if (collectMs < 100 || !Number.isFinite(collectMs)) {
        return toError('Invalid argument: collectMs (must be >= 100)');
      }
      if (connectTimeoutMs < 500 || !Number.isFinite(connectTimeoutMs)) {
        return toError('Invalid argument: connectTimeoutMs (must be >= 500)');
      }
      // evaluateWithTimeout has a hard 30s ceiling; reserve a buffer for the
      // handshake + complete-frame send so the in-page collector is never cut
      // off mid-subscription by the outer evaluation timeout.
      if (connectTimeoutMs + collectMs + 3000 > 30000) {
        return toError(
          'Invalid arguments: connectTimeoutMs + collectMs must leave at least 3s of headroom under the 30s evaluation ceiling (keep their sum <= 27000)',
        );
      }

      // SSRF / same-origin gate using the http-equivalent URL.
      const page = await this.collector.getActivePage();
      const currentPageUrl = typeof page.url === 'function' ? page.url() : null;
      const endpointValidationError = await validateBrowserEndpoint(
        normalized.httpEquiv,
        currentPageUrl,
      );
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      // Headers are informational for ws (browsers do not let JS set arbitrary
      // headers on WebSocket); the auth context comes from cookies + connectionPayload.
      // We still normalise so callers know we accepted the arg.
      normalizeHeaders(args.headers);

      const subscribeId = '1';
      const initFrame = buildConnectionInit(connectionPayload);
      const subscribeFrame = buildSubscribe(protocol, subscribeId, {
        query,
        variables,
        operationName,
      });
      const completeFrame = buildComplete(protocol, subscribeId);

      const inPageInput: SubscribeInPageInput = {
        endpoint: normalized.wsUrl,
        protocols: [protocol],
        initFrame,
        subscribeFrame,
        completeFrame,
        subscribeId,
        collectMs,
        connectTimeoutMs,
        maxPayloadChars: GRAPHQL_MAX_SCHEMA_CHARS,
      };

      // Total wall-clock budget: connect timeout + collect window + transport slack.
      // (evaluateWithTimeout enforces its own 30s ceiling; the guard above keeps
      // us inside it.)

      const result = (await evaluateWithTimeout(
        page,
        async (input: SubscribeInPageInput): Promise<SubscribeInPageResult> => {
          const frames: Array<Omit<CollectedFrame, 'canonicalType'>> = [];
          let settled = false;

          const settle = (error: string | null): SubscribeInPageResult => {
            if (settled) return { error: null, frames };
            settled = true;
            return { error, frames };
          };

          let ws: WebSocket;
          try {
            ws = new WebSocket(input.endpoint, input.protocols);
          } catch (err) {
            return settle(
              `WebSocket constructor failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          return new Promise<SubscribeInPageResult>((resolve) => {
            const hardTimeout = setTimeout(
              () => resolve(settle('hard timeout exceeded')),
              input.connectTimeoutMs + input.collectMs + 2000,
            );

            const finishCollect = () => {
              clearTimeout(hardTimeout);
              try {
                ws.send(input.completeFrame);
                frames.push({
                  type: 'complete',
                  id: input.subscribeId,
                  direction: 'sent',
                  timestamp:
                    typeof performance !== 'undefined' && typeof performance.now === 'function'
                      ? performance.now()
                      : Date.now(),
                });
              } catch {
                // Socket may already be closing — best-effort.
              }
              try {
                ws.close();
              } catch {
                // Ignore.
              }
              resolve(settle(null));
            };

            let subscribed = false;
            let acked = false;

            ws.addEventListener('open', () => {
              frames.push({
                type: 'connection_init',
                direction: 'sent',
                timestamp:
                  typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now(),
              });
              try {
                ws.send(input.initFrame);
              } catch (err) {
                clearTimeout(hardTimeout);
                resolve(
                  settle(
                    `Failed to send connection_init: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
              }
            });

            ws.addEventListener('message', (event: MessageEvent) => {
              const raw = typeof event.data === 'string' ? event.data : '';
              let type = '__raw__';
              let id: string | undefined;
              let payload: unknown =
                raw.length > input.maxPayloadChars
                  ? `${raw.slice(0, input.maxPayloadChars)}…`
                  : raw;

              if (raw.length > 0) {
                try {
                  const parsed = JSON.parse(raw);
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const rec = parsed as Record<string, unknown>;
                    type = typeof rec.type === 'string' ? rec.type : '__unknown__';
                    id = typeof rec.id === 'string' ? rec.id : undefined;
                    if ('payload' in rec) {
                      payload = rec.payload;
                    }
                  }
                } catch {
                  // Keep raw payload above.
                }
              }

              frames.push({
                type,
                id,
                payload,
                direction: 'received',
                timestamp:
                  typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now(),
              });

              if (!acked && type === 'connection_ack') {
                acked = true;
                if (!subscribed) {
                  subscribed = true;
                  try {
                    ws.send(input.subscribeFrame);
                    frames.push({
                      type: 'subscribe',
                      id: input.subscribeId,
                      direction: 'sent',
                      timestamp:
                        typeof performance !== 'undefined' && typeof performance.now === 'function'
                          ? performance.now()
                          : Date.now(),
                    });
                  } catch (err) {
                    clearTimeout(hardTimeout);
                    resolve(
                      settle(
                        `Failed to send subscribe frame: ${err instanceof Error ? err.message : String(err)}`,
                      ),
                    );
                    return;
                  }
                  setTimeout(finishCollect, input.collectMs);
                }
              } else if (type === 'connection_error') {
                clearTimeout(hardTimeout);
                resolve(settle(`connection_error from server: ${JSON.stringify(payload)}`));
              } else if (type === 'complete') {
                // Server-initiated completion — stop collecting.
                finishCollect();
              }
            });

            ws.addEventListener('error', () => {
              // The close event usually follows with a code; do not settle here
              // to avoid racing the close handler. Only settle if connect phase fails.
              if (!acked) {
                clearTimeout(hardTimeout);
                resolve(
                  settle(
                    'WebSocket error before connection_ack (server rejected protocol/auth or unreachable)',
                  ),
                );
              }
            });

            ws.addEventListener('close', (event: CloseEvent) => {
              clearTimeout(hardTimeout);
              if (!event.wasClean && !settled) {
                resolve(
                  settle(
                    `WebSocket closed unexpectedly (code=${event.code}, reason="${event.reason || 'no reason'}")`,
                  ),
                );
              } else if (!settled) {
                resolve(settle(null));
              }
            });

            // Connect-phase timeout.
            setTimeout(() => {
              if (!acked && !settled) {
                clearTimeout(hardTimeout);
                try {
                  ws.close();
                } catch {
                  // Ignore.
                }
                resolve(
                  settle(`Timed out waiting for connection_ack after ${input.connectTimeoutMs}ms`),
                );
              }
            }, input.connectTimeoutMs);
          });
        },
        inPageInput,
      )) as SubscribeInPageResult;

      // Enrich with canonical type for caller convenience.
      const frames: CollectedFrame[] = result.frames.map((frame) => ({
        ...frame,
        canonicalType: normalizeFrameType(frame.type),
      }));

      const connectionAck = frames.some(
        (frame) => frame.canonicalType === 'connection_ack' && frame.direction === 'received',
      );

      const nextFrames = frames.filter((frame) => frame.canonicalType === 'next');
      const errorFrames = frames.filter((frame) => frame.canonicalType === 'error');

      // Build a single preview-friendly payload list for `data`.
      const dataPayload = nextFrames.map((frame) => frame.payload);

      const preview = serializeForPreview(dataPayload, GRAPHQL_MAX_SCHEMA_CHARS);

      const payload: Record<string, unknown> = {
        success: !result.error,
        endpoint: normalized.wsUrl,
        protocol,
        connectionAck,
        collectMs,
        stats: {
          totalFrames: frames.length,
          nextFrames: nextFrames.length,
          errorFrames: errorFrames.length,
        },
        frames,
      };

      if (nextFrames.length > 0) {
        payload.dataLength = preview.totalLength;
        payload.dataPreview = preview.preview;
        payload.dataTruncated = preview.truncated;
        if (!preview.truncated) {
          payload.data = dataPayload;
        }
      }

      if (errorFrames.length > 0) {
        payload.graphqlErrors = errorFrames.map((frame) => frame.payload);
      }

      if (result.error) {
        payload.error = result.error;
      }

      return toResponse(payload);
    } catch (error) {
      return toError(error);
    }
  }
}
