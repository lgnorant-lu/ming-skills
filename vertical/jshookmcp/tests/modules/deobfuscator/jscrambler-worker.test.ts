/**
 * Tests for off-thread JScrambler deobfuscation (A2).
 *
 * Three concerns:
 *   1. `JScramblerDeobfuscator.deobfuscate` submits the job to an injected pool
 *      instead of running Babel on the main thread.
 *   2. The worker loads the shared `jscrambler-core` module (single source of
 *      truth) and produces output identical to both the main-thread class and a
 *      direct core invocation on the existing fixtures.
 *   3. The worker's injected log collector returns the core's log entries so the
 *      off-thread path no longer drops logger instrumentation.
 */

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@utils/WorkerPool';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import {
  createJscramblerCore,
  type JscramblerCoreBabel,
} from '@modules/deobfuscator/jscrambler-core';
import {
  JSCRAMBLER_JOB_TIMEOUT_MS,
  JSCRAMBLER_WORKER_SCRIPT,
  resolveJscramblerCoreUrl,
  type JscramblerPool,
  type JscramblerWorkerResult,
} from '@modules/deobfuscator/jscrambler-worker';
import { resolveBabelUrls } from '@modules/deobfuscator/babel-urls';

interface JscramblerFixture {
  name: string;
  code: string;
  options: Record<string, unknown>;
  expectedTransformations?: string[];
  expectedWarning?: string;
  expectedSuccess?: boolean;
  expectedCodeContains?: string[];
  expectedCodeNotContains?: string[];
}

const FIXTURES: JscramblerFixture[] = [
  {
    name: 'self-defending debugger',
    code: `
function guard(){ debugger; return 1; }
setInterval(function(){ debugger; }, 1000);
guard();
`,
    options: {},
    expectedTransformations: ['Removed self-defending code'],
  },
  {
    name: 'unresolvable decrypt call left in place',
    code: `
function dec(s){ return s.split('').map(c=>String.fromCharCode(c.charCodeAt(0))).join(''); }
const value = dec("abc");
`,
    options: { decryptStrings: true },
    expectedTransformations: [],
    expectedWarning: 'decrypt',
  },
  {
    name: 'while-switch control-flow pattern (unresolvable)',
    code: `
while (true) {
  switch (state) {
    case 0: a(); break;
    case 1: b(); break;
  }
}
`,
    options: { restoreControlFlow: true },
    expectedTransformations: [],
    expectedWarning: 'control-flow',
  },
  {
    name: 'dead branch + arithmetic simplification',
    code: `
if (false) { drop(); } else { keep(); }
const n = 2 + 3;
`,
    options: {},
    expectedTransformations: ['Removed 1 dead branches', 'Simplified 1 expressions'],
  },
  {
    name: 'parse failure',
    code: 'function broken( {',
    options: {},
    expectedTransformations: [],
    expectedSuccess: false,
  },
  {
    name: 'successful static decryption (evalCall branch coverage)',
    code: `
const dec = (s) => String.fromCharCode(s.charCodeAt(0) + 1);
function dec2(s) {
  return s.substring(0, 2) + s.substr(1, 2) + s.slice(0, 1) +
    s.concat('_') + s.indexOf('a') + s.toLowerCase() +
    s.replace('a', 'z') + s.split('')[0] +
    String.fromCharCode(s.charCodeAt(0)) +
    parseInt('10', 10) + Number('2');
}
var _s = ["alpha", "beta"];
function idx(i) { return _s[i]; }
const a = dec("a");
const b = dec2("abc");
const c = idx(1);
`,
    options: {},
    expectedTransformations: ['Decrypted 3 strings'],
    expectedCodeContains: ['"b"', '"beta"'],
  },
  {
    name: 'while-switch linearizable (success path)',
    code: `
var state = 0;
while (true) {
  switch (state) {
    case 0: foo(); state = 1; break;
    case 1: bar(); break;
  }
}
`,
    options: { restoreControlFlow: true },
    expectedTransformations: ['Restored 1 control-flow patterns'],
    expectedCodeNotContains: ['while', 'switch'],
  },
];

const CORE_BABEL: JscramblerCoreBabel = { parser, traverse, generate, types: t };
const core = createJscramblerCore(CORE_BABEL);

describe('JScramblerDeobfuscator worker-pool path', () => {
  it('submits the deobfuscation job to the pool instead of running Babel on the main thread', async () => {
    const mockPool: JscramblerPool = {
      submit: vi.fn().mockResolvedValue({
        code: 'from-worker',
        success: true,
        transformations: [],
        warnings: [],
        confidence: 0,
      }),
    };

    const result = await new JScramberDeobfuscator().deobfuscate(
      { code: 'obfuscated()' },
      mockPool,
    );

    expect(result.code).toBe('from-worker');
    expect(mockPool.submit).toHaveBeenCalledTimes(1);
    expect(mockPool.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'obfuscated()',
        babelUrls: expect.objectContaining({
          parser: expect.stringContaining('file://'),
        }),
        coreUrl: expect.stringContaining('file://'),
        options: {
          removeDeadCode: true,
          restoreControlFlow: true,
          decryptStrings: true,
          simplifyExpressions: true,
        },
      }),
      JSCRAMBLER_JOB_TIMEOUT_MS,
    );
  });

  it('replays worker-collected logs through the main-thread logger and strips them from the result', async () => {
    const mockPool: JscramblerPool = {
      submit: vi.fn().mockResolvedValue({
        code: 'from-worker',
        success: true,
        transformations: [],
        warnings: [],
        confidence: 0,
        logs: [
          { level: 'info', message: ' JScrambler...' },
          {
            level: 'info',
            message: 'JScrambler deobfuscation complete, 0 transformations applied',
          },
        ],
      }),
    };

    const result = await new JScramberDeobfuscator().deobfuscate(
      { code: 'obfuscated()' },
      mockPool,
    );

    expect(result).not.toHaveProperty('logs');
    expect(result.code).toBe('from-worker');
  });
});

describe('jscrambler worker runtime', () => {
  const pools: Array<WorkerPool<Record<string, unknown>, JscramblerWorkerResult>> = [];

  afterEach(async () => {
    await Promise.allSettled(pools.splice(0).map((pool) => pool.close()));
  });

  for (const fixture of FIXTURES) {
    it(`matches the main-thread class and the shared core for: ${fixture.name}`, async () => {
      const pool = new WorkerPool<Record<string, unknown>, JscramblerWorkerResult>({
        name: 'jscrambler-runtime-test',
        workerScript: JSCRAMBLER_WORKER_SCRIPT,
        minWorkers: 0,
        maxWorkers: 1,
        idleTimeoutMs: 1000,
      });
      pools.push(pool);

      const mainThread = await new JScramberDeobfuscator().deobfuscate({ code: fixture.code });
      const coreResult = core.deobfuscate(fixture.code, {
        removeDeadCode: true,
        restoreControlFlow: true,
        decryptStrings: true,
        simplifyExpressions: true,
      });

      const workerResult = await pool.submit(
        {
          code: fixture.code,
          babelUrls: resolveBabelUrls(),
          coreUrl: resolveJscramblerCoreUrl(),
          options: {
            removeDeadCode: true,
            restoreControlFlow: true,
            decryptStrings: true,
            simplifyExpressions: true,
          },
        },
        JSCRAMBLER_JOB_TIMEOUT_MS,
      );

      expect(workerResult.code).toBe(mainThread.code);
      expect(workerResult.success).toBe(mainThread.success);
      expect(workerResult.transformations).toEqual(mainThread.transformations);
      expect(workerResult.warnings).toEqual(mainThread.warnings);
      expect(workerResult.confidence).toBeCloseTo(mainThread.confidence);

      // Three-way: the worker must also match a direct core invocation.
      expect(workerResult.code).toBe(coreResult.code);
      expect(workerResult.transformations).toEqual(coreResult.transformations);
      expect(workerResult.warnings).toEqual(coreResult.warnings);

      // Equivalent-fixture assertions: pin the transformation labels and the
      // branch behavior so a worker/main-thread drift (or a garbage-label
      // regression) fails here instead of silently passing on `toEqual`.
      if (fixture.expectedTransformations !== undefined) {
        expect(workerResult.transformations).toEqual(fixture.expectedTransformations);
      }
      if (fixture.expectedWarning !== undefined) {
        expect(
          workerResult.warnings.some((w) => w.includes(fixture.expectedWarning as string)),
        ).toBe(true);
      }
      if (fixture.expectedSuccess !== undefined) {
        expect(workerResult.success).toBe(fixture.expectedSuccess);
      }
      if (fixture.expectedCodeContains !== undefined) {
        for (const needle of fixture.expectedCodeContains) {
          expect(workerResult.code).toContain(needle);
        }
      }
      if (fixture.expectedCodeNotContains !== undefined) {
        for (const needle of fixture.expectedCodeNotContains) {
          expect(workerResult.code).not.toContain(needle);
        }
      }
    });
  }

  it('returns the core log entries from the worker collector', async () => {
    const pool = new WorkerPool<Record<string, unknown>, JscramblerWorkerResult>({
      name: 'jscrambler-runtime-log-test',
      workerScript: JSCRAMBLER_WORKER_SCRIPT,
      minWorkers: 0,
      maxWorkers: 1,
      idleTimeoutMs: 1000,
    });
    pools.push(pool);

    const workerResult = await pool.submit(
      {
        code: 'if (false) { drop(); } else { keep(); }',
        babelUrls: resolveBabelUrls(),
        coreUrl: resolveJscramblerCoreUrl(),
        options: {
          removeDeadCode: true,
          restoreControlFlow: true,
          decryptStrings: true,
          simplifyExpressions: true,
        },
      },
      JSCRAMBLER_JOB_TIMEOUT_MS,
    );

    expect(workerResult.logs).toBeDefined();
    expect(workerResult.logs?.[0]).toEqual({ level: 'info', message: ' JScrambler...' });
    expect(
      workerResult.logs?.some(
        (entry) => entry.level === 'info' && entry.message.includes('deobfuscation complete'),
      ),
    ).toBe(true);
  });
});
