import { describe, expect, it, vi } from 'vitest';
import {
  instrumentWatBlocks,
  analyzeWasmBasicBlocks,
  findBlockEntryOffsets,
  countBranches,
} from '@server/domains/wasm/handlers/wat-block-instrument';

// ---------------------------------------------------------------------------
// Pure-function tests: instrumentWatBlocks
// ---------------------------------------------------------------------------

describe('instrumentWatBlocks', () => {
  it('injects the trace import and block-entry calls for every block/loop/if', () => {
    const wat = `(module
  (func $f (result i32)
    (block $b1
      (block $b2
        (br $b1)
        (i32.const 1))
      (i32.const 2))
    (loop $lp
      (br $lp)))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    expect(r.functionsSkipped).toBe(0);
    // 3 blocks (b1, b2, lp) + 1 func entry = 4 instrumented entries
    expect(r.blocksInstrumented).toBe(3);

    // trace import present
    expect(r.instrumented).toContain(
      '(import "__jshook" "trace_block" (func $__jshook_trace_block (param i32)))',
    );

    // Ordinals 0-3 should all appear
    for (let i = 0; i <= 3; i++) {
      expect(r.instrumented).toContain(`(call $__jshook_trace_block (i32.const ${i}))`);
    }
    // No ordinal 4 (only 4 entries)
    expect(r.instrumented).not.toContain('(i32.const 4)');
  });

  it('instruments if-blocks as well', () => {
    const wat = `(module
  (func $test (result i32)
    (if (result i32) (i32.const 0)
      (then (i32.const 42))
      (else (i32.const 99))))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    // 1 if block + 1 func entry = 2 entries
    expect(r.blocksInstrumented).toBe(1);
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 0))');
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 1))');
  });

  it('honors custom trace function name and import module/field', () => {
    const wat = `(module
  (func (result i32)
    (block
      (i32.const 42)))
)`;
    const r = instrumentWatBlocks(wat, {
      traceFnName: '$my_trace',
      importModule: 'env',
      importField: 'log_block',
    });
    expect(r.instrumented).toContain('(import "env" "log_block" (func $my_trace (param i32)))');
    expect(r.instrumented).toContain('(call $my_trace (i32.const 0))'); // func entry
    expect(r.instrumented).toContain('(call $my_trace (i32.const 1))'); // block entry
  });

  it('can skip function-entry instrumentation with includeFuncEntry=false', () => {
    const wat = `(module
  (func $f (result i32)
    (block $b
      (i32.const 1)))
)`;
    const r = instrumentWatBlocks(wat, { includeFuncEntry: false });
    expect(r.functionsInstrumented).toBe(1);
    // Only the block, no func entry
    expect(r.blocksInstrumented).toBe(1);
    // Exactly one trace call (block entry only, no func entry)
    const traceCalls = r.instrumented.match(/\(call \$__jshook_trace_block/g);
    expect(traceCalls).toHaveLength(1);
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 0))');
  });

  it('handles a module with no functions', () => {
    const wat = `(module
  (memory 1)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(0);
    expect(r.functionsSkipped).toBe(0);
    expect(r.blocksInstrumented).toBe(0);
    expect(r.instrumented).toContain('(import "__jshook" "trace_block"');
    expect(r.instrumented).toContain('(memory 1)');
    expect(r.instrumented.trimStart()).toMatch(/^\(module\b/);
  });

  it('shifts numeric function references after prepending the trace import', () => {
    const wat = `(module
  (type (;0;) (func))
  (func (;0;) (type 0) call 1)
  (func (;1;) (type 0) ref.func 0 drop)
  (export "first" (func 0))
  (start 1)
  (table 2 funcref)
  (elem (i32.const 0) func 0 1)
)`;
    const result = instrumentWatBlocks(wat);
    expect(result.instrumented).toContain('call 2');
    expect(result.instrumented).toContain('ref.func 1');
    expect(result.instrumented).toContain('(export "first" (func 1))');
    expect(result.instrumented).toContain('(start 2)');
    expect(result.instrumented).toContain('(elem (i32.const 0) func 1 2)');
  });

  it('instruments a function with no blocks (func-entry-only)', () => {
    const wat = `(module
  (func $simple (result i32)
    i32.const 42)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    expect(r.blocksInstrumented).toBe(0);
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 0))');
    // body instruction should still be there
    expect(r.instrumented).toContain('i32.const 42');
  });

  it('assigns sequential ordinals across multiple functions', () => {
    const wat = `(module
  (func $a (result i32)
    (block $ba
      (i32.const 1)))
  (func $b (result i32)
    (loop $lb
      (br $lb))
    (block $bb
      (i32.const 2)))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(2);
    expect(r.blocksInstrumented).toBe(3); // ba, lb, bb

    // func $a: ordinal 0 (func entry), ordinal 1 (block ba)
    // func $b: ordinal 2 (func entry), ordinal 3 (loop lb), ordinal 4 (block bb)
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 0))');
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 1))');
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 2))');
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 3))');
    expect(r.instrumented).toContain('(call $__jshook_trace_block (i32.const 4))');
  });

  it('skips block keywords inside string literals and comments', () => {
    const wat = `(module
  (func $f (result i32)
    ;; (block $commented out)
    i32.const 0)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    // Only func entry, no extra block from comment
    expect(r.blocksInstrumented).toBe(0);
    expect(r.instrumented).not.toContain('(i32.const 1)');
  });
});

// ---------------------------------------------------------------------------
// Pure-function tests: analyzeWasmBasicBlocks
// ---------------------------------------------------------------------------

describe('analyzeWasmBasicBlocks', () => {
  it('counts functions, blocks, and branches', () => {
    const wat = `(module
  (func $f (result i32)
    (block $b1
      (loop $l1
        (br_if $l1 (i32.const 0))
        (br $b1))
      (i32.const 1)))
  (func $g
    (if (i32.const 1)
      (then (block (i32.const 2)))
      (else (i32.const 3))))
)`;
    const a = analyzeWasmBasicBlocks(wat);
    expect(a.functions).toBe(2);
    // $f: block b1 + loop l1 = 2 // $g: if + block = 2 => total 4
    expect(a.blocks).toBe(4);
    // $f: br_if + br = 2 // $g: 0
    expect(a.branches).toBe(2);
    // instrumentable = blocks + functions = 4 + 2 = 6
    expect(a.instrumentableBlocks).toBe(6);
  });

  it('returns zero for a module with no functions', () => {
    const wat = `(module
  (memory 1)
  (global $g i32 (i32.const 0))
)`;
    const a = analyzeWasmBasicBlocks(wat);
    expect(a.functions).toBe(0);
    expect(a.blocks).toBe(0);
    expect(a.branches).toBe(0);
    expect(a.instrumentableBlocks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pure-function tests: findBlockEntryOffsets
// ---------------------------------------------------------------------------

describe('findBlockEntryOffsets', () => {
  it('finds block/loop/if entries in a function body', () => {
    const body = `(func $test (result i32)
  (block $b1
    (block $b2
      (br $b1)
      (i32.const 1))
    (i32.const 2)))`;

    const offsets = findBlockEntryOffsets(body);
    // Two blocks: b1 and b2
    expect(offsets).toHaveLength(2);
  });

  it('returns empty array for a function with no blocks', () => {
    const body = `(func $simple (result i32)
  i32.const 42)`;
    const offsets = findBlockEntryOffsets(body);
    expect(offsets).toHaveLength(0);
  });

  it('skips block keywords inside comments', () => {
    const body = `(func $f (result i32)
  ;; (block $ghost) — this is a comment
  (block $real
    i32.const 1))`;
    const offsets = findBlockEntryOffsets(body);
    // Only the real block
    expect(offsets).toHaveLength(1);
  });

  it('skips block keywords inside block comments', () => {
    const body = `(func $f (result i32)
  (; (block $ghost) ;)
  (block $real
    i32.const 1))`;
    const offsets = findBlockEntryOffsets(body);
    expect(offsets).toHaveLength(1);
  });

  it('finds if entries', () => {
    const body = `(func $test
  (if (i32.const 1)
    (then (i32.const 2))
    (else (i32.const 3))))`;
    const offsets = findBlockEntryOffsets(body);
    expect(offsets).toHaveLength(1);
  });

  it('finds loop entries', () => {
    const body = `(func $test
  (loop $lp
    (br $lp)))`;
    const offsets = findBlockEntryOffsets(body);
    expect(offsets).toHaveLength(1);
  });

  it('inserts trace at correct position (after label and result)', () => {
    const body = `(func $f
  (block $b (result i32)
    i32.const 42))`;

    const offsets = findBlockEntryOffsets(body);
    expect(offsets).toHaveLength(1);

    // The offset should point to the 'i' of 'i32.const 42'
    const pos = offsets[0]!;
    const after = body.slice(pos).trimStart();
    expect(after).toMatch(/^i32\.const/);
  });
});

// ---------------------------------------------------------------------------
// Pure-function tests: countBranches
// ---------------------------------------------------------------------------

describe('countBranches', () => {
  it('counts br, br_if, and br_table in both parenthesized and bare forms', () => {
    const text = `(func $f
  (br $exit)
  br_if $loop
  (br_table $a $b (local.get 0)))`;
    expect(countBranches(text)).toBe(3);
  });

  it('returns 0 when there are no branches', () => {
    expect(countBranches('i32.const 42')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Handler integration tests (mocked runner)
// ---------------------------------------------------------------------------

const writeFileMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...(args as never[])),
}));
vi.mock('@src/utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/jshook/instrument_block.wasm',
    displayPath: 'artifacts/wasm/instrument_block.wasm',
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

const WAT_WITH_BLOCKS = `(module
  (func $f (result i32)
    (block $b
      (i32.const 42)))
)`;

function createMockState(opts: { wat2wasmOk?: boolean } = {}): WasmSharedState {
  const wat2wasmOk = opts.wat2wasmOk ?? true;
  return {
    collector: {} as never,
    runner: {
      run: vi.fn(async (req: { tool: string }) => {
        if (req.tool === 'wabt.wasm2wat') return { ...MOCK_OK, stdout: WAT_WITH_BLOCKS };
        if (req.tool === 'wabt.wat2wasm') {
          return wat2wasmOk ? MOCK_OK : { ...MOCK_OK, ok: false, stderr: 'wat2wasm: parse error' };
        }
        return MOCK_OK;
      }),
      probeAll: vi.fn(),
    },
  } as unknown as WasmSharedState;
}

describe('ExternalToolHandlers — wasm_instrument_block', () => {
  it('instruments block entries and reassembles via wat2wasm', async () => {
    const handlers = new ExternalToolHandlers(createMockState());
    const body = parseJson<{
      success: boolean;
      functionsInstrumented: number;
      blocksInstrumented: number;
      analysis: { functions: number; blocks: number; branches: number };
      traceFnImport: { module: string; field: string; signature: string };
      honestBoundary: string;
    }>(await handlers.handleWasmInstrumentBlock({ inputPath: 'in.wasm' }));

    expect(body.success).toBe(true);
    expect(body.functionsInstrumented).toBe(1);
    expect(body.blocksInstrumented).toBe(1); // one block entry
    expect(body.traceFnImport).toEqual({
      module: '__jshook',
      field: 'trace_block',
      signature: '(param i32)',
    });
    expect(body.honestBoundary).toContain('Block/loop/if-ENTRY');
    expect(body.analysis.functions).toBe(1);
    expect(body.analysis.blocks).toBe(1);
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
      await handlers.handleWasmInstrumentBlock({ inputPath: 'bad.wasm' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('wasm2wat');
  });

  it('fails cleanly when wat2wasm reassembly fails', async () => {
    const handlers = new ExternalToolHandlers(createMockState({ wat2wasmOk: false }));
    const body = parseJson<{ success: boolean; error: string }>(
      await handlers.handleWasmInstrumentBlock({ inputPath: 'in.wasm' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('wat2wasm');
  });
});
