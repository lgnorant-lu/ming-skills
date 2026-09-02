/**
 * Tests for the inline (regex/AST-fallback) deobfuscation transforms used by
 * the js_deobfuscate_pipeline preprocessor stage.
 *
 * Regression focus (OCR audit 2026-08): constant folding and dead-code removal
 * must NEVER corrupt semantics — operator precedence, nested braces, string
 * literals, and float round-trip precision are all preserved.
 */

import { describe, expect, it } from 'vitest';
import {
  applyConstantFold,
  applyDeadCodeRemove,
} from '@server/domains/analysis/handlers/inline-deobfuscation';

describe('applyConstantFold', () => {
  it('folds a plain numeric binary expression', () => {
    expect(applyConstantFold('1+2')).toBe('3');
    expect(applyConstantFold('x=10-4')).toBe('x=6');
  });

  it('respects operator precedence — never folds across */', () => {
    // 5+3*2 must NOT become 8*2 (would change 11 -> 16); it folds to 11
    expect(applyConstantFold('5+3*2')).toBe('11');
    // x*5+3 must NOT become x*8 (no safe fold exists)
    expect(applyConstantFold('x*5+3')).toBe('x*5+3');
    expect(applyConstantFold('a=1+2*3')).toBe('a=7');
    expect(applyConstantFold('f(5+3*2)')).toBe('f(11)');
  });

  it('folds negative literals via unary minus', () => {
    expect(applyConstantFold('-5+3')).toBe('-2');
  });

  it('preserves float round-trip precision (1/3*3 === 1)', () => {
    const folded = applyConstantFold('(1/3)*3');
    // eslint-disable-next-line no-eval -- test-only semantic check
    expect(eval(folded)).toBe(1);
    expect(folded).not.toContain('0.333333333333'); // no 12-digit truncation
  });

  it('leaves division by zero and NaN untouched', () => {
    expect(applyConstantFold('1/0')).toBe('1/0');
    expect(applyConstantFold('0/0')).toBe('0/0');
  });

  it('folds string concatenation of two literals', () => {
    expect(applyConstantFold("'a' + 'b'")).toBe('"ab"');
  });

  it('folds hex literals exactly (0x1A-0x0F === 11) but never identifiers', () => {
    expect(applyConstantFold('0x1A-0x0F')).toBe('11');
    expect(applyConstantFold('var_a1-2')).toBe('var_a1-2');
  });

  it('never rewrites inside string literals', () => {
    expect(applyConstantFold('var s = "5+3";')).toBe('var s = "5+3";');
  });

  it('uses the guarded regex fallback when parsing fails — folds but never corrupts precedence', () => {
    // Simple self-contained expressions still fold...
    expect(applyConstantFold('function { 8 - 3')).toBe('function { 5');
    // ...but 5+3*2 must not become 8*2 even in the fallback (next `*` guard
    // skips the unsafe match — the expression stays, uncorrupted).
    expect(applyConstantFold('function { 5+3*2')).toBe('function { 5+3*2');
  });

  it('is idempotent on already-folded output', () => {
    const once = applyConstantFold('5+3*2-4');
    expect(applyConstantFold(once)).toBe(once);
  });
});

describe('applyDeadCodeRemove', () => {
  it('removes if(false) blocks entirely', () => {
    expect(applyDeadCodeRemove('if(false){ x(); }')).toBe('');
    expect(applyDeadCodeRemove('a(); if(false){ x(); } b();')).toBe('a();  b();');
  });

  it('handles nested braces without leaving dangling code', () => {
    // Regression: regex [^}]* used to truncate at the first } leaving "}"
    expect(applyDeadCodeRemove('if(false){ if(x){a} }')).toBe('');
    expect(applyDeadCodeRemove('if(false){ if(x){ if(y){z} } } else { keep(); }')).toBe(
      ' keep(); ',
    );
  });

  it('keeps the else branch of if(false)', () => {
    expect(applyDeadCodeRemove('if(false){ a(); } else { b(); }')).toBe(' b(); ');
  });

  it('keeps the then branch of if(true) and drops else', () => {
    expect(applyDeadCodeRemove('if(true){ a(); } else { b(); }')).toBe(' a(); ');
    expect(applyDeadCodeRemove('if(true){ a(); }')).toBe(' a(); ');
  });

  it('does not touch non-literal conditions', () => {
    expect(applyDeadCodeRemove('if(x){ a(); }')).toBe('if(x){ a(); }');
  });

  it('never rewrites inside string literals', () => {
    const input = 'var s = "if(false){x}";';
    expect(applyDeadCodeRemove(input)).toBe(input);
  });

  it('folds boolean ternaries without comma-expression corruption', () => {
    expect(applyDeadCodeRemove('true ? a : b')).toBe('a');
    // false ? x : (b,c) must keep the full comma expression
    expect(applyDeadCodeRemove('y = false ? x : (b,c)')).toBe('y = (b,c)');
  });

  it('removes empty if blocks', () => {
    expect(applyDeadCodeRemove('if(x){}')).toBe('');
    expect(applyDeadCodeRemove('if(x){} else {}')).toBe('');
    // empty then-branch with a real else keeps the else body
    expect(applyDeadCodeRemove('if(x){} else { b(); }')).toBe(' b(); ');
  });

  it('uses the guarded regex fallback when parsing fails — removes flat dead blocks only', () => {
    // Flat dead block is still removed...
    expect(applyDeadCodeRemove('function { if(false){x}')).toBe('function { ');
    // ...but nested-brace matches are left untouched instead of corrupting
    expect(applyDeadCodeRemove('function { if(false){ if(x){a} }')).toBe(
      'function { if(false){ if(x){a} }',
    );
  });
});
