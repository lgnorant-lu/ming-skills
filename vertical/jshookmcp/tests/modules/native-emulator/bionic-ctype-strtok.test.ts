/**
 * bionic ctype predicates + strtok_r stateful tokenisation.
 *
 * C semantics:
 *   isprint(c)  — 0x20..0x7E printable
 *   isgraph(c)  — 0x21..0x7E printable excluding space
 *   ispunct(c)  — graph and not alnum
 *   iscntrl(c)  — 0x00..0x1F or 0x7F
 *   strtok_r(str, delim, saveptr) — str=NULL resumes from *saveptr.
 */
import { describe, expect, it } from 'vitest';

import { createBionicLibrary, type BionicMemoryMapper } from '@modules/native-emulator/bionic';
import type { HostContext } from '@modules/native-emulator/CpuEngine';

const NOOP_RUNTIME: BionicMemoryMapper = {
  mapMemory: () => undefined,
  lookupSymbol: () => undefined,
  bindImportStub: () => 1,
  callGuestFunction: () => 0,
};

/** Context over a flat Uint8Array with 8-byte loadValue/storeValue. */
function makeMemContext(mem: Uint8Array, registers: bigint[]): HostContext {
  const x = [...registers];
  while (x.length < 31) x.push(0n);
  const dv = new DataView(mem.buffer, mem.byteOffset, mem.byteLength);
  return {
    x: (index) => x[index] ?? 0n,
    setX: (index, value) => {
      x[index] = value;
    },
    setD: () => undefined,
    read: (address, length) => mem.subarray(address, address + length),
    write: (address, bytes) => {
      mem.set(bytes, address);
    },
    loadValue: (address, length): bigint => {
      if (length === 8) return dv.getBigUint64(address, true);
      if (length === 4) return BigInt(dv.getUint32(address, true));
      throw new Error(`unexpected loadValue width ${length}`);
    },
    storeValue: (address, length, value) => {
      if (length === 8) dv.setBigUint64(address, value, true);
      else if (length === 4) dv.setUint32(address, Number(value), true);
      else throw new Error(`unexpected storeValue width ${length}`);
    },
  };
}

describe('bionic ctype predicates', () => {
  const lib = createBionicLibrary(NOOP_RUNTIME);
  const call = (name: string, value: number) =>
    lib.get(name)!(makeMemContext(new Uint8Array(8), [BigInt(value)]));

  it('isprint: 0x20..0x7E printable', () => {
    expect(call('isprint', 0x20)).toBe(1n);
    expect(call('isprint', 0x41)).toBe(1n); // 'A'
    expect(call('isprint', 0x7e)).toBe(1n); // '~'
    expect(call('isprint', 0x1f)).toBe(0n);
    expect(call('isprint', 0x7f)).toBe(0n); // DEL is a control char
    expect(call('isprint', 0x00)).toBe(0n);
  });

  it('isgraph: printable excluding space', () => {
    expect(call('isgraph', 0x21)).toBe(1n); // '!'
    expect(call('isgraph', 0x41)).toBe(1n);
    expect(call('isgraph', 0x20)).toBe(0n); // space
    expect(call('isgraph', 0x7f)).toBe(0n);
  });

  it('ispunct: graphic non-alphanumeric', () => {
    expect(call('ispunct', 0x21)).toBe(1n); // '!'
    expect(call('ispunct', 0x2e)).toBe(1n); // '.'
    expect(call('ispunct', 0x41)).toBe(0n); // 'A' is alnum
    expect(call('ispunct', 0x39)).toBe(0n); // '9' is alnum
    expect(call('ispunct', 0x20)).toBe(0n); // space is not punct
  });

  it('iscntrl: 0x00..0x1F and 0x7F', () => {
    expect(call('iscntrl', 0x00)).toBe(1n);
    expect(call('iscntrl', 0x09)).toBe(1n); // TAB
    expect(call('iscntrl', 0x1f)).toBe(1n);
    expect(call('iscntrl', 0x7f)).toBe(1n); // DEL
    expect(call('iscntrl', 0x20)).toBe(0n);
    expect(call('iscntrl', 0x41)).toBe(0n);
  });
});

describe('bionic strtok_r — stateful tokenisation', () => {
  const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

  it('tokenises "hello,world" in two calls via saveptr', () => {
    const mem = new Uint8Array(64);
    mem.set(ascii('hello,world\0'), 8);
    const lib = createBionicLibrary(NOOP_RUNTIME);
    // saveptr lives at guest address 0 (8-byte slot, initialised to 0).
    // x0=str(8) x1=delim(40) x2=saveptr(0)
    mem.set(ascii(',\0'), 40);
    let ctx = makeMemContext(mem, [8n, 40n, 0n]);
    const first = lib.get('strtok_r')!(ctx);
    expect(first).toBe(8n);
    // delimiter replaced by NUL, saveptr advanced past it
    expect(mem[13]).toBe(0); // ',' at 8+5=13 became NUL
    expect(new DataView(mem.buffer).getBigUint64(0, true)).toBe(14n);

    ctx = makeMemContext(mem, [0n, 40n, 0n]);
    const second = lib.get('strtok_r')!(ctx);
    expect(second).toBe(14n);
    // end of string: saveptr cleared
    expect(new DataView(mem.buffer).getBigUint64(0, true)).toBe(0n);

    ctx = makeMemContext(mem, [0n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(0n); // NULL: no more tokens
  });

  it('skips leading delimiters and handles a multi-byte delimiter set', () => {
    const mem = new Uint8Array(64);
    mem.set(ascii('..a,b;c\0'), 8);
    mem.set(ascii('.,;\0'), 40);
    const lib = createBionicLibrary(NOOP_RUNTIME);
    let ctx = makeMemContext(mem, [8n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(10n); // "a" after leading ".."
    ctx = makeMemContext(mem, [0n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(12n); // "b"
    ctx = makeMemContext(mem, [0n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(14n); // "c"
    ctx = makeMemContext(mem, [0n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(0n);
  });

  it('returns NULL when the string is all delimiters and clears saveptr', () => {
    const mem = new Uint8Array(64);
    mem.set(ascii(';;;\0'), 8);
    mem.set(ascii(';\0'), 40);
    const lib = createBionicLibrary(NOOP_RUNTIME);
    const ctx = makeMemContext(mem, [8n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(0n);
    expect(new DataView(mem.buffer).getBigUint64(0, true)).toBe(0n);
  });

  it('a fresh str (non-NULL) restarts tokenisation from the new string', () => {
    const mem = new Uint8Array(64);
    mem.set(ascii('x-y\0'), 8);
    mem.set(ascii('-\0'), 40);
    const lib = createBionicLibrary(NOOP_RUNTIME);
    let ctx = makeMemContext(mem, [8n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(8n); // "x", '-' at 9 → NUL
    expect(mem[9]).toBe(0);
    // A fresh non-NULL str re-tokenises the string from the start, regardless
    // of any saveptr state: "x" again, since the delimiter was NUL'd.
    ctx = makeMemContext(mem, [8n, 40n, 0n]);
    expect(lib.get('strtok_r')!(ctx)).toBe(8n);
  });
});
