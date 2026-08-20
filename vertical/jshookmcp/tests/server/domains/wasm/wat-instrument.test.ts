import { describe, expect, it } from 'vitest';
import { instrumentWat } from '@server/domains/wasm/handlers/wat-instrument';

describe('instrumentWat', () => {
  it('injects the trace import and a per-function entry call', () => {
    const wat = `(module
  (func $add (param i32) (param i32) (result i32)
    local.get 0
    local.get 1
    i32.add)
  (func $main
    i32.const 0
    drop)
)`;
    const r = instrumentWat(wat);
    expect(r.functionsInstrumented).toBe(2);
    expect(r.functionsSkipped).toBe(0);
    expect(r.instrumented).toContain(
      '(import "__jshook" "trace_fn" (func $__jshook_trace_fn (param i32)))',
    );
    expect(r.instrumented).toContain('(call $__jshook_trace_fn (i32.const 0))');
    expect(r.instrumented).toContain('(call $__jshook_trace_fn (i32.const 1))');
    // The call must land AFTER the params and BEFORE the first body instruction.
    const paramsIdx = r.instrumented.indexOf('(param i32) (param i32)');
    const callIdx = r.instrumented.indexOf('(call $__jshook_trace_fn (i32.const 0))');
    const bodyIdx = r.instrumented.indexOf('local.get 0');
    expect(callIdx).toBeGreaterThan(paramsIdx);
    expect(callIdx).toBeLessThan(bodyIdx);
  });

  it('skips attribute sub-nodes (type/param/result/local/export) before inserting', () => {
    const wat = `(module
  (type $t (func))
  (func (export "x") (type $t) (local i32)
    i32.const 0
    local.set 0)
)`;
    const r = instrumentWat(wat);
    expect(r.functionsInstrumented).toBe(1);
    const localIdx = r.instrumented.indexOf('(local i32)');
    const callIdx = r.instrumented.indexOf('(call $__jshook_trace_fn (i32.const 0))');
    const bodyIdx = r.instrumented.indexOf('i32.const 0');
    expect(callIdx).toBeGreaterThan(localIdx);
    expect(callIdx).toBeLessThan(bodyIdx);
    // export stays as an attribute, not duplicated as a body call
    expect(r.instrumented.match(/export "x"/g)).toHaveLength(1);
  });

  it('honors a custom trace function name and import module/field', () => {
    const wat = `(module
  (func (result i32)
    i32.const 42)
)`;
    const r = instrumentWat(wat, {
      traceFnName: '$trace',
      importModule: 'env',
      importField: 'log',
    });
    expect(r.instrumented).toContain('(import "env" "log" (func $trace (param i32)))');
    expect(r.instrumented).toContain('(call $trace (i32.const 0))');
  });

  it('handles a module with no functions (only the trace import is added)', () => {
    const wat = `(module
  (memory 1)
)`;
    const r = instrumentWat(wat);
    expect(r.functionsInstrumented).toBe(0);
    expect(r.functionsSkipped).toBe(0);
    expect(r.instrumented).toContain('(import "__jshook" "trace_fn"');
    expect(r.instrumented).toContain('(memory 1)');
  });

  it('instruments each function with its source-order ordinal', () => {
    const wat = `(module
  (func $a (result i32) i32.const 1)
  (func $b (result i32) i32.const 2)
  (func $c (result i32) i32.const 3)
)`;
    const r = instrumentWat(wat);
    expect(r.functionsInstrumented).toBe(3);
    const aIdx = r.instrumented.indexOf('$a');
    const bIdx = r.instrumented.indexOf('$b');
    const cIdx = r.instrumented.indexOf('$c');
    expect(r.instrumented.indexOf('(i32.const 0)', aIdx)).toBeGreaterThan(aIdx);
    expect(r.instrumented.indexOf('(i32.const 1)', bIdx)).toBeGreaterThan(bIdx);
    expect(r.instrumented.indexOf('(i32.const 2)', cIdx)).toBeGreaterThan(cIdx);
  });
});
