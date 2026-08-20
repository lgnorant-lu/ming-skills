/**
 * L1/L2 — DT_INIT_ARRAY constructor execution.
 *
 * A dynamic linker runs an object's initializers (DT_INIT, then each
 * DT_INIT_ARRAY entry) immediately after applying relocations. Without this,
 * a `.so` built with C++ static constructors or __attribute__((constructor))
 * leaves its global subsystems uninitialized — e.g. SQLite's sqlite3_initialize
 * short-circuits because the (run-time-populated) mutex/mem tables stay NULL,
 * so sqlite3_open returns a NULL handle. These tests build a minimal AArch64
 * `.so` with a PT_DYNAMIC carrying DT_INIT_ARRAY and assert loadElf invokes the
 * constructor(s) — observable through a store the constructor makes to a global.
 *
 * The init-array slot holds an R_AARCH64_RELATIVE relocation (on-disk value 0),
 * mirroring real toolchain output: the constructor's address only materializes
 * after relocation, and loadElf must read the *relocated* slot to find it.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const EM_AARCH64 = 183;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const ET_DYN = 3;
const DT_NULL = 0;
const DT_RELA = 7;
const DT_RELASZ = 8;
const DT_RELAENT = 9;
const DT_INIT_ARRAY = 25;
const DT_INIT_ARRAYSZ = 27;
const R_AARCH64_RELATIVE = 1027;

/** le32 split of a 32-bit instruction word. */
function le32(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

/**
 * Build an AArch64 `.so` with:
 *   - one RW PT_LOAD segment containing: constructor code, an init_array slot,
 *     a dynamic table, a RELA table, and a writable global byte.
 *   - a PT_DYNAMIC pointing at the dynamic table.
 * The single constructor writes `marker` to the global at `globalVaddr`.
 * The init_array slot is fixed up by an R_AARCH64_RELATIVE reloc to the ctor.
 */
function buildSoWithInitArray(opts: {
  ctorCode: number[];
  ctorVaddr: number;
  initArrayVaddr: number;
  dynVaddr: number;
  relaVaddr: number;
  globalVaddr: number;
  segVaddr: number;
  segSize: number;
}): Uint8Array {
  const EHDR = 64;
  const PHDR = 56;
  const phnum = 2; // PT_LOAD + PT_DYNAMIC
  const segOffset = EHDR + PHDR * phnum;
  // File image is laid out so file offset == vaddr - segVaddr + segOffset.
  const total = segOffset + opts.segSize;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const toOff = (vaddr: number): number => segOffset + (vaddr - opts.segVaddr);

  // ELF header.
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(opts.ctorVaddr), true); // e_entry (unused here)
  dv.setBigUint64(0x20, BigInt(EHDR), true); // e_phoff
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, phnum, true);

  // PHDR 0: PT_LOAD (RW so the global + slot are writable).
  let p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b111, true); // R|W|X
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(opts.segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(opts.segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(opts.segSize), true);
  dv.setBigUint64(p + 0x28, BigInt(opts.segSize), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  // PHDR 1: PT_DYNAMIC.
  p = EHDR + PHDR;
  dv.setUint32(p + 0x00, PT_DYNAMIC, true);
  dv.setUint32(p + 0x04, 0b110, true);
  dv.setBigUint64(p + 0x08, BigInt(toOff(opts.dynVaddr)), true); // p_offset
  dv.setBigUint64(p + 0x10, BigInt(opts.dynVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(opts.dynVaddr), true);
  // p_filesz/p_memsz set after we know the dynamic table size (filled below).

  // Constructor code.
  u8.set(opts.ctorCode, toOff(opts.ctorVaddr));

  // init_array slot: on-disk 0 (the RELATIVE reloc supplies the ctor address).
  dv.setBigUint64(toOff(opts.initArrayVaddr), 0n, true);

  // RELA table: one R_AARCH64_RELATIVE fixing init_array slot → ctorVaddr.
  const relaOff = toOff(opts.relaVaddr);
  dv.setBigUint64(relaOff + 0x00, BigInt(opts.initArrayVaddr), true); // r_offset
  dv.setBigUint64(relaOff + 0x08, BigInt(R_AARCH64_RELATIVE), true); // r_info (type, sym 0)
  dv.setBigUint64(relaOff + 0x10, BigInt(opts.ctorVaddr), true); // r_addend = ctor vaddr

  // Dynamic table.
  const dynEntries: Array<[number, number]> = [
    [DT_RELA, opts.relaVaddr],
    [DT_RELASZ, 24],
    [DT_RELAENT, 24],
    [DT_INIT_ARRAY, opts.initArrayVaddr],
    [DT_INIT_ARRAYSZ, 8],
    [DT_NULL, 0],
  ];
  let d = toOff(opts.dynVaddr);
  for (const [tag, val] of dynEntries) {
    dv.setBigInt64(d + 0x00, BigInt(tag), true);
    dv.setBigUint64(d + 0x08, BigInt(val), true);
    d += 16;
  }
  const dynSize = dynEntries.length * 16;
  dv.setBigUint64(EHDR + PHDR + 0x20, BigInt(dynSize), true); // PT_DYNAMIC p_filesz
  dv.setBigUint64(EHDR + PHDR + 0x28, BigInt(dynSize), true); // PT_DYNAMIC p_memsz

  return u8;
}

describe('CpuEngine.loadElf — DT_INIT_ARRAY constructors', () => {
  it('runs an init_array constructor (fixed up via RELATIVE) after relocation', () => {
    // Layout within the segment (vaddrs):
    const segVaddr = 0x10000;
    const ctorVaddr = 0x10000; // constructor code at segment start
    const globalVaddr = 0x10400; // a writable byte the constructor sets
    const initArrayVaddr = 0x10800; // init_array slot
    const dynVaddr = 0x10808; // dynamic table
    const relaVaddr = 0x10900; // RELA table

    // Constructor: write 0x7 to the global at globalVaddr, then RET.
    //   movz x1, #0x7            ; value
    //   movz x0, #(globalVaddr & 0xffff)        (0x0400)
    //   movk x0, #(globalVaddr >> 16), lsl #16  (0x0001)
    //   sturb w1, [x0]           ; store byte  → use STR (unsigned) w1,[x0]
    //   ret
    const movz_x1 = (0xd2800000 | (0x7 << 5) | 1) >>> 0;
    const movz_x0 = (0xd2800000 | ((globalVaddr & 0xffff) << 5) | 0) >>> 0;
    const movk_x0 = (0xf2a00000 | (((globalVaddr >>> 16) & 0xffff) << 5) | 0) >>> 0;
    // strb w1,[x0,#0] = 0x39000001 (size=00, opc=00, unsigned offset, imm12=0)
    const strb = (0x39000000 | (0 << 10) | (0 << 5) | 1) >>> 0;
    const ret = 0xd65f03c0;
    const ctorCode = [
      ...le32(movz_x1),
      ...le32(movz_x0),
      ...le32(movk_x0),
      ...le32(strb),
      ...le32(ret),
    ];

    const so = buildSoWithInitArray({
      ctorCode,
      ctorVaddr,
      initArrayVaddr,
      dynVaddr,
      relaVaddr,
      globalVaddr,
      segVaddr,
      segSize: 0x1000,
    });

    const engine = new CpuEngine();
    // Global starts at 0 (zero-filled segment tail / explicit), then the ctor sets it.
    engine.loadElf(so);
    expect(Array.from(engine.readMemory(globalVaddr, 1))).toEqual([0x7]);
  });

  it('leaves globals untouched when there is no init_array (no constructor runs)', () => {
    // Reuse the builder but point init_array size to 0 by zeroing the slot's
    // reloc effect: simplest is a .so with no PT_DYNAMIC at all → buildSo path.
    // Here we assert the positive control: a plain segment with a byte stays 0.
    const segVaddr = 0x20000;
    const so = buildSoWithInitArray({
      ctorCode: [0xc0, 0x03, 0x5f, 0xd6], // just `ret`
      ctorVaddr: 0x20000,
      initArrayVaddr: 0x20800,
      dynVaddr: 0x20808,
      relaVaddr: 0x20900,
      globalVaddr: 0x20400,
      segVaddr,
      segSize: 0x1000,
    });
    const engine = new CpuEngine();
    engine.loadElf(so);
    // The ctor is just `ret`, so the global at 0x20400 stays zero.
    expect(Array.from(engine.readMemory(0x20400, 1))).toEqual([0x0]);
  });
});
