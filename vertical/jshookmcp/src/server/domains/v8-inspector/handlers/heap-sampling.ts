/**
 * V8 Heap Sampling Handler — v8_heap_sampling
 *
 * Collects an allocation sampling profile via CDP HeapProfiler. Sampling is
 * lighter-weight than a full heap snapshot: V8 records allocation sites at a
 * configurable interval and aggregates them into a call tree of
 * self/total bytes. We start sampling, wait a capture window, stop, then
 * fetch the profile via `HeapProfiler.getSamplingProfile`.
 *
 * Requires browser/page CDP context.
 */

import { argNumber } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { SessionSource } from './cdp-session';

export interface SamplingNode {
  functionName: string;
  scriptId: string | number;
  url: string;
  lineNumber: number;
  columnNumber: number;
  selfSize: number;
  totalSize: number;
  sampleCount: number;
}

export interface HeapSamplingResult {
  success: boolean;
  error?: string;
  durationMs: number;
  totalSampledBytes: number;
  sampleCount: number;
  sites: SamplingNode[];
  summary: string;
}

export async function handleHeapSampling(
  args: Record<string, unknown>,
  source?: SessionSource,
): Promise<HeapSamplingResult> {
  const durationRaw = argNumber(args, 'durationMs', 5000);
  const durationMs = Math.min(
    60000,
    Math.max(500, Number.isFinite(durationRaw) ? durationRaw : 5000),
  );
  const topN = Math.min(500, Math.max(1, argNumber(args, 'topN', 50)));

  const { session, owned } = await resolveTargetSession(normalizeSessionSource(source));
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      durationMs: 0,
      totalSampledBytes: 0,
      sampleCount: 0,
      sites: [],
      summary: 'CDP session unavailable',
    };
  }

  const startTime = Date.now();
  try {
    await session.send('HeapProfiler.enable');
    await session.send('HeapProfiler.startSampling', { samplingInterval: 32768 });

    // Capture window — resolve after durationMs.
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

    const resp = await session.send<{
      profile?: {
        head?: SamplingProfileNode;
        samples?: Array<{ ordinal: number; stackTraces?: unknown }>;
      };
    }>('HeapProfiler.getSamplingProfile');

    await session.send('HeapProfiler.stopSampling').catch(() => undefined);

    const head = resp?.profile?.head;
    if (!head) {
      return {
        success: true,
        durationMs: Date.now() - startTime,
        totalSampledBytes: 0,
        sampleCount: 0,
        sites: [],
        summary: 'Sampling returned an empty profile (no allocations captured in window)',
      };
    }

    // Flatten the call tree into a sorted site list. Collect only nodes that
    // directly allocated (selfSize > 0); interior call-tree nodes are
    // traversal scaffolding, not allocation sites of interest.
    const sites: SamplingNode[] = [];
    const walk = (node: SamplingProfileNode): number => {
      const children = Array.isArray(node.children) ? node.children : [];
      const childTotal = children.reduce((sum, child) => sum + walk(child), 0);
      const selfSize = node.selfSize ?? 0;
      if (selfSize > 0) {
        const cf = node.callFrame ?? {};
        sites.push({
          functionName: cf.functionName ?? '(anonymous)',
          scriptId: cf.scriptId ?? '?',
          url: cf.url ?? '',
          lineNumber: cf.lineNumber ?? -1,
          columnNumber: cf.columnNumber ?? -1,
          selfSize,
          totalSize: selfSize + childTotal,
          sampleCount: node.identityGroups?.length ?? 0,
        });
      }
      return selfSize + childTotal;
    };
    const totalBytes = walk(head);

    sites.sort((a, b) => b.totalSize - a.totalSize);
    const top = sites.slice(0, topN);
    const sampleCount = sites.reduce((sum, s) => sum + s.sampleCount, 0);

    return {
      success: true,
      durationMs: Date.now() - startTime,
      totalSampledBytes: totalBytes,
      sampleCount,
      sites: top,
      summary: `${top.length} top allocation sites; ${totalBytes} bytes sampled across ${sites.length} nodes`,
    };
  } catch (err) {
    await session.send('HeapProfiler.stopSampling').catch(() => undefined);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
      totalSampledBytes: 0,
      sampleCount: 0,
      sites: [],
      summary: 'Sampling failed',
    };
  } finally {
    if (owned) await session.detach().catch(() => undefined);
  }
}

interface SamplingProfileCallFrame {
  functionName?: string;
  scriptId?: string | number;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface SamplingProfileNode {
  callFrame?: SamplingProfileCallFrame;
  selfSize?: number;
  children?: SamplingProfileNode[];
  identityGroups?: unknown[];
}
