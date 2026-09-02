/**
 * ConditionEvaluator — unit tests.
 *
 * Tests expression validation and evaluation for breakpoint conditions.
 */

import { describe, it, expect } from 'vitest';
import {
  validateBreakpointCondition,
  evaluateBreakpointCondition,
  buildConditionContext,
} from '@native/ConditionEvaluator';

describe('ConditionEvaluator', () => {
  describe('validateBreakpointCondition', () => {
    it('should accept undefined and empty string', () => {
      expect(() => validateBreakpointCondition(undefined)).not.toThrow();
      expect(() => validateBreakpointCondition('')).not.toThrow();
      expect(() => validateBreakpointCondition('  ')).not.toThrow();
    });

    it('should reject conditions exceeding max length', () => {
      const long = 'a'.repeat(50_001);
      expect(() => validateBreakpointCondition(long)).toThrow('too long');
    });

    it('should accept valid JavaScript expressions', () => {
      expect(() => validateBreakpointCondition('rax > 0x1000')).not.toThrow();
      expect(() => validateBreakpointCondition('eax == 5 && ecx == 3')).not.toThrow();
      expect(() => validateBreakpointCondition('rip >= 0x401000 && rcx < 100')).not.toThrow();
    });

    it('should reject syntactically invalid expressions', () => {
      expect(() => validateBreakpointCondition('rax >')).toThrow('Invalid breakpoint condition');
      expect(() => validateBreakpointCondition('= = =')).toThrow('Invalid breakpoint condition');
    });
  });

  describe('evaluateBreakpointCondition', () => {
    const ctx = buildConditionContext({
      rax: '0x1000',
      rcx: '0x5',
      rdx: '0x0',
      rbx: '0xFF',
      rsp: '0x7FFFFFFF',
      rbp: '0x7FFFFFF0',
      rsi: '0x1',
      rdi: '0x2',
      r8: '0x0',
      r9: '0x0',
      r10: '0x0',
      r11: '0x0',
      r12: '0x0',
      r13: '0x0',
      r14: '0x0',
      r15: '0x0',
      rip: '0x401000',
      rflags: '0x202',
    });

    it('should return true when no condition is set', () => {
      expect(evaluateBreakpointCondition(undefined, ctx)).toBe(true);
      expect(evaluateBreakpointCondition('', ctx)).toBe(true);
    });

    it('should evaluate simple equality', () => {
      expect(evaluateBreakpointCondition('rax == 0x1000', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rax == 0x2000', ctx)).toBe(false);
    });

    it('should evaluate comparison operators', () => {
      expect(evaluateBreakpointCondition('rcx > 3', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rcx < 3', ctx)).toBe(false);
      expect(evaluateBreakpointCondition('rax >= 0x1000', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rbx <= 0xFF', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rdx != 5', ctx)).toBe(true);
    });

    it('should support x86-32 register aliases', () => {
      expect(evaluateBreakpointCondition('eax == 0x1000', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('ecx == 5', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('esp > 0', ctx)).toBe(true);
    });

    it('should support eip as rip alias', () => {
      expect(evaluateBreakpointCondition('eip == 0x401000', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rip == 0x401000', ctx)).toBe(true);
    });

    it('should support rflags/eflags', () => {
      // rflags = 0x202; check TF bit (0x100) is not set.
      // Note: use BigInt literals (n suffix) since registers are BigInt values.
      expect(evaluateBreakpointCondition('(rflags & 0x100n) == 0n', ctx)).toBe(true);
      // Check that bit 1 (0x2) is set
      expect(evaluateBreakpointCondition('(rflags & 2n) != 0n', ctx)).toBe(true);
    });

    it('should evaluate compound expressions with && and ||', () => {
      expect(evaluateBreakpointCondition('rax == 0x1000 && rcx == 5', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rax == 0x1000 && rcx == 99', ctx)).toBe(false);
      expect(evaluateBreakpointCondition('rax == 0x9999 || rcx == 5', ctx)).toBe(true);
      expect(evaluateBreakpointCondition('rax == 0x9999 || rcx == 99', ctx)).toBe(false);
    });

    it('should return false on evaluation errors', () => {
      // Reference to undefined variable
      expect(evaluateBreakpointCondition('foo > 5', ctx)).toBe(false);
      // Syntax errors (though these should be caught by validation)
      expect(evaluateBreakpointCondition('1 +', ctx)).toBe(false);
    });

    it('should handle empty context gracefully', () => {
      const emptyCtx = buildConditionContext({});
      // No register values known — still should not throw
      expect(evaluateBreakpointCondition('1 == 1', emptyCtx)).toBe(true);
    });
  });
});
