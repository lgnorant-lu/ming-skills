import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@utils/network/ssrf-policy', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import {
  GRAPHQL_TRANSPORT_WS_PROTOCOL,
  GRAPHQL_WS_PROTOCOL,
  SubscribeHandlers,
  buildComplete,
  buildConnectionInit,
  buildSubscribe,
  normalizeFrameType,
  normalizeWsEndpoint,
  parseWsFrame,
} from '@server/domains/graphql/handlers/subscribe';
import type {
  SubscribeInPageInput,
  SubscribeInPageResult,
} from '@server/domains/graphql/handlers/subscribe';
import { TEST_URLS, TEST_WS_URLS, buildTestUrl, withPath } from '@tests/shared/test-urls';

const OK_ENDPOINT = withPath(TEST_URLS.root, 'graphql');

function parsePayload(response: unknown): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(response);
}

describe('graphql subscribe — pure helpers', () => {
  describe('normalizeFrameType', () => {
    it('passes through transport-ws canonical types', () => {
      for (const type of [
        'connection_init',
        'connection_ack',
        'connection_error',
        'complete',
        'ping',
        'pong',
      ] as const) {
        expect(normalizeFrameType(type)).toBe(type);
      }
    });

    it('maps legacy graphql-ws data → next', () => {
      expect(normalizeFrameType('data')).toBe('next');
    });

    it('maps legacy graphql-ws start → subscribe', () => {
      expect(normalizeFrameType('start')).toBe('subscribe');
    });

    it('maps legacy graphql-ws stop → complete', () => {
      expect(normalizeFrameType('stop')).toBe('complete');
    });

    it('maps connection_terminate → complete', () => {
      expect(normalizeFrameType('connection_terminate')).toBe('complete');
    });

    it('keeps next/error as canonical', () => {
      expect(normalizeFrameType('next')).toBe('next');
      expect(normalizeFrameType('error')).toBe('error');
    });

    it('returns unknown for unrecognised / missing types', () => {
      expect(normalizeFrameType('ka')).toBe('unknown');
      expect(normalizeFrameType(undefined)).toBe('unknown');
    });
  });

  describe('buildConnectionInit', () => {
    it('omits payload when none provided', () => {
      const frame = JSON.parse(buildConnectionInit());
      expect(frame).toEqual({ type: 'connection_init' });
    });

    it('includes payload when provided', () => {
      const frame = JSON.parse(buildConnectionInit({ Authorization: 'Bearer t' }));
      expect(frame).toEqual({
        type: 'connection_init',
        payload: { Authorization: 'Bearer t' },
      });
    });

    it('protocol-agnostic (same shape for legacy graphql-ws)', () => {
      const frame = JSON.parse(buildConnectionInit({ token: 'x' }));
      expect(frame.type).toBe('connection_init');
      expect(frame.payload).toEqual({ token: 'x' });
    });
  });

  describe('buildSubscribe', () => {
    it('uses subscribe type for graphql-transport-ws', () => {
      const frame = JSON.parse(
        buildSubscribe(GRAPHQL_TRANSPORT_WS_PROTOCOL, '1', { query: 'subscription { s }' }),
      );
      expect(frame).toEqual({
        id: '1',
        type: 'subscribe',
        payload: { query: 'subscription { s }' },
      });
    });

    it('uses start type for legacy graphql-ws', () => {
      const frame = JSON.parse(
        buildSubscribe(GRAPHQL_WS_PROTOCOL, '42', { query: 'subscription { s }' }),
      );
      expect(frame.type).toBe('start');
      expect(frame.id).toBe('42');
    });

    it('includes variables and operationName when provided', () => {
      const frame = JSON.parse(
        buildSubscribe(GRAPHQL_TRANSPORT_WS_PROTOCOL, '1', {
          query: 'subscription S($n: String!) { s(n: $n) }',
          variables: { n: 'x' },
          operationName: 'S',
        }),
      );
      expect(frame.payload).toEqual({
        query: 'subscription S($n: String!) { s(n: $n) }',
        variables: { n: 'x' },
        operationName: 'S',
      });
    });
  });

  describe('buildComplete', () => {
    it('uses complete type for graphql-transport-ws', () => {
      const frame = JSON.parse(buildComplete(GRAPHQL_TRANSPORT_WS_PROTOCOL, '1'));
      expect(frame).toEqual({ id: '1', type: 'complete' });
    });

    it('uses stop type for legacy graphql-ws', () => {
      const frame = JSON.parse(buildComplete(GRAPHQL_WS_PROTOCOL, '1'));
      expect(frame).toEqual({ id: '1', type: 'stop' });
    });
  });

  describe('parseWsFrame', () => {
    it('parses a valid frame', () => {
      expect(parseWsFrame('{"type":"next","id":"1","payload":{"data":{"x":1}}}')).toEqual({
        type: 'next',
        id: '1',
        payload: { data: { x: 1 } },
      });
    });

    it('parses a frame without payload', () => {
      expect(parseWsFrame('{"type":"connection_ack"}')).toEqual({
        type: 'connection_ack',
        id: undefined,
        payload: undefined,
      });
    });

    it('returns null for non-JSON input', () => {
      expect(parseWsFrame('not json')).toBeNull();
    });

    it('returns null for JSON array', () => {
      expect(parseWsFrame('[1,2,3]')).toBeNull();
    });

    it('returns null for empty input', () => {
      expect(parseWsFrame('')).toBeNull();
    });

    it('labels non-string type as unknown', () => {
      expect(parseWsFrame('{"type":42}')).toEqual({
        type: 'unknown',
        id: undefined,
        payload: undefined,
      });
    });
  });

  describe('normalizeWsEndpoint', () => {
    it('passes through ws://', () => {
      const wsUrl = buildTestUrl('host', { scheme: 'ws', path: 'graphql' });
      const result = normalizeWsEndpoint(wsUrl);
      expect(result).toEqual({
        wsUrl,
        httpEquiv: buildTestUrl('host', { scheme: 'http', path: 'graphql' }),
      });
    });

    it('passes through wss://', () => {
      const wssUrl = buildTestUrl('host', { scheme: 'wss', path: 'graphql' });
      const result = normalizeWsEndpoint(wssUrl);
      expect(result).toEqual({
        wsUrl: wssUrl,
        httpEquiv: buildTestUrl('host', { scheme: 'https', path: 'graphql' }),
      });
    });

    it('upgrades http:// → ws://', () => {
      const httpUrl = buildTestUrl('host', { scheme: 'http', path: 'graphql' });
      const result = normalizeWsEndpoint(httpUrl);
      expect(result).toMatchObject({
        wsUrl: buildTestUrl('host', { scheme: 'ws', path: 'graphql' }),
        httpEquiv: httpUrl,
      });
    });

    it('upgrades https:// → wss://', () => {
      const httpsUrl = buildTestUrl('host', { scheme: 'https', path: 'graphql' });
      const result = normalizeWsEndpoint(httpsUrl);
      expect(result).toMatchObject({
        wsUrl: buildTestUrl('host', { scheme: 'wss', path: 'graphql' }),
        httpEquiv: httpsUrl,
      });
    });

    it('rejects unsupported protocol', () => {
      const result = normalizeWsEndpoint(buildTestUrl('host', { scheme: 'ftp', path: 'graphql' }));
      expect('error' in result).toBe(true);
    });

    it('rejects empty endpoint', () => {
      const result = normalizeWsEndpoint('  ');
      expect('error' in result).toBe(true);
    });
  });
});

describe('SubscribeHandlers', () => {
  const page = {
    evaluate: vi.fn(),
    url: vi.fn(() => withPath(TEST_URLS.root, 'app')),
  };
  const collector = { getActivePage: vi.fn(async () => page) } as any;

  let handlers: SubscribeHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    page.url.mockReturnValue(withPath(TEST_URLS.root, 'app'));
    handlers = new SubscribeHandlers(collector);
  });

  // ── argument validation ──

  it('errors when endpoint is missing', async () => {
    const response = await handlers.handleGraphqlSubscribe({ query: 'subscription { s }' });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('Missing required argument: endpoint');
  });

  it('errors when query is missing', async () => {
    const response = await handlers.handleGraphqlSubscribe({ endpoint: OK_ENDPOINT });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('Missing required argument: query');
  });

  it('errors on unsupported endpoint protocol', async () => {
    const response = await handlers.handleGraphqlSubscribe({
      endpoint: buildTestUrl('host', { scheme: 'ftp', path: 'graphql' }),
      query: 'subscription { s }',
    });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('Unsupported endpoint protocol');
  });

  it('errors on SSRF target', async () => {
    isSsrfTargetMock.mockResolvedValueOnce(true);
    const response = await handlers.handleGraphqlSubscribe({
      endpoint: 'http://169.254.169.254/graphql',
      query: 'subscription { s }',
    });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('Blocked');
  });

  it('errors when collectMs + connectTimeoutMs exceeds the 30s evaluation ceiling', async () => {
    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { s }',
      collectMs: 20000,
      connectTimeoutMs: 10000,
    });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('headroom');
  });

  it('errors on invalid collectMs', async () => {
    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { s }',
      collectMs: 10,
    });
    expect((response as any).isError).toBe(true);
    expect(parsePayload(response).error).toContain('collectMs');
  });

  // ── successful collect (mocked in-page result) ──

  it('returns enriched envelope with connectionAck + canonicalType + stats on success', async () => {
    const inPageResult: SubscribeInPageResult = {
      error: null,
      frames: [
        { type: 'connection_init', direction: 'sent', timestamp: 1 },
        { type: 'connection_ack', direction: 'received', timestamp: 2 },
        { type: 'subscribe', id: '1', direction: 'sent', timestamp: 3 },
        {
          type: 'next',
          id: '1',
          payload: { data: { newMsg: { id: 1 } } },
          direction: 'received',
          timestamp: 4,
        },
        { type: 'complete', id: '1', direction: 'sent', timestamp: 5 },
      ],
    };
    page.evaluate.mockResolvedValueOnce(inPageResult);

    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { newMsg { id } }',
      collectMs: 500,
      connectTimeoutMs: 500,
    });

    const body = parsePayload(response);
    expect(body.success).toBe(true);
    expect(body.connectionAck).toBe(true);
    expect(body.endpoint).toBe(withPath(TEST_WS_URLS.root, 'graphql'));
    expect(body.protocol).toBe(GRAPHQL_TRANSPORT_WS_PROTOCOL);
    expect(body.stats).toEqual({ totalFrames: 5, nextFrames: 1, errorFrames: 0 });
    const frames = body.frames as Array<{ canonicalType: string }>;
    expect(frames.map((f) => f.canonicalType)).toEqual([
      'connection_init',
      'connection_ack',
      'subscribe',
      'next',
      'complete',
    ]);
    expect(body.data).toEqual([{ data: { newMsg: { id: 1 } } }]);
  });

  it('normalises legacy graphql-ws data frames into canonical next', async () => {
    const inPageResult: SubscribeInPageResult = {
      error: null,
      frames: [
        { type: 'connection_ack', direction: 'received', timestamp: 1 },
        { type: 'start', id: '1', direction: 'sent', timestamp: 2 },
        {
          type: 'data',
          id: '1',
          payload: { data: { tick: 1 } },
          direction: 'received',
          timestamp: 3,
        },
      ],
    };
    page.evaluate.mockResolvedValueOnce(inPageResult);

    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { tick }',
      protocol: GRAPHQL_WS_PROTOCOL,
      collectMs: 500,
      connectTimeoutMs: 500,
    });

    const body = parsePayload(response);
    expect(body.protocol).toBe(GRAPHQL_WS_PROTOCOL);
    expect(body.stats).toEqual({ totalFrames: 3, nextFrames: 1, errorFrames: 0 });
    const frames = body.frames as Array<{ canonicalType: string; type: string }>;
    const dataFrame = frames.find((f) => f.type === 'data');
    expect(dataFrame?.canonicalType).toBe('next');
  });

  it('surfaces graphqlErrors when error frames arrive', async () => {
    const inPageResult: SubscribeInPageResult = {
      error: null,
      frames: [
        { type: 'connection_ack', direction: 'received', timestamp: 1 },
        { type: 'subscribe', id: '1', direction: 'sent', timestamp: 2 },
        {
          type: 'error',
          id: '1',
          payload: [{ message: 'field "x" does not exist' }],
          direction: 'received',
          timestamp: 3,
        },
      ],
    };
    page.evaluate.mockResolvedValueOnce(inPageResult);

    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { x }',
      collectMs: 500,
      connectTimeoutMs: 500,
    });

    const body = parsePayload(response);
    expect(body.stats).toMatchObject({ errorFrames: 1 });
    expect(body.graphqlErrors).toEqual([[{ message: 'field "x" does not exist' }]]);
  });

  it('reports connectionAck=false when the in-page branch fails to ack', async () => {
    const inPageResult: SubscribeInPageResult = {
      error: 'Timed out waiting for connection_ack after 500ms',
      frames: [{ type: 'connection_init', direction: 'sent', timestamp: 1 }],
    };
    page.evaluate.mockResolvedValueOnce(inPageResult);

    const response = await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { s }',
      collectMs: 500,
      connectTimeoutMs: 500,
    });

    const body = parsePayload(response);
    expect(body.success).toBe(false);
    expect(body.connectionAck).toBe(false);
    expect(body.error).toContain('connection_ack');
  });

  it('passes the chosen protocol + connectionPayload through to the in-page input', async () => {
    page.evaluate.mockResolvedValueOnce({ error: null, frames: [] });

    await handlers.handleGraphqlSubscribe({
      endpoint: OK_ENDPOINT,
      query: 'subscription { s }',
      protocol: GRAPHQL_WS_PROTOCOL,
      connectionPayload: { Authorization: 'Bearer t' },
      variables: { n: 1 },
      operationName: 'S',
      collectMs: 500,
      connectTimeoutMs: 500,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    const [, input] = page.evaluate.mock.calls[0] as [unknown, SubscribeInPageInput];
    expect(input.protocols).toEqual([GRAPHQL_WS_PROTOCOL]);
    // init frame includes the connection payload
    expect(JSON.parse(input.initFrame).payload).toEqual({ Authorization: 'Bearer t' });
    // subscribe frame is the legacy 'start' type
    const subscribe = JSON.parse(input.subscribeFrame);
    expect(subscribe.type).toBe('start');
    expect(subscribe.payload).toEqual({
      query: 'subscription { s }',
      variables: { n: 1 },
      operationName: 'S',
    });
    // complete frame is the legacy 'stop' type
    expect(JSON.parse(input.completeFrame).type).toBe('stop');
  });
});
