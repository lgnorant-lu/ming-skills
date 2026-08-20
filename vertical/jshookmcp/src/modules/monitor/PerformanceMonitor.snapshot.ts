import type { CDPSession } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import { isCDPHeapSnapshotChunkPayload } from './PerformanceMonitor.types';

/**
 * In-flight snapshots per CDP session. Without this, two concurrent
 * takeHeapSnapshot calls register overlapping chunk listeners on the same
 * session and each chunk is counted twice (and by the wrong snapshot).
 */
const activeSnapshots = new WeakMap<object, Promise<number>>();

export async function takeHeapSnapshot(cdp: CDPSession): Promise<number> {
  const inFlight = activeSnapshots.get(cdp);
  if (inFlight) {
    return inFlight;
  }

  const run = (async () => {
    await cdp.send('HeapProfiler.enable');

    let snapshotSize = 0;

    // Use a named handler so we can reliably remove it after the snapshot
    const chunkHandler = (params: unknown) => {
      if (!isCDPHeapSnapshotChunkPayload(params)) {
        return;
      }
      snapshotSize += params.chunk.length;
    };

    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunkHandler);

    try {
      await cdp.send('HeapProfiler.takeHeapSnapshot', {
        reportProgress: false,
        treatGlobalObjectsAsRoots: true,
      });
    } finally {
      // Always remove the listener to prevent accumulation across repeated calls
      cdp.off('HeapProfiler.addHeapSnapshotChunk', chunkHandler);
      await cdp.send('HeapProfiler.disable').catch(() => {});
    }

    logger.success('Heap snapshot taken', {
      size: snapshotSize,
    });

    return snapshotSize;
  })();

  activeSnapshots.set(cdp, run);
  try {
    return await run;
  } finally {
    activeSnapshots.delete(cdp);
  }
}
