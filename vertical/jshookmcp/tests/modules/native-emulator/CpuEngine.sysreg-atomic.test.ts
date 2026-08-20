/**
 * L1 TDD — system-register read (MRS TPIDR_EL0) + exclusive load-store
 * (LDXR/STXR), the two integer-domain instructions a real-`.so` probe flagged
 * as high-frequency blockers in modern compiler output:
 *   - `MRS Xt, TPIDR_EL0` (0xD53BD0xx): stack-protector / TLS prologues read the
 *     thread pointer to fetch `__stack_chk_guard`. We return a lazily-mapped TLS
 *     block carrying a fixed canary at +0x28.
 *   - `LDXR/STXR` (0x885F7C0x / 0x88027C0x): the single-threaded emulator can
 *     never have an exclusive pair broken, so a load reads normally and a store
 *     always succeeds, reporting status 0 in Rs.
 *
 * Encodings are assembler-verified:
 *   MRS x0,TPIDR_EL0      = 0xD53BD040   (S3_3_C13_C0_2, read)
 *   LDR W1,[X0,#0x28]     = 0xB9402801   (32-bit unsigned offset, imm12=10)
 *   LDXR W1,[X0]          = 0x885F7C01
 *   STXR W2,W3,[X0]       = 0x88027C03   (Ws=W2 status, Wt=W3 value)
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const movz = (rd: number, imm: number, hw = 0): number =>
  (0xd2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;

const CODE = 0x1000;

function run(engine: CpuEngine, words: number[]): void {
  const bytes: number[] = [];
  for (const w of words) bytes.push(...le(w));
  engine.mapMemory(CODE, bytes.length + 8);
  engine.writeCode(CODE, Uint8Array.from(bytes));
  engine.start(CODE, CODE + bytes.length);
}

describe('CpuEngine — MRS TPIDR_EL0', () => {
  it('returns a non-zero thread-pointer block base', () => {
    const engine = new CpuEngine();
    // MRS x0, TPIDR_EL0
    run(engine, [0xd53bd040]);
    // TLS block is lazily mapped at 0x70000000 (a safe-integer address).
    expect(engine.readRegister('x0')).toBe(0x7000_0000);
  });

  it('reads the planted stack canary at TPIDR_EL0+0x28', () => {
    const engine = new CpuEngine();
    // MRS x0, TPIDR_EL0 ; LDR W1, [X0, #0x28]
    run(engine, [0xd53bd040, 0xb9402801]);
    // Canary bytes [0x00,0x11,0x22,0x33,...] → low word LE = 0x33221100.
    expect(engine.readRegister('x1')).toBe(0x3322_1100);
  });

  it('reads other system registers as 0 (minimal model)', () => {
    const engine = new CpuEngine();
    // MRS x5, MIDR_EL1 (S3_0_C0_C0_0) = 0xD5380005 — not TPIDR_EL0.
    run(engine, [0xd5380005]);
    expect(engine.readRegister('x5')).toBe(0);
  });
});

describe('CpuEngine — memory barriers (DMB/DSB/ISB)', () => {
  // A single-threaded, in-order interpreter sees no effect from a barrier, so
  // each must execute as a no-op: not fault, not touch registers, advance the PC.
  // Real libc/SQLite fences around lock-free sequences (sqlite3_open hit DMB ISH
  // in the probe), so an honest "unsupported opcode" here would stop real code.
  const barriers: Array<[string, number]> = [
    ['DMB ISH', 0xd5033bbf],
    ['DMB SY', 0xd5033fbf],
    ['DMB ISHST', 0xd50339bf],
    ['DSB ISH', 0xd5033b9f],
    ['DSB SY', 0xd5033f9f],
    ['ISB SY', 0xd5033fdf],
  ];

  for (const [name, word] of barriers) {
    it(`${name} executes as a no-op without faulting`, () => {
      const engine = new CpuEngine();
      // movz x0,#0x1234 ; <barrier> ; movz x1,#0x5678 — the barrier must not
      // disturb the surrounding moves nor stop execution.
      expect(() => run(engine, [movz(0, 0x1234), word, movz(1, 0x5678)])).not.toThrow();
      expect(engine.readRegister('x0')).toBe(0x1234);
      expect(engine.readRegister('x1')).toBe(0x5678);
    });
  }
});

describe('CpuEngine — exclusive load-store (LDXR/STXR)', () => {
  it('LDXR reads the word at [Xn] normally', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 16);
    engine.writeCode(DATA, Uint8Array.from(le(0x1122_3344)));
    // movz x0,#0x4000 ; LDXR W1,[X0]
    run(engine, [movz(0, 0x4000), 0x885f7c01]);
    expect(engine.readRegister('x1')).toBe(0x1122_3344);
  });

  it('STXR stores the value and reports success (status 0) in Rs', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 16);
    engine.writeCode(DATA, Uint8Array.from(le(0x1122_3344)));
    // movz x0,#0x4000 ; movz x3,#0x5678 ; STXR W2,W3,[X0]
    run(engine, [movz(0, 0x4000), movz(3, 0x5678), 0x88027c03]);
    // Store succeeded: status register x2 = 0.
    expect(engine.readRegister('x2')).toBe(0);
    // The 32-bit value 0x00005678 was written little-endian at DATA.
    expect([...engine.readMemory(DATA, 4)]).toEqual([0x78, 0x56, 0, 0]);
  });

  it('v8.1 CAS is not silently executed as a plain exclusive load', () => {
    // CAS X3,X5,[X9] = 0xC8A3FD25 — the v8.1 atomic family (CAS/CASP/LDADD/SWP)
    // sets o2 (bit23) and o1 (bit21), which the plain-exclusive prefix shares.
    // The interpreter does not model compare-and-swap, so the instruction must
    // fall through to the NOP catch-all rather than run as an LDXR/STXR (which
    // would clobber Rs and read memory under load semantics).
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 16);
    engine.writeCode(DATA, Uint8Array.from(le(0x1122_3344)));
    // movz x9,#0x4000 ; movz x3,#0xaaaa ; movz x5,#0xbbbb ; CAS X3,X5,[X9]
    run(engine, [movz(9, 0x4000), movz(3, 0xaaaa), movz(5, 0xbbbb), 0xc8a3fd25]);
    // NOP semantics: Rs, the register pair, and memory all stay untouched.
    expect(engine.readRegister('x3')).toBe(0xaaaa);
    expect(engine.readRegister('x5')).toBe(0xbbbb);
    expect([...engine.readMemory(DATA, 4)]).toEqual([0x44, 0x33, 0x22, 0x11]);
  });

  it('an LDXR/STXR pair round-trips a value through memory', () => {
    const engine = new CpuEngine();
    const DATA = 0x4000;
    engine.mapMemory(DATA, 16);
    engine.writeCode(DATA, Uint8Array.from(le(0x0000_00ff)));
    // movz x0,#0x4000 ; LDXR W1,[X0] ; STXR W2,W1,[X0]  (store the value just loaded)
    const stxrW1 = 0x88027c03 & ~0b11111; // clear Rt
    run(engine, [movz(0, 0x4000), 0x885f7c01, (stxrW1 | 1) >>> 0]);
    expect(engine.readRegister('x1')).toBe(0xff);
    expect(engine.readRegister('x2')).toBe(0);
    expect([...engine.readMemory(DATA, 4)]).toEqual([0xff, 0, 0, 0]);
  });
});
