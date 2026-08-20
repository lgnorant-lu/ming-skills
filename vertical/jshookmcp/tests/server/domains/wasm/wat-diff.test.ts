import { describe, expect, it } from 'vitest';

import {
  diffWatStructures,
  parseWatStructure,
  splitTopLevelNodes,
  unifiedDiff,
} from '@server/domains/wasm/handlers/wat-diff';

describe('wat-diff — splitTopLevelNodes', () => {
  it('splits balanced top-level S-expressions inside (module ...)', () => {
    const wat = `(module
  (type $t0 (func))
  (func $add)
  (export "add" (func $add))
)`;
    const nodes = splitTopLevelNodes(wat);
    expect(nodes.map((n) => n.trim())).toEqual([
      '(type $t0 (func))',
      '(func $add)',
      '(export "add" (func $add))',
    ]);
  });

  it('ignores parens inside string literals (data section)', () => {
    const wat = `(module
  (data (;0;) (i32.const 0) "a)b(c")
)`;
    const nodes = splitTopLevelNodes(wat);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toContain('"a)b(c"');
  });

  it('handles an unterminated final node gracefully', () => {
    const nodes = splitTopLevelNodes('(module\n  (func $a');
    // The func node never closes; nothing balanced is captured.
    expect(nodes.filter((n) => n.includes('(func'))).toHaveLength(0);
  });
});

describe('wat-diff — parseWatStructure', () => {
  it('extracts named functions, imports, and exports', () => {
    const wat = `(module
  (import "env" "log" (func $env.log (param i32)))
  (func $add (param $p0 i32) (param $p1 i32) (result i32)
    local.get $p0
    local.get $p1
    i32.add)
  (export "add" (func $add))
)`;
    const s = parseWatStructure(wat);
    expect(s.functions.map((f) => f.key)).toEqual(['add']);
    expect(s.functions[0]!.named).toBe(true);
    expect(s.functions[0]!.displayName).toBe('$add');
    expect(s.functions[0]!.lines.length).toBeGreaterThan(3);
    expect(s.imports).toHaveLength(1);
    expect(s.imports[0]).toContain('"env" "log"');
    expect(s.exports).toHaveLength(1);
  });

  it('falls back to (;N;) index markers for unnamed functions', () => {
    const wat = `(module
  (func (;0;)
    nop)
  (func (;1;)
    drop)
)`;
    const s = parseWatStructure(wat);
    expect(s.functions.map((f) => f.key)).toEqual(['__idx_0', '__idx_1']);
    expect(s.functions[0]!.displayName).toBe('(;0;)');
    expect(s.functions[0]!.named).toBe(false);
  });

  it('uses inline export name when function has neither $name nor (;N;)', () => {
    const wat = `(module
  (func (export "compute") (result i32)
    i32.const 42)
)`;
    const s = parseWatStructure(wat);
    expect(s.functions).toHaveLength(1);
    expect(s.functions[0]!.key).toBe('__exp_compute');
    // Inline-export func does NOT also appear in the separate exports list.
    expect(s.exports).toHaveLength(0);
  });

  it('ordinal-matches fully unnamed functions', () => {
    const wat = `(module
  (func (param i32))
  (func (param i32))
)`;
    const s = parseWatStructure(wat);
    expect(s.functions.map((f) => f.key)).toEqual(['__unnamed_0', '__unnamed_1']);
  });
});

describe('wat-diff — unifiedDiff', () => {
  it('returns [] when both sides are identical', () => {
    const lines = ['  a', '  b', '  c'];
    expect(unifiedDiff(lines, lines)).toEqual([]);
  });

  it('marks added lines with + and removed with -', () => {
    const a = ['  i32.add', '  drop'];
    const b = ['  i32.add', '  i32.mul', '  drop'];
    const diff = unifiedDiff(a, b, 1);
    expect(diff).toContain('+  i32.mul');
    expect(diff.some((l) => l.startsWith('-'))).toBe(false);
  });

  it('emits a removal line for deleted content', () => {
    const a = ['  local.get $p0', '  local.get $p1', '  i32.add'];
    const b = ['  local.get $p0', '  i32.add'];
    const diff = unifiedDiff(a, b, 0);
    expect(diff.some((l) => l.startsWith('-'))).toBe(true);
    expect(diff.some((l) => l.startsWith('+'))).toBe(false);
  });

  it('elides unchanged runs outside the context window', () => {
    const a = Array.from({ length: 20 }, (_, i) => `  line${i}`);
    const b = [...a];
    b[15] = '  CHANGED';
    const diff = unifiedDiff(a, b, 2);
    // Only the change + 2 lines of context per side appear.
    expect(diff.length).toBeLessThan(10);
    expect(diff).toContain('-  line15');
    expect(diff).toContain('+  CHANGED');
  });
});

describe('wat-diff — diffWatStructures', () => {
  const WAT_A = `(module
  (import "env" "log" (func $log (param i32)))
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.add)
  (func $stale (result i32)
    i32.const 0)
  (export "add" (func $add))
  (export "stale" (func $stale))
)`;

  const WAT_B = `(module
  (import "env" "log" (func $log (param i32)))
  (import "env" "dbg" (func $dbg))
  (func $add (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.mul)
  (func $newfn (result i32)
    i32.const 1)
  (export "add" (func $add))
)`;

  it('classifies added / removed / changed / unchanged functions', () => {
    const diff = diffWatStructures(parseWatStructure(WAT_A), parseWatStructure(WAT_B));
    expect(diff.addedFunctions.map((f) => f.key)).toEqual(['newfn']);
    expect(diff.removedFunctions.map((f) => f.key)).toEqual(['stale']);
    expect(diff.unchangedFunctions.map((f) => f.key)).toEqual([]);
    expect(diff.changedFunctions.map((f) => f.key)).toEqual(['add']);
  });

  it('records line-level add inside a changed function', () => {
    const diff = diffWatStructures(parseWatStructure(WAT_A), parseWatStructure(WAT_B));
    const addFn = diff.changedFunctions.find((f) => f.key === 'add')!;
    expect(addFn.unifiedDiff.some((l) => l.includes('i32.mul'))).toBe(true);
    expect(addFn.unifiedDiff.some((l) => l.startsWith('-') && l.includes('i32.add'))).toBe(true);
    expect(addFn.addedLines).toBeGreaterThan(0);
    expect(addFn.removedLines).toBeGreaterThan(0);
  });

  it('reports import / export deltas', () => {
    const diff = diffWatStructures(parseWatStructure(WAT_A), parseWatStructure(WAT_B));
    expect(diff.importDelta.added.some((s) => s.includes('"dbg"'))).toBe(true);
    expect(diff.importDelta.removed).toHaveLength(0);
    // "stale" export present in A but gone in B.
    expect(diff.exportDelta.removed.some((s) => s.includes('"stale"'))).toBe(true);
    expect(diff.exportDelta.added).toHaveLength(0);
  });

  it('summary counts are consistent', () => {
    const diff = diffWatStructures(parseWatStructure(WAT_A), parseWatStructure(WAT_B));
    expect(diff.summary).toEqual({
      functionsA: 2,
      functionsB: 2,
      added: 1,
      removed: 1,
      changed: 1,
      unchanged: 0,
    });
  });

  it('identical structures produce an all-unchanged diff', () => {
    const diff = diffWatStructures(parseWatStructure(WAT_A), parseWatStructure(WAT_A));
    expect(diff.summary.changed).toBe(0);
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.removed).toBe(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('semantic mode treats pure local-name renumbering as unchanged', () => {
    const wa = `(module\n  (func $f\n    local.get $l0)\n)`;
    const wb = `(module\n  (func $f\n    local.get $l1)\n)`;
    const plain = diffWatStructures(parseWatStructure(wa), parseWatStructure(wb));
    expect(plain.summary.changed).toBe(1);
    const sem = diffWatStructures(parseWatStructure(wa), parseWatStructure(wb), { semantic: true });
    expect(sem.summary.changed).toBe(0);
    expect(sem.summary.unchanged).toBe(1);
  });
});
