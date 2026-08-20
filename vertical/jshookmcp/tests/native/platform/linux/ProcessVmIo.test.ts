import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock koffi completely ───────────────────────────────────────────────
// Hoisted so the vi.mock factory (which vitest hoists above imports) can close
// over the shared state. Plain functions (not vi.fn) are used for load/func so
// vitest's mockReset config does not wipe them between tests; we reset state
// manually in beforeEach.
const { mockState } = vi.hoisted(() => ({
  mockState: {
    readvCalls: [] as Array<{ args: unknown[] }>,
    writevCalls: [] as Array<{ args: unknown[] }>,
    // Stable address per Buffer; addrToBuf lets tests retrieve the iovec buffers
    // the module built, by the address passed to the mocked syscall.
    addrToBuf: new Map<bigint, Buffer>(),
    bufToAddr: new Map<Buffer, bigint>(),
    nextAddr: 0x10000n,
    // Scripted behaviour.
    readvReturn: 0n as bigint,
    writevReturn: 0n as bigint,
    readvFill: null as Buffer | null,
  },
}));

vi.mock('koffi', () => ({
  default: {
    load: () => ({
      func: (sig: string) => {
        if (sig.includes('process_vm_readv')) {
          return (...args: unknown[]): bigint => {
            mockState.readvCalls.push({ args });
            // Mirror the real syscall: write scripted bytes into the local
            // destination buffer. Resolve it through the local iovec (args[1]):
            // iov_base -> address of the destination buffer.
            const localIov = mockState.addrToBuf.get(args[1] as bigint);
            if (localIov) {
              const localAddr = localIov.readBigUInt64LE(0);
              const size = Number(localIov.readBigUInt64LE(8));
              const dest = mockState.addrToBuf.get(localAddr);
              if (dest && mockState.readvFill) {
                mockState.readvFill.copy(dest, 0, 0, Math.min(size, mockState.readvFill.length));
              }
            }
            return mockState.readvReturn;
          };
        }
        if (sig.includes('process_vm_writev')) {
          return (...args: unknown[]): bigint => {
            mockState.writevCalls.push({ args });
            return mockState.writevReturn;
          };
        }
        return (): bigint => 0n;
      },
    }),
    address: (buf: Buffer): bigint => {
      let a = mockState.bufToAddr.get(buf);
      if (a === undefined) {
        a = mockState.nextAddr;
        mockState.nextAddr += 0x10n;
        mockState.bufToAddr.set(buf, a);
        mockState.addrToBuf.set(a, buf);
      }
      return a;
    },
  },
}));

import { readRemote, writeRemote } from '@src/native/platform/linux/ProcessVmIo';

describe('ProcessVmIo', () => {
  beforeEach(() => {
    mockState.readvCalls.length = 0;
    mockState.writevCalls.length = 0;
    mockState.addrToBuf.clear();
    mockState.bufToAddr.clear();
    mockState.nextAddr = 0x10000n;
    mockState.readvReturn = 0n;
    mockState.writevReturn = 0n;
    mockState.readvFill = null;
  });

  it('readRemote returns the filled bytes and passes a correct remote iovec', () => {
    // Arrange
    const pid = 4242;
    const remoteAddr = 0x7fffdeadbeefn;
    const size = 8;
    const fill = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    mockState.readvFill = fill;
    mockState.readvReturn = BigInt(size);

    // Act
    const out = readRemote(pid, remoteAddr, size);

    // Assert: returned bytes
    expect(out.length).toBe(size);
    expect(out.equals(fill)).toBe(true);

    // Assert: process_vm_readv called once with the right scalar args
    expect(mockState.readvCalls).toHaveLength(1);
    const args = mockState.readvCalls[0]!.args;
    expect(args[0]).toBe(pid); // pid
    expect(args[2]).toBe(1n); // liovcnt
    expect(args[4]).toBe(1n); // riovcnt
    expect(args[5]).toBe(0n); // flags

    // Core correctness: the remote iovec buffer carries the requested address
    // and size (address at offset 0, 8 bytes LE).
    const remoteIov = mockState.addrToBuf.get(args[3] as bigint)!;
    expect(remoteIov.length).toBe(16);
    expect(remoteIov.readBigUInt64LE(0)).toBe(remoteAddr); // iov_base = remote address
    expect(remoteIov.readBigUInt64LE(8)).toBe(BigInt(size)); // iov_len = size

    // Local iovec is well-formed too: iov_len = size.
    const localIov = mockState.addrToBuf.get(args[1] as bigint)!;
    expect(localIov.length).toBe(16);
    expect(localIov.readBigUInt64LE(8)).toBe(BigInt(size)); // iov_len = size
  });

  it('writeRemote passes the data iovec correctly and returns bytes written', () => {
    // Arrange
    const pid = 9999;
    const remoteAddr = 0xcafebaben;
    const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    mockState.writevReturn = BigInt(data.length);

    // Act
    const written = writeRemote(pid, remoteAddr, data);

    // Assert: return value
    expect(written).toBe(data.length);

    // Assert: process_vm_writev called once with the right scalar args
    expect(mockState.writevCalls).toHaveLength(1);
    const args = mockState.writevCalls[0]!.args;
    expect(args[0]).toBe(pid); // pid
    expect(args[2]).toBe(1n); // liovcnt
    expect(args[4]).toBe(1n); // riovcnt
    expect(args[5]).toBe(0n); // flags

    // Core correctness: the remote iovec carries the remote address + data length.
    const remoteIov = mockState.addrToBuf.get(args[3] as bigint)!;
    expect(remoteIov.length).toBe(16);
    expect(remoteIov.readBigUInt64LE(0)).toBe(remoteAddr); // iov_base = remote address
    expect(remoteIov.readBigUInt64LE(8)).toBe(BigInt(data.length)); // iov_len = data.length

    // Local iovec iov_len = data.length (iov_base points at the data buffer).
    const localIov = mockState.addrToBuf.get(args[1] as bigint)!;
    expect(localIov.readBigUInt64LE(8)).toBe(BigInt(data.length)); // iov_len = data.length
  });

  it('readRemote throws an Error mentioning ESRCH/EPERM when the syscall returns -1', () => {
    // Arrange
    mockState.readvReturn = -1n;

    // Act / Assert: the error message lists the common errno causes.
    expect(() => readRemote(1, 0x1000n, 16)).toThrow('ESRCH');
    expect(() => readRemote(1, 0x1000n, 16)).toThrow('EPERM');
  });
});
