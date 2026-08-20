/**
 * L3 TDD — LDR/STR memory-access instructions.
 *
 * Loads and stores are the hard prerequisite for the entire L3 layer: stack
 * frames (spilling LR/FP across nested calls), syscall argument blocks, and JNI
 * marshalling all move data through guest memory. We implement the three
 * AArch64 addressing modes — unsigned offset, pre-index, post-index — for the
 * 32- and 64-bit general-register forms.
 *
 * Encodings (verified against an assembler):
 *   str x30,[sp,#-16]!  = 0xF81F0FFE  (pre-index, imm9=-16, idx bits=0b11)
 *   ldr x30,[sp],#16    = 0xF84107FE  (post-index, imm9=+16, idx bits=0b01)
 *   str x0,[sp,#8]      = 0xF90007E0  (unsigned offset, imm12=1 → ×8 = 8)
 *   ldr x0,[sp,#8]      = 0xF94007E0
 *
 * Field layout (size@31:30, V@26, bits 25:24 select offset-vs-index,
 * opc@23:22 with bit22 = L: 0=store 1=load, imm9@20:12, idx@11:10, Rn@9:5,
 * Rt@4:0). Rn uses SP semantics (encoding 31 = SP, not XZR).
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/** Little-endian split of a 32-bit instruction word into 4 code bytes. */
function le32(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

describe('CpuEngine LDR/STR — L3 memory access', () => {
  it('STR (unsigned offset) writes a 64-bit register to [base + imm*8]', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 64);
    engine.writeRegister('x1', BASE);
    engine.writeRegister('x0', 0xdeadbeef);
    // str x0, [x1, #8]  = 0xF9000420
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xf9000420)));
    engine.start(0x1000, 0x1004);
    expect(Array.from(engine.readMemory(BASE + 8, 4))).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });

  it('LDR (unsigned offset) reads a 64-bit value from [base + imm*8]', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 64);
    // store 0x00000000_55667788 at BASE+8 (value < 2^53 so readRegister is exact)
    engine.writeCode(BASE + 8, Uint8Array.from([0x88, 0x77, 0x66, 0x55, 0x00, 0x00, 0x00, 0x00]));
    engine.writeRegister('x1', BASE);
    // ldr x0, [x1, #8]  = 0xF9400420
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xf9400420)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('x0')).toBe(0x55667788);
  });

  it('STR (32-bit, Wt) stores only the low 4 bytes', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 16);
    engine.writeRegister('x1', BASE);
    engine.writeRegister('x0', 0xaabbccdd);
    // str w0, [x1]  = 0xB9000020
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xb9000020)));
    engine.start(0x1000, 0x1004);
    expect(Array.from(engine.readMemory(BASE, 4))).toEqual([0xdd, 0xcc, 0xbb, 0xaa]);
  });

  it('STR pre-index writes back the updated base (str x0,[sp,#-16]!)', () => {
    const engine = new CpuEngine();
    const STACK = 0x9000;
    engine.mapMemory(STACK - 64, 128);
    engine.writeRegister('sp', STACK);
    engine.writeRegister('x0', 0x42);
    // str x0, [sp, #-16]!  = 0xF81F0FE0
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xf81f0fe0)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('sp')).toBe(STACK - 16); // base written back
    expect(Array.from(engine.readMemory(STACK - 16, 1))).toEqual([0x42]); // stored at new sp
  });

  it('LDR post-index reads from base then advances it (ldr x0,[sp],#16)', () => {
    const engine = new CpuEngine();
    const STACK = 0x9000;
    engine.mapMemory(STACK - 64, 128);
    engine.writeRegister('sp', STACK);
    engine.writeCode(STACK, Uint8Array.from([0x99, 0, 0, 0, 0, 0, 0, 0]));
    // ldr x0, [sp], #16  = 0xF84107E0
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xf84107e0)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('x0')).toBe(0x99); // read from old sp
    expect(engine.readRegister('sp')).toBe(STACK + 16); // base advanced after
  });

  // ── Unscaled (STUR/LDUR, idx bits = 0b00) ──
  // Regression: the unscaled form must compute address = base + imm9 (no
  // writeback). A prior bug treated idx=0b00 like post-index (address = base,
  // ignoring imm9), so every STUR/LDUR with a non-zero offset silently hit the
  // wrong address — which broke real `.so` (e.g. SQLCipher's inlined mutex-table
  // copy, a CSEL+STUR sequence, lost all its stores and NULL'd a function ptr).

  it('STUR (unscaled, +imm9) writes to base + imm9 without writeback', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 256);
    engine.writeRegister('x1', BASE);
    engine.writeRegister('x0', 0xcafe);
    // stur x0, [x1, #156]  (imm9=156=0x9c) = 0xF8000000 | (156<<12) | (1<<5) | 0
    const stur = (0xf8000000 | (156 << 12) | (1 << 5) | 0) >>> 0;
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(stur)));
    engine.start(0x1000, 0x1004);
    expect(Array.from(engine.readMemory(BASE + 156, 2))).toEqual([0xfe, 0xca]);
    expect(engine.readRegister('x1')).toBe(BASE); // base NOT written back
  });

  it('LDUR (unscaled, +imm9) reads from base + imm9 without writeback', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 256);
    engine.writeCode(BASE + 148, Uint8Array.from([0x44, 0x33, 0x22, 0x11, 0, 0, 0, 0]));
    engine.writeRegister('x1', BASE);
    // ldur x0, [x1, #148]  (imm9=148=0x94) = 0xF8400000 | (148<<12) | (1<<5) | 0
    const ldur = (0xf8400000 | (148 << 12) | (1 << 5) | 0) >>> 0;
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(ldur)));
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('x0')).toBe(0x11223344);
    expect(engine.readRegister('x1')).toBe(BASE); // base NOT written back
  });

  it('STUR xzr clears 8 bytes at base + imm9 (the mutex-copy zeroing pattern)', () => {
    const engine = new CpuEngine();
    const BASE = 0x7000;
    engine.mapMemory(BASE, 64);
    // pre-fill with 0xFF so a working STUR xzr is observable as a clear-to-zero
    engine.writeCode(BASE + 24, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
    engine.writeRegister('x2', BASE);
    // stur xzr, [x2, #24] = 0xF8000000 | (24<<12) | (2<<5) | 31
    const stur = (0xf8000000 | (24 << 12) | (2 << 5) | 31) >>> 0;
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(stur)));
    engine.start(0x1000, 0x1004);
    expect(Array.from(engine.readMemory(BASE + 24, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('STUR (unscaled, -imm9) writes to base - offset', () => {
    const engine = new CpuEngine();
    const BASE = 0x7080;
    engine.mapMemory(0x7000, 256);
    engine.writeRegister('x1', BASE);
    engine.writeRegister('x0', 0x1234);
    // stur x0, [x1, #-16]  (imm9 = -16 = 0x1f0 in 9-bit) = 0xF8000000 | (0x1f0<<12) | (1<<5)
    const stur = (0xf8000000 | (0x1f0 << 12) | (1 << 5) | 0) >>> 0;
    engine.mapMemory(0x1000, 8);
    engine.writeCode(0x1000, Uint8Array.from(le32(stur)));
    engine.start(0x1000, 0x1004);
    expect(Array.from(engine.readMemory(BASE - 16, 2))).toEqual([0x34, 0x12]);
    expect(engine.readRegister('x1')).toBe(BASE); // no writeback
  });
});
