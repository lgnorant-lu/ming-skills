import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// Mock recognizes only the bare `sanitize(...)` identifier call, matching the
// other CodeAnalyzerDataFlow test files. This lets us assert that taint IS
// cleaned by a real sanitizer while an arbitrary user helper is NOT.
const sanitizerState = vi.hoisted(() => ({
  checkSanitizer: vi.fn((call: any) => {
    const callee = call.callee;
    return callee?.type === 'Identifier' && callee.name === 'sanitize';
  }),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));
vi.mock('@modules/analyzer/SecurityCodeAnalyzer', () => ({
  checkSanitizer: sanitizerState.checkSanitizer,
}));

import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';

describe('CodeAnalyzerDataFlow interprocedural taint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. flows taint through a user-defined identity helper into a sink', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const s = location.href;
      function wrap(x) { return x; }
      const w = wrap(s);
      eval(w);
    `);

    // Today this is missed: the eval() sink is scanned in pass 1 before pass 2
    // propagates taint into w, so no path is produced.
    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });

  it('2. propagates taint through a member-chain property access', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const resp = api.fetch('/data');
      const body = resp.data;
      eval(body);
    `);

    // `body = resp.data` is a MemberExpression init — not handled by the
    // current second-pass propagation (identifier / binary / call arg[0] only).
    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });

  it('3. tracks taint through a non-first argument position via a function summary', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const s = location.hash;
      function pick(a, b) { return b; }
      const r = pick('safe', s);
      eval(r);
    `);

    // arg[0] is a clean literal; the tainted value is at index 1 and the helper
    // returns it. The blunt arg[0]-only pass-through cannot see this.
    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });

  it('4. marks a call tainted when the callee returns a known source', async () => {
    const result = await analyzeDataFlowWithTaint(`
      function getHash() { return location.hash; }
      const h = getHash();
      eval(h);
    `);

    // getHash() has no tainted arguments but returns a taint source itself.
    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });

  it('5. does NOT flag taint that a helper sanitizes before returning', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const s = location.search;
      function clean(x) { return sanitize(x); }
      const c = clean(s);
      eval(c);
    `);

    // The source is still detected, but the sanitizing helper breaks the taint,
    // so no path should reach the sink (no false positive).
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.taintPaths.length).toBe(0);
  });

  it('6. terminates on recursive helpers and still reports the tainted return', async () => {
    const result = await analyzeDataFlowWithTaint(`
      function rec(x) { if (x) return rec(x); return x; }
      const s = location.href;
      const r = rec(s);
      eval(r);
    `);

    // Must not hang on the self-call; the base case returns the param, so the
    // summary should still mark the result tainted.
    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });
});
