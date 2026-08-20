/**
 * Coverage tests for ShiftExtend — AArch64 shift (LSL/LSR/ASR/ROR) + extended
 * register (UXTB…SXTX) operations. Pure bigint arithmetic, no mocks.
 */

import { describe, expect, it } from 'vitest';
import { applyShift, extendReg } from '@modules/native-emulator/utils/ShiftExtend';

describe('applyShift', () => {
  it('returns the value unchanged when amount=0', () => {
    expect(applyShift(0xffn, 0b00, 0, 1)).toBe(0xffn);
  });

  it('LSL (0b00) — logical shift left, masked to width', () => {
    expect(applyShift(1n, 0b00, 4, 1)).toBe(16n);
    expect(applyShift(1n, 0b00, 4, 0)).toBe(16n); // 32-bit
  });

  it('LSR (0b01) — logical shift right', () => {
    expect(applyShift(0x100n, 0b01, 4, 1)).toBe(0x10n);
  });

  it('ASR (0b10) — arithmetic shift right (sign-extends)', () => {
    // 32-bit value with sign bit set, shift right 4 → sign propagates
    const neg = 0x80000000n; // sign bit set in 32-bit
    expect(applyShift(neg, 0b10, 4, 0)).toBe(0xf8000000n);
  });

  it('ASR of a positive value behaves like LSR', () => {
    expect(applyShift(0x100n, 0b10, 4, 1)).toBe(0x10n);
  });

  it('ROR (0b11) — rotate right within width', () => {
    // rotate 1n right by 4 in 64-bit → high nibble set
    const r = applyShift(1n, 0b11, 4, 1);
    expect(r).toBe(1n << 60n); // rotated to bit 60
  });

  it('throws on an unsupported shift type', () => {
    expect(() => applyShift(1n, 0b100, 1, 1)).toThrow(/Unsupported shift type/);
  });
});

describe('extendReg', () => {
  it('UXTB (0b000) — zero-extend low byte', () => {
    expect(extendReg(0x1234n, 0b000, 0, 1)).toBe(0x34n);
  });

  it('UXTH (0b001) — zero-extend low halfword', () => {
    expect(extendReg(0x123456n, 0b001, 0, 1)).toBe(0x3456n);
  });

  it('UXTW (0b010) — zero-extend low word', () => {
    expect(extendReg(0x123456789an, 0b010, 0, 1)).toBe(0x3456789an);
  });

  it('UXTX (0b011) — no extension (64-bit mask)', () => {
    expect(extendReg(0xdeadbeefn, 0b011, 0, 1)).toBe(0xdeadbeefn);
  });

  it('SXTB (0b100) — sign-extend byte (negative)', () => {
    expect(extendReg(0x80n, 0b100, 0, 1)).toBe(0xffffffffffffff80n);
  });

  it('SXTH (0b101) — sign-extend halfword (negative)', () => {
    expect(extendReg(0x8000n, 0b101, 0, 1)).toBe(0xffffffffffff8000n);
  });

  it('SXTW (0b110) — sign-extend word (negative)', () => {
    expect(extendReg(0x80000000n, 0b110, 0, 1)).toBe(0xffffffff80000000n);
  });

  it('SXTX (0b111, default) — 64-bit no-op extension', () => {
    expect(extendReg(0x123n, 0b111, 0, 1)).toBe(0x123n);
  });

  it('applies the post-extension left shift', () => {
    expect(extendReg(0x34n, 0b000, 2, 1)).toBe(0x34n << 2n); // shifted
  });

  it('masks to 32-bit when sf=0', () => {
    expect(extendReg(0x1ffffffffn, 0b011, 0, 0)).toBe(0xffffffffn);
  });
});
