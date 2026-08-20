/**
 * Unit tests for RegisterFile — AArch64 register file management.
 *
 * Tests GPR access with XZR semantics, SP/PC handling, NZCV flags,
 * named register lookup, and SIMD/FP vector registers.
 */

import { describe, test, expect } from 'vitest';
import { RegisterFile } from '@modules/native-emulator/cpu/RegisterFile.js';

describe('RegisterFile', () => {
  describe('GPR access with XZR semantics', () => {
    test('reads from x0-x30 return stored values', () => {
      const rf = new RegisterFile();
      rf.writeGpr(0, 0x1234n);
      rf.writeGpr(15, 0xdeadbeefn);
      rf.writeGpr(30, 0xffffffffffffffffn);

      expect(rf.readGpr(0)).toBe(0x1234n);
      expect(rf.readGpr(15)).toBe(0xdeadbeefn);
      expect(rf.readGpr(30)).toBe(0xffffffffffffffffn);
    });

    test('reads from XZR (index 31) always return 0', () => {
      const rf = new RegisterFile();
      expect(rf.readGpr(31)).toBe(0n);
    });

    test('writes to XZR (index 31) are discarded', () => {
      const rf = new RegisterFile();
      rf.writeGpr(31, 0xdeadbeefn);
      expect(rf.readGpr(31)).toBe(0n);
    });

    test('writeGpr masks to 64-bit unsigned', () => {
      const rf = new RegisterFile();
      rf.writeGpr(5, (1n << 65n) | 0xabcdn);
      expect(rf.readGpr(5)).toBe(0xabcdn);
    });

    test('readGpr returns 0n for uninitialized registers', () => {
      const rf = new RegisterFile();
      expect(rf.readGpr(10)).toBe(0n);
    });
  });

  describe('GPR access with SP semantics', () => {
    test('readGprSp returns SP when index is 31', () => {
      const rf = new RegisterFile();
      rf.sp = 0x7fff_0000n;
      expect(rf.readGprSp(31)).toBe(0x7fff_0000n);
    });

    test('readGprSp returns GPR for index 0-30', () => {
      const rf = new RegisterFile();
      rf.writeGpr(10, 0x1234n);
      expect(rf.readGprSp(10)).toBe(0x1234n);
    });

    test('writeGprSp writes to SP when index is 31', () => {
      const rf = new RegisterFile();
      rf.writeGprSp(31, 0x8000_0000n);
      expect(rf.sp).toBe(0x8000_0000n);
    });

    test('writeGprSp writes to GPR for index 0-30', () => {
      const rf = new RegisterFile();
      rf.writeGprSp(5, 0xabcdn);
      expect(rf.readGpr(5)).toBe(0xabcdn);
    });

    test('writeGprSp masks SP to 64-bit unsigned', () => {
      const rf = new RegisterFile();
      rf.writeGprSp(31, (1n << 65n) | 0xffffn);
      expect(rf.sp).toBe(0xffffn);
    });
  });

  describe('SP and PC access', () => {
    test('SP getter and setter work correctly', () => {
      const rf = new RegisterFile();
      rf.sp = 0x7fffffff_ffffffffn;
      expect(rf.sp).toBe(0x7fffffff_ffffffffn);
    });

    test('SP setter masks to 64-bit unsigned', () => {
      const rf = new RegisterFile();
      rf.sp = (1n << 70n) | 0x12345678n;
      expect(rf.sp).toBe(0x12345678n);
    });

    test('PC getter and setter work correctly', () => {
      const rf = new RegisterFile();
      rf.pc = 0x1000;
      expect(rf.pc).toBe(0x1000);
    });

    test('PC stores as JS number (< 2^53)', () => {
      const rf = new RegisterFile();
      rf.pc = 0x12345678;
      expect(typeof rf.pc).toBe('number');
      expect(rf.pc).toBe(0x12345678);
    });
  });

  describe('NZCV flag access', () => {
    test('setFlags updates all four flags', () => {
      const rf = new RegisterFile();
      rf.setFlags(true, false, true, false);
      const flags = rf.getFlags();
      expect(flags.n).toBe(true);
      expect(flags.z).toBe(false);
      expect(flags.c).toBe(true);
      expect(flags.v).toBe(false);
    });

    test('getFlags returns current flag state', () => {
      const rf = new RegisterFile();
      rf.setFlags(false, true, false, true);
      const flags = rf.getFlags();
      expect(flags).toEqual({ n: false, z: true, c: false, v: true });
    });

    test('individual flag getters work correctly', () => {
      const rf = new RegisterFile();
      rf.setFlags(true, true, false, false);
      expect(rf.n).toBe(true);
      expect(rf.z).toBe(true);
      expect(rf.c).toBe(false);
      expect(rf.v).toBe(false);
    });

    test('individual flag setters work correctly', () => {
      const rf = new RegisterFile();
      rf.n = true;
      rf.z = false;
      rf.c = true;
      rf.v = false;
      expect(rf.getFlags()).toEqual({ n: true, z: false, c: true, v: false });
    });

    test('flags default to false', () => {
      const rf = new RegisterFile();
      expect(rf.n).toBe(false);
      expect(rf.z).toBe(false);
      expect(rf.c).toBe(false);
      expect(rf.v).toBe(false);
    });
  });

  describe('Named register access', () => {
    test('writeNamed and readNamed work for x0-x30', () => {
      const rf = new RegisterFile();
      rf.writeNamed('x5', 0x1234n);
      rf.writeNamed('X15', 0xabcdn); // case-insensitive
      expect(rf.readNamed('x5')).toBe(0x1234n);
      expect(rf.readNamed('X15')).toBe(0xabcdn);
    });

    test('writeNamed and readNamed work for sp', () => {
      const rf = new RegisterFile();
      rf.writeNamed('sp', 0x7fff_0000n);
      expect(rf.readNamed('sp')).toBe(0x7fff_0000n);
      expect(rf.readNamed('SP')).toBe(0x7fff_0000n);
    });

    test('writeNamed and readNamed work for pc', () => {
      const rf = new RegisterFile();
      rf.writeNamed('pc', 0x1000n);
      expect(rf.readNamed('pc')).toBe(0x1000n);
      expect(rf.readNamed('PC')).toBe(0x1000n);
    });

    test('writeNamed for xzr is ignored', () => {
      const rf = new RegisterFile();
      rf.writeNamed('xzr', 0xdeadbeefn);
      expect(rf.readNamed('xzr')).toBe(0n);
      expect(rf.readNamed('XZR')).toBe(0n);
    });

    test('readNamed for xzr always returns 0', () => {
      const rf = new RegisterFile();
      expect(rf.readNamed('xzr')).toBe(0n);
    });

    test('writeNamed throws on invalid register name', () => {
      const rf = new RegisterFile();
      expect(() => rf.writeNamed('x31', 0n)).toThrow('Unknown register: "x31"');
      expect(() => rf.writeNamed('x99', 0n)).toThrow('Unknown register: "x99"');
      expect(() => rf.writeNamed('invalid', 0n)).toThrow('Unknown register: "invalid"');
    });

    test('readNamed throws on invalid register name', () => {
      const rf = new RegisterFile();
      expect(() => rf.readNamed('x31')).toThrow('Unknown register: "x31"');
      expect(() => rf.readNamed('foo')).toThrow('Unknown register: "foo"');
    });
  });

  describe('Vector register access', () => {
    test('writeVector and readVectorAlias work for full 128-bit (q/v)', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10,
      ]);
      rf.writeVector(5, bytes);
      const hexQ = rf.readVectorAlias('q5');
      expect(hexQ).toBe('0102030405060708090a0b0c0d0e0f10');
      const hexV = rf.readVectorAlias('v5');
      expect(hexV).toBe('0102030405060708090a0b0c0d0e0f10');
    });

    test('readVectorAlias returns correct width for d (64-bit)', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes.set([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88], 0);
      rf.writeVector(10, bytes);
      expect(rf.readVectorAlias('d10')).toBe('1122334455667788');
    });

    test('readVectorAlias returns correct width for s (32-bit)', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes.set([0xaa, 0xbb, 0xcc, 0xdd], 0);
      rf.writeVector(3, bytes);
      expect(rf.readVectorAlias('s3')).toBe('aabbccdd');
    });

    test('readVectorAlias returns correct width for h (16-bit)', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes.set([0x12, 0x34], 0);
      rf.writeVector(7, bytes);
      expect(rf.readVectorAlias('h7')).toBe('1234');
    });

    test('readVectorAlias returns correct width for b (8-bit)', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes[0] = 0xab;
      rf.writeVector(1, bytes);
      expect(rf.readVectorAlias('b1')).toBe('ab');
    });

    test('readVectorAlias throws on invalid register name', () => {
      const rf = new RegisterFile();
      expect(() => rf.readVectorAlias('invalid')).toThrow(
        'Unknown vector register: "invalid" (expected vN/qN/dN/sN/hN/bN)',
      );
    });

    test('readVectorAlias throws on out-of-range index', () => {
      const rf = new RegisterFile();
      expect(() => rf.readVectorAlias('v32')).toThrow('Vector register index out of range: "v32"');
      expect(() => rf.readVectorAlias('q99')).toThrow('Vector register index out of range: "q99"');
    });

    test('writeVector throws on out-of-range index', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      expect(() => rf.writeVector(-1, bytes)).toThrow('Vector register index out of range: -1');
      expect(() => rf.writeVector(32, bytes)).toThrow('Vector register index out of range: 32');
    });

    test('getVectorView returns DataView for SIMD operations', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes.set([0x01, 0x02, 0x03, 0x04], 0);
      rf.writeVector(0, bytes);
      const view = rf.getVectorView(0);
      expect(view).toBeInstanceOf(DataView);
      expect(view.getUint32(0, true)).toBe(0x04030201); // little-endian
    });

    test('getVectorView throws on out-of-range index', () => {
      const rf = new RegisterFile();
      expect(() => rf.getVectorView(-1)).toThrow('Vector register index out of range: -1');
      expect(() => rf.getVectorView(32)).toThrow('Vector register index out of range: 32');
    });

    test('getVectorBytes returns Uint8Array for direct access', () => {
      const rf = new RegisterFile();
      const bytes = new Uint8Array(16);
      bytes.fill(0xff);
      rf.writeVector(31, bytes);
      const result = rf.getVectorBytes(31);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(16);
      expect(result[0]).toBe(0xff);
    });

    test('getVectorBytes throws on out-of-range index', () => {
      const rf = new RegisterFile();
      expect(() => rf.getVectorBytes(-1)).toThrow('Vector register index out of range: -1');
      expect(() => rf.getVectorBytes(32)).toThrow('Vector register index out of range: 32');
    });
  });

  describe('Edge cases and boundary tests', () => {
    test('all GPRs default to 0', () => {
      const rf = new RegisterFile();
      for (let i = 0; i < 31; i++) {
        expect(rf.readGpr(i)).toBe(0n);
      }
    });

    test('all vector registers default to zero bytes', () => {
      const rf = new RegisterFile();
      for (let i = 0; i < 32; i++) {
        const hex = rf.readVectorAlias(`v${i}`);
        expect(hex).toBe('00'.repeat(16));
      }
    });

    test('SP defaults to 0', () => {
      const rf = new RegisterFile();
      expect(rf.sp).toBe(0n);
    });

    test('PC defaults to 0', () => {
      const rf = new RegisterFile();
      expect(rf.pc).toBe(0);
    });

    test('max 64-bit value is stored correctly', () => {
      const rf = new RegisterFile();
      rf.writeGpr(0, 0xffffffffffffffffn);
      expect(rf.readGpr(0)).toBe(0xffffffffffffffffn);
    });

    test('vector registers are independent', () => {
      const rf = new RegisterFile();
      rf.writeVector(0, new Uint8Array([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]));
      rf.writeVector(1, new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11]));
      expect(rf.readVectorAlias('d0')).toBe('1122334455667788');
      expect(rf.readVectorAlias('d1')).toBe('aabbccddeeff0011');
    });
  });
});
