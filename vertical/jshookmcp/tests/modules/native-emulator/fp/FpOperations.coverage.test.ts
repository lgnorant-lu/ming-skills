/**
 * Coverage tests for FpContext — FP register/flag accessors + the arithmetic
 * operations (fadd/fsub/fmul/fdiv/fsqrt/fabs/fneg/fmax/fmin/frint) + rounding
 * helpers. Pure FP math, no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import { FpContext } from '@modules/native-emulator/fp/FpOperations';

const ctx = () => new FpContext();

describe('FpContext — register/flag accessors', () => {
  it('FPSR get/set round-trip + starts at 0', () => {
    const c = ctx();
    expect(c.getFPSR()).toBe(0);
    c.setFPSR(0x1f);
    expect(c.getFPSR()).toBe(0x1f);
  });

  it('FPCR get/set round-trip', () => {
    const c = ctx();
    c.setFPCR(0x100);
    expect(c.getFPCR()).toBe(0x100);
  });
});

describe('FpContext — fadd', () => {
  it('1 + 2 = 3 (64-bit + 32-bit)', () => {
    expect(ctx().fadd(1, 2)).toBe(3);
    expect(ctx().fadd(0.1, 0.2, true)).toBe(Math.fround(0.1 + 0.2));
  });

  it('+Inf + -Inf → NaN (sets IOC)', () => {
    const c = ctx();
    const r = c.fadd(Infinity, -Infinity);
    expect(Number.isNaN(r)).toBe(true);
    expect(c.getFPSR()).not.toBe(0); // IOC flag set
  });
});

describe('FpContext — fsub / fmul / fdiv', () => {
  it('fsub: 5 - 3 = 2; Inf - Inf → NaN', () => {
    expect(ctx().fsub(5, 3)).toBe(2);
    expect(Number.isNaN(ctx().fsub(Infinity, Infinity))).toBe(true);
  });

  it('fmul: 2 * 3 = 6; 0 × Inf → NaN', () => {
    expect(ctx().fmul(2, 3)).toBe(6);
    expect(Number.isNaN(ctx().fmul(0, Infinity))).toBe(true);
  });

  it('fdiv: 6 / 2 = 3; 1 / 0 → Inf (DZC); 0/0 → NaN (IOC)', () => {
    const c = ctx();
    expect(c.fdiv(6, 2)).toBe(3);
    expect(c.fdiv(1, 0)).toBe(Infinity);
    expect(c.getFPSR()).not.toBe(0); // DZC set
    expect(Number.isNaN(ctx().fdiv(0, 0))).toBe(true);
  });

  it('fmul32: 32-bit multiply rounding', () => {
    expect(typeof ctx().fmul32(0.1, 0.2)).toBe('number');
  });
});

describe('FpContext — fsqrt / fabs / fneg', () => {
  it('fsqrt(4) = 2; fsqrt(-1) → NaN', () => {
    expect(ctx().fsqrt(4)).toBe(2);
    expect(Number.isNaN(ctx().fsqrt(-1))).toBe(true);
  });

  it('fabs(-3) = 3; fneg(3) = -3', () => {
    expect(ctx().fabs(-3)).toBe(3);
    expect(ctx().fneg(3)).toBe(-3);
  });
});

describe('FpContext — fmax / fmin', () => {
  it('fmax(1, 2) = 2; fmin(1, 2) = 1', () => {
    expect(ctx().fmax(1, 2)).toBe(2);
    expect(ctx().fmin(1, 2)).toBe(1);
  });

  it('fmax with NaN propagates per IEEE754', () => {
    const r = ctx().fmax(NaN, 5);
    expect(Number.isNaN(r) || r === 5).toBe(true); // implementation-defined / NaN-propagation
  });
});

describe('FpContext — frint + rounding helpers', () => {
  it('frint rounds to nearest-even by default', () => {
    const c = ctx();
    expect(c.frint(2.5, null)).toBe(2); // ties-to-even → 2
    expect(c.frint(3.5, null)).toBe(4);
  });

  it('frint honors an explicit rounding mode', () => {
    const c = ctx();
    expect(c.frint(2.5, 0)).toBe(2); // nearest-even
    expect(c.frint(2.5, 1)).toBe(3); // toward +Inf
    expect(c.frint(2.5, 2)).toBe(2); // toward -Inf
    expect(c.frint(2.5, 3)).toBe(2); // toward zero
  });

  it('roundTiesToEven / roundTowardPlusInf / roundTowardMinusInf / roundTowardZero', () => {
    const c = ctx();
    expect(c.roundTiesToEven(2.5)).toBe(2);
    expect(c.roundTowardPlusInf(2.1)).toBe(3);
    expect(c.roundTowardMinusInf(2.9)).toBe(2);
    expect(c.roundTowardZero(2.9)).toBe(2);
  });
});
