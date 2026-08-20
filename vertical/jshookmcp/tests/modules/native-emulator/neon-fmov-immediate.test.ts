/**
 * E4 finale: NEON FMOV (vector, immediate) — bit-exact coverage
 *
 * ARM ARM C7.2.133 — `0 Q 0 0111100000 abc cmode=1111 0 1 defgh Rd` broadcasts an
 * 8-bit-encoded IEEE-754 float32 to every lane of a `.4S` (Q=1) or `.2S` (Q=0)
 * destination. The 8-bit immediate expands via the VFPExpandImm layout (the same
 * `aBbbbbbc defgh` template the scalar `FMOV Sd,#imm` form uses), broadcast across
 * 2/4 lanes.
 *
 * Verification strategy: the 256-imm8 sweep is the authoritative oracle — every
 * imm8 code that the engine decodes must match the local VFPExpandImm reference
 * bit-for-bit, and the value must be identical across all Q=1 lanes (4) and
 * limited to 2 lanes with bytes 8..15 zeroed for Q=0.
 */

import { describe, expect, it } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';

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

/**
 * Encode FMOV (vector, #imm) — `0 Q 0 0111100000 abc cmode=1111 0 1 defgh Rd`.
 *
 * The 8-bit immediate splits as `a=imm8[7], b=imm8[6], cdefgh=imm8[5:0]`. The
 * `abc` and `defgh` halves land in instruction bits[18:16] and [9:5] respectively.
 *
 * Base word: bits[31:29]=000, bits[28:19]=0111100000, cmode[15:12]=1111,
 *            [11]=0, [10]=1 → 0x0F00F400. Then OR in Q, abc, defgh, Rd.
 */
function encodeFmovVector(Vd: number, imm8: number, Q: number): number {
  const a = (imm8 >>> 7) & 1;
  const b = (imm8 >>> 6) & 1;
  const cdefgh = imm8 & 0b111111;
  const abc = (a << 2) | (b << 1) | ((cdefgh >>> 5) & 1);
  const defgh = cdefgh & 0b11111;
  return (0x0f00f400 | (Q << 30) | (abc << 16) | (defgh << 5) | Vd) >>> 0;
}

/**
 * Reference VFPExpandImm for float32 (ARM ARM D5.1.2) — must match
 * `execNeonFmovVector` exactly. imm8 = a:b:cdefgh; exp = NOT(b):b×5:c:d,
 * frac = e:f:g:h:0×19. Verified against real encodings: FMOV V0.4S, #1.0
 * (imm8=0x70) expands to 0x3F800000.
 */
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

const u32 = (u: Uint8Array, i: number): number => {
  const dv = new DataView(u.buffer, u.byteOffset, 16);
  return dv.getUint32(i * 4, true);
};

describe('E4: FMOV (vector, immediate) — IEEE-754 lane broadcast', () => {
  it('every Q=1 lane matches VFPExpandImm across the full 256-imm8 space', () => {
    // Authoritative bit-exact oracle: for every imm8 code, all 4 lanes of the
    // broadcast destination must equal the locally-computed VFPExpandImm value.
    // This subsumes every "FMOV V0.4S, #x" constant the encoder can emit.
    for (let imm8 = 0; imm8 < 256; imm8++) {
      const engine = runOne(
        (e) => e.writeVReg(0, new Uint8Array(16)),
        encodeFmovVector(0, imm8, 1),
      );
      const r = engine.readVReg(0);
      const expected = vfpExpandF32(imm8);
      for (let lane = 0; lane < 4; lane++) {
        if (u32(r, lane) !== expected) {
          throw new Error(
            `imm8=0x${imm8.toString(16)} lane ${lane}: got 0x${u32(r, lane).toString(16)} want 0x${expected.toString(16)}`,
          );
        }
      }
    }
    expect(true).toBe(true); // sweep did not throw
  });

  it('Q=0 (.2S) writes 2 lanes and zeroes the high 8 bytes', () => {
    for (const imm8 of [0x00, 0x70, 0xff, 0x38]) {
      const engine = runOne(
        (e) => e.writeVReg(0, new Uint8Array(16)),
        encodeFmovVector(0, imm8, 0),
      );
      const r = engine.readVReg(0);
      const expected = vfpExpandF32(imm8);
      expect(u32(r, 0)).toBe(expected);
      expect(u32(r, 1)).toBe(expected);
      // Bytes 8..15 must be zero (Q=0 only writes the low 64 bits).
      const dv = new DataView(r.buffer, r.byteOffset, 16);
      expect(dv.getBigUint64(8, true)).toBe(0n);
    }
  });

  it('writes to a non-zero destination register (V7, not V0)', () => {
    const engine = runOne((e) => e.writeVReg(7, new Uint8Array(16)), encodeFmovVector(7, 0x70, 1));
    const r = engine.readVReg(7);
    const expected = vfpExpandF32(0x70);
    for (let lane = 0; lane < 4; lane++) expect(u32(r, lane)).toBe(expected);
  });
});
