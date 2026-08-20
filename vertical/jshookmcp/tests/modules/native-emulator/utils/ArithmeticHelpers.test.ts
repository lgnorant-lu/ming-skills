/**
 * Unit tests for ArithmeticHelpers — flag-setting arithmetic and condition evaluation.
 *
 * Tests addWithFlags, subWithFlags, conditionHolds for all 16 condition codes,
 * and edge cases including overflow, carry, and signed/unsigned boundaries.
 */

import { describe, test, expect } from 'vitest';
import {
  addWithFlags,
  subWithFlags,
  conditionHolds,
  type FlagSetter,
  type FlagReader,
} from '@modules/native-emulator/utils/ArithmeticHelpers.js';

/** Mock flag storage for testing */
class MockFlags implements FlagSetter, FlagReader {
  n = false;
  z = false;
  c = false;
  v = false;

  setFlags(n: boolean, z: boolean, c: boolean, v: boolean): void {
    this.n = n;
    this.z = z;
    this.c = c;
    this.v = v;
  }
}

describe('ArithmeticHelpers', () => {
  describe('addWithFlags', () => {
    test('adds two positive 32-bit numbers without overflow', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x1000n, 0x2000n, 0);
      expect(result).toBe(0x3000n);
      expect(flags.n).toBe(false);
      expect(flags.z).toBe(false);
      expect(flags.c).toBe(false);
      expect(flags.v).toBe(false);
    });

    test('adds two positive 64-bit numbers without overflow', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x1000_0000_0000n, 0x2000_0000_0000n, 1);
      expect(result).toBe(0x3000_0000_0000n);
      expect(flags.n).toBe(false);
      expect(flags.z).toBe(false);
      expect(flags.c).toBe(false);
      expect(flags.v).toBe(false);
    });

    test('sets Z flag when result is zero', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0n, 0n, 1);
      expect(result).toBe(0n);
      expect(flags.z).toBe(true);
    });

    test('sets N flag when result is negative (32-bit)', () => {
      const flags = new MockFlags();
      addWithFlags(flags, 0x80000000n, 0x10000000n, 0);
      expect(flags.n).toBe(true);
    });

    test('sets C flag on unsigned carry-out (32-bit)', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0xffffffffn, 0x1n, 0);
      expect(result).toBe(0n); // wrapped to 0
      expect(flags.c).toBe(true);
      expect(flags.z).toBe(true);
    });

    test('sets C flag on unsigned carry-out (64-bit)', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0xffffffffffffffffn, 0x1n, 1);
      expect(result).toBe(0n);
      expect(flags.c).toBe(true);
      expect(flags.z).toBe(true);
    });

    test('sets V flag on signed overflow (positive + positive = negative)', () => {
      const flags = new MockFlags();
      // 0x7fffffff + 1 = 0x80000000 (overflow in 32-bit signed)
      const result = addWithFlags(flags, 0x7fffffffn, 0x1n, 0);
      expect(result).toBe(0x80000000n);
      expect(flags.v).toBe(true);
      expect(flags.n).toBe(true);
    });

    test('sets V flag on signed overflow (negative + negative = positive)', () => {
      const flags = new MockFlags();
      // 0x80000000 + 0x80000000 = 0x00000000 (overflow in 32-bit signed)
      const result = addWithFlags(flags, 0x80000000n, 0x80000000n, 0);
      expect(result).toBe(0n);
      expect(flags.v).toBe(true);
      expect(flags.c).toBe(true);
    });

    test('does not set V flag when no signed overflow', () => {
      const flags = new MockFlags();
      addWithFlags(flags, 0x1n, 0x2n, 0);
      expect(flags.v).toBe(false);
    });

    test('ADC: adds with carry-in (32-bit)', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x1000n, 0x2000n, 0, 1n);
      expect(result).toBe(0x3001n);
    });

    test('ADC: carry-in causes carry-out (32-bit)', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0xffffffffn, 0n, 0, 1n);
      expect(result).toBe(0n);
      expect(flags.c).toBe(true);
      expect(flags.z).toBe(true);
    });

    test('masks operands to 32-bit when sf=0', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x1_ffff_ffffn, 0x1n, 0);
      expect(result).toBe(0n); // (0xffffffff + 1) & 0xffffffff = 0
      expect(flags.c).toBe(true);
    });

    test('handles 64-bit boundary (INT64_MAX + 1)', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x7fffffffffffffffn, 0x1n, 1);
      expect(result).toBe(0x8000000000000000n);
      expect(flags.v).toBe(true); // signed overflow
      expect(flags.n).toBe(true);
    });
  });

  describe('subWithFlags', () => {
    test('subtracts two positive 32-bit numbers', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x3000n, 0x1000n, 0);
      expect(result).toBe(0x2000n);
      expect(flags.n).toBe(false);
      expect(flags.z).toBe(false);
      expect(flags.c).toBe(true); // no borrow
      expect(flags.v).toBe(false);
    });

    test('sets Z flag when result is zero', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x1234n, 0x1234n, 1);
      expect(result).toBe(0n);
      expect(flags.z).toBe(true);
      expect(flags.c).toBe(true); // no borrow (a >= b)
    });

    test('sets N flag when result is negative (32-bit)', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x1000n, 0x2000n, 0);
      expect(result).toBe(0xfffff000n); // wrapped (negative as unsigned)
      expect(flags.n).toBe(true);
    });

    test('clears C flag on unsigned borrow (a < b)', () => {
      const flags = new MockFlags();
      subWithFlags(flags, 0x1000n, 0x2000n, 0);
      expect(flags.c).toBe(false); // borrow occurred
    });

    test('sets C flag when no borrow (a >= b)', () => {
      const flags = new MockFlags();
      subWithFlags(flags, 0x5000n, 0x2000n, 0);
      expect(flags.c).toBe(true);
    });

    test('sets V flag on signed overflow (positive - negative = overflow)', () => {
      const flags = new MockFlags();
      // 0x7fffffff - 0x80000000 = overflow in 32-bit signed
      const result = subWithFlags(flags, 0x7fffffffn, 0x80000000n, 0);
      expect(result).toBe(0xffffffffn);
      expect(flags.v).toBe(true);
    });

    test('sets V flag on signed overflow (negative - positive = overflow)', () => {
      const flags = new MockFlags();
      // 0x80000000 - 0x1 = 0x7fffffff (overflow in 32-bit signed)
      const result = subWithFlags(flags, 0x80000000n, 0x1n, 0);
      expect(result).toBe(0x7fffffffn);
      expect(flags.v).toBe(true);
    });

    test('does not set V flag when no signed overflow', () => {
      const flags = new MockFlags();
      subWithFlags(flags, 0x5n, 0x3n, 0);
      expect(flags.v).toBe(false);
    });

    test('handles 64-bit subtraction', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x1_0000_0000_0000n, 0x1000n, 1);
      expect(result).toBe(0xffff_ffff_f000n);
    });

    test('handles 32-bit boundary (0 - 1)', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0n, 0x1n, 0);
      expect(result).toBe(0xffffffffn); // wrapped
      expect(flags.c).toBe(false); // borrow
      expect(flags.n).toBe(true);
    });

    test('handles 64-bit boundary (INT64_MIN - 1)', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x8000000000000000n, 0x1n, 1);
      expect(result).toBe(0x7fffffffffffffffn);
      expect(flags.v).toBe(true); // signed overflow
    });

    test('masks operands to 32-bit when sf=0', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0x1_0000_0000n, 0x1n, 0);
      expect(result).toBe(0xffffffffn); // (0 - 1) & 0xffffffff
    });
  });

  describe('conditionHolds - EQ/NE', () => {
    test('EQ (0x0) holds when Z=1', () => {
      const flags = new MockFlags();
      flags.z = true;
      expect(conditionHolds(flags, 0x0)).toBe(true);
    });

    test('EQ does not hold when Z=0', () => {
      const flags = new MockFlags();
      flags.z = false;
      expect(conditionHolds(flags, 0x0)).toBe(false);
    });

    test('NE (0x1) holds when Z=0', () => {
      const flags = new MockFlags();
      flags.z = false;
      expect(conditionHolds(flags, 0x1)).toBe(true);
    });

    test('NE does not hold when Z=1', () => {
      const flags = new MockFlags();
      flags.z = true;
      expect(conditionHolds(flags, 0x1)).toBe(false);
    });
  });

  describe('conditionHolds - CS/CC (HS/LO)', () => {
    test('CS/HS (0x2) holds when C=1', () => {
      const flags = new MockFlags();
      flags.c = true;
      expect(conditionHolds(flags, 0x2)).toBe(true);
    });

    test('CS/HS does not hold when C=0', () => {
      const flags = new MockFlags();
      flags.c = false;
      expect(conditionHolds(flags, 0x2)).toBe(false);
    });

    test('CC/LO (0x3) holds when C=0', () => {
      const flags = new MockFlags();
      flags.c = false;
      expect(conditionHolds(flags, 0x3)).toBe(true);
    });

    test('CC/LO does not hold when C=1', () => {
      const flags = new MockFlags();
      flags.c = true;
      expect(conditionHolds(flags, 0x3)).toBe(false);
    });
  });

  describe('conditionHolds - MI/PL', () => {
    test('MI (0x4) holds when N=1', () => {
      const flags = new MockFlags();
      flags.n = true;
      expect(conditionHolds(flags, 0x4)).toBe(true);
    });

    test('MI does not hold when N=0', () => {
      const flags = new MockFlags();
      flags.n = false;
      expect(conditionHolds(flags, 0x4)).toBe(false);
    });

    test('PL (0x5) holds when N=0', () => {
      const flags = new MockFlags();
      flags.n = false;
      expect(conditionHolds(flags, 0x5)).toBe(true);
    });

    test('PL does not hold when N=1', () => {
      const flags = new MockFlags();
      flags.n = true;
      expect(conditionHolds(flags, 0x5)).toBe(false);
    });
  });

  describe('conditionHolds - VS/VC', () => {
    test('VS (0x6) holds when V=1', () => {
      const flags = new MockFlags();
      flags.v = true;
      expect(conditionHolds(flags, 0x6)).toBe(true);
    });

    test('VS does not hold when V=0', () => {
      const flags = new MockFlags();
      flags.v = false;
      expect(conditionHolds(flags, 0x6)).toBe(false);
    });

    test('VC (0x7) holds when V=0', () => {
      const flags = new MockFlags();
      flags.v = false;
      expect(conditionHolds(flags, 0x7)).toBe(true);
    });

    test('VC does not hold when V=1', () => {
      const flags = new MockFlags();
      flags.v = true;
      expect(conditionHolds(flags, 0x7)).toBe(false);
    });
  });

  describe('conditionHolds - HI/LS', () => {
    test('HI (0x8) holds when C=1 and Z=0', () => {
      const flags = new MockFlags();
      flags.c = true;
      flags.z = false;
      expect(conditionHolds(flags, 0x8)).toBe(true);
    });

    test('HI does not hold when C=0', () => {
      const flags = new MockFlags();
      flags.c = false;
      flags.z = false;
      expect(conditionHolds(flags, 0x8)).toBe(false);
    });

    test('HI does not hold when Z=1', () => {
      const flags = new MockFlags();
      flags.c = true;
      flags.z = true;
      expect(conditionHolds(flags, 0x8)).toBe(false);
    });

    test('LS (0x9) holds when C=0 or Z=1', () => {
      const flags = new MockFlags();
      flags.c = false;
      flags.z = false;
      expect(conditionHolds(flags, 0x9)).toBe(true);
      flags.c = true;
      flags.z = true;
      expect(conditionHolds(flags, 0x9)).toBe(true);
    });

    test('LS does not hold when C=1 and Z=0', () => {
      const flags = new MockFlags();
      flags.c = true;
      flags.z = false;
      expect(conditionHolds(flags, 0x9)).toBe(false);
    });
  });

  describe('conditionHolds - GE/LT', () => {
    test('GE (0xA) holds when N=V', () => {
      const flags = new MockFlags();
      flags.n = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xa)).toBe(true);
      flags.n = false;
      flags.v = false;
      expect(conditionHolds(flags, 0xa)).toBe(true);
    });

    test('GE does not hold when N≠V', () => {
      const flags = new MockFlags();
      flags.n = true;
      flags.v = false;
      expect(conditionHolds(flags, 0xa)).toBe(false);
      flags.n = false;
      flags.v = true;
      expect(conditionHolds(flags, 0xa)).toBe(false);
    });

    test('LT (0xB) holds when N≠V', () => {
      const flags = new MockFlags();
      flags.n = true;
      flags.v = false;
      expect(conditionHolds(flags, 0xb)).toBe(true);
      flags.n = false;
      flags.v = true;
      expect(conditionHolds(flags, 0xb)).toBe(true);
    });

    test('LT does not hold when N=V', () => {
      const flags = new MockFlags();
      flags.n = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xb)).toBe(false);
    });
  });

  describe('conditionHolds - GT/LE', () => {
    test('GT (0xC) holds when Z=0 and N=V', () => {
      const flags = new MockFlags();
      flags.z = false;
      flags.n = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xc)).toBe(true);
      flags.n = false;
      flags.v = false;
      expect(conditionHolds(flags, 0xc)).toBe(true);
    });

    test('GT does not hold when Z=1', () => {
      const flags = new MockFlags();
      flags.z = true;
      flags.n = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xc)).toBe(false);
    });

    test('GT does not hold when N≠V', () => {
      const flags = new MockFlags();
      flags.z = false;
      flags.n = true;
      flags.v = false;
      expect(conditionHolds(flags, 0xc)).toBe(false);
    });

    test('LE (0xD) holds when Z=1 or N≠V', () => {
      const flags = new MockFlags();
      flags.z = true;
      flags.n = false;
      flags.v = false;
      expect(conditionHolds(flags, 0xd)).toBe(true);
      flags.z = false;
      flags.n = true;
      flags.v = false;
      expect(conditionHolds(flags, 0xd)).toBe(true);
    });

    test('LE does not hold when Z=0 and N=V', () => {
      const flags = new MockFlags();
      flags.z = false;
      flags.n = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xd)).toBe(false);
    });
  });

  describe('conditionHolds - AL/NV', () => {
    test('AL (0xE) always holds', () => {
      const flags = new MockFlags();
      expect(conditionHolds(flags, 0xe)).toBe(true);
      flags.n = true;
      flags.z = true;
      flags.c = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xe)).toBe(true);
    });

    test('NV (0xF) always holds (behaves as AL)', () => {
      const flags = new MockFlags();
      expect(conditionHolds(flags, 0xf)).toBe(true);
      flags.n = true;
      flags.z = true;
      flags.c = true;
      flags.v = true;
      expect(conditionHolds(flags, 0xf)).toBe(true);
    });
  });

  describe('Edge cases and boundary tests', () => {
    test('addWithFlags with maximum 32-bit values', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0xffffffffn, 0xffffffffn, 0);
      expect(result).toBe(0xfffffffen);
      expect(flags.c).toBe(true);
    });

    test('addWithFlags with maximum 64-bit values', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0xffffffffffffffffn, 0xffffffffffffffffn, 1);
      expect(result).toBe(0xfffffffffffffffen);
      expect(flags.c).toBe(true);
    });

    test('subWithFlags from zero (32-bit)', () => {
      const flags = new MockFlags();
      const result = subWithFlags(flags, 0n, 0xffffffffn, 0);
      expect(result).toBe(0x1n);
      expect(flags.c).toBe(false); // borrow
    });

    test('addWithFlags preserves 32-bit masking with overflow', () => {
      const flags = new MockFlags();
      const result = addWithFlags(flags, 0x80000000n, 0x80000000n, 0);
      expect(result).toBe(0n);
      expect(flags.c).toBe(true);
      expect(flags.v).toBe(true);
    });

    test('all condition codes tested', () => {
      const flags = new MockFlags();
      // Verify all 16 codes don't throw
      for (let cond = 0; cond <= 0xf; cond++) {
        expect(() => conditionHolds(flags, cond)).not.toThrow();
      }
    });
  });
});
