/**
 * BitOperations — Pure bit manipulation utilities extracted from CpuEngine.
 *
 * These functions are stateless and perform common AArch64 bit operations:
 * sign extension, bit masking, bit/byte reversal, and leading-zero counting.
 * Extracted to reduce CpuEngine's line count and improve testability.
 */

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/**
 * Sign-extend the low `bits` of `value` to a signed JS-number-safe BigInt.
 * Used by SBFM, SXTB/SXTH/SXTW, and signed load instructions.
 */
export function signExtend(value: bigint, bits: number): bigint {
  const b = BigInt(bits);
  const signBit = 1n << (b - 1n);
  const masked = value & ((1n << b) - 1n);
  return masked & signBit ? masked - (1n << b) : masked;
}

/**
 * Decode a logical-immediate (N:immr:imms) into the replicated bitmask, per the
 * ARM ARM `DecodeBitMasks` pseudocode (immediate-only path, no tmask needed).
 * Used by AND/ORR/EOR/ANDS immediate. Throws on the reserved encoding.
 */
export function decodeBitMask(n: number, immr: number, imms: number, sf: number): bigint {
  // len = highest set bit of (N:NOT(imms)); element size esize = 2^len.
  const combined = (n << 6) | (~imms & 0x3f);
  let len = -1;
  for (let i = 6; i >= 0; i--) {
    if ((combined >> i) & 1) {
      len = i;
      break;
    }
  }
  if (len < 1)
    throw new Error(`Reserved logical-immediate encoding (N=${n}, imms=0x${imms.toString(16)})`);
  const esize = 1 << len;
  const levels = esize - 1;
  const s = imms & levels;
  const r = immr & levels;
  if (s === levels) throw new Error('Reserved logical-immediate encoding (imms all-ones)');
  // welem = Ones(S+1), rotated right by R within the element, then replicated.
  const esizeB = BigInt(esize);
  const welem = (1n << BigInt(s + 1)) - 1n;
  const rB = BigInt(r);
  const rotated = ((welem >> rB) | (welem << (esizeB - rB))) & ((1n << esizeB) - 1n);
  // Replicate the element across the 64- or 32-bit register width.
  const regWidth = sf === 1 ? 64 : 32;
  let result = 0n;
  for (let pos = 0; pos < regWidth; pos += esize) {
    result |= rotated << BigInt(pos);
  }
  const mask = sf === 1 ? MASK64 : MASK32;
  return result & mask;
}

/**
 * Reverse the bit order of the low `width` bits of `value`.
 * Used by the RBIT instruction.
 */
export function reverseBits(value: bigint, width: number): bigint {
  let result = 0n;
  let v = value;
  for (let i = 0; i < width; i++) {
    result = (result << 1n) | (v & 1n);
    v >>= 1n;
  }
  return result;
}

/**
 * Reverse `value` byte-wise within each `groupBytes`-sized lane of `width` bits.
 * Used by REV, REV16, REV32 instructions.
 */
export function reverseBytes(value: bigint, width: number, groupBytes: number): bigint {
  const totalBytes = width / 8;
  const bytes: bigint[] = [];
  let v = value;
  for (let i = 0; i < totalBytes; i++) {
    bytes.push(v & 0xffn);
    v >>= 8n;
  }
  // Reverse within each group of `groupBytes` little-endian bytes.
  let result = 0n;
  for (let g = 0; g < totalBytes; g += groupBytes) {
    for (let i = 0; i < groupBytes; i++) {
      const src = bytes[g + groupBytes - 1 - i] ?? 0n;
      result |= src << BigInt((g + i) * 8);
    }
  }
  return result;
}

/**
 * Count leading zeros of the low `width` bits of `value`.
 * Used by the CLZ instruction.
 */
export function countLeadingZeros(value: bigint, width: number): number {
  for (let i = width - 1; i >= 0; i--) {
    if ((value >> BigInt(i)) & 1n) return width - 1 - i;
  }
  return width;
}

/**
 * Count leading ones of the low `width` bits of `value`.
 * Used by the CLS instruction (count leading sign bits).
 */
export function countLeadingOnes(value: bigint, width: number): number {
  for (let i = width - 1; i >= 0; i--) {
    if (!((value >> BigInt(i)) & 1n)) return width - 1 - i;
  }
  return width;
}

/**
 * Find the position of the highest set bit (1-based from LSB).
 * Returns 0 if no bits are set.
 */
export function highestSetBit(value: bigint): number {
  if (value === 0n) return 0;
  let pos = 0;
  let v = value;
  while (v > 0n) {
    pos++;
    v >>= 1n;
  }
  return pos;
}

/**
 * Rotate `value` right by `amount` bits within a `width`-bit field.
 * Used by ROR instruction and EXTR when Rn==Rm.
 */
export function rotateRight(value: bigint, amount: number, width: number): bigint {
  const mask = (1n << BigInt(width)) - 1n;
  const v = value & mask;
  const amt = BigInt(amount % width);
  const w = BigInt(width);
  return ((v >> amt) | (v << (w - amt))) & mask;
}
