import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import type { WasmSharedState } from '@server/domains/wasm/handlers/shared';
import { ExternalToolHandlers } from '@server/domains/wasm/handlers/external-tool-handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const MOCK_RUN_RESULT = {
  ok: true as const,
  stdout: '',
  stderr: '',
  exitCode: 0,
  durationMs: 10,
  signal: null,
  truncated: false,
};

const WAT_A = `(module
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  (func $stale (result i32)
    i32.const 0)
  (export "add" (func $add))
)`;

const WAT_B = `(module
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.mul)
  (func $newfn (result i32)
    i32.const 1)
  (export "add" (func $add))
)`;

function createMockState(watA: string, watB: string): WasmSharedState {
  return {
    collector: {} as any,
    runner: {
      run: vi.fn(async (req: { args: string[] }) => ({
        ...MOCK_RUN_RESULT,
        stdout: req.args[0] === 'b.wasm' ? watB : watA,
      })),
      probeAll: vi.fn(),
    },
  } as unknown as WasmSharedState;
}

function createFailingMockState(): WasmSharedState {
  return {
    collector: {} as any,
    runner: {
      run: vi.fn(async () => ({
        ok: false,
        stdout: '',
        stderr: 'wasm2wat: bad magic',
        exitCode: 1,
        durationMs: 5,
        signal: null,
        truncated: false,
      })),
      probeAll: vi.fn(),
    },
  } as unknown as WasmSharedState;
}

describe('ExternalToolHandlers — wasm_diff', () => {
  it('classifies added / removed / changed functions and writes a full-diff artifact', async () => {
    const handlers = new ExternalToolHandlers(createMockState(WAT_A, WAT_B));
    const result = parseJson<any>(
      await handlers.handleWasmDiff({ inputPathA: 'a.wasm', inputPathB: 'b.wasm' }),
    );

    expect(result.success).toBe(true);
    expect(result.summary).toEqual({
      functionsA: 2,
      functionsB: 2,
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 0,
    });
    expect(result.addedFunctions.map((f: any) => f.key)).toEqual(['newfn']);
    expect(result.removedFunctions.map((f: any) => f.key)).toEqual(['stale']);
    const addFn = result.changedFunctions.find((f: any) => f.key === 'add');
    expect(addFn).toBeDefined();
    expect(
      addFn.unifiedDiffPreview.some((l: string) => l.startsWith('+') && l.includes('i32.mul')),
    ).toBe(true);
    expect(
      addFn.unifiedDiffPreview.some((l: string) => l.startsWith('-') && l.includes('i32.add')),
    ).toBe(true);

    // Full diff artifact contains the complete (untruncated) unified diff.
    const artifact = JSON.parse(await readFile(result.artifactPath, 'utf-8'));
    const fullAdd = artifact.changedFunctions.find((f: any) => f.key === 'add');
    expect(fullAdd.unifiedDiff.length).toBeGreaterThanOrEqual(addFn.unifiedDiffPreview.length);
    expect(result.semantic).toBe(false);
  });

  it('semantic mode downgrades pure local-name renumbering to unchanged', async () => {
    const wa = `(module\n  (func $f\n    local.get $l0)\n)`;
    const wb = `(module\n  (func $f\n    local.get $l1)\n)`;
    const handlers = new ExternalToolHandlers(createMockState(wa, wb));
    const result = parseJson<any>(
      await handlers.handleWasmDiff({
        inputPathA: 'a.wasm',
        inputPathB: 'b.wasm',
        semantic: true,
      }),
    );
    expect(result.success).toBe(true);
    expect(result.summary.changed).toBe(0);
    expect(result.summary.unchanged).toBe(1);
    expect(result.semantic).toBe(true);
  });

  it('returns a structured failure when wasm2wat fails on the first input', async () => {
    const handlers = new ExternalToolHandlers(createFailingMockState());
    const result = parseJson<any>(
      await handlers.handleWasmDiff({ inputPathA: 'a.wasm', inputPathB: 'b.wasm' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('inputPathA');
    expect(result.error).toContain('bad magic');
    expect(result.exitCode).toBe(1);
  });

  it('uses each input exactly once (one wasm2wat invocation per side)', async () => {
    const state = createMockState(WAT_A, WAT_B);
    const handlers = new ExternalToolHandlers(state);
    await handlers.handleWasmDiff({ inputPathA: 'a.wasm', inputPathB: 'b.wasm' });
    expect(state.runner.run).toHaveBeenCalledTimes(2);
  });
});
