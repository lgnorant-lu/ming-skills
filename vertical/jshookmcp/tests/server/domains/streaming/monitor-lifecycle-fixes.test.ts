/**
 * Regression tests for streaming monitor lifecycle fixes:
 *
 * 1. fetch-stream `persistent` mode could not be turned off — the
 *    evaluateOnNewDocument script re-ran on every page load and reset
 *    `enabled = true`, so `fetch_stream_monitor(disable)` had no effect on
 *    new pages. The injection must honour a persistent disable marker
 *    (localStorage survives navigations).
 * 2. fetch-stream SSE parsing buffers the raw stream; a stream with no
 *    dispatch separators grew the buffer without bound. The buffer must be
 *    size-capped (tail kept, so the newest events still parse).
 * 3. WebRTC `removeEventListener('datachannel', original)` could not find the
 *    wrapped listener and the app's removal silently failed. The wrapper must
 *    keep a wrapped→original mapping.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import { FetchStreamHandlers } from '@server/domains/streaming/handlers/fetch-stream-handlers';
import { WebRtcHandlers } from '@server/domains/streaming/handlers/webrtc-handlers';
import {
  createStreamingSharedState,
  type StreamingSharedState,
} from '@server/domains/streaming/handlers/shared';

// ── fetch-stream harness ──────────────────────────────────────────────

function mockBody(chunks: string[]) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i < chunks.length) {
          const text = chunks[i]!;
          i += 1;
          return { done: false, value: new TextEncoder().encode(text) };
        }
        return { done: true, value: undefined };
      },
    }),
  };
}

function mockResponse(chunks: string[]) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
    },
    clone: () => mockResponse(chunks),
    body: mockBody(chunks),
  };
}

interface FsWindow {
  fetch: (url: string) => Promise<unknown>;
  __jshookFetchStreamMonitor?: Record<string, unknown>;
}

/** localStorage stub shared across "page loads" (survives window swaps). */
function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    store,
    stub: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
}

function createFsState() {
  const routes = new Map<string, string[]>();
  let win: FsWindow = {
    fetch: async (url: string) => {
      for (const [key, chunks] of routes) if (url.includes(key)) return mockResponse(chunks);
      return mockResponse([]);
    },
  };
  const localStorageStub = createLocalStorageStub();
  const page = { evaluate: vi.fn(), evaluateOnNewDocument: vi.fn() };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);

  const runScript = (pageFunction: unknown, arg: unknown) => {
    const serialized = `(${String(pageFunction)})`;
    const fn = runInNewContext(serialized, {
      window: win,
      localStorage: localStorageStub.stub,
      TextDecoder,
      TextEncoder,
      Request: globalThis.Request,
      Response: globalThis.Response,
    }) as (input: unknown) => unknown;
    return fn(arg);
  };
  page.evaluate.mockImplementation(async (pageFunction: unknown, arg: unknown) =>
    runScript(pageFunction, arg),
  );
  page.evaluateOnNewDocument.mockImplementation(async (pageFunction: unknown, arg: unknown) =>
    runScript(pageFunction, arg),
  );

  /** Simulate a fresh page load: new window object (no monitor state), same
   * localStorage — exactly what evaluateOnNewDocument re-injection sees. */
  const reloadPage = () => {
    win = { fetch: win.fetch };
  };
  return {
    state,
    get win() {
      return win;
    },
    routes,
    page,
    reloadPage,
    localStorageStub,
    runScript,
  };
}

const drain = () => new Promise<void>((r) => setTimeout(r, 50));

describe('fetch-stream monitor lifecycle fixes', () => {
  let env: ReturnType<typeof createFsState>;
  let handlers: FetchStreamHandlers;

  beforeEach(() => {
    env = createFsState();
    handlers = new FetchStreamHandlers(env.state);
  });

  function monitorEnabled(): boolean {
    const mon = env.win.__jshookFetchStreamMonitor as { enabled?: boolean } | undefined;
    return mon?.enabled ?? false;
  }

  it('persistent disable survives a page reload (re-injection stays off)', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable', persistent: true });
    expect(monitorEnabled()).toBe(true);
    // Grab the script the browser would re-run on every navigation.
    const injectionFn = env.page.evaluateOnNewDocument.mock.calls[0]![0];

    await handlers.handleFetchStreamMonitorDisable({ action: 'disable' });
    expect(monitorEnabled()).toBe(false);
    expect(env.localStorageStub.store.get('__jshookFetchStreamMonitorDisabled')).toBe('1');

    // New page load: the browser re-runs the injection on a fresh window —
    // the monitor must come up DISABLED (this is NOT an enable() call).
    env.reloadPage();
    expect(env.win.__jshookFetchStreamMonitor).toBeUndefined();
    env.runScript(injectionFn, { maxEvents: 2000 });
    expect(monitorEnabled()).toBe(false);

    // Explicit re-enable clears the marker and comes back on.
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable', persistent: true });
    expect(monitorEnabled()).toBe(true);
    expect(env.localStorageStub.store.has('__jshookFetchStreamMonitorDisabled')).toBe(false);

    // After re-enable, a subsequent page reload comes up enabled again.
    env.reloadPage();
    env.runScript(injectionFn, { maxEvents: 2000 });
    expect(monitorEnabled()).toBe(true);
  });

  it('disable stays off on the current page without an explicit enable', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    await handlers.handleFetchStreamMonitorDisable({ action: 'disable' });
    // The current page is paused; events captured before the disable remain,
    // but new fetches must not be recorded.
    env.routes.set('late', ['data: late-event\n\n']);
    await env.win.fetch('https://stream-host/late');
    await drain();
    const result = JSON.parse(
      (await handlers.handleFetchStreamGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.events).toHaveLength(0);
    expect(monitorEnabled()).toBe(false);
  });

  it('capped SSE buffer keeps parsing the newest event after an unbounded run', async () => {
    await handlers.handleFetchStreamMonitorEnable({ action: 'enable' });
    // A stream with no dispatch separator for ~1.5MB (over the 1 MiB cap),
    // then a complete event: the tail must be preserved so the final event
    // still parses instead of being lost to unbounded growth. The noise line
    // carries a trailing newline (SSE event lines are newline-delimited).
    const noSeparator = `${'x'.repeat(1536 * 1024)}\n`;
    env.routes.set('noisy', [noSeparator, 'data: tail-event\n\n']);
    await env.win.fetch('https://stream-host/noisy');
    await drain();

    const result = JSON.parse(
      (await handlers.handleFetchStreamGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toBe('tail-event');
  });
});

// ── webrtc harness ────────────────────────────────────────────────────

function mockChannel(label: string) {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  return {
    label,
    readyState: 'open',
    listeners,
    send: vi.fn(),
    addEventListener: vi.fn((type: string, l: (e: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(l);
      listeners.set(type, arr);
    }),
    dispatch(type: string, data: unknown) {
      for (const l of listeners.get(type) ?? []) l({ data });
    },
  };
}

function createRtcState() {
  const instances: Array<{
    dcListeners: Map<string, Set<(e: unknown) => void>>;
    dataChannels: ReturnType<typeof mockChannel>[];
    fireDataChannel: (ch: ReturnType<typeof mockChannel>) => void;
  }> = [];
  class RTC {
    dcListeners = new Map<string, Set<(e: unknown) => void>>();
    dataChannels: ReturnType<typeof mockChannel>[] = [];
    constructor() {
      instances.push(this);
    }
    createDataChannel = vi.fn((label: string) => {
      const ch = mockChannel(label);
      this.dataChannels.push(ch);
      return ch;
    });
    addEventListener = vi.fn((type: string, l: (e: unknown) => void) => {
      const arr = this.dcListeners.get(type) ?? new Set();
      arr.add(l);
      this.dcListeners.set(type, arr);
    });
    removeEventListener = vi.fn((type: string, l: (e: unknown) => void) => {
      const arr = this.dcListeners.get(type);
      if (arr) arr.delete(l);
    });
    fireDataChannel(ch: ReturnType<typeof mockChannel>) {
      for (const l of this.dcListeners.get('datachannel') ?? []) l({ channel: ch });
    }
  }
  const win: { RTCPeerConnection: typeof RTC; __jshookWebRtcMonitor?: Record<string, unknown> } = {
    RTCPeerConnection: RTC,
  };
  const page = { evaluate: vi.fn() };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);
  page.evaluate.mockImplementation(async (pageFunction: unknown, arg: unknown) => {
    const serialized = `(${String(pageFunction)})`;
    const fn = runInNewContext(serialized, {
      window: win,
      ArrayBuffer: globalThis.ArrayBuffer,
    }) as (input: unknown) => unknown;
    return fn(arg);
  });
  return { state, win, instances };
}

describe('webrtc removeEventListener mapping', () => {
  let env: ReturnType<typeof createRtcState>;
  let handlers: WebRtcHandlers;

  beforeEach(() => {
    env = createRtcState();
    handlers = new WebRtcHandlers(env.state);
  });

  function pcInstance() {
    return env.instances[env.instances.length - 1]!;
  }

  it('removes a wrapped datachannel listener when the app passes the original', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });

    const pc = new env.win.RTCPeerConnection();
    const originalListener = vi.fn();
    pc.addEventListener('datachannel', originalListener as never);

    // App removes the ORIGINAL listener — must resolve to the wrapped one.
    pc.removeEventListener('datachannel', originalListener as never);

    pc.fireDataChannel(mockChannel('remote'));

    expect(originalListener).not.toHaveBeenCalled();
    expect(pcInstance().dcListeners.get('datachannel')?.size ?? 0).toBe(0);
  });

  it('still fires the app listener when the channel arrives', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });

    const pc = new env.win.RTCPeerConnection();
    const originalListener = vi.fn();
    pc.addEventListener('datachannel', originalListener as never);

    pc.fireDataChannel(mockChannel('remote'));

    expect(originalListener).toHaveBeenCalledTimes(1);
    // One remote channel wrapped → capture state updated.
    const get = JSON.parse((await handlers.handleWebRtcGetEvents({})).content[0]!.text);
    expect(get.monitor.dataChannels).toBe(1);
  });
});
