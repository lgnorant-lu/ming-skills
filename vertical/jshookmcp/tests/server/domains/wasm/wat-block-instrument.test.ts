/**
 * Regression tests for WAT block instrumentation:
 *
 * 1. `shiftNumericFunctionIndices` must not rewrite numbers inside string
 *    literals or comments (a `(data ... "call 5")` payload is not a function
 *    reference).
 * 2. Attribute scanning must skip `(;@…;)` annotations and must NOT treat
 *    `(local.get` / `(local.set` as a `local` attribute (stale `\b` boundary
 *    bug that wat-instrument already fixed).
 * 3. Module reassembly must survive `)` inside data strings and fail loudly
 *    when the `(module` wrapper is missing.
 */
import { describe, expect, it } from 'vitest';
import { instrumentWatBlocks } from '@server/domains/wasm/handlers/wat-block-instrument';

describe('instrumentWatBlocks — index shifting', () => {
  it('shifts numeric function references in code but not inside data strings', () => {
    const wat = `(module
  (func $target)
  (func $caller
    call 0)
  (data (i32.const 0) "call 0")
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(2);
    // The data-string payload is untouched.
    expect(r.instrumented).toContain('"call 0"');
    // The code reference shifted by the prepended import (+1).
    expect(r.instrumented).toContain('call 1');
    expect(r.instrumented).not.toContain('"call 1"');
  });

  it('does not rewrite numbers inside comments', () => {
    const wat = `(module
  (func $f
    ;; call 0 is mentioned in a comment
    call 0)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.instrumented).toContain(';; call 0 is mentioned in a comment');
    expect(r.instrumented).toContain('call 1');
  });

  it('shifts (elem func indices and (func references', () => {
    const wat = `(module
  (func $a)
  (elem (i32.const 0) func 0)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.instrumented).toContain('func 1');
  });
});

describe('instrumentWatBlocks — attribute scanning', () => {
  it('skips (;@...;) annotations before the attributes', () => {
    const wat = `(module
  (func $f (;@custom;) (param i32)
    local.get 0)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    const callIdx = r.instrumented.indexOf('(call $__jshook_trace_block (i32.const 0))');
    const paramIdx = r.instrumented.indexOf('(param i32)');
    const localGetIdx = r.instrumented.indexOf('local.get');
    expect(callIdx).toBeGreaterThan(paramIdx);
    expect(callIdx).toBeLessThan(localGetIdx);
  });

  it('inserts the func-entry trace before a folded (local.get body instruction', () => {
    const wat = `(module
  (func $f (param i32)
    (local.get 0))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    const callIdx = r.instrumented.indexOf('(call $__jshook_trace_block (i32.const 0))');
    const localGetIdx = r.instrumented.indexOf('(local.get');
    expect(callIdx).toBeGreaterThan(-1);
    expect(localGetIdx).toBeGreaterThan(callIdx);
  });

  it('inserts the block trace after a label + (result ...) specifier', () => {
    const wat = `(module
  (func $f (result i32)
    (block $b (result i32)
      (i32.const 42)))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.blocksInstrumented).toBe(1);
    // The block-entry call lands after the label/result and before the body.
    const bodyIdx = r.instrumented.indexOf('(i32.const 42)');
    const callIdx = r.instrumented.indexOf('(call $__jshook_trace_block');
    expect(callIdx).toBeGreaterThan(-1);
    expect(callIdx).toBeLessThan(bodyIdx);
  });
});

describe('instrumentWatBlocks — reassembly', () => {
  it('keeps parens inside data strings from corrupting the wrapper suffix', () => {
    const wat = `(module
  (data (i32.const 0) "a)b(c")
  (func $f (result i32)
    (block $b (i32.const 42)))
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsInstrumented).toBe(1);
    const opens = (r.instrumented.match(/\(/g) ?? []).length;
    const closes = (r.instrumented.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(r.instrumented.trimEnd().endsWith(')')).toBe(true);
    expect(r.instrumented).toContain('"a)b(c"');
  });

  it('throws a descriptive error when the module wrapper is missing', () => {
    expect(() => instrumentWatBlocks('(func)')).toThrow('missing (module');
  });

  it('reports skip reasons instead of silently dropping functions', () => {
    const wat = `(module
  (func $f (result i32) i32.const 1)
)`;
    const r = instrumentWatBlocks(wat);
    expect(r.functionsSkipped).toBe(0);
    expect(r.skipReasons).toEqual([]);
  });
});
