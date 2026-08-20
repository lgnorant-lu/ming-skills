/**
 * Coverage tests for HookPatternScanner — exercises all 9 hook-pattern
 * classifications, target decoding, and the scanRangeForHooks walk with
 * confidence / skipPadding options.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyHookPattern,
  decodeHookTarget,
  scanRangeForHooks,
} from '@native/platform/HookPatternScanner';

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array((hex.replace(/\s+/g, '').match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
}

describe('classifyHookPattern — all pattern types', () => {
  it('int3_breakpoint (0xCC)', () => {
    expect(classifyHookPattern(hexToBytes('cc'))).toBe('int3_breakpoint');
  });

  it('padding (run of identical bytes, excludes 0xCC)', () => {
    expect(classifyHookPattern(hexToBytes('90909090'))).toBe('padding');
  });

  it('jmp_rel32 (E9)', () => {
    expect(classifyHookPattern(hexToBytes('e901000000'))).toBe('jmp_rel32');
  });

  it('call_rel32 (E8)', () => {
    expect(classifyHookPattern(hexToBytes('e801000000'))).toBe('call_rel32');
  });

  it('short_jmp (EB)', () => {
    expect(classifyHookPattern(hexToBytes('eb10'))).toBe('short_jmp');
  });

  it('jmp_abs64 (FF 25)', () => {
    expect(classifyHookPattern(hexToBytes('ff2500000000deadbeef'))).toBe('jmp_abs64');
  });

  it('mov_jmp (B8 imm32 FF E0)', () => {
    // Real x86: B8 imm32(4) FF E0 = 7 bytes, FF at index 5, modrm E0 at index 6.
    expect(classifyHookPattern(hexToBytes('b800000000ffe0'))).toBe('mov_jmp');
  });

  it('mov_call (B8 imm32 FF D0)', () => {
    // Real x86: B8 imm32(4) FF D0 = 7 bytes, FF at index 5, modrm D0 at index 6.
    expect(classifyHookPattern(hexToBytes('b800000000ffd0'))).toBe('mov_call');
  });

  it('push_ret (68 imm32 C3)', () => {
    expect(classifyHookPattern(hexToBytes('68efbeaddec3'))).toBe('push_ret');
  });

  it('unknown for unrecognised leading byte', () => {
    expect(classifyHookPattern(hexToBytes('01'))).toBe('unknown');
  });

  it('unknown for empty input', () => {
    expect(classifyHookPattern(new Uint8Array([]))).toBe('unknown');
  });

  it('does NOT classify B8 mov_jmp when 5th/6th bytes are not FF/E0', () => {
    // b8 ef be ad de 00 90 — index 5 = 0x00 (not FF), so not mov_jmp.
    expect(classifyHookPattern(hexToBytes('b8efbeadde0090'))).toBe('unknown');
  });
});

describe('decodeHookTarget — per-pattern decoding', () => {
  it('jmp_rel32: target = funcAddr + 5 + rel32', () => {
    const target = decodeHookTarget(hexToBytes('e901000000'), 0x1000n);
    expect(target).toBe(`0x${(0x1000 + 5 + 1).toString(16)}`); // 0x1006
  });

  it('call_rel32: same formula as jmp_rel32', () => {
    const target = decodeHookTarget(hexToBytes('e8ffffffff'), 0x2000n);
    expect(target).toBe(`0x${(0x2000 + 5 - 1).toString(16)}`); // rel32 -1 = 0x2004
  });

  it('short_jmp: target = funcAddr + 2 + rel8 (signed)', () => {
    const fwd = decodeHookTarget(hexToBytes('eb10'), 0x100n);
    expect(fwd).toBe(`0x${(0x100 + 2 + 0x10).toString(16)}`);
    // negative rel8 (0xfe = -2)
    const back = decodeHookTarget(hexToBytes('ebfe'), 0x100n);
    expect(back).toBe(`0x${(0x100 + 2 - 2).toString(16)}`);
  });

  it('jmp_abs64: target = 8-byte LE at offset 6', () => {
    const bytes = hexToBytes('ff2500000000'); // + 8 bytes target
    const full = new Uint8Array([...bytes, ...hexToBytes('78563412efbeadde')]);
    expect(decodeHookTarget(full, 0x0n)).toBe(`0x${0xdeadbeef12345678n.toString(16)}`);
  });

  it('jmp_abs64 returns 0x0 when window < 14 bytes', () => {
    expect(decodeHookTarget(hexToBytes('ff2500'), 0n)).toBe('0x0');
  });

  it('mov_jmp / mov_call: target = imm32 (LE)', () => {
    expect(decodeHookTarget(hexToBytes('b8efbeadde'), 0n)).toBe('0xdeadbeef');
  });

  it('push_ret: target = imm32 (LE)', () => {
    expect(decodeHookTarget(hexToBytes('68efbeaddec3'), 0n)).toBe('0xdeadbeef');
  });

  it('returns 0x0 for unknown / empty / too-short windows', () => {
    expect(decodeHookTarget(new Uint8Array([]), 0n)).toBe('0x0');
    expect(decodeHookTarget(hexToBytes('90'), 0n)).toBe('0x0'); // unknown
    expect(decodeHookTarget(hexToBytes('e901'), 0n)).toBe('0x0'); // jmp_rel32 < 5 bytes
  });
});

describe('scanRangeForHooks — walk + options', () => {
  it('default (high confidence, skipPadding): only FF25 / mov_jmp / mov_call / push_ret', () => {
    // bytes: padding(90*4) + jmp_abs64(ff25...) + jmp_rel32(e9...)
    const buf = hexToBytes('90909090ff2500000000aabbccdde901000000');
    const matches = scanRangeForHooks(buf, 0x10000n);

    const types = matches.map((m) => m.hookType);
    expect(types).toContain('jmp_abs64');
    // jmp_rel32 filtered out by default (not high-confidence), padding skipped
    expect(types).not.toContain('jmp_rel32');
    expect(types).not.toContain('padding');
    expect(matches[0]?.address).toMatch(/^0x/);
    expect(matches[0]?.matchedBytes.length).toBeGreaterThanOrEqual(1);
  });

  it("confidence: 'all' includes jmp_rel32 / call_rel32 / short_jmp", () => {
    const buf = hexToBytes('e901000000eb10');
    const matches = scanRangeForHooks(buf, 0n, { confidence: 'all' });
    const types = matches.map((m) => m.hookType);
    expect(types).toContain('jmp_rel32');
    expect(types).toContain('short_jmp');
  });

  it('skipPadding: false surfaces INT3 + padding runs', () => {
    const matches = scanRangeForHooks(hexToBytes('cccccccc'), 0n, { skipPadding: false });
    const types = matches.map((m) => m.hookType);
    expect(types).toContain('int3_breakpoint');
  });

  it('returns empty for a buffer with no recognised patterns', () => {
    expect(scanRangeForHooks(hexToBytes('0102030405060708'), 0n)).toEqual([]);
  });
});
