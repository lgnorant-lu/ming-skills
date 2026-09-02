/**
 * Three-way equivalence for the shared JScrambler pass core.
 *
 * `JScramblerDeobfuscator` (main thread) and the off-thread worker both
 * consume `createJscramblerCore` from `jscrambler-core.ts` — the single source
 * of truth for the Babel parse + five traverse/generate passes. This file
 * proves the core produces byte-identical output to the main-thread class on
 * the same fixtures, so a drift between the shared module and its consumers
 * fails here instead of silently diverging in production.
 */

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import {
  createJscramblerCore,
  calculateConfidence,
  type JscramblerCoreBabel,
  type JscramblerCoreOptions,
} from '@modules/deobfuscator/jscrambler-core';

const babel: JscramblerCoreBabel = { parser, traverse, generate, types: t };
const core = createJscramblerCore(babel);

interface Fixture {
  name: string;
  code: string;
  options: Partial<JscramblerCoreOptions>;
}

const FIXTURES: Fixture[] = [
  {
    name: 'self-defending debugger',
    code: `
function guard(){ debugger; return 1; }
setInterval(function(){ debugger; }, 1000);
guard();
`,
    options: {},
  },
  {
    name: 'unresolvable decrypt call left in place',
    code: `
function dec(s){ return s.split('').map(c=>String.fromCharCode(c.charCodeAt(0))).join(''); }
const value = dec("abc");
`,
    options: {},
  },
  {
    name: 'successful static decryption',
    code: `
const dec = (s) => String.fromCharCode(s.charCodeAt(0) + 1);
var _s = ["alpha", "beta"];
function idx(i) { return _s[i]; }
const a = dec("a");
const c = idx(1);
`,
    options: {},
  },
  {
    name: 'while-switch linearizable',
    code: `
var state = 0;
while (true) {
  switch (state) {
    case 0: foo(); state = 1; break;
    case 1: bar(); break;
  }
}
`,
    options: {},
  },
  {
    name: 'dead branch + arithmetic simplification',
    code: `
if (false) { drop(); } else { keep(); }
const n = 2 + 3;
`,
    options: {},
  },
  {
    name: 'parse failure',
    code: 'function broken( {',
    options: {},
  },
];

describe('jscrambler-core three-way equivalence', () => {
  for (const fixture of FIXTURES) {
    it(`matches the main-thread class for: ${fixture.name}`, async () => {
      const mainThread = await new JScramberDeobfuscator().deobfuscate({
        code: fixture.code,
        removeDeadCode: fixture.options.removeDeadCode,
        restoreControlFlow: fixture.options.restoreControlFlow,
        decryptStrings: fixture.options.decryptStrings,
        simplifyExpressions: fixture.options.simplifyExpressions,
      });

      const coreResult = core.deobfuscate(fixture.code, {
        removeDeadCode: fixture.options.removeDeadCode ?? true,
        restoreControlFlow: fixture.options.restoreControlFlow ?? true,
        decryptStrings: fixture.options.decryptStrings ?? true,
        simplifyExpressions: fixture.options.simplifyExpressions ?? true,
      });

      expect(coreResult.code).toBe(mainThread.code);
      expect(coreResult.success).toBe(mainThread.success);
      expect(coreResult.transformations).toEqual(mainThread.transformations);
      expect(coreResult.warnings).toEqual(mainThread.warnings);
      expect(coreResult.confidence).toBeCloseTo(mainThread.confidence);
    });
  }
});

describe('jscrambler-core confidence', () => {
  it('caps at 1.0 and scales by the confidence divisor', () => {
    expect(calculateConfidence(0)).toBe(0);
    expect(calculateConfidence(3)).toBeCloseTo(0.6);
    expect(calculateConfidence(9)).toBe(1);
  });
});
