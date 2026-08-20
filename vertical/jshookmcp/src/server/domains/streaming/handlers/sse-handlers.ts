/**
 * SSE monitoring handlers — enable, get events.
 */

import { writeFile } from 'node:fs/promises';
import { resolveArtifactPath } from '@utils/artifacts';
import type {
  StreamingSharedState,
  TextToolResponse,
  SseEnableResult,
  SseEventRecord,
} from './shared';
import {
  asJson,
  parseBooleanArg,
  parseNumberArg,
  parseOptionalStringArg,
  compileRegex,
} from './shared';
import {
  evaluateWithTimeout,
  evaluateOnNewDocumentWithTimeout,
} from '@modules/collector/PageController';
import {
  STREAMING_MAX_EVENTS,
  STREAMING_MAX_EVENTS_CAP,
  STREAMING_QUERY_LIMIT_DEFAULT,
  STREAMING_QUERY_LIMIT_MAX,
  WS_PAYLOAD_PREVIEW_LIMIT,
} from '@src/constants/streaming';

type InternalSseEvent = {
  sourceUrl: string;
  eventType: string;
  dataPreview: string;
  data?: string;
  dataLength: number;
  lastEventId: string | null;
  timestamp: number;
};

type InternalSseSource = {
  url: string;
  status: 'connecting' | 'open' | 'error' | 'closed';
  eventCount: number;
  lastEventTimestamp?: number;
};

type InternalSseMonitorState = {
  enabled: boolean;
  patched: boolean;
  maxEvents: number;
  urlFilterRaw?: string;
  events: InternalSseEvent[];
  sources: Record<string, InternalSseSource>;
  originalEventSource?: typeof EventSource;
};

type ExportFormat = 'json' | 'ndjson';

const parseExportFormat = (value: unknown): ExportFormat =>
  value === 'ndjson' ? 'ndjson' : 'json';

function sseInjectionFn(config: {
  maxEvents: number;
  urlFilterRaw?: string;
  /** Data preview truncation limit; canonical value WS_PAYLOAD_PREVIEW_LIMIT. */
  previewLimit?: number;
}) {
  const globalWindow = window as Window &
    typeof globalThis & {
      __jshookSSEMonitor?: InternalSseMonitorState;
      EventSource: typeof EventSource;
    };

  // Preview truncation limit, supplied by the handler from the streaming
  // constants module (WS_PAYLOAD_PREVIEW_LIMIT); the fallback keeps the
  // serialized script self-contained.
  const previewLimit = config.previewLimit ?? 200;

  if (!globalWindow.__jshookSSEMonitor) {
    globalWindow.__jshookSSEMonitor = {
      enabled: true,
      patched: false,
      maxEvents: config.maxEvents,
      urlFilterRaw: config.urlFilterRaw,
      events: [],
      sources: {},
    };
  }

  const state = globalWindow.__jshookSSEMonitor;
  state.enabled = true;
  state.maxEvents = config.maxEvents;
  state.urlFilterRaw = config.urlFilterRaw;

  if (state.events.length > state.maxEvents) {
    state.events = state.events.slice(-state.maxEvents);
  }

  const shouldCapture = (sourceUrl: string): boolean => {
    if (!state.urlFilterRaw) return true;
    try {
      return new RegExp(state.urlFilterRaw).test(sourceUrl);
    } catch {
      return true;
    }
  };

  // eslint-disable-next-line unicorn/consistent-function-scoping -- runs in browser context via evaluateWithTimeout/evaluateOnNewDocument
  const toDataString = (value: unknown): string => {
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
    const dataString = toDataString(rawData);
    const preview =
      dataString.length > previewLimit ? `${dataString.slice(0, previewLimit)}…` : dataString;
    const record: InternalSseEvent = {
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
    const source =
      state.sources[sourceUrl] ??
      ({ url: sourceUrl, status: 'connecting' as const, eventCount: 0 } as InternalSseSource);
    source.eventCount += 1;
    source.lastEventTimestamp = record.timestamp;
    state.sources[sourceUrl] = source;
  };

  if (typeof globalWindow.EventSource === 'undefined') {
    return { success: false, error: 'EventSource is not available in current page context' };
  }

  if (!state.patched) {
    const OriginalEventSource = globalWindow.EventSource;

    const WrappedEventSource = function (
      this: EventSource,
      url: string | URL,
      eventSourceInitDict?: EventSourceInit,
    ): EventSource {
      const sourceUrl = String(url);
      const es = new OriginalEventSource(url, eventSourceInitDict);

      if (shouldCapture(sourceUrl)) {
        const source =
          state.sources[sourceUrl] ??
          ({ url: sourceUrl, status: 'connecting' as const, eventCount: 0 } as InternalSseSource);
        state.sources[sourceUrl] = source;
      }

      es.addEventListener('open', () => {
        const source = state.sources[sourceUrl];
        if (source) source.status = 'open';
        pushEvent(sourceUrl, 'open', '', null);
      });

      es.addEventListener('error', () => {
        const source = state.sources[sourceUrl];
        if (source) source.status = 'error';
        pushEvent(sourceUrl, 'error', '', null);
      });

      es.addEventListener('message', (event: MessageEvent) => {
        const lastEventId =
          typeof event.lastEventId === 'string' && event.lastEventId.length > 0
            ? event.lastEventId
            : null;
        pushEvent(sourceUrl, event.type || 'message', event.data, lastEventId);
      });

      const originalAddEventListener: EventSource['addEventListener'] =
        es.addEventListener.bind(es);
      const callOriginalAddEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        listenerOpts?: boolean | AddEventListenerOptions,
      ): void => {
        originalAddEventListener(
          type as Parameters<EventSource['addEventListener']>[0],
          listener as Parameters<EventSource['addEventListener']>[1],
          listenerOpts as Parameters<EventSource['addEventListener']>[2],
        );
      };

      const wrappedAddEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        listenerOpts?: boolean | AddEventListenerOptions,
      ): void => {
        if (type !== 'message' && type !== 'open' && type !== 'error' && listener) {
          const wrapped: EventListener = (evt: Event) => {
            const messageEvent = evt as MessageEvent;
            const lastEventId =
              typeof messageEvent.lastEventId === 'string' && messageEvent.lastEventId.length > 0
                ? messageEvent.lastEventId
                : null;
            pushEvent(sourceUrl, type, messageEvent.data, lastEventId);
            if (typeof listener === 'function') listener.call(es, evt);
            else listener.handleEvent(evt);
          };
          callOriginalAddEventListener(type, wrapped, listenerOpts);
          return;
        }
        callOriginalAddEventListener(type, listener, listenerOpts);
      };

      Object.defineProperty(es, 'addEventListener', {
        value: wrappedAddEventListener as unknown as EventSource['addEventListener'],
        configurable: true,
        writable: true,
      });

      return es;
    } as unknown as typeof EventSource;

    WrappedEventSource.prototype = OriginalEventSource.prototype;

    try {
      Object.defineProperty(WrappedEventSource, 'CONNECTING', {
        value: OriginalEventSource.CONNECTING,
      });
      Object.defineProperty(WrappedEventSource, 'OPEN', { value: OriginalEventSource.OPEN });
      Object.defineProperty(WrappedEventSource, 'CLOSED', { value: OriginalEventSource.CLOSED });
    } catch {
      /* Ignore immutable static field environments. */
    }

    globalWindow.EventSource = WrappedEventSource;
    state.originalEventSource = OriginalEventSource;
    state.patched = true;
  }

  return {
    success: true,
    message: 'SSE monitor enabled',
    patched: state.patched,
    urlFilter: state.urlFilterRaw,
    maxEvents: state.maxEvents,
    existingEvents: state.events.length,
  };
}

export class SseHandlers {
  constructor(private s: StreamingSharedState) {}

  private async enableSseInterceptor(
    maxEvents: number,
    urlFilterRaw?: string,
    options?: { persistent?: boolean },
  ): Promise<SseEnableResult | { success: false; error: string }> {
    const page = await this.s.collector.getActivePage();

    const injectionConfig = {
      maxEvents,
      urlFilterRaw,
      previewLimit: WS_PAYLOAD_PREVIEW_LIMIT,
    };
    if (options?.persistent) {
      await evaluateOnNewDocumentWithTimeout(page, sseInjectionFn, injectionConfig);
      return {
        success: true,
        message: 'SSE monitor enabled (persistent — survives navigations)',
        patched: true,
        urlFilter: urlFilterRaw,
        maxEvents,
        existingEvents: 0,
      };
    }

    const result = await evaluateWithTimeout(page, sseInjectionFn, injectionConfig);
    return result as SseEnableResult | { success: false; error: string };
  }

  async handleSseMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
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
        return asJson({ success: false, error: `Invalid urlFilter regex: ${compiled.error}` });
    }

    const persistent = args.persistent === true;
    const result = await this.enableSseInterceptor(maxEvents, urlFilterRaw, { persistent });

    if (!result.success) return asJson(result);

    this.s.sseConfig = { maxEvents, urlFilterRaw };

    return asJson({
      success: true,
      message: result.message,
      patched: result.patched,
      config: {
        maxEvents: this.s.sseConfig.maxEvents,
        urlFilter: this.s.sseConfig.urlFilterRaw ?? null,
      },
      existingEvents: result.existingEvents,
    });
  }

  async handleSseGetEvents(args: Record<string, unknown>): Promise<TextToolResponse> {
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
        type EventRecord = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          data?: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };
        type SourceRecord = {
          url: string;
          status: 'connecting' | 'open' | 'error' | 'closed';
          eventCount: number;
          lastEventTimestamp?: number;
        };
        type MonitorState = {
          enabled: boolean;
          patched: boolean;
          maxEvents: number;
          urlFilterRaw?: string;
          events: EventRecord[];
          sources: Record<string, SourceRecord>;
        };

        const gw = window as Window &
          typeof globalThis & {
            __jshookSSEMonitor?: MonitorState;
            EventSource: typeof EventSource;
          };
        const state = gw.__jshookSSEMonitor;
        if (!state)
          return {
            success: false,
            message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
          };

        let events = state.events;
        if (query.sourceUrl) events = events.filter((evt) => evt.sourceUrl === query.sourceUrl);
        if (query.eventType) events = events.filter((evt) => evt.eventType === query.eventType);

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

    return asJson(result as { success: boolean; message?: string; events?: SseEventRecord[] });
  }

  async handleSseExportCapture(args: Record<string, unknown>): Promise<TextToolResponse> {
    const sourceUrl = parseOptionalStringArg(args.sourceUrl);
    const eventType = parseOptionalStringArg(args.eventType);
    const includeData = parseBooleanArg(args.includeData, true);
    const format = parseExportFormat(args.format);
    const page = await this.s.collector.getActivePage();

    const result = await evaluateWithTimeout(
      page,
      (query: { sourceUrl?: string; eventType?: string; includeData: boolean }) => {
        type EventRecord = {
          sourceUrl: string;
          eventType: string;
          dataPreview: string;
          data?: string;
          dataLength: number;
          lastEventId: string | null;
          timestamp: number;
        };
        type SourceRecord = {
          url: string;
          status: 'connecting' | 'open' | 'error' | 'closed';
          eventCount: number;
          lastEventTimestamp?: number;
        };
        type MonitorState = {
          enabled: boolean;
          patched: boolean;
          maxEvents: number;
          urlFilterRaw?: string;
          events: EventRecord[];
          sources: Record<string, SourceRecord>;
        };

        const gw = window as Window &
          typeof globalThis & {
            __jshookSSEMonitor?: MonitorState;
            EventSource: typeof EventSource;
          };
        const state = gw.__jshookSSEMonitor;
        if (!state)
          return {
            success: false,
            message: 'SSE monitor is not enabled. Call sse_monitor_enable first.',
          };

        let events = state.events;
        if (query.sourceUrl) events = events.filter((evt) => evt.sourceUrl === query.sourceUrl);
        if (query.eventType) events = events.filter((evt) => evt.eventType === query.eventType);

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
      events?: SseEventRecord[];
    };
    if (!capture.success) return asJson(capture);

    const events = capture.events ?? [];
    const metadata = {
      schema: 'jshookmcp.streaming.sse.capture.v1',
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
      toolName: 'sse-capture',
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
