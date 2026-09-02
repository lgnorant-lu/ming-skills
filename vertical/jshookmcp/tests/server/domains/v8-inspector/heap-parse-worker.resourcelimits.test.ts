/**
 * Resource-limit configuration for the heap-parse worker pool.
 *
 * The heap-snapshot parser JSON.parse's GB-scale tracking snapshots in a worker
 * thread; its pool must carry explicit old-gen / young-gen caps (mirroring the
 * transform crypto-harness pool) so a runaway parse cannot exhaust host memory.
 */
import { describe, expect, it, vi } from 'vitest';

const workerPoolCtor = vi.hoisted(() => vi.fn());

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: workerPoolCtor,
}));

import { getHeapParsePool } from '@server/domains/v8-inspector/handlers/heap-parse-worker';

describe('heap parse worker pool resource limits', () => {
  it('constructs the pool with an old-gen + young-gen resourceLimits cap', () => {
    getHeapParsePool();
    expect(workerPoolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'heap-parse',
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
