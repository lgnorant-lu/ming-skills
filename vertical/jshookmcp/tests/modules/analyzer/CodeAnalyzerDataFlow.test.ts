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

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/analyzer/SecurityCodeAnalyzer', () => ({
  checkSanitizer: sanitizerState.checkSanitizer,
}));

import { analyzeDataFlowWithTaint } from '@modules/analyzer/CodeAnalyzerDataFlow';
import { TEST_HTTP_URLS } from '@tests/shared/test-urls';

describe('CodeAnalyzer data flow analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tracks taint from browser-controlled sources into xss and eval sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.href;
      const cleaned = sanitize(source);
      document.body.innerHTML = source;
      eval(source);
    `);

    expect(result.sources.some((source) => source.type === 'user_input')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'xss')).toBe(true);
    expect(result.sinks.some((sink) => sink.type === 'eval')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
    expect(result.taintPaths.some((path) => path.sink.type === 'eval')).toBe(true);
  });

  it('ignores legacy extra arguments and keeps local taint analysis', async () => {
    const llm = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          taintPaths: [
            {
              source: { type: 'network', location: { file: 'current', line: 99 } },
              sink: { type: 'eval', location: { file: 'current', line: 5 } },
              path: [
                { file: 'current', line: 99 },
                { file: 'current', line: 5 },
              ],
            },
          ],
        }),
      }),
    };

    const result = await (analyzeDataFlowWithTaint as any)(
      `
        const source = location.href;
        document.body.innerHTML = source;
      `,
      llm,
    );

    expect(llm.chat).not.toHaveBeenCalled();
    expect(result.taintPaths.length).toBeGreaterThan(0);
    // @ts-expect-error — auto-suppressed [TS7006]
    expect(result.taintPaths.some((path) => path.sink.type === 'xss')).toBe(true);
  });

  it('detects network and dom sources, and variable propagation', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const netSource = axios.get('${TEST_HTTP_URLS.root}');
      let domSource = document.querySelector('#input');
      
      const taintedVar = netSource;
      let taintedVar2;
      taintedVar2 = domSource;
      
      eval(taintedVar);
      eval(taintedVar2);
      setTimeout(domSource);
      setInterval(netSource);
      new Function(netSource);
    `);

    expect(result.sources.some((s) => s.type === 'network')).toBe(true);
    expect(result.sources.some((s) => s.type === 'user_input')).toBe(true);
    expect(result.sinks.some((s) => s.type === 'eval')).toBe(true);
    expect(result.taintPaths.length).toBeGreaterThan(0);
  });

  it('detects sql, command, and file sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.search;

      db.query(source);
      mysql.execute(source);
      client.exec(source);
      runner.run(source);

      child_process.spawn(source);
      shell.execSync(source);
      shell.spawnSync(source);

      fs.readFileSync(source);
      fs.writeFileSync(source);
      fs.readFile(source);
      fs.writeFile(source);
      fs.open(source);
    `);

    expect(result.sinks.some((s) => s.type === 'sql-injection')).toBe(true);
    expect(result.sinks.some((s) => s.type === 'other')).toBe(true);
  });

  it('detects location, cookie, window.name, and storage sources', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const s1 = location.href;
      const s2 = location.search;
      const s3 = location.hash;
      const s4 = location.pathname;
      const s5 = document.cookie;
      const s6 = window.name;
      const s7 = localStorage.getItem('k');
      const s8 = sessionStorage.getItem('k');
      
      eval(s1);
      eval(s2);
      eval(s3);
      eval(s4);
      eval(s5);
      eval(s6);
      eval(s7);
      eval(s8);
    `);

    expect(result.sources.some((s) => s.type === 'user_input')).toBe(true);
  });

  it('handles identifier in sinks', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.hash;
      
      eval(source);
    `);

    expect(result.taintPaths.length).toBeGreaterThanOrEqual(1);
  });

  it('drops taint through a recognized sanitizer but keeps it through an unknown wrapper', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const source = location.search;
      const clean = sanitize(source);
      const dirty = wrap(source);
      eval(clean);
      eval(dirty);
    `);

    // Under the mocked checkSanitizer only the bare \`sanitize(...)\` call clears
    // taint; the unknown \`wrap(...)\` helper must still propagate it to the sink.
    // (Previously this asserted 0 paths — which only held because sinks were
    // scanned before taint propagation ran, masking every wrapped flow.)
    expect(result.taintPaths.length).toBe(1);
    expect(result.taintPaths[0]?.sink.type).toBe('eval');
  });

  it('emits normalized source types on taint paths (no legacy "url" leaking out)', async () => {
    const result = await analyzeDataFlowWithTaint(`
      const u = location.href;
      eval(u);
    `);

    expect(result.taintPaths.length).toBeGreaterThanOrEqual(1);
    for (const path of result.taintPaths) {
      expect(['user_input', 'storage', 'network', 'other']).toContain(path.source.type);
    }
  });

  it('terminates on a deeply-chained reverse call chain (interprocedural fixpoint)', async () => {
    const code =
      Array.from({ length: 10 }, (_, i) => `function f${i + 1}(x){ return f${i}(x); }`).join('\n') +
      '\nfunction f0(x){ return x; }' +
      '\nconst s = location.hash;\nconst r = f10(s);\neval(r);';
    const result = await analyzeDataFlowWithTaint(code);

    expect(result.taintPaths.some((p) => p.sink.type === 'eval')).toBe(true);
  });
});
