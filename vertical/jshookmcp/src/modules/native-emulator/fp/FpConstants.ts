/**
 * FpConstants — IEEE754 floating-point constants for ARM64 FP exception handling
 *
 * Defines boundary values for float32/float64 precision and FPCR/FPSR bit positions
 * per ARM Architecture Reference Manual (ARM ARM) and IEEE754-2008 standard.
 *
 * Constants are sourced from:
 * - float32: IEEE754 single-precision (1 sign + 8 exp + 23 mantissa)
 * - float64: IEEE754 double-precision (1 sign + 11 exp + 52 mantissa)
 */

// ── IEEE754 Boundary Values ──

/**
 * Maximum representable float32 value (largest normal number).
 * Binary: 0x7F7FFFFF → (2 - 2^-23) × 2^127
 */
export const FLOAT32_MAX = 3.4028234663852886e38;

/**
 * Minimum positive float32 normal value.
 * Binary: 0x00800000 → 2^-126
 * Values below this (but > 0) are subnormal/denormal.
 */
export const FLOAT32_MIN_NORMAL = 1.1754943508222875e-38;

/**
 * Minimum positive float32 subnormal value.
 * Binary: 0x00000001 → 2^-149
 * Smallest representable non-zero float32.
 */
export const FLOAT32_MIN_SUBNORMAL = 1.401298464324817e-45;

/**
 * Maximum representable float64 value (largest normal number).
 * Binary: 0x7FEFFFFFFFFFFFFF → (2 - 2^-52) × 2^1023
 */
export const FLOAT64_MAX = 1.7976931348623157e308;

/**
 * Minimum positive float64 normal value.
 * Binary: 0x0010000000000000 → 2^-1022
 */
export const FLOAT64_MIN_NORMAL = 2.2250738585072014e-308;

/**
 * Minimum positive float64 subnormal value.
 * Binary: 0x0000000000000001 → 2^-1074
 */
export const FLOAT64_MIN_SUBNORMAL = 5e-324;

// ── NaN Constants ──

/**
 * Quiet NaN for float32 (default NaN result).
 * JS NaN is float64; Math.fround(NaN) produces float32 NaN.
 */
export const QNAN_F32 = NaN;

/**
 * Quiet NaN for float64 (default NaN result).
 */
export const QNAN_F64 = NaN;

// ── FPCR (Floating-Point Control Register) Bit Positions ──
// ARM ARM D19.2.35: FPCR controls FP behavior (rounding, flush-to-zero, traps)

/** IOE: Invalid Operation trap enable (bit 8) */
export const FPCR_IOE = 8;

/** DZE: Divide by Zero trap enable (bit 9) */
export const FPCR_DZE = 9;

/** OFE: Overflow trap enable (bit 10) */
export const FPCR_OFE = 10;

/** UFE: Underflow trap enable (bit 11) */
export const FPCR_UFE = 11;

/** IXE: Inexact trap enable (bit 12) */
export const FPCR_IXE = 12;

/** IDE: Input Denormal trap enable (bit 15) */
export const FPCR_IDE = 15;

/**
 * RMode: Rounding Mode (bits 23:22)
 * - 00: RN (Round to Nearest, ties to even)
 * - 01: RP (Round toward Plus infinity)
 * - 10: RM (Round toward Minus infinity)
 * - 11: RZ (Round toward Zero)
 */
export const FPCR_RMODE = 22;

/** FZ: Flush-to-Zero mode (bit 24) — denormals flush to ±0 */
export const FPCR_FZ = 24;

/** DN: Default NaN mode (bit 25) — ignore operand payloads, always return default qNaN */
export const FPCR_DN = 25;

/** AHP: Alternative Half-Precision (bit 26) — FP16 format control */
export const FPCR_AHP = 26;

// ── FPSR (Floating-Point Status Register) Bit Positions ──
// ARM ARM D19.2.36: FPSR accumulates FP exception flags

/** IOC: Invalid Operation cumulative flag (bit 0) */
export const FPSR_IOC = 0;

/** DZC: Divide by Zero cumulative flag (bit 1) */
export const FPSR_DZC = 1;

/** OFC: Overflow cumulative flag (bit 2) */
export const FPSR_OFC = 2;

/** UFC: Underflow cumulative flag (bit 3) */
export const FPSR_UFC = 3;

/** IXC: Inexact cumulative flag (bit 4) */
export const FPSR_IXC = 4;

/** IDC: Input Denormal cumulative flag (bit 7) */
export const FPSR_IDC = 7;

/** QC: Cumulative saturation flag (bit 27) — NEON integer saturation, not FP */
export const FPSR_QC = 27;

// ── Helper Bitmasks ──

/** Mask to extract RMode from FPCR (bits 23:22) */
export const FPCR_RMODE_MASK = 0x3 << FPCR_RMODE; // 0x00C00000

/** Mask for all FP exception trap enable bits in FPCR */
export const FPCR_TRAP_MASK =
  (1 << FPCR_IOE) |
  (1 << FPCR_DZE) |
  (1 << FPCR_OFE) |
  (1 << FPCR_UFE) |
  (1 << FPCR_IXE) |
  (1 << FPCR_IDE);

/** Mask for all cumulative exception flags in FPSR */
export const FPSR_EXCEPTION_MASK =
  (1 << FPSR_IOC) |
  (1 << FPSR_DZC) |
  (1 << FPSR_OFC) |
  (1 << FPSR_UFC) |
  (1 << FPSR_IXC) |
  (1 << FPSR_IDC);
