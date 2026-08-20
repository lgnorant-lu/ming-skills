/**
 * E5-C: ElfParser / MachOParser header + symbol-table extension tests.
 *
 * The repo's `tiny-libapp.so` fixture is a 0xff-padded stub, not a real ELF,
 * so these tests synthesise a minimal ELF64 header in a tmp file to validate
 * the parser field offsets, plus exercise the null/empty paths for non-binaries.
 * Full .dynsym symbol-table coverage waits for a real .so fixture or a Linux
 * CI run.
 */

import { describe, expect, it, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseElfHeader, parseElfSections, parseElfSymbols } from '@native/platform/ElfParser';
import { parseMachOHeader, parseMachOSymbols } from '@native/platform/MachOParser';

const tmp = mkdtempSync(join(tmpdir(), 'elf-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Build a minimal 64-byte ELF64 header with the given type/machine. */
function makeElf64Header(type: number, machine: number, shoff = 0, shnum = 0): Buffer {
  const b = Buffer.alloc(64, 0);
  b[0] = 0x7f;
  b.write('ELF', 1, 'ascii');
  b[4] = 2; // ELFCLASS64
  b[5] = 1; // ELFDATA2LSB (LE)
  b[6] = 1; // EV_CURRENT
  b.writeUInt16LE(type, 16);
  b.writeUInt16LE(machine, 18);
  b.writeUInt32LE(1, 20); // ELF version
  b.writeBigUInt64LE(0x1000n, 24); // e_entry
  b.writeBigUInt64LE(BigInt(shoff), 40); // e_shoff
  b.writeUInt16LE(64, 52); // e_ehsize
  b.writeUInt16LE(shnum, 60); // e_shnum
  return b;
}

const ELF64_PATH = join(tmp, 'mini.elf');
writeFileSync(ELF64_PATH, makeElf64Header(3, 0xb7)); // ET_DYN, EM_AARCH64

const NON_BINARY = join(tmp, 'notelf.txt');
writeFileSync(NON_BINARY, Buffer.from('hello world'));

describe('ElfParser: parseElfHeader (E5-C)', () => {
  it('parses a synthesised ELF64 header', () => {
    const h = parseElfHeader(ELF64_PATH);
    expect(h).not.toBeNull();
    expect(h!.class).toBe(2);
    expect(h!.dataEncoding).toBe(1);
    expect(h!.type).toBe(3); // ET_DYN
    expect(h!.machine).toBe(0xb7); // EM_AARCH64
    expect(h!.entry).toBe(0x1000n);
    expect(h!.shnum).toBe(0);
  });

  it('returns null for a non-ELF file', () => {
    expect(parseElfHeader(NON_BINARY)).toBeNull();
  });

  it('returns null for a missing file', () => {
    expect(parseElfHeader(join(tmp, 'nope.elf'))).toBeNull();
  });
});

describe('ElfParser: parseElfSymbols / parseElfSections (E5-C empty paths)', () => {
  it('returns empty sections + symbols when shnum=0 (header-only binary)', () => {
    expect(parseElfSections(ELF64_PATH)).toEqual([]);
    const symtab = parseElfSymbols(ELF64_PATH);
    expect(symtab.imports).toEqual([]);
    expect(symtab.exports).toEqual([]);
  });

  it('returns empty for a non-ELF file', () => {
    expect(parseElfSections(NON_BINARY)).toEqual([]);
    const symtab = parseElfSymbols(NON_BINARY);
    expect(symtab.imports).toEqual([]);
    expect(symtab.exports).toEqual([]);
  });
});

describe('MachOParser: header + symbol null paths (E5-C)', () => {
  it('parseMachOHeader returns null for a non-Mach-O file', () => {
    expect(parseMachOHeader(NON_BINARY)).toBeNull();
    expect(parseMachOHeader(join(tmp, 'missing.dylib'))).toBeNull();
  });

  it('parseMachOSymbols returns empty lists for a non-Mach-O file', () => {
    const symtab = parseMachOSymbols(NON_BINARY);
    expect(symtab.imports).toEqual([]);
    expect(symtab.exports).toEqual([]);
  });

  it('parseMachOSymbols returns empty lists for a missing file', () => {
    const symtab = parseMachOSymbols(join(tmp, 'missing.dylib'));
    expect(symtab.imports).toEqual([]);
    expect(symtab.exports).toEqual([]);
  });
});
