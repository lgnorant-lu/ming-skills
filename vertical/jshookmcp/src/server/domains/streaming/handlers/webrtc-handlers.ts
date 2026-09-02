/**
 * WebRTC data-channel monitoring handlers.
 *
 * No CDP coverage exists for RTCDataChannel, so — like the SSE EventSource
 * patch — we wrap RTCPeerConnection in-page. We intercept createDataChannel
 * (locally-created channels) and the `datachannel` event (remote-initiated
 * channels), and for each channel wrap send() (outbound) + add a message
 * listener (inbound), capturing both directions.
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
 * localStorage marker key for the WebRTC persistent-disable switch — mirrors
 * the fetch-stream monitor's marker (`__jshookFetchStreamMonitorDisabled`) so
 * a persistent monitor can be turned off across navigations. The key lives
 * once here and is passed into every browser-serialized script as an argument
 * (module scope is unreachable inside String(fn)-serialized code).
 */
const WEBRTC_DISABLED_MARKER = '__jshookWebRtcMonitorDisabled';

/**
 * Runs in the browser. Wraps window.RTCPeerConnection; for every data channel it
 * captures outbound send() and inbound message events into window.__jshookWebRtcMonitor.
 * Self-contained (no closure over module scope) so it survives serialization.
 */
function webrtcInjectionFn(config: {
  maxEvents: number;
  urlFilterRaw?: string;
  /** Persistent-disable localStorage key; canonical value WEBRTC_DISABLED_MARKER. */
  disableMarkerKey?: string;
  /** Data preview truncation limit; canonical value WS_PAYLOAD_PREVIEW_LIMIT. */
  previewLimit?: number;
}): unknown {
  type WEvent = {
    pcId: number;
    label: string;
    direction: 'sent' | 'received';
    dataPreview: string;
    data?: string;
    dataLength: number;
    isBinary: boolean;
    timestamp: number;
  };
  type WState = {
    enabled: boolean;
    patched: boolean;
    maxEvents: number;
    urlFilterRaw?: string;
    events: WEvent[];
    nextPcId: number;
    channels: number;
    /** wrapped listener → original listener, so the app's
     * removeEventListener('datachannel', original) finds the wrapper. */
    wrappedListeners: WeakMap<object, object>;
  };

  // Persistent-disable marker: `webrtc_monitor(disable)` writes it to
  // localStorage, which survives navigations. This script re-runs on every
  // page load (evaluateOnNewDocument) and MUST come up disabled while the
  // marker is set — otherwise disable has no effect on new pages. The key is
  // passed via config (the handler supplies WEBRTC_DISABLED_MARKER); the
  // fallback literal covers standalone invocation of this serialized script,
  // which cannot see module scope.
  const disableMarkerKey = config.disableMarkerKey ?? '__jshookWebRtcMonitorDisabled';
  let persistentlyDisabled = false;
  try {
    persistentlyDisabled =
      typeof localStorage !== 'undefined' && localStorage.getItem(disableMarkerKey) === '1';
  } catch {
    // localStorage can throw in sandboxed iframes — treat as enabled.
  }

  // Preview truncation limit, supplied by the handler from the streaming
  // constants module (WS_PAYLOAD_PREVIEW_LIMIT); the fallback keeps the
  // serialized script self-contained.
  const previewLimit = config.previewLimit ?? 200;

  const gw = window as Window &
    typeof globalThis & {
      __jshookWebRtcMonitor?: WState;
    };

  if (!gw.__jshookWebRtcMonitor) {
    gw.__jshookWebRtcMonitor = {
      enabled: !persistentlyDisabled,
      patched: false,
      maxEvents: config.maxEvents,
      urlFilterRaw: config.urlFilterRaw,
      events: [],
      nextPcId: 1,
      channels: 0,
      wrappedListeners: new WeakMap(),
    };
  }
  const state = gw.__jshookWebRtcMonitor;
  // NOTE: the marker is only READ here — clearing it is the enable handler's
  // job (this script cannot distinguish a browser-driven re-injection after
  // disable from an explicit enable() call).
  state.enabled = !persistentlyDisabled;
  state.maxEvents = config.maxEvents;
  state.urlFilterRaw = config.urlFilterRaw;
  if (state.events.length > state.maxEvents) state.events = state.events.slice(-state.maxEvents);

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

  const pushMessage = (
    pcId: number,
    label: string,
    direction: 'sent' | 'received',
    rawData: unknown,
  ): void => {
    if (!state.enabled) return;
    const isBinary =
      typeof rawData !== 'string' &&
      (rawData instanceof ArrayBuffer ||
        (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView?.(rawData)) === true);
    const dataString = safeString(
      isBinary ? `[binary ${String((rawData as ArrayBuffer).byteLength ?? 0)} bytes]` : rawData,
    );
    const preview =
      dataString.length > previewLimit ? `${dataString.slice(0, previewLimit)}…` : dataString;
    state.events.push({
      pcId,
      label,
      direction,
      dataPreview: preview,
      data: dataString,
      dataLength: isBinary ? (rawData as ArrayBuffer).byteLength : dataString.length,
      isBinary,
      timestamp: Date.now(),
    });
    while (state.events.length > state.maxEvents) state.events.shift();
  };

  const wrapChannel = (
    pcId: number,
    ch: {
      send: (d: unknown) => void;
      addEventListener: (t: string, l: (e: unknown) => void) => void;
      label?: string;
    },
    label: string,
  ): void => {
    state.channels += 1;
    const effectiveLabel = label || (typeof ch.label === 'string' ? ch.label : '');
    const originalSend = ch.send.bind(ch) as (d: unknown) => void;
    ch.send = function (data: unknown) {
      pushMessage(pcId, effectiveLabel, 'sent', data);
      return originalSend(data);
    };
    ch.addEventListener('message', (event: unknown) => {
      const evt = event as { data?: unknown };
      pushMessage(pcId, effectiveLabel, 'received', evt?.data);
    });
  };

  if (typeof gw.RTCPeerConnection === 'undefined') {
    return { success: false, error: 'RTCPeerConnection is not available in current page context' };
  }

  if (!state.patched) {
    const OriginalRTC = gw.RTCPeerConnection;

    const WrappedRTC = function (
      this: RTCPeerConnection,
      rtcConfig?: RTCConfiguration,
    ): RTCPeerConnection {
      const pc = new OriginalRTC(rtcConfig) as RTCPeerConnection & { __jshookPcId?: number };
      const pcId = state.nextPcId;
      state.nextPcId += 1;
      pc.__jshookPcId = pcId;

      const origCreate = pc.createDataChannel.bind(pc) as RTCPeerConnection['createDataChannel'];
      pc.createDataChannel = function (label: string, dataChannelDict?: RTCDataChannelInit) {
        const ch = origCreate(label, dataChannelDict);
        wrapChannel(
          pcId,
          ch as unknown as {
            send: (d: unknown) => void;
            addEventListener: (t: string, l: (e: unknown) => void) => void;
            label?: string;
          },
          label,
        );
        return ch;
      } as RTCPeerConnection['createDataChannel'];

      // Remote-initiated channels arrive via the `datachannel` event — wrap before the app sees them.
      const origAddEventListener = pc.addEventListener.bind(
        pc,
      ) as RTCPeerConnection['addEventListener'];
      pc.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        opts?: boolean | AddEventListenerOptions,
      ) {
        if (type === 'datachannel' && listener) {
          const wrapped = (ev: Event) => {
            const rtcEv = ev as RTCDataChannelEvent;
            if (rtcEv?.channel) {
              wrapChannel(
                pcId,
                rtcEv.channel as unknown as {
                  send: (d: unknown) => void;
                  addEventListener: (t: string, l: (e: unknown) => void) => void;
                  label?: string;
                },
                rtcEv.channel.label,
              );
            }
            if (typeof listener === 'function') listener.call(pc, ev);
            else listener.handleEvent(ev);
          };
          state.wrappedListeners.set(listener, wrapped);
          return origAddEventListener(
            type as Parameters<RTCPeerConnection['addEventListener']>[0],
            wrapped as Parameters<RTCPeerConnection['addEventListener']>[1],
            opts as Parameters<RTCPeerConnection['addEventListener']>[2],
          );
        }
        return origAddEventListener(
          type as Parameters<RTCPeerConnection['addEventListener']>[0],
          listener as Parameters<RTCPeerConnection['addEventListener']>[1],
          opts as Parameters<RTCPeerConnection['addEventListener']>[2],
        );
      } as RTCPeerConnection['addEventListener'];

      // removeEventListener must resolve the app's ORIGINAL listener to the
      // wrapped one — the app never saw the wrapper, so a direct lookup would
      // silently fail to remove the listener (and the capture stays active).
      const origRemoveEventListener = pc.removeEventListener.bind(
        pc,
      ) as RTCPeerConnection['removeEventListener'];
      pc.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        opts?: boolean | EventListenerOptions,
      ) {
        let target = listener;
        if (listener) {
          const wrapped = state.wrappedListeners.get(listener);
          if (wrapped) {
            target = wrapped as EventListenerOrEventListenerObject;
            state.wrappedListeners.delete(listener);
          }
        }
        return origRemoveEventListener(
          type as Parameters<RTCPeerConnection['removeEventListener']>[0],
          target as Parameters<RTCPeerConnection['removeEventListener']>[1],
          opts as Parameters<RTCPeerConnection['removeEventListener']>[2],
        );
      } as RTCPeerConnection['removeEventListener'];

      return pc;
    } as unknown as {
      new (config?: RTCConfiguration): RTCPeerConnection;
      prototype: RTCPeerConnection;
    };

    WrappedRTC.prototype = OriginalRTC.prototype;
    // Preserve the static generateCertificate (rarely used but part of the interface).
    try {
      (WrappedRTC as { generateCertificate?: unknown }).generateCertificate = (
        OriginalRTC as { generateCertificate?: unknown }
      ).generateCertificate;
    } catch {
      /* static copy best-effort */
    }
    gw.RTCPeerConnection = WrappedRTC as unknown as typeof RTCPeerConnection;
    state.patched = true;
  }

  return {
    success: true,
    message: 'WebRTC monitor enabled',
    patched: state.patched,
    urlFilter: state.urlFilterRaw,
    maxEvents: state.maxEvents,
    existingEvents: state.events.length,
  };
}

export class WebRtcHandlers {
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
      { markerKey: WEBRTC_DISABLED_MARKER },
    );
    const injectionConfig = {
      maxEvents,
      urlFilterRaw,
      disableMarkerKey: WEBRTC_DISABLED_MARKER,
      previewLimit: WS_PAYLOAD_PREVIEW_LIMIT,
    };
    if (options?.persistent) {
      await evaluateOnNewDocumentWithTimeout(page, webrtcInjectionFn, injectionConfig);
      return {
        success: true,
        message: 'WebRTC monitor enabled (persistent — survives navigations)',
        patched: true,
        urlFilter: urlFilterRaw,
        maxEvents,
        existingEvents: 0,
      };
    }
    return (await evaluateWithTimeout(page, webrtcInjectionFn, injectionConfig)) as unknown;
  }

  async handleWebRtcMonitorEnable(args: Record<string, unknown>): Promise<TextToolResponse> {
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
    this.s.webrtcConfig = { maxEvents, urlFilterRaw };
    return asJson(result);
  }

  async handleWebRtcMonitorDisable(_args: Record<string, unknown>): Promise<TextToolResponse> {
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
          typeof globalThis & { __jshookWebRtcMonitor?: { enabled: boolean } };
        if (gw.__jshookWebRtcMonitor) gw.__jshookWebRtcMonitor.enabled = false;
      },
      { markerKey: WEBRTC_DISABLED_MARKER },
    );
    return asJson({
      success: true,
      message: 'WebRTC monitor disabled (wrapper remains installed; capture paused)',
    });
  }

  async handleWebRtcGetEvents(args: Record<string, unknown>): Promise<TextToolResponse> {
    const label = parseOptionalStringArg(args.label);
    const direction = parseOptionalStringArg(args.direction);
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
        label?: string;
        direction?: string;
        limit: number;
        offset: number;
        fullData: boolean;
      }) => {
        type WEvent = {
          pcId: number;
          label: string;
          direction: 'sent' | 'received';
          dataPreview: string;
          data?: string;
          dataLength: number;
          isBinary: boolean;
          timestamp: number;
        };
        const gw = window as Window &
          typeof globalThis & {
            __jshookWebRtcMonitor?: {
              enabled: boolean;
              patched: boolean;
              maxEvents: number;
              urlFilterRaw?: string;
              events: WEvent[];
              nextPcId: number;
              channels: number;
            };
          };
        const state = gw.__jshookWebRtcMonitor;
        if (!state)
          return {
            success: false,
            message: 'WebRTC monitor is not enabled. Call webrtc_monitor first.',
          };
        let events = state.events;
        if (query.label) events = events.filter((e) => e.label === query.label);
        if (query.direction) events = events.filter((e) => e.direction === query.direction);
        const totalAfterFilter = events.length;
        const paged = events.slice(query.offset, query.offset + query.limit).map((event) => {
          if (query.fullData) return event;
          const { data: _data, ...withoutData } = event;
          return withoutData;
        });
        return {
          success: true,
          filters: {
            label: query.label ?? null,
            direction: query.direction ?? null,
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
            peerConnectionsSeen: state.nextPcId - 1,
            dataChannels: state.channels,
          },
          events: paged,
        };
      },
      { label, direction, limit, offset, fullData },
    );
    return asJson(result as Record<string, unknown>);
  }

  async handleWebRtcExportCapture(args: Record<string, unknown>): Promise<TextToolResponse> {
    const label = parseOptionalStringArg(args.label);
    const direction = parseOptionalStringArg(args.direction);
    const includeData = parseBooleanArg(args.includeData, true);
    const format = parseExportFormat(args.format);
    const page = await this.s.collector.getActivePage();

    const result = await evaluateWithTimeout(
      page,
      (query: { label?: string; direction?: string; includeData: boolean }) => {
        type WEvent = {
          pcId: number;
          label: string;
          direction: 'sent' | 'received';
          dataPreview: string;
          data?: string;
          dataLength: number;
          isBinary: boolean;
          timestamp: number;
        };
        const gw = window as Window &
          typeof globalThis & {
            __jshookWebRtcMonitor?: {
              enabled: boolean;
              patched: boolean;
              maxEvents: number;
              urlFilterRaw?: string;
              events: WEvent[];
              nextPcId: number;
              channels: number;
            };
          };
        const state = gw.__jshookWebRtcMonitor;
        if (!state)
          return {
            success: false,
            message: 'WebRTC monitor is not enabled. Call webrtc_monitor first.',
          };

        let events = state.events;
        if (query.label) events = events.filter((e) => e.label === query.label);
        if (query.direction) events = events.filter((e) => e.direction === query.direction);

        return {
          success: true,
          monitor: {
            enabled: state.enabled,
            patched: state.patched,
            maxEvents: state.maxEvents,
            urlFilter: state.urlFilterRaw ?? null,
            peerConnectionsSeen: state.nextPcId - 1,
            dataChannels: state.channels,
          },
          filters: {
            label: query.label ?? null,
            direction: query.direction ?? null,
            includeData: query.includeData,
          },
          events: events.map((event) => {
            if (query.includeData) return event;
            const { data: _data, ...withoutData } = event;
            return withoutData;
          }),
        };
      },
      { label, direction, includeData },
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
      schema: 'jshookmcp.streaming.webrtc.capture.v1',
      exportedAt: new Date().toISOString(),
      format,
      filters: capture.filters ?? { label: label ?? null, direction: direction ?? null },
      monitor: capture.monitor ?? null,
      recordCount: events.length,
    };

    const body =
      format === 'ndjson'
        ? [
            JSON.stringify({ type: 'metadata', ...metadata }),
            ...events.map((event) => JSON.stringify({ type: 'message', ...event })),
          ].join('\n') + '\n'
        : `${JSON.stringify({ ...metadata, events }, null, 2)}\n`;

    const artifact = await resolveArtifactPath({
      category: 'captures',
      toolName: 'webrtc-capture',
      target: direction ?? label ?? 'all',
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
