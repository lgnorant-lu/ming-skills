import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';

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

function payload(res: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const text = res.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function buildImportSo(importNames: string[]): Uint8Array {
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
  for (const name of importNames) {
    nameOffsets.set(name, dynstrText.length);
    dynstrText += `${name}\0`;
  }
  const dynsymOff = place(SYM * (importNames.length + 1), 8);
  const dynstr = Uint8Array.from([...dynstrText].map((c) => c.charCodeAt(0)));
  const dynstrOff = place(dynstr.length, 1);
  const gotOff = place(8 * importNames.length, 8);
  const relaPltOff = place(RELA * importNames.length, 8);
  const dynEntries: Array<[number, number]> = [
    [DT_SYMTAB, dynsymOff],
    [DT_STRTAB, dynstrOff],
    [DT_STRSZ, dynstr.length],
    [DT_SYMENT, SYM],
    [DT_JMPREL, relaPltOff],
    [DT_PLTRELSZ, RELA * importNames.length],
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
  importNames.forEach((name, i) => {
    const sym = dynsymOff + SYM * (i + 1);
    dv.setUint32(sym + 0x00, nameOffsets.get(name)!, true);
    dv.setUint8(sym + 0x04, (STB_GLOBAL << 4) | STT_FUNC);
    dv.setUint16(sym + 0x06, 0, true);

    const rela = relaPltOff + RELA * i;
    dv.setBigUint64(rela + 0x00, BigInt(gotOff + i * 8), true);
    dv.setBigUint64(rela + 0x08, (BigInt(i + 1) << 32n) | BigInt(R_AARCH64_JUMP_SLOT), true);
    dv.setBigUint64(rela + 0x10, 0n, true);
  });
  dynEntries.forEach(([tag, val], i) => {
    dv.setBigInt64(dynOff + i * 16, BigInt(tag), true);
    dv.setBigUint64(dynOff + i * 16 + 8, BigInt(val), true);
  });
  return u8;
}

let tmpDir: string;
let soPath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'nemu-imports-'));
  soPath = join(tmpDir, 'libimports.so');
  await writeFile(
    soPath,
    buildImportSo(['malloc', 'getpagesize', 'mprotect', 'dlopen', 'mystery_func']),
  );
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('NativeEmulatorHandlers — ELF import inspection', () => {
  it('reports bionic-backed and unresolved imported symbols before emulation', async () => {
    const handlers = new NativeEmulatorHandlers();
    const data = payload(await handlers.handleInspectImports({ soPath }));
    expect(data.success).toBe(true);
    expect(data.totalImports).toBe(5);
    expect(data.supportedImports).toBe(4);
    expect(data.unresolvedImports).toBe(1);

    const imports = data.imports as Array<Record<string, unknown>>;
    expect(imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'malloc', resolution: 'bionic' }),
        expect.objectContaining({ symbol: 'getpagesize', resolution: 'bionic' }),
        expect.objectContaining({ symbol: 'mprotect', resolution: 'bionic' }),
        expect.objectContaining({ symbol: 'dlopen', resolution: 'bionic' }),
        expect.objectContaining({ symbol: 'mystery_func', resolution: 'unresolved' }),
      ]),
    );
    expect(imports.every((item) => typeof item.gotOffset === 'number')).toBe(true);
    handlers.dispose();
  });
});
