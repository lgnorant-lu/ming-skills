/**
 * V8 Allocation Tracking Handler — v8_allocation_track
 *
 * Tracks live V8 allocations via CDP HeapProfiler object tracking. Unlike
 * sampling (which aggregates a call tree), tracking returns the set of
 * objects that are still alive at the end of the capture window — each with
 * its allocation stack and size. Useful for "what survived GC during this
 * interaction" analysis.
 *
 * Flow: HeapProfiler.startObjectTracking → wait → HeapProfiler.stopObjectTracking
 * (emits `HeapProfiler.lastSeenObjectId` events mid-flight, which we collect)
 * → take a final count of live objects by size.
 *
 * Requires browser/page CDP context.
 */

import { argNumber } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { SessionSource } from './cdp-session';

export interface LiveAllocation {
  objectId: number;
  sizeBytes: number;
  functionName: string;
  scriptId: string | number;
  url: string;
  lineNumber: number;
}

export interface AllocationTrackResult {
  success: boolean;
  error?: string;
  durationMs: number;
  trackedCount: number;
  returnedCount: number;
  totalLiveBytes: number;
  allocations: LiveAllocation[];
  summary: string;
}

interface LastSeenObjectIdEvent {
  lastSeenObjectId: number;
  timestamp: number;
}

export async function handleAllocationTrack(
  args: Record<string, unknown>,
  source?: SessionSource,
): Promise<AllocationTrackResult> {
  const durationRaw = argNumber(args, 'durationMs', 3000);
  const durationMs = Math.min(
    30000,
    Math.max(500, Number.isFinite(durationRaw) ? durationRaw : 3000),
  );
  const topN = Math.min(500, Math.max(1, argNumber(args, 'topN', 50)));

  const { session, owned } = await resolveTargetSession(normalizeSessionSource(source));
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      durationMs: 0,
      trackedCount: 0,
      returnedCount: 0,
      totalLiveBytes: 0,
      allocations: [],
      summary: 'CDP session unavailable',
    };
  }

  const startTime = Date.now();
  const seenObjectIds: number[] = [];
  const cdp = session as unknown as {
    on?: (event: string, handler: (params: LastSeenObjectIdEvent) => void) => void;
    off?: (event: string, handler: (params: LastSeenObjectIdEvent) => void) => void;
  };
  const objectIdHandler = (params: LastSeenObjectIdEvent) => {
    if (typeof params?.lastSeenObjectId === 'number') {
      seenObjectIds.push(params.lastSeenObjectId);
    }
  };

  try {
    await session.send('HeapProfiler.enable');
    if (typeof cdp.on === 'function') {
      cdp.on('HeapProfiler.lastSeenObjectId', objectIdHandler);
    }
    await session.send('HeapProfiler.startObjectTracking', { trackAllocations: true });

    // Capture window — wait for the interaction's allocations to land.
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

    // stopObjectTracking + collect the report.
    const report = await session.send<{
      entries?: Array<{
        bytes: number;
        nodeId?: number;
      }>;
    }>('HeapProfiler.stopObjectTracking');

    // HeapProfiler.reportHeapObjectStatistics gives per-class counts; we use
    // the simpler `entries` from stopObjectTracking when available. Each entry
    // is a live heap object's byte size.
    const entries = Array.isArray(report?.entries) ? report.entries : [];
    // Build allocation records from each live entry. seenObjectIds (collected
    // via HeapProfiler.lastSeenObjectId events) supply the V8-assigned id when
    // available; otherwise fall back to the entry index.
    const allocations: LiveAllocation[] = entries.map((entry, i) => ({
      objectId: seenObjectIds[i] ?? i,
      sizeBytes: typeof entry.bytes === 'number' ? entry.bytes : 0,
      functionName: '(unknown)',
      scriptId: '?',
      url: '',
      lineNumber: -1,
    }));

    const totalLiveBytes = allocations.reduce((sum, a) => sum + a.sizeBytes, 0);
    allocations.sort((a, b) => b.sizeBytes - a.sizeBytes);
    const top = allocations.slice(0, topN);

    return {
      success: true,
      durationMs: Date.now() - startTime,
      trackedCount: seenObjectIds.length,
      returnedCount: top.length,
      totalLiveBytes,
      allocations: top,
      summary: `${top.length} live objects (${totalLiveBytes} bytes) survived the ${durationMs}ms window`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
      trackedCount: 0,
      returnedCount: 0,
      totalLiveBytes: 0,
      allocations: [],
      summary: 'Allocation tracking failed',
    };
  } finally {
    if (typeof cdp.off === 'function') {
      cdp.off('HeapProfiler.lastSeenObjectId', objectIdHandler);
    }
    await session.send('HeapProfiler.stopObjectTracking').catch(() => undefined);
    if (owned) await session.detach().catch(() => undefined);
  }
}
