import * as parser from '@babel/parser';
import generate from '@babel/generator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import { ASTOptimizer } from '@modules/deobfuscator/ASTOptimizer';

function runPass(pass: 'constantPropagation' | 'variableInlining', code: string): string {
  const optimizer = new ASTOptimizer() as any;
  const ast = parser.parse(code, { sourceType: 'module' });
  optimizer[pass](ast);
  return generate(ast).code;
}

describe('ASTOptimizer bug fixes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  describe('constantPropagation is scope-aware', () => {
    it('does not replace a variable that is reassigned after its declaration', () => {
      const output = runPass(
        'constantPropagation',
        `
        let x = 5;
        x = 10;
        const y = x + 1;
      `,
      );
      expect(output).toContain('x + 1');
    });

    it('does not conflate same-named constants across scopes', () => {
      const output = runPass(
        'constantPropagation',
        `
        const v = 1;
        function a() {
          const v = 2;
          return v;
        }
        const r = v;
      `,
      );
      // The inner `v = 2` must not leak into the outer-scope reference.
      expect(output).toContain('const r = 1');
    });

    it('does not replace a function parameter that shadows a constant', () => {
      const output = runPass(
        'constantPropagation',
        `
        const x = 5;
        function f(x) { return x; }
      `,
      );
      expect(output).toContain('return x');
    });

    it('does not rewrite member-expression property identifiers', () => {
      const output = runPass(
        'constantPropagation',
        `
        const length = 5;
        const s = obj.length;
      `,
      );
      expect(output).toContain('obj.length');
    });
  });

  describe('variableInlining is scope-aware', () => {
    it('does not inline a variable that is reassigned', () => {
      const output = runPass(
        'variableInlining',
        `
        let x = 5;
        x = 10;
        const r = x;
      `,
      );
      expect(output).toContain('const r = x');
    });

    it('counts usages per binding, not per name', () => {
      const output = runPass(
        'variableInlining',
        `
        function a() { const v = 2; return v; }
        function b() { const v = 3; return v; }
      `,
      );
      expect(output).toContain('return 2');
      expect(output).toContain('return 3');
    });
  });

  describe('!!x only rewrites to Boolean(x) when Boolean is not shadowed', () => {
    it('rewrites when the global Boolean is intact', () => {
      const optimizer = new ASTOptimizer() as any;
      const ast = parser.parse('const r = !!flag;', { sourceType: 'module' });
      optimizer.expressionSimplification(ast);
      expect(generate(ast).code).toContain('Boolean(flag)');
    });

    it('keeps !!x when Boolean is shadowed by a function declaration', () => {
      const optimizer = new ASTOptimizer() as any;
      const ast = parser.parse('function Boolean(v) { return v; }\nconst r = !!flag;', {
        sourceType: 'module',
      });
      optimizer.expressionSimplification(ast);
      const output = generate(ast).code;
      expect(output).toContain('!!flag');
      expect(output).not.toContain('Boolean(flag)');
    });

    it('keeps !!x when Boolean is shadowed by a variable', () => {
      const optimizer = new ASTOptimizer() as any;
      const ast = parser.parse('const Boolean = custom;\nconst r = !!flag;', {
        sourceType: 'module',
      });
      optimizer.expressionSimplification(ast);
      const output = generate(ast).code;
      expect(output).toContain('!!flag');
      expect(output).not.toContain('Boolean(flag)');
    });
  });
});
