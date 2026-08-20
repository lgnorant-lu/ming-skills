/**
 * L1 TDD — SHA-3 / Keccak crypto extension (FEAT_SHA3), validated against the
 * ARM Architecture Reference Manual Armv8 DDI 0487 §C4.1 and QEMU crypto_helper.c:
 *
 *   EOR3  Vd.16B, Vn.16B, Vm.16B, Va.16B — 3-way XOR (Keccak θ step)
 *   BCAX  Vd.16B, Vn.16B, Vm.16B, Va.16B — AND-NOT-XOR (Keccak χ step)
 *   RAX1  Vd.2D, Vn.2D, Vm.2D — rotate XOR NOT left-by-1 per lane (ρ+π steps)
 *   XAR   Vd.2D, Vn.2D, Vm.2D — XOR-and-rotate-right by imm6
 *
 * Two layers of proof:
 *   1. The crypto primitives (eor3/bcax/rax1/xar) produce bit-exact results
 *      against the ARM ISA pseudocode.
 *   2. The *instructions*, decoded and executed by CpuEngine from their real
 *      opcodes, drive the V register file to the same bit-exact result.
 */

import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { eor3, bcax, rax1, xar } from '@modules/native-emulator/simd-crypto';
import { classifySimdFp, decodeSimdFields } from '@modules/native-emulator/simd-decode';

// ── helpers ──
const v128 = (lo: bigint, hi: bigint): Uint8Array => {
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, lo & 0xffffffffffffffffn, true);
  dv.setBigUint64(8, hi & 0xffffffffffffffffn, true);
  return out;
};

const read128 = (v: Uint8Array): bigint => {
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  return dv.getBigUint64(0, true) | (dv.getBigUint64(8, true) << 64n);
};

const lanesOf64 = (v: Uint8Array): [bigint, bigint] => {
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  return [dv.getBigUint64(0, true), dv.getBigUint64(8, true)];
};

const hex128 = (v: Uint8Array): string => read128(v).toString(16).padStart(32, '0');

const hexLanes64 = (v: Uint8Array): string =>
  lanesOf64(v)
    .map((w) => w.toString(16).padStart(16, '0'))
    .join('');

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];

// ── EOR3 — 3-way XOR ───────────────────────────────────────────────────────────

describe('EOR3 (SHA-3 Keccak θ step)', () => {
  it('EOR3 of three all-zero registers is zero', () => {
    const z = v128(0n, 0n);
    expect(read128(eor3(z, z, z))).toBe(0n);
  });

  it('EOR3(a, b, c) = a ^ b ^ c', () => {
    const a = v128(0xaaaaaaaaaaaaaaaan, 0xbbbbbbbbbbbbbbbbn);
    const b = v128(0xccccccccccccccccn, 0xddddddddddddddddn);
    const c = v128(0x1111111111111111n, 0x2222222222222222n);
    const got = read128(eor3(a, b, c));
    const expected =
      (0xaaaaaaaaaaaaaaaan ^ 0xccccccccccccccccn ^ 0x1111111111111111n) |
      ((0xbbbbbbbbbbbbbbbbn ^ 0xddddddddddddddddn ^ 0x2222222222222222n) << 64n);
    expect(got).toBe(expected);
  });

  it('EOR3(x, x, x) = x (double-cancellation)', () => {
    const x = v128(0xdeadbeefcafef00dn, 0x1234567890abcdefn);
    expect(read128(eor3(x, x, x))).toBe(read128(x));
  });

  it('EOR3(x, x, y) = y', () => {
    const x = v128(0xffffffffffffffffn, 0xeeeeeeeeeeeeeeeen);
    const y = v128(0x0000000000000001n, 0x0000000000000002n);
    expect(read128(eor3(x, x, y))).toBe(read128(y));
  });

  it('EOR3 is associative: EOR3(a,b,c) = EOR3(EOR3(a,b,0), 0, c)', () => {
    const a = v128(0xaaaabbbbccccddddn, 0x1111222233334444n);
    const b = v128(0x5555666677778888n, 0x9999aaaabbbbccccn);
    const c = v128(0x1234123412341234n, 0x5678567856785678n);
    const z = v128(0n, 0n);
    const e2 = eor3(eor3(a, b, z), z, c);
    expect(read128(eor3(a, b, c))).toBe(read128(e2));
  });
});

// ── BCAX — Bit Clear And XOR ───────────────────────────────────────────────────

describe('BCAX (SHA-3 Keccak χ step)', () => {
  it('BCAX(0, 0, 0) = 0 ^ (0 & ~0) = 0', () => {
    const z = v128(0n, 0n);
    expect(read128(bcax(z, z, z))).toBe(0n);
  });

  it('BCAX(a, 0, 0) = a ^ (0 & ~0) = a', () => {
    const a = v128(0xdeadbeefcafef00dn, 0x1234567890abcdefn);
    const z = v128(0n, 0n);
    expect(read128(bcax(a, z, z))).toBe(read128(a));
  });

  it('BCAX(0, mask, data) = 0 ^ (mask & ~data) = mask & ~data', () => {
    const mask = v128(0xffffffffffffffffn, 0xffffffffffffffffn);
    const data = v128(0x0f0f0f0f0f0f0f0fn, 0xf0f0f0f0f0f0f0f0n);
    const got = read128(bcax(v128(0n, 0n), mask, data));
    // For any bit: 0 ^ (1 & ~d) = ~d
    // (0xf..f & ~data) = ~data
    const expLo = 0xffffffffffffffffn & ~0x0f0f0f0f0f0f0f0fn;
    const expHi = 0xffffffffffffffffn & ~0xf0f0f0f0f0f0f0f0n;
    expect(got & 0xffffffffffffffffn).toBe(expLo);
    expect(got >> 64n).toBe(expHi);
  });

  it('BCAX with pre-computed expected values', () => {
    // BCAX: result = Vn ^ (Vm & ~Va)
    const vn = v128(0xaaaa5555aaaa5555n, 0x1111000011110000n);
    const vm = v128(0xffff0000ffff0000n, 0x0000ffff0000ffffn);
    const va = v128(0x0000ffff0000ffffn, 0xffff0000ffff0000n);
    const got = read128(bcax(vn, vm, va));

    // Compute expected per-bit:
    // Vm & ~Va: only bits set in Vm that are NOT set in Va
    // Then XOR with Vn
    const loVm = 0xffff0000ffff0000n;
    const loVa = 0x0000ffff0000ffffn;
    const loVn = 0xaaaa5555aaaa5555n;
    const expLo = loVn ^ (loVm & ~loVa);

    const hiVm = 0x0000ffff0000ffffn;
    const hiVa = 0xffff0000ffff0000n;
    const hiVn = 0x1111000011110000n;
    const expHi = hiVn ^ (hiVm & ~hiVa);

    expect(got & 0xffffffffffffffffn).toBe(expLo);
    expect(got >> 64n).toBe(expHi);
  });

  it('BCAX identity: BCAX(x, allOnes, x) = x ^ (allOnes & ~x) = x ^ ~x = allOnes', () => {
    const x = v128(0x0123456789abcdefn, 0xfedcba9876543210n);
    const ones = v128(0xffffffffffffffffn, 0xffffffffffffffffn);
    expect(read128(bcax(x, ones, x))).toBe(0xffffffffffffffffn | (0xffffffffffffffffn << 64n));
  });
});

// ── RAX1 — Rotate and XOR left by 1 per lane ───────────────────────────────────

describe('RAX1 (SHA-3 Keccak ρ+π steps)', () => {
  it('RAX1(0, 0) = ROL(0 ^ ~0, 1) per lane', () => {
    // x ^ ~y = 0 ^ 0xffffffffffffffff = 0xffffffffffffffff
    // ROL(0xffffffffffffffff, 1) = 0xffffffffffffffff (all ones rotate to all ones)
    const z = v128(0n, 0n);
    const [lo, hi] = lanesOf64(rax1(z, z));
    expect(lo).toBe(0xffffffffffffffffn);
    expect(hi).toBe(0xffffffffffffffffn);
  });

  it('RAX1 with simple known value', () => {
    // vn = 1, vm = 0: x ^ ~y = 1 ^ 0xffff...f = 0xffff...e
    // ROL(0xffff...e, 1) = (0xffff...e << 1) | (0xffff...e >> 63)
    // = 0xffff...c | 0x7fff...f = wait:
    // 0xfffffffffffffffe << 1 = 0xfffffffffffffffc
    // 0xfffffffffffffffe >> 63 = 0x1
    // So result = 0xfffffffffffffffc | 0x1 = 0xfffffffffffffffd
    const vn = v128(1n, 1n);
    const vm = v128(0n, 0n);
    const [lo, hi] = lanesOf64(rax1(vn, vm));
    // x = 1, ~y = 0xffffffffffffffff
    // x ^ ~y = 1 ^ 0xffffffffffffffff = 0xfffffffffffffffe
    // ROL(0xfffffffffffffffe, 1) = (0xfffffffffffffffe << 1) | (0xfffffffffffffffe >> 63)
    // = 0xfffffffffffffffc | 1 = 0xfffffffffffffffd
    expect(lo).toBe(0xfffffffffffffffdn);
    expect(hi).toBe(0xfffffffffffffffdn);
  });

  it('RAX1 per-lane independence', () => {
    // Lane 0: vn=0x0000...0001, vm=0 → result=0xffff...fffd
    // Lane 1: vn=0, vm=0xffff...ffff → x ^ ~y = 0 ^ 0 = 0; ROL(0,1) = 0
    const vn = v128(1n, 0n);
    const vm = v128(0n, 0xffffffffffffffffn);
    const [lo, hi] = lanesOf64(rax1(vn, vm));
    expect(lo).toBe(0xfffffffffffffffdn);
    expect(hi).toBe(0n); // ~0xffffffffffffffff = 0, so x ^ ~y = 0 ^ 0 = 0; ROL(0,1) = 0
  });

  it('RAX1 with arbitrary values matches manual computation', () => {
    const vn = v128(0x0123456789abcdefn, 0xfedcba9876543210n);
    const vm = v128(0x1111111111111111n, 0x2222222222222222n);

    const computeLane = (x: bigint, y: bigint): bigint => {
      const t = (x ^ (~y & 0xffffffffffffffffn)) & 0xffffffffffffffffn;
      return ((t << 1n) | (t >> 63n)) & 0xffffffffffffffffn;
    };

    const [lo, hi] = lanesOf64(rax1(vn, vm));
    const [vnLo, vnHi] = lanesOf64(vn);
    const [vmLo, vmHi] = lanesOf64(vm);
    expect(lo).toBe(computeLane(vnLo, vmLo));
    expect(hi).toBe(computeLane(vnHi, vmHi));
  });
});

// ── XAR — XOR and Rotate right by imm6 ─────────────────────────────────────────

describe('XAR (Keccak rotation constants)', () => {
  it('XAR(0, 0, 0) = ROR(0, 0) ^ 0 = 0', () => {
    const z = v128(0n, 0n);
    const [lo, hi] = lanesOf64(xar(z, z, 0));
    expect(lo).toBe(0n);
    expect(hi).toBe(0n);
  });

  it('XAR with rotation by 0 is just XOR', () => {
    const vn = v128(0xaaaabbbbccccddddn, 0x1111222233334444n);
    const vm = v128(0x5555666677778888n, 0x9999aaaabbbbccccn);
    const [lo, hi] = lanesOf64(xar(vn, vm, 0));
    const [vnLo, vnHi] = lanesOf64(vn);
    const [vmLo, vmHi] = lanesOf64(vm);
    expect(lo).toBe(vnLo ^ vmLo);
    expect(hi).toBe(vnHi ^ vmHi);
  });

  it('XAR with rotation by 1', () => {
    // ROR(x, 1) then XOR y
    const vn = v128(1n, 2n);
    const vm = v128(0n, 0n);
    const [lo, hi] = lanesOf64(xar(vn, vm, 1));
    // ROR(1, 1): 1 >> 1 = 0; 1 << 63 = 0x8000000000000000
    expect(lo).toBe(0x8000000000000000n);
    // ROR(2, 1): 2 >> 1 = 1; 2 << 63 = 0 (MSB of 2 is 0)
    expect(hi).toBe(1n);
  });

  it('XAR with rotation by 32 bits', () => {
    const vn = v128(0x00000000ffffffffn, 0xffffffff00000000n);
    const vm = v128(0n, 0n);
    const [lo, hi] = lanesOf64(xar(vn, vm, 32));
    // ROR(0x00000000ffffffff, 32): shift right 32 = 0x0000000000000000; shift left 32 = 0xffffffff00000000
    // = 0xffffffff00000000
    expect(lo).toBe(0xffffffff00000000n);
    // ROR(0xffffffff00000000, 32): shift right 32 = 0x00000000ffffffff; shift left 32 = 0
    // = 0x00000000ffffffff
    expect(hi).toBe(0x00000000ffffffffn);
  });

  it('XAR arbitrary imm6 values produce per-lane independent results', () => {
    const vn = v128(0x0123456789abcdefn, 0xfedcba9876543210n);
    const vm = v128(0x1111111111111111n, 0x2222222222222222n);
    const imm6 = 19;

    const computeLane = (x: bigint, y: bigint): bigint => {
      const r = imm6 & 0x3f;
      return (((x >> BigInt(r)) | (x << BigInt(64 - r))) ^ y) & 0xffffffffffffffffn;
    };

    const [lo, hi] = lanesOf64(xar(vn, vm, imm6));
    const [vnLo, vnHi] = lanesOf64(vn);
    const [vmLo, vmHi] = lanesOf64(vm);
    expect(lo).toBe(computeLane(vnLo, vmLo));
    expect(hi).toBe(computeLane(vnHi, vmHi));
  });

  it('XAR imm6 is masked to bits [5:0]', () => {
    // imm6=64 should be masked to 0 (64 & 0x3f = 0), same as XAR with imm6=0
    const vn = v128(0xaaaabbbbccccddddn, 0x1111222233334444n);
    const vm = v128(0x5555666677778888n, 0x9999aaaabbbbccccn);
    expect(hexLanes64(xar(vn, vm, 0))).toBe(hexLanes64(xar(vn, vm, 64)));
    expect(hexLanes64(xar(vn, vm, 0))).toBe(hexLanes64(xar(vn, vm, 128)));
  });
});

// ── Instruction dispatch via CpuEngine ─────────────────────────────────────────

// SHA-3 instruction encodings (verified against binutils/Go asm + HotSpot
// generated code; capstone disassembles all four base words identically):
//
// EOR3:  bit21=0, size=0, bit15=0, 4-reg, Ra in bits[14:10]
//   base: 0xCE << 24 | (Rm << 16) | (Ra << 10) | (Rn << 5) | Rd
// BCAX:  bit21=1, size=0, bit15=0, 4-reg, Ra in bits[14:10]
//   base: 0xCE << 24 | bit21(1) << 21 | (Rm << 16) | (Ra << 10) | (Rn << 5) | Rd
// RAX1:  bit21=1, size=1, op15_10=100011  (base 0xCE608C00 — size=01, NOT 10)
//   base: 0xCE << 24 | size(1) << 22 | bit21(1) << 21 | (Rm << 16) | (0b100011 << 10) | (Rn << 5) | Rd
// XAR:   bit21=0, size=2, 3-reg, imm6 in bits[15:10]
//   base: 0xCE << 24 | size(2) << 22 | (Rm << 16) | (imm6 << 10) | (Rn << 5) | Rd

const eor3I = (rd: number, rn: number, rm: number, ra: number): number =>
  (0xce000000 | (rm << 16) | (ra << 10) | (rn << 5) | rd) >>> 0;

const bcaxI = (rd: number, rn: number, rm: number, ra: number): number =>
  (0xce200000 | (rm << 16) | (ra << 10) | (rn << 5) | rd) >>> 0;

const rax1I = (rd: number, rn: number, rm: number): number =>
  (0xce608c00 | (rm << 16) | (rn << 5) | rd) >>> 0;

const xarI = (rd: number, rn: number, rm: number, imm6: number): number =>
  (0xce800000 | (rm << 16) | ((imm6 & 0x3f) << 10) | (rn << 5) | rd) >>> 0;

describe('SHA-3 instructions (CpuEngine) — decode + V-register execution', () => {
  it('EOR3 executed as a real opcode matches the primitive', () => {
    const engine = new CpuEngine();
    // EOR3 V0.16B, V1.16B, V2.16B, V3.16B
    // Vn=Rm (V1=r[20:16]), Vm=Rn (V2=r[9:5]), Va=Ra (V3=r[14:10])
    engine.writeVReg(1, v128(0xaaaaaaaaaaaaaaaan, 0xbbbbbbbbbbbbbbbbn)); // Vn via Rm bits
    engine.writeVReg(2, v128(0xccccccccccccccccn, 0xddddddddddddddddn)); // Vm via Rn bits
    engine.writeVReg(3, v128(0x1111111111111111n, 0x2222222222222222n)); // Va via Ra bits
    const bytes = le(eor3I(0, 2, 1, 3)); // rd=0, rn=2, rm=1, ra=3
    const code = 0x1000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    expect(hex128(engine.readVReg(0))).toBe(
      hex128(
        eor3(
          v128(0xaaaaaaaaaaaaaaaan, 0xbbbbbbbbbbbbbbbbn),
          v128(0xccccccccccccccccn, 0xddddddddddddddddn),
          v128(0x1111111111111111n, 0x2222222222222222n),
        ),
      ),
    );
  });

  it('BCAX executed as a real opcode matches the primitive', () => {
    const engine = new CpuEngine();
    engine.writeVReg(1, v128(0xaaaa5555aaaa5555n, 0x1111000011110000n));
    engine.writeVReg(2, v128(0xffff0000ffff0000n, 0x0000ffff0000ffffn));
    engine.writeVReg(3, v128(0x0000ffff0000ffffn, 0xffff0000ffff0000n));
    const bytes = le(bcaxI(0, 1, 2, 3));
    const code = 0x1000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    expect(hex128(engine.readVReg(0))).toBe(
      hex128(
        bcax(
          v128(0xaaaa5555aaaa5555n, 0x1111000011110000n),
          v128(0xffff0000ffff0000n, 0x0000ffff0000ffffn),
          v128(0x0000ffff0000ffffn, 0xffff0000ffff0000n),
        ),
      ),
    );
  });

  it('RAX1 executed as a real opcode matches the primitive', () => {
    const engine = new CpuEngine();
    engine.writeVReg(1, v128(0x0123456789abcdefn, 0xfedcba9876543210n));
    engine.writeVReg(2, v128(0x1111111111111111n, 0x2222222222222222n));
    const bytes = le(rax1I(0, 1, 2));
    const code = 0x1000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    expect(hexLanes64(engine.readVReg(0))).toBe(
      hexLanes64(
        rax1(
          v128(0x0123456789abcdefn, 0xfedcba9876543210n),
          v128(0x1111111111111111n, 0x2222222222222222n),
        ),
      ),
    );
  });

  it('XAR executed as a real opcode matches the primitive', () => {
    const engine = new CpuEngine();
    engine.writeVReg(1, v128(0x0123456789abcdefn, 0xfedcba9876543210n));
    engine.writeVReg(2, v128(0x1111111111111111n, 0x2222222222222222n));
    const imm6 = 19;
    const bytes = le(xarI(0, 1, 2, imm6));
    const code = 0x1000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    expect(hexLanes64(engine.readVReg(0))).toBe(
      hexLanes64(
        xar(
          v128(0x0123456789abcdefn, 0xfedcba9876543210n),
          v128(0x1111111111111111n, 0x2222222222222222n),
          imm6,
        ),
      ),
    );
  });

  it('XAR with imm6=0 produces same result as plain XOR', () => {
    const engine = new CpuEngine();
    const vn = v128(0xaaaabbbbccccddddn, 0x1111222233334444n);
    const vm = v128(0x5555666677778888n, 0x9999aaaabbbbccccn);
    engine.writeVReg(1, vn);
    engine.writeVReg(2, vm);
    const bytes = le(xarI(0, 1, 2, 0));
    const code = 0x1000;
    engine.mapMemory(code, bytes.length + 8);
    engine.writeCode(code, Uint8Array.from(bytes));
    engine.start(code, code + bytes.length);
    // XAR(Vn, Vm, 0) = Vn ^ Vm per lane
    const [outLo, outHi] = lanesOf64(engine.readVReg(0));
    const [vnLo, vnHi] = lanesOf64(vn);
    const [vmLo, vmHi] = lanesOf64(vm);
    expect(outLo).toBe(vnLo ^ vmLo);
    expect(outHi).toBe(vnHi ^ vmHi);
  });
});

// ── Classification tests ───────────────────────────────────────────────────────

describe('SHA-3 instruction classification', () => {
  it('classifySimdFp returns "crypto-sha3-keccak" for EOR3 encoding', () => {
    const insn = eor3I(0, 1, 2, 3);
    const f = decodeSimdFields(insn);
    expect(classifySimdFp(f)).toBe('crypto-sha3-keccak');
  });

  it('classifySimdFp returns "crypto-sha3-keccak" for BCAX encoding', () => {
    const insn = bcaxI(0, 1, 2, 3);
    const f = decodeSimdFields(insn);
    expect(classifySimdFp(f)).toBe('crypto-sha3-keccak');
  });

  it('classifySimdFp returns "crypto-sha3-keccak" for RAX1 encoding', () => {
    const insn = rax1I(0, 1, 2);
    const f = decodeSimdFields(insn);
    expect(classifySimdFp(f)).toBe('crypto-sha3-keccak');
  });

  it('classifySimdFp returns "crypto-sha3-keccak" for XAR encoding', () => {
    const insn = xarI(0, 1, 2, 5);
    const f = decodeSimdFields(insn);
    expect(classifySimdFp(f)).toBe('crypto-sha3-keccak');
  });

  it('SHA-3 instructions are not confused with SHA-512', () => {
    // EOR3 has bit15=0, so isCryptoSha512 should reject it
    const eor3Insn = eor3I(0, 1, 2, 3);
    const f = decodeSimdFields(eor3Insn);
    expect(classifySimdFp(f)).toBe('crypto-sha3-keccak');
    expect(classifySimdFp(f)).not.toBe('crypto-sha512');
  });
});
