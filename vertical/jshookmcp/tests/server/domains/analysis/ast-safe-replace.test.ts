import { describe, expect, it } from 'vitest';
import {
  createProtectedRangeResolver,
  replaceOutsideProtectedRanges,
} from '@server/domains/analysis/handlers/ast-safe-replace';

describe('ast-safe-replace protected-range resolver', () => {
  it('matches legacy output (protects strings, rewrites outside)', () => {
    const code = 'var a = "hello"; x = hello;';
    const legacy = replaceOutsideProtectedRanges(code, /hello/g, 'BYE');
    const resolver = createProtectedRangeResolver(code);
    const viaResolver = replaceOutsideProtectedRanges(code, /hello/g, 'BYE', resolver);

    expect(viaResolver).toBe(legacy);
    // The string literal stays protected; the bare identifier is rewritten.
    expect(legacy).toBe('var a = "hello"; x = BYE;');
  });

  it('matches legacy output across parseable samples', () => {
    const samples = [
      'var a = "hello"; a = a + "world";',
      'const s = `template ${x}`; // comment\nlet y = /ab+c/g;',
      '/* block\ncomment */ function f() { return "x"; }',
      'let x = 1; if (x > 5) { x = 2; } else { x = 3; }',
      'var arr = ["a","b"]; arr("0");',
    ];
    const pattern = /\b[a-z]+\b/g;
    for (const code of samples) {
      const legacy = replaceOutsideProtectedRanges(code, pattern, 'R');
      const resolver = createProtectedRangeResolver(code);
      const viaResolver = replaceOutsideProtectedRanges(code, pattern, 'R', resolver);
      expect(viaResolver).toBe(legacy);
    }
  });

  it('isProtected binary-searches precomputed ranges', () => {
    const code = 'var a = "str"; // tail';
    const resolver = createProtectedRangeResolver(code);

    expect(resolver.isProtected(10)).toBe(true); // 't' inside "str"
    expect(resolver.isProtected(2)).toBe(false); // 'r' in `var`
    expect(resolver.isProtected(16)).toBe(true); // inside `// tail`
    expect(resolver.isProtected(code.length + 5)).toBe(false); // past EOF
  });

  it('getRanges returns stable precomputed ranges across calls', () => {
    const code = 'let a = "x"; let b = "y";';
    const resolver = createProtectedRangeResolver(code);
    expect(resolver.getRanges()).toEqual(resolver.getRanges());
    expect(resolver.getRanges().length).toBeGreaterThan(0);
  });

  it('re-parses when the resolver source no longer matches the code', () => {
    const stale = createProtectedRangeResolver('var a = "hello";');
    const code = 'var b = "world"; b = world;';
    // The stale resolver must not be trusted: the string stays protected and
    // the bare identifier is still rewritten correctly.
    const out = replaceOutsideProtectedRanges(code, /world/g, 'X', stale);
    expect(out).toBe('var b = "world"; b = X;');
  });

  it('protects strings via lexical fallback when Babel parse fails', () => {
    // An unterminated string makes Babel throw even with errorRecovery, so
    // createProtectedRangeResolver falls back to collectProtectedRangesLexical.
    // getRanges() stays non-null and covers the string, so "hello" is not
    // rewritten. Direct output assertion: the lexical fallback is a distinct
    // code path from the AST path, so no equivalence assertion applies here.
    const code = 'var a = "hello';
    const resolver = createProtectedRangeResolver(code);

    expect(resolver.getRanges()).toEqual([{ start: 8, end: 14 }]);
    expect(replaceOutsideProtectedRanges(code, /hello/g, 'BYE', resolver)).toBe('var a = "hello');
  });

  it('re-parses via per-match fallback once the resolver source stops matching', () => {
    // Pass 1 rewrites an identifier outside the string, mutating the output so
    // the resolver's source no longer matches. Pass 2 re-parses the mutated
    // code; it still fails (unterminated string) and falls back to the
    // per-match insideStringLiteralOrComment scanner, which keeps the string
    // literal protected. This locks the mixed-behavior contract.
    const original = 'x = world; var a = "unterminated';
    const resolver = createProtectedRangeResolver(original);

    const pass1 = replaceOutsideProtectedRanges(original, /world/g, 'X', resolver);
    expect(pass1).toBe('x = X; var a = "unterminated');
    expect(resolver.source === pass1).toBe(false);

    const pass2 = replaceOutsideProtectedRanges(pass1, /unterminated/g, 'LEAK', resolver);
    expect(pass2).toBe('x = X; var a = "unterminated');
  });
});
