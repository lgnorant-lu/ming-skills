/**
 * Regression tests for WAT instrumentation:
 *
 * 1. FUNC_ATTR_RE matched `(local.get` / `(local.set` as a `local` attribute
 *    (its `\b` boundary matched before the `.`), so when a function's first
 *    body instruction was a folded local.* op the trace-call was inserted
 *    AFTER it — the injection point silently shifted.
 * 2. The reassembly dropped the `module` keyword (it sliced `(module` down to
 *    a bare `(`), producing invalid WAT.
 */

import { describe, expect, it } from 'vitest';
import { instrumentWat } from '@server/domains/wasm/handlers/wat-instrument';

const TRACE_IMPORT = '(import "__jshook" "trace_fn" (func $__jshook_trace_fn (param i32)))';

describe('instrumentWat — attribute vs body-token discrimination', () => {
  it('inserts the trace call BEFORE a folded (local.get body instruction', () => {
    const wat = `(module
  (func $add (param i32 i32) (result i32)
    (local.get 0)
    (local.get 1)
    (i32.add))
)`;
    const { instrumented, functionsInstrumented } = instrumentWat(wat);
    expect(functionsInstrumented).toBe(1);
    const callIdx = instrumented.indexOf(`(call $__jshook_trace_fn (i32.const 0))`);
    const localGetIdx = instrumented.indexOf('(local.get');
    expect(callIdx).toBeGreaterThan(-1);
    expect(localGetIdx).toBeGreaterThan(callIdx);
    expect(instrumented).toContain(TRACE_IMPORT);
  });

  it('inserts the trace call BEFORE a folded (local.set body instruction', () => {
    const wat = `(module
  (func $store (param i32)
    (local.set 0))
)`;
    const { instrumented, functionsInstrumented } = instrumentWat(wat);
    expect(functionsInstrumented).toBe(1);
    const callIdx = instrumented.indexOf(`(call $__jshook_trace_fn (i32.const 0))`);
    const localSetIdx = instrumented.indexOf('(local.set');
    expect(callIdx).toBeGreaterThan(-1);
    expect(localSetIdx).toBeGreaterThan(callIdx);
  });

  it('still skips real (local ...) attribute sub-nodes', () => {
    const wat = `(module
  (func $f (param i32) (local i32 i64)
    local.get 0)
)`;
    const { instrumented, functionsInstrumented } = instrumentWat(wat);
    expect(functionsInstrumented).toBe(1);
    const callIdx = instrumented.indexOf(`(call $__jshook_trace_fn (i32.const 0))`);
    const localGetIdx = instrumented.indexOf('local.get');
    expect(callIdx).toBeGreaterThan(-1);
    expect(localGetIdx).toBeGreaterThan(callIdx);
  });

  it('still skips type/param/result/export attribute sub-nodes', () => {
    const wat = `(module
  (func $f (export "f") (type 0) (param i32) (result i32)
    i32.const 1)
)`;
    const { instrumented, functionsInstrumented } = instrumentWat(wat);
    expect(functionsInstrumented).toBe(1);
    const callIdx = instrumented.indexOf(`(call $__jshook_trace_fn (i32.const 0))`);
    const bodyStart = instrumented.indexOf('i32.const');
    expect(callIdx).toBeGreaterThan(-1);
    expect(bodyStart).toBeGreaterThan(callIdx);
  });

  it('reassembles a valid (module ...) wrapper (no dropped keyword)', () => {
    const wat = `(module
  (func $f (param i32) (result i32)
    (local.get 0))
)`;
    const { instrumented } = instrumentWat(wat);
    expect(instrumented.startsWith('(module')).toBe(true);
    // Balanced parens + a single module wrapper.
    const opens = (instrumented.match(/\(/g) ?? []).length;
    const closes = (instrumented.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(instrumented.trimEnd().endsWith(')')).toBe(true);
  });
});
