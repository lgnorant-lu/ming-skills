/**
 * L2 TDD — extended bionic libc (Phase 4): the string/mem functions a real
 * signing/crypto `.so` calls beyond the core (strncpy/strchr/strdup), plus
 * coverage for the memmove/memcmp/strcmp/calloc/realloc added in Phase 2.
 *
 * Rather than assemble a `.so` per case, this drives the BionicLibrary map
 * directly: createBionicLibrary returns name→HostFunction, and we hand each a
 * minimal HostContext backed by a flat byte buffer. That tests the libc
 * semantics in isolation; ELF auto-wiring is covered by ElfLoader.relocations.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { createBionicLibrary } from '@modules/native-emulator/bionic';
import type { HostContext } from '@modules/native-emulator/CpuEngine';

/** A flat-memory HostContext: x-registers in an array, bytes in one buffer. */
function makeCtx(mem: Uint8Array, regs: bigint[] = []): HostContext {
  const x = [...regs];
  while (x.length < 31) x.push(0n);
  return {
    x: (i) => x[i] ?? 0n,
    setX: (i, v) => {
      x[i] = v;
    },
    setD: () => undefined,
    read: (addr, len) => mem.subarray(addr, addr + len),
    write: (addr, bytes) => mem.set(bytes, addr),
  };
}

/** A CpuEngine whose heap (malloc/strdup) maps into a private byte buffer. */
function libWithHeap(): {
  lib: ReturnType<typeof createBionicLibrary>;
  engine: CpuEngine;
} {
  const engine = new CpuEngine();
  return { lib: createBionicLibrary(engine), engine };
}

const ASCII = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('bionic extended — strncpy', () => {
  it('copies up to n bytes and NUL-pads when the source ends early', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(64);
    mem.set(ASCII('hi\0'), 16); // src at 16 = "hi"
    const dst = 0;
    lib.get('strncpy')!(makeCtx(mem, [BigInt(dst), 16n, 6n]));
    // "hi" then 4 NUL pad bytes = 6 total.
    expect([...mem.subarray(0, 6)]).toEqual([0x68, 0x69, 0, 0, 0, 0]);
  });

  it('does not NUL-terminate when src is at least n bytes', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(64);
    mem.set(ASCII('abcdef'), 16);
    lib.get('strncpy')!(makeCtx(mem, [0n, 16n, 3n]));
    expect([...mem.subarray(0, 3)]).toEqual([0x61, 0x62, 0x63]);
  });
});

describe('bionic extended — strchr', () => {
  it('returns a pointer to the first match', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(64);
    mem.set(ASCII('a/b/c\0'), 8);
    const r = lib.get('strchr')!(makeCtx(mem, [8n, BigInt('/'.charCodeAt(0))]));
    expect(Number(r)).toBe(8 + 1); // first '/' at offset 1
  });

  it('returns NULL when the byte is absent', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(64);
    mem.set(ASCII('abc\0'), 8);
    const r = lib.get('strchr')!(makeCtx(mem, [8n, BigInt('z'.charCodeAt(0))]));
    expect(Number(r)).toBe(0);
  });
});

describe('bionic extended — strdup', () => {
  it('allocates a copy including the NUL terminator', () => {
    const { lib, engine } = libWithHeap();
    // strdup reads from a region the engine can see, so write the source into
    // a mapped guest region and pass its address.
    const SRC = 0x9000;
    engine.mapMemory(SRC, 16);
    engine.writeCode(SRC, ASCII('key\0'));
    const ctxRead = (addr: number, len: number): Uint8Array => engine.readMemory(addr, len);
    const ctxWrite = (addr: number, b: Uint8Array): void => engine.writeCode(addr, b);
    const x = [BigInt(SRC)];
    while (x.length < 31) x.push(0n);
    const ptr = Number(
      lib.get('strdup')!({
        x: (i) => x[i] ?? 0n,
        setX: () => {},
        setD: () => undefined,
        read: ctxRead,
        write: ctxWrite,
      }),
    );
    expect(ptr).toBeGreaterThan(0);
    expect([...engine.readMemory(ptr, 4)]).toEqual([0x6b, 0x65, 0x79, 0]); // "key\0"
  });
});

describe('bionic extended — memmove / memcmp', () => {
  it('memmove handles overlapping forward ranges correctly', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(64);
    mem.set([1, 2, 3, 4], 4);
    // memmove(dst=6, src=4, n=4) — overlapping; must not corrupt mid-copy.
    lib.get('memmove')!(makeCtx(mem, [6n, 4n, 4n]));
    expect([...mem.subarray(6, 10)]).toEqual([1, 2, 3, 4]);
  });

  it('memcmp returns 0 for equal ranges, sign for the first difference', () => {
    const { lib } = libWithHeap();
    const mem = new Uint8Array(32);
    mem.set([1, 2, 3], 0);
    mem.set([1, 2, 4], 8);
    expect(Number(lib.get('memcmp')!(makeCtx(mem, [0n, 8n, 3n])))).toBeLessThan(0);
    mem.set([1, 2, 3], 8);
    expect(Number(lib.get('memcmp')!(makeCtx(mem, [0n, 8n, 3n])))).toBe(0);
  });
});

describe('bionic extended — calloc / realloc', () => {
  it('calloc returns zeroed memory', () => {
    const { lib, engine } = libWithHeap();
    const ptr = Number(lib.get('calloc')!(makeCtxEngine(engine, [4n, 4n])));
    expect(ptr).toBeGreaterThan(0);
    expect([...engine.readMemory(ptr, 16)]).toEqual(Array(16).fill(0));
  });

  it('realloc copies the old contents into the larger block', () => {
    const { lib, engine } = libWithHeap();
    const oldPtr = Number(lib.get('malloc')!(makeCtxEngine(engine, [4n])));
    engine.writeCode(oldPtr, Uint8Array.of(9, 8, 7, 6));
    const newPtr = Number(lib.get('realloc')!(makeCtxEngine(engine, [BigInt(oldPtr), 8n])));
    expect(newPtr).toBeGreaterThan(0);
    expect([...engine.readMemory(newPtr, 4)]).toEqual([9, 8, 7, 6]);
  });
});

/** HostContext backed by a real engine's memory (for heap-allocating libc fns). */
function makeCtxEngine(engine: CpuEngine, regs: bigint[]): HostContext {
  const x = [...regs];
  while (x.length < 31) x.push(0n);
  return {
    x: (i) => x[i] ?? 0n,
    setX: (i, v) => {
      x[i] = v;
    },
    setD: () => undefined,
    read: (addr, len) => engine.readMemory(addr, len),
    write: (addr, bytes) => engine.writeCode(addr, bytes),
  };
}
