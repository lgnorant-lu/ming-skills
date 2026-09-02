/**
 * Unit tests for the native-emulator trace row formatter (handler-trace.ts).
 *
 * Covers the three enhancements ported from upstream unidbg trace work:
 *  - LDP/STP pair memory-access annotation (both accesses, not just one)
 *  - SVC #0 semantic syscall annotation (name + arg registers)
 *  - Disassembly caching across a trace (one disasm per unique PC)
 *
 * These are pure-function tests over a mock TraceEvent — they don't spin up a
 * CpuEngine or session, so they run in milliseconds and isolate the formatter
 * from the emulator.
 */
import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import {
  createTraceRowContext,
  traceFilterMatch,
  traceRow,
} from '@server/domains/native-emulator/handler-trace';

/** Build a minimal TraceEvent backed by a fixed register file. */
function mockEvent(
  pc: number,
  insn: number,
  step: number,
  regs: Record<number, bigint> = {},
): TraceEvent {
  const readX = (i: number): bigint => regs[i] ?? 0n;
  return {
    pc,
    insn,
    step,
    x: readX,
    reg: (name: string) => {
      const m = /^x(\d+)$/.exec(name);
      if (m) return Number(readX(Number(m[1])));
      if (name === 'pc') return pc;
      if (name === 'sp') return Number(regs[31] ?? 0n);
      return 0;
    },
    vector: () => '00000000000000000000000000000000',
  };
}

/** A TraceEvent whose x() always throws — simulates a register-read fault path. */
function throwingEvent(pc: number, insn: number, step: number): TraceEvent {
  const boom = (): bigint => {
    throw new Error('register read fault');
  };
  return {
    pc,
    insn,
    step,
    x: boom,
    reg: () => {
      throw new Error('register read fault');
    },
    vector: () => '00000000000000000000000000000000',
  };
}

// ── Instruction encodings (ARM64 32-bit words, little-endian value) ──────────
// Encodings verified by field-decomposition; built with the standard
// AArch64 fixed-field layout so the assertions exercise the real bit paths.
/** LDP x0, x1, [x2, #0x10] — opc=11 (LDP64), idx=10 (offset), imm7=2 → 0x10 bytes. */
const LDP_X0_X1_X2_OFF16 = 0xe9410440;
/** STP x0, x1, [x2, #0x10] — opc=10 (STP64), L=0. */
const STP_X0_X1_X2_OFF16 = 0xa9010440;
/** LDR x0, [x1, #0x8] — size=3 (x), form=01 (unsigned imm), imm12=1 → 0x8 offset. */
const LDR_X0_X1_OFF8 = 0xf9400420;
/** SVC #0 — the canonical AArch64 syscall trap. */
const SVC_0 = 0xd4000001;
/** RET. */
const RET = 0xd65f03c0;

describe('handler-trace — memAccess (LDP/STP pair annotation)', () => {
  it('emits BOTH accesses for an LDP pair instruction', () => {
    // x2 = 0x4000; LDP x0,x1,[x2,#0x10] → accesses 0x4010 and 0x4018.
    const ev = mockEvent(0x1000, LDP_X0_X1_X2_OFF16, 1, { 2: 0x4000n });
    const row = traceRow(ev, []);
    const mem = row.memory as Array<Record<string, unknown>>;
    expect(Array.isArray(mem)).toBe(true);
    expect(mem).toHaveLength(2);
    expect(mem[0]!.load).toBe(true);
    expect(mem[0]!.addr).toBe('0x4010');
    expect(mem[0]!.reg).toBe('x0');
    expect(mem[0]!.size).toBe(8);
    expect(mem[1]!.addr).toBe('0x4018');
    expect(mem[1]!.reg).toBe('x1');
    expect(mem[1]!.load).toBe(true);
  });

  it('emits BOTH accesses for an STP pair instruction (load:false)', () => {
    const ev = mockEvent(0x1000, STP_X0_X1_X2_OFF16, 1, { 2: 0x4000n });
    const row = traceRow(ev, []);
    const mem = row.memory as Array<Record<string, unknown>>;
    expect(mem).toHaveLength(2);
    expect(mem[0]!.load).toBe(false);
    expect(mem[1]!.load).toBe(false);
  });

  it('wraps single-register LDR/STR into a one-element array (back-compat shape)', () => {
    const ev = mockEvent(0x1000, LDR_X0_X1_OFF8, 1, { 1: 0x2000n });
    const row = traceRow(ev, []);
    const mem = row.memory as Array<Record<string, unknown>>;
    expect(Array.isArray(mem)).toBe(true);
    expect(mem).toHaveLength(1);
    expect(mem[0]!.addr).toBe('0x2008');
  });

  it('respects tableReg: a pair using a different base is skipped', () => {
    // base is x2, tableReg=x9 → no annotation (returns no memory field).
    const ev = mockEvent(0x1000, LDP_X0_X1_X2_OFF16, 1, { 2: 0x4000n });
    const row = traceRow(ev, [], 'full', 9);
    expect(row.memory).toBeUndefined();
  });

  it('post-index LDP: accesses at bare base + base+bytes, offset labels reflect that', () => {
    // LDP x0, x1, [x2], #0x10 — post-index: access at base (0x4000) and base+8
    // (0x4008); the imm7=0x10 is the writeback amount, NOT the access offset.
    const POST_LDP = 0xe8c10440;
    const ev = mockEvent(0x1000, POST_LDP, 1, { 2: 0x4000n });
    const row = traceRow(ev, []);
    const mem = row.memory as Array<Record<string, unknown>>;
    expect(mem).toHaveLength(2);
    // First access at the bare base; offset label '+0' (not +0x10).
    expect(mem[0]!.addr).toBe('0x4000');
    expect(mem[0]!.offset).toBe('+0');
    // Second access at base+bytes (8); offset label '+0x8' (not +0x18).
    expect(mem[1]!.addr).toBe('0x4008');
    expect(mem[1]!.offset).toBe('+0x8');
  });
});

describe('handler-trace — svcAnnotation (SVC semantic annotation)', () => {
  it('annotates svc write(fd, buf, count) reading x8=64 (NR_write)', () => {
    const ev = mockEvent(0x2000, SVC_0, 5, { 8: 64n, 0: 1n, 1: 0x401000n, 2: 12n });
    const row = traceRow(ev, []);
    expect(row.svc).toBe('write(fd=0x1, buf=0x401000, count=0xc)');
  });

  it('annotates svc getpid() with no args', () => {
    const ev = mockEvent(0x2000, SVC_0, 5, { 8: 172n });
    const row = traceRow(ev, []);
    expect(row.svc).toBe('getpid()');
  });

  it('omits svc field for a non-SVC instruction', () => {
    const ev = mockEvent(0x2000, RET, 5);
    const row = traceRow(ev, []);
    expect(row.svc).toBeUndefined();
  });

  it('omits svc field for an SVC with an unimplemented syscall number', () => {
    // x8 = 9999 — not in SYSCALL_NAMES.
    const ev = mockEvent(0x2000, SVC_0, 5, { 8: 9999n });
    const row = traceRow(ev, []);
    expect(row.svc).toBeUndefined();
  });

  it('omits svc field when x8 read throws (defensive — register read fault)', () => {
    // svcAnnotation reads x8 for the syscall number; if that faults it returns
    // null rather than propagating, so a flaky register path never corrupts the row.
    const ev = throwingEvent(0x2000, SVC_0, 5);
    const row = traceRow(ev, []);
    expect(row.svc).toBeUndefined();
  });

  it('renders "?" for an SVC arg whose register read throws', () => {
    // An SVC whose syscall number resolves (x8=64 write) but whose arg register
    // read throws — the per-arg try/catch substitutes '?' instead of failing the row.
    const ev = throwingEvent(0x2000, SVC_0, 5);
    // Override x8 so the syscall number is found but args x0/x1/x2 throw.
    const evWithX8: TraceEvent = {
      ...ev,
      x: (i: number) =>
        i === 8
          ? 64n
          : (() => {
              throw new Error('fault');
            })(),
    };
    const row = traceRow(evWithX8, []);
    expect(row.svc).toBe('write(fd=?, buf=?, count=?)');
  });
});

describe('handler-trace — disassembly caching (TraceRowContext)', () => {
  it('disassembles once per unique (pc, insn) across repeated hits', () => {
    const ctx = createTraceRowContext();
    // Same PC + insn hit 1000 times (a tight dispatch loop).
    for (let i = 0; i < 1000; i++) {
      traceRow(mockEvent(0x3000, RET, i + 1), [], 'full', undefined, false, ctx);
    }
    expect(ctx.disasmCache.size).toBe(1);
    // Key format is `${pc}:${insn>>>0}` (decimal), per cacheKey().
    expect(ctx.disasmCache.has(`0x3000:0xd65f03c0`)).toBe(false);
    expect(ctx.disasmCache.has('12288:3596551104')).toBe(true);
  });

  it('caches distinct mnemonics per unique (pc, insn)', () => {
    const ctx = createTraceRowContext();
    traceRow(mockEvent(0x3000, RET, 1), [], 'full', undefined, false, ctx);
    traceRow(mockEvent(0x3004, LDR_X0_X1_OFF8, 2), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.size).toBe(2);
  });

  it('keys on (pc, insn) so self-modifying code re-disassembles', () => {
    // Same PC, different insn (SMC: code rewritten mid-trace) → must NOT return
    // the stale mnemonic. Two distinct cache entries prove the insn is part of the key.
    const ctx = createTraceRowContext();
    traceRow(mockEvent(0x3000, RET, 1), [], 'full', undefined, false, ctx);
    traceRow(mockEvent(0x3000, LDR_X0_X1_OFF8, 2), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.size).toBe(2);
  });

  it('evicts the oldest entry when the cache exceeds its bound (FIFO)', () => {
    // maxEntries=3: insert 4 distinct PCs, the first is evicted.
    const ctx = createTraceRowContext(3);
    traceRow(mockEvent(0x1000, RET, 1), [], 'full', undefined, false, ctx);
    traceRow(mockEvent(0x1004, RET, 2), [], 'full', undefined, false, ctx);
    traceRow(mockEvent(0x1008, RET, 3), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.size).toBe(3);
    traceRow(mockEvent(0x100c, RET, 4), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.size).toBe(3); // bounded, not 4
    // Oldest (0x1000=4096) evicted; the newest (0x100c=4108) remains.
    expect(ctx.disasmCache.has('4096:3596551104')).toBe(false);
    expect(ctx.disasmCache.has('4108:3596551104')).toBe(true);
  });

  it('re-disassembles an evicted PC on re-hit (cache miss after eviction)', () => {
    const ctx = createTraceRowContext(2);
    traceRow(mockEvent(0x1000, RET, 1), [], 'full', undefined, false, ctx);
    traceRow(mockEvent(0x1004, RET, 2), [], 'full', undefined, false, ctx);
    // 0x1008 evicts 0x1000.
    traceRow(mockEvent(0x1008, RET, 3), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.size).toBe(2);
    expect(ctx.disasmCache.has('4096:3596551104')).toBe(false);
    // Re-hit 0x1000 → re-inserted, size stays 2 (evicts 0x1004).
    traceRow(mockEvent(0x1000, RET, 4), [], 'full', undefined, false, ctx);
    expect(ctx.disasmCache.has('4096:3596551104')).toBe(true);
    expect(ctx.disasmCache.has('4100:3596551104')).toBe(false);
  });

  it('still works without a context (back-compat, uncached path)', () => {
    const row = traceRow(mockEvent(0x3000, RET, 1), []);
    expect(typeof row.asm).toBe('string');
  });
});

describe('handler-trace — captureBlArgs (opcode-based BL detection)', () => {
  it('captures x0-x7 on a BL instruction via opcode, not string parse', () => {
    // BL #0 (offset 0): 0x94000000
    const ev = mockEvent(0x1000, 0x94000000, 1, { 0: 0xaan, 1: 0xbbn });
    const row = traceRow(ev, [], 'full', undefined, true, undefined);
    const args = row.blArgs as Record<string, string>;
    expect(args).toBeDefined();
    expect(args.x0).toBe('0xaa');
    expect(args.x1).toBe('0xbb');
    expect(Object.keys(args)).toHaveLength(8);
  });

  it('does not capture blArgs on a non-BL instruction', () => {
    const ev = mockEvent(0x1000, RET, 1);
    const row = traceRow(ev, [], 'full', undefined, true, undefined);
    expect(row.blArgs).toBeUndefined();
  });

  it('captures blArgs on ARMv8.3 PAC variant BLRAA (not just standard BLR)', () => {
    // BLRAA x0, x1 — 0xD63F0800. Standard BLR mask (0xfffffc1f) excluded this;
    // the widened mask (0xfffff1ff, zeroing bits[11:10]) restores coverage.
    const ev = mockEvent(0x1000, 0xd63f0800, 1, { 0: 0xaan, 1: 0xbbn });
    const row = traceRow(ev, [], 'full', undefined, true, undefined);
    const args = row.blArgs as Record<string, string>;
    expect(args).toBeDefined();
    expect(args.x0).toBe('0xaa');
  });

  it('captures blArgs on BLRAAZ, BLRAB, BLRABZ (all PAC variants)', () => {
    for (const insn of [0xd63f0c00, 0xd63f0a00, 0xd63f0e00]) {
      const ev = mockEvent(0x1000, insn, 1, { 0: 0x11n });
      const row = traceRow(ev, [], 'full', undefined, true, undefined);
      expect(row.blArgs).toBeDefined();
    }
  });

  it('does NOT capture blArgs on BR/RET (non-link branch register)', () => {
    // BR x0 = 0xD61F0000, RET = 0xD65F03C0 — neither sets LR, so not a call.
    for (const insn of [0xd61f0000, 0xd65f03c0]) {
      const ev = mockEvent(0x1000, insn, 1);
      const row = traceRow(ev, [], 'full', undefined, true, undefined);
      expect(row.blArgs).toBeUndefined();
    }
  });
});

describe('handler-trace — traceFilterMatch (unchanged behaviour)', () => {
  it('full mode passes everything', () => {
    expect(traceFilterMatch(RET, 'ret', 'full')).toBe(true);
    expect(traceFilterMatch(LDR_X0_X1_OFF8, 'ldr', 'full')).toBe(true);
  });

  it('memory mode only passes load/store', () => {
    expect(traceFilterMatch(LDR_X0_X1_OFF8, 'ldr', 'memory')).toBe(true);
    expect(traceFilterMatch(RET, 'ret', 'memory')).toBe(false);
  });

  it('branches mode passes B/BL/RET but not LDR', () => {
    expect(traceFilterMatch(RET, 'ret', 'branches')).toBe(true);
    expect(traceFilterMatch(LDR_X0_X1_OFF8, 'ldr', 'branches')).toBe(false);
  });
});
