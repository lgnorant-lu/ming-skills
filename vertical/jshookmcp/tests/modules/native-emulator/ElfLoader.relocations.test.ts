/**
 * L7 TDD — ELF dynamic relocation + PT_DYNAMIC symbol resolution (Phase 2).
 *
 * Real Android `.so` are position-independent and usually stripped of their
 * section header table, so symbol resolution and GOT/PLT fixups must come from
 * PT_DYNAMIC + .rela.* — not section headers. These tests build a stripped-style
 * ELF (e_shnum = 0) carrying a PT_DYNAMIC with DT_SYMTAB/STRTAB/RELA/JMPREL, and
 * assert:
 *   - exportedSymbols() resolves via PT_DYNAMIC (the section-header path is gone)
 *   - relocations() returns the parsed entries
 *   - CpuEngine.loadElf applies RELATIVE/GLOB_DAT/JUMP_SLOT and auto-wires a
 *     bionic import (malloc) so its GOT slot points at a working stub.
 *
 * Layout (all little-endian AArch64):
 *   Ehdr(64) | Phdr[2](56 each) | <segment image at file offset = vaddr>
 * The single PT_LOAD maps the whole file at vaddr 0, so file offset == vaddr,
 * which keeps the dynamic/reloc vaddr→offset mapping trivial.
 */
import { describe, expect, it } from 'vitest';

import { ElfLoader } from '@modules/native-emulator/ElfLoader';
import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { createBionicLibrary } from '@modules/native-emulator/bionic';

const EM_AARCH64 = 183;
const ET_DYN = 3;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const SYM = 24;
const RELA = 24;

// Dynamic tags.
const DT_NULL = 0;
const DT_STRTAB = 5;
const DT_SYMTAB = 6;
const DT_RELA = 7;
const DT_RELASZ = 8;
const DT_STRSZ = 10;
const DT_SYMENT = 11;
const DT_JMPREL = 23;
const DT_PLTRELSZ = 2;

// AArch64 reloc types.
const R_RELATIVE = 1027;
const R_GLOB_DAT = 1025;
const R_JUMP_SLOT = 1026;

const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface BuiltSo {
  bytes: Uint8Array;
  signVaddr: number;
  gotRelative: number; // GOT slot patched by the RELATIVE reloc
  gotMalloc: number; // GOT slot patched by the malloc JUMP_SLOT
  relativeAddend: number;
}

/**
 * Build a stripped-style PIC `.so`:
 *   - one exported function "sign" (just `ret`)
 *   - one imported symbol "malloc" (undefined, st_shndx=0)
 *   - a .rela.dyn with one R_AARCH64_RELATIVE (addend → a GOT slot)
 *   - a .rela.plt with one R_AARCH64_JUMP_SLOT against malloc
 *   - PT_DYNAMIC pointing at all of the above; NO section headers.
 */
function buildPicSo(importName = 'malloc', importRelocationType = R_JUMP_SLOT): BuiltSo {
  // Choose a flat layout: everything in one PT_LOAD at vaddr 0, file offset = vaddr.
  const EHDR = 64;
  const PHNUM = 2;
  const PHDR = 56;
  let cursor = EHDR + PHNUM * PHDR;

  const place = (size: number, align = 8): number => {
    if (cursor % align !== 0) cursor += align - (cursor % align);
    const at = cursor;
    cursor += size;
    return at;
  };

  // Code: sign() = ret (0xd65f03c0).
  const codeOff = place(4, 4);
  const signVaddr = codeOff;

  // .dynstr: one defined export plus one configurable import.
  const dynstr = Uint8Array.from([
    0,
    ...[...'sign'].map((c) => c.charCodeAt(0)),
    0,
    ...[...importName].map((c) => c.charCodeAt(0)),
    0,
  ]);
  const nameSign = 1;
  const nameMalloc = 6;
  const dynstrOff = place(dynstr.length, 1);

  // .dynsym: [0]=null, [1]=sign (defined), [2]=malloc (undef import).
  const symCount = 3;
  const dynsymOff = place(SYM * symCount, 8);

  // Two GOT slots the relocations patch (8 bytes each).
  const gotRelative = place(8, 8);
  const gotMalloc = place(8, 8);

  // .rela.dyn: 1 entry (RELATIVE → gotRelative, addend = signVaddr).
  const relaDynOff = place(RELA, 8);
  // .rela.plt: 1 entry (JUMP_SLOT → gotMalloc, sym = malloc index 2).
  const relaPltOff = place(RELA, 8);

  // PT_DYNAMIC contents (Elf64_Dyn pairs).
  const dynEntries: Array<[number, number]> = [
    [DT_SYMTAB, dynsymOff],
    [DT_STRTAB, dynstrOff],
    [DT_STRSZ, dynstr.length],
    [DT_SYMENT, SYM],
    [DT_RELA, relaDynOff],
    [DT_RELASZ, RELA],
    [DT_JMPREL, relaPltOff],
    [DT_PLTRELSZ, RELA],
    [DT_NULL, 0],
  ];
  const dynOff = place(dynEntries.length * 16, 8);

  const total = cursor;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // Ehdr — note e_shoff/e_shnum = 0 (stripped of section headers).
  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2); // ELFCLASS64
  dv.setUint8(5, 1); // little-endian
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(signVaddr), true); // e_entry
  dv.setBigUint64(0x20, BigInt(EHDR), true); // e_phoff
  dv.setBigUint64(0x28, 0n, true); // e_shoff = 0
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, PHNUM, true); // e_phnum
  dv.setUint16(0x3a, 0, true); // e_shentsize
  dv.setUint16(0x3c, 0, true); // e_shnum = 0

  // Phdr[0] = PT_LOAD covering the whole file at vaddr 0 (offset == vaddr).
  const p0 = EHDR;
  dv.setUint32(p0 + 0x00, PT_LOAD, true);
  dv.setUint32(p0 + 0x04, 0b111, true); // RWX so GOT writes land in a writable region
  dv.setBigUint64(p0 + 0x08, 0n, true); // p_offset
  dv.setBigUint64(p0 + 0x10, 0n, true); // p_vaddr
  dv.setBigUint64(p0 + 0x20, BigInt(total), true); // p_filesz
  dv.setBigUint64(p0 + 0x28, BigInt(total), true); // p_memsz
  dv.setBigUint64(p0 + 0x30, 0x10000n, true);

  // Phdr[1] = PT_DYNAMIC.
  const p1 = EHDR + PHDR;
  dv.setUint32(p1 + 0x00, PT_DYNAMIC, true);
  dv.setBigUint64(p1 + 0x08, BigInt(dynOff), true); // p_offset
  dv.setBigUint64(p1 + 0x10, BigInt(dynOff), true); // p_vaddr
  dv.setBigUint64(p1 + 0x20, BigInt(dynEntries.length * 16), true);
  dv.setBigUint64(p1 + 0x28, BigInt(dynEntries.length * 16), true);

  // Code.
  dv.setUint32(codeOff, 0xd65f03c0, true); // ret

  // .dynstr.
  u8.set(dynstr, dynstrOff);

  // .dynsym.
  // [1] sign — defined (st_shndx = 1), value = signVaddr.
  dv.setUint32(dynsymOff + SYM * 1 + 0x00, nameSign, true);
  dv.setUint8(dynsymOff + SYM * 1 + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
  dv.setUint16(dynsymOff + SYM * 1 + 0x06, 1, true);
  dv.setBigUint64(dynsymOff + SYM * 1 + 0x08, BigInt(signVaddr), true);
  // [2] malloc — undefined import (st_shndx = 0, value = 0).
  dv.setUint32(dynsymOff + SYM * 2 + 0x00, nameMalloc, true);
  dv.setUint8(dynsymOff + SYM * 2 + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
  dv.setUint16(dynsymOff + SYM * 2 + 0x06, 0, true);

  // .rela.dyn[0] = RELATIVE → patches gotRelative with addend = signVaddr.
  const relativeAddend = signVaddr;
  dv.setBigUint64(relaDynOff + 0x00, BigInt(gotRelative), true); // r_offset
  dv.setBigUint64(relaDynOff + 0x08, BigInt(R_RELATIVE), true); // r_info (sym=0, type)
  dv.setBigUint64(relaDynOff + 0x10, BigInt(relativeAddend), true); // r_addend

  // .rela.plt[0] = JUMP_SLOT → patches gotMalloc, sym index 2 (malloc).
  dv.setBigUint64(relaPltOff + 0x00, BigInt(gotMalloc), true);
  dv.setBigUint64(relaPltOff + 0x08, (2n << 32n) | BigInt(importRelocationType), true);
  dv.setBigUint64(relaPltOff + 0x10, 0n, true);

  // PT_DYNAMIC entries.
  dynEntries.forEach(([tag, val], i) => {
    dv.setBigInt64(dynOff + i * 16 + 0x00, BigInt(tag), true);
    dv.setBigUint64(dynOff + i * 16 + 0x08, BigInt(val), true);
  });

  return { bytes: u8, signVaddr, gotRelative, gotMalloc, relativeAddend };
}

describe('ElfLoader — PT_DYNAMIC symbol resolution (stripped .so)', () => {
  it('resolves exported symbols without section headers', () => {
    const { bytes, signVaddr } = buildPicSo();
    const elf = new ElfLoader(bytes);
    const symbols = elf.exportedSymbols();
    expect(symbols.get('sign')).toBe(signVaddr);
    expect(elf.symbolFileOffset('sign')).toBe(signVaddr);
    expect(elf.symbolFileOffset('missing')).toBeUndefined();
    // malloc is an undefined import (st_shndx=0) → not an export.
    expect(symbols.has('malloc')).toBe(false);
  });

  it('parses .rela.dyn and .rela.plt relocations', () => {
    const { bytes, gotRelative, gotMalloc, relativeAddend } = buildPicSo();
    const relocs = new ElfLoader(bytes).relocations();
    const relative = relocs.find((r) => r.type === R_RELATIVE);
    const jumpSlot = relocs.find((r) => r.type === R_JUMP_SLOT);
    expect(relative?.offset).toBe(gotRelative);
    expect(relative?.addend).toBe(relativeAddend);
    expect(jumpSlot?.offset).toBe(gotMalloc);
    expect(jumpSlot?.symbolName).toBe('malloc');
  });
});

describe('CpuEngine.loadElf — relocation application + bionic auto-wiring', () => {
  it('applies R_AARCH64_RELATIVE (GOT slot = addend)', () => {
    const { bytes, gotRelative, relativeAddend } = buildPicSo();
    const engine = new CpuEngine();
    engine.loadElf(bytes, createBionicLibrary(engine));
    // The RELATIVE reloc should have written `relativeAddend` (8 bytes LE) at gotRelative.
    const slot = engine.readMemory(gotRelative, 8);
    const value = slot.reduce((acc, b, i) => acc + BigInt(b) * (1n << BigInt(i * 8)), 0n);
    expect(Number(value)).toBe(relativeAddend);
  });

  it('auto-wires an imported malloc to a callable bionic stub via JUMP_SLOT', () => {
    const { bytes, gotMalloc } = buildPicSo();
    const engine = new CpuEngine();
    engine.loadElf(bytes, createBionicLibrary(engine));
    // The JUMP_SLOT slot now holds the import-stub address. Reading it back and
    // jumping there should run malloc: set x0=size, PC=stub, LR=sentinel.
    const slot = engine.readMemory(gotMalloc, 8);
    const stubAddr = Number(slot.reduce((a, b, i) => a + BigInt(b) * (1n << BigInt(i * 8)), 0n));
    expect(stubAddr).toBeGreaterThan(0); // resolved, not left null
    // Drive the stub directly: malloc(32) should return a non-zero pointer.
    engine.writeRegister('x0', 32);
    engine.callHost(stubAddr);
    expect(engine.readRegister('x0')).toBeGreaterThan(0);
  });

  it('binds imported __sF GLOB_DAT relocations directly to persistent data', () => {
    const { bytes, gotMalloc } = buildPicSo('__sF', R_GLOB_DAT);
    const engine = new CpuEngine();
    const bionic = createBionicLibrary(engine);
    const dataAddress = bionic.dataSymbols.get('__sF');
    engine.loadElf(bytes, bionic);

    const slot = engine.readMemory(gotMalloc, 8);
    const resolved = Number(
      slot.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n),
    );
    expect(resolved).toBe(dataAddress);
    expect(engine.readMemory(resolved, 3 * 256)).toEqual(new Uint8Array(3 * 256));
    expect(() => engine.callHost(resolved)).toThrow('No host function registered');
  });
});
