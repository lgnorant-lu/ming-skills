/**
 * Coverage expansion for the SIMD lane/FP primitives (issue: branch coverage
 * gate). These exercise the exported pure functions directly across their full
 * branch space — every cmode in AdvSIMDExpandImm, every rounding mode and
 * saturation edge in the FP↔int path, both halves of the permute ops, and the
 * TBX out-of-range path — without needing full instruction decode.
 */
import { describe, expect, it } from 'vitest';

import {
  advSimdExpandImm,
  neonRev,
  neonDupElement,
  neonDupGeneral,
  neonZip,
  neonUzp,
  neonTrn,
  neonExt,
  neonTbl,
  neonAddv,
  neonSmaxv,
  neonSminv,
  neonUmaxv,
  neonUminv,
  neonShl,
  neonUshr,
  neonSshr,
  neonBic,
  neonOrn,
  neonBsl,
  neonCmeq,
  neonCmge,
  neonCmhi,
  neonCmhs,
  neonCmtst,
  neonSmin,
  neonUmax,
  neonNeg,
  neonAbs,
  neonNot,
  neonCnt,
  neonClz,
  neonCmeqZero,
  neonAdd,
  readLanes,
  packLanes,
} from '@modules/native-emulator/simd-neon';
import {
  fcmpFlags,
  fpToInt,
  intToFp,
  fcvtPrecision,
  readFp,
  packFp,
  fadd,
  fsub,
  fmul,
  fdiv,
  fnmul,
  fmax,
  fmin,
  fabs,
  fneg,
  fsqrt,
} from '@modules/native-emulator/simd-fp';

const bytes = (...xs: number[]): Uint8Array => {
  const u = new Uint8Array(16);
  u.set(xs);
  return u;
};

describe('advSimdExpandImm — all cmode branches', () => {
  // cmodeHi selects the shift/expand form; cmodeLo tweaks MSL / op variants.
  it('cmodeHi 000..011: byte shifted by 0/8/16/24, replicated per 32-bit lane', () => {
    expect(advSimdExpandImm(0, 0b0000, 0xab)).toBe(0xabn | (0xabn << 32n));
    expect(advSimdExpandImm(0, 0b0010, 0xab)).toBe((0xabn << 8n) | ((0xabn << 8n) << 32n));
    expect(advSimdExpandImm(0, 0b0100, 0xab)).toBe((0xabn << 16n) | ((0xabn << 16n) << 32n));
    expect(advSimdExpandImm(0, 0b0110, 0xab)).toBe((0xabn << 24n) | ((0xabn << 24n) << 32n));
  });

  it('cmodeHi 100/101: 16-bit shifted forms', () => {
    const h4 = 0xabn | (0xabn << 16n);
    expect(advSimdExpandImm(0, 0b1000, 0xab)).toBe(h4 | (h4 << 32n));
    const h5 = (0xabn << 8n) | (0xabn << 24n);
    expect(advSimdExpandImm(0, 0b1010, 0xab)).toBe(h5 | (h5 << 32n));
  });

  it('cmodeHi 110: MSL fills low 8 or 16 bits with ones', () => {
    const v8 = (0xabn << 8n) | 0xffn;
    expect(advSimdExpandImm(0, 0b1100, 0xab)).toBe(v8 | (v8 << 32n));
    const v16 = (0xabn << 16n) | 0xffffn;
    expect(advSimdExpandImm(0, 0b1101, 0xab)).toBe(v16 | (v16 << 32n));
  });

  it('cmodeHi 111 cmodeLo 0: byte replicated across all 8 lanes', () => {
    let expected = 0n;
    for (let i = 0; i < 8; i++) expected |= 0xabn << BigInt(i * 8);
    expect(advSimdExpandImm(0, 0b1110, 0xab)).toBe(expected);
  });

  it('cmode 1110 op 0: each imm8 bit expands to a full byte', () => {
    // imm8 = 0b10100001 → bytes 0,5,7 set to 0xff
    let expected = 0n;
    const imm = 0b10100001;
    for (let i = 0; i < 8; i++) if ((imm >> i) & 1) expected |= 0xffn << BigInt(i * 8);
    expect(advSimdExpandImm(0, 0b1111, imm)).toBe(expected);
  });

  it('cmode 1111 op 1: FMOV-style fallback replicates the byte', () => {
    expect(advSimdExpandImm(1, 0b1111, 0xab)).toBe(0xabn | (0xabn << 32n));
  });
});

describe('fpToInt — rounding modes and saturation', () => {
  it('rounds with each mode', () => {
    expect(fpToInt(2.5, 'zero', true, 32)).toBe(2n);
    expect(fpToInt(2.7, 'minus', true, 32)).toBe(2n);
    expect(fpToInt(2.2, 'plus', true, 32)).toBe(3n);
    expect(fpToInt(-2.5, 'away', true, 32)).toBe(-3n);
    expect(fpToInt(2.5, 'nearest', true, 32)).toBe(2n); // ties to even
    expect(fpToInt(3.5, 'nearest', true, 32)).toBe(4n); // ties to even
    expect(fpToInt(2.4, 'nearest', true, 32)).toBe(2n);
    expect(fpToInt(2.6, 'nearest', true, 32)).toBe(3n);
  });

  it('NaN → 0', () => {
    expect(fpToInt(NaN, 'zero', true, 32)).toBe(0n);
    expect(fpToInt(NaN, 'zero', false, 64)).toBe(0n);
  });

  it('signed saturation at both ends (32 and 64 bit)', () => {
    expect(fpToInt(Infinity, 'zero', true, 32)).toBe(2n ** 31n - 1n);
    expect(fpToInt(-Infinity, 'zero', true, 32)).toBe(-(2n ** 31n));
    expect(fpToInt(1e30, 'zero', true, 64)).toBe(2n ** 63n - 1n);
    expect(fpToInt(-1e30, 'zero', true, 64)).toBe(-(2n ** 63n));
  });

  it('unsigned: negatives clamp to 0, overflow saturates to max', () => {
    expect(fpToInt(-5, 'zero', false, 32)).toBe(0n);
    expect(fpToInt(Infinity, 'zero', false, 32)).toBe(2n ** 32n - 1n);
    expect(fpToInt(1e30, 'zero', false, 64)).toBe(2n ** 64n - 1n);
    expect(fpToInt(42.9, 'zero', false, 32)).toBe(42n);
  });
});

describe('fcmpFlags — ordered/equal/less/unordered', () => {
  it('less than', () => expect(fcmpFlags(1, 2)).toEqual({ n: true, z: false, c: false, v: false }));
  it('equal', () => expect(fcmpFlags(2, 2)).toEqual({ n: false, z: true, c: true, v: false }));
  it('greater', () => expect(fcmpFlags(3, 2)).toEqual({ n: false, z: false, c: true, v: false }));
  it('unordered (NaN)', () =>
    expect(fcmpFlags(NaN, 2)).toEqual({ n: false, z: false, c: true, v: true }));
});

describe('intToFp / fcvtPrecision', () => {
  it('signed vs unsigned interpretation', () => {
    expect(intToFp(0xffffffffn, true, 32, true)).toBe(-1);
    expect(intToFp(0xffffffffn, false, 32, true)).toBe(4294967295);
  });
  it('single precision rounds through float32', () => {
    // 16777217 is not representable in float32 → rounds to 16777216
    expect(intToFp(16777217n, false, 64, false)).toBe(16777216);
    expect(intToFp(16777217n, false, 64, true)).toBe(16777217);
  });
  it('fcvtPrecision widens (identity) and narrows (float32)', () => {
    expect(fcvtPrecision(1.5, true)).toBe(1.5);
    expect(fcvtPrecision(16777217, false)).toBe(16777216);
  });
});

describe('readFp / packFp round-trip', () => {
  it('float32 and float64', () => {
    expect(readFp(packFp(1.5, false), false)).toBeCloseTo(1.5, 5);
    expect(readFp(packFp(Math.PI, true), true)).toBeCloseTo(Math.PI, 12);
  });
});

describe('scalar FP arithmetic — double and single (f32) paths', () => {
  it('FADD/FSUB/FMUL/FDIV/FNMUL on both precisions', () => {
    expect(fadd(1.5, 2.25, true)).toBe(3.75);
    expect(fadd(1.5, 2.25, false)).toBeCloseTo(3.75, 5);
    expect(fsub(5, 1.5, true)).toBe(3.5);
    expect(fsub(5, 1.5, false)).toBeCloseTo(3.5, 5);
    expect(fmul(3, 4, true)).toBe(12);
    expect(fmul(3, 4, false)).toBeCloseTo(12, 5);
    expect(fdiv(9, 2, true)).toBe(4.5);
    expect(fdiv(9, 2, false)).toBeCloseTo(4.5, 5);
    expect(fnmul(3, 4, true)).toBe(-12);
    expect(fnmul(3, 4, false)).toBeCloseTo(-12, 5);
  });

  it('FDIV IEEE-754 edge cases', () => {
    expect(fdiv(1, 0, true)).toBe(Infinity);
    expect(fdiv(-1, 0, true)).toBe(-Infinity);
    expect(Number.isNaN(fdiv(0, 0, true))).toBe(true);
  });

  it('FMAX/FMIN propagate NaN and order signed zero', () => {
    expect(Number.isNaN(fmax(NaN, 1, true))).toBe(true);
    expect(Number.isNaN(fmin(1, NaN, false))).toBe(true);
    expect(fmax(2, 5, true)).toBe(5);
    expect(fmin(2, 5, false)).toBeCloseTo(2, 5);
    // +0 > -0 for FMAX; FMIN picks -0
    expect(Object.is(fmax(-0, 0, true), 0)).toBe(true);
    expect(Object.is(fmin(-0, 0, true), -0)).toBe(true);
  });

  it('FABS/FNEG/FSQRT on both precisions', () => {
    expect(fabs(-3.5, true)).toBe(3.5);
    expect(fabs(-3.5, false)).toBeCloseTo(3.5, 5);
    expect(fneg(3.5, true)).toBe(-3.5);
    expect(fneg(3.5, false)).toBeCloseTo(-3.5, 5);
    expect(fsqrt(16, true)).toBe(4);
    expect(fsqrt(16, false)).toBeCloseTo(4, 5);
    expect(Number.isNaN(fsqrt(-1, true))).toBe(true);
  });
});

describe('NEON permutes — both parts', () => {
  // 8-bit lanes, q=1 (16 lanes). a = 0..15, b = 16..31.
  const a = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i));
  const b = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 16));

  it('ZIP1/ZIP2 interleave lower/upper halves', () => {
    const z1 = neonZip(a, b, 0, 1, 0);
    expect([z1[0], z1[1], z1[2], z1[3]]).toEqual([0, 16, 1, 17]);
    const z2 = neonZip(a, b, 0, 1, 1);
    expect([z2[0], z2[1]]).toEqual([8, 24]);
  });

  it('UZP1/UZP2 de-interleave even/odd', () => {
    const u1 = neonUzp(a, b, 0, 1, 0);
    expect([u1[0], u1[1], u1[2]]).toEqual([0, 2, 4]);
    const u2 = neonUzp(a, b, 0, 1, 1);
    expect([u2[0], u2[1]]).toEqual([1, 3]);
  });

  it('TRN1/TRN2 transpose', () => {
    const t1 = neonTrn(a, b, 0, 1, 0);
    expect([t1[0], t1[1], t1[2], t1[3]]).toEqual([0, 16, 2, 18]);
    const t2 = neonTrn(a, b, 0, 1, 1);
    expect([t2[0], t2[1]]).toEqual([1, 17]);
  });

  it('EXT extracts a byte window across Rn:Rm', () => {
    const e = neonExt(a, b, 4, 1);
    expect([e[0], e[1]]).toEqual([4, 5]);
    expect(e[12]).toBe(16); // wrapped into b
  });
});

describe('NEON misc — REV, DUP, TBL/TBX, shifts, reductions', () => {
  it('REV reverses within containers', () => {
    const a = bytes(1, 2, 3, 4, 5, 6, 7, 8);
    const r = neonRev(a, 4, 0); // REV32 over 8-bit elements
    expect([r[0], r[1], r[2], r[3]]).toEqual([4, 3, 2, 1]);
  });

  it('DUP element and general broadcast', () => {
    const a = bytes(0xaa, 0xbb, 0xcc, 0xdd);
    const de = neonDupElement(a, 0, 1, 1); // size=0 (byte), index 1 → 0xbb
    expect(de[0]).toBe(0xbb);
    expect(de[15]).toBe(0xbb);
    const dg = neonDupGeneral(0x12345678n, 0, 0); // byte size, q=0
    expect(dg[0]).toBe(0x78);
    expect(dg[7]).toBe(0x78);
    expect(dg[8]).toBe(0); // q=0 upper half cleared by packLanes
  });

  it('TBL zeroes out-of-range; TBX preserves destination', () => {
    const table = bytes(10, 11, 12, 13);
    const indices = bytes(0, 3, 99, 1); // 99 is out of range
    const dest = bytes(0xf0, 0xf1, 0xf2, 0xf3);
    const tbl = neonTbl(table, indices, 0, dest, false);
    expect([tbl[0], tbl[1], tbl[2], tbl[3]]).toEqual([10, 13, 0, 11]);
    const tbx = neonTbl(table, indices, 0, dest, true);
    expect([tbx[0], tbx[1], tbx[2], tbx[3]]).toEqual([10, 13, 0xf2, 11]);
  });

  it('shift-by-immediate: SHL/USHR/SSHR', () => {
    const a = packLanes([0x80n, 0x01n], 0); // two bytes
    expect(readLanes(neonShl(a, 0, 1, 0), 0, 0)[0]).toBe(0x00n); // 0x80<<1 wraps in byte
    expect(readLanes(neonUshr(a, 0, 1, 0), 0, 0)[0]).toBe(0x40n);
    // SSHR treats 0x80 as -128 → >>1 = -64 = 0xC0
    expect(readLanes(neonSshr(a, 0, 1, 0), 0, 0)[0]).toBe(0xc0n);
  });

  it('across-lane reductions', () => {
    // q=0 with size=1 (half-word) gives exactly 4 lanes — no zero padding to skew min/max.
    const a = packLanes([5n, 1n, 9n, 3n], 1);
    expect(readLanes(neonAddv(a, 1, 0), 1, 0)[0]).toBe(18n);
    expect(readLanes(neonUmaxv(a, 1, 0), 1, 0)[0]).toBe(9n);
    expect(readLanes(neonUminv(a, 1, 0), 1, 0)[0]).toBe(1n);
    const signed = packLanes([0xfffbn, 0x0001n, 0x0002n, 0x0003n], 1); // -5, 1, 2, 3
    expect(readLanes(neonSmaxv(signed, 1, 0), 1, 0)[0]).toBe(3n);
    expect(readLanes(neonSminv(signed, 1, 0), 1, 0)[0]).toBe(0xfffbn);
  });
});

describe('NEON three-same — bitwise, compare, min/max lane ops', () => {
  // Byte lanes (size=0). Two registers with hand-pickable lane 0 values.
  const r = (...xs: number[]): Uint8Array => bytes(...xs);

  it('BIC/ORN complement the second operand', () => {
    const a = r(0b1111_0000);
    const b = r(0b1010_1010);
    // BIC: a & ~b = 0xF0 & 0x55 = 0x50
    expect(readLanes(neonBic(a, b, 0), 0, 0)[0]).toBe(0x50n);
    // ORN: a | ~b = 0xF0 | 0x55 = 0xF5
    expect(readLanes(neonOrn(a, b, 0), 0, 0)[0]).toBe(0xf5n);
  });

  it('BSL selects bits of Vn/Vm by the Vd mask', () => {
    const vd = r(0b1100_1100); // selector
    const vn = r(0b1111_1111);
    const vm = r(0b0000_0000);
    // (vd & vn) | (~vd & vm) = 0xCC
    expect(readLanes(neonBsl(vd, vn, vm, 0), 0, 0)[0]).toBe(0xccn);
  });

  it('CMEQ/CMGE/CMHI/CMHS/CMTST produce all-ones or all-zeros lanes', () => {
    const a = r(5, 0x80, 3);
    const b = r(5, 1, 4);
    expect(readLanes(neonCmeq(a, b, 0, 0), 0, 0).slice(0, 3)).toEqual([0xffn, 0n, 0n]);
    // signed: 0x80 = -128 < 1 → CMGE false at lane 1
    expect(readLanes(neonCmge(a, b, 0, 0), 0, 0).slice(0, 3)).toEqual([0xffn, 0n, 0n]);
    // unsigned: 0x80 = 128 > 1 → CMHI true at lane 1
    expect(readLanes(neonCmhi(a, b, 0, 0), 0, 0).slice(0, 3)).toEqual([0n, 0xffn, 0n]);
    expect(readLanes(neonCmhs(a, b, 0, 0), 0, 0).slice(0, 3)).toEqual([0xffn, 0xffn, 0n]);
    // CMTST: (a & b) != 0
    expect(readLanes(neonCmtst(r(0b0011), r(0b0001), 0, 0), 0, 0)[0]).toBe(0xffn);
    expect(readLanes(neonCmtst(r(0b0010), r(0b0001), 0, 0), 0, 0)[0]).toBe(0n);
  });

  it('SMIN/UMAX respect signedness', () => {
    const a = r(0x80, 9); // -128 / 128
    const b = r(0x01, 4);
    // SMIN: min(-128, 1) = -128 = 0x80
    expect(readLanes(neonSmin(a, b, 0, 0), 0, 0)[0]).toBe(0x80n);
    // UMAX: max(128, 1) = 128 = 0x80
    expect(readLanes(neonUmax(a, b, 0, 0), 0, 0)[0]).toBe(0x80n);
    // UMAX lane 1: max(9, 4) = 9
    expect(readLanes(neonUmax(a, b, 0, 0), 0, 0)[1]).toBe(9n);
  });
});

describe('NEON two-register misc — NEG/ABS/NOT/CNT/CLZ/CMEQ#0', () => {
  const r = (...xs: number[]): Uint8Array => bytes(...xs);

  it('NEG negates each lane (two’s complement)', () => {
    // -1 = 0xFF, -5 = 0xFB
    expect(readLanes(neonNeg(r(1, 5), 0, 0), 0, 0).slice(0, 2)).toEqual([0xffn, 0xfbn]);
  });

  it('ABS takes absolute value of the signed lane', () => {
    // 0xFB = -5 → abs = 5; 5 stays 5
    expect(readLanes(neonAbs(r(0xfb, 5), 0, 0), 0, 0).slice(0, 2)).toEqual([5n, 5n]);
  });

  it('NOT complements every bit', () => {
    expect(readLanes(neonNot(r(0x0f, 0x00), 0), 0, 0).slice(0, 2)).toEqual([0xf0n, 0xffn]);
  });

  it('CNT counts set bits per byte', () => {
    expect(readLanes(neonCnt(r(0xff, 0x01, 0x00), 0), 0, 0).slice(0, 3)).toEqual([8n, 1n, 0n]);
  });

  it('CLZ counts leading zeros at the element width', () => {
    // byte lanes: 0x00 → 8, 0x01 → 7, 0x80 → 0
    expect(readLanes(neonClz(r(0x00, 0x01, 0x80), 0, 0), 0, 0).slice(0, 3)).toEqual([8n, 7n, 0n]);
  });

  it('CMEQ #0 marks zero lanes', () => {
    expect(readLanes(neonCmeqZero(r(0, 7, 0), 0, 0), 0, 0).slice(0, 3)).toEqual([0xffn, 0n, 0xffn]);
  });

  it('REV with 8-byte container (REV64) reverses byte order', () => {
    const a = bytes(1, 2, 3, 4, 5, 6, 7, 8);
    const rv = neonRev(a, 8, 0);
    expect([rv[0], rv[7]]).toEqual([8, 1]);
  });
});

describe('NEON 128-bit (Q=1) and wide-lane paths', () => {
  // Q=1 exercises the full-16-byte `active` branch in readLanes/packLanes and
  // each op; 64-bit lanes (size=3) exercise the getBigUint64 lane path.
  it('three-same ops process all 16 byte-lanes under Q=1', () => {
    const a = bytes(...Array.from({ length: 16 }, (_, i) => i + 1));
    const b = bytes(...Array.from({ length: 16 }, () => 1));
    const sum = readLanes(neonAdd(a, b, 0, 1), 0, 1);
    expect(sum.length).toBe(16);
    expect(sum[15]).toBe(17n); // lane 15 = 16 + 1
  });

  it('64-bit lanes (size=3) add through the BigUint64 path', () => {
    const a = packLanes([0x0102030405060708n, 0x1111111111111111n], 3);
    const b = packLanes([0x0000000000000001n, 0x2222222222222222n], 3);
    const out = readLanes(neonAdd(a, b, 3, 1), 3, 1);
    expect(out[0]).toBe(0x0102030405060709n);
    expect(out[1]).toBe(0x3333333333333333n);
  });

  it('CLZ on 64-bit lanes counts across the full width', () => {
    const a = packLanes([1n, 0n], 3); // lane0 = 1 → 63 leading zeros; lane1 = 0 → 64
    const out = readLanes(neonClz(a, 3, 1), 3, 1);
    expect(out[0]).toBe(63n);
    expect(out[1]).toBe(64n);
  });

  it('ADDV reduces all 16 byte-lanes under Q=1', () => {
    const a = bytes(...Array.from({ length: 16 }, () => 2));
    expect(readLanes(neonAddv(a, 0, 1), 0, 1)[0]).toBe(32n); // 16 lanes × 2
  });

  it('ZIP1 on 64-bit lanes interleaves the single lower pair', () => {
    const a = packLanes([0xaaaaaaaaaaaaaaaan, 0xbbbbbbbbbbbbbbbbn], 3);
    const b = packLanes([0xccccccccccccccccn, 0xddddddddddddddddn], 3);
    const z = readLanes(neonZip(a, b, 3, 1, 0), 3, 1);
    expect(z[0]).toBe(0xaaaaaaaaaaaaaaaan);
    expect(z[1]).toBe(0xccccccccccccccccn);
  });
});
