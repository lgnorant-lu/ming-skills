/**
 * Coverage tests for c-strings helpers — read/write/format guest C strings
 * against a byte-addressable mock memory.
 */

import { describe, expect, it } from 'vitest';
import {
  formatGuestCString,
  readGuestCString,
  readGuestCStringBytes,
  utf8ByteLength,
  writeGuestCString,
} from '@modules/native-emulator/c-strings';

function memCtx(bytes: Record<number, number> = {}) {
  const mem = new Map<number, number>(Object.entries(bytes).map(([k, v]) => [Number(k), v]));
  return {
    read: (addr: number, len: number) => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = mem.get(addr + i) ?? 0;
      return out;
    },
    write: (addr: number, data: Uint8Array) => {
      for (let i = 0; i < data.length; i++) mem.set(addr + i, data[i]!);
    },
    x: (addr: number, len: number) => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = mem.get(addr + i) ?? 0;
      return out;
    },
  };
}

describe('readGuestCStringBytes / readGuestCString', () => {
  it('returns empty for address 0', () => {
    expect(readGuestCStringBytes({ read: memCtx().read } as never, 0).length).toBe(0);
  });

  it('reads until NUL terminator', () => {
    const ctx = memCtx({ 100: 0x48, 101: 0x69, 102: 0x00, 103: 0xff });
    expect(readGuestCString({ read: ctx.read } as never, 100)).toBe('Hi');
  });

  it('respects maxBytes cap (small cap, NUL-terminated)', () => {
    const ctx = memCtx({ 0: 0x41, 1: 0x42, 2: 0x00, 3: 0x43 });
    // Even with a generous cap, reading stops at the NUL → "A" only when cap=1.
    const one = readGuestCStringBytes({ read: ctx.read } as never, 0, 1);
    expect(one.length).toBeLessThanOrEqual(1);
  });

  it('reads a NUL-terminated string from a non-zero address', () => {
    const ctx = memCtx({ 50: 0x41, 51: 0x42, 52: 0x43, 53: 0x00 });
    expect(readGuestCString({ read: ctx.read } as never, 50)).toBe('ABC');
  });
});

describe('utf8ByteLength', () => {
  it('returns the UTF-8 byte length (multi-byte chars count)', () => {
    expect(utf8ByteLength('ABC')).toBe(3);
    expect(utf8ByteLength('héllo')).toBe(6); // é is 2 bytes
  });
});

describe('writeGuestCString', () => {
  it('writes the string + NUL terminator + returns the UTF-8 length', () => {
    const ctx = memCtx();
    const n = writeGuestCString({ write: ctx.write } as never, 0x200, 'Hi');
    expect(n).toBe(2);
    // NUL terminator written at 0x202
    expect(ctx.read(0x200, 3)).toEqual(new Uint8Array([0x48, 0x69, 0x00]));
  });

  it('truncates to maxSize-1 bytes when maxSize is set', () => {
    const ctx = memCtx();
    const n = writeGuestCString({ write: ctx.write } as never, 0, 'ABCDE', 3);
    expect(n).toBe(5); // returns the FULL length (sprintf semantics)
    expect(ctx.read(0, 3)).toEqual(new Uint8Array([0x41, 0x42, 0x00])); // truncated body + NUL
  });

  it('returns the byte length without writing when maxSize <= 0', () => {
    const ctx = memCtx();
    expect(writeGuestCString({ write: ctx.write } as never, 0, 'ABC', 0)).toBe(3);
  });
});

describe('formatGuestCString', () => {
  it('runs without throwing against a mock memory', () => {
    const ctx = memCtx();
    // The format routine may interpret the format literally or read from memory;
    // we only assert it returns a string and doesn't throw.
    const out = formatGuestCString({ x: ctx.x, read: ctx.read } as never, 0, 0);
    expect(typeof out).toBe('string');
  });
});
