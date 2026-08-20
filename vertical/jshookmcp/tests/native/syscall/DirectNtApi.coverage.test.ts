/**
 * Coverage tests for DirectNtApi — mocks koffi so every FFI call routes
 * through a single controllable callable. Exercises the NTSTATUS success/failure
 * branch in each exported function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffiCall = vi.fn();
const funcFactory = vi.fn(() => ffiCall);
const mockHandle = { func: funcFactory };

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => mockHandle),
    // identity so the FFI mock receives the actual buffer (lets us write
    // bytesRead/oldProtect/etc. back through the same reference the code reads).
    address: vi.fn((buf: unknown) => buf),
  },
}));

import {
  ntSuccess,
  ntOpenProcess,
  ntReadVirtualMemory,
  ntWriteVirtualMemory,
  ntAllocateVirtualMemory,
  ntProtectVirtualMemory,
  ntFreeVirtualMemory,
  ntSuspendProcess,
  ntResumeProcess,
  buildObjectAttributes,
} from '@native/syscall/DirectNtApi';

beforeEach(() => {
  ffiCall.mockReset();
});

describe('ntSuccess', () => {
  it('returns true for status >= 0, false for negative', () => {
    expect(ntSuccess(0)).toBe(true);
    expect(ntSuccess(1)).toBe(true);
    expect(ntSuccess(0x7fffffff)).toBe(true);
    expect(ntSuccess(-1)).toBe(false);
    // 0xC0000005 as int32 is negative → failure
    expect(ntSuccess(0xc0000005 | 0)).toBe(false);
  });
});

describe('buildObjectAttributes', () => {
  it('writes Attributes at offset 24 (ObjectName pointer stays clear)', () => {
    const oa = buildObjectAttributes(0x2); // OBJ_INHERIT
    expect(oa.readUInt32LE(0)).toBe(48); // Length
    expect(oa.readUInt32LE(16)).toBe(0); // ObjectName must not be clobbered
    expect(oa.readUInt32LE(24)).toBe(0x2); // Attributes — x64 layout position
  });
});

describe('ntOpenProcess', () => {
  it('returns the handle on NTSTATUS success', () => {
    ffiCall.mockReturnValue(0); // STATUS_SUCCESS
    const handle = ntOpenProcess(1234, 0x1fffff);
    expect(typeof handle).toBe('bigint');
  });

  it('throws on failure (formatted NTSTATUS)', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0); // STATUS_ACCESS_VIOLATION
    expect(() => ntOpenProcess(1234, 0x1fffff)).toThrow(/NtOpenProcess failed.*c0000005/);
  });

  it('passes an OBJECT_ATTRIBUTES with Attributes at offset 24 to the kernel', () => {
    ffiCall.mockReturnValue(0);
    ntOpenProcess(1234, 0x1fffff, true); // inheritHandle=true → attr=OBJ_INHERIT
    const oa = ffiCall.mock.calls[0]![2] as Buffer;
    expect(oa.readUInt32LE(0)).toBe(48);
    expect(oa.readUInt32LE(24)).toBe(0x2);
    expect(oa.readUInt32LE(16)).toBe(0); // no garbage at ObjectName
  });

  it('respects inheritHandle flag (no throw for success)', () => {
    ffiCall.mockReturnValue(0);
    expect(() => ntOpenProcess(1234, 0x1fffff, true)).not.toThrow();
  });
});

describe('ntReadVirtualMemory', () => {
  it('returns a buffer of the requested size on success', () => {
    ffiCall.mockImplementation((_h, _addr, _buf, _size, bytesRead) => {
      // The handler reads bytesRead via readBigUInt64LE(0); write 4 into it.
      bytesRead.writeBigUInt64LE(4n, 0);
      return 0;
    });
    const buf = ntReadVirtualMemory(1n, 0x1000n, 16);
    expect(buf.length).toBe(4); // subarray to bytes-read (4)
  });

  it('throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntReadVirtualMemory(1n, 0x1000n, 16)).toThrow(/NtReadVirtualMemory failed/);
  });
});

describe('ntWriteVirtualMemory', () => {
  it('returns bytes written on success', () => {
    ffiCall.mockImplementation((_h, _addr, _data, _size, bytesWritten) => {
      bytesWritten.writeBigUInt64LE(4n, 0);
      return 0;
    });
    expect(ntWriteVirtualMemory(1n, 0x1000n, Buffer.from([1, 2, 3, 4]))).toBe(4);
  });

  it('throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntWriteVirtualMemory(1n, 0x1000n, Buffer.alloc(4))).toThrow(
      /NtWriteVirtualMemory/,
    );
  });
});

describe('ntAllocateVirtualMemory', () => {
  it('returns the allocated base on success (4-arg signature: hProcess, size, allocType, protect)', () => {
    ffiCall.mockImplementation((_h, baseAddrBuf) => {
      baseAddrBuf.writeBigUInt64LE(0x10000n, 0);
      return 0;
    });
    expect(ntAllocateVirtualMemory(1n, 0x1000, 0x40, 0x04)).toBe(0x10000n);
  });

  it('throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntAllocateVirtualMemory(1n, 0x1000, 0x40, 0x04)).toThrow(
      /NtAllocateVirtualMemory/,
    );
  });
});

describe('ntProtectVirtualMemory', () => {
  it('returns oldProtect on success', () => {
    ffiCall.mockImplementation((_h, _base, _size, _newProt, oldProtBuf) => {
      oldProtBuf.writeUInt32LE(0x04, 0); // old protect = PAGE_READWRITE
      return 0;
    });
    const r = ntProtectVirtualMemory(1n, 0x1000n, 0x1000, 0x40);
    expect(r.oldProtect).toBe(0x04);
  });

  it('throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntProtectVirtualMemory(1n, 0x1000n, 0x1000, 0x40)).toThrow(
      /NtProtectVirtualMemory/,
    );
  });
});

describe('ntFreeVirtualMemory', () => {
  it('returns void on success', () => {
    ffiCall.mockReturnValue(0);
    expect(() => ntFreeVirtualMemory(1n, 0x10000n, 0x1000, 0x8000)).not.toThrow();
  });

  it('throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntFreeVirtualMemory(1n, 0x10000n, 0x1000, 0x8000)).toThrow(/NtFreeVirtualMemory/);
  });
});

describe('ntSuspendProcess / ntResumeProcess', () => {
  it('suspend returns void on success', () => {
    ffiCall.mockReturnValue(0);
    expect(() => ntSuspendProcess(1n)).not.toThrow();
  });

  it('suspend throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntSuspendProcess(1n)).toThrow(/NtSuspendProcess/);
  });

  it('resume returns void on success', () => {
    ffiCall.mockReturnValue(0);
    expect(() => ntResumeProcess(1n)).not.toThrow();
  });

  it('resume throws on failure', () => {
    ffiCall.mockReturnValue(0xc0000005 | 0);
    expect(() => ntResumeProcess(1n)).toThrow(/NtResumeProcess/);
  });
});
