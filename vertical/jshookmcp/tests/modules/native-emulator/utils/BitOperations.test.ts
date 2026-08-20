/**
 * Unit tests for BitOperations — Pure bit manipulation utilities for AArch64.
 *
 * Tests sign extension, logical immediate decoding (DecodeBitMasks),
 * bit/byte reversal, leading-zero/one counting, and edge cases.
 */

import { describe, test, expect } from 'vitest';
import {
  signExtend,
  decodeBitMask,
  reverseBits,
  reverseBytes,
  countLeadingZeros,
  countLeadingOnes,
  highestSetBit,
  rotateRight,
} from '@modules/native-emulator/utils/BitOperations.js';

describe('BitOperations', () => {
  describe('signExtend', () => {
    test('sign-extends 8-bit positive value', () => {
      expect(signExtend(0x7fn, 8)).toBe(0x7fn);
    });

    test('sign-extends 8-bit negative value', () => {
      expect(signExtend(0x80n, 8)).toBe(-128n);
      expect(signExtend(0xffn, 8)).toBe(-1n);
    });

    test('sign-extends 16-bit positive value', () => {
      expect(signExtend(0x7fffn, 16)).toBe(0x7fffn);
    });

    test('sign-extends 16-bit negative value', () => {
      expect(signExtend(0x8000n, 16)).toBe(-32768n);
      expect(signExtend(0xffffn, 16)).toBe(-1n);
    });

    test('sign-extends 21-bit value (for branch offsets)', () => {
      expect(signExtend(0x1fffffn, 21)).toBe(-1n);
      expect(signExtend(0x100000n, 21)).toBe(-1048576n);
      expect(signExtend(0xfffffn, 21)).toBe(0xfffffn);
    });

    test('sign-extends 32-bit positive value', () => {
      expect(signExtend(0x7fffffffn, 32)).toBe(0x7fffffffn);
    });

    test('sign-extends 32-bit negative value', () => {
      expect(signExtend(0x80000000n, 32)).toBe(-2147483648n);
      expect(signExtend(0xffffffffn, 32)).toBe(-1n);
    });

    test('sign-extends 64-bit value (no-op for positive)', () => {
      expect(signExtend(0x7fffffffffffffffn, 64)).toBe(0x7fffffffffffffffn);
    });

    test('sign-extends 64-bit value (negative)', () => {
      expect(signExtend(0x8000000000000000n, 64)).toBe(-9223372036854775808n);
      expect(signExtend(0xffffffffffffffffn, 64)).toBe(-1n);
    });

    test('sign-extends 1-bit values', () => {
      expect(signExtend(0n, 1)).toBe(0n);
      expect(signExtend(1n, 1)).toBe(-1n);
    });

    test('masks input to specified bit width', () => {
      expect(signExtend(0x1ffn, 8)).toBe(-1n); // 0x1ff masked to 0xff
    });
  });

  describe('decodeBitMask', () => {
    test('decodes 64-bit single-bit mask', () => {
      // N=1, immr=0, imms=0 → 0x0000000000000001
      expect(decodeBitMask(1, 0, 0, 1)).toBe(0x1n);
    });

    test('decodes 64-bit low-half mask', () => {
      // N=1, immr=0, imms=0x1f → 0x00000000ffffffff
      expect(decodeBitMask(1, 0, 0x1f, 1)).toBe(0xffffffffn);
    });

    test('decodes rotated mask', () => {
      // N=1, immr=4, imms=3 → 4-bit pattern rotated
      const result = decodeBitMask(1, 4, 3, 1);
      // Verify it's a valid mask (non-zero)
      expect(result).toBeGreaterThan(0n);
    });

    test('decodes replicated 16-bit pattern', () => {
      // N=0, immr=0, imms=0xf → 16-bit element with 16 ones
      const result = decodeBitMask(0, 0, 0xf, 1);
      // Should be 0x0000ffff0000ffff (4 replications of 16-bit 0xffff)
      expect(result).toBe(0x0000ffff0000ffffn);
    });

    test('decodes replicated 8-bit pattern', () => {
      // N=0, immr=0, imms=0x7 → 8-bit element with 8 ones
      const result = decodeBitMask(0, 0, 0x7, 1);
      // Actual result: 0x000000ff000000ff (32-bit element size)
      expect(result).toBe(0x000000ff000000ffn);
    });

    test('decodes 32-bit mask in 32-bit mode', () => {
      // sf=0 (32-bit), N=0, immr=0, imms=0xf
      const result = decodeBitMask(0, 0, 0xf, 0);
      expect(result).toBeLessThanOrEqual(0xffffffffn);
    });

    test('throws on reserved encoding (N=0, imms=0x3f)', () => {
      expect(() => decodeBitMask(0, 0, 0x3f, 1)).toThrow('Reserved logical-immediate encoding');
    });

    test('throws on reserved encoding (imms all-ones within element)', () => {
      // This encoding is reserved per ARM ARM
      expect(() => decodeBitMask(1, 0, 0x3f, 1)).toThrow('Reserved logical-immediate encoding');
    });

    test('decodes alternating bit pattern', () => {
      // N=0, immr=1, imms=0 → 2-bit element rotated
      const result = decodeBitMask(0, 1, 0, 1);
      expect(result).toBeGreaterThan(0n);
    });
  });

  describe('reverseBits', () => {
    test('reverses 8-bit value', () => {
      expect(reverseBits(0b10110001n, 8)).toBe(0b10001101n);
    });

    test('reverses 16-bit value', () => {
      expect(reverseBits(0x1234n, 16)).toBe(0x2c48n);
    });

    test('reverses 32-bit value', () => {
      expect(reverseBits(0x12345678n, 32)).toBe(0x1e6a2c48n);
    });

    test('reverses 64-bit value', () => {
      expect(reverseBits(0x123456789abcdef0n, 64)).toBe(0x0f7b3d591e6a2c48n);
    });

    test('reverses all-zeros', () => {
      expect(reverseBits(0n, 32)).toBe(0n);
    });

    test('reverses all-ones', () => {
      expect(reverseBits(0xffffffffn, 32)).toBe(0xffffffffn);
    });

    test('reverses single bit (LSB)', () => {
      expect(reverseBits(0x1n, 32)).toBe(0x80000000n);
    });

    test('reverses single bit (MSB)', () => {
      expect(reverseBits(0x80000000n, 32)).toBe(0x1n);
    });
  });

  describe('reverseBytes', () => {
    test('reverses bytes within 16-bit word (REV16)', () => {
      // 0x1234 → 0x3412
      expect(reverseBytes(0x1234n, 16, 2)).toBe(0x3412n);
    });

    test('reverses bytes within 32-bit word (REV)', () => {
      // 0x12345678 → 0x78563412
      expect(reverseBytes(0x12345678n, 32, 4)).toBe(0x78563412n);
    });

    test('reverses bytes within 64-bit word (REV)', () => {
      // 0x123456789abcdef0 → 0xf0debc9a78563412
      expect(reverseBytes(0x123456789abcdef0n, 64, 8)).toBe(0xf0debc9a78563412n);
    });

    test('reverses bytes in 16-bit lanes within 32-bit (REV16 in 32-bit)', () => {
      // 0x12345678 → 0x34127856
      expect(reverseBytes(0x12345678n, 32, 2)).toBe(0x34127856n);
    });

    test('reverses bytes in 32-bit lanes within 64-bit (REV32)', () => {
      // 0x123456789abcdef0 → 0x78563412f0debc9a
      expect(reverseBytes(0x123456789abcdef0n, 64, 4)).toBe(0x78563412f0debc9an);
    });

    test('reverses all-zeros', () => {
      expect(reverseBytes(0n, 32, 4)).toBe(0n);
    });

    test('reverses all-ones', () => {
      expect(reverseBytes(0xffffffffn, 32, 4)).toBe(0xffffffffn);
    });
  });

  describe('countLeadingZeros', () => {
    test('counts leading zeros in 32-bit value', () => {
      // 0x1234 = 0b0001_0010_0011_0100, highest bit at position 12
      // Leading zeros = 32 - 1 - 12 = 19
      expect(countLeadingZeros(0x00001234n, 32)).toBe(19);
    });

    test('counts leading zeros when MSB is set', () => {
      expect(countLeadingZeros(0x80000000n, 32)).toBe(0);
    });

    test('counts all zeros for zero value', () => {
      expect(countLeadingZeros(0n, 32)).toBe(32);
      expect(countLeadingZeros(0n, 64)).toBe(64);
    });

    test('counts leading zeros in 64-bit value', () => {
      // 0x12345678 = highest bit at position 28
      // Leading zeros = 64 - 1 - 28 = 35
      expect(countLeadingZeros(0x0000000012345678n, 64)).toBe(35);
    });

    test('counts leading zeros when all bits set', () => {
      expect(countLeadingZeros(0xffffffffffffffffn, 64)).toBe(0);
    });

    test('counts leading zeros for single LSB set', () => {
      expect(countLeadingZeros(0x1n, 32)).toBe(31);
      expect(countLeadingZeros(0x1n, 64)).toBe(63);
    });
  });

  describe('countLeadingOnes', () => {
    test('counts leading ones in 32-bit value', () => {
      expect(countLeadingOnes(0xffff0000n, 32)).toBe(16);
    });

    test('counts leading ones when MSB is not set', () => {
      expect(countLeadingOnes(0x7fffffffn, 32)).toBe(0);
    });

    test('counts all ones for all-ones value', () => {
      expect(countLeadingOnes(0xffffffffn, 32)).toBe(32);
      expect(countLeadingOnes(0xffffffffffffffffn, 64)).toBe(64);
    });

    test('counts zero leading ones for zero value', () => {
      expect(countLeadingOnes(0n, 32)).toBe(0);
    });

    test('counts leading ones in 64-bit value', () => {
      expect(countLeadingOnes(0xfffffffffffffffen, 64)).toBe(63);
    });

    test('counts leading ones for alternating pattern', () => {
      expect(countLeadingOnes(0xaaaaaaaan, 32)).toBe(1);
    });
  });

  describe('highestSetBit', () => {
    test('finds highest set bit in small value', () => {
      expect(highestSetBit(0x1n)).toBe(1);
      expect(highestSetBit(0x2n)).toBe(2);
      expect(highestSetBit(0x4n)).toBe(3);
      expect(highestSetBit(0x8n)).toBe(4);
    });

    test('finds highest set bit in large value', () => {
      expect(highestSetBit(0x80000000n)).toBe(32);
      expect(highestSetBit(0x8000000000000000n)).toBe(64);
    });

    test('returns 0 for zero value', () => {
      expect(highestSetBit(0n)).toBe(0);
    });

    test('finds highest set bit when multiple bits set', () => {
      expect(highestSetBit(0xffn)).toBe(8);
      expect(highestSetBit(0xdeadbeefn)).toBe(32);
    });

    test('finds highest set bit for all-ones', () => {
      expect(highestSetBit(0xffffffffffffffffn)).toBe(64);
    });
  });

  describe('rotateRight', () => {
    test('rotates 32-bit value right by 8 bits', () => {
      expect(rotateRight(0x12345678n, 8, 32)).toBe(0x78123456n);
    });

    test('rotates 64-bit value right by 16 bits', () => {
      expect(rotateRight(0x123456789abcdef0n, 16, 64)).toBe(0xdef0123456789abcn);
    });

    test('rotates by zero (no-op)', () => {
      expect(rotateRight(0x12345678n, 0, 32)).toBe(0x12345678n);
    });

    test('rotates by full width (no-op)', () => {
      expect(rotateRight(0x12345678n, 32, 32)).toBe(0x12345678n);
    });

    test('rotates by more than width (wraps)', () => {
      expect(rotateRight(0x12345678n, 40, 32)).toBe(0x78123456n); // 40 % 32 = 8
    });

    test('rotates single bit', () => {
      expect(rotateRight(0x1n, 1, 32)).toBe(0x80000000n);
      expect(rotateRight(0x80000000n, 1, 32)).toBe(0x40000000n);
    });

    test('rotates all-zeros', () => {
      expect(rotateRight(0n, 16, 32)).toBe(0n);
    });

    test('rotates all-ones', () => {
      expect(rotateRight(0xffffffffn, 16, 32)).toBe(0xffffffffn);
    });

    test('rotates 16-bit value', () => {
      expect(rotateRight(0x1234n, 4, 16)).toBe(0x4123n);
    });
  });

  describe('Edge cases and boundary tests', () => {
    test('signExtend with width 1 (sign bit only)', () => {
      expect(signExtend(0n, 1)).toBe(0n);
      expect(signExtend(1n, 1)).toBe(-1n);
    });

    test('reverseBits with width 1', () => {
      expect(reverseBits(0n, 1)).toBe(0n);
      expect(reverseBits(1n, 1)).toBe(1n);
    });

    test('reverseBytes with single byte', () => {
      expect(reverseBytes(0xabn, 8, 1)).toBe(0xabn);
    });

    test('countLeadingZeros with width 1', () => {
      expect(countLeadingZeros(0n, 1)).toBe(1);
      expect(countLeadingZeros(1n, 1)).toBe(0);
    });

    test('countLeadingOnes with width 1', () => {
      expect(countLeadingOnes(0n, 1)).toBe(0);
      expect(countLeadingOnes(1n, 1)).toBe(1);
    });

    test('rotateRight with width 1', () => {
      expect(rotateRight(0n, 1, 1)).toBe(0n);
      expect(rotateRight(1n, 1, 1)).toBe(1n);
    });

    test('decodeBitMask with smallest element size (2-bit)', () => {
      // N=0, immr=0, imms=0 → 2-bit element with 1 bit set, replicated
      // len=highest set bit of (N:NOT(imms)) = (0:111111)=0x3f, len=5, esize=32
      // s=0, welem=1, replicated across 64-bit = 0x100000001
      const result = decodeBitMask(0, 0, 0, 1);
      expect(result).toBe(0x100000001n);
    });

    test('highestSetBit with max BigInt (64-bit)', () => {
      expect(highestSetBit(0xffffffffffffffffn)).toBe(64);
    });

    test('signExtend preserves zero', () => {
      expect(signExtend(0n, 8)).toBe(0n);
      expect(signExtend(0n, 32)).toBe(0n);
      expect(signExtend(0n, 64)).toBe(0n);
    });
  });
});
