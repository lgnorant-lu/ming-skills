import { describe, it, expect } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/**
 * NEON INS (general) — insert GPR element into a V register lane.
 *
 * Encoding (copy group, op=0 imm4=0011):
 *   `0 Q 0 01110000 imm5 0 0011 1 Rn Rd`
 *   imm5 trailing-zero count picks size: bit0=1→8-bit(idx=imm5>>1),
 *   bits[2:1]=10→16-bit, bits[3:2]=100→32-bit, bits[4:3]=1000→64-bit.
 *
 * Other lanes of V[Rd] are preserved (read-modify-write).
 */

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];

function encodeInsGeneral(rt: number, rn: number, imm5: number, q: number): number {
  // op29=0, imm4=0011
  return (0x4e001c00 | (q << 30) | (imm5 << 16) | (rn << 5) | rt) >>> 0;
}

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const code = 0x4000;
  engine.mapMemory(code, 16);
  engine.writeCode(code, Uint8Array.from(le(insn)));
  engine.start(code, code + 4);
  return engine;
}

const v = (...bytes: number[]): Uint8Array => {
  const o = new Uint8Array(16);
  o.set(bytes);
  return o;
};

describe('NEON INS (general)', () => {
  it('INS V0.16b[2], W1 — inserts an 8-bit GPR value into lane 2', () => {
    // imm5 for size=00, index=2 → 0b00101 = 5 (bit0=1, idx = imm5>>1 = 2)
    const engine = runOne(
      (e) => {
        e.writeVReg(
          0,
          v(
            0,
            0,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
            0xff,
          ),
        );
        e.writeGpr(1, 0x42n);
      },
      encodeInsGeneral(/*rt*/ 0, /*rn*/ 1, /*imm5*/ 0b00101, /*q*/ 1),
    );
    const result = engine.readVReg(0);
    expect(result[2]).toBe(0x42);
    // Other lanes preserved.
    expect(result[0]).toBe(0);
    expect(result[3]).toBe(0xff);
  });

  it('INS into lane 0 overwrites the first byte only', () => {
    const engine = runOne(
      (e) => {
        e.writeVReg(0, v(0xaa, 0xbb, 0xcc));
        e.writeGpr(1, 0x99n);
      },
      encodeInsGeneral(0, 1, /*imm5 index=0*/ 0b00001, 1),
    );
    const result = engine.readVReg(0);
    expect(result[0]).toBe(0x99);
    expect(result[1]).toBe(0xbb);
    expect(result[2]).toBe(0xcc);
  });

  it('INS 16-bit (size=01) writes a halfword', () => {
    // imm5 for size=01, index=1 → 0b00110 = 6 (bits[2:1]=10, idx=imm5>>2=1)
    const engine = runOne(
      (e) => {
        e.writeVReg(0, new Uint8Array(16));
        e.writeGpr(1, 0x1234n);
      },
      encodeInsGeneral(0, 1, 0b00110, 1),
    );
    const result = engine.readVReg(0);
    const dv = new DataView(result.buffer, result.byteOffset);
    // 16-bit lane 1 → offset 2 bytes
    expect(dv.getUint16(2, true)).toBe(0x1234);
  });

  it('INS 32-bit (size=10) writes a word', () => {
    // imm5 for size=10, index=2 → 0b10100 = 20 (bits[3:2]=100, idx=imm5>>3=2)
    const engine = runOne(
      (e) => {
        e.writeVReg(0, new Uint8Array(16));
        e.writeGpr(1, 0xdeadbeefn);
      },
      encodeInsGeneral(0, 1, 0b10100, 1),
    );
    const result = engine.readVReg(0);
    const dv = new DataView(result.buffer, result.byteOffset);
    expect(dv.getUint32(8, true)).toBe(0xdeadbeef);
  });

  it('INS 64-bit (size=11) writes a doubleword', () => {
    // imm5 for size=11, index=1 → 0b11000 = 24 (bits[4:3]=1000, idx=imm5>>4=1)
    const engine = runOne(
      (e) => {
        e.writeVReg(0, new Uint8Array(16));
        e.writeGpr(1, 0x1122334455667788n);
      },
      encodeInsGeneral(0, 1, 0b11000, 1),
    );
    const result = engine.readVReg(0);
    const dv = new DataView(result.buffer, result.byteOffset);
    // 64-bit lane 1 → offset 8 bytes
    expect(dv.getUint32(8, true)).toBe(0x55667788);
    expect(dv.getUint32(12, true)).toBe(0x11223344);
  });

  it('truncates GPR to the element size (8-bit)', () => {
    // GPR holds 0x1ff → only 0xff lands in the 8-bit lane.
    const engine = runOne(
      (e) => {
        e.writeVReg(0, new Uint8Array(16));
        e.writeGpr(1, 0x1ffn);
      },
      encodeInsGeneral(0, 1, 0b00001, 1),
    );
    expect(engine.readVReg(0)[0]).toBe(0xff);
  });
});
