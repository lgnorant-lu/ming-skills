import { describe, expect, it, vi } from 'vitest';

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

describe('JScramberDeobfuscator OCR fixes', () => {
  describe('evalArgs partial-evaluation guard (fromCharCode / concat)', () => {
    it('leaves fromCharCode calls with unresolvable arguments in place instead of decrypting to ""', async () => {
      // `mystery` is not statically resolvable (not a param, not a known
      // array) — the whole fromCharCode call must survive verbatim; decrypting
      // it to "" would corrupt the program.
      const code = `
        function d(s) {
          return String.fromCharCode(65, mystery, 66);
        }
        const x = d("a");
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('d("a")');
      expect(result.success).toBe(true);
    });

    it('leaves concat calls with unresolvable arguments in place', async () => {
      const code = `
        function d(s) {
          return String.fromCharCode(104) + "a".concat("b", mystery);
        }
        const x = d("b");
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      // The resolvable fromCharCode(104) is replaced, but the concat with an
      // unresolvable argument must not collapse to "a" — the call survives.
      expect(result.code).toContain('d("b")');
      expect(result.code).not.toContain('"a";');
    });

    it('still decrypts fromCharCode when every argument is statically known', async () => {
      const code = `
        function d() {
          return String.fromCharCode(104, 105);
        }
        const x = d();
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('"hi"');
      expect(result.code).not.toContain('const x = d()');
    });

    it('still decrypts concat when every argument is statically known', async () => {
      const code = `
        function d() {
          return String.fromCharCode(104) + "a".concat("b", "c");
        }
        const x = d();
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('"habc"');
    });
  });

  describe('removeSelfDefending operand positions', () => {
    it('replaces an assigned self-defending timer with undefined instead of breaking syntax', async () => {
      const code = `
        function _selfDefend() {
          var a = "toString";
          var b = "constructor";
          var timer = setInterval(function() { debugger; }, 4000);
          return timer;
        }
        foo();
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.success).toBe(true);
      expect(result.code).not.toContain('debugger');
      // Output must stay parseable — the assignment survives with a neutral value.
      expect(result.code).toContain('var timer');
    });

    it('still removes statement-position self-defending timers', async () => {
      const code = `
        function _selfDefend() {
          var a = "toString";
          var b = "constructor";
          setInterval(function() { debugger; }, 4000);
        }
        foo();
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).not.toContain('debugger');
      expect(result.code).not.toContain('setInterval');
    });
  });
});
