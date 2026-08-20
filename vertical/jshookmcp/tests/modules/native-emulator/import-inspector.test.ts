import { describe, expect, it } from 'vitest';

import { inspectElfImports } from '@modules/native-emulator/import-inspector';

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
const DT_RELA = 7;
const DT_RELASZ = 8;
const DT_JMPREL = 23;
const DT_PLTRELSZ = 2;
const R_AARCH64_GLOB_DAT = 1025;
const R_AARCH64_JUMP_SLOT = 1026;
const STT_FUNC = 2;
const STB_GLOBAL = 1;

interface ImportSpec {
  name: string;
  type: number;
}

function buildImportSo(imports: ImportSpec[]): Uint8Array {
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

  const nameOffsets = new Map<string, number>();
  let dynstrText = '\0';
  for (const spec of imports) {
    nameOffsets.set(spec.name, dynstrText.length);
    dynstrText += `${spec.name}\0`;
  }

  const dynsymOff = place(SYM * (imports.length + 1), 8);
  const dynstr = Uint8Array.from([...dynstrText].map((c) => c.charCodeAt(0)));
  const dynstrOff = place(dynstr.length, 1);
  const gotOff = place(8 * imports.length, 8);
  const relaDyn = imports.filter((spec) => spec.type === R_AARCH64_GLOB_DAT);
  const relaPlt = imports.filter((spec) => spec.type === R_AARCH64_JUMP_SLOT);
  const relaDynOff = place(RELA * relaDyn.length, 8);
  const relaPltOff = place(RELA * relaPlt.length, 8);
  const dynEntries: Array<[number, number]> = [
    [DT_SYMTAB, dynsymOff],
    [DT_STRTAB, dynstrOff],
    [DT_STRSZ, dynstr.length],
    [DT_SYMENT, SYM],
    [DT_RELA, relaDynOff],
    [DT_RELASZ, RELA * relaDyn.length],
    [DT_JMPREL, relaPltOff],
    [DT_PLTRELSZ, RELA * relaPlt.length],
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
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setBigUint64(0x28, 0n, true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, PHNUM, true);

  const p0 = EHDR;
  dv.setUint32(p0 + 0x00, PT_LOAD, true);
  dv.setUint32(p0 + 0x04, 0b110, true);
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

  u8.set(dynstr, dynstrOff);
  imports.forEach((spec, i) => {
    const sym = dynsymOff + SYM * (i + 1);
    dv.setUint32(sym + 0x00, nameOffsets.get(spec.name)!, true);
    dv.setUint8(sym + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
    dv.setUint16(sym + 0x06, 0, true);
  });

  let relaDynCursor = relaDynOff;
  let relaPltCursor = relaPltOff;
  imports.forEach((spec, i) => {
    const rela = spec.type === R_AARCH64_GLOB_DAT ? relaDynCursor : relaPltCursor;
    if (spec.type === R_AARCH64_GLOB_DAT) {
      relaDynCursor += RELA;
    } else {
      relaPltCursor += RELA;
    }
    dv.setBigUint64(rela + 0x00, BigInt(gotOff + i * 8), true);
    dv.setBigUint64(rela + 0x08, (BigInt(i + 1) << 32n) | BigInt(spec.type), true);
    dv.setBigUint64(rela + 0x10, 0n, true);
  });

  dynEntries.forEach(([tag, val], i) => {
    dv.setBigInt64(dynOff + i * 16, BigInt(tag), true);
    dv.setBigUint64(dynOff + i * 16 + 8, BigInt(val), true);
  });
  return u8;
}

describe('inspectElfImports', () => {
  it('classifies JUMP_SLOT and GLOB_DAT imports against built-in bionic support', () => {
    const report = inspectElfImports(
      buildImportSo([
        { name: 'malloc', type: R_AARCH64_JUMP_SLOT },
        { name: 'getpagesize', type: R_AARCH64_GLOB_DAT },
        { name: 'missing_runtime_symbol', type: R_AARCH64_JUMP_SLOT },
      ]),
    );

    expect(report.totalImports).toBe(3);
    expect(report.supportedImports).toBe(2);
    expect(report.unresolvedImports).toBe(1);
    expect(report.imports).toEqual([
      expect.objectContaining({
        symbol: 'getpagesize',
        relocationType: 'R_AARCH64_GLOB_DAT',
        resolution: 'bionic',
      }),
      expect.objectContaining({
        symbol: 'malloc',
        relocationType: 'R_AARCH64_JUMP_SLOT',
        resolution: 'bionic',
      }),
      expect.objectContaining({
        symbol: 'missing_runtime_symbol',
        relocationType: 'R_AARCH64_JUMP_SLOT',
        resolution: 'unresolved',
      }),
    ]);
    expect(report.imports.every((item) => Number.isFinite(item.gotOffset))).toBe(true);
  });
});
