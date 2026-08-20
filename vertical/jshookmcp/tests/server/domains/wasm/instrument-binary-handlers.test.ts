import { describe, expect, it, vi } from 'vitest';

const writeFileMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...(args as never[])),
}));
vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/jshook/instrument.wasm',
    displayPath: 'artifacts/wasm/instrument.wasm',
  })),
}));

import type { WasmSharedState } from '@server/domains/wasm/handlers/shared';
import { ExternalToolHandlers } from '@server/domains/wasm/handlers/external-tool-handlers';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const MOCK_OK = {
  ok: true as const,
  stdout: '',
  stderr: '',
  exitCode: 0,
  durationMs: 10,
  signal: null,
  truncated: false,
};

const WAT = `(module
  (func $f (result i32)
    i32.const 42)
)`;

function createMockState(opts: { wat2wasmOk?: boolean } = {}): WasmSharedState {
  const wat2wasmOk = opts.wat2wasmOk ?? true;
  return {
    collector: {} as never,
    runner: {
      run: vi.fn(async (req: { tool: string }) => {
        if (req.tool === 'wabt.wasm2wat') return { ...MOCK_OK, stdout: WAT };
        if (req.tool === 'wabt.wat2wasm') {
          return wat2wasmOk ? MOCK_OK : { ...MOCK_OK, ok: false, stderr: 'wat2wasm: parse error' };
        }
        return MOCK_OK;
      }),
      probeAll: vi.fn(),
    },
  } as unknown as WasmSharedState;
}

describe('ExternalToolHandlers — wasm_instrument_binary', () => {
  it('instruments every function and reassembles via wat2wasm', async () => {
    const handlers = new ExternalToolHandlers(createMockState());
    const body = parseJson<{
      success: boolean;
      functionsInstrumented: number;
      traceFnImport: { module: string; field: string; signature: string };
      honestBoundary: string;
    }>(await handlers.handleWasmInstrumentBinary({ inputPath: 'in.wasm' }));

    expect(body.success).toBe(true);
    expect(body.functionsInstrumented).toBe(1);
    expect(body.traceFnImport).toEqual({
      module: '__jshook',
      field: 'trace_fn',
      signature: '(param i32)',
    });
    expect(body.honestBoundary).toContain('Function-ENTRY');
    expect(writeFileMock).toHaveBeenCalledOnce(); // patched WAT persisted
  });

  it('fails cleanly when wasm2wat fails on the input', async () => {
    const state: WasmSharedState = {
      collector: {} as never,
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
    const handlers = new ExternalToolHandlers(state);

    const body = parseJson<{ success: boolean; error: string }>(
      await handlers.handleWasmInstrumentBinary({ inputPath: 'bad.wasm' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('wasm2wat');
  });

  it('fails cleanly when wat2wasm reassembly fails', async () => {
    const handlers = new ExternalToolHandlers(createMockState({ wat2wasmOk: false }));
    const body = parseJson<{ success: boolean; error: string }>(
      await handlers.handleWasmInstrumentBinary({ inputPath: 'in.wasm' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('wat2wasm');
  });
});
