/**
 * Linux process_vm_readv / process_vm_writev FFI helpers (koffi).
 *
 * Single-syscall alternative to the /proc/pid/mem file-IO reader in
 * LinuxMemoryProvider.impl.ts. One process_vm_readv/writev call replaces an
 * open/read/write/close sequence on /proc/pid/mem, which is faster for many
 * small scattered reads and avoids file-descriptor pressure.
 *
 * Linux-only. process_vm_readv requires CAP_SYS_PTRACE, or the same uid plus
 * yama ptrace_scope<=1; process_vm_writev always requires CAP_SYS_PTRACE.
 *
 * Runtime verification requires a Linux target (the host is macOS, where
 * libc.so.6 does not exist). The unit test mocks koffi and validates iovec
 * layout, argument wiring, and the error path only -- no real process or
 * syscall is invoked.
 */
import { requireKoffi, type KoffiLibraryHandle, type KoffiCallable } from '../../koffi-loader';

// ── iovec layout (x86-64: struct iovec { void *iov_base; size_t iov_len }) ──
// 16 bytes: iov_base at offset 0 (LE), iov_len at offset 8 (LE).

const IOVEC_SIZE = 16;

// ── caches ──────────────────────────────────────────────────────────────

let _libc: KoffiLibraryHandle | null = null;

function libc() {
  if (!_libc) _libc = requireKoffi().load('libc.so.6');
  return _libc;
}

let readvFnCache: KoffiCallable | null = null;
function readvFn() {
  if (!readvFnCache) {
    readvFnCache = libc().func(
      'long process_vm_readv(int, void *, unsigned long, void *, unsigned long, unsigned long)',
    );
  }
  return readvFnCache;
}

let writevFnCache: KoffiCallable | null = null;
function writevFn() {
  if (!writevFnCache) {
    writevFnCache = libc().func(
      'long process_vm_writev(int, void *, unsigned long, void *, unsigned long, unsigned long)',
    );
  }
  return writevFnCache;
}

// ── helpers ─────────────────────────────────────────────────────────────

/** Build a 16-byte x86-64 iovec ({ iov_base, iov_len }) manually in a Buffer. */
function buildIovec(base: bigint, len: bigint): Buffer {
  const iov = Buffer.alloc(IOVEC_SIZE);
  iov.writeBigUInt64LE(base, 0); // iov_base
  iov.writeBigUInt64LE(len, 8); // iov_len
  return iov;
}

// ── public API ──────────────────────────────────────────────────────────

/**
 * Read `size` bytes from `address` in the remote `pid` via process_vm_readv.
 * Returns a freshly allocated Buffer of `size` bytes. Throws on failure
 * (return value -1); errno is not portably recoverable through koffi, so the
 * error message lists the common causes instead.
 */
export function readRemote(pid: number, address: bigint, size: number): Buffer {
  const local = Buffer.alloc(size);
  const localIov = buildIovec(requireKoffi().address(local), BigInt(size));
  const remoteIov = buildIovec(address, BigInt(size));

  const ret = Number(
    readvFn()(pid, requireKoffi().address(localIov), 1n, requireKoffi().address(remoteIov), 1n, 0n),
  );
  if (ret === -1) {
    throw new Error(
      'process_vm_readv failed (errno unknown); commonly ESRCH=no such pid, EPERM=needs CAP_SYS_PTRACE, EFAULT=bad address',
    );
  }
  if (ret < size) {
    // process_vm_readv stops at the first inaccessible page — a short read
    // leaves the tail of the buffer as garbage.
    throw new Error(`process_vm_readv short read: ${ret}/${size} bytes`);
  }
  return local;
}

/**
 * Write `data` to `address` in the remote `pid` via process_vm_writev.
 * Returns the number of bytes written. Throws on failure (return value -1).
 */
export function writeRemote(pid: number, address: bigint, data: Buffer): number {
  const localIov = buildIovec(requireKoffi().address(data), BigInt(data.length));
  const remoteIov = buildIovec(address, BigInt(data.length));

  const ret = Number(
    writevFn()(
      pid,
      requireKoffi().address(localIov),
      1n,
      requireKoffi().address(remoteIov),
      1n,
      0n,
    ),
  );
  if (ret === -1) {
    throw new Error(
      'process_vm_writev failed (errno unknown); commonly ESRCH=no such pid, EPERM=needs CAP_SYS_PTRACE, EFAULT=bad address',
    );
  }
  return ret;
}
