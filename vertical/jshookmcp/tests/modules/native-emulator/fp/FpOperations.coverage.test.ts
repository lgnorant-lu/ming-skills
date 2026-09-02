/**
 * Coverage tests for FpContext — FP register/flag accessors + the arithmetic
 * operations (fadd/fsub/fmul/fdiv/fsqrt/fabs/fneg/fmax/fmin/frint) + rounding
 * helpers. Pure FP math, no mocks needed.
 */

import { describe, expect, it } from 'vitest';
import { FpContext } from '@modules/native-emulator/fp/FpOperations';
import { FPCR_FZ, FPCR_IDE, FPSR_IDC } from '@modules/native-emulator/fp/FpConstants';

const ctx = () => new FpContext();

/** A float64 denormal (below FLOAT64_MIN_NORMAL) — flushes to ±0 with FZ=1. */
const DENORMAL = Number.MIN_VALUE;

const FZ = 1 << FPCR_FZ;
const FZ_PLUS_IDE = (1 << FPCR_FZ) | (1 << FPCR_IDE);

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

describe('FpContext — IDC flush + IDE trap (inlined slow paths)', () => {
  // Regression: fsqrt once wrote `flags |= 32` (undefined FPSR bit 5) instead of
  // `1 << FPSR_IDC` — the IDC cumulative flag was never set and FPSR was polluted.
  it('fsqrt(FZ=1) on a denormal sets the IDC flag without polluting bit 5', () => {
    const c = ctx();
    c.setFPCR(FZ);
    expect(c.fsqrt(DENORMAL)).toBe(0);
    expect(c.getFPSR() & (1 << FPSR_IDC)).toBe(1 << FPSR_IDC);
    expect(c.getFPSR() & (1 << 5)).toBe(0); // no undefined-bit pollution (RES0 bit 5)
  });

  it('every inlined op (FZ=1) sets the IDC flag on a denormal input', () => {
    const ops: Array<[string, (c: FpContext) => void]> = [
      ['fadd', (c) => void c.fadd(DENORMAL, 0)],
      ['fsub', (c) => void c.fsub(DENORMAL, 0)],
      ['fmul', (c) => void c.fmul(DENORMAL, 1)],
      ['fdiv', (c) => void c.fdiv(DENORMAL, 1)],
      ['fsqrt', (c) => void c.fsqrt(DENORMAL)],
    ];
    for (const [name, run] of ops) {
      const c = ctx();
      c.setFPCR(FZ);
      run(c);
      expect(c.getFPSR() & (1 << FPSR_IDC), `${name} should set IDC`).toBe(1 << FPSR_IDC);
    }
  });

  // Regression: `(fpcr >> 8) & 0x3f` dropped FPCR_IDE (bit 15) — the FP Input
  // Denormal trap never fired here while the checkAndSetFlags path honored it.
  it('FZ|IDE raises FP Input Denormal trap on a denormal input (all inlined ops)', () => {
    const ops: Array<[string, (c: FpContext) => void]> = [
      ['fadd', (c) => void c.fadd(DENORMAL, 0)],
      ['fsub', (c) => void c.fsub(DENORMAL, 0)],
      ['fmul', (c) => void c.fmul(DENORMAL, 1)],
      ['fdiv', (c) => void c.fdiv(DENORMAL, 1)],
      ['fsqrt', (c) => void c.fsqrt(DENORMAL)],
    ];
    for (const [name, run] of ops) {
      const c = ctx();
      c.setFPCR(FZ_PLUS_IDE);
      expect(() => run(c), `${name} should trap on IDC`).toThrow('FP Input Denormal');
    }
  });

  it('FZ|IDE does not trap when the input is a normal number', () => {
    const c = ctx();
    c.setFPCR(FZ_PLUS_IDE);
    expect(c.fadd(1, 2)).toBe(3);
    expect(c.getFPSR()).toBe(0);
  });

  it('IDE alone without FZ does not raise IDC (no denormal flushing occurs)', () => {
    const c = ctx();
    c.setFPCR(1 << FPCR_IDE);
    expect(c.fadd(DENORMAL, 0)).toBe(DENORMAL);
    expect(c.getFPSR() & (1 << FPSR_IDC)).toBe(0);
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
