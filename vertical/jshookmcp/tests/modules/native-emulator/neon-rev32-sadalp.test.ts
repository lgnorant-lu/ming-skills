/**
 * NEON two-register-misc U-bit dispatch — REV32 (opcode 00000, U=1) and
 * SADALP/UADALP (opcode 00110).
 *
 * Encoding space (ARM ARM C7.2 two-register miscellaneous):
 *   0 Q U 01110 size 10000 opcode[16:12] 10 Rn Rd
 *
 * Verified against capstone (LLVM):
 *   0x4E200841 (U=0, opc=00000) → rev64 v1.16b, v2.16b
 *   0x6E200841 (U=1, opc=00000) → rev32 v1.16b, v2.16b
 *   0x4E206841 (U=0, opc=00110) → sadalp v1.8h, v2.16b
 *   0x6E206841 (U=1, opc=00110) → uadalp v1.8h, v2.16b
 */

import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/** Encode a two-register-misc instruction word. */
function encodeTwoRegMisc(
  rd: number,
  rn: number,
  opc: number,
  u: number,
  q: number,
  size = 0,
): number {
  return (0x0e200800 | (q << 30) | (u << 29) | (size << 22) | (opc << 12) | (rn << 5) | rd) >>> 0;
}

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = [insn & 0xff, (insn >>> 8) & 0xff, (insn >>> 16) & 0xff, (insn >>> 24) & 0xff];
  const code = 0x4000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}

const u16 = (u: Uint8Array, i: number): number => {
  const dv = new DataView(u.buffer, u.byteOffset, 16);
  return dv.getUint16(i * 2, true);
};

describe('REV32 (opcode 00000, U=1) vs REV64 (U=0)', () => {
  it('REV32 .16B reverses each 4-byte group (Q=1)', () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = i; // 00 01 02 03 04 05 06 07 ...
    const engine = runOne((e) => e.writeVReg(2, bytes), encodeTwoRegMisc(1, 2, 0b00000, 1, 1));
    const out = engine.readVReg(1);
    expect([...out]).toEqual([3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8, 15, 14, 13, 12]);
  });

  it('REV32 .8B reverses each 4-byte group in the low 64 bits (Q=0)', () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = i;
    const engine = runOne((e) => e.writeVReg(2, bytes), encodeTwoRegMisc(1, 2, 0b00000, 1, 0));
    const out = engine.readVReg(1);
    // active half: 03 02 01 00 07 06 05 04 ; upper 8 bytes zeroed
    expect([...out]).toEqual([3, 2, 1, 0, 7, 6, 5, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('REV64 .16B still reverses each 8-byte group (U=0 regression)', () => {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = i;
    const engine = runOne((e) => e.writeVReg(2, bytes), encodeTwoRegMisc(1, 2, 0b00000, 0, 1));
    const out = engine.readVReg(1);
    expect([...out]).toEqual([7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10, 9, 8]);
  });
});

describe('SADALP/UADALP (opcode 00110)', () => {
  it('SADALP accumulates signed pairwise sums into Vd', () => {
    // Vn (16 bytes as 8-bit): [-1, -2, 3, 4, -5, -6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0]
    const vn = new Uint8Array(16);
    for (const [i, v] of [0xff, 0xfe, 0x03, 0x04, 0xfb, 0xfa, 0x07, 0x08].entries()) vn[i] = v;
    // Vd (accumulator, 8 × 16-bit): [100, 0, 0, 0, 0, 0, 0, 0]
    const vd = new Uint8Array(16);
    new DataView(vd.buffer).setInt16(0, 100, true);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(1, vd);
      },
      encodeTwoRegMisc(1, 2, 0b00110, 0, 1),
    );
    const out = engine.readVReg(1);
    // pairs: (-1+-2)=-3, (3+4)=7, (-5+-6)=-11, (7+8)=15 → acc: 97, 7, -11, 15
    expect(u16(out, 0)).toBe(97);
    expect(u16(out, 1)).toBe(7);
    expect(u16(out, 2)).toBe(0xffff - 10); // -11 as u16
    expect(u16(out, 3)).toBe(15);
  });

  it('UADALP accumulates unsigned pairwise sums into Vd', () => {
    const vn = new Uint8Array(16);
    for (const [i, v] of [1, 2, 3, 4, 5, 6, 7, 8].entries()) vn[i] = v;
    const vd = new Uint8Array(16);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(1, vd);
      },
      encodeTwoRegMisc(1, 2, 0b00110, 1, 1),
    );
    const out = engine.readVReg(1);
    // pairs: 3, 7, 11, 15 (no accumulator → same values)
    expect(u16(out, 0)).toBe(3);
    expect(u16(out, 1)).toBe(7);
    expect(u16(out, 2)).toBe(11);
    expect(u16(out, 3)).toBe(15);
  });

  it('SADALP .8B (Q=0) writes 4 accumulators only', () => {
    const vn = new Uint8Array(16);
    for (const [i, v] of [1, 1, 2, 2, 3, 3, 4, 4].entries()) vn[i] = v;
    const engine = runOne((e) => e.writeVReg(2, vn), encodeTwoRegMisc(1, 2, 0b00110, 0, 0));
    const out = engine.readVReg(1);
    expect(u16(out, 0)).toBe(2);
    expect(u16(out, 1)).toBe(4);
    expect(u16(out, 2)).toBe(6);
    expect(u16(out, 3)).toBe(8);
    // upper 8 bytes untouched (zero)
    expect(u16(out, 4)).toBe(0);
    expect(u16(out, 7)).toBe(0);
  });
});
