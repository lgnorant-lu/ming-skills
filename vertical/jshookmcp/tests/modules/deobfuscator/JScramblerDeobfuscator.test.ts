import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';

describe('JScramberDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('removes self-defending debugger statements', async () => {
    const code = `
      function guard(){ debugger; return 1; }
      setInterval(function(){ debugger; }, 1000);
      guard();
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code });

    expect(result.success).toBe(true);
    expect(result.code).not.toContain('debugger');
    expect(result.transformations.length).toBeGreaterThan(0);
  });

  it('does not fabricate placeholder strings for unresolvable decrypt calls', async () => {
    const code = `
      function dec(s){ return s.split('').map(c=>String.fromCharCode(c.charCodeAt(0))).join(''); }
      const value = dec("abc");
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code, decryptStrings: true });

    // The map/join decoder cannot be statically evaluated — the call is kept
    // intact and reported, never replaced with a fake literal.
    expect(result.code).not.toContain('[DECRYPTED_STRING]');
    expect(result.code).toContain('dec("abc")');
    expect(result.warnings.some((w) => w.includes('decrypt'))).toBe(true);
  });

  it('restores flattened control-flow while-switch pattern', async () => {
    const code = `
      while (true) {
        switch (state) {
          case 0: a(); break;
          case 1: b(); break;
        }
      }
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({
      code,
      restoreControlFlow: true,
    });

    expect(result.success).toBe(true);
    expect(result.code).toContain('a();');
    expect(result.code).toContain('b();');
  });

  it('removes dead branches and simplifies arithmetic expressions', async () => {
    const code = `
      if (false) { drop(); } else { keep(); }
      const n = 2 + 3;
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code });

    expect(result.code).toContain('keep();');
    expect(result.code).toContain('const n = 5');
  });

  it('returns failure payload when parse pipeline throws', async () => {
    const result = await new JScramberDeobfuscator().deobfuscate({
      code: 'function broken( {',
    });

    expect(result.success).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
