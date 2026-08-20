/**
 * Direct tests for WebRtcHandlers — data-channel capture via a mocked
 * RTCPeerConnection, with the injection serialized + run under node:vm.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import { WebRtcHandlers } from '@server/domains/streaming/handlers/webrtc-handlers';
import {
  createStreamingSharedState,
  type StreamingSharedState,
} from '@server/domains/streaming/handlers/shared';

/** A minimal RTCDataChannel mock: send() + message listener dispatch. */
function mockChannel(label: string) {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  return {
    label,
    readyState: 'open',
    listeners,
    send: vi.fn(function (this: unknown, _data: unknown) {}),
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

/** A minimal RTCPeerConnection mock: createDataChannel + addEventListener('datachannel'). */
function mockRTC() {
  const instances: Array<{
    dataChannels: ReturnType<typeof mockChannel>[];
    dcListeners: Array<(e: unknown) => void>;
  }> = [];
  class RTC {
    dataChannels: ReturnType<typeof mockChannel>[] = [];
    dcListeners: Array<(e: unknown) => void> = [];
    constructor() {
      instances.push(this);
    }
    createDataChannel = vi.fn((label: string) => {
      const ch = mockChannel(label);
      this.dataChannels.push(ch);
      return ch;
    });
    addEventListener = vi.fn((type: string, l: (e: unknown) => void) => {
      if (type === 'datachannel') this.dcListeners.push(l);
    });
    removeEventListener = vi.fn((type: string, l: (e: unknown) => void) => {
      if (type === 'datachannel') {
        this.dcListeners = this.dcListeners.filter((x) => x !== l);
      }
    });
    // fire a remote datachannel event to all listeners
    fireDataChannel(ch: ReturnType<typeof mockChannel>) {
      for (const l of this.dcListeners) l({ channel: ch });
    }
  }
  return { RTC, instances };
}

interface MockWindow {
  RTCPeerConnection: ReturnType<typeof mockRTC>['RTC'];
  __jshookWebRtcMonitor?: Record<string, unknown>;
}

function createState(): {
  state: StreamingSharedState;
  win: MockWindow;
  rtc: ReturnType<typeof mockRTC>;
  page: { evaluate: ReturnType<typeof vi.fn> };
} {
  const rtc = mockRTC();
  const win: MockWindow = { RTCPeerConnection: rtc.RTC };
  const page = { evaluate: vi.fn() };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);
  return { state, win, rtc, page };
}

function wireEvaluate(page: { evaluate: ReturnType<typeof vi.fn> }, win: MockWindow): void {
  page.evaluate.mockImplementation(async (pageFunction: unknown, arg: unknown) => {
    const serialized = `(${String(pageFunction)})`;
    const fn = runInNewContext(serialized, {
      window: win,
      ArrayBuffer: globalThis.ArrayBuffer,
    }) as (input: unknown) => unknown;
    return fn(arg);
  });
}

describe('WebRtcHandlers', () => {
  let env: ReturnType<typeof createState>;
  let handlers: WebRtcHandlers;

  beforeEach(() => {
    env = createState();
    wireEvaluate(env.page, env.win);
    handlers = new WebRtcHandlers(env.state);
  });

  it('captures outbound send() and inbound message on a created data channel', async () => {
    const enable = await handlers.handleWebRtcMonitorEnable({ action: 'enable' });
    expect(JSON.parse(enable.content[0]!.text).success).toBe(true);

    const pc = new env.win.RTCPeerConnection();
    const ch = pc.createDataChannel('chat');
    ch.send('ping');
    ch.dispatch('message', 'pong');

    const result = JSON.parse(
      (await handlers.handleWebRtcGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ label: 'chat', direction: 'sent', data: 'ping' });
    expect(result.events[1]).toMatchObject({ label: 'chat', direction: 'received', data: 'pong' });
  });

  it('captures remote channels arriving via the datachannel event', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });
    const pc = new env.win.RTCPeerConnection();
    pc.addEventListener('datachannel', () => {
      /* app handler */
    });
    const remoteCh = mockChannel('remote');
    pc.fireDataChannel(remoteCh);
    remoteCh.send('hello-from-remote');

    const result = JSON.parse(
      (await handlers.handleWebRtcGetEvents({ fullData: true })).content[0]!.text,
    );
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      label: 'remote',
      direction: 'sent',
      data: 'hello-from-remote',
    });
  });

  it('exposes monitor metadata (peerConnectionsSeen, dataChannels)', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });
    const pc1 = new env.win.RTCPeerConnection();
    pc1.createDataChannel('a');
    pc1.createDataChannel('b');
    const pc2 = new env.win.RTCPeerConnection(); // second PC for the peerConnectionsSeen count
    expect(pc2).toBeDefined();
    const result = JSON.parse((await handlers.handleWebRtcGetEvents({})).content[0]!.text);
    expect(result.monitor.peerConnectionsSeen).toBe(2);
    expect(result.monitor.dataChannels).toBe(2);
  });

  it('filters by label and direction', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });
    const pc = new env.win.RTCPeerConnection();
    const a = pc.createDataChannel('alpha');
    const b = pc.createDataChannel('beta');
    a.send('1');
    b.send('2');
    const byLabel = JSON.parse(
      (await handlers.handleWebRtcGetEvents({ label: 'alpha', fullData: true })).content[0]!.text,
    );
    expect(byLabel.events).toHaveLength(1);
    expect(byLabel.events[0].data).toBe('1');
    const byDir = JSON.parse(
      (await handlers.handleWebRtcGetEvents({ direction: 'received' })).content[0]!.text,
    );
    expect(byDir.events).toHaveLength(0);
  });

  it('rejects an invalid urlFilter', async () => {
    const result = JSON.parse(
      (await handlers.handleWebRtcMonitorEnable({ action: 'enable', urlFilter: '(' })).content[0]!
        .text,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid urlFilter regex/);
  });

  it('disable pauses capture (enabled=false)', async () => {
    await handlers.handleWebRtcMonitorEnable({ action: 'enable' });
    const result = JSON.parse(
      (await handlers.handleWebRtcMonitorDisable({ action: 'disable' })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    const mon = (env.win as unknown as Record<string, { enabled: boolean } | undefined>)[
      '__jshookWebRtcMonitor'
    ];
    expect(mon?.enabled).toBe(false);
  });
});
