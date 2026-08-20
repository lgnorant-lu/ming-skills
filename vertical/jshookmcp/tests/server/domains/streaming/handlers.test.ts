import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingToolHandlers } from '@server/domains/streaming/handlers';

describe('StreamingToolHandlers', () => {
  const session = {
    send: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    detach: vi.fn(),
  };
  const page = {
    createCDPSession: vi.fn(async () => session),
    evaluate: vi.fn(),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: StreamingToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new StreamingToolHandlers(collector);
  });

  it('validates ws monitor urlFilter regex', async () => {
    const body = parseJson(await handlers.handleWsMonitorEnable({ urlFilter: '[' }));
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(false);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.error).toContain('Invalid urlFilter regex');
  });

  it('enables ws monitor with sanitized config', async () => {
    const body = parseJson(
      await handlers.handleWsMonitorEnable({ maxFrames: 5, urlFilter: 'api' }),
    );
    expect(session.send).toHaveBeenCalledWith('Network.enable');
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.config.maxFrames).toBe(5);
  });

  it('validates ws payloadFilter regex on get frames', async () => {
    const body = parseJson(await handlers.handleWsGetFrames({ payloadFilter: '[' }));
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(false);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.error).toContain('Invalid payloadFilter regex');
  });

  it('filters ws frames by direction and pagination', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 1,
        direction: 'sent',
        opcode: 1,
        payloadLength: 3,
        payloadPreview: 'abc',
        payloadSample: 'abc',
        isBinary: false,
      },
    });
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 2,
        direction: 'received',
        opcode: 1,
        payloadLength: 4,
        payloadPreview: 'pong',
        payloadSample: 'pong',
        isBinary: false,
      },
    });

    const body = parseJson(
      await handlers.handleWsGetFrames({ direction: 'received', limit: 1, offset: 0 }),
    );
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.frames.length).toBe(1);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.frames[0].direction).toBe('received');
  });

  it('returns full ws payload only when requested', async () => {
    (handlers as any).wsFrameOrder.push({
      requestId: 'r1',
      frame: {
        requestId: 'r1',
        timestamp: 1,
        direction: 'sent',
        opcode: 1,
        payloadLength: 22,
        payloadPreview: '{"op":"preview"}',
        payloadSample: '{"op":"sample-secret"}',
        payload: '{"op":"complete-secret"}',
        isBinary: false,
      },
    });

    const previewBody = parseJson<any>(await handlers.handleWsGetFrames({}));
    expect(previewBody.frames[0]).not.toHaveProperty('payload');

    const fullBody = parseJson<any>(await handlers.handleWsGetFrames({ fullPayload: true }));
    expect(fullBody.filters.fullPayload).toBe(true);
    expect(fullBody.frames[0].payload).toBe('{"op":"complete-secret"}');
  });

  it('exposes ws connection timing and handshake metadata', async () => {
    (handlers as any).wsConnections.set('r1', {
      requestId: 'r1',
      url: 'wss://x',
      status: 'closed',
      framesCount: 8,
      createdTimestamp: 10,
      closedTimestamp: 14,
      handshakeStatus: 101,
    });

    const body = parseJson<any>(await handlers.handleWsGetConnections({}));
    expect(body.connections[0]).toMatchObject({
      requestId: 'r1',
      createdTimestamp: 10,
      closedTimestamp: 14,
      durationSeconds: 4,
      framesPerSecond: 2,
      handshakeStatus: 101,
    });
  });

  it('disables ws monitor and returns summary', async () => {
    await handlers.handleWsMonitorEnable({ maxFrames: 10 });
    (handlers as any).wsConnections.set('a', {
      requestId: 'a',
      url: 'wss://x',
      status: 'open',
      framesCount: 1,
      createdTimestamp: 1,
    });
    (handlers as any).wsFrameOrder.push({
      requestId: 'a',
      frame: {
        requestId: 'a',
        timestamp: 1,
        direction: 'sent',
        opcode: 1,
        payloadLength: 1,
        payloadPreview: 'x',
        payloadSample: 'x',
        isBinary: false,
      },
    });

    const body = parseJson(await handlers.handleWsMonitorDisable({}));
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(true);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.summary.totalFrames).toBeGreaterThan(0);
    expect(session.detach).toHaveBeenCalled();
  });

  it('validates sse monitor regex', async () => {
    const body = parseJson(await handlers.handleSseMonitorEnable({ urlFilter: '[' }));
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.success).toBe(false);
    // @ts-expect-error — auto-suppressed [TS18046]
    expect(body.error).toContain('Invalid urlFilter regex');
  });

  it('keeps wrapper responses un-nested for ws connection reads', async () => {
    const body = parseJson<any>(await handlers.handleWsGetConnectionsTool({}));
    expect(body.success).toBe(true);
    expect(body.connections).toEqual([]);
    expect(body.content).toBeUndefined();
  });

  it('turns thrown wrapper failures into structured errors', async () => {
    const failingHandlers = new StreamingToolHandlers({
      getActivePage: vi.fn().mockRejectedValue(new Error('no active page')),
    } as any);

    const body = parseJson<any>(await failingHandlers.handleWsMonitorDispatchTool({}));
    expect(body).toMatchObject({
      success: false,
      error: 'no active page',
      message: 'no active page',
    });
  });
});
