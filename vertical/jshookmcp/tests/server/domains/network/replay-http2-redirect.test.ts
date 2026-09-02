/**
 * HTTP/2 redirect following in network_replay_request.
 *
 * The HTTP/1.1 path follows up to NETWORK_REPLAY_MAX_REDIRECTS 3xx responses;
 * the HTTP/2 path must behave identically (301/302/303 → GET + drop body,
 * 307/308 → preserve method/body).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replayRequest, clearHttp2SessionCache } from '@server/domains/network/replay';
import type { ReplayArgs } from '@server/domains/network/replay';

const lookupMock = vi.fn();
// Captures the pseudo-header map passed to each session.request() hop.
const requestCalls = vi.hoisted<{ value: Record<string, unknown>[] }>(() => ({ value: [] }));
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

vi.mock('node:http2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http2')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    connect: vi.fn(() => {
      const session = new EventEmitter() as import('node:http2').ClientHttp2Session;
      (session as any).close = vi.fn();
      (session as any).destroy = vi.fn();
      (session as any).request = vi.fn((hdrs: Record<string, unknown>) => {
        const request = new EventEmitter() as any;
        request.write = vi.fn();
        request.end = vi.fn(() => {
          // The current request is already pushed — hop = count - 1
          const hop = requestCalls.value.length - 1;
          if (hop === 0) {
            request.emit('response', { ':status': 301, location: 'https://example.com/next' });
            request.emit('data', Buffer.alloc(0));
          } else {
            request.emit('response', { ':status': 200, 'content-type': 'application/json' });
            request.emit('data', Buffer.from('{"ok":true}'));
          }
          request.emit('end');
        });
        requestCalls.value.push(hdrs);
        return request;
      });
      return session;
    }),
  };
});

// Public IP from TEST-NET-1 (RFC 5737)
const TEST_PUBLIC_IP = '93.184.216.34';

describe('replayRequest - HTTP/2 redirect handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestCalls.value = [];
    clearHttp2SessionCache();
  });

  it('follows HTTP/2 301 redirects and converts method/body to GET', async () => {
    lookupMock.mockResolvedValue([{ address: TEST_PUBLIC_IP, family: 4 }]);

    const base = {
      url: 'https://example.com/api/data',
      method: 'POST',
      headers: { 'user-agent': 'test', 'content-type': 'application/json' },
      postData: '{"x":1}',
      protocol: 'h2',
    };

    const args: ReplayArgs = {
      requestId: 'req-h2-redir',
      dryRun: false,
      authorization: {
        allowedHosts: ['example.com'],
      },
    };

    const result = await replayRequest(base, args);
    expect(result.dryRun).toBe(false);
    if (result.dryRun) return;
    expect(result.status).toBe(200);
    expect(result.body).toBe('{"ok":true}');
    expect(result.bodyTruncated).toBe(false);

    // Two hops issued; second hop method/body converted like the HTTP/1.1 path
    expect(requestCalls.value).toHaveLength(2);
    expect(requestCalls.value[0]![':method']).toBe('POST');
    expect(requestCalls.value[1]![':method']).toBe('GET');
    expect(requestCalls.value[1]![':path']).toBe('/next');
  });

  it('fails after exhausting redirects on the HTTP/2 path', async () => {
    lookupMock.mockResolvedValue([{ address: TEST_PUBLIC_IP, family: 4 }]);
    // Always answer 301 → loop must terminate with too-many-redirects
    const { EventEmitter } = await import('node:events');
    const http2Mock = (await import('node:http2')) as any;
    http2Mock.connect.mockImplementation(() => {
      const session = new EventEmitter() as any;
      session.close = vi.fn();
      session.destroy = vi.fn();
      session.request = vi.fn(() => {
        const request = new EventEmitter() as any;
        request.write = vi.fn();
        request.end = vi.fn(() => {
          request.emit('response', { ':status': 302, location: 'https://example.com/loop' });
          request.emit('data', Buffer.alloc(0));
          request.emit('end');
        });
        return request;
      });
      return session;
    });

    const base = {
      url: 'https://example.com/api/data',
      method: 'GET',
      headers: {},
      protocol: 'h2',
    };

    const args: ReplayArgs = {
      requestId: 'req-h2-loop',
      dryRun: false,
      authorization: {
        allowedHosts: ['example.com'],
      },
    };

    await expect(replayRequest(base, args)).rejects.toThrow(/too many redirects/);
  });
});
