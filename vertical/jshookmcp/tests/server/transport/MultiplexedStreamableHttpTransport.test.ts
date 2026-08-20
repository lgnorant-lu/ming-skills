import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JSONRPCRequest, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';

const mocks = vi.hoisted(() => {
  const innerTransports: any[] = [];
  // When true, the next inner transport construction throws — simulates an
  // inner-transport setup failure after the admission hook claimed a lease.
  let failNextConstruct = false;

  return {
    innerTransports,
    get failNextConstruct() {
      return failNextConstruct;
    },
    set failNextConstruct(value: boolean) {
      failNextConstruct = value;
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
    public sessionId?: string;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onmessage?: (message: any, extra?: any) => void;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onerror?: (error: Error) => void;
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    public onclose?: () => void;
    public send = vi.fn(async () => undefined);
    public close = vi.fn(async () => undefined);
    public start = vi.fn(async () => undefined);
    public handleRequest = vi.fn(async (_req: any) => {
      if (!this.sessionId) {
        const requestedSessionId =
          _req?.headers?.['mcp-session-id'] && typeof _req.headers['mcp-session-id'] === 'string'
            ? _req.headers['mcp-session-id']
            : null;
        this.sessionId = requestedSessionId ?? this.sessionIdGenerator();
      }
    });

    constructor(private readonly options: { sessionIdGenerator: () => string }) {
      if (mocks.failNextConstruct) {
        throw new Error('inner transport construction failed');
      }
      mocks.innerTransports.push(this);
    }

    private sessionIdGenerator(): string {
      return this.options.sessionIdGenerator();
    }
  },
}));

import { MultiplexedStreamableHttpTransport } from '@server/transport/MultiplexedStreamableHttpTransport';

function createReq(method: string, sessionId?: string) {
  return {
    method,
    headers: sessionId ? { 'mcp-session-id': sessionId } : {},
  } as any;
}

function createRes() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any;
}

describe('MultiplexedStreamableHttpTransport', () => {
  beforeEach(() => {
    mocks.innerTransports.length = 0;
  });

  it('rejects repeated start calls', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await expect(transport.start()).rejects.toThrow(
      'MultiplexedStreamableHttpTransport already started',
    );
  });

  it('creates a new inner transport for new HTTP sessions and reuses existing ones by header', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    expect(mocks.innerTransports).toHaveLength(2);

    const existing = mocks.innerTransports[0];
    const existingSessionId = existing.sessionId;
    await transport.handleRequest(createReq('POST', existingSessionId), createRes(), {});
    expect(existing.handleRequest).toHaveBeenCalledTimes(2);
  });

  it('bounds initialized sessions before allocating another inner transport', async () => {
    const onSessionOpened = vi.fn(async () => undefined);
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      capacityRetryAfterMs: 2_500,
      onSessionOpened,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const admitted = mocks.innerTransports[0];
    expect(onSessionOpened).toHaveBeenCalledWith(admitted.sessionId);
    expect(transport.getStats()).toEqual({
      sessions: 1,
      sessionLimit: 1,
      sessionIdleTtlMs: null,
      inFlight: 0,
      pendingAdmissions: 0,
    });

    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});

    expect(mocks.innerTransports).toHaveLength(1);
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '3',
    });
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32001,
        data: {
          code: 'MCP_SESSION_CAPACITY',
          retryAfterMs: 2_500,
          sessionCount: 1,
          sessionLimit: 1,
        },
      },
    });

    admitted.onclose?.();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    expect(mocks.innerTransports).toHaveLength(2);
  });

  it('reserves capacity while asynchronous session admission is pending', async () => {
    let releaseAdmission!: () => void;
    const admissionGate = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    const onSessionOpened = vi.fn(async () => await admissionGate);
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      onSessionOpened,
    });
    await transport.start();

    const first = transport.handleRequest(createReq('POST'), createRes(), {});
    await vi.waitFor(() => {
      expect(onSessionOpened).toHaveBeenCalledOnce();
      expect(transport.getStats().pendingAdmissions).toBe(1);
    });

    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});
    expect(overloaded.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(JSON.parse(overloaded.end.mock.calls[0]![0])).toMatchObject({
      error: {
        data: {
          code: 'MCP_SESSION_CAPACITY',
          sessionCount: 1,
          pendingAdmissions: 1,
        },
      },
    });
    expect(mocks.innerTransports).toHaveLength(0);

    releaseAdmission();
    await first;
    expect(mocks.innerTransports).toHaveLength(1);
    expect(transport.getStats()).toMatchObject({ sessions: 1, pendingAdmissions: 0 });
  });

  it('fails initialization before the SDK responds when fleet admission is rejected', async () => {
    const onSessionOpened = vi.fn(async () => {
      throw Object.assign(new Error('worker lease capacity reached'), {
        code: 'BROWSER_FLEET_LEASE_CAPACITY',
        retryAfterMs: 2_500,
      });
    });
    const transport = new MultiplexedStreamableHttpTransport({ maxSessions: 1, onSessionOpened });
    await transport.start();

    const response = createRes();
    await transport.handleRequest(createReq('POST'), response, {});

    expect(mocks.innerTransports).toHaveLength(0);
    expect(response.writeHead).toHaveBeenCalledWith(503, {
      'Content-Type': 'application/json',
      'Retry-After': '3',
    });
    expect(JSON.parse(response.end.mock.calls[0]![0])).toMatchObject({
      error: {
        code: -32002,
        data: {
          code: 'BROWSER_FLEET_LEASE_CAPACITY',
          retryAfterMs: 2_500,
        },
      },
    });
    expect(transport.getStats()).toMatchObject({ sessions: 0, pendingAdmissions: 0 });
  });

  it('expires idle sessions and admits replacement transports', async () => {
    let now = 0;
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
      onSessionClosed,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const expired = mocks.innerTransports[0];

    now = 101;
    await transport.handleRequest(createReq('POST'), createRes(), {});

    expect(expired.close).toHaveBeenCalledOnce();
    expect(onSessionClosed).toHaveBeenCalledWith(expired.sessionId);
    expect(mocks.innerTransports).toHaveLength(2);
    expect(transport.getStats()).toMatchObject({ sessions: 1, sessionIdleTtlMs: 100 });

    now = 202;
    const expiredResponse = createRes();
    const currentSession = mocks.innerTransports[1];
    await transport.handleRequest(createReq('POST', currentSession.sessionId), expiredResponse, {});
    expect(expiredResponse.writeHead).toHaveBeenCalledWith(404, {
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(expiredResponse.end.mock.calls[0]![0])).toMatchObject({
      error: { data: { code: 'MCP_SESSION_EXPIRED' } },
    });
  });

  it('does not evict a session while one of its requests is in flight', async () => {
    let now = 0;
    const transport = new MultiplexedStreamableHttpTransport({
      maxSessions: 1,
      sessionIdleTtlMs: 100,
      now: () => now,
    });
    await transport.start();
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.handleRequest.mockImplementationOnce(async () => await gate);

    now = 90;
    const active = transport.handleRequest(createReq('POST', session.sessionId), createRes(), {});
    await vi.waitFor(() => expect(transport.getStats().inFlight).toBe(1));
    now = 200;
    const overloaded = createRes();
    await transport.handleRequest(createReq('POST'), overloaded, {});

    expect(overloaded.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(session.close).not.toHaveBeenCalled();
    release();
    await active;
  });

  it('routes same client request ids from different sessions back to the correct inner transport', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => {
      seenMessages.push(message);
    };

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});

    const sessionA = mocks.innerTransports[0];
    const sessionB = mocks.innerTransports[1];

    const requestA: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };
    const requestB: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    sessionA.onmessage?.(requestA, {});
    sessionB.onmessage?.(requestB, {});

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[0]!.id).not.toBe(seenMessages[1]!.id);
    expect(seenMessages[0]!.params._meta.sessionId).toBe(sessionA.sessionId);
    expect(seenMessages[1]!.params._meta.sessionId).toBe(sessionB.sessionId);

    const responseA: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: seenMessages[0]!.id,
      result: { ok: true },
    };
    const responseB: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: seenMessages[1]!.id,
      result: { ok: true },
    };

    await transport.send(responseA);
    await transport.send(responseB);

    expect(sessionA.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      },
      undefined,
    );
    expect(sessionB.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        id: 1,
        result: { ok: true },
      },
      undefined,
    );
  });

  it('preserves client request metadata while enforcing the transport session id', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => seenMessages.push(message);

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'search_tools',
        arguments: {},
        _meta: { progressToken: 'p1', sessionId: 'spoofed' },
      },
    });

    expect(seenMessages[0]!.params._meta).toEqual({
      progressToken: 'p1',
      sessionId: session.sessionId,
    });
  });

  it('rewrites cancellation notifications back onto internal request ids', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const seenMessages: any[] = [];

    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onmessage = (message) => {
      seenMessages.push(message);
    };

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
    } satisfies JSONRPCRequest);

    session.onmessage?.({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: {
        requestId: 9,
      },
    });

    expect(seenMessages).toHaveLength(2);
    expect(seenMessages[0]!.id).toBeTypeOf('string');
    expect(seenMessages[1]).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: {
        requestId: seenMessages[0]!.id,
      },
    });
  });

  it('returns a json-rpc 404 for unknown session headers', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();
    const res = createRes();

    await transport.handleRequest(createReq('POST', 'missing-session'), res, {});

    expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unknown MCP session: missing-session',
        },
        id: null,
      }),
    );
  });

  it('broadcasts notifications and rejects ambiguous outbound requests', async () => {
    const transport = new MultiplexedStreamableHttpTransport();
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    await transport.handleRequest(createReq('POST'), createRes(), {});
    const [sessionA, sessionB] = mocks.innerTransports;

    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });

    expect(sessionA.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );
    expect(sessionB.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/message',
      },
      undefined,
    );

    await expect(
      transport.send({
        jsonrpc: '2.0',
        id: 'server-request',
        method: 'tools/list',
      }),
    ).rejects.toThrow('Ambiguous HTTP session for outbound request/response routing.');
  });

  it('releases the admission claim when inner transport construction fails', async () => {
    const onSessionClosed = vi.fn();
    const onSessionOpened = vi.fn(async () => undefined);
    const transport = new MultiplexedStreamableHttpTransport({ onSessionOpened, onSessionClosed });
    await transport.start();

    mocks.failNextConstruct = true;
    try {
      await expect(transport.handleRequest(createReq('POST'), createRes(), {})).rejects.toThrow(
        'inner transport construction failed',
      );
    } finally {
      mocks.failNextConstruct = false;
    }

    // The admission hook claimed a fleet lease (admissionClaimed=true), so the
    // failure must still release it — otherwise the lease leaks.
    expect(onSessionOpened).toHaveBeenCalledOnce();
    expect(onSessionClosed).toHaveBeenCalledWith(expect.any(String));
    expect(transport.getStats().pendingAdmissions).toBe(0);
  });

  it('routes by relatedRequestId and clears session state on close', async () => {
    const onSessionClosed = vi.fn();
    const transport = new MultiplexedStreamableHttpTransport({ onSessionClosed });
    const onclose = vi.fn();
    // eslint-disable-next-line unicorn/prefer-add-event-listener
    transport.onclose = onclose;
    await transport.start();

    await transport.handleRequest(createReq('POST'), createRes(), {});
    const session = mocks.innerTransports[0];
    session.onmessage?.({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
    } satisfies JSONRPCRequest);

    const internalId = `http:${session.sessionId}:1`;
    await transport.send(
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
      },
      { relatedRequestId: internalId },
    );

    expect(session.send).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'notifications/progress',
      },
      { relatedRequestId: 5 },
    );

    session.onclose?.();
    expect(onSessionClosed).toHaveBeenCalledWith(session.sessionId);
    await transport.close();
    expect(onclose).toHaveBeenCalledOnce();
  });
});
