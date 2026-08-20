/**
 * FMOV (scalar immediate) — bit-exact VFPExpandImm coverage.
 *
 * imm8 sits in bits[20:13] and expands per ARM ARM D5.1.2:
 *   single: a | NOT(b):b×5:c:d | e:f:g:h:0×19   (8 exp / 23 frac bits)
 *   double: a | NOT(b):b×8:c:d | e:f:g:h:0×48   (11 exp / 52 frac bits)
 *
 * Encodings are cross-checked against capstone (LLVM): the builder words below
 * disassemble to `fmov dN, #imm` / `fmov sN, #imm`, and capstone's numeric
 * decode of every imm8 matches the local reference (e.g. imm8=0x70 → 1.0,
 * imm8=0x40 → 0.125, imm8=0x7F → 1.9375).
 */

import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/** Encode FMOV Dd/Sd, #imm: bits[20:13]=imm8, bits[12]=1, bits[11:10]=00. */
function encodeFmovImm(rd: number, imm8: number, isDouble: boolean): number {
  const base = isDouble ? 0x1e600000 : 0x1e200000;
  return (base | (imm8 << 13) | (1 << 12) | rd) >>> 0;
}

/** Reference VFPExpandImm for double (ARM ARM D5.1.2). */
function vfpExpandF64(imm8: number): bigint {
  const a = (imm8 >>> 7) & 1;
  const b = (imm8 >>> 6) & 1;
  const cdefgh = imm8 & 0b111111;
  const B = b ? 0 : 1;
  const c = (cdefgh >>> 5) & 1;
  const d = (cdefgh >>> 4) & 1;
  const efgh = cdefgh & 0b1111;
  const exp =
    (B << 10) |
    (b << 9) |
    (b << 8) |
    (b << 7) |
    (b << 6) |
    (b << 5) |
    (b << 4) |
    (b << 3) |
    (b << 2) |
    (c << 1) |
    d;
  return (BigInt(a) << 63n) | (BigInt(exp) << 52n) | (BigInt(efgh) << 48n);
}

/** Reference VFPExpandImm for float32 (ARM ARM D5.1.2). */
function vfpExpandF32(imm8: number): number {
  const a = (imm8 >>> 7) & 1;
  const b = (imm8 >>> 6) & 1;
  const cdefgh = imm8 & 0b111111;
  const B = b ? 0 : 1;
  const c = (cdefgh >>> 5) & 1;
  const d = (cdefgh >>> 4) & 1;
  const efgh = cdefgh & 0b1111;
  const exp = (B << 7) | (b << 6) | (b << 5) | (b << 4) | (b << 3) | (b << 2) | (c << 1) | d;
  return ((a << 31) | (exp << 23) | (efgh << 19)) >>> 0;
}

function runOne(insn: number): CpuEngine {
  const engine = new CpuEngine();
  const bytes = [insn & 0xff, (insn >>> 8) & 0xff, (insn >>> 16) & 0xff, (insn >>> 24) & 0xff];
  const code = 0x4000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}

const u32 = (u: Uint8Array, i: number): number => {
  const dv = new DataView(u.buffer, u.byteOffset, 16);
  return dv.getUint32(i * 4, true);
};

const u64 = (u: Uint8Array): bigint => {
  const dv = new DataView(u.buffer, u.byteOffset, 16);
  return dv.getBigUint64(0, true);
};

describe('FMOV (scalar immediate) — VFPExpandImm double', () => {
  it('FMOV D0, #1.0 (real encoding 0x1E6E1000) → 0x3FF0000000000000', () => {
    const engine = runOne(0x1e6e1000);
    expect(u64(engine.readVReg(0))).toBe(0x3ff0000000000000n);
  });

  it('full 256-imm8 sweep matches the VFPExpandImm reference', () => {
    for (let imm8 = 0; imm8 < 256; imm8++) {
      const engine = runOne(encodeFmovImm(0, imm8, true));
      const got = u64(engine.readVReg(0));
      const want = vfpExpandF64(imm8);
      if (got !== want) {
        throw new Error(
          `double imm8=0x${imm8.toString(16)}: got 0x${got.toString(16)} want 0x${want.toString(16)}`,
        );
      }
    }
    expect(true).toBe(true); // sweep did not throw
  });

  it('known constants from capstone: 0x40 → 0.125, 0x7F → 1.9375', () => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setBigUint64(0, u64(runOne(encodeFmovImm(0, 0x40, true)).readVReg(0)), true);
    expect(dv.getFloat64(0, true)).toBe(0.125);
    dv.setBigUint64(0, u64(runOne(encodeFmovImm(0, 0x7f, true)).readVReg(0)), true);
    expect(dv.getFloat64(0, true)).toBe(1.9375);
  });

  it('writes only the low 8 bytes (D-register semantics)', () => {
    const engine = runOne(encodeFmovImm(3, 0x70, true));
    const dv = new DataView(engine.readVReg(3).buffer, 0, 16);
    expect(dv.getBigUint64(8, true)).toBe(0n);
  });
});

describe('FMOV (scalar immediate) — VFPExpandImm single', () => {
  it('FMOV S0, #1.0 → 0x3F800000', () => {
    const engine = runOne(encodeFmovImm(0, 0x70, false));
    expect(u32(engine.readVReg(0), 0)).toBe(0x3f800000);
  });

  it('full 256-imm8 sweep matches the VFPExpandImm reference', () => {
    for (let imm8 = 0; imm8 < 256; imm8++) {
      const engine = runOne(encodeFmovImm(0, imm8, false));
      const got = u32(engine.readVReg(0), 0);
      const want = vfpExpandF32(imm8);
      if (got !== want) {
        throw new Error(
          `single imm8=0x${imm8.toString(16)}: got 0x${got.toString(16)} want 0x${want.toString(16)}`,
        );
      }
    }
    expect(true).toBe(true); // sweep did not throw
  });

  it('negative immediate: imm8=0xFF → -1.0? no: a=1,b=1 → -(1.9375) bit pattern', () => {
    // a=1 → sign bit set; exp/frac same as imm8=0x7F (1.9375).
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, u32(runOne(encodeFmovImm(0, 0xff, false)).readVReg(0), 0), true);
    expect(dv.getFloat32(0, true)).toBe(-1.9375);
  });
});

describe('FMOV (scalar immediate) — conversions space is NOT swallowed', () => {
  // bit31=1, bits[28:24]=11110 was previously misclassified as a "scalar FMOV
  // immediate"; that space is actually the fp⇄int conversions (FMOV D0,X0,
  // FCVTZS X0,D0, ...). They must fall through to the engine's NOP catch-all
  // instead of silently writing a garbage immediate into Vd.
  it('FMOV D0, X0 (0x9E670000) is not misread as an immediate', () => {
    // A correct implementation would move X0's bits into D0; the sf=1
    // conversions are not modelled yet, so the honest behaviour is a NOP
    // (mapped-region catch-all) — NOT a garbage VFP immediate into V0.
    const engine = new CpuEngine();
    engine.writeGprValue(0, 0x1122334455667788n);
    engine.writeVReg(0, new Uint8Array(16).fill(0xaa));
    const bytes = [0x00, 0x00, 0x67, 0x9e];
    const code = 0x4000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    const dv = new DataView(engine.readVReg(0).buffer, 0, 16);
    expect(dv.getBigUint64(0, true)).toBe(0xaaaaaaaaaaaaaaaan);
    expect(dv.getBigUint64(8, true)).toBe(0xaaaaaaaaaaaaaaaan);
  });

  it('FCVTZS X0, D0 (0x9E780000) does not clobber V0', () => {
    const engine = new CpuEngine();
    engine.writeVReg(0, new Uint8Array(16).fill(0x55));
    const bytes = [0x00, 0x00, 0x78, 0x9e];
    const code = 0x4000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    const dv = new DataView(engine.readVReg(0).buffer, 0, 16);
    expect(dv.getBigUint64(0, true)).toBe(0x5555555555555555n);
  });
});
