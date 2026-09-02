/**
 * Resource-limit configuration for the webcrack worker pool.
 *
 * Webcrack runs Babel + isolated-vm over up-to-5MB inputs in a worker thread;
 * its pool must carry explicit old-gen / young-gen caps so a runaway run cannot
 * exhaust host memory (mirroring the heap-parse and crypto-harness pools).
 */
import { describe, expect, it, vi } from 'vitest';

const workerPoolCtor = vi.hoisted(() => vi.fn());

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: workerPoolCtor,
}));

import { getWebcrackPool } from '@modules/deobfuscator/webcrack-worker';

describe('webcrack worker pool resource limits', () => {
  it('constructs the pool with an old-gen + young-gen resourceLimits cap', () => {
    getWebcrackPool();
    expect(workerPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'webcrack',
        minWorkers: 1,
        maxWorkers: 2,
        resourceLimits: {
          maxOldGenerationSizeMb: 512,
          maxYoungGenerationSizeMb: 64,
        },
      }),
    );
  });
});
