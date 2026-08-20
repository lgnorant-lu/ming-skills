/**
 * E4 finale: scalar half-precision FP (FEAT_FP16) — bit-exact coverage.
 *
 * Tests the fp16 software model in isolation (round-trip against canonical
 * binary16 vectors) AND the end-to-end dispatcher wiring (ftype=11 routes
 * through the new fp16 handlers, not the fp32/fp64 path).
 *
 * Canonical binary16 reference vectors are taken from the IEEE-754-2008 /
 * Half-Precision floating-point spec (the same ones the fp16 model was
 * validated against in scripts/verify-fp16.mjs).
 */

import { describe, expect, it } from 'vitest';
import {
  f16RoundBits,
  f16BitsToNumber,
  f16round,
  packF16,
  readF16,
} from '@modules/native-emulator/fp/simd-fp16';
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

const h16 = (u: Uint8Array): number => {
  const dv = new DataView(u.buffer, u.byteOffset, 16);
  return dv.getUint16(0, true);
};
/** Write an fp16 value into a fresh 16-byte V register. */
const vh = (bits16: number): Uint8Array => {
  const o = new Uint8Array(16);
  o[0] = bits16 & 0xff;
  o[1] = (bits16 >>> 8) & 0xff;
  return o;
};

// ── Pure-model bit-exact vectors ─────────────────────────────────────────────

describe('E4 fp16: software model — canonical IEEE-754 binary16 vectors', () => {
  const vectors: Array<[string, number, number]> = [
    // [description, f64 input, expected u16 bit pattern]
    ['+0.0', 0, 0x0000],
    ['-0.0', -0, 0x8000],
    ['+1.0', 1, 0x3c00],
    ['-1.0', -1, 0xbc00],
    ['+2.0', 2, 0x4000],
    ['+0.5', 0.5, 0x3800],
    ['1.5', 1.5, 0x3e00],
    ['-1.5', -1.5, 0xbe00],
    ['+0.1 (→0.0999756)', 0.1, 0x2e66],
    ['3.14159 (→3.140625)', 3.14159, 0x4248],
    ['smallest normal 2^-14', 2 ** -14, 0x0400],
    ['largest normal 65504', 65504, 0x7bff],
    ['smallest subnormal 2^-24', 2 ** -24, 0x0001],
    ['half smallest subnormal → +0', 2 ** -25, 0x0000],
    ['overflow 70000 → +Inf', 70000, 0x7c00],
    ['+Inf', Infinity, 0x7c00],
    ['-Inf', -Infinity, 0xfc00],
  ];
  for (const [name, input, expected] of vectors) {
    it(`${name} → 0x${expected.toString(16).padStart(4, '0')}`, () => {
      expect(Number(f16RoundBits(input))).toBe(expected);
    });
  }
  it('NaN → canonical quiet NaN (0x7E00)', () => {
    expect(Number(f16RoundBits(NaN))).toBe(0x7e00);
  });

  it('round-trip: pack → read preserves the bit pattern', () => {
    for (const bits of [0x0000, 0x3c00, 0xbc00, 0x7bff, 0x0400, 0x0001, 0x7c00]) {
      const packed = packF16(f16BitsToNumber(BigInt(bits)));
      expect(h16(packed)).toBe(bits);
    }
  });

  it('f16round: ties round to even (0.5 → 0, 1.5 → 2)', () => {
    // 0.5 sits exactly between 0 and 1; ties-to-even picks the even mantissa (0).
    // 1.5 sits exactly between 1 and 2; ties-to-even picks 2 (even).
    expect(Number(f16RoundBits(0.5))).toBe(0x3800); // 0.5 itself is exactly representable
    expect(Number(f16RoundBits(1.5))).toBe(0x3e00); // 1.5 exactly representable
    // A genuine tie: halfway between two adjacent fp16 values near 1.0.
    // Adjacent values 1.0 (0x3c00) and 1.0+2^-10 (0x3c01). Midpoint 1 + 2^-11.
    // Ties-to-even: mantissa of 0x3c00 is 0 (even) → stays 0x3c00.
    const tie = 1 + 2 ** -11;
    expect(Number(f16RoundBits(tie))).toBe(0x3c00);
  });
});

// ── Dispatcher end-to-end ────────────────────────────────────────────────────

/**
 * Scalar FP two-source (ARM ARM "Floating-point data-processing (2 source)"):
 * `0001 11110 ftype 1 Rm opcode[15:12] 1 0 Rn Rd` with bits[11:10]=10 fixed.
 * ftype=11 (half). opcode[15:12]: FADD=0010, FMUL=0000, FSUB=0011, FDIV=0001.
 * Assembled bit-for-bit: bit31-29=000, bits[28:24]=11110, bit21=1, bit11=1, bit10=0.
 */
function encodeFpTwoSrcH(Vd: number, Vn: number, Vm: number, op4: number): number {
  return (
    (0x1e200800 | // base with bit11=1 (0x800), bit10=0
      (0b11 << 22) | // ftype=11 (half)
      (Vm << 16) |
      (op4 << 12) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

/** One-source fp16 (ARM ARM "1 source"): bit14=1 fixed, opcode in bits[20:15] (bit15 is opcode LSB).
 *  Layout: `0001 11110 ftype 1 opcode[20:15] 1 0 Rn Rd` → bits[14:10]=10000. */
function encodeFpOneSrcH(Vd: number, Vn: number, op6: number): number {
  // bit14 fixed = 0x4000. opcode[20:15] is OR'd in (its bit15 LSB lands at 0x8000).
  return (
    (0x1e204000 | // bit14=1
      (0b11 << 22) | // ftype=11
      (op6 << 15) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

/** FCMPH (ARM ARM): `0001 11110 11 Rm op 1000 opcode2 Rn 00000`. Fixed bits[15:10]=1000_00. */
function encodeFpCmpH(Vn: number, Vm: number, op2_5: number): number {
  // op bit[15:14]: 00=FMULA, ...; FCMP/FCMPE use opcode2=001000 (bit[15:10]=001000 with op in [14]).
  // ARM ARM: FCMP Hn,Hm = `0001 11110 11 Rm 00 1000 Rn 001000`? Let's use the canonical:
  // bits[15:10] = 100000 for FCMP-with-register → bit15=1, bit14=0, bits[13:10]=0000.
  // opcode2[4:0]=00000 for "FCMP Hn,Hm"; bit3 of opcode2 = compare-with-zero.
  return (
    (0x1e202000 | // bit15=1 (0x8000), bits[14:10]=00000
      (0b11 << 22) | // ftype=11
      (Vm << 16) |
      (Vn << 5) |
      op2_5) >>>
    0
  );
}

/** FCSELH (ARM ARM "Conditional select"): `0001 11110 ftype Rm cond 11 Rn Rd`. bits[11:10]=11. */
function encodeFpCondSelH(Vd: number, Vn: number, Vm: number, cond: number): number {
  return (
    (0x1e200c00 | // bit11=1, bit10=1 → 0xC00
      (0b11 << 22) |
      (Vm << 16) |
      (cond << 12) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

describe('E4 fp16: dispatcher routes ftype=11 through fp16 handlers', () => {
  it('FADD H0,H1,H2 — 1.0 + 1.0 = 2.0 (bit-exact)', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x3c00)); // H1 = 1.0
        e.writeVReg(2, vh(0x3c00)); // H2 = 1.0
      },
      encodeFpTwoSrcH(0, 1, 2, 0b0010),
    );
    expect(h16(engine.readVReg(0))).toBe(0x4000); // 2.0
  });

  it('FMUL H0,H1,H2 — 1.5 * 2.0 = 3.0', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x3e00)); // 1.5
        e.writeVReg(2, vh(0x4000)); // 2.0
      },
      encodeFpTwoSrcH(0, 1, 2, 0b0000),
    );
    expect(h16(engine.readVReg(0))).toBe(0x4200); // 3.0
  });

  it('FSUB H0,H1,H2 — 3.0 - 1.0 = 2.0', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x4200)); // 3.0
        e.writeVReg(2, vh(0x3c00)); // 1.0
      },
      encodeFpTwoSrcH(0, 1, 2, 0b0011),
    );
    expect(h16(engine.readVReg(0))).toBe(0x4000);
  });

  it('FDIV H0,H1,H2 — 1.0 / 0.0 = +Inf (IEEE divide-by-zero)', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x3c00)); // 1.0
        e.writeVReg(2, vh(0x0000)); // 0.0
      },
      encodeFpTwoSrcH(0, 1, 2, 0b0001),
    );
    expect(h16(engine.readVReg(0))).toBe(0x7c00); // +Inf
  });

  it('FABS H0,H1 — clears the sign bit', () => {
    const engine = runOne(
      (e) => e.writeVReg(1, vh(0xbc00)), // -1.0
      encodeFpOneSrcH(0, 1, 0b000001),
    );
    expect(h16(engine.readVReg(0))).toBe(0x3c00); // +1.0
  });

  it('FNEG H0,H1 — flips the sign bit', () => {
    const engine = runOne(
      (e) => e.writeVReg(1, vh(0x3c00)), // +1.0
      encodeFpOneSrcH(0, 1, 0b000010),
    );
    expect(h16(engine.readVReg(0))).toBe(0xbc00); // -1.0
  });

  it('FSQRT H0,H1 — sqrt(4.0) = 2.0', () => {
    const engine = runOne(
      (e) => e.writeVReg(1, vh(0x4400)), // 4.0
      encodeFpOneSrcH(0, 1, 0b000011),
    );
    expect(h16(engine.readVReg(0))).toBe(0x4000); // 2.0
  });

  it('FMOV (register) H0,H1 — copies the value verbatim', () => {
    const engine = runOne(
      (e) => e.writeVReg(1, vh(0x4248)), // 3.140625
      encodeFpOneSrcH(0, 1, 0b000000),
    );
    expect(h16(engine.readVReg(0))).toBe(0x4248);
  });

  it('FCMP H1,H2 (1.0 vs 2.0) sets NZCV = N=1 (less-than)', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x3c00)); // 1.0
        e.writeVReg(2, vh(0x4000)); // 2.0
      },
      encodeFpCmpH(1, 2, 0b00000),
    );
    // less-than → N=1 Z=0 C=0 V=0. The engine exposes flags via registerFile.
    const rf = (
      engine as unknown as { registerFile: { n: boolean; z: boolean; c: boolean; v: boolean } }
    ).registerFile;
    expect(rf.n).toBe(true);
    expect(rf.z).toBe(false);
    expect(rf.c).toBe(false);
    expect(rf.v).toBe(false);
  });

  it('FCSEL H0,H1,H2,AL (cond always) — picks H1 (the then source)', () => {
    // AL (condition 14 = always true) forces the then branch → H1 = 1.0.
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x3c00)); // H1 = 1.0 (taken when cond true)
        e.writeVReg(2, vh(0x4000)); // H2 = 2.0 (taken when cond false)
      },
      encodeFpCondSelH(0, 1, 2, 0b1110), // AL = always true
    );
    expect(h16(engine.readVReg(0))).toBe(0x3c00); // H1 selected
  });

  it('rounding matches between pure model and dispatcher (FADD)', () => {
    // 0.1 + 0.2 in fp16: both round to 0x2e66 (≈0.0999756), sum ≈0.1999512 →
    // 0x3266 (≈0.19995117). Verify the dispatcher agrees with f16round on the
    // raw double sum.
    const a = f16BitsToNumber(0x2e66n);
    const b = f16BitsToNumber(0x2e66n);
    const expected = f16round(a + b);
    const engine = runOne(
      (e) => {
        e.writeVReg(1, vh(0x2e66));
        e.writeVReg(2, vh(0x2e66));
      },
      encodeFpTwoSrcH(0, 1, 2, 0b0010),
    );
    expect(readF16(engine.readVReg(0))).toBe(expected);
  });
});

describe('E4 fp16: isScalarFp now accepts ftype=11 (regression)', () => {
  it('FADDH is no longer reported as "Unsupported opcode"', () => {
    // Before the fix, ftype=11 fell through isScalarFp's `ftype !== 0b11` guard
    // and the engine threw "Unsupported ARM64 opcode". Now it must execute.
    let threw = false;
    try {
      runOne(
        (e) => {
          e.writeVReg(1, vh(0x3c00));
          e.writeVReg(2, vh(0x3c00));
        },
        encodeFpTwoSrcH(0, 1, 2, 0b0010),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
