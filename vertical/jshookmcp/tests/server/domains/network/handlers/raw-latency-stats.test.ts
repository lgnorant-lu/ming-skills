import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rawHelpers from '@server/domains/network/handlers/raw-helpers';
import { RawLatencyHandlers } from '@server/domains/network/handlers/raw-latency-handlers';

function parseJson(response: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function parseText(response: {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}) {
  return { text: response.content[0]?.text ?? '', isError: response.isError ?? false };
}

describe('RawLatencyHandlers — network_latency_stats', () => {
  let handler: RawLatencyHandlers;
  let rttSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    handler = new RawLatencyHandlers(undefined);
  });

  beforeEach(() => {
    vi.spyOn(rawHelpers, 'resolveAuthorizedTransportTarget').mockResolvedValue({
      url: new URL('http://example.com/'),
      target: { hostname: 'example.com', resolvedAddress: '93.184.216.34' },
      authorizationPolicy: undefined,
      allowLegacyLocalSsrf: false,
    } as never);
    rttSpy = vi.spyOn(handler, 'measureSingleRtt');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns latency stats with p50/p90/p95/p99', async () => {
    const rttValues = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    rttSpy.mockImplementation(async () => rttValues.shift()!);

    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      iterations: 10,
      concurrency: 5,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    const stats = json.stats as Record<string, number>;
    expect(stats.count).toBe(10);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(100);
    expect(stats.avgMs).toBe(55);
    expect(stats.p50Ms).toBe(60);
    expect(stats.p90Ms).toBe(100);
    expect(stats.p95Ms).toBe(100);
    expect(stats.p99Ms).toBe(100);
  });

  it('requires url', async () => {
    const res = await handler.handleNetworkLatencyStats({});
    const { text, isError } = parseText(res);
    expect(isError).toBe(true);
    expect(text).toContain('url is required');
  });

  it('rejects invalid probeType', async () => {
    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      probeType: 'invalid',
    });
    const { text, isError } = parseText(res);
    expect(isError).toBe(true);
    expect(text).toContain('Invalid probeType');
  });

  it('accepts numeric strings for iterations/concurrency/timeout via shared parsing', async () => {
    rttSpy.mockResolvedValue(25);

    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      iterations: '6',
      concurrency: '2',
      timeoutMs: '1500',
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(json.iterations).toBe(6);
    expect(json.concurrency).toBe(2);
    expect(rttSpy).toHaveBeenCalledTimes(6);
  });

  it('defaults probeType to http', async () => {
    rttSpy.mockResolvedValue(50);

    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      iterations: 5,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    const target = json.target as Record<string, unknown>;
    expect(target.probeType).toBe('http');
  });

  it('records errors for failed probes', async () => {
    rttSpy.mockRestore();
    rttSpy = vi.spyOn(handler, 'measureSingleRtt');
    const values = [50, null, 60, 70, 80];
    rttSpy.mockImplementation(async () => {
      const val = values.shift();
      if (val === null) throw new Error('timeout');
      return val!;
    });

    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      iterations: 5,
      concurrency: 1,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    const stats = json.stats as Record<string, number>;
    expect(stats.count).toBe(4);
    const errors = json.errors as string[];
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('timeout');
  });

  it('respects concurrency limit', async () => {
    rttSpy.mockResolvedValue(50);

    const res = await handler.handleNetworkLatencyStats({
      url: 'http://example.com',
      iterations: 6,
      concurrency: 2,
    });
    const json = parseJson(res);
    expect(json.success).toBe(true);
    expect(rttSpy).toHaveBeenCalledTimes(6);
  });
});
