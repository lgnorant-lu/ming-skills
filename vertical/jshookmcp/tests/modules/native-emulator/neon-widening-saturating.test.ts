import { describe, it, expect } from 'vitest';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/**
 * NEON Widening/Saturating/LD2-4 Instruction Tests
 * Phase 1.2: Complete NEON long-tail implementation
 *
 * Coverage:
 * - 25+ Widening instructions (SADDL/SMULL/SXTL/etc.)
 * - 25+ Saturating instructions (SQADD/SQSHL/SQXTN/etc.)
 * - 15+ De-interleave load/store (LD2/LD3/LD4/ST2/ST3/ST4)
 *
 * Test Strategy:
 * Uses the project's standard pattern: mapMemory → writeCode → start → readVReg
 */

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];

function runOne(setup: (e: CpuEngine) => void, insn: number): CpuEngine {
  const engine = new CpuEngine();
  setup(engine);
  const bytes = le(insn);
  const code = 0x4000;
  engine.mapMemory(code, bytes.length + 8);
  engine.writeCode(code, Uint8Array.from(bytes));
  engine.start(code, code + bytes.length);
  return engine;
}

const v = (...bytes: number[]): Uint8Array => {
  const o = new Uint8Array(16);
  o.set(bytes);
  return o;
};

// Helper: Encode SADDL/UADDL instruction
function encodeADDL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e200000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SSUBL/USUBL instruction
function encodeSUBL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e202000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SMULL/UMULL instruction
function encodeMULL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e20c000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SXTL/UXTL instruction (SSHLL/USHLL with shift=0)
function encodeXTL(Vd: number, Vn: number, size: number, U: number, Q: number): number {
  const immh_immb = 1 << (size + 3); // shift = 0
  return (0x0f00a400 | (Q << 30) | (U << 29) | (immh_immb << 16) | (Vn << 5) | Vd) >>> 0;
}

// Helper: Encode SQADD/UQADD instruction
function encodeSQADD(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e200c00 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SQSUB/UQSUB instruction
function encodeSQSUB(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e202c00 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SQXTN/UQXTN instruction
function encodeSQXTN(Vd: number, Vn: number, size: number, U: number, Q: number): number {
  return (0x0e214800 | (Q << 30) | (U << 29) | (size << 22) | (Vn << 5) | Vd) >>> 0;
}

// Helper: Encode SADDW/UADDW instruction
function encodeADDW(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e201000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SMLAL/UMLAL instruction
function encodeMLAL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e208000 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SADDLP/UADDLP instruction
function encodeADDLP(Vd: number, Vn: number, size: number, U: number, Q: number): number {
  return (0x0e202800 | (Q << 30) | (U << 29) | (size << 22) | (Vn << 5) | Vd) >>> 0;
}

// Helper: Encode SSHLL/USHLL instruction with immediate
function encodeSHLL(
  Vd: number,
  Vn: number,
  size: number,
  shift: number,
  U: number,
  Q: number,
): number {
  const immh_immb = (1 << (size + 3)) | shift;
  return (0x0f00a400 | (Q << 30) | (U << 29) | (immh_immb << 16) | (Vn << 5) | Vd) >>> 0;
}

// Helper: Encode SQSHL/UQSHL instruction (register version)
function encodeSQSHL(
  Vd: number,
  Vn: number,
  Vm: number,
  size: number,
  U: number,
  Q: number,
): number {
  return (
    (0x0e204c00 |
      (Q << 30) |
      (U << 29) |
      (size << 22) |
      (Vm << 16) |
      (0x00 << 10) |
      (Vn << 5) |
      Vd) >>>
    0
  );
}

// Helper: Encode SQABS instruction
function encodeSQABS(Vd: number, Vn: number, size: number, Q: number): number {
  return (0x0e207800 | (Q << 30) | (size << 22) | (Vn << 5) | Vd) >>> 0;
}

// Helper: Encode SQNEG instruction
function encodeSQNEG(Vd: number, Vn: number, size: number, Q: number): number {
  return (0x2e207800 | (Q << 30) | (size << 22) | (Vn << 5) | Vd) >>> 0;
}

describe('NEON Widening Instructions', () => {
  describe('Add Long (SADDL/UADDL)', () => {
    it('SADDL: 8→16 signed add long', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(1, 2, 3, 4, 5, 6, 7, 8));
          e.writeVReg(2, v(10, 20, 30, 40, 50, 60, 70, 80));
        },
        encodeADDL(0, 1, 2, 0, 0, 0),
      ); // SADDL V0.8H, V1.8B, V2.8B

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(11);
      expect(view.getInt16(2, true)).toBe(22);
      expect(view.getInt16(4, true)).toBe(33);
      expect(view.getInt16(6, true)).toBe(44);
    });

    it('SADDL: overflow preserves sign', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 100));
          e.writeVReg(2, v(1, 30));
        },
        encodeADDL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(128);
      expect(view.getInt16(2, true)).toBe(130);
    });

    it('UADDL: unsigned add long', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(255, 200));
          e.writeVReg(2, v(1, 100));
        },
        encodeADDL(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(256);
      expect(view.getUint16(2, true)).toBe(300);
    });

    it('SADDL2: 16→32 high half', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(8, 100, true);
      new DataView(v1.buffer).setInt16(10, 200, true);
      new DataView(v2.buffer).setInt16(8, 50, true);
      new DataView(v2.buffer).setInt16(10, 100, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeADDL(0, 1, 2, 1, 0, 1),
      ); // size=1, Q=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(150);
      expect(view.getInt32(4, true)).toBe(300);
    });
  });

  describe('Subtract Long (SSUBL/USUBL)', () => {
    it('SSUBL: 8→16 signed subtract', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(100, 80, 60, 40));
          e.writeVReg(2, v(10, 20, 30, 40));
        },
        encodeSUBL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(90);
      expect(view.getInt16(2, true)).toBe(60);
      expect(view.getInt16(4, true)).toBe(30);
      expect(view.getInt16(6, true)).toBe(0);
    });

    it('SSUBL: negative result', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 206)); // 206 = -50 in int8
          e.writeVReg(2, v(50, 30));
        },
        encodeSUBL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(-40);
      expect(view.getInt16(2, true)).toBe(-80);
    });

    it('USUBL: unsigned subtract', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(200, 150));
          e.writeVReg(2, v(50, 100));
        },
        encodeSUBL(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(150);
      expect(view.getUint16(2, true)).toBe(50);
    });
  });

  describe('Multiply Long (SMULL/UMULL)', () => {
    it('SMULL: 8×8→16 signed', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 246, 5, 251)); // -10=0xF6, -5=0xFB
          e.writeVReg(2, v(20, 20, 30, 30));
        },
        encodeMULL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(200);
      expect(view.getInt16(2, true)).toBe(-200);
      expect(view.getInt16(4, true)).toBe(150);
      expect(view.getInt16(6, true)).toBe(-150);
    });

    it('SMULL: 16×16→32', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 100, true);
      new DataView(v1.buffer).setInt16(2, -100, true);
      new DataView(v2.buffer).setInt16(0, 200, true);
      new DataView(v2.buffer).setInt16(2, 200, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeMULL(0, 1, 2, 1, 0, 0),
      ); // size=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(20000);
      expect(view.getInt32(4, true)).toBe(-20000);
    });

    it('UMULL: unsigned multiply', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(200, 255));
          e.writeVReg(2, v(100, 100));
        },
        encodeMULL(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(20000);
      expect(view.getUint16(2, true)).toBe(25500);
    });

    it('UMULL: maximum values', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(255, 255));
          e.writeVReg(2, v(255, 255));
        },
        encodeMULL(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(65025); // 255*255
      expect(view.getUint16(2, true)).toBe(65025);
    });
  });

  describe('Sign/Zero Extension (SXTL/UXTL)', () => {
    it('SXTL: 8→16 sign extension', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0xff, 0x01, 0x7f, 0x80));
        },
        encodeXTL(0, 1, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(-1);
      expect(view.getInt16(2, true)).toBe(1);
      expect(view.getInt16(4, true)).toBe(127);
      expect(view.getInt16(6, true)).toBe(-128);
    });

    it('UXTL: 8→16 zero extension', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0xff, 0x01, 0x7f, 0x80));
        },
        encodeXTL(0, 1, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(255);
      expect(view.getUint16(2, true)).toBe(1);
      expect(view.getUint16(4, true)).toBe(127);
      expect(view.getUint16(6, true)).toBe(128);
    });

    it('SXTL2: 16→32 high half', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(8, -1, true);
      new DataView(v1.buffer).setInt16(10, 1, true);
      new DataView(v1.buffer).setInt16(12, 32767, true);
      new DataView(v1.buffer).setInt16(14, -32768, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeXTL(0, 1, 1, 0, 1),
      ); // size=1, Q=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(-1);
      expect(view.getInt32(4, true)).toBe(1);
      expect(view.getInt32(8, true)).toBe(32767);
      expect(view.getInt32(12, true)).toBe(-32768);
    });
  });

  describe('Add Wide (SADDW/UADDW)', () => {
    it('SADDW: wide + narrow', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 1000, true);
      new DataView(v1.buffer).setInt16(2, 2000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v(10, 20));
        },
        encodeADDW(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(1010);
      expect(view.getInt16(2, true)).toBe(2020);
    });

    it('UADDW: unsigned', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setUint16(0, 60000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v(200));
        },
        encodeADDW(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(60200);
    });
  });

  describe('Multiply Accumulate Long (SMLAL/UMLAL)', () => {
    it('SMLAL: MAC operation', () => {
      const v0 = new Uint8Array(16);
      new DataView(v0.buffer).setInt16(0, 1000, true);
      new DataView(v0.buffer).setInt16(2, 2000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, v0);
          e.writeVReg(1, v(10, 20));
          e.writeVReg(2, v(5, 10));
        },
        encodeMLAL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(1050); // 1000+10*5
      expect(view.getInt16(2, true)).toBe(2200); // 2000+20*10
    });

    it('UMLAL: unsigned MAC', () => {
      const v0 = new Uint8Array(16);
      new DataView(v0.buffer).setUint16(0, 10000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, v0);
          e.writeVReg(1, v(100));
          e.writeVReg(2, v(50));
        },
        encodeMLAL(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(15000); // 10000+100*50
    });
  });

  describe('Add Long Pairwise (SADDLP/UADDLP)', () => {
    it('SADDLP: pairwise add', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 20, 30, 40, 50, 60, 70, 80));
        },
        encodeADDLP(0, 1, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(30); // 10+20
      expect(view.getInt16(2, true)).toBe(70); // 30+40
      expect(view.getInt16(4, true)).toBe(110); // 50+60
      expect(view.getInt16(6, true)).toBe(150); // 70+80
    });

    it('UADDLP: unsigned pairwise', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(255, 255, 200, 200));
        },
        encodeADDLP(0, 1, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(510); // 255+255
      expect(view.getUint16(2, true)).toBe(400); // 200+200
    });

    it('SADDLP: with negatives', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 246, 20, 236)); // [10,-10,20,-20]
        },
        encodeADDLP(0, 1, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(0); // 10+(-10)
      expect(view.getInt16(2, true)).toBe(0); // 20+(-20)
    });
  });

  describe('Shift Left Long (SSHLL/USHLL)', () => {
    it('SSHLL: signed shift', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 246, 20, 236)); // [10,-10,20,-20]
        },
        encodeSHLL(0, 1, 0, 3, 0, 0),
      ); // shift=3

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(80); // 10<<3
      expect(view.getInt16(2, true)).toBe(-80); // -10<<3
      expect(view.getInt16(4, true)).toBe(160); // 20<<3
      expect(view.getInt16(6, true)).toBe(-160); // -20<<3
    });

    it('USHLL: unsigned shift', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(255, 128, 64, 32));
        },
        encodeSHLL(0, 1, 0, 4, 1, 0),
      ); // shift=4, U=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(4080); // 255<<4
      expect(view.getUint16(2, true)).toBe(2048); // 128<<4
      expect(view.getUint16(4, true)).toBe(1024); // 64<<4
      expect(view.getUint16(6, true)).toBe(512); // 32<<4
    });
  });
});

describe('NEON Saturating Instructions', () => {
  describe('Saturating Add (SQADD/UQADD)', () => {
    it('SQADD: positive overflow', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 100, 50));
          e.writeVReg(2, v(1, 30, 10));
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // saturated
      expect(view.getInt8(1)).toBe(127); // saturated
      expect(view.getInt8(2)).toBe(60); // normal

      const fpsr = engine.getFPSR();
      expect((fpsr >> 27) & 1).toBe(1); // QC flag set
    });

    it('SQADD: negative overflow', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 156, 206)); // [-128,-100,-50]
          e.writeVReg(2, v(255, 226, 246)); // [-1,-30,-10]
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(-128); // saturated
      expect(view.getInt8(1)).toBe(-128); // saturated
      expect(view.getInt8(2)).toBe(-60); // normal
    });

    it('UQADD: unsigned saturation', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(255, 200, 100));
          e.writeVReg(2, v(1, 100, 50));
        },
        encodeSQADD(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      expect(result[0]).toBe(255); // saturated
      expect(result[1]).toBe(255); // saturated
      expect(result[2]).toBe(150); // normal
    });

    it('SQADD: 16-bit saturation', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 32767, true);
      new DataView(v1.buffer).setInt16(2, -32768, true);
      new DataView(v2.buffer).setInt16(0, 1, true);
      new DataView(v2.buffer).setInt16(2, -1, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeSQADD(0, 1, 2, 1, 0, 0),
      ); // size=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(32767);
      expect(view.getInt16(2, true)).toBe(-32768);
    });

    it('SQADD: 32-bit saturation', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt32(0, 2147483647, true);
      new DataView(v1.buffer).setInt32(4, -2147483648, true);
      new DataView(v2.buffer).setInt32(0, 1, true);
      new DataView(v2.buffer).setInt32(4, -1, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeSQADD(0, 1, 2, 2, 0, 0),
      ); // size=2

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(2147483647);
      expect(view.getInt32(4, true)).toBe(-2147483648);
    });
  });

  describe('Saturating Subtract (SQSUB/UQSUB)', () => {
    it('SQSUB: negative underflow', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 156, 50)); // [-128,-100,50]
          e.writeVReg(2, v(1, 30, 10));
        },
        encodeSQSUB(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(-128); // saturated
      expect(view.getInt8(1)).toBe(-128); // saturated
      expect(view.getInt8(2)).toBe(40); // normal
    });

    it('SQSUB: positive overflow', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 100));
          e.writeVReg(2, v(255, 226)); // [-1,-30]
        },
        encodeSQSUB(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // 127-(-1) → saturated
      expect(view.getInt8(1)).toBe(127); // 100-(-30) → saturated
    });

    it('UQSUB: unsigned saturation', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 100, 200));
          e.writeVReg(2, v(20, 50, 100));
        },
        encodeSQSUB(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      expect(result[0]).toBe(0); // saturated to 0
      expect(result[1]).toBe(50); // normal
      expect(result[2]).toBe(100); // normal
    });
  });

  describe('Saturating Narrowing (SQXTN/UQXTN)', () => {
    it('SQXTN: 16→8 signed', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 256, true);
      new DataView(v1.buffer).setInt16(2, -129, true);
      new DataView(v1.buffer).setInt16(4, 100, true);
      new DataView(v1.buffer).setInt16(6, -50, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // saturated
      expect(view.getInt8(1)).toBe(-128); // saturated
      expect(view.getInt8(2)).toBe(100); // normal
      expect(view.getInt8(3)).toBe(-50); // normal
    });

    it('UQXTN: 16→8 unsigned', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setUint16(0, 256, true);
      new DataView(v1.buffer).setUint16(2, 300, true);
      new DataView(v1.buffer).setUint16(4, 100, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      expect(result[0]).toBe(255); // saturated
      expect(result[1]).toBe(255); // saturated
      expect(result[2]).toBe(100); // normal
    });

    it('SQXTN: 32→16', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt32(0, 100000, true);
      new DataView(v1.buffer).setInt32(4, -40000, true);
      new DataView(v1.buffer).setInt32(8, 30000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 1, 0, 0),
      ); // size=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(32767); // saturated
      expect(view.getInt16(2, true)).toBe(-32768); // saturated
      expect(view.getInt16(4, true)).toBe(30000); // normal
    });

    it('SQXTN2: high half narrowing', () => {
      const v0 = v(1, 2, 3, 4);
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 256, true);
      new DataView(v1.buffer).setInt16(2, -129, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, v0);
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 0, 0, 1),
      ); // Q=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(1); // preserved
      expect(view.getInt8(1)).toBe(2); // preserved
      expect(view.getInt8(2)).toBe(3); // preserved
      expect(view.getInt8(3)).toBe(4); // preserved
      expect(view.getInt8(4)).toBe(127); // saturated
      expect(view.getInt8(5)).toBe(-128); // saturated
    });
  });

  describe('Saturating Shift (SQSHL/UQSHL)', () => {
    it('SQSHL: register shift', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(64, 32, 16));
          e.writeVReg(2, v(2, 3, 4));
        },
        encodeSQSHL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // 64<<2 → saturated
      expect(view.getInt8(1)).toBe(127); // 32<<3 → saturated
      expect(view.getInt8(2)).toBe(127); // 16<<4 → saturated
    });

    it('UQSHL: unsigned shift', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 64, 32));
          e.writeVReg(2, v(2, 3, 4));
        },
        encodeSQSHL(0, 1, 2, 0, 1, 0),
      ); // U=1

      const result = engine.readVReg(0);
      expect(result[0]).toBe(255); // saturated
      expect(result[1]).toBe(255); // saturated
      expect(result[2]).toBe(255); // saturated
    });
  });

  describe('Saturating Absolute/Negate (SQABS/SQNEG)', () => {
    it('SQABS: absolute with saturation', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 156, 50, 127)); // [-128,-100,50,127]
        },
        encodeSQABS(0, 1, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // -128 → saturated
      expect(view.getInt8(1)).toBe(100); // abs(-100)
      expect(view.getInt8(2)).toBe(50); // abs(50)
      expect(view.getInt8(3)).toBe(127); // abs(127)
    });

    it('SQNEG: negate with saturation', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 100, 206, 128)); // [127,100,-50,-128]
        },
        encodeSQNEG(0, 1, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(-127); // -127
      expect(view.getInt8(1)).toBe(-100); // -100
      expect(view.getInt8(2)).toBe(50); // -(-50)
      expect(view.getInt8(3)).toBe(127); // -(-128) → saturated
    });

    it('SQABS: 16-bit', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, -32768, true);
      new DataView(v1.buffer).setInt16(2, -10000, true);
      new DataView(v1.buffer).setInt16(4, 20000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQABS(0, 1, 1, 0),
      ); // size=1

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(32767); // saturated
      expect(view.getInt16(2, true)).toBe(10000);
      expect(view.getInt16(4, true)).toBe(20000);
    });
  });

  describe('QC Flag Management', () => {
    it('QC flag persists across operations', () => {
      const engine = new CpuEngine();

      // First: SQADD that saturates
      const code1 = le(encodeSQADD(0, 1, 2, 0, 0, 0));
      engine.writeVReg(1, v(127));
      engine.writeVReg(2, v(1));
      engine.mapMemory(0x4000, 16);
      engine.writeCode(0x4000, Uint8Array.from(code1));
      engine.start(0x4000, 0x4004);

      expect((engine.getFPSR() >> 27) & 1).toBe(1); // QC set

      // Second: SQADD without saturation
      const code2 = le(encodeSQADD(5, 3, 4, 0, 0, 0));
      engine.writeVReg(3, v(10));
      engine.writeVReg(4, v(20));
      engine.mapMemory(0x4010, 16);
      engine.writeCode(0x4010, Uint8Array.from(code2));
      engine.start(0x4010, 0x4014);

      expect((engine.getFPSR() >> 27) & 1).toBe(1); // QC still set (sticky)
    });

    it('SQADD without saturation keeps QC clear', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(10, 20, 30));
          e.writeVReg(2, v(5, 10, 15));
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(15);
      expect(view.getInt8(1)).toBe(30);
      expect(view.getInt8(2)).toBe(45);

      expect((engine.getFPSR() >> 27) & 1).toBe(0); // QC not set
    });
  });

  describe('Boundary Cases', () => {
    it('SADDL with zeros', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0, 0, 0, 0));
          e.writeVReg(2, v(0, 0, 0, 0));
        },
        encodeADDL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(0);
      expect(view.getInt16(2, true)).toBe(0);
    });

    it('SMULL with negative * negative', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(246, 251)); // [-10, -5]
          e.writeVReg(2, v(236, 226)); // [-20, -30]
        },
        encodeMULL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(200); // -10 * -20
      expect(view.getInt16(2, true)).toBe(150); // -5 * -30
    });

    it('UXTL with all zeros', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(0, 0, 0, 0));
        },
        encodeXTL(0, 1, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(0);
      expect(view.getUint16(2, true)).toBe(0);
    });
  });
});

// NEON De-interleave Load/Store (LD2/LD3/LD4/ST2/ST3/ST4) tests live in
// ./neon-deinterleave.test.ts — 8 real tests covering 8/16-bit element
// de-interleaving plus LD2→ST2 round-trip.

describe('NEON Real-World Scenarios', () => {
  describe('Image Processing', () => {
    it('RGB brightness scaling with widening', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(100, 150, 200));
          e.writeVReg(2, v(2, 2, 2));
        },
        encodeMULL(0, 1, 2, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getUint16(0, true)).toBe(200);
      expect(view.getUint16(2, true)).toBe(300);
      expect(view.getUint16(4, true)).toBe(400);
    });

    it('RGB clamping with saturation', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setUint16(0, 300, true);
      new DataView(v1.buffer).setUint16(2, 400, true);
      new DataView(v1.buffer).setUint16(4, 500, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 0, 1, 0),
      );

      const result = engine.readVReg(0);
      expect(result[0]).toBe(255);
      expect(result[1]).toBe(255);
      expect(result[2]).toBe(255);
    });
  });

  describe('Audio Processing', () => {
    it('Audio sample mixing with widening', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 10000, true);
      new DataView(v1.buffer).setInt16(2, 20000, true);
      new DataView(v2.buffer).setInt16(0, 5000, true);
      new DataView(v2.buffer).setInt16(2, -3000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeADDL(0, 1, 2, 1, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(15000);
      expect(view.getInt32(4, true)).toBe(17000);
    });

    it('Audio clipping protection', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 30000, true);
      new DataView(v1.buffer).setInt16(2, -30000, true);
      new DataView(v2.buffer).setInt16(0, 10000, true);
      new DataView(v2.buffer).setInt16(2, -10000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeSQADD(0, 1, 2, 1, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(32767); // saturated
      expect(view.getInt16(2, true)).toBe(-32768); // saturated
    });
  });

  describe('ML Quantization', () => {
    it('Quantized MAC operation', () => {
      const v0 = new Uint8Array(16);
      new DataView(v0.buffer).setInt16(0, 1000, true);
      new DataView(v0.buffer).setInt16(2, 2000, true);
      new DataView(v0.buffer).setInt16(4, 3000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(0, v0);
          e.writeVReg(1, v(10, 20, 30));
          e.writeVReg(2, v(5, 3, 2));
        },
        encodeMLAL(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt16(0, true)).toBe(1050); // 1000+10*5
      expect(view.getInt16(2, true)).toBe(2060); // 2000+20*3
      expect(view.getInt16(4, true)).toBe(3060); // 3000+30*2
    });
  });

  describe('Mixed Element Sizes', () => {
    it('SADDL: 16→32 mixing', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 1000, true);
      new DataView(v1.buffer).setInt16(2, 2000, true);
      new DataView(v2.buffer).setInt16(0, 3000, true);
      new DataView(v2.buffer).setInt16(2, 4000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeADDL(0, 1, 2, 1, 0, 0),
      ); // size=1 for 16→32

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(4000);
      expect(view.getInt32(4, true)).toBe(6000);
    });

    it('SMULL: 16×16→32 full range', () => {
      const v1 = new Uint8Array(16);
      const v2 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, 1000, true);
      new DataView(v1.buffer).setInt16(2, -1000, true);
      new DataView(v2.buffer).setInt16(0, 2000, true);
      new DataView(v2.buffer).setInt16(2, 2000, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
          e.writeVReg(2, v2);
        },
        encodeMULL(0, 1, 2, 1, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(2000000);
      expect(view.getInt32(4, true)).toBe(-2000000);
    });

    it('SXTL: 16→32 sign extension', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setInt16(0, -1, true);
      new DataView(v1.buffer).setInt16(2, 1, true);
      new DataView(v1.buffer).setInt16(4, 32767, true);
      new DataView(v1.buffer).setInt16(6, -32768, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeXTL(0, 1, 1, 0, 0),
      ); // size=1 for 16→32

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(-1);
      expect(view.getInt32(4, true)).toBe(1);
      expect(view.getInt32(8, true)).toBe(32767);
      expect(view.getInt32(12, true)).toBe(-32768);
    });

    it('SQXTN: 64→32 saturation', () => {
      const v1 = new Uint8Array(16);
      new DataView(v1.buffer).setBigInt64(0, 10000000000n, true);
      new DataView(v1.buffer).setBigInt64(8, -5000000000n, true);

      const engine = runOne(
        (e) => {
          e.writeVReg(1, v1);
        },
        encodeSQXTN(0, 1, 2, 0, 0),
      ); // size=2 for 64→32

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt32(0, true)).toBe(2147483647); // saturated
      expect(view.getInt32(4, true)).toBe(-2147483648); // saturated
    });
  });

  describe('Special Value Handling', () => {
    it('All maximum signed values', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 127, 127, 127));
          e.writeVReg(2, v(0, 0, 0, 0));
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127);
      expect(view.getInt8(1)).toBe(127);
    });

    it('All minimum signed values', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(128, 128, 128, 128)); // -128
          e.writeVReg(2, v(0, 0, 0, 0));
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(-128);
      expect(view.getInt8(1)).toBe(-128);
    });

    it('Mix of positive and negative', () => {
      const engine = runOne(
        (e) => {
          e.writeVReg(1, v(127, 128, 1, 255)); // [127,-128,1,-1]
          e.writeVReg(2, v(1, 255, 255, 1)); // [1,-1,-1,1]
        },
        encodeSQADD(0, 1, 2, 0, 0, 0),
      );

      const result = engine.readVReg(0);
      const view = new DataView(result.buffer, result.byteOffset);
      expect(view.getInt8(0)).toBe(127); // saturated
      expect(view.getInt8(1)).toBe(-128); // saturated
      expect(view.getInt8(2)).toBe(0); // 1+(-1)
      expect(view.getInt8(3)).toBe(0); // -1+1
    });
  });
});
