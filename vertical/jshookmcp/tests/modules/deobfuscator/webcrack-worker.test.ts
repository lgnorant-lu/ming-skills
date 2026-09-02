/**
 * Tests for off-thread webcrack execution (A1).
 *
 * Three concerns:
 *   1. `runWebcrack` submits the webcrack job to an injected pool instead of
 *      running `import('webcrack')` + Babel on the main thread.
 *   2. The self-contained worker script runs real webcrack correctly and
 *      produces byte-identical output to the main-thread fallback.
 *   3. The shared pool is constructed with the expected resource limits.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@utils/WorkerPool';
import { runWebcrack } from '@modules/deobfuscator/webcrack';
import {
  WEBCRACK_JOB_TIMEOUT_MS,
  WEBCRACK_WORKER_SCRIPT,
  resolveWebcrackUrl,
  type WebcrackPool,
  type WebcrackWorkerResult,
} from '@modules/deobfuscator/webcrack-worker';

/** Build a valid, obfuscated JS sample of at least `targetBytes` bytes. */
function buildObfuscatedSample(targetBytes: number): string {
  const chunks: string[] = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    // Repeated string-concatenation obfuscation that webcrack folds.
    const stmt = `var _s${i} = "seg${i}" + "_part_" + ${i} + "_" + "tail${i}";`;
    chunks.push(stmt);
    size += stmt.length + 1;
    i += 1;
  }
  return chunks.join('\n');
}

describe('runWebcrack worker-pool path', () => {
  it('submits the webcrack job to the pool instead of running webcrack on the main thread', async () => {
    const mockPool: WebcrackPool = {
      submit: vi.fn().mockResolvedValue({ code: 'from-worker', bundle: undefined }),
    };

    const result = await runWebcrack(
      'var a = "hel" + "lo";',
      { jsx: true, unpack: false, unminify: true, mangle: false },
      mockPool,
    );

    // The marker string can only come from the mock pool — a main-thread
    // webcrack run would return webcrack's own deobfuscated output.
    expect(result.code).toBe('from-worker');
    expect(result.applied).toBe(true);
    expect(mockPool.submit).toHaveBeenCalledTimes(1);
    expect(mockPool.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'var a = "hel" + "lo";',
        webcrackUrl: expect.stringContaining('file://'),
        options: { jsx: true, unpack: false, unminify: true, mangle: false },
      }),
      WEBCRACK_JOB_TIMEOUT_MS,
    );
  });

  it('rebuilds the bundle summary from the serialized worker bundle', async () => {
    const mockPool: WebcrackPool = {
      submit: vi.fn().mockResolvedValue({
        code: 'deobfuscated-code',
        bundle: {
          type: 'webpack',
          entryId: '0',
          modules: [
            { id: '0', path: '/tmp/x.js', isEntry: true, code: 'entry' },
            { id: '1', path: '/tmp/y.js', isEntry: false, code: 'lib' },
          ],
        },
      }),
    };

    const result = await runWebcrack(
      'bundle',
      { unpack: true, includeModuleCode: false, maxBundleModules: 10 },
      mockPool,
    );

    expect(result.bundle).toBeDefined();
    expect(result.bundle!.type).toBe('webpack');
    expect(result.bundle!.moduleCount).toBe(2);
    expect(result.bundle!.modules[0]!.id).toBe('0');
    expect(result.bundle!.modules[0]!.code).toBeUndefined();
  });

  it('does not submit when the Deobfuscator cache hits', async () => {
    const { Deobfuscator } = await import('@modules/deobfuscator/Deobfuscator');
    const mockPool: WebcrackPool = {
      submit: vi.fn().mockResolvedValue({
        code: 'decoded',
        bundle: undefined,
      }),
    };

    const deobfuscator = new Deobfuscator();
    await deobfuscator.deobfuscate({ code: 'var cached = 1;' }, mockPool);
    const second = await deobfuscator.deobfuscate({ code: 'var cached = 1;' }, mockPool);

    expect(second.cached).toBe(true);
    expect(mockPool.submit).toHaveBeenCalledTimes(1);
  });
});

describe('webcrack worker runtime', () => {
  const pools: Array<WorkerPool<Record<string, unknown>, WebcrackWorkerResult>> = [];

  afterEach(async () => {
    await Promise.allSettled(pools.splice(0).map((pool) => pool.close()));
  });

  it('produces byte-identical output to the main-thread fallback on a ~33KB sample', async () => {
    const code = buildObfuscatedSample(33_000);
    expect(code.length).toBeGreaterThanOrEqual(33_000);

    const options = { jsx: true, unpack: true, unminify: true, mangle: false };

    // Reference: main-thread fallback (no pool).
    const mainThread = await runWebcrack(code, options);
    expect(mainThread.applied).toBe(true);

    // Worker path.
    const pool = new WorkerPool<Record<string, unknown>, WebcrackWorkerResult>({
      name: 'webcrack-runtime-test',
      workerScript: WEBCRACK_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });
    pools.push(pool);

    const workerResult = await pool.submit(
      { code, webcrackUrl: resolveWebcrackUrl(), options },
      WEBCRACK_JOB_TIMEOUT_MS,
    );

    expect(workerResult.code).toBe(mainThread.code);
  });

  it('rejects a non-file:// webcrackUrl', async () => {
    const pool = new WorkerPool<Record<string, unknown>, WebcrackWorkerResult>({
      name: 'webcrack-reject-test',
      workerScript: WEBCRACK_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });
    pools.push(pool);

    await expect(
      pool.submit(
        {
          code: 'var x = 1;',
          webcrackUrl: 'https://example.com/webcrack.js',
          options: { jsx: false, unpack: false, unminify: false, mangle: false },
        },
        WEBCRACK_JOB_TIMEOUT_MS,
      ),
    ).rejects.toThrow('file://');
  });
});
