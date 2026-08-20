/**
 * ArithmeticHelpers — flag-setting arithmetic and condition evaluation.
 *
 * Extracted from CpuEngine to allow instruction family executors to share
 * these helpers without duplicating the flag-update logic. Each helper is
 * stateless and accepts a flag setter callback, making them reusable across
 * different execution contexts.
 */

export interface FlagSetter {
  setFlags(n: boolean, z: boolean, c: boolean, v: boolean): void;
}

export interface FlagReader {
  readonly n: boolean;
  readonly z: boolean;
  readonly c: boolean;
  readonly v: boolean;
}

/**
 * Compute operand1 + operand2 at the given width, update NZCV, and return the
 * (width-masked) result. C = unsigned carry-out, V = signed overflow, matching
 * AArch64 ADDS semantics. ADC adds an incoming carry bit.
 */
export function addWithFlags(
  flagSetter: FlagSetter,
  operand1: bigint,
  operand2: bigint,
  sf: number,
  carryIn = 0n,
): bigint {
  const width = sf === 1 ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const a = operand1 & mask;
  const b = operand2 & mask;
  const full = a + b + carryIn;
  const result = full & mask;
  const n = result >> (width - 1n) === 1n;
  const z = result === 0n;
  const c = full > mask; // unsigned carry-out
  const signA = (a >> (width - 1n)) & 1n;
  const signB = (b >> (width - 1n)) & 1n;
  const signR = (result >> (width - 1n)) & 1n;
  const v = signA === signB && signA !== signR; // signed overflow
  flagSetter.setFlags(n, z, c, v);
  return result;
}

/**
 * Compute operand1 - operand2 at the given width, update NZCV, and return the
 * (width-masked) result. Subtraction is add-with-carry of ~operand2 + 1, so
 * C = "no borrow" and V = signed overflow, matching AArch64 SUBS semantics.
 */
export function subWithFlags(
  flagSetter: FlagSetter,
  operand1: bigint,
  operand2: bigint,
  sf: number,
): bigint {
  const width = sf === 1 ? 64n : 32n;
  const mask = (1n << width) - 1n;
  const a = operand1 & mask;
  const b = operand2 & mask;
  const result = (a - b) & mask;
  const n = result >> (width - 1n) === 1n;
  const z = result === 0n;
  const c = a >= b; // unsigned: no borrow occurred
  const signA = (a >> (width - 1n)) & 1n;
  const signB = (b >> (width - 1n)) & 1n;
  const signR = (result >> (width - 1n)) & 1n;
  const v = signA !== signB && signA !== signR; // signed overflow
  flagSetter.setFlags(n, z, c, v);
  return result;
}

/**
 * Evaluate an AArch64 condition code against the current NZCV flags.
 * Used by conditional branches, CSEL family, and CCMP/CCMN.
 *
 * Condition codes (bits[3:0]):
 *   0000 (0x0) EQ   — Z == 1
 *   0001 (0x1) NE   — Z == 0
 *   0010 (0x2) CS   — C == 1 (unsigned >=, also HS)
 *   0011 (0x3) CC   — C == 0 (unsigned <,  also LO)
 *   0100 (0x4) MI   — N == 1 (negative)
 *   0101 (0x5) PL   — N == 0 (positive or zero)
 *   0110 (0x6) VS   — V == 1 (signed overflow)
 *   0111 (0x7) VC   — V == 0 (no signed overflow)
 *   1000 (0x8) HI   — C == 1 && Z == 0 (unsigned >)
 *   1001 (0x9) LS   — C == 0 || Z == 1 (unsigned <=)
 *   1010 (0xA) GE   — N == V (signed >=)
 *   1011 (0xB) LT   — N != V (signed <)
 *   1100 (0xC) GT   — Z == 0 && N == V (signed >)
 *   1101 (0xD) LE   — Z == 1 || N != V (signed <=)
 *   1110 (0xE) AL   — always (used for unconditional forms)
 *   1111 (0xF) NV   — always (reserved, behaves as AL)
 */
export function conditionHolds(flagReader: FlagReader, cond: number): boolean {
  const n = flagReader.n;
  const z = flagReader.z;
  const c = flagReader.c;
  const v = flagReader.v;
  switch (cond >> 1) {
    case 0b000:
      return cond & 1 ? !z : z; // EQ / NE
    case 0b001:
      return cond & 1 ? !c : c; // CS(HS) / CC(LO)
    case 0b010:
      return cond & 1 ? !n : n; // MI / PL
    case 0b011:
      return cond & 1 ? !v : v; // VS / VC
    case 0b100:
      return cond & 1 ? !(c && !z) : c && !z; // HI / LS
    case 0b101:
      return cond & 1 ? n !== v : n === v; // GE / LT
    case 0b110:
      return cond & 1 ? !(!z && n === v) : !z && n === v; // GT / LE
    default:
      return true; // AL / NV — always
  }
}
