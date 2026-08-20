/**
 * ShiftExtend — Shift and register extension utilities extracted from CpuEngine.
 *
 * These functions implement AArch64 shift types (LSL/LSR/ASR/ROR) and extended
 * register operations (UXTB/UXTH/UXTW/SXTB/SXTH/SXTW/etc.) used by data-processing
 * and load/store instructions.
 */

import { signExtend } from './BitOperations';

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;

/**
 * Apply an ARM64 shift (LSL/LSR/ASR/ROR) to a register operand.
 * Used by data-processing register instructions and load/store register-offset.
 *
 * @param value - The register value to shift
 * @param shiftType - 0b00=LSL, 0b01=LSR, 0b10=ASR, 0b11=ROR
 * @param amount - Shift amount in bits (0-63 for 64-bit, 0-31 for 32-bit)
 * @param sf - Size flag (1=64-bit, 0=32-bit)
 */
export function applyShift(value: bigint, shiftType: number, amount: number, sf: number): bigint {
  if (amount === 0) return value;
  const mask = sf === 1 ? MASK64 : MASK32;
  const width = sf === 1 ? 64n : 32n;
  const amt = BigInt(amount);
  switch (shiftType) {
    case 0b00: // LSL (Logical Shift Left)
      return (value << amt) & mask;
    case 0b01: // LSR (Logical Shift Right)
      return (value & mask) >> amt;
    case 0b10: {
      // ASR (Arithmetic Shift Right) — sign-extend from the operand width.
      const signBit = 1n << (width - 1n);
      const signed = value & mask & signBit ? (value & mask) - (1n << width) : value & mask;
      return (signed >> amt) & mask;
    }
    case 0b11: {
      // ROR (Rotate Right) — rotate right within the operand width.
      const v = value & mask;
      const a = amt % width;
      return ((v >> a) | (v << (width - a))) & mask;
    }
    default:
      throw new Error(`Unsupported shift type ${shiftType}`);
  }
}

/**
 * Apply an extended-register operation (UXTB..SXTX) used by ADD/SUB extended
 * register and the LDR/STR register-offset form: extract the low byte/half/
 * word/dword, zero- or sign-extend it, then left-shift by `shift`.
 *
 * @param value - The register value to extend
 * @param option - Extension type (0b000=UXTB, 0b001=UXTH, 0b010=UXTW, 0b011=UXTX,
 *                                  0b100=SXTB, 0b101=SXTH, 0b110=SXTW, 0b111=SXTX)
 * @param shift - Left-shift amount applied after extension (0-4)
 * @param sf - Size flag (1=64-bit, 0=32-bit)
 */
export function extendReg(value: bigint, option: number, shift: number, sf: number): bigint {
  const mask = sf === 1 ? MASK64 : MASK32;
  let extracted: bigint;
  switch (option) {
    case 0b000: // UXTB (zero-extend byte)
      extracted = value & 0xffn;
      break;
    case 0b001: // UXTH (zero-extend halfword)
      extracted = value & 0xffffn;
      break;
    case 0b010: // UXTW (zero-extend word)
      extracted = value & 0xffffffffn;
      break;
    case 0b011: // UXTX (no extension, 64-bit)
      extracted = value & MASK64;
      break;
    case 0b100: // SXTB (sign-extend byte)
      extracted = BigInt.asUintN(64, signExtend(value, 8));
      break;
    case 0b101: // SXTH (sign-extend halfword)
      extracted = BigInt.asUintN(64, signExtend(value, 16));
      break;
    case 0b110: // SXTW (sign-extend word)
      extracted = BigInt.asUintN(64, signExtend(value, 32));
      break;
    default: // SXTX (0b111, sign-extend 64-bit, no-op)
      extracted = value & MASK64;
      break;
  }
  return (extracted << BigInt(shift)) & mask;
}
