/**
 * Coverage tests for SyscallStubBuilder — exercises buildSyscallStub (VirtualAlloc
 * + WriteProcessMemory + VirtualProtect mocked via koffi) and freeAllStubs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFunc = vi.fn(() => 0x10000n); // VirtualAlloc / others → non-zero page
const mockDecode = vi.fn(() => (() => 0) as () => number);

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({ func: vi.fn(() => mockFunc) })),
    address: vi.fn((buf: unknown) => buf),
    decode: vi.fn(() => mockDecode()),
  },
}));

import { buildSyscallStub, freeAllStubs } from '@native/syscall/SyscallStubBuilder';

beforeEach(() => {
  mockFunc.mockReset();
  mockDecode.mockReset();
  mockFunc.mockReturnValue(0x10000n);
  mockDecode.mockReturnValue((() => 0) as () => number);
});

describe('buildSyscallStub', () => {
  it('allocates a stub page + returns { fn, addr }', () => {
    const stub = buildSyscallStub(0x55, 0x404040n);
    expect(typeof stub.fn).toBe('function');
    expect(typeof stub.addr).toBe('bigint');
    expect(stub.addr).toBe(0x10000n);
  });

  it('throws when VirtualAlloc returns 0', () => {
    mockFunc.mockReturnValue(0n); // VirtualAlloc fails
    expect(() => buildSyscallStub(0x55, 0x404040n)).toThrow(/VirtualAlloc failed/);
  });
});

describe('freeAllStubs', () => {
  it('runs without throwing after stubs are built (no-op with mocked VirtualFree)', () => {
    buildSyscallStub(0x10, 0x1000n);
    expect(() => freeAllStubs()).not.toThrow();
  });

  it('is safe to call when no stubs exist', () => {
    expect(() => freeAllStubs()).not.toThrow();
  });
});
