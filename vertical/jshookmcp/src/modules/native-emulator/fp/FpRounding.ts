/**
 * FpRounding — IEEE754-2008 compliant rounding modes for ARM64 FP operations
 *
 * Implements the 4 rounding modes defined in ARM Architecture Reference Manual
 * FPCR.RMode[23:22] and IEEE754-2008 Section 4.3.
 *
 * JavaScript's Math.round() uses "ties away from zero" which is NOT IEEE754
 * compliant, so we implement all modes manually.
 */

/**
 * ARM64 Rounding Modes (FPCR.RMode bits 23:22)
 * Maps to IEEE754-2008 rounding attributes
 */
export enum RoundingMode {
  /** RN (00): Round to Nearest, ties to even (IEEE754 roundTiesToEven) */
  RN = 0,
  /** RP (01): Round toward Plus infinity (IEEE754 roundTowardPositive) */
  RP = 1,
  /** RM (10): Round toward Minus infinity (IEEE754 roundTowardNegative) */
  RM = 2,
  /** RZ (11): Round toward Zero (IEEE754 roundTowardZero) */
  RZ = 3,
}

/**
 * Round a float to an integer value using the specified rounding mode.
 * Result remains a floating-point number (e.g., 2.7 → 3.0, not integer 3).
 *
 * Used by FRINT* instructions (FRINTN/FRINTP/FRINTM/FRINTZ).
 *
 * @param value - The floating-point value to round
 * @param mode - One of the 4 ARM64 rounding modes
 * @returns Rounded value as a float
 */
export function roundToInt(value: number, mode: RoundingMode): number {
  // Handle special cases first (avoid unnecessary computation)
  if (!Number.isFinite(value)) return value; // ±Inf, NaN pass through
  if (value === 0) return value; // ±0 pass through (preserve sign)

  switch (mode) {
    case RoundingMode.RN:
      return roundTiesToEven(value);
    case RoundingMode.RP:
      return Math.ceil(value);
    case RoundingMode.RM:
      return Math.floor(value);
    case RoundingMode.RZ:
      return Math.trunc(value);
  }
}

/**
 * Round to nearest integer, ties go to the even number (IEEE754 default).
 *
 * Examples:
 *   2.5 → 2 (even)
 *   3.5 → 4 (even)
 *   2.4 → 2 (nearest)
 *   2.6 → 3 (nearest)
 *  -2.5 → -2 (even)
 *
 * This is different from Math.round() which uses "ties away from zero":
 *   Math.round(2.5) → 3 ❌ (wrong for IEEE754)
 *   roundTiesToEven(2.5) → 2 ✅
 *
 * Algorithm: for exact half-way cases (frac === 0.5), pick the floor if it's
 * even, otherwise ceil. For non-half-way cases, use standard nearest logic.
 */
export function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  const frac = value - floor;

  // Not a tie → use standard rounding
  if (frac < 0.5) return floor;
  if (frac > 0.5) return floor + 1;

  // Exact tie (frac === 0.5) → round to even
  // Check if floor is even using bitwise AND (works for safe integers)
  // For large numbers, use modulo fallback
  if (Math.abs(floor) <= Number.MAX_SAFE_INTEGER) {
    return (floor & 1) === 0 ? floor : floor + 1;
  } else {
    return floor % 2 === 0 ? floor : floor + 1;
  }
}

/**
 * Round toward +∞ (ceiling).
 * Always rounds up for positive, toward zero for negative.
 *
 * Examples:
 *   2.1 → 3
 *   2.9 → 3
 *  -2.1 → -2
 *  -2.9 → -2
 *
 * Delegates to Math.ceil for correctness.
 */
export function roundTowardPlusInf(value: number): number {
  return Math.ceil(value);
}

/**
 * Round toward -∞ (floor).
 * Always rounds down for positive, away from zero for negative.
 *
 * Examples:
 *   2.1 → 2
 *   2.9 → 2
 *  -2.1 → -3
 *  -2.9 → -3
 *
 * Delegates to Math.floor for correctness.
 */
export function roundTowardMinusInf(value: number): number {
  return Math.floor(value);
}

/**
 * Round toward zero (truncate).
 * Removes fractional part, always moves toward 0.
 *
 * Examples:
 *   2.1 → 2
 *   2.9 → 2
 *  -2.1 → -2
 *  -2.9 → -2
 *
 * Delegates to Math.trunc for correctness.
 */
export function roundTowardZero(value: number): number {
  return Math.trunc(value);
}

/**
 * Apply rounding to a float based on precision (float32 vs float64).
 * Float32 results must be rounded through Math.fround to match hardware.
 *
 * @param value - The value to round
 * @param is32bit - True for float32, false for float64
 * @param mode - Rounding mode (from FPCR)
 * @returns Rounded value at the correct precision
 */
export function applyPrecisionRounding(
  value: number,
  is32bit: boolean,
  _mode: RoundingMode,
): number {
  // For float64, rounding mode only affects operations that need explicit rounding
  // (like FRINT*). For arithmetic, JS double precision is bit-exact.
  if (!is32bit) return value;

  // For float32, always round to single precision
  // Math.fround performs the IEEE754 single-precision rounding
  return Math.fround(value);
}
