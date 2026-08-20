/**
 * bionic stdio + logging stubs — the virtual-file-system layer that lets the
 * emulator answer "does this file exist?" the way anti-tamper code (RootBeer's
 * exists()/fopen, Frida path probes) asks. Drives the name→HostFunction map
 * directly with a flat-memory HostContext, mirroring bionic-extended.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { createBionicLibrary, type BionicOptions } from '@modules/native-emulator/bionic';
import type { HostContext } from '@modules/native-emulator/CpuEngine';

/** A flat-memory HostContext: x-registers in an array, bytes in one buffer. */
function makeCtx(mem: Uint8Array, regs: Array<bigint | number | void> = []): HostContext {
  const x = regs.map((r) => (typeof r === 'bigint' ? r : BigInt(r ?? 0)));
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

const ASCII = (s: string): Uint8Array => new TextEncoder().encode(s);

function readMemCString(mem: Uint8Array, addr: number): string {
  let end = addr;
  while (end < mem.length && mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.subarray(addr, end));
}

function libWith(options: BionicOptions = {}): ReturnType<typeof createBionicLibrary> {
  return createBionicLibrary(new CpuEngine(), options);
}

describe('bionic fopen — virtual file system', () => {
  it('returns a non-NULL FILE* for a path present in the VFS', () => {
    const files = new Map([['/system/bin/su', ASCII('placeholder')]]);
    const lib = libWith({ files });
    const mem = new Uint8Array(256);
    mem.set(ASCII('/system/bin/su\0'), 8); // path at 8 (addr 0 is NULL)
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    expect(Number(handle)).toBeGreaterThan(0);
  });

  it('returns NULL (0) for a path absent from the VFS — a clean device', () => {
    const lib = libWith({ files: new Map() });
    const mem = new Uint8Array(256);
    mem.set(ASCII('/system/bin/su\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    expect(Number(handle)).toBe(0);
  });

  it('returns NULL when no VFS is configured at all', () => {
    const lib = libWith();
    const mem = new Uint8Array(256);
    mem.set(ASCII('/sbin/su\0'), 8);
    expect(Number(lib.get('fopen')!(makeCtx(mem, [8n, 0n])))).toBe(0);
  });

  it('hands out distinct FILE* handles for repeated opens', () => {
    const files = new Map([['/a', ASCII('x')]]);
    const lib = libWith({ files });
    const mem = new Uint8Array(64);
    mem.set(ASCII('/a\0'), 8);
    const h1 = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    const h2 = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    expect(Number(h1)).toBeGreaterThan(0);
    expect(Number(h2)).toBeGreaterThan(0);
    expect(Number(h1)).not.toBe(Number(h2));
  });
});

describe('bionic fread / feof / fclose', () => {
  it('reads file contents into guest memory and reports nmemb read', () => {
    const files = new Map([['/etc/data', ASCII('ABCDEFGH')]]);
    const lib = libWith({ files });
    const mem = new Uint8Array(256);
    mem.set(ASCII('/etc/data\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));

    // fread(dst=64, size=1, nmemb=8, FILE*)
    const dst = 64;
    const n = lib.get('fread')!(makeCtx(mem, [BigInt(dst), 1n, 8n, handle]));
    expect(Number(n)).toBe(8);
    expect([...mem.subarray(dst, dst + 8)]).toEqual([...ASCII('ABCDEFGH')]);
  });

  it('advances the cursor across successive reads and signals feof', () => {
    const files = new Map([['/f', ASCII('XYZ')]]);
    const lib = libWith({ files });
    const mem = new Uint8Array(64);
    mem.set(ASCII('/f\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));

    expect(Number(lib.get('feof')!(makeCtx(mem, [handle])))).toBe(0);
    lib.get('fread')!(makeCtx(mem, [16n, 1n, 2n, handle])); // read "XY"
    expect([...mem.subarray(16, 18)]).toEqual([...ASCII('XY')]);
    lib.get('fread')!(makeCtx(mem, [20n, 1n, 2n, handle])); // read "Z" (only 1 left)
    expect(mem[20]).toBe('Z'.charCodeAt(0));
    expect(Number(lib.get('feof')!(makeCtx(mem, [handle])))).toBe(1);
  });

  it('fread on a closed/unknown handle returns 0', () => {
    const lib = libWith({ files: new Map([['/f', ASCII('x')]]) });
    const mem = new Uint8Array(64);
    mem.set(ASCII('/f\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    expect(Number(lib.get('fclose')!(makeCtx(mem, [handle])))).toBe(0);
    // After close the stream is gone → fread reads nothing.
    expect(Number(lib.get('fread')!(makeCtx(mem, [16n, 1n, 4n, handle])))).toBe(0);
  });

  it('fread with size 0 reads nothing', () => {
    const lib = libWith({ files: new Map([['/f', ASCII('abc')]]) });
    const mem = new Uint8Array(64);
    mem.set(ASCII('/f\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    expect(Number(lib.get('fread')!(makeCtx(mem, [16n, 0n, 4n, handle])))).toBe(0);
  });
});

describe('bionic fgets', () => {
  it('reads one newline-terminated line, NUL-terminated', () => {
    const files = new Map([['/log', ASCII('line1\nline2\n')]]);
    const lib = libWith({ files });
    const mem = new Uint8Array(256);
    mem.set(ASCII('/log\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));

    const buf = 64;
    const r = lib.get('fgets')!(makeCtx(mem, [BigInt(buf), 64n, handle]));
    expect(Number(r)).toBe(buf);
    // "line1\n" + NUL
    expect([...mem.subarray(buf, buf + 7)]).toEqual([...ASCII('line1\n'), 0]);
  });

  it('returns NULL at end of file', () => {
    const lib = libWith({ files: new Map([['/log', ASCII('only')]]) });
    const mem = new Uint8Array(64);
    mem.set(ASCII('/log\0'), 8);
    const handle = lib.get('fopen')!(makeCtx(mem, [8n, 0n]));
    lib.get('fgets')!(makeCtx(mem, [16n, 32n, handle])); // consumes "only"
    expect(Number(lib.get('fgets')!(makeCtx(mem, [16n, 32n, handle])))).toBe(0);
  });
});

describe('bionic __android_log_print', () => {
  it('forwards priority, tag, and message to the onLog sink', () => {
    const onLog = vi.fn();
    const lib = libWith({ onLog });
    const mem = new Uint8Array(256);
    mem.set(ASCII('RootBeer\0'), 8); // tag at 8
    mem.set(ASCII('checking su\0'), 32); // fmt at 32
    lib.get('__android_log_print')!(makeCtx(mem, [3n, 8n, 32n]));
    expect(onLog).toHaveBeenCalledWith(3, 'RootBeer', 'checking su');
  });

  it('is a no-op (returns 1) when no sink is configured', () => {
    const lib = libWith();
    const mem = new Uint8Array(64);
    mem.set(ASCII('T\0'), 8);
    mem.set(ASCII('M\0'), 16);
    expect(Number(lib.get('__android_log_print')!(makeCtx(mem, [4n, 8n, 16n])))).toBe(1);
  });
});

describe('bionic C++ runtime hooks', () => {
  it('__cxa_atexit returns 0 and __cxa_finalize is a no-op', () => {
    const lib = libWith();
    const mem = new Uint8Array(16);
    expect(Number(lib.get('__cxa_atexit')!(makeCtx(mem, [0n, 0n, 0n])))).toBe(0);
    expect(lib.get('__cxa_finalize')!(makeCtx(mem, [0n]))).toBeUndefined();
  });
});

describe('bionic generic stdio stubs', () => {
  it('formats printf/puts/fprintf output and forwards it to configured sinks', () => {
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const lib = libWith({ onStdout, onStderr });
    const mem = new Uint8Array(256);
    mem.set(ASCII('hello\0'), 8);
    mem.set(ASCII('pid=%d tag=%s hex=%x ptr=%p %%\0'), 32);
    mem.set(ASCII('err=%s\0'), 96);

    const formatted = 'pid=123 tag=hello hex=ab ptr=0xfeed %';
    expect(Number(lib.get('printf')!(makeCtx(mem, [32n, 123n, 8n, 0xabn, 0xfeedn])))).toBe(
      formatted.length,
    );
    expect(onStdout).toHaveBeenCalledWith(formatted);

    expect(Number(lib.get('puts')!(makeCtx(mem, [8n])))).toBe('hello\n'.length);
    expect(onStdout).toHaveBeenCalledWith('hello\n');

    expect(Number(lib.get('fprintf')!(makeCtx(mem, [2n, 96n, 8n])))).toBe('err=hello'.length);
    expect(onStderr).toHaveBeenCalledWith('err=hello');

    expect(Number(lib.get('putchar')!(makeCtx(mem, [0x41n])))).toBe(0x41);
    expect(Number(lib.get('getchar')!(makeCtx(mem)))).toBe(-1);
  });

  it('formats sprintf/snprintf buffers with C-style return and truncation semantics', () => {
    const lib = libWith();
    const mem = new Uint8Array(192).fill(0x41);
    mem.set(ASCII('value=%d-%s\0'), 32);
    mem.set(ASCII('abcdef\0'), 64);

    const full = 'value=7-abcdef';
    expect(Number(lib.get('sprintf')!(makeCtx(mem, [16n, 32n, 7n, 64n])))).toBe(full.length);
    expect(readMemCString(mem, 16)).toBe(full);

    mem.fill(0x41);
    mem.set(ASCII('value=%d-%s\0'), 32);
    mem.set(ASCII('abcdef\0'), 64);
    expect(Number(lib.get('snprintf')!(makeCtx(mem, [96n, 8n, 32n, 7n, 64n])))).toBe(full.length);
    expect(readMemCString(mem, 96)).toBe('value=7');

    mem.fill(0x41);
    mem.set(ASCII('value=%d-%s\0'), 32);
    mem.set(ASCII('abcdef\0'), 64);
    expect(Number(lib.get('snprintf')!(makeCtx(mem, [96n, 0n, 32n, 7n, 64n])))).toBe(full.length);
    expect(mem[96]).toBe(0x41);
  });
});

describe('bionic Android runtime/import stubs', () => {
  it('models common process and memory-management imports as deterministic no-ops', () => {
    const lib = libWith();
    const mem = new Uint8Array(64);
    expect(Number(lib.get('getpagesize')!(makeCtx(mem)))).toBe(4096);
    expect(Number(lib.get('sysconf')!(makeCtx(mem, [30n])))).toBe(4096);
    expect(Number(lib.get('sysconf')!(makeCtx(mem, [84n])))).toBe(1);
    expect(Number(lib.get('mprotect')!(makeCtx(mem, [0x1000n, 0x1000n, 7n])))).toBe(0);
    expect(Number(lib.get('munmap')!(makeCtx(mem, [0x1000n, 0x1000n])))).toBe(0);
    expect(Number(lib.get('prctl')!(makeCtx(mem, [0n, 0n, 0n, 0n, 0n])))).toBe(0);
    expect(Number(lib.get('getpid')!(makeCtx(mem)))).toBeGreaterThan(0);
    expect(Number(lib.get('getuid')!(makeCtx(mem)))).toBeGreaterThan(0);
  });

  it('models sleep/usleep as immediate successful completion', () => {
    const lib = libWith();
    const mem = new Uint8Array(16);
    expect(Number(lib.get('sleep')!(makeCtx(mem, [10n])))).toBe(0);
    expect(Number(lib.get('usleep')!(makeCtx(mem, [10_000n])))).toBe(0);
  });

  it('models dlopen/dlsym/dlerror as a closed deterministic dynamic linker', () => {
    const lib = libWith();
    const mem = new Uint8Array(128);
    mem.set(ASCII('libc.so\0'), 8);
    mem.set(ASCII('puts\0'), 32);
    const handle = Number(lib.get('dlopen')!(makeCtx(mem, [8n, 0n])));
    expect(handle).toBeGreaterThan(0);
    const puts = Number(lib.get('dlsym')!(makeCtx(mem, [BigInt(handle), 32n])));
    expect(puts).toBeGreaterThan(0);
    expect(Number(lib.get('dlsym')!(makeCtx(mem, [BigInt(handle), 32n])))).toBe(puts);
    expect(Number(lib.get('dlerror')!(makeCtx(mem)))).toBe(0);
  });

  it('dlsym resolves current-library exports before bionic stubs', () => {
    const mapper = {
      mapMemory: vi.fn(),
      lookupSymbol: (name: string) => (name === 'target_export' ? 0x123456 : undefined),
      bindImportStub: vi.fn(),
      callGuestFunction: vi.fn(),
    };
    const lib = createBionicLibrary(mapper);
    const mem = new Uint8Array(256);
    mem.set(ASCII('target_export\0'), 32);
    expect(Number(lib.get('dlsym')!(makeCtx(mem, [0n, 32n])))).toBe(0x123456);
    expect(mapper.bindImportStub).not.toHaveBeenCalled();
  });

  it.skip('dlerror returns and clears the last dynamic-linker error', () => {
    const lib = libWith();
    const mem = new Uint8Array(0x102000);
    mem.set(ASCII('missing_symbol\0'), 32);
    expect(Number(lib.get('dlsym')!(makeCtx(mem, [0n, 32n])))).toBe(0);
    const errPtr = Number(lib.get('dlerror')!(makeCtx(mem)));
    expect(errPtr).toBeGreaterThan(0);
    expect(readMemCString(mem, errPtr)).toContain('missing_symbol');
    expect(Number(lib.get('dlerror')!(makeCtx(mem)))).toBe(0);
  });
});
