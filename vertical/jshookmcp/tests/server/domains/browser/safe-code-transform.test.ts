import { describe, expect, it } from 'vitest';
import {
  transformCodeForCamoufox,
  validateCodeSafety,
} from '@server/domains/browser/handlers/safe-code-transform';

describe('safe-code-transform', () => {
  describe('transformCodeForCamoufox', () => {
    it('keeps ${...} inside user code inert (no Node-side template interpolation)', () => {
      // Regression: the wrapper was built with a template literal, so a `${...}`
      // inside user code was interpolated WHILE the string was constructed in
      // Node.js — a Node-side RCE. The wrapper must now be concatenation-based.
      const payload = '`tpl-${1 + 2}`';
      const { evaluateFunction } = transformCodeForCamoufox({ code: payload });
      expect(evaluateFunction.toString()).toContain('tpl-${1 + 2}');
    });

    it('enforces the safety gate before constructing the wrapper', () => {
      expect(() => transformCodeForCamoufox({ code: 'process.exit(1)' })).toThrow(
        /potentially dangerous pattern/i,
      );
    });

    it('wraps legitimate code into an eval-carrying transport function', () => {
      const { evaluateFunction, wasWrapped } = transformCodeForCamoufox({ code: '1 + 1' });
      expect(wasWrapped).toBe(true);
      expect(evaluateFunction.toString()).toContain('(0, eval)');
    });
  });

  describe('validateCodeSafety', () => {
    it('rejects real Node API access tokens', () => {
      expect(validateCodeSafety('require("fs")').safe).toBe(false);
      expect(validateCodeSafety('const x = process.env').safe).toBe(false);
      expect(validateCodeSafety('import("child_process")').safe).toBe(false);
    });

    it('ignores tokens hidden in comments (no false positives, no comment bypass)', () => {
      expect(validateCodeSafety('1; /* require("x") */ 2').safe).toBe(true);
      expect(validateCodeSafety('// process.env\n1').safe).toBe(true);
    });

    it('ignores tokens inside string literals', () => {
      expect(validateCodeSafety('const s = "require(x)"; const t = `fs.${1}`; 1').safe).toBe(true);
    });
  });
});
