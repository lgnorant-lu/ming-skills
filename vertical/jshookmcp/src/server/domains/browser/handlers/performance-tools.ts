/**
 * P0: atomic performance primitives — browser_performance_observer,
 * browser_resource_timing, browser_cdp_performance_metrics, v8_type_profile.
 *
 * Each handler is a single CDP / Web API primitive (no pipeline orchestration):
 * - observer: in-page PerformanceObserver subscription (buffered + live)
 * - resource timing: read-only Resource Timing API snapshot
 * - cdp metrics: CDP Performance.getMetrics()
 * - type profile: CDP Profiler.startTypeProfile / takeTypeProfile / stopTypeProfile
 */

import {
  argBool,
  argEnum,
  argNumber,
  argString,
  argStringArray,
} from '@server/domains/shared/parse-args';
import { handleSafe, R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';

// ── Shared structural guards (page abstraction: Puppeteer | Camoufox) ──

interface PerformanceToolsDeps {
  collector: {
    getActivePage(): Promise<unknown>;
  };
}

interface CDPSessionLike {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  detach(): Promise<void>;
}

interface CDPPageLike {
  createCDPSession(): Promise<CDPSessionLike>;
}

interface EvaluatePageLike {
  evaluate(pageFunction: unknown, ...args: unknown[]): Promise<unknown>;
}

interface TypeProfileEntry {
  offset: number;
  types: Array<{ name: string; count: number }>;
}

interface TypeProfileScript {
  scriptId: string;
  url: string;
  entries: TypeProfileEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCDPPageLike(value: unknown): value is CDPPageLike {
  return isRecord(value) && typeof value.createCDPSession === 'function';
}

function isEvaluatePageLike(value: unknown): value is EvaluatePageLike {
  return isRecord(value) && typeof value.evaluate === 'function';
}

// ── Handlers ──

/** browser_performance_observer — PerformanceObserver subscription (buffered + live). */
export async function handleBrowserPerformanceObserver(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const entryTypes = argStringArray(args, 'entryTypes');
    const durationMs = argNumber(args, 'durationMs', 5000);
    const buffered = argBool(args, 'buffered', true);

    if (entryTypes.length === 0) {
      return R.fail('entryTypes is required — at least one PerformanceObserver entry type').build();
    }

    const page = await deps.collector.getActivePage();
    if (!isEvaluatePageLike(page)) {
      throw new Error('Active page does not support evaluate()');
    }

    // One observer per type — PerformanceObserver.observe() accepts a single entry type.
    // Unsupported entry types (or entry types disabled) are skipped silently.
    const entries = await page.evaluate(
      (
        types: string[],
        ms: number,
        bufferedFlag: boolean,
      ): Promise<Array<Record<string, unknown>>> =>
        new Promise((resolve) => {
          const collected: Array<Record<string, unknown>> = [];
          const observers: PerformanceObserver[] = [];
          for (const type of types) {
            try {
              const obs = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  collected.push(entry.toJSON() as Record<string, unknown>);
                }
              });
              obs.observe({ type, buffered: bufferedFlag });
              observers.push(obs);
            } catch {
              // Unsupported entry type — skip.
            }
          }
          setTimeout(() => {
            for (const obs of observers) {
              obs.disconnect();
            }
            resolve(collected);
          }, ms);
        }),
      entryTypes,
      durationMs,
      buffered,
    );

    return {
      success: true,
      entryTypes,
      durationMs,
      buffered,
      entryCount: (entries as unknown[]).length,
      entries,
    };
  });
}

/** browser_resource_timing — Resource Timing API decomposition snapshot. */
export async function handleBrowserResourceTiming(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const urlPattern = argString(args, 'urlPattern', '');
    const includeServerTiming = argBool(args, 'includeServerTiming', false);
    const limit = argNumber(args, 'limit', 50);

    const page = await deps.collector.getActivePage();
    if (!isEvaluatePageLike(page)) {
      throw new Error('Active page does not support evaluate()');
    }

    const resources = (await page.evaluate(
      (filterLower: string, withServerTiming: boolean): Array<Record<string, unknown>> => {
        const out: Array<Record<string, unknown>> = [];
        for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
          const name = String(e.name ?? '');
          if (filterLower && !name.toLowerCase().includes(filterLower)) {
            continue;
          }
          const row: Record<string, unknown> = {
            name,
            initiatorType: e.initiatorType,
            startTime: e.startTime,
            duration: e.duration,
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
            dns: e.domainLookupEnd - e.domainLookupStart,
            connect: e.connectEnd - e.connectStart,
            tls: e.secureConnectionStart > 0 ? e.connectEnd - e.secureConnectionStart : null,
            ttfb: e.responseStart - e.requestStart,
            download: e.responseEnd - e.responseStart,
          };
          if (withServerTiming && e.serverTiming) {
            row.serverTiming = e.serverTiming.map((s) => ({
              name: s.name,
              duration: s.duration,
              description: s.description,
            }));
          }
          out.push(row);
        }
        return out;
      },
      urlPattern.toLowerCase(),
      includeServerTiming,
    )) as Array<Record<string, unknown>>;

    const limited = resources.slice(0, limit);
    const timed = limited.filter((r) => typeof r.ttfb === 'number' && r.ttfb >= 0);

    return {
      success: true,
      totalResources: resources.length,
      returned: limited.length,
      truncated: resources.length > limit,
      urlFilter: urlPattern || null,
      includeServerTiming,
      totalTransferSize: limited.reduce(
        (s, r) => s + (typeof r.transferSize === 'number' ? (r.transferSize as number) : 0),
        0,
      ),
      avgTtfbMs:
        timed.length > 0
          ? Math.round(timed.reduce((s, r) => s + (r.ttfb as number), 0) / timed.length)
          : null,
      resources: limited,
    };
  });
}

/** browser_cdp_performance_metrics — CDP Performance.getMetrics(). */
export async function handleBrowserCdpPerformanceMetrics(
  deps: PerformanceToolsDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const page = await deps.collector.getActivePage();
    if (!isCDPPageLike(page)) {
      throw new Error('Active page does not support CDP session creation');
    }

    const cdp = await page.createCDPSession();
    try {
      await cdp.send('Performance.enable');
      const result = await cdp.send<{ metrics?: Array<{ name: string; value: number }> }>(
        'Performance.getMetrics',
      );
      const metrics = result.metrics ?? [];
      const asObject: Record<string, number> = {};
      for (const m of metrics) {
        asObject[m.name] = m.value;
      }
      return { success: true, metricCount: metrics.length, metrics: asObject };
    } finally {
      await cdp.detach().catch(() => {
        // Session already detached — nothing to clean up.
      });
    }
  });
}

/** v8_type_profile — CDP Profiler type profiling (start / stop). */
export async function handleV8TypeProfile(
  deps: PerformanceToolsDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const action = argEnum(args, 'action', new Set(['start', 'stop'] as const));
    const artifactPath = argString(args, 'artifactPath', '');
    const topN = argNumber(args, 'topN', 20);

    const page = await deps.collector.getActivePage();
    if (!isCDPPageLike(page)) {
      throw new Error('Active page does not support CDP session creation');
    }

    const cdp = await page.createCDPSession();
    try {
      if (action === 'start') {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.startTypeProfile');
        return {
          success: true,
          action: 'started',
          message:
            'V8 type profiling started. Call v8_type_profile with action="stop" to collect results.',
        };
      }

      const profile = await cdp.send<{ scripts?: TypeProfileScript[] }>('Profiler.takeTypeProfile');
      await cdp.send('Profiler.stopTypeProfile');
      await cdp.send('Profiler.disable');

      const scripts = profile.scripts ?? [];
      const summaries = scripts.map((script) => ({
        scriptId: script.scriptId,
        url: script.url,
        entryCount: script.entries.length,
        totalTypes: script.entries.reduce((s, e) => s + e.types.length, 0),
        topEntries: [...script.entries]
          .map((e) => ({
            offset: e.offset,
            totalSamples: e.types.reduce((s, t) => s + t.count, 0),
            types: e.types,
          }))
          .toSorted((a, b) => b.totalSamples - a.totalSamples)
          .slice(0, topN),
      }));

      const result: Record<string, unknown> = {
        success: true,
        action: 'stopped',
        scriptCount: scripts.length,
        scripts: summaries,
      };

      if (artifactPath) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(artifactPath, JSON.stringify(profile, null, 2), 'utf-8');
        result.artifactPath = artifactPath;
      } else {
        const { resolveArtifactPath } = await import('@utils/artifacts');
        const { absolutePath, displayPath } = await resolveArtifactPath({
          category: 'profiles',
          toolName: 'type-profile',
          ext: 'json',
        });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(absolutePath, JSON.stringify(profile, null, 2), 'utf-8');
        result.artifactPath = displayPath;
      }

      return result;
    } finally {
      await cdp.detach().catch(() => {
        // Session already detached — nothing to clean up.
      });
    }
  });
}
