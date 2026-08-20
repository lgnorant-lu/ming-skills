import { describe, it, expect } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/**
 * NEON De-interleaving Load/Store (LD2/LD3/LD4/ST2/ST3/ST4)
 *
 * These instructions load/store N registers worth of interleaved elements —
 * the data layout audio (LD2 stereo), image (LD3 RGB / LD4 RGBA), and matrix
 * kernels stream through V registers. The implementation lives in
 * simd.ts `execMultiStructLoadStore` + `transferInterleavedStructs`.
 *
 * Encoding (no-offset form): `0 Q 0011000 L 000000 opcode size Rn Rt`
 *   opcode: LD2/ST2 = 0b1000, LD3/ST3 = 0b0100, LD4/ST4 = 0b0000
 *   size: 00 = 8-bit elements, 01 = 16-bit, 10 = 32-bit
 */

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];

/** Encode an LDn/STn multiple-structures instruction (no-offset form). */
function encodeStructTransfer(
  structCount: number,
  rt: number,
  rn: number,
  size: number,
  q: number,
  isLoad: boolean,
): number {
  const opcode = structCount === 2 ? 0b1000 : structCount === 3 ? 0b0100 : 0b0000;
  const lBit = isLoad ? 1 : 0;
  return (
    (0x0c000000 | (q << 30) | (lBit << 22) | (opcode << 12) | (size << 10) | (rn << 5) | rt) >>> 0
  );
}

const DATA_BASE = 0x8000;
const CODE_BASE = 0x4000;

function runWithData(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  engine.mapMemory(CODE_BASE, 16);
  engine.writeCode(CODE_BASE, Uint8Array.from(le(insn)));
  engine.start(CODE_BASE, CODE_BASE + 4);
  return engine;
}

describe('NEON De-interleave LD2/LD3/LD4', () => {
  describe('LD2 — 2-register de-interleave (8-bit, stereo layout)', () => {
    it('LD2.16b splits even/odd bytes into V0/V1', () => {
      // Interleaved memory: a0 b0 a1 b1 ... a15 b15 (32 bytes)
      const data = new Uint8Array(32);
      for (let i = 0; i < 16; i++) {
        data[i * 2] = 0xa0 + i; // 'a' lane
        data[i * 2 + 1] = 0xb0 + i; // 'b' lane
      }

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeCode(DATA_BASE, data);
          e.writeGpr(2, BigInt(DATA_BASE));
        },
        encodeStructTransfer(2, /*rt*/ 0, /*rn*/ 2, /*size*/ 0, /*Q*/ 1, /*load*/ true),
      );

      const v0 = engine.readVReg(0);
      const v1 = engine.readVReg(1);
      // V0 collects the 'a' lane (even indices): a0..a15
      expect(Array.from(v0.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0xa0 + i));
      // V1 collects the 'b' lane (odd indices): b0..b15
      expect(Array.from(v1.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0xb0 + i));
    });

    it('LD2.16b de-interleaves 16-bit stereo samples', () => {
      // Two 16-bit lanes interleaved: L0 R0 L1 R1 ... (4 samples per channel = 16 bytes)
      const data = new Uint8Array(32);
      const left = [100, 200, 300, 400, 500, 600, 700, 800];
      const right = [1, 2, 3, 4, 5, 6, 7, 8];
      const dv = new DataView(data.buffer);
      for (let i = 0; i < 8; i++) {
        dv.setInt16(i * 4, left[i]!, true);
        dv.setInt16(i * 4 + 2, right[i]!, true);
      }

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeCode(DATA_BASE, data);
          e.writeGpr(2, BigInt(DATA_BASE));
        },
        encodeStructTransfer(2, 0, 2, /*size*/ 1, 1, true),
      );

      const v0 = engine.readVReg(0);
      const v1 = engine.readVReg(1);
      const dv0 = new DataView(v0.buffer, v0.byteOffset);
      const dv1 = new DataView(v1.buffer, v1.byteOffset);
      for (let i = 0; i < 8; i++) {
        expect(dv0.getInt16(i * 2, true)).toBe(left[i]);
        expect(dv1.getInt16(i * 2, true)).toBe(right[i]);
      }
    });
  });

  describe('LD3 — 3-register de-interleave (RGB layout)', () => {
    it('LD3.16b de-interleaves RGB triplets', () => {
      // 16 RGB pixels × 3 channels = 48 bytes; only 16 elements fit per register lane
      const data = new Uint8Array(48);
      for (let lane = 0; lane < 16; lane++) {
        data[lane * 3] = 0x10 + lane; // R
        data[lane * 3 + 1] = 0x20 + lane; // G
        data[lane * 3 + 2] = 0x30 + lane; // B
      }

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeCode(DATA_BASE, data);
          e.writeGpr(2, BigInt(DATA_BASE));
        },
        encodeStructTransfer(3, 0, 2, 0, 1, true),
      );

      const v0 = engine.readVReg(0); // R
      const v1 = engine.readVReg(1); // G
      const v2 = engine.readVReg(2); // B
      expect(Array.from(v0.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x10 + i));
      expect(Array.from(v1.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x20 + i));
      expect(Array.from(v2.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x30 + i));
    });
  });

  describe('LD4 — 4-register de-interleave (RGBA layout)', () => {
    it('LD4.16b de-interleaves RGBA quads', () => {
      // 16 RGBA pixels × 4 channels = 64 bytes
      const data = new Uint8Array(64);
      for (let lane = 0; lane < 16; lane++) {
        data[lane * 4] = 0x01 + lane; // R
        data[lane * 4 + 1] = 0x02 + lane; // G
        data[lane * 4 + 2] = 0x03 + lane; // B
        data[lane * 4 + 3] = 0x04 + lane; // A
      }

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeCode(DATA_BASE, data);
          e.writeGpr(2, BigInt(DATA_BASE));
        },
        encodeStructTransfer(4, 0, 2, 0, 1, true),
      );

      const v0 = engine.readVReg(0);
      const v1 = engine.readVReg(1);
      const v2 = engine.readVReg(2);
      const v3 = engine.readVReg(3);
      expect(Array.from(v0.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x01 + i));
      expect(Array.from(v1.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x02 + i));
      expect(Array.from(v2.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x03 + i));
      expect(Array.from(v3.slice(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => 0x04 + i));
    });
  });

  describe('ST2/ST3/ST4 — interleave stores (round-trip)', () => {
    it('ST2.16b interleaves V0/V1 back into memory', () => {
      // Pre-fill V0 and V1, then store interleaved.
      const v0 = new Uint8Array(16);
      const v1 = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        v0[i] = 0xa0 + i;
        v1[i] = 0xb0 + i;
      }

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeGpr(2, BigInt(DATA_BASE));
          e.writeVReg(0, v0);
          e.writeVReg(1, v1);
        },
        encodeStructTransfer(2, 0, 2, 0, 1, /*load*/ false),
      );

      const stored = engine.readMemory(DATA_BASE, 32);
      // Memory should be a0 b0 a1 b1 ...
      for (let i = 0; i < 16; i++) {
        expect(stored[i * 2]).toBe(0xa0 + i);
        expect(stored[i * 2 + 1]).toBe(0xb0 + i);
      }
    });

    it('ST3.16b interleaves RGB registers back into memory', () => {
      const v0 = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
      const v1 = Uint8Array.from({ length: 16 }, (_, i) => 0x20 + i);
      const v2 = Uint8Array.from({ length: 16 }, (_, i) => 0x30 + i);

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeGpr(2, BigInt(DATA_BASE));
          e.writeVReg(0, v0);
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeStructTransfer(3, 0, 2, 0, 1, false),
      );

      const stored = engine.readMemory(DATA_BASE, 48);
      for (let lane = 0; lane < 16; lane++) {
        expect(stored[lane * 3]).toBe(0x10 + lane);
        expect(stored[lane * 3 + 1]).toBe(0x20 + lane);
        expect(stored[lane * 3 + 2]).toBe(0x30 + lane);
      }
    });

    it('ST4.16b interleaves RGBA registers back into memory', () => {
      const v0 = Uint8Array.from({ length: 16 }, (_, i) => 0x01 + i);
      const v1 = Uint8Array.from({ length: 16 }, (_, i) => 0x02 + i);
      const v2 = Uint8Array.from({ length: 16 }, (_, i) => 0x03 + i);
      const v3 = Uint8Array.from({ length: 16 }, (_, i) => 0x04 + i);

      const engine = runWithData(
        (e) => {
          e.mapMemory(DATA_BASE, 64);
          e.writeGpr(2, BigInt(DATA_BASE));
          e.writeVReg(0, v0);
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
          e.writeVReg(3, v3);
        },
        encodeStructTransfer(4, 0, 2, 0, 1, false),
      );

      const stored = engine.readMemory(DATA_BASE, 64);
      for (let lane = 0; lane < 16; lane++) {
        expect(stored[lane * 4]).toBe(0x01 + lane);
        expect(stored[lane * 4 + 1]).toBe(0x02 + lane);
        expect(stored[lane * 4 + 2]).toBe(0x03 + lane);
        expect(stored[lane * 4 + 3]).toBe(0x04 + lane);
      }
    });

    it('LD2 → ST2 round-trip preserves data', () => {
      // Load interleaved, then store it back — memory should match the original.
      const original = new Uint8Array(32);
      for (let i = 0; i < 32; i++) original[i] = (i * 7 + 3) & 0xff;

      const engine = new CpuEngine();
      engine.mapMemory(DATA_BASE, 64);
      engine.writeCode(DATA_BASE, original);
      engine.writeGpr(2, BigInt(DATA_BASE));

      // Two instructions: LD2 {V0,V1}, [X2]; ST2 {V0,V1}, [X2]
      const code = [
        ...le(encodeStructTransfer(2, 0, 2, 0, 1, true)),
        ...le(encodeStructTransfer(2, 0, 2, 0, 1, false)),
      ];
      engine.mapMemory(CODE_BASE, 16);
      engine.writeCode(CODE_BASE, Uint8Array.from(code));
      engine.start(CODE_BASE, CODE_BASE + 8);

      const storedBack = engine.readMemory(DATA_BASE, 32);
      expect(Array.from(storedBack)).toEqual(Array.from(original));
    });
  });
});
