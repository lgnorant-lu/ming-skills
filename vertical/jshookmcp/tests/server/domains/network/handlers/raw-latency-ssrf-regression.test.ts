import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dnsResolve: vi.fn(),
  resolveAuthorizedHostTarget: vi.fn(),
  resolveAuthorizedTransportTarget: vi.fn(),
  icmpProbe: vi.fn(),
  traceroute: vi.fn(),
  isIcmpAvailable: vi.fn(() => true),
  netCreateConnection: vi.fn(),
  tlsConnect: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({
  resolve: (...args: unknown[]) => state.dnsResolve(...args),
}));

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    createConnection: (...args: unknown[]) => state.netCreateConnection(...args),
  };
});

vi.mock('node:tls', async () => {
  const actual = await vi.importActual<typeof import('node:tls')>('node:tls');
  return {
    ...actual,
    connect: (...args: unknown[]) => state.tlsConnect(...args),
  };
});

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http');
  return {
    ...actual,
    request: (...args: unknown[]) => state.httpRequest(...args),
  };
});

vi.mock('node:https', async () => {
  const actual = await vi.importActual<typeof import('node:https')>('node:https');
  return {
    ...actual,
    request: (...args: unknown[]) => state.httpsRequest(...args),
  };
});

vi.mock('@server/domains/network/handlers/raw-helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@server/domains/network/handlers/raw-helpers')
  >('@server/domains/network/handlers/raw-helpers');
  return {
    ...actual,
    resolveAuthorizedTransportTarget: (...args: unknown[]) =>
      state.resolveAuthorizedTransportTarget(...args),
  };
});

vi.mock('@native/IcmpProbe', () => ({
  icmpProbe: (...args: unknown[]) => state.icmpProbe(...args),
  traceroute: (...args: unknown[]) => state.traceroute(...args),
  isIcmpAvailable: () => state.isIcmpAvailable(),
}));

import { RawLatencyHandlers } from '@server/domains/network/handlers/raw-latency-handlers';

function parseJson(response: { content: Array<{ type: string; text?: string }> }) {
  const text = response.content[0]?.text;
  if (typeof text !== 'string') throw new Error('Expected text response');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('GHSA-c5r6-m4mr-8q5j regression — SSRF bypass via ICMP probe and traceroute', () => {
  let handler: RawLatencyHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new RawLatencyHandlers();
    state.isIcmpAvailable.mockReturnValue(true);
  });

  describe('network_traceroute', () => {
    it('blocks direct private IP target (10.0.0.1)', async () => {
      const result = parseJson(
        await handler.handleNetworkTraceroute({ target: '10.0.0.1', maxHops: 5 }),
      );
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(String(result.error)).toContain('10.0.0.1');
      expect(state.traceroute).not.toHaveBeenCalled();
    });

    it('blocks loopback address 127.0.0.1', async () => {
      const result = parseJson(await handler.handleNetworkTraceroute({ target: '127.0.0.1' }));
      expect(result.success).toBe(true);
      expect(state.traceroute).toHaveBeenCalled();
    });

    it('blocks hostname resolving to private IP', async () => {
      state.dnsResolve.mockResolvedValue(['192.168.1.1']);
      const result = parseJson(
        await handler.handleNetworkTraceroute({ target: 'internal.corp.example' }),
      );
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(String(result.error)).toContain('192.168.1.1');
      expect(state.traceroute).not.toHaveBeenCalled();
    });

    it('allows public hostname resolving to public IP', async () => {
      state.dnsResolve.mockResolvedValue(['93.184.216.34']);
      state.traceroute.mockReturnValue({ hops: [{ ttl: 1, host: 'router' }] });
      const result = parseJson(await handler.handleNetworkTraceroute({ target: 'example.com' }));
      expect(result.success).toBe(true);
      expect(state.traceroute).toHaveBeenCalled();
    });
  });

  describe('network_icmp_probe', () => {
    it('blocks direct private IP target (10.0.0.1)', async () => {
      const result = parseJson(
        await handler.handleNetworkIcmpProbe({ target: '10.0.0.1', ttl: 64 }),
      );
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(String(result.error)).toContain('10.0.0.1');
      expect(state.icmpProbe).not.toHaveBeenCalled();
    });

    it('blocks 192.168.x.x', async () => {
      const result = parseJson(await handler.handleNetworkIcmpProbe({ target: '192.168.0.1' }));
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(state.icmpProbe).not.toHaveBeenCalled();
    });

    it('blocks 172.16.x.x (private range)', async () => {
      const result = parseJson(await handler.handleNetworkIcmpProbe({ target: '172.16.0.1' }));
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(state.icmpProbe).not.toHaveBeenCalled();
    });

    it('allows loopback 127.0.0.1', async () => {
      state.icmpProbe.mockReturnValue({ success: true, rttMs: 0.5 });
      const result = parseJson(await handler.handleNetworkIcmpProbe({ target: '127.0.0.1' }));
      expect(result.success).toBe(true);
      expect(state.icmpProbe).toHaveBeenCalledWith(
        expect.objectContaining({ target: '127.0.0.1' }),
      );
    });

    it('blocks hostname resolving to private IP', async () => {
      state.dnsResolve.mockResolvedValue(['10.0.0.50']);
      const result = parseJson(await handler.handleNetworkIcmpProbe({ target: 'secret.internal' }));
      expect(result.success).toBe(false);
      expect(String(result.error)).toContain('blocked');
      expect(String(result.error)).toContain('10.0.0.50');
      expect(state.icmpProbe).not.toHaveBeenCalled();
    });

    it('allows public hostname resolving to public IP', async () => {
      state.dnsResolve.mockResolvedValue(['93.184.216.34']);
      state.icmpProbe.mockReturnValue({ success: true, rttMs: 12.3 });
      const result = parseJson(
        await handler.handleNetworkIcmpProbe({ target: 'example.com', ttl: 64 }),
      );
      expect(result.success).toBe(true);
      expect(result.rttMs).toBe(12.3);
      expect(state.icmpProbe).toHaveBeenCalled();
    });
  });
});
