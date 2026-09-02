/**
 * fetch()-based stream monitoring handlers.
 *
 * Modern streaming APIs (OpenAI/Vercel AI SDK, GraphQL subscriptions over HTTP)
 * consume `text/event-stream` via `fetch(url).then(r => r.body.getReader())`
 * instead of EventSource, because they need POST + custom headers. The SSE
 * EventSource patch misses these entirely. This monitor wraps window.fetch,
 * detects text/event-stream responses, clones the body, and parses the SSE
 * frame stream into events — closing the fetch-based SSE gap.
 */

import { writeFile } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import type { StreamingSharedState, TextToolResponse } from './shared';
import { parseBooleanArg, parseNumberArg, parseOptionalStringArg, compileRegex } from './shared';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '@modules/collector/PageController';
import {
  SSE_BUFFER_MAX_BYTES,
  STREAMING_MAX_EVENTS,
  STREAMING_MAX_EVENTS_CAP,
  STREAMING_QUERY_LIMIT_DEFAULT,
  STREAMING_QUERY_LIMIT_MAX,
  WS_PAYLOAD_PREVIEW_LIMIT,
} from '@src/constants/streaming';
import { asJson } from './shared';

type ExportFormat = 'json' | 'ndjson';

const parseExportFormat = (value: unknown): ExportFormat =>
  value === 'ndjson' ? 'ndjson' : 'json';

/**
 * localStorage marker key for the fetch-stream persistent-disable switch.
 * The marker survives navigations, so the evaluateOnNewDocument injection
 * script can come up disabled on fresh pages after a disable() call. The key
 * lives once here and is passed into every browser-serialized script as an
 * argument (module scope is unreachable inside String(fn)-serialized code).
 */
const FETCH_STREAM_DISABLED_MARKER = '__jshookFetchStreamMonitorDisabled';

/**
 * Runs in the browser. Wraps window.fetch; for text/event-stream responses it
 * clones the body and parses SSE frames. Events land in window.__jshookFetchStreamMonitor.
 * Self-contained (no closure over module scope) so it survives serialization.
 */
function fetchStreamInjectionFn(config: {
  maxEvents: number;
  urlFilterRaw?: string;
  /** Reassembly buffer cap (bytes); canonical value SSE_BUFFER_MAX_BYTES. */
  maxBufferBytes?: number;
  /** Data preview truncation limit; canonical value WS_PAYLOAD_PREVIEW_LIMIT. */
  previewLimit?: number;
  /** Persistent-disable localStorage key; canonical value FETCH_STREAM_DISABLED_MARKER. */
  disableMarkerKey?: string;
}): unknown {
  type FsEvent = {
    sourceUrl: string;
    eventType: string;
    dataPreview: string;
    data?: string;
    dataLength: number;
    lastEventId: string | null;
    timestamp: number;
  };
  type FsSource = {
    url: string;
    status: 'open' | 'closed' | 'error';
    eventCount: number;
    lastEventTimestamp?: number;
  };
  type FsState = {
    enabled: boolean;
    patched: boolean;
    maxEvents: number;
    urlFilterRaw?: string;
    events: FsEvent[];
    sources: Record<string, FsSource>;
    originalFetch?: typeof fetch;
  };

  const gw = window as Window &
    typeof globalThis & {
      __jshookFetchStreamMonitor?: FsState;
      fetch: typeof fetch;
    };

  // Persistent-disable marker: `fetch_stream_monitor(disable)` writes it to
  // localStorage, which survives navigations. This script re-runs on every
  // page load (evaluateOnNewDocument) and MUST come up disabled while the
  // marker is set — otherwise disable has no effect on new pages. The key is
  // passed via config (the handler supplies FETCH_STREAM_DISABLED_MARKER);
  // the fallback literal covers standalone invocation of this serialized
  // script, which cannot see module scope.
  const disableMarkerKey = config.disableMarkerKey ?? '__jshookFetchStreamMonitorDisabled';
  let persistentlyDisabled = false;
  try {
    persistentlyDisabled =
      typeof localStorage !== 'undefined' && localStorage.getItem(disableMarkerKey) === '1';
  } catch {
    // localStorage can throw in sandboxed iframes — treat as enabled.
  }

  // Truncation + buffer caps, supplied by the handler from the streaming
  // constants module (WS_PAYLOAD_PREVIEW_LIMIT / SSE_BUFFER_MAX_BYTES); the
  // fallbacks keep the serialized script self-contained.
  const previewLimit = config.previewLimit ?? 200;
  const bufferCapBytes = config.maxBufferBytes ?? 1024 * 1024;

  if (!gw.__jshookFetchStreamMonitor) {
    gw.__jshookFetchStreamMonitor = {
      enabled: !persistentlyDisabled,
      patched: false,
      maxEvents: config.maxEvents,
      urlFilterRaw: config.urlFilterRaw,
      events: [],
      sources: {},
    };
  }
  const state = gw.__jshookFetchStreamMonitor;
  // NOTE: the marker is only READ here — clearing it is the enable handler's
  // job (this script cannot distinguish a browser-driven re-injection after
  // disable from an explicit enable() call).
  state.enabled = !persistentlyDisabled;
  state.maxEvents = config.maxEvents;
  state.urlFilterRaw = config.urlFilterRaw;
  if (state.events.length > state.maxEvents) state.events = state.events.slice(-state.maxEvents);

  const shouldCapture = (sourceUrl: string): boolean => {
    if (!state.urlFilterRaw) return true;
    try {
      return new RegExp(state.urlFilterRaw).test(sourceUrl);
    } catch {
      return true;
    }
  };

  // eslint-disable-next-line unicorn/consistent-function-scoping -- runs serialized in the browser; must stay nested so it is captured by String(fn).
  const safeString = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[unserializable]';
      }
    }
    return String(value);
  };

  const pushEvent = (
    sourceUrl: string,
    eventType: string,
    rawData: unknown,
    lastEventId: string | null,
  ): void => {
    if (!state.enabled || !shouldCapture(sourceUrl)) return;
    const dataString = safeString(rawData);
    const preview =
      dataString.length > previewLimit ? `${dataString.slice(0, previewLimit)}…` : dataString;
    const record: FsEvent = {
      sourceUrl,
      eventType,
      dataPreview: preview,
      data: dataString,
      dataLength: dataString.length,
      lastEventId,
      timestamp: Date.now(),
    };
    state.events.push(record);
    while (state.events.length > state.maxEvents) state.events.shift();
    const source = state.sources[sourceUrl] ?? {
      url: sourceUrl,
      status: 'open' as const,
      eventCount: 0,
    };
    source.eventCount += 1;
    source.lastEventTimestamp = record.timestamp;
    state.sources[sourceUrl] = source;
  };

  // Parse one SSE event block (text between dispatch separators) into fields.
  // Returns null for comment-only / heartbeat blocks (nothing meaningful to surface).
  // eslint-disable-next-line unicorn/consistent-function-scoping -- runs serialized in the browser via evaluateWithTimeout; must stay nested so it is captured by String(fn).
  const parseEventBlock = (
    block: string,
  ): { eventType: string; data: string; lastEventId: string | null } | null => {
    let eventType = 'message';
    let data = '';
    let lastEventId: string | null = null;
    let meaningful = false;
    for (const line of block.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue;
      meaningful = true;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventType = value;
      else if (field === 'data') data = data === '' ? value : `${data}\n${value}`;
      else if (field === 'id') lastEventId = value;
    }
    return meaningful ? { eventType, data, lastEventId } : null;
  };

  // Find the earliest SSE dispatch separator (\n\n, \r\n\r\n, or \r\r).
  // eslint-disable-next-line unicorn/consistent-function-scoping -- runs serialized in the browser; must stay nested.
  const findSep = (buf: string): { offset: number; after: number } | null => {
    let best = -1;
    let bestLen = 0;
    const candidates: Array<[string, number]> = [
      ['\n\n', 2],
      ['\r\n\r\n', 4],
      ['\r\r', 2],
    ];
    for (const [sep, len] of candidates) {
      const i = buf.indexOf(sep);
      if (i !== -1 && (best === -1 || i < best)) {
        best = i;
        bestLen = len;
      }
    }
    return best === -1 ? null : { offset: best, after: best + bestLen };
  };

  const consumeStream = async (
    sourceUrl: string,
    body: ReadableStream<Uint8Array>,
  ): Promise<void> => {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      // eslint-disable-next-line no-constant-conditions
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > bufferCapBytes) {
          buffer = buffer.slice(-bufferCapBytes);
        }
        let sep = findSep(buffer);
        while (sep) {
          const block = buffer.slice(0, sep.offset);
          buffer = buffer.slice(sep.after);
          const parsed = parseEventBlock(block);
          if (parsed) pushEvent(sourceUrl, parsed.eventType, parsed.data, parsed.lastEventId);
          sep = findSep(buffer);
        }
      }
      buffer += decoder.decode();
      if (buffer.length > 0) {
        const parsed = parseEventBlock(buffer);
        if (parsed) pushEvent(sourceUrl, parsed.eventType, parsed.data, parsed.lastEventId);
      }
      const src = state.sources[sourceUrl];
      if (src) src.status = 'closed';
    } catch {
      const src = state.sources[sourceUrl];
      if (src) src.status = 'error';
    }
  };

  if (typeof gw.fetch === 'undefined') {
    return { success: false, error: 'fetch is not available in current page context' };
  }

  if (!state.patched) {
    const originalFetch = gw.fetch.bind(gw);
    state.originalFetch = originalFetch;

    const wrappedFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      try {
        const resource = input instanceof Request ? input.url : String(input);
        const ct = response.headers?.get?.('content-type') ?? '';
        if (
          ct.toLowerCase().includes('text/event-stream') &&
          resource &&
          shouldCapture(resource) &&
          response.body &&
          typeof response.body.getReader === 'function'
        ) {
          // Clone so the page's own consumer still receives the stream intact.
          const clone = typeof response.clone === 'function' ? response.clone() : response;
          void consumeStream(resource, clone.body as ReadableStream<Uint8Array>);
        }
      } catch {
        // Header inspection / clone must never break the page's real fetch.
      }
      return response;
    };
    gw.fetch = wrappedFetch;
    state.patched = true;
  }

  return {
    success: true,
    message: 'fetch-stream monitor enabled',
    patched: state.patched,
    urlFilter: state.urlFilterRaw,
    maxEvents: state.maxEvents,
    existingEvents: state.events.length,
  };
}

export class FetchStreamHandlers {
  private s: StreamingSharedState;
  constructor(s: StreamingSharedState) {
    this.s = s;
  }

  private async enable(
    maxEvents: number,
    urlFilterRaw?: string,
    options?: { persistent?: boolean },
  ): Promise<unknown> {
    const page = await this.s.collector.getActivePage();
    // An explicit enable() clears the persistent-disable marker first — the
    // injection script honours the marker and cannot distinguish a browser-
    // driven re-injection (after disable) from this explicit call.
    await evaluateWithTimeout(
      page,
      (args: { markerKey: string }) => {
        try {
          localStorage.removeItem(args.markerKey);
        } catch {
          /* sandboxed iframe — marker cannot be cleared */
        }
      },
      { markerKey: FETCH_STREAM_DISABLED_MARKER },
    );
    const injectionConfig = {
      maxEvents,
      urlFilterRaw,
      maxBufferBytes: SSE_BUFFER_MAX_BYTES,
      previewLimit: WS_PAYLOAD_PREVIEW_LIMIT,
      disableMarkerKey: FETCH_STREAM_DISABLED_MARKER,
    };
    if (options?.persistent) {
      await evaluateOnNewDocumentWithTimeout(page, fetchStreamInjectionFn, injectionConfig);
      return {
        success: true,
        message: 'fetch-stream monitor enabled (persistent — survives navigations)',
        patched: true,
        urlFilter: urlFilterRaw,
        maxEvents,
        existingEvents: 0,
      };
    }
    return (await evaluateWithTimeout(page, fetchStreamInjectionFn, injectionConfig)) as unknown;
  }

  async handleFetchStreamMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
    const maxEvents = parseNumberArg(args.maxEvents, {
      defaultValue: STREAMING_MAX_EVENTS,
      min: 1,
      max: STREAMING_MAX_EVENTS_CAP,
      integer: true,
    });
    const urlFilterRaw = parseOptionalStringArg(args.urlFilter);
    if (urlFilterRaw) {
      const compiled = compileRegex(urlFilterRaw);
      if (compiled.error)
        return asJson({
          success: false,
          error: `Invalid urlFilter regex: ${compiled.error}`,
        });
    }
    const persistent = args.persistent === true;
    const result = await this.enable(maxEvents, urlFilterRaw, { persistent });
    if (
      typeof result === 'object' &&
      result !== null &&
      (result as { success?: unknown }).success === false
    ) {
      return asJson(result);
    }
    this.s.fetchStreamConfig = { maxEvents, urlFilterRaw };
    return asJson(result);
  }

  async handleFetchStreamMonitorDisable(_args: Record<string, unknown>): Promise<TextToolResponse> {
    const page = await this.s.collector.getActivePage();
    await evaluateWithTimeout(
      page,
      (args: { markerKey: string }) => {
        // Persistent marker: without it, the evaluateOnNewDocument script that
        // re-runs on every page load would flip `enabled` back to true on the
        // next navigation, making disable a no-op for persistent monitors.
        try {
          localStorage.setItem(args.markerKey, '1');
        } catch {
          /* sandboxed iframe — current page still pauses below */
        }
        const gw = window as Window &
          typeof globalThis & { __jshookFetchStreamMonitor?: { enabled: boolean } };
        if (gw.__jshookFetchStreamMonitor) gw.__jshookFetchStreamMonitor.enabled = false;
      },
      { markerKey: FETCH_STREAM_DISABLED_MARKER },
    );
    return asJson({
      success: true,
      message: 'fetch-stream monitor disabled (wrapper remains installed; capture paused)',
    });
  }

  async handleFetchStreamGetEvents(args: Record<string, unknown>): Promise<TextToolResponse> {
    const sourceUrl = parseOptionalStringArg(args.sourceUrl);
    const eventType = parseOptionalStringArg(args.eventType);
    const fullData = parseBooleanArg(args.fullData, false);
    const limit = parseNumberArg(args.limit, {
      defaultValue: STREAMING_QUERY_LIMIT_DEFAULT,
      min: 1,
      max: STREAMING_QUERY_LIMIT_MAX,
      integer: true,
    });
    const offset = parseNumberArg(args.offset, {
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      integer: true,
    });

    const page = await this.s.collector.getActivePage();
    const result = await evaluateWithTimeout(
      page,
      (query: {
        sourceUrl?: string;
        eventType?: string;
        limit: number;
        offset: number;
        fullData: boolean;
      }) => {
        type FsEvent = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          data?: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };
        const gw = window as Window &
          typeof globalThis & {
            __jshookFetchStreamMonitor?: {
              enabled: boolean;
              patched: boolean;
              maxEvents: number;
              urlFilterRaw?: string;
              events: FsEvent[];
              sources: Record<string, unknown>;
            };
          };
        const state = gw.__jshookFetchStreamMonitor;
        if (!state)
          return {
            success: false,
            message: 'fetch-stream monitor is not enabled. Call fetch_stream_monitor first.',
          };
        let events = state.events;
        if (query.sourceUrl) events = events.filter((e) => e.sourceUrl === query.sourceUrl);
        if (query.eventType) events = events.filter((e) => e.eventType === query.eventType);
        const totalAfterFilter = events.length;
        const paged = events.slice(query.offset, query.offset + query.limit).map((event) => {
          if (query.fullData) return event;
          const { data: _data, ...withoutData } = event;
          return withoutData;
        });
        return {
          success: true,
          filters: {
            sourceUrl: query.sourceUrl ?? null,
            eventType: query.eventType ?? null,
            fullData: query.fullData,
          },
          page: {
            offset: query.offset,
            limit: query.limit,
            returned: paged.length,
            totalAfterFilter,
            hasMore: query.offset + paged.length < totalAfterFilter,
            nextOffset:
              query.offset + paged.length < totalAfterFilter ? query.offset + paged.length : null,
          },
          monitor: {
            enabled: state.enabled,
            patched: state.patched,
            maxEvents: state.maxEvents,
            urlFilter: state.urlFilterRaw ?? null,
            sourceCount: Object.keys(state.sources).length,
          },
          events: paged,
        };
      },
      { sourceUrl, eventType, limit, offset, fullData },
    );
    return asJson(result as Record<string, unknown>);
  }

  async handleFetchStreamExportCapture(args: Record<string, unknown>): Promise<TextToolResponse> {
    const sourceUrl = parseOptionalStringArg(args.sourceUrl);
    const eventType = parseOptionalStringArg(args.eventType);
    const includeData = parseBooleanArg(args.includeData, true);
    const format = parseExportFormat(args.format);
    const page = await this.s.collector.getActivePage();

    const result = await evaluateWithTimeout(
      page,
      (query: { sourceUrl?: string; eventType?: string; includeData: boolean }) => {
        type FsEvent = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          data?: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };
        const gw = window as Window &
          typeof globalThis & {
            __jshookFetchStreamMonitor?: {
              enabled: boolean;
              patched: boolean;
              maxEvents: number;
              urlFilterRaw?: string;
              events: FsEvent[];
              sources: Record<string, unknown>;
            };
          };
        const state = gw.__jshookFetchStreamMonitor;
        if (!state)
          return {
            success: false,
            message: 'fetch-stream monitor is not enabled. Call fetch_stream_monitor first.',
          };

        let events = state.events;
        if (query.sourceUrl) events = events.filter((e) => e.sourceUrl === query.sourceUrl);
        if (query.eventType) events = events.filter((e) => e.eventType === query.eventType);

        return {
          success: true,
          monitor: {
            enabled: state.enabled,
            patched: state.patched,
            maxEvents: state.maxEvents,
            urlFilter: state.urlFilterRaw ?? null,
            sourceCount: Object.keys(state.sources).length,
          },
          filters: {
            sourceUrl: query.sourceUrl ?? null,
            eventType: query.eventType ?? null,
            includeData: query.includeData,
          },
          events: events.map((event) => {
            if (query.includeData) return event;
            const { data: _data, ...withoutData } = event;
            return withoutData;
          }),
        };
      },
      { sourceUrl, eventType, includeData },
    );

    const capture = result as {
      success: boolean;
      message?: string;
      monitor?: Record<string, unknown>;
      filters?: Record<string, unknown>;
      events?: Array<Record<string, unknown>>;
    };
    if (!capture.success) return asJson(capture);

    const events = capture.events ?? [];
    const metadata = {
      schema: 'jshookmcp.streaming.fetch-stream.capture.v1',
      exportedAt: new Date().toISOString(),
      format,
      filters: capture.filters ?? { sourceUrl: sourceUrl ?? null, eventType: eventType ?? null },
      monitor: capture.monitor ?? null,
      recordCount: events.length,
    };

    const body =
      format === 'ndjson'
        ? [
            JSON.stringify({ type: 'metadata', ...metadata }),
            ...events.map((event) => JSON.stringify({ type: 'event', ...event })),
          ].join('\n') + '\n'
        : `${JSON.stringify({ ...metadata, events }, null, 2)}\n`;

    const artifact = await resolveArtifactPath({
      category: 'captures',
      toolName: 'fetch-stream-capture',
      target: eventType ?? sourceUrl ?? 'all',
      ext: format,
    });
    await writeFile(artifact.absolutePath, body, 'utf8');

    return asJson({
      success: true,
      artifactPath: artifact.displayPath,
      format,
      bytes: Buffer.byteLength(body, 'utf8'),
      recordCount: events.length,
      filters: metadata.filters,
      monitor: metadata.monitor,
    });
  }
}
