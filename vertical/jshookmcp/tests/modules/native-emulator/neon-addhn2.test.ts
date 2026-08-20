/**
 * ADDHN2/SUBHN2/RADDHN2/RSUBHN2 — q=1 must preserve the destination's low half.
 *
 * Three-different encoding: 0 Q U 01110 size 1 Rm opcode[15:12] 00 Rn Rd.
 *   ADDHN/RADDHN: opcode=0100 (U=0/U=1), SUBHN/RSUBHN: opcode=0110 (U=0/U=1).
 * The 2 forms (Q=1) write the narrow high-half results into Vd's upper lanes
 * and leave the existing low half untouched — the low half comes from the
 * destination register, NOT from Vn (the operand).
 */

import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

function encodeNarrow(
  q: number,
  u: number,
  opc: number,
  rm: number,
  rn: number,
  rd: number,
): number {
  return (0x0e200000 | (q << 30) | (u << 29) | (rm << 16) | (opc << 12) | (rn << 5) | rd) >>> 0;
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

/** 8 × 16-bit operand, little-endian. */
function v8h(values: number[]): Uint8Array {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setUint16(i * 2, v, true));
  return out;
}

/** Vd prefilled with a distinctive low-half pattern (0xA5 in every byte). */
function vdPrefilled(): Uint8Array {
  return new Uint8Array(16).fill(0xa5);
}

describe('ADDHN2/SUBHN2 (Q=1) preserve the destination low half', () => {
  it('ADDHN2 keeps Vd low 8 bytes and writes high sums into the upper half', () => {
    // Vn: 0x0123 0x4567 ... ; Vm: 0x00FF ... → sums >> 8
    const vn = v8h([0x0123, 0x4567, 0x89ab, 0xcdef, 0x1111, 0x2222, 0x3333, 0x4444]);
    const vm = v8h([0x00ff, 0x0001, 0x0001, 0x0001, 0x00ff, 0x00ff, 0x00ff, 0x00ff]);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(3, vm);
        e.writeVReg(1, vdPrefilled());
      },
      encodeNarrow(1, 0, 0b0100, 3, 2, 1), // ADDHN2 V1.16B, V2.8H, V3.8H
    );
    const out = engine.readVReg(1);
    // low half untouched: every byte still 0xA5
    expect([...out.subarray(0, 8)]).toEqual(Array.from({ length: 8 }, () => 0xa5));
    // high half = (Vn+Vm) >> 8: 0x0222>>8=0x02, 0x4568>>8=0x45, ...,
    // 0x1210>>8=0x12, 0x2321>>8=0x23, 0x3432>>8=0x34, 0x4543>>8=0x45
    expect([...out.subarray(8)]).toEqual([0x02, 0x45, 0x89, 0xcd, 0x12, 0x23, 0x34, 0x45]);
  });

  it('SUBHN2 keeps Vd low half and writes high diffs into the upper half', () => {
    const vn = v8h([0x0200, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000, 0x1000]);
    const vm = v8h([0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001]);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(3, vm);
        e.writeVReg(1, vdPrefilled());
      },
      encodeNarrow(1, 0, 0b0110, 3, 2, 1), // SUBHN2 V1.16B, V2.8H, V3.8H
    );
    const out = engine.readVReg(1);
    expect([...out.subarray(0, 8)]).toEqual(Array.from({ length: 8 }, () => 0xa5));
    // (0x0200-0x0001)>>8 = 0x01 ; (0x1000-0x0001)>>8 = 0x0F
    expect([...out.subarray(8)]).toEqual([0x01, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f]);
  });

  it('RADDHN2 rounds before narrowing and keeps Vd low half', () => {
    // sum + 0x80 (round constant for 16-bit inputs), then >> 8.
    const vn = v8h([0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008]);
    const vm = v8h([0x007f, 0x007f, 0x007f, 0x007f, 0x007f, 0x007f, 0x007f, 0x007f]);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(3, vm);
        e.writeVReg(1, vdPrefilled());
      },
      encodeNarrow(1, 1, 0b0100, 3, 2, 1), // RADDHN2 V1.16B, V2.8H, V3.8H
    );
    const out = engine.readVReg(1);
    expect([...out.subarray(0, 8)]).toEqual(Array.from({ length: 8 }, () => 0xa5));
    // (0x0080+0x80)>>8 = 0x01 ; (0x0081+0x80)>>8 = 0x01 ; (0x0082+0x80)>>8 = 0x01 ... (0x0087+0x80)>>8 = 0x01
    expect([...out.subarray(8)]).toEqual(Array.from({ length: 8 }, () => 0x01));
  });

  it('RSUBHN2 rounds before narrowing and keeps Vd low half', () => {
    const vn = v8h([0x0100, 0x0100, 0x0100, 0x0100, 0x0100, 0x0100, 0x0100, 0x0100]);
    const vm = v8h([0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001, 0x0001]);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(3, vm);
        e.writeVReg(1, vdPrefilled());
      },
      encodeNarrow(1, 1, 0b0110, 3, 2, 1), // RSUBHN2 V1.16B, V2.8H, V3.8H
    );
    const out = engine.readVReg(1);
    expect([...out.subarray(0, 8)]).toEqual(Array.from({ length: 8 }, () => 0xa5));
    // (0x00FF+0x80)>>8 = 0x01
    expect([...out.subarray(8)]).toEqual(Array.from({ length: 8 }, () => 0x01));
  });
});

describe('ADDHN/SUBHN (Q=0) regression', () => {
  it('ADDHN writes the low half of the result and zeroes the upper bytes', () => {
    const vn = v8h([0x0123, 0x4567, 0x89ab, 0xcdef, 0x1111, 0x2222, 0x3333, 0x4444]);
    const vm = v8h([0x00ff, 0x0001, 0x0001, 0x0001, 0x00ff, 0x00ff, 0x00ff, 0x00ff]);
    const engine = runOne(
      (e) => {
        e.writeVReg(2, vn);
        e.writeVReg(3, vm);
        e.writeVReg(1, vdPrefilled());
      },
      encodeNarrow(0, 0, 0b0100, 3, 2, 1), // ADDHN V1.8B, V2.8H, V3.8H
    );
    const out = engine.readVReg(1);
    // All 8 result bytes land in the low half; the upper 8 bytes are zeroed.
    expect([...out.subarray(0, 8)]).toEqual([0x02, 0x45, 0x89, 0xcd, 0x12, 0x23, 0x34, 0x45]);
    expect([...out.subarray(8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
