import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

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
import { TEST_HTTP_URLS } from '@tests/shared/test-urls';

describe('CodeAnalyzerDataFlow bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sink types match the call site (not hardcoded eval)', () => {
    it('document.write taint paths are typed xss', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.hash;
        document.write(src);
      `);
      const p = r.taintPaths.find((path) => path.sink.type === 'xss');
      expect(p).toBeDefined();
      expect(p?.sink.location.line).toBe(3);
    });

    it('db.query taint paths are typed sql-injection, not eval', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.search;
        db.query(src);
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'sql-injection')).toBe(true);
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(false);
    });

    it('fs.readFileSync taint paths are typed other, not eval', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.search;
        fs.readFileSync(src);
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'other')).toBe(true);
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(false);
    });
  });

  describe('assignment propagation', () => {
    it('propagates taint through member-assignment targets (obj.data = src)', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.hash;
        obj.data = src;
        eval(obj.data);
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });

    it('propagates taint through binary-assignment targets (obj.data = src + x)', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.hash;
        obj.data = src + 'x';
        eval(obj.data);
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
  });

  describe('network sources', () => {
    it('propagates network sources assigned to member expressions with network type', async () => {
      const r = await analyzeDataFlowWithTaint(`
        obj.resp = api.fetch('${TEST_HTTP_URLS.root}');
        eval(obj.resp);
      `);
      const p = r.taintPaths.find((path) => path.sink.type === 'eval');
      expect(p).toBeDefined();
      expect(p?.source.type).toBe('network');
    });
  });

  describe('JSON.parse is not a sanitizer', () => {
    it('keeps taint through JSON.parse so parsed members are flagged', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.search;
        const p = JSON.parse(src);
        eval(p.data);
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
    });
  });

  describe('innerHTML sink re-scan supports non-identifier arguments', () => {
    it('flags member-chain innerHTML assignment via pass-3 re-scan', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.href;
        const o = src;
        el.innerHTML = o.data;
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'xss')).toBe(true);
    });

    it('flags concatenated innerHTML assignment via pass-3 re-scan', async () => {
      const r = await analyzeDataFlowWithTaint(`
        const src = location.href;
        document.body.innerHTML = src + '<br>';
      `);
      expect(r.taintPaths.some((p) => p.sink.type === 'xss')).toBe(true);
    });
  });
});
