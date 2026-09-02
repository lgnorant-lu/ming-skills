/**
 * Tests for off-thread string-array decoding (A3).
 *
 * Two concerns:
 *   1. `handleAnalysisDecodeStringArray` submits the decode job to an injected
 *      pool instead of running Babel parse/traverse/generate on the main thread.
 *   2. The self-contained worker script's inlined decode + derotate logic
 *      produces output identical to the main-thread handler.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@utils/WorkerPool';
import { handleAnalysisDecodeStringArray } from '@server/domains/analysis/handlers/deobfuscation';
import {
  DECODE_STRING_ARRAY_JOB_TIMEOUT_MS,
  DECODE_STRING_ARRAY_WORKER_SCRIPT,
  type DecodeStringArrayPool,
  type DecodeStringArrayWorkerResult,
} from '@modules/deobfuscator/decode-string-array-worker';
import { resolveBabelUrls } from '@modules/deobfuscator/babel-urls';

function parseJson(response: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('handleAnalysisDecodeStringArray worker-pool path', () => {
  it('submits the decode job to the pool instead of running Babel on the main thread', async () => {
    const mockPool: DecodeStringArrayPool = {
      submit: vi.fn().mockResolvedValue({
        success: true,
        code: 'decoded',
        replacedCount: 1,
        arraysFound: 1,
        rotationRemoved: false,
        replacements: [],
      }),
    };

    const res = await handleAnalysisDecodeStringArray({ code: 'var _0x = ["a"];' }, mockPool);
    const json = parseJson(res);

    expect(json.code).toBe('decoded');
    expect(mockPool.submit).toHaveBeenCalledTimes(1);
    expect(mockPool.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'var _0x = ["a"];',
        babelUrls: expect.objectContaining({ parser: expect.stringContaining('file://') }),
        maxReplacements: 200,
        removeRotation: true,
      }),
      DECODE_STRING_ARRAY_JOB_TIMEOUT_MS,
    );
  });
});

describe('decode string array worker runtime', () => {
  const pools: Array<WorkerPool<Record<string, unknown>, DecodeStringArrayWorkerResult>> = [];

  afterEach(async () => {
    await Promise.allSettled(pools.splice(0).map((pool) => pool.close()));
  });

  const fixtures: Array<{ name: string; code: string; expectedOriginals?: string[] }> = [
    {
      name: 'simple string array lookups',
      code: 'var _0x = ["alpha", "beta"];\nconsole.log(_0x(0), _0x("1"));',
      expectedOriginals: ['_0x(0)', '_0x("1")'],
    },
    {
      name: 'rotation IIFE derotation',
      code: '(function(){ var _0x = ["a", "b"]; while (true) { _0x.push(_0x.shift()); } })();\nvar arr = ["x", "y"];\nconsole.log(arr(0));',
      expectedOriginals: ['arr(0)'],
    },
  ];

  for (const fixture of fixtures) {
    it(`matches the main-thread handler for: ${fixture.name}`, async () => {
      const pool = new WorkerPool<Record<string, unknown>, DecodeStringArrayWorkerResult>({
        name: 'decode-string-array-runtime-test',
        workerScript: DECODE_STRING_ARRAY_WORKER_SCRIPT,
        minWorkers: 0,
        maxWorkers: 1,
        idleTimeoutMs: 1000,
      });
      pools.push(pool);

      const mainThreadJson = parseJson(
        await handleAnalysisDecodeStringArray({ code: fixture.code }),
      );

      const workerResult = await pool.submit(
        {
          code: fixture.code,
          babelUrls: resolveBabelUrls(),
          maxReplacements: 200,
          removeRotation: true,
        },
        DECODE_STRING_ARRAY_JOB_TIMEOUT_MS,
      );

      expect(workerResult.success).toBe(true);
      expect(workerResult.code).toBe(mainThreadJson.code);
      expect(workerResult.replacedCount).toBe(mainThreadJson.replacedCount);
      expect(workerResult.arraysFound).toBe(mainThreadJson.arraysFound);
      expect(workerResult.rotationRemoved).toBe(mainThreadJson.rotationRemoved);
      expect(workerResult.replacements).toEqual(mainThreadJson.replacements);

      // The `original` field must reflect the replaced call's source text in
      // the *derotated* code. When rotation is removed, slicing from the raw
      // input offsets misaligns and yields garbage — assert the exact text.
      if (fixture.expectedOriginals !== undefined) {
        expect((workerResult.replacements ?? []).map((r) => r.original)).toEqual(
          fixture.expectedOriginals,
        );
      }
    });
  }
});
