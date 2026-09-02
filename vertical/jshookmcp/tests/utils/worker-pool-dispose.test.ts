/**
 * Dispose wiring for the four lazily-created deobfuscation / heap-parse worker
 * pools.
 *
 * Each pool module keeps a module-level shared `WorkerPool` singleton whose
 * `minWorkers: 1` warm worker is never idle-evicted (WorkerPool's idle timer
 * early-returns at the `minWorkers` floor). `closeServer()` therefore calls a
 * `dispose*Pool()` on each module to close the pool and reset the singleton.
 *
 * This test verifies that contract at the module level: dispose closes the
 * shared pool, resets the singleton (a fresh get constructs a new pool), and is
 * a safe no-op when the pool was never created.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctorState = vi.hoisted(() => {
  const instances: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  class MockWorkerPool {
    close = vi.fn(() => Promise.resolve());
    constructor() {
      instances.push(this);
    }
  }
  return { instances, MockWorkerPool };
});

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: ctorState.MockWorkerPool,
}));

import { disposeWebcrackPool, getWebcrackPool } from '@modules/deobfuscator/webcrack-worker';
import { disposeJscramblerPool, getJscramblerPool } from '@modules/deobfuscator/jscrambler-worker';
import {
  disposeDecodeStringArrayPool,
  getDecodeStringArrayPool,
} from '@modules/deobfuscator/decode-string-array-worker';
import {
  disposeHeapParsePool,
  getHeapParsePool,
} from '@server/domains/v8-inspector/handlers/heap-parse-worker';

async function disposeAll(): Promise<void> {
  await disposeWebcrackPool();
  await disposeJscramblerPool();
  await disposeDecodeStringArrayPool();
  await disposeHeapParsePool();
}

describe('worker pool dispose wiring', () => {
  beforeEach(async () => {
    // Reset module-level singletons + mock state for cross-test isolation.
    await disposeAll();
    ctorState.instances.length = 0;
  });

  it('closes each shared pool and resets the singleton on dispose', async () => {
    getWebcrackPool();
    getJscramblerPool();
    getDecodeStringArrayPool();
    getHeapParsePool();
    expect(ctorState.instances).toHaveLength(4);

    await disposeAll();

    for (const instance of ctorState.instances) {
      expect(instance.close).toHaveBeenCalledTimes(1);
    }

    // A fresh get constructs a new pool (the singleton was reset).
    getWebcrackPool();
    expect(ctorState.instances).toHaveLength(5);
  });

  it('is a safe no-op when a pool was never created', async () => {
    await disposeAll();
    expect(ctorState.instances).toHaveLength(0);
  });
});
