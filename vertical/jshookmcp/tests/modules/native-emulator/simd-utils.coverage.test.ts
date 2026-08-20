/**
 * Coverage tests for simd-utils — sign-extension, register-offset extend,
 * and the load/store transfer helpers (with a mock SimdContext).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  extendOffset,
  signExtend19,
  signExtend7,
  signExtend9,
  transfer,
  transferInterleavedStructs,
  type SimdContext,
} from '@modules/native-emulator/simd-utils';

function mockCtx(over: Partial<SimdContext> = {}): SimdContext {
  const regs = new Map<number, Uint8Array>();
  const mem = new Map<number, Uint8Array>();
  return {
    vGetBytes: vi.fn((i: number) => regs.get(i) ?? new Uint8Array(16)),
    vSetBytes: vi.fn((i: number, v: Uint8Array) => void regs.set(i, v)),
    memRead: vi.fn((addr: number, len: number) => {
      const existing = mem.get(addr) ?? new Uint8Array(len);
      return existing.subarray(0, len);
    }),
    memWrite: vi.fn((addr: number, data: Uint8Array) => void mem.set(addr, data)),
    gprRead: vi.fn(() => 0n),
    gprWrite: vi.fn(),
    gprReadSp: vi.fn(() => 0n),
    ...over,
  };
}

describe('signExtend helpers', () => {
  it('signExtend9: positive below 0x100, negative at/above', () => {
    expect(signExtend9(0xff)).toBe(255);
    expect(signExtend9(0x100)).toBe(-256);
    expect(signExtend9(0x1ff)).toBe(-1);
    expect(signExtend9(0)).toBe(0);
  });

  it('signExtend7: boundary at 0x40', () => {
    expect(signExtend7(0x3f)).toBe(63);
    expect(signExtend7(0x40)).toBe(-64);
    expect(signExtend7(0x7f)).toBe(-1);
  });

  it('signExtend19: boundary at 0x40000', () => {
    expect(signExtend19(0x3ffff)).toBe(262143);
    expect(signExtend19(0x40000)).toBe(-262144);
    expect(signExtend19(0x7ffff)).toBe(-1);
  });
});

describe('extendOffset', () => {
  it('UXTW (0b010): masks low 32 bits', () => {
    expect(extendOffset(0x1_0000_0001n, 0b010, 0)).toBe(1n);
  });

  it('SXTW (0b110): sign-extends low 32 bits', () => {
    expect(extendOffset(0xffff_ffffn, 0b110, 0)).toBe(-1n);
  });

  it('SXTX (0b111): sign-extends full 64 bits', () => {
    expect(extendOffset(-5n, 0b111, 0)).toBe(-5n);
  });

  it('LSL default (0b011): passes value through + applies shift', () => {
    expect(extendOffset(5n, 0b011, 2)).toBe(20n); // 5 << 2
  });
});

describe('transfer', () => {
  it('load reads memory + zero-extends into the V register', () => {
    const ctx = mockCtx({
      memRead: vi.fn(() => new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
    });
    transfer(ctx, true, 3, 0x2000, 4);
    const set = ctx.vSetBytes as unknown as ReturnType<typeof vi.fn>;
    expect(set).toHaveBeenCalledWith(3, expect.any(Uint8Array));
    const written = set.mock.calls[0]?.[1] as Uint8Array;
    expect(written.length).toBe(16); // full register width
    expect(Array.from(written.subarray(0, 4))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(Array.from(written.subarray(4))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // zeroed
  });

  it('store writes the low `bytes` of the V register to memory', () => {
    const ctx = mockCtx({
      vGetBytes: vi.fn(() => {
        const full = new Uint8Array(16);
        full.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
        return full;
      }),
    });
    transfer(ctx, false, 1, 0x3000, 4);
    const write = ctx.memWrite as unknown as ReturnType<typeof vi.fn>;
    expect(write).toHaveBeenCalledWith(0x3000, expect.any(Uint8Array));
    expect(Array.from(write.mock.calls[0]?.[1] as Uint8Array)).toEqual([1, 2, 3, 4]);
  });
});

describe('transferInterleavedStructs', () => {
  it('LD2 .16B de-interleaves 2 registers from a 32-byte memory block', () => {
    // memory: lane0-even, lane0-odd, lane1-even, lane1-odd, ... (16 lanes × 2 members)
    const data = new Uint8Array(32);
    for (let lane = 0; lane < 16; lane++) {
      data[lane * 2] = lane; // even member
      data[lane * 2 + 1] = lane + 100; // odd member
    }
    const ctx = mockCtx({ memRead: vi.fn(() => data) });
    transferInterleavedStructs(ctx, {
      isLoad: true,
      base: 0,
      rt: 0,
      structCount: 2,
      regBytes: 16,
      elementBytes: 1,
    });
    const set = ctx.vSetBytes as unknown as ReturnType<typeof vi.fn>;
    expect(set).toHaveBeenCalledTimes(2);
    const reg0 = set.mock.calls[0]?.[1] as Uint8Array; // even lanes
    expect(Array.from(reg0.subarray(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => i));
    const reg1 = set.mock.calls[1]?.[1] as Uint8Array; // odd lanes
    expect(Array.from(reg1.subarray(0, 16))).toEqual(Array.from({ length: 16 }, (_, i) => i + 100));
  });

  it('ST2 interleaves 2 registers into memory', () => {
    const reg0 = new Uint8Array(16).fill(0xaa);
    const reg1 = new Uint8Array(16).fill(0xbb);
    const ctx = mockCtx({
      vGetBytes: vi.fn((i: number) => (i === 0 ? reg0 : reg1)),
    });
    transferInterleavedStructs(ctx, {
      isLoad: false,
      base: 0x4000,
      rt: 0,
      structCount: 2,
      regBytes: 16,
      elementBytes: 1,
    });
    const write = ctx.memWrite as unknown as ReturnType<typeof vi.fn>;
    const out = write.mock.calls[0]?.[1] as Uint8Array;
    expect(out.length).toBe(32);
    expect(out[0]).toBe(0xaa); // lane0 member0
    expect(out[1]).toBe(0xbb); // lane0 member1
  });

  it('returns early when lanes = regBytes/elementBytes is not an integer', () => {
    const ctx = mockCtx();
    transferInterleavedStructs(ctx, {
      isLoad: true,
      base: 0,
      rt: 0,
      structCount: 1,
      regBytes: 8,
      elementBytes: 3, // 8/3 not integer
    });
    expect(ctx.vSetBytes).not.toHaveBeenCalled();
  });
});
