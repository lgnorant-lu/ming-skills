/**
 * Direct tests for GrpcHandlers — live gRPC capture via a mocked CDP session.
 *
 * The mock session records handlers registered via .on() so the test can
 * synthesize Network events, and answers Network.getResponseBody /
 * getRequestPostData with canned gRPC-framed bodies.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GrpcHandlers } from '@server/domains/streaming/handlers/grpc-handlers';
import {
  createStreamingSharedState,
  type StreamingSharedState,
  type CdpEventHandler,
} from '@server/domains/streaming/handlers/shared';
import { buildGrpcBody } from '@server/domains/network/grpc-raw';

type AnyObj = Record<string, unknown>;

function createMockSession() {
  const listeners = new Map<string, CdpEventHandler[]>();
  const send = vi.fn(async (method: string, _params?: AnyObj): Promise<unknown> => {
    if (method === 'Network.enable') return {};
    if (method === 'Network.getResponseBody') {
      return { body: responseBodyBase64, base64Encoded: true };
    }
    if (method === 'Network.getRequestPostData') {
      return { postData: requestBodyBase64 };
    }
    return {};
  });
  return {
    listeners,
    send,
    session: {
      send,
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

// A two-message gRPC response body (base64): "Hello" then a compressed-flagged trailer.
const responseBodyBase64 = buildGrpcBody([
  { payloadHex: '48656c6c6f' },
  { payloadHex: '0a', isTrailer: true },
]).base64;
const requestBodyBase64 = buildGrpcBody([{ payloadHex: '0a03414243' }]).base64;

function createState(): {
  state: StreamingSharedState;
  session: ReturnType<typeof createMockSession>;
} {
  const session = createMockSession();
  const page = { createCDPSession: vi.fn(async () => session.session) };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as unknown as StreamingSharedState['collector'];
  const state = createStreamingSharedState(collector);
  return { state, session };
}

function emit(listeners: Map<string, CdpEventHandler[]>, event: string, params: AnyObj): void {
  for (const h of listeners.get(event) ?? []) h(params);
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('GrpcHandlers', () => {
  let env: ReturnType<typeof createState>;
  let handlers: GrpcHandlers;

  beforeEach(() => {
    env = createState();
    handlers = new GrpcHandlers(env.state);
  });

  it('captures a gRPC call end-to-end and parses response messages', async () => {
    const enable = JSON.parse(
      (await handlers.handleGrpcMonitorEnable({ action: 'enable' })).content[0]!.text,
    );
    expect(enable.success).toBe(true);

    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'req-1',
      request: {
        url: 'https://grpc-service/helloworld.Greeter/SayHello',
        method: 'POST',
        headers: { 'content-type': 'application/grpc' },
      },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'req-1',
      response: {
        url: 'https://grpc-service/helloworld.Greeter/SayHello',
        status: 200,
        mimeType: 'application/grpc',
        headers: { 'content-type': 'application/grpc' },
      },
    });
    emit(env.session.listeners, 'Network.loadingFinished', { requestId: 'req-1', timestamp: 2 });

    await flush();

    const result = JSON.parse(
      (await handlers.handleGrpcGetCalls({ fullMessages: true })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    expect(result.calls).toHaveLength(1);
    const call = result.calls[0];
    expect(call.method).toBe('POST');
    expect(call.status).toBe(200);
    expect(call.responseContentType).toBe('application/grpc');
    expect(call.responseMessageCount).toBe(2);
    expect(call.requestMessageCount).toBe(1);
    expect(call.hasTrailer).toBe(true);
    expect(call.responseMessages[0].payloadHex).toBe('48656c6c6f');
    expect(call.responseMessages[0].payloadBase64).toBe('SGVsbG8=');
  });

  it('ignores non-grpc responses', async () => {
    await handlers.handleGrpcMonitorEnable({ action: 'enable' });
    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'req-2',
      request: { url: 'https://grpc-service/rest', method: 'GET', headers: {} },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'req-2',
      response: {
        url: 'https://grpc-service/rest',
        status: 200,
        mimeType: 'application/json',
        headers: { 'content-type': 'application/json' },
      },
    });
    emit(env.session.listeners, 'Network.loadingFinished', { requestId: 'req-2', timestamp: 2 });
    await flush();
    const result = JSON.parse((await handlers.handleGrpcGetCalls({})).content[0]!.text);
    expect(result.calls).toHaveLength(0);
  });

  it('honors urlFilter (excludes non-matching gRPC calls)', async () => {
    await handlers.handleGrpcMonitorEnable({ action: 'enable', urlFilter: 'helloworld' });
    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'match',
      request: {
        url: 'https://grpc-service/helloworld.Greeter/SayHello',
        method: 'POST',
        headers: { 'content-type': 'application/grpc' },
      },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'match',
      response: {
        url: 'https://grpc-service/helloworld.Greeter/SayHello',
        status: 200,
        headers: { 'content-type': 'application/grpc' },
      },
    });
    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'nomatch',
      request: {
        url: 'https://grpc-service/other.Foo/Bar',
        method: 'POST',
        headers: { 'content-type': 'application/grpc' },
      },
      timestamp: 2,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'nomatch',
      response: {
        url: 'https://grpc-service/other.Foo/Bar',
        status: 200,
        headers: { 'content-type': 'application/grpc' },
      },
    });
    const result = JSON.parse((await handlers.handleGrpcGetCalls({})).content[0]!.text);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].requestId).toBe('match');
  });

  it('records bodyError when getResponseBody fails', async () => {
    env.session.send.mockImplementation(async (method: string) => {
      if (method === 'Network.getResponseBody')
        throw new Error('No resource with given identifier found');
      if (method === 'Network.enable') return {};
      return {};
    });
    await handlers.handleGrpcMonitorEnable({ action: 'enable' });
    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'req-err',
      request: {
        url: 'https://x/g.Foo/Bar',
        method: 'POST',
        headers: { 'content-type': 'application/grpc' },
      },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'req-err',
      response: {
        url: 'https://x/g.Foo/Bar',
        status: 200,
        headers: { 'content-type': 'application/grpc' },
      },
    });
    emit(env.session.listeners, 'Network.loadingFinished', { requestId: 'req-err', timestamp: 2 });
    await flush();
    const result = JSON.parse((await handlers.handleGrpcGetCalls({})).content[0]!.text);
    expect(result.calls[0].bodyError).toMatch(/No resource with given identifier/);
    expect(result.calls[0].responseMessageCount).toBe(0);
  });

  it('rejects an invalid urlFilter', async () => {
    const result = JSON.parse(
      (await handlers.handleGrpcMonitorEnable({ action: 'enable', urlFilter: '(' })).content[0]!
        .text,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid urlFilter regex/);
  });

  it('disable returns a summary and tears down the session', async () => {
    await handlers.handleGrpcMonitorEnable({ action: 'enable' });
    const result = JSON.parse(
      (await handlers.handleGrpcMonitorDisable({ action: 'disable' })).content[0]!.text,
    );
    expect(result.success).toBe(true);
    expect(result.summary.capturedCalls).toBe(0);
    expect(env.session.session.detach).toHaveBeenCalled();
    expect(env.state.grpcConfig.enabled).toBe(false);
  });

  it('default get_calls omits message payloads (fullMessages=false)', async () => {
    await handlers.handleGrpcMonitorEnable({ action: 'enable' });
    emit(env.session.listeners, 'Network.requestWillBeSent', {
      requestId: 'r',
      request: {
        url: 'https://x/g.Foo/Bar',
        method: 'POST',
        headers: { 'content-type': 'application/grpc' },
      },
      timestamp: 1,
    });
    emit(env.session.listeners, 'Network.responseReceived', {
      requestId: 'r',
      response: {
        url: 'https://x/g.Foo/Bar',
        status: 200,
        headers: { 'content-type': 'application/grpc' },
      },
    });
    emit(env.session.listeners, 'Network.loadingFinished', { requestId: 'r', timestamp: 2 });
    await flush();
    const result = JSON.parse((await handlers.handleGrpcGetCalls({})).content[0]!.text);
    expect(result.calls[0].responseMessageCount).toBe(2);
    expect(result.calls[0].responseMessages).toBeUndefined();
  });
});
