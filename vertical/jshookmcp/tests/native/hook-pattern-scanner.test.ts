/**
 * E5-B: HookPatternScanner — pure byte-pattern inline-hook classifier unit tests.
 *
 * Verifies the 8 pe-sieve PatchAnalyzer patterns are correctly classified and
 * decoded, and that `scanRangeForHooks` honours the confidence / padding flags.
 * No platform dependency — the scanner is OS-agnostic by design (extracted from
 * PEAnalyzer so it can run on Linux/macOS where there is no PE export table).
 */

import { describe, expect, it } from 'vitest';
import {
  classifyHookPattern,
  decodeHookTarget,
  scanRangeForHooks,
} from '@native/platform/HookPatternScanner';

const U = (bytes: number[]): Uint8Array => Uint8Array.from(bytes);

describe('HookPatternScanner: classifyHookPattern (8 pe-sieve patterns)', () => {
  it('jmp_rel32: E9 disp32', () => {
    expect(classifyHookPattern(U([0xe9, 0x00, 0x10, 0x00, 0x00]))).toBe('jmp_rel32');
  });
  it('call_rel32: E8 disp32', () => {
    expect(classifyHookPattern(U([0xe8, 0xff, 0x0f, 0x00, 0x00]))).toBe('call_rel32');
  });
  it('short_jmp: EB disp8', () => {
    expect(classifyHookPattern(U([0xeb, 0x10]))).toBe('short_jmp');
  });
  it('jmp_abs64: FF 25 ...', () => {
    expect(classifyHookPattern(U([0xff, 0x25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'jmp_abs64',
    );
  });
  it('mov_jmp: B8 imm32 FF E0', () => {
    expect(classifyHookPattern(U([0xb8, 0x78, 0x56, 0x34, 0x12, 0xff, 0xe0]))).toBe('mov_jmp');
  });
  it('mov_call: B8 imm32 FF D0', () => {
    expect(classifyHookPattern(U([0xbf, 0x11, 0x22, 0x33, 0x44, 0xff, 0xd5]))).toBe('mov_call');
  });
  it('push_ret: 68 imm32 C3', () => {
    expect(classifyHookPattern(U([0x68, 0xef, 0xbe, 0xad, 0xde, 0xc3]))).toBe('push_ret');
  });
  it('int3_breakpoint: CC', () => {
    expect(classifyHookPattern(U([0xcc]))).toBe('int3_breakpoint');
  });
  it('padding: NOP sled (all 0x90)', () => {
    expect(classifyHookPattern(U([0x90, 0x90, 0x90, 0x90]))).toBe('padding');
  });
  it('unknown: ordinary instruction (e.g. MOV rax,rbp 48 89 E5)', () => {
    expect(classifyHookPattern(U([0x48, 0x89, 0xe5]))).toBe('unknown');
  });
  it('empty buffer → unknown', () => {
    expect(classifyHookPattern(U([]))).toBe('unknown');
  });
});

describe('HookPatternScanner: decodeHookTarget', () => {
  it('jmp_rel32: target = addr + 5 + rel32', () => {
    // E9 + disp32=0x100 → target = 0x1000 + 5 + 0x100 = 0x1105
    const t = decodeHookTarget(U([0xe9, 0x00, 0x01, 0x00, 0x00]), 0x1000n);
    expect(t).toBe('0x1105');
  });
  it('jmp_rel32: negative displacement wraps correctly', () => {
    // E9 + disp32=-0x10 (0xfffffff0) → target = 0x2000 + 5 - 0x10 = 0x1ff5
    const t = decodeHookTarget(U([0xe9, 0xf0, 0xff, 0xff, 0xff]), 0x2000n);
    expect(t).toBe('0x1ff5');
  });
  it('short_jmp: target = addr + 2 + rel8', () => {
    const t = decodeHookTarget(U([0xeb, 0x10]), 0x100n);
    expect(t).toBe('0x112');
  });
  it('jmp_abs64: target is the 8-byte absolute address at +6', () => {
    // FF 25 [4-byte disp=0] [8-byte absolute target = 0xdeadbeefcafe]
    const bytes = U([0xff, 0x25, 0, 0, 0, 0, 0xfe, 0xca, 0xef, 0xbe, 0xad, 0xde, 0, 0]);
    expect(decodeHookTarget(bytes, 0x400000n)).toBe('0xdeadbeefcafe');
  });
  it('jmp_abs64: compiler-style FF 25 [rip+disp32] resolves the memory operand', () => {
    // Normal compiler output: FF 25 disp32 (JMP QWORD PTR [rip+disp32]).
    // disp32 = 0x10 → target = funcAddr + 6 + 0x10 (the memory slot holds the address,
    // so the resolved value is the slot address itself, not bytes 6-13 of the window).
    const bytes = U([
      0xff, 0x25, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(decodeHookTarget(bytes, 0x400000n)).toBe('0x400016');
  });
  it('jmp_abs64: negative disp32 wraps correctly', () => {
    // disp32 = -0x20 (0xffffffe0) → target = 0x400000 + 6 - 0x20 = 0x3fffe6
    const bytes = U([0xff, 0x25, 0xe0, 0xff, 0xff, 0xff]);
    expect(decodeHookTarget(bytes, 0x400000n)).toBe('0x3fffe6');
  });
  it('mov_jmp: target is the MOV imm32', () => {
    // B8 78 56 34 12 FF E0 → imm32 = 0x12345678
    const bytes = U([0xb8, 0x78, 0x56, 0x34, 0x12, 0xff, 0xe0]);
    expect(decodeHookTarget(bytes, 0x1000n)).toBe('0x12345678');
  });
  it('push_ret: target is the pushed imm32', () => {
    const bytes = U([0x68, 0xef, 0xbe, 0xad, 0xde, 0xc3]);
    expect(decodeHookTarget(bytes, 0x1000n)).toBe('0xdeadbeef');
  });
  it('int3/padding/unknown → 0x0', () => {
    expect(decodeHookTarget(U([0xcc]), 0x1000n)).toBe('0x0');
    expect(decodeHookTarget(U([0x90, 0x90, 0x90]), 0x1000n)).toBe('0x0');
    expect(decodeHookTarget(U([0x48, 0x89, 0xe5]), 0x1000n)).toBe('0x0');
  });
});

describe('HookPatternScanner: scanRangeForHooks', () => {
  // Build a memory window: 16 bytes of NOP (0x90) + a mov_jmp hook + 8 bytes NOP.
  const windowWithHook = U([
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90, // 8 NOPs (clean prologue)
    0xb8,
    0x78,
    0x56,
    0x34,
    0x12,
    0xff,
    0xe0, // mov_jmp at offset 8 (B8 imm32 FF E0 = 7 bytes)
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90,
    0x90, // trailing NOPs
  ]);

  it('default (confidence=high, skipPadding) reports only high-confidence hooks', () => {
    const base = 0x10000n;
    const matches = scanRangeForHooks(windowWithHook, base);
    // mov_jmp is high-confidence → exactly 1 match at offset 8.
    expect(matches).toHaveLength(1);
    expect(matches[0]!.hookType).toBe('mov_jmp');
    expect(matches[0]!.offset).toBe(8);
    expect(matches[0]!.address).toBe('0x10008');
    expect(matches[0]!.jumpTarget).toBe('0x12345678');
  });

  it('confidence=all also reports jmp_rel32/call_rel32/short_jmp', () => {
    const bytes = U([
      0xe9,
      0x00,
      0x01,
      0x00,
      0x00, // jmp_rel32 at offset 0
      0xb8,
      0x78,
      0x56,
      0x34,
      0x12,
      0xff,
      0xe0, // mov_jmp at offset 5 (B8 imm32 FF E0 = 7 bytes)
    ]);
    const matches = scanRangeForHooks(bytes, 0n, { confidence: 'all' });
    const types = matches.map((m) => m.hookType).toSorted();
    expect(types).toContain('jmp_rel32');
    expect(types).toContain('mov_jmp');
  });

  it('skipPadding=true (default) suppresses INT3 / padding runs', () => {
    const bytes = U([
      0xcc,
      0xcc,
      0xcc,
      0xcc, // INT3 sled
      0x90,
      0x90,
      0x90,
      0x90, // NOP sled
    ]);
    expect(scanRangeForHooks(bytes, 0n)).toHaveLength(0);
  });

  it('skipPadding=false reports INT3 / padding', () => {
    const bytes = U([0xcc, 0xcc, 0xcc, 0xcc]);
    const matches = scanRangeForHooks(bytes, 0n, { skipPadding: false });
    // INT3 at offset 0, then padding (the 0xcc run) also classifies at offset 1+.
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.hookType === 'int3_breakpoint' || m.hookType === 'padding')).toBe(
      true,
    );
  });

  it('multiple high-confidence hooks all reported', () => {
    // FF 25 ... jmp_abs64 at offset 0, push_ret at offset 8.
    const bytes = U([
      0xff,
      0x25,
      0,
      0,
      0,
      0,
      0xa0,
      0xa1, // jmp_abs64 (6-byte opcode + need 14 bytes window)
      0x68,
      0xef,
      0xbe,
      0xad,
      0xde,
      0xc3, // push_ret at offset 8
    ]);
    // Pad to give jmp_abs64 a full 14-byte window at offset 0.
    const padded = U([
      0xff, 0x25, 0, 0, 0, 0, 0xa0, 0xa1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x68, 0xef, 0xbe,
      0xad, 0xde, 0xc3,
    ]);
    void bytes;
    const matches = scanRangeForHooks(padded, 0n);
    const types = matches.map((m) => m.hookType);
    expect(types).toContain('jmp_abs64');
    expect(types).toContain('push_ret');
  });

  it('clean code (no hooks) → empty result', () => {
    // Function prologue bytes that are NOT hooks: push rbp; mov rbp,rsp; sub rsp,0x20
    const clean = U([0x55, 0x48, 0x89, 0xe5, 0x48, 0x83, 0xec, 0x20]);
    expect(scanRangeForHooks(clean, 0n)).toHaveLength(0);
  });
});
