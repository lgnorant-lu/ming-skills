/**
 * Coverage tests for NtInjection — NTSTATUS injection primitives via mocked
 * koffi. These return {status, ...} objects (fail-soft, not throw), unlike
 * DirectNtApi which throws.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffiCall = vi.fn();
const funcFactory = vi.fn(() => ffiCall);
const mockHandle = { func: funcFactory };

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => mockHandle),
    address: vi.fn((buf: unknown) => buf),
  },
}));

import {
  ntAllocateVirtualMemory,
  ntClose,
  ntCreateThreadEx,
  ntCreateThreadExSafe,
  ntProtectVirtualMemory,
  ntSuccess,
  ntWriteVirtualMemory,
} from '@native/syscall/NtInjection';

beforeEach(() => {
  ffiCall.mockReset();
});

describe('ntSuccess', () => {
  it('true for >= 0, false for negative', () => {
    expect(ntSuccess(0)).toBe(true);
    expect(ntSuccess(0xc0000005 | 0)).toBe(false);
  });
});

describe('ntAllocateVirtualMemory', () => {
  it('returns { status: 0, address } on success', () => {
    ffiCall.mockImplementation((_h, addrBuf) => {
      addrBuf.writeBigUInt64LE(0x50000n, 0);
      return 0;
    });
    const r = ntAllocateVirtualMemory(1n, 0x1000, 0x40);
    expect(r.status).toBe(0);
    expect(r.address).toBe(0x50000n);
  });

  it('returns negative status + 0n address on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    const r = ntAllocateVirtualMemory(1n, 0x1000, 0x40);
    expect(r.status).toBeLessThan(0);
    expect(r.address).toBe(0n);
  });
});

describe('ntWriteVirtualMemory', () => {
  it('returns the NTSTATUS (0 on success)', () => {
    ffiCall.mockReturnValue(0);
    expect(ntWriteVirtualMemory(1n, 0x1000n, Buffer.from([1, 2, 3, 4]))).toBe(0);
  });

  it('returns a negative status on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(ntWriteVirtualMemory(1n, 0x1000n, Buffer.alloc(4))).toBeLessThan(0);
  });
});

describe('ntProtectVirtualMemory', () => {
  it('returns { status, oldProtect }', () => {
    ffiCall.mockImplementation((_h, _base, _size, _newProt, oldProt) => {
      oldProt.writeUInt32LE(0x04, 0);
      return 0;
    });
    const r = ntProtectVirtualMemory(1n, 0x1000n, 0x1000, 0x20);
    expect(r.status).toBe(0);
    expect(r.oldProtect).toBe(0x04);
  });
});

describe('ntCreateThreadEx', () => {
  it('returns { status: 0, handle } on success', () => {
    ffiCall.mockImplementation((handleBuf) => {
      handleBuf.writeBigUInt64LE(0x100n, 0);
      return 0;
    });
    const r = ntCreateThreadEx(1n, 0x2000n, 0n);
    expect(r.status).toBe(0);
    expect(r.handle).toBe(0x100n);
  });

  it('returns negative status + 0n handle on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    const r = ntCreateThreadEx(1n, 0x2000n, 0n);
    expect(r.status).toBeLessThan(0);
    expect(r.handle).toBe(0n);
  });
});

describe('ntClose', () => {
  it('returns the NTSTATUS', () => {
    ffiCall.mockReturnValue(0);
    expect(ntClose(0x100n)).toBe(0);
  });
});

describe('ntCreateThreadExSafe', () => {
  it('delegates to ntCreateThreadEx (same { status, handle } shape)', () => {
    ffiCall.mockImplementation((handleBuf) => {
      handleBuf.writeBigUInt64LE(0x200n, 0);
      return 0;
    });
    const r = ntCreateThreadExSafe(1n, 0x3000n, 0n);
    expect(r.status).toBe(0);
    expect(r.handle).toBe(0x200n);
  });

  it('fail-soft on negative status (returns the object, no throw)', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    const r = ntCreateThreadExSafe(1n, 0x3000n, 0n);
    expect(r.status).toBeLessThan(0);
    expect(r.handle).toBe(0n);
  });
});
