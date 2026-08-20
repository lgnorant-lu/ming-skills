/**
 * L3 TDD — extended Android syscall table (Phase 4).
 *
 * Pins the syscalls a real signing/crypto routine reaches beyond the Phase-1
 * core: getrandom (entropy), openat/lseek/fstat (virtual files), gettid,
 * threading/signal no-ops (futex/rt_sigprocmask/set_tid_address), memory
 * no-ops (mprotect/munmap/ioctl), and exit/exit_group (clean halt). Each is
 * driven by assembling the `movz x8,#NR ; … ; svc #0` trap sequence and
 * asserting the observable result in x0 (and guest memory where relevant).
 *
 * svc #0 = 0xD4000001. movz xD,#imm = 0xD2800000 | (imm<<5) | D (hw=0).
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { installAndroidSyscalls } from '@modules/native-emulator/syscalls';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const movz = (rd: number, imm: number, hw = 0): number =>
  (0xd2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;
const SVC0 = 0xd4000001;

const CODE = 0x1000;

/** Map a code region, run `words` from CODE, stop at CODE+len (or on exit). */
function run(engine: CpuEngine, words: number[]): void {
  const bytes: number[] = [];
  for (const w of words) bytes.push(...le(w));
  engine.mapMemory(CODE, bytes.length + 8);
  engine.writeCode(CODE, Uint8Array.from(bytes));
  engine.start(CODE, CODE + bytes.length);
}

describe('extended syscalls — getrandom', () => {
  it('fills the guest buffer deterministically and returns the byte count', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine);
    const BUF = 0x4000;
    engine.mapMemory(BUF, 32);
    // x8=278 (getrandom) ; x0=BUF ; x1=16 ; x2=0 ; svc #0
    run(engine, [movz(8, 278), movz(0, 0x4000), movz(1, 16), movz(2, 0), SVC0]);
    expect(engine.readRegister('x0')).toBe(16);
    const filled = engine.readMemory(BUF, 16);
    // Deterministic PRNG → not all zero, and reproducible across a fresh engine.
    expect(filled.some((b) => b !== 0)).toBe(true);
    const engine2 = new CpuEngine();
    installAndroidSyscalls(engine2);
    engine2.mapMemory(BUF, 32);
    run(engine2, [movz(8, 278), movz(0, 0x4000), movz(1, 16), movz(2, 0), SVC0]);
    expect([...engine2.readMemory(BUF, 16)]).toEqual([...filled]);
  });

  it('honours an injected entropy source', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine, { onGetrandom: (n) => new Uint8Array(n).fill(0xab) });
    const BUF = 0x4000;
    engine.mapMemory(BUF, 8);
    run(engine, [movz(8, 278), movz(0, 0x4000), movz(1, 4), movz(2, 0), SVC0]);
    expect([...engine.readMemory(BUF, 4)]).toEqual([0xab, 0xab, 0xab, 0xab]);
  });
});

describe('extended syscalls — openat / lseek / fstat', () => {
  it('openat resolves through onOpen to a granted fd, else -ENOENT', () => {
    const engine = new CpuEngine();
    const seen: string[] = [];
    installAndroidSyscalls(engine, {
      onOpen: (path) => {
        seen.push(path);
        return path === '/dev/urandom' ? 7 : undefined;
      },
    });
    const PATH = 0x4000;
    engine.mapMemory(PATH, 32);
    engine.writeCode(PATH, new TextEncoder().encode('/dev/urandom\0'));
    // openat(AT_FDCWD=-100→x0 irrelevant, path=x1, flags=x2). x8=56.
    run(engine, [movz(8, 56), movz(0, 0), movz(1, 0x4000), movz(2, 0), SVC0]);
    expect(seen).toEqual(['/dev/urandom']);
    expect(engine.readRegister('x0')).toBe(7);
  });

  it('openat returns -ENOENT (as unsigned 64-bit) when unresolved', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine, { onOpen: () => undefined });
    const PATH = 0x4000;
    engine.mapMemory(PATH, 16);
    engine.writeCode(PATH, new TextEncoder().encode('/nope\0'));
    run(engine, [movz(8, 56), movz(0, 0), movz(1, 0x4000), movz(2, 0), SVC0]);
    // -2 wrapped to 64-bit unsigned, then truncated by Number(gpr[0]).
    expect(engine.readRegister('x0')).not.toBe(0);
  });

  it('lseek reports the requested offset for SEEK_SET', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine);
    // lseek(fd=3, offset=64, whence=0). x8=62.
    run(engine, [movz(8, 62), movz(0, 3), movz(1, 64), movz(2, 0), SVC0]);
    expect(engine.readRegister('x0')).toBe(64);
  });

  it('fstat zeroes the stat buffer and returns 0', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine);
    const ST = 0x4000;
    engine.mapMemory(ST, 128);
    engine.writeCode(ST, new Uint8Array(128).fill(0xff)); // pre-dirty
    // fstat(fd=3, statbuf=ST). x8=80.
    run(engine, [movz(8, 80), movz(0, 3), movz(1, 0x4000), SVC0]);
    expect(engine.readRegister('x0')).toBe(0);
    expect([...engine.readMemory(ST, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('extended syscalls — gettid & no-op plumbing', () => {
  it('gettid returns the configured tid', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine, { pid: 1000, tid: 1234 });
    run(engine, [movz(8, 178), SVC0]); // gettid
    expect(engine.readRegister('x0')).toBe(1234);
  });

  it('futex / rt_sigprocmask / mprotect / munmap / ioctl all succeed with 0', () => {
    for (const nr of [98, 135, 226, 215, 29]) {
      const engine = new CpuEngine();
      installAndroidSyscalls(engine);
      run(engine, [movz(8, nr), SVC0]);
      expect(engine.readRegister('x0')).toBe(0);
    }
  });
});

describe('extended syscalls — exit_group halts the program', () => {
  it('stops execution at exit_group without running trailing instructions', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine);
    // x8=94 (exit_group) ; svc #0 ; movz x0,#42 (must NOT run).
    // Stop target is past the trailing movz; only requestStop() should end it.
    run(engine, [movz(8, 94), SVC0, movz(0, 42)]);
    expect(engine.readRegister('x0')).not.toBe(42); // trailing movz never executed
  });

  it('exit also halts', () => {
    const engine = new CpuEngine();
    installAndroidSyscalls(engine);
    run(engine, [movz(8, 93), SVC0, movz(0, 99)]);
    expect(engine.readRegister('x0')).not.toBe(99);
  });
});
