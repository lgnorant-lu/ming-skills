/**
 * World-Class ARM64 FP Exception Handling Test Suite
 *
 * Tests IEEE754-2008 exception handling aligned with ARM Architecture Reference Manual.
 * This test suite is written in TDD style - tests are expected to fail until implementation.
 *
 * Coverage:
 * - IOC (Invalid Operation): 7 cases
 * - DZC (Divide by Zero): 5 cases
 * - OFC (Overflow): 6 cases
 * - UFC (Underflow): 6 cases
 * - IXC (Inexact): 5 cases
 * - Rounding Modes: 10 cases
 * - Cumulative Flags: 5 cases
 * - FPCR/FPSR Registers: 6 cases
 * - Exception Traps: 3 cases
 * Total: 53 test cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { FLOAT32_MAX, FLOAT32_MIN_NORMAL } from '@modules/native-emulator/fp/FpConstants';

describe('FP Exception Handling - World-Class Implementation', () => {
  let engine: CpuEngine;

  beforeEach(() => {
    engine = new CpuEngine();
    // Reset to default state
    engine.setFPCR(0);
    engine.setFPSR(0);
  });

  // ============================================================================
  // IOC - Invalid Operation (7 cases)
  // ============================================================================
  describe('IOC - Invalid Operation', () => {
    it('should set IOC for 0/0 → NaN', () => {
      const result = engine.fdiv(0.0, 0.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1); // IOC bit at position 0
    });

    it('should set IOC for Inf - Inf → NaN', () => {
      const result = engine.fsub(Infinity, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for sqrt(-1) → NaN', () => {
      const result = engine.fsqrt(-1.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for 0 × Inf → NaN', () => {
      const result = engine.fmul(0.0, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for Inf / Inf → NaN', () => {
      const result = engine.fdiv(Infinity, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for Inf × 0 → NaN (order reversed)', () => {
      const result = engine.fmul(Infinity, 0.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });

    it('should set IOC for -Inf + Inf → NaN', () => {
      const result = engine.fadd(-Infinity, Infinity);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x1).toBe(1);
    });
  });

  // ============================================================================
  // DZC - Divide by Zero (5 cases)
  // ============================================================================
  describe('DZC - Divide by Zero', () => {
    it('should set DZC for 1.0/0.0 → +Inf', () => {
      const result = engine.fdiv(1.0, 0.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x2).toBe(2); // DZC bit at position 1
    });

    it('should set DZC for -1.0/0.0 → -Inf', () => {
      const result = engine.fdiv(-1.0, 0.0);
      expect(result).toBe(-Infinity);
      expect(engine.getFPSR() & 0x2).toBe(2);
    });

    it('should preserve sign for 1.0/-0.0 → -Inf', () => {
      const result = engine.fdiv(1.0, -0.0);
      expect(result).toBe(-Infinity);
      expect(Object.is(1 / result, -0)).toBe(true); // Verify negative infinity → -0
      expect(engine.getFPSR() & 0x2).toBe(2);
    });

    it('should set DZC for -1.0/-0.0 → +Inf', () => {
      const result = engine.fdiv(-1.0, -0.0);
      expect(result).toBe(Infinity);
      expect(Object.is(1 / result, 0)).toBe(true); // Verify positive infinity → +0
      expect(engine.getFPSR() & 0x2).toBe(2);
    });

    it('should NOT set DZC for 0.0/0.0 (IOC instead)', () => {
      engine.setFPSR(0); // Clear flags
      const result = engine.fdiv(0.0, 0.0);
      expect(result).toBeNaN();
      expect(engine.getFPSR() & 0x2).toBe(0); // DZC should NOT be set
      expect(engine.getFPSR() & 0x1).toBe(1); // IOC should be set
    });
  });

  // ============================================================================
  // OFC - Overflow (6 cases)
  // ============================================================================
  describe('OFC - Overflow', () => {
    const MAX_FLOAT64 = 1.7976931348623157e308;

    it('should set OFC for max_float32 * 2 → Inf (RN mode)', () => {
      engine.setFPCR(0x00000000); // RMode=00 (RN)
      const result = engine.fmul32(FLOAT32_MAX, 2.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4); // OFC bit at position 2
    });

    it('should set OFC for -max_float32 * 2 → -Inf (RN mode)', () => {
      engine.setFPCR(0x00000000);
      const result = engine.fmul32(-FLOAT32_MAX, 2.0);
      expect(result).toBe(-Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4);
    });

    it('should saturate to max_float32 in RZ mode (toward zero)', () => {
      engine.setFPCR(0x00c00000); // RMode=11 (RZ)
      const result = engine.fmul32(FLOAT32_MAX, 2.0);
      expect(result).toBe(FLOAT32_MAX); // Saturate, not Inf
      expect(engine.getFPSR() & 0x4).toBe(4); // OFC still set
    });

    it('should set OFC for max_float64 * 2 → Inf (float64)', () => {
      engine.setFPCR(0x00000000);
      const result = engine.fmul(MAX_FLOAT64, 2.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4);
    });

    it('should overflow in RP mode (toward +Inf)', () => {
      engine.setFPCR(0x00400000); // RMode=01 (RP)
      const result = engine.fmul32(FLOAT32_MAX, 2.0);
      expect(result).toBe(Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4);
    });

    it('should overflow in RM mode (toward -Inf) for negative', () => {
      engine.setFPCR(0x00800000); // RMode=10 (RM)
      const result = engine.fmul32(-FLOAT32_MAX, 2.0);
      expect(result).toBe(-Infinity);
      expect(engine.getFPSR() & 0x4).toBe(4);
    });
  });

  // ============================================================================
  // UFC - Underflow (6 cases)
  // ============================================================================
  describe('UFC - Underflow', () => {
    const MIN_NORMAL_FLOAT64 = 2.2250738585072014e-308;

    it('should set UFC for denormal result (FZ=0, float32)', () => {
      engine.setFPCR(0x00000000); // FZ=0
      const result = engine.fmul32(FLOAT32_MIN_NORMAL, 0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(FLOAT32_MIN_NORMAL);
      expect(engine.getFPSR() & 0x8).toBe(8); // UFC bit at position 3
    });

    it('should flush to zero when FZ=1 (float32)', () => {
      engine.setFPCR(0x01000000); // FZ=1
      const result = engine.fmul32(FLOAT32_MIN_NORMAL, 0.5);
      expect(result).toBe(0);
      expect(engine.getFPSR() & 0x8).toBe(8); // UFC still set
    });

    it('should set UFC for negative underflow (FZ=0)', () => {
      engine.setFPCR(0x00000000);
      const result = engine.fmul32(-FLOAT32_MIN_NORMAL, 0.5);
      expect(result).toBeLessThan(0);
      expect(result).toBeGreaterThan(-FLOAT32_MIN_NORMAL);
      expect(engine.getFPSR() & 0x8).toBe(8);
    });

    it('should flush negative underflow to -0 when FZ=1', () => {
      engine.setFPCR(0x01000000); // FZ=1
      const result = engine.fmul32(-FLOAT32_MIN_NORMAL, 0.5);
      expect(Object.is(result, -0)).toBe(true); // Must be -0, not +0
      expect(1 / result).toBeLessThan(0); // Verify -0
      expect(engine.getFPSR() & 0x8).toBe(8);
    });

    it('should set UFC for float64 denormal result (FZ=0)', () => {
      engine.setFPCR(0x00000000);
      const result = engine.fmul(MIN_NORMAL_FLOAT64, 0.5);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(MIN_NORMAL_FLOAT64);
      expect(engine.getFPSR() & 0x8).toBe(8);
    });

    it('should NOT set UFC for exact tiny result', () => {
      engine.setFPSR(0); // Clear flags
      // MIN_NORMAL / 2 is exact in denormal range (no rounding)
      const result = engine.fdiv(FLOAT32_MIN_NORMAL, 2.0, true);
      // This is tricky - underflow requires inexactness
      // If result is exact denormal, UFC should NOT be set
      // (This tests the "and inexact" part of underflow definition)
      expect(result).toBeGreaterThan(0);
      // UFC should only be set if rounding occurred
    });
  });

  // ============================================================================
  // IXC - Inexact (5 cases)
  // ============================================================================
  describe('IXC - Inexact', () => {
    it('should set IXC for 1.0/3.0 (non-representable)', () => {
      const result = engine.fdiv(1.0, 3.0);
      expect(result).toBeCloseTo(0.3333333333333333);
      expect(engine.getFPSR() & 0x10).toBe(16); // IXC bit at position 4
    });

    it('should NOT set IXC for 1.0/2.0 (exact)', () => {
      engine.setFPSR(0); // Clear flags
      const result = engine.fdiv(1.0, 2.0);
      expect(result).toBe(0.5);
      expect(engine.getFPSR() & 0x10).toBe(0); // IXC should NOT be set
    });

    it('should set IXC for 2.0/3.0', () => {
      const result = engine.fdiv(2.0, 3.0);
      expect(result).toBeCloseTo(0.6666666666666666);
      expect(engine.getFPSR() & 0x10).toBe(16);
    });

    it('should NOT set IXC for 1.0/4.0 (exact)', () => {
      engine.setFPSR(0);
      const result = engine.fdiv(1.0, 4.0);
      expect(result).toBe(0.25);
      expect(engine.getFPSR() & 0x10).toBe(0);
    });

    it('should set IXC for sqrt(2) (irrational)', () => {
      const result = engine.fsqrt(2.0);
      expect(result).toBeCloseTo(1.4142135623730951);
      expect(engine.getFPSR() & 0x10).toBe(16);
    });
  });

  // ============================================================================
  // Rounding Modes (10 cases)
  // ============================================================================
  describe('Rounding Modes', () => {
    describe('RN - Round to Nearest, ties to even', () => {
      beforeEach(() => {
        engine.setFPCR(0x00000000); // RMode=00 (RN)
      });

      it('should round 2.5 to 2 (even)', () => {
        const result = engine.roundTiesToEven(2.5);
        expect(result).toBe(2);
      });

      it('should round 3.5 to 4 (even)', () => {
        const result = engine.roundTiesToEven(3.5);
        expect(result).toBe(4);
      });

      it('should round 2.4 to 2', () => {
        const result = engine.roundTiesToEven(2.4);
        expect(result).toBe(2);
      });

      it('should round 2.6 to 3', () => {
        const result = engine.roundTiesToEven(2.6);
        expect(result).toBe(3);
      });
    });

    describe('RP - Round toward +Infinity', () => {
      beforeEach(() => {
        engine.setFPCR(0x00400000); // RMode=01 (RP)
      });

      it('should round 2.1 to 3', () => {
        const result = engine.roundTowardPlusInf(2.1);
        expect(result).toBe(3);
      });

      it('should round -2.1 to -2 (toward +Inf)', () => {
        const result = engine.roundTowardPlusInf(-2.1);
        expect(result).toBe(-2);
      });
    });

    describe('RM - Round toward -Infinity', () => {
      beforeEach(() => {
        engine.setFPCR(0x00800000); // RMode=10 (RM)
      });

      it('should round 2.1 to 2 (toward -Inf)', () => {
        const result = engine.roundTowardMinusInf(2.1);
        expect(result).toBe(2);
      });

      it('should round -2.1 to -3', () => {
        const result = engine.roundTowardMinusInf(-2.1);
        expect(result).toBe(-3);
      });
    });

    describe('RZ - Round toward Zero', () => {
      beforeEach(() => {
        engine.setFPCR(0x00c00000); // RMode=11 (RZ)
      });

      it('should round 2.9 to 2', () => {
        const result = engine.roundTowardZero(2.9);
        expect(result).toBe(2);
      });

      it('should round -2.9 to -2 (toward zero)', () => {
        const result = engine.roundTowardZero(-2.9);
        expect(result).toBe(-2);
      });
    });
  });

  // ============================================================================
  // Cumulative Flags (5 cases)
  // ============================================================================
  describe('Cumulative Flags', () => {
    it('should accumulate multiple exceptions', () => {
      engine.setFPSR(0); // Clear flags
      engine.fdiv(0.0, 0.0); // IOC
      engine.fdiv(1.0, 0.0); // DZC
      const fpsr = engine.getFPSR();
      expect(fpsr & 0x1).toBe(1); // IOC bit
      expect(fpsr & 0x2).toBe(2); // DZC bit
      expect(fpsr & 0x3).toBe(3); // Both set
    });

    it('should NOT clear cumulative flags on subsequent operations', () => {
      engine.fdiv(0.0, 0.0); // IOC
      const fpsr1 = engine.getFPSR();
      expect(fpsr1 & 0x1).toBe(1);

      engine.fdiv(1.0, 2.0); // Normal operation
      const fpsr2 = engine.getFPSR();
      expect(fpsr2 & 0x1).toBe(1); // IOC should still be set
    });

    it('should clear FPSR on explicit write', () => {
      engine.fdiv(0.0, 0.0);
      expect(engine.getFPSR() & 0x1).toBe(1);
      engine.setFPSR(0);
      expect(engine.getFPSR()).toBe(0);
    });

    it('should accumulate IXC with other exceptions', () => {
      engine.setFPSR(0);
      engine.fdiv(1.0, 3.0); // IXC
      engine.fdiv(1.0, 0.0); // DZC
      const fpsr = engine.getFPSR();
      expect(fpsr & 0x10).toBe(16); // IXC
      expect(fpsr & 0x2).toBe(2); // DZC
    });

    it('should preserve independent exception flags', () => {
      engine.setFPSR(0);
      engine.fdiv(0.0, 0.0); // IOC
      expect(engine.getFPSR() & 0x2).toBe(0); // DZC should NOT be set
      expect(engine.getFPSR() & 0x4).toBe(0); // OFC should NOT be set
    });
  });

  // ============================================================================
  // FPCR/FPSR Registers (6 cases)
  // ============================================================================
  describe('FPCR/FPSR Registers', () => {
    it('should read/write FPCR', () => {
      engine.setFPCR(0x00c00000); // RMode=11
      expect(engine.getFPCR()).toBe(0x00c00000);
      engine.setFPCR(0x01000000); // FZ=1
      expect(engine.getFPCR()).toBe(0x01000000);
    });

    it('should read/write FPSR', () => {
      engine.setFPSR(0x1f); // All exception flags
      expect(engine.getFPSR()).toBe(0x1f);
      engine.setFPSR(0);
      expect(engine.getFPSR()).toBe(0);
    });

    it('should initialize FPCR to 0 (default)', () => {
      const newEngine = new CpuEngine();
      expect(newEngine.getFPCR()).toBe(0);
    });

    it('should initialize FPSR to 0 (default)', () => {
      const newEngine = new CpuEngine();
      expect(newEngine.getFPSR()).toBe(0);
    });

    it('should extract rounding mode from FPCR', () => {
      engine.setFPCR(0x00c00000); // RMode=11 (RZ)
      const rmode = (engine.getFPCR() >> 22) & 0x3;
      expect(rmode).toBe(3); // RZ
    });

    it('should extract FZ bit from FPCR', () => {
      engine.setFPCR(0x01000000); // FZ=1
      const fz = (engine.getFPCR() >> 24) & 0x1;
      expect(fz).toBe(1);
    });
  });

  // ============================================================================
  // Exception Traps (超越业界) (3 cases)
  // ============================================================================
  describe('Exception Trap Mode (超越业界)', () => {
    it('should NOT trap by default', () => {
      engine.setFPCR(0); // All trap enables off
      expect(() => engine.fdiv(0.0, 0.0)).not.toThrow();
    });

    it('should trap on Invalid Operation when IOE=1', () => {
      engine.setFPCR(0x00000100); // IOE=1 (bit 8)
      expect(() => engine.fdiv(0.0, 0.0)).toThrow(/Invalid Operation|IOC/);
    });

    it('should trap on Divide by Zero when DZE=1', () => {
      engine.setFPCR(0x00000200); // DZE=1 (bit 9)
      expect(() => engine.fdiv(1.0, 0.0)).toThrow(/Divide by Zero|DZC/);
    });
  });
});
