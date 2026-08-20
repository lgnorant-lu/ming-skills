import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const EM_AARCH64 = 183;
const ET_DYN = 3;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const SYM = 24;
const RELA = 24;
const DT_NULL = 0;
const DT_STRTAB = 5;
const DT_SYMTAB = 6;
const DT_STRSZ = 10;
const DT_SYMENT = 11;
const DT_JMPREL = 23;
const DT_PLTRELSZ = 2;
const R_AARCH64_JUMP_SLOT = 1026;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

function le32(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

function buildSoWithUnresolvedImport(): Uint8Array {
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

  const codeOff = place(8, 4);
  const exportName = 'call_missing';
  const importName = 'mystery_func';
  const dynstrText = `\0${exportName}\0${importName}\0`;
  const exportNameOff = 1;
  const importNameOff = exportNameOff + exportName.length + 1;
  const dynsymOff = place(SYM * 3, 8);
  const dynstr = Uint8Array.from([...dynstrText].map((c) => c.charCodeAt(0)));
  const dynstrOff = place(dynstr.length, 1);
  const gotOff = place(8, 8);
  const relaPltOff = place(RELA, 8);
  const dynEntries: Array<[number, number]> = [
    [DT_SYMTAB, dynsymOff],
    [DT_STRTAB, dynstrOff],
    [DT_STRSZ, dynstr.length],
    [DT_SYMENT, SYM],
    [DT_JMPREL, relaPltOff],
    [DT_PLTRELSZ, RELA],
    [DT_NULL, 0],
  ];
  const dynOff = place(dynEntries.length * 16, 8);
  const total = cursor;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(codeOff), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, 0n, true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, PHNUM, true);

  const p0 = EHDR;
  dv.setUint32(p0 + 0x00, PT_LOAD, true);
  dv.setUint32(p0 + 0x04, 0b111, true);
  dv.setBigUint64(p0 + 0x08, 0n, true);
  dv.setBigUint64(p0 + 0x10, 0n, true);
  dv.setBigUint64(p0 + 0x20, BigInt(total), true);
  dv.setBigUint64(p0 + 0x28, BigInt(total), true);
  dv.setBigUint64(p0 + 0x30, 0x10000n, true);

  const p1 = EHDR + PHDR;
  dv.setUint32(p1 + 0x00, PT_DYNAMIC, true);
  dv.setBigUint64(p1 + 0x08, BigInt(dynOff), true);
  dv.setBigUint64(p1 + 0x10, BigInt(dynOff), true);
  dv.setBigUint64(p1 + 0x20, BigInt(dynEntries.length * 16), true);
  dv.setBigUint64(p1 + 0x28, BigInt(dynEntries.length * 16), true);

  const movzX8Zero = 0xd2800008;
  const blrX8 = 0xd63f0100;
  u8.set([...le32(movzX8Zero), ...le32(blrX8)], codeOff);
  u8.set(dynstr, dynstrOff);

  const exportSym = dynsymOff + SYM;
  dv.setUint32(exportSym + 0x00, exportNameOff, true);
  dv.setUint8(exportSym + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
  dv.setUint16(exportSym + 0x06, 1, true);
  dv.setBigUint64(exportSym + 0x08, BigInt(codeOff), true);

  const importSym = dynsymOff + SYM * 2;
  dv.setUint32(importSym + 0x00, importNameOff, true);
  dv.setUint8(importSym + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
  dv.setUint16(importSym + 0x06, 0, true);

  dv.setBigUint64(relaPltOff + 0x00, BigInt(gotOff), true);
  dv.setBigUint64(relaPltOff + 0x08, (2n << 32n) | BigInt(R_AARCH64_JUMP_SLOT), true);
  dv.setBigUint64(relaPltOff + 0x10, 0n, true);

  dynEntries.forEach(([tag, val], i) => {
    dv.setBigInt64(dynOff + i * 16, BigInt(tag), true);
    dv.setBigUint64(dynOff + i * 16 + 8, BigInt(val), true);
  });
  return u8;
}

describe('CpuEngine runtime diagnostics', () => {
  it('records unresolved import relocations; NULL calls are auto-NOPed', () => {
    const engine = new CpuEngine();
    engine.loadElf(buildSoWithUnresolvedImport());

    expect(engine.unresolvedImports()).toEqual([
      expect.objectContaining({
        symbol: 'mystery_func',
        relocationType: 'R_AARCH64_JUMP_SLOT',
        resolution: 'unresolved',
      }),
    ]);
    // With auto-NOP, the NULL call through the unresolved GOT entry is
    // patched to RET instead of throwing. The result is 0 (clean return).
    expect(() => engine.callSymbol('call_missing', [])).not.toThrow();
    // The auto-patched address is recorded for diagnostics.
    expect(engine.nullCallPatches.length).toBeGreaterThan(0);
  });
});
