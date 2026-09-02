import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
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
import { createJscramblerCore } from '@modules/deobfuscator/jscrambler-core';

const core = createJscramblerCore({ parser, traverse, generate, types: t });

describe('JScramberDeobfuscator bug fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  describe('decryptStrings performs real decryption instead of placeholders', () => {
    it('evaluates char-code decrypt functions', async () => {
      const code = `
        function d(s){ return String.fromCharCode(s.charCodeAt(0) + 1); }
        const x = d("a");
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('const x = "b"');
      expect(result.code).not.toContain('[DECRYPTED_STRING]');
    });

    it('evaluates decrypt functions that index into a global string array', async () => {
      const code = `
        var _str = ["hello", "world"];
        function d(i){ return _str[i]; }
        const x = d(1);
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('const x = "world"');
      expect(result.code).not.toContain('[DECRYPTED_STRING]');
    });

    it('leaves unresolvable decrypt calls in place and reports a warning', async () => {
      const code = `
        function d(s){
          return String.fromCharCode(s.charCodeAt(0)) + s.split('').join('');
        }
        const x = d("abc");
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({ code });

      expect(result.code).toContain('d("abc")');
      expect(result.code).not.toContain('[DECRYPTED_STRING]');
      expect(result.warnings.some((w) => w.includes('decrypt'))).toBe(true);
    });
  });

  describe('restoreControlFlow linearizes by state updates', () => {
    it('flattens a linear state machine in execution order', async () => {
      const code = `
        var state = 0;
        while (true) {
          switch (state) {
            case 0: foo(); state = 1; break;
            case 1: bar(); state = 2; break;
            case 2: baz(); break;
          }
        }
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({
        code,
        restoreControlFlow: true,
      });

      expect(result.success).toBe(true);
      expect(result.code).not.toContain('while');
      expect(result.code).not.toContain('switch');
      const fooIdx = result.code.indexOf('foo();');
      const bazIdx = result.code.indexOf('baz();');
      expect(fooIdx).toBeGreaterThanOrEqual(0);
      expect(bazIdx).toBeGreaterThan(fooIdx);
    });

    it('follows out-of-order state jumps', async () => {
      const code = `
        var state = 0;
        while (true) {
          switch (state) {
            case 0: foo(); state = 2; break;
            case 2: baz(); state = 1; break;
            case 1: bar(); break;
          }
        }
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({
        code,
        restoreControlFlow: true,
      });

      const fooIdx = result.code.indexOf('foo();');
      const bazIdx = result.code.indexOf('baz();');
      const barIdx = result.code.indexOf('bar();');
      expect(fooIdx).toBeGreaterThanOrEqual(0);
      expect(bazIdx).toBeGreaterThan(fooIdx);
      expect(barIdx).toBeGreaterThan(bazIdx);
    });

    it('keeps the pattern intact when state jumps form a cycle', async () => {
      const code = `
        var state = 0;
        while (true) {
          switch (state) {
            case 0: foo(); state = 1; break;
            case 1: bar(); state = 0; break;
          }
        }
      `;
      const result = await new JScramberDeobfuscator().deobfuscate({
        code,
        restoreControlFlow: true,
      });

      expect(result.code).toContain('while');
      expect(result.code).toContain('switch');
      expect(result.code).toContain('state = 1');
    });

    it('does not swallow unflatten failures silently', () => {
      const ast = parser.parse(
        'while (true) { switch (state) { case 0: boom(); state = 1; break; case 1: bust(); state = 0; break; } }',
        { sourceType: 'module' },
      );
      const warnings: string[] = [];
      core.restoreControlFlow(ast, warnings);
      expect(warnings.some((w) => w.includes('control-flow'))).toBe(true);
    });
  });
});
