/**
 * P0: browser_performance_observer / browser_resource_timing /
 * browser_cdp_performance_metrics / v8_type_profile tests.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCodeCollectorMock,
  createPageMock,
  parseJson,
} from '@tests/server/domains/shared/mock-factories';

const autoImport = async () => await import('@server/domains/browser/handlers/performance-tools');

type EvaluateFn = (pageFunction: unknown, ...args: unknown[]) => Promise<unknown>;

interface BaseResponse {
  success?: boolean;
  error?: string;
}

interface ObserverResponse extends BaseResponse {
  entryTypes?: string[];
  durationMs?: number;
  buffered?: boolean;
  entryCount?: number;
  entries?: unknown[];
}

interface ResourceTimingResponse extends BaseResponse {
  totalResources?: number;
  returned?: number;
  truncated?: boolean;
  urlFilter?: string | null;
  includeServerTiming?: boolean;
  totalTransferSize?: number;
  avgTtfbMs?: number | null;
  resources?: Array<Record<string, unknown>>;
}

interface CdpMetricsResponse extends BaseResponse {
  metricCount?: number;
  metrics?: Record<string, number>;
}

interface TypeProfileResponse extends BaseResponse {
  action?: string;
  scriptCount?: number;
  scripts?: Array<{
    scriptId: string;
    url: string;
    entryCount: number;
    totalTypes: number;
    topEntries: Array<{ offset: number; totalSamples: number; types: unknown[] }>;
  }>;
  artifactPath?: string;
}

function createCdpSessionMock(handlers: Record<string, () => unknown>): {
  send: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn(async (method: string) => {
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`Unexpected CDP method in mock: ${method}`);
      }
      return handler();
    }),
    detach: vi.fn(async () => {}),
  };
}

describe('P0: browser_performance_observer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fails when entryTypes is empty', async () => {
    const { handleBrowserPerformanceObserver } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<ObserverResponse>(
      await handleBrowserPerformanceObserver({ collector }, { entryTypes: [] }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('entryTypes');
  });

  it('collects entries from the in-page observer and reports defaults', async () => {
    const { handleBrowserPerformanceObserver } = await autoImport();
    const collected = [{ name: 'LCP', entryType: 'largest-contentful-paint', startTime: 120 }];
    const evaluate = vi.fn<EvaluateFn>(async () => collected);
    const collector = createCodeCollectorMock({
      getActivePage: vi.fn(async () => createPageMock({ evaluate })),
    });

    const res = parseJson<ObserverResponse>(
      await handleBrowserPerformanceObserver(
        { collector },
        { entryTypes: ['largest-contentful-paint', 'layout-shift'] },
      ),
    );

    expect(res.success).toBe(true);
    expect(res.entryCount).toBe(1);
    expect(res.entries).toEqual(collected);
    expect(res.entryTypes).toEqual(['largest-contentful-paint', 'layout-shift']);
    expect(res.durationMs).toBe(5000);
    expect(res.buffered).toBe(true);
    // evaluate is called with (fn, entryTypes, durationMs, buffered)
    expect(evaluate.mock.calls[0]?.[1]).toEqual(['largest-contentful-paint', 'layout-shift']);
    expect(evaluate.mock.calls[0]?.[2]).toBe(5000);
    expect(evaluate.mock.calls[0]?.[3]).toBe(true);
  });

  it('honours explicit durationMs / buffered=false arguments', async () => {
    const { handleBrowserPerformanceObserver } = await autoImport();
    const evaluate = vi.fn<EvaluateFn>(async () => []);
    const collector = createCodeCollectorMock({
      getActivePage: vi.fn(async () => createPageMock({ evaluate })),
    });

    await handleBrowserPerformanceObserver(
      { collector },
      { entryTypes: ['longtask'], durationMs: 250, buffered: false },
    );

    expect(evaluate.mock.calls[0]?.[2]).toBe(250);
    expect(evaluate.mock.calls[0]?.[3]).toBe(false);
  });

  it('fails when the active page does not support evaluate()', async () => {
    const { handleBrowserPerformanceObserver } = await autoImport();
    const res = parseJson<ObserverResponse>(
      await handleBrowserPerformanceObserver(
        { collector: { getActivePage: vi.fn(async () => null) } as never },
        { entryTypes: ['event'] },
      ),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('evaluate');
  });
});

describe('P0: browser_resource_timing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns resources with phase decomposition and aggregate stats', async () => {
    const { handleBrowserResourceTiming } = await autoImport();
    const resources = [
      {
        name: 'https://example.com/app.js',
        initiatorType: 'script',
        startTime: 10,
        duration: 300,
        transferSize: 1000,
        encodedBodySize: 900,
        decodedBodySize: 950,
        dns: 5,
        connect: 20,
        tls: 10,
        ttfb: 100,
        download: 200,
      },
      {
        name: 'https://example.com/style.css',
        initiatorType: 'link',
        startTime: 50,
        duration: 150,
        transferSize: 500,
        encodedBodySize: 450,
        decodedBodySize: 460,
        dns: 2,
        connect: 10,
        tls: 5,
        ttfb: 60,
        download: 90,
      },
    ];
    const evaluate = vi.fn<EvaluateFn>(async () => resources);
    const collector = createCodeCollectorMock({
      getActivePage: vi.fn(async () => createPageMock({ evaluate })),
    });

    const res = parseJson<ResourceTimingResponse>(
      await handleBrowserResourceTiming({ collector }, {}),
    );

    expect(res.success).toBe(true);
    expect(res.totalResources).toBe(2);
    expect(res.returned).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.totalTransferSize).toBe(1500);
    expect(res.avgTtfbMs).toBe(80);
    expect(res.resources?.[0]).toMatchObject({ name: 'https://example.com/app.js', ttfb: 100 });
    // urlPattern default '' → filter passed as ''
    expect(evaluate.mock.calls[0]?.[1]).toBe('');
    expect(evaluate.mock.calls[0]?.[2]).toBe(false);
  });

  it('applies urlPattern filter and truncates by limit', async () => {
    const { handleBrowserResourceTiming } = await autoImport();
    const resources = Array.from({ length: 5 }, (_, i) => ({
      name: `https://example.com/res-${i}.js`,
      transferSize: 100,
      ttfb: 10 + i,
    }));
    const evaluate = vi.fn<EvaluateFn>(async () => resources);
    const collector = createCodeCollectorMock({
      getActivePage: vi.fn(async () => createPageMock({ evaluate })),
    });

    const res = parseJson<ResourceTimingResponse>(
      await handleBrowserResourceTiming({ collector }, { urlPattern: 'EXAMPLE.com', limit: 2 }),
    );

    expect(res.success).toBe(true);
    expect(res.returned).toBe(2);
    expect(res.truncated).toBe(true);
    expect(res.urlFilter).toBe('EXAMPLE.com');
    // urlPattern is lowercased before passing into the page snippet
    expect(evaluate.mock.calls[0]?.[1]).toBe('example.com');
  });

  it('passes includeServerTiming through to the page snippet', async () => {
    const { handleBrowserResourceTiming } = await autoImport();
    const evaluate = vi.fn<EvaluateFn>(async () => []);
    const collector = createCodeCollectorMock({
      getActivePage: vi.fn(async () => createPageMock({ evaluate })),
    });

    await handleBrowserResourceTiming({ collector }, { includeServerTiming: true });

    expect(evaluate.mock.calls[0]?.[2]).toBe(true);
  });

  it('fails when the active page does not support evaluate()', async () => {
    const { handleBrowserResourceTiming } = await autoImport();
    const res = parseJson<ResourceTimingResponse>(
      await handleBrowserResourceTiming(
        { collector: { getActivePage: vi.fn(async () => null) } as never },
        {},
      ),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('evaluate');
  });
});

describe('P0: browser_cdp_performance_metrics', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns CDP Performance.getMetrics() as an object and detaches the session', async () => {
    const { handleBrowserCdpPerformanceMetrics } = await autoImport();
    const session = createCdpSessionMock({
      'Performance.enable': () => undefined,
      'Performance.getMetrics': () => ({
        metrics: [
          { name: 'LayoutCount', value: 42 },
          { name: 'RecalcStyleCount', value: 7 },
          { name: 'JSHeapUsedSize', value: 1048576 },
          { name: 'Nodes', value: 123 },
        ],
      }),
      'Performance.disable': () => undefined,
    });
    const page = { createCDPSession: vi.fn(async () => session) };
    const collector = { getActivePage: vi.fn(async () => page) } as never;

    const res = parseJson<CdpMetricsResponse>(
      await handleBrowserCdpPerformanceMetrics({ collector }, {}),
    );

    expect(res.success).toBe(true);
    expect(res.metricCount).toBe(4);
    expect(res.metrics).toEqual({
      LayoutCount: 42,
      RecalcStyleCount: 7,
      JSHeapUsedSize: 1048576,
      Nodes: 123,
    });
    expect(session.detach).toHaveBeenCalled();
  });

  it('fails when the active page does not support CDP sessions', async () => {
    const { handleBrowserCdpPerformanceMetrics } = await autoImport();
    const res = parseJson<CdpMetricsResponse>(
      await handleBrowserCdpPerformanceMetrics(
        { collector: { getActivePage: vi.fn(async () => null) } as never },
        {},
      ),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('CDP session');
  });
});

describe('P0: v8_type_profile', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('start enables the Profiler domain and starts type profiling', async () => {
    const { handleV8TypeProfile } = await autoImport();
    const session = createCdpSessionMock({
      'Profiler.enable': () => undefined,
      'Profiler.startTypeProfile': () => undefined,
    });
    const page = { createCDPSession: vi.fn(async () => session) };
    const collector = { getActivePage: vi.fn(async () => page) } as never;

    const res = parseJson<TypeProfileResponse>(
      await handleV8TypeProfile({ collector }, { action: 'start' }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe('started');
    expect(session.send).toHaveBeenCalledWith('Profiler.enable');
    expect(session.send).toHaveBeenCalledWith('Profiler.startTypeProfile');
    expect(session.detach).toHaveBeenCalled();
  });

  it('stop returns ranked per-script summaries and writes the raw profile to artifactPath', async () => {
    const { handleV8TypeProfile } = await autoImport();
    const session = createCdpSessionMock({
      'Profiler.takeTypeProfile': () => ({
        scripts: [
          {
            scriptId: '1',
            url: 'https://example.com/app.js',
            entries: [
              { offset: 0, types: [{ name: 'type:Array', count: 10 }] },
              { offset: 8, types: [{ name: 'type:number', count: 3 }] },
              { offset: 16, types: [{ name: 'type:Object', count: 5 }] },
              { offset: 24, types: [{ name: 'type:string', count: 1 }] },
            ],
          },
        ],
      }),
      'Profiler.stopTypeProfile': () => undefined,
      'Profiler.disable': () => undefined,
    });
    const page = { createCDPSession: vi.fn(async () => session) };
    const collector = { getActivePage: vi.fn(async () => page) } as never;

    const dir = mkdtempSync(join(tmpdir(), 'jshook-type-profile-'));
    const artifactPath = join(dir, 'type-profile.json');
    try {
      const res = parseJson<TypeProfileResponse>(
        await handleV8TypeProfile({ collector }, { action: 'stop', artifactPath, topN: 2 }),
      );

      expect(res.success).toBe(true);
      expect(res.action).toBe('stopped');
      expect(res.scriptCount).toBe(1);
      expect(res.scripts?.[0]?.url).toBe('https://example.com/app.js');
      expect(res.scripts?.[0]?.entryCount).toBe(4);
      expect(res.scripts?.[0]?.totalTypes).toBe(4);
      // topEntries ranked by sample count, capped by topN=2
      expect(res.scripts?.[0]?.topEntries).toHaveLength(2);
      expect(res.scripts?.[0]?.topEntries?.[0]?.offset).toBe(0);
      expect(res.scripts?.[0]?.topEntries?.[0]?.totalSamples).toBe(10);
      expect(res.artifactPath).toBe(artifactPath);

      const raw = JSON.parse(readFileSync(artifactPath, 'utf-8')) as {
        scripts: Array<{ scriptId: string }>;
      };
      expect(raw.scripts).toHaveLength(1);
      expect(raw.scripts[0]?.scriptId).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on an invalid action', async () => {
    const { handleV8TypeProfile } = await autoImport();
    const collector = createCodeCollectorMock();
    const res = parseJson<TypeProfileResponse>(
      await handleV8TypeProfile({ collector }, { action: 'pause' }),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('action');
  });
});
