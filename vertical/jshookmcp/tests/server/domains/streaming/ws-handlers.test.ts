/**
 * Direct tests for the runtime WsHandlers module — ring-buffer eviction
 * accounting and regex compile guards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WsHandlers } from '@server/domains/streaming/handlers/ws-handlers';
import {
  createStreamingSharedState,
  compileRegex,
  type StreamingSharedState,
  type CdpEventHandler,
} from '@server/domains/streaming/handlers/shared';
import { WS_PAYLOAD_MAX_BYTES } from '@src/constants/streaming';

type AnyObj = Record<string, unknown>;

function createMockSession() {
  const listeners = new Map<string, CdpEventHandler[]>();
  return {
    listeners,
    session: {
      send: vi.fn(async () => ({})),
      on: vi.fn((event: string, handler: CdpEventHandler) => {
        const arr = listeners.get(event) ?? [];
        arr.push(handler);
        listeners.set(event, arr);
      }),
      off: vi.fn(),
      detach: vi.fn(async () => {}),
    },
  };
}

function emit(listeners: Map<string, CdpEventHandler[]>, event: string, params: AnyObj): void {
  for (const h of listeners.get(event) ?? []) h(params);
}

function createEnv() {
  const session = createMockSession();
  const page = { createCDPSession: vi.fn(async () => session.session) };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);
  return { state, session };
}

describe('WsHandlers', () => {
  let env: ReturnType<typeof createEnv>;
  let handlers: WsHandlers;

  beforeEach(() => {
    env = createEnv();
    handlers = new WsHandlers(env.state);
  });

  it('accounts for ring-buffer eviction in per-request buckets and frame counts', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 2 });

    emit(env.session.listeners, 'Network.webSocketCreated', {
      requestId: 'a',
      url: 'wss://host/a',
    });
    emit(env.session.listeners, 'Network.webSocketCreated', {
      requestId: 'b',
      url: 'wss://host/b',
    });
    const frame = (requestId: string, payloadData: string) => ({
      requestId,
      response: { opcode: 1, payloadData },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.webSocketFrameSent', frame('a', '1'));
    emit(env.session.listeners, 'Network.webSocketFrameSent', frame('b', '2'));
    emit(env.session.listeners, 'Network.webSocketFrameSent', frame('a', '3'));

    // Ring buffer capped at 2 — the first frame ('1') was evicted.
    expect(env.state.wsFrameOrder.length).toBe(2);
    // Evicted frame must be gone from its per-request bucket…
    expect(env.state.wsFramesByRequest.get('a')).toHaveLength(1);
    // …and the connection frame count must be decremented, not accumulated.
    expect(env.state.wsConnections.get('a')?.framesCount).toBe(1);
    expect(env.state.wsConnections.get('b')?.framesCount).toBe(1);
    const totalBucketed = Array.from(env.state.wsFramesByRequest.values()).reduce(
      (n, list) => n + list.length,
      0,
    );
    expect(totalBucketed).toBe(2);
  });

  it('keeps per-request buckets bounded under sustained traffic', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 5 });
    for (let i = 0; i < 100; i++) {
      emit(env.session.listeners, 'Network.webSocketFrameReceived', {
        requestId: 'a',
        response: { opcode: 1, payloadData: `frame-${i}` },
        timestamp: i,
      });
    }
    expect(env.state.wsFrameOrder.length).toBe(5);
    expect(env.state.wsFramesByRequest.get('a')).toHaveLength(5);
    expect(env.state.wsConnections.get('a')?.framesCount).toBe(5);
  });

  it('truncates oversized frame payloads to the byte budget and marks them', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 2 });
    emit(env.session.listeners, 'Network.webSocketCreated', {
      requestId: 'a',
      url: 'wss://host/a',
    });
    const big = 'x'.repeat(WS_PAYLOAD_MAX_BYTES + 100);
    emit(env.session.listeners, 'Network.webSocketFrameReceived', {
      requestId: 'a',
      response: { opcode: 1, payloadData: big },
      timestamp: 1,
    });

    const frame = env.state.wsFramesByRequest.get('a')![0]!;
    expect(frame.payloadLength).toBe(big.length);
    expect(frame.payloadTruncated).toBe(true);
    expect(Buffer.byteLength(frame.payload!, 'utf8')).toBeLessThanOrEqual(WS_PAYLOAD_MAX_BYTES);
    expect(frame.payload!.length).toBeLessThan(big.length);

    const result = JSON.parse(
      (await handlers.handleWsGetFrames({ fullPayload: true })).content[0]!.text,
    );
    expect(result.frames[0].payloadTruncated).toBe(true);
    expect(result.frames[0].payloadLength).toBe(big.length);
  });

  it('keeps small frame payloads untruncated', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 2 });
    emit(env.session.listeners, 'Network.webSocketCreated', {
      requestId: 'a',
      url: 'wss://host/a',
    });
    emit(env.session.listeners, 'Network.webSocketFrameReceived', {
      requestId: 'a',
      response: { opcode: 1, payloadData: 'small-frame' },
      timestamp: 1,
    });
    const frame = env.state.wsFramesByRequest.get('a')![0]!;
    expect(frame.payloadTruncated).toBeFalsy();
    expect(frame.payload).toBe('small-frame');
  });

  it('rejects catastrophic-backtracking urlFilter patterns before compiling', async () => {
    const compiled = compileRegex('(a+)+b');
    expect(compiled.regex).toBeUndefined();
    expect(compiled.error).toContain('catastrophic backtracking');
  });

  it('accepts plain patterns', async () => {
    const compiled = compileRegex('wss://api\\.example\\.com/stream');
    expect(compiled.error).toBeUndefined();
    expect(compiled.regex).toBeInstanceOf(RegExp);
  });
});
