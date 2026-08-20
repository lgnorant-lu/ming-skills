import { readGuestCString, writeGuestCString } from '../c-strings';
import { writeGuestU64 } from '../guest-memory';
import type { BionicLibrary } from './library';
import type { BionicOptions, BionicRuntime } from './types';

export function installDynamicLinkerExtensionStubs(lib: BionicLibrary): void {
  lib.set('dladdr', () => 0n);
  lib.set('dl_iterate_phdr', () => 0n);
}

export function installThreadExtensionStubs(lib: BionicLibrary, runtime: BionicRuntime): void {
  lib.set('pthread_key_create', () => 0n);
  lib.set('pthread_key_delete', () => 0n);
  lib.set('pthread_once', (ctx) => {
    const control = Number(ctx.x(0));
    const initializer = Number(ctx.x(1));
    if (control === 0 || initializer === 0) return 0n;
    const bytes = ctx.read(control, 4);
    const state = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (state === 0) {
      runtime.callGuestFunction(initializer);
      ctx.write(control, new Uint8Array([1, 0, 0, 0]));
    }
    return 0n;
  });
  for (const name of [
    'pthread_cond_init',
    'pthread_cond_destroy',
    'pthread_cond_wait',
    'pthread_cond_broadcast',
    'pthread_cond_signal',
    'pthread_cond_timedwait',
    'pthread_getspecific',
    'pthread_setspecific',
    'pthread_equal',
    'pthread_detach',
    'sched_yield',
  ]) {
    lib.set(name, () => 0n);
  }
  lib.set('pthread_self', () => 1n);
}

export function installTimeExtensionStubs(lib: BionicLibrary): void {
  lib.set('clock_gettime', (ctx) => {
    const output = Number(ctx.x(1));
    if (output !== 0) {
      const nanoseconds = BigInt(Date.now()) * 1_000_000n;
      writeGuestU64(ctx, output, nanoseconds / 1_000_000_000n);
      writeGuestU64(ctx, output + 8, nanoseconds % 1_000_000_000n);
    }
    return 0n;
  });
  lib.set('clock', () => BigInt(Math.floor(Date.now() / 1000)));
  lib.set('difftime', (ctx) => {
    ctx.setD(0, Number(ctx.x(0)) - Number(ctx.x(1)));
  });
  lib.set('gmtime', () => 0n);
}

export function installProcessExtensionStubs(lib: BionicLibrary, options: BionicOptions): void {
  lib.set('exit', (ctx) => failExit('exit', Number(ctx.x(0))));
  lib.set('_exit', (ctx) => failExit('_exit', Number(ctx.x(0))));
  lib.set('android_set_abort_message', (ctx) => {
    options.onStderr?.(`[ABORT] ${readGuestCString(ctx, Number(ctx.x(0)))}`);
  });
  lib.set('syslog', () => undefined);
  lib.set('openlog', () => undefined);
  lib.set('closelog', () => undefined);
  lib.set('setlogmask', () => 0n);
}

export function installSystemExtensionStubs(lib: BionicLibrary, options: BionicOptions): void {
  lib.set('syscall', (ctx) => {
    return (
      options.onSyscall?.(
        Number(ctx.x(0)),
        ctx.x(1),
        ctx.x(2),
        ctx.x(3),
        ctx.x(4),
        ctx.x(5),
        ctx.x(6),
      ) ?? BigInt(-38)
    );
  });

  // Virtual file system: maps fd (starting at 3) → { path, data, offset }.
  const fdTable = new Map<number, { data: Uint8Array; offset: number }>();
  let vfsNextFd = 3;

  const vfsOpen = (path: string): number => {
    const fileMap = options.files;
    if (!fileMap) return -1;
    for (const [key, data] of fileMap) {
      if (path === key || path.endsWith('/' + key) || path.includes(key)) {
        const fd = vfsNextFd++;
        fdTable.set(fd, { data: new Uint8Array(data), offset: 0 });
        return fd;
      }
    }
    return -1;
  };

  lib.set('open', (ctx) => {
    const path = readGuestCString(ctx, Number(ctx.x(0)));
    const fd = vfsOpen(path);
    return BigInt(fd);
  });

  lib.set('openat', (ctx) => {
    const path = readGuestCString(ctx, Number(ctx.x(1)));
    const fd = vfsOpen(path);
    return BigInt(fd);
  });

  lib.set('read', (ctx) => {
    const fd = Number(ctx.x(0));
    const buf = Number(ctx.x(1));
    const count = Number(ctx.x(2));
    const entry = fdTable.get(fd);
    if (!entry) return BigInt(-1);
    const toRead = Math.min(count, entry.data.length - entry.offset);
    if (toRead <= 0) return 0n;
    for (let i = 0; i < toRead; i++)
      ctx.write(buf + i, new Uint8Array([entry.data[entry.offset + i]!]));
    entry.offset += toRead;
    return BigInt(toRead);
  });

  lib.set('close', (ctx) => {
    const fd = Number(ctx.x(0));
    return BigInt(fdTable.delete(fd) ? 0 : -1);
  });

  lib.set('fstat', (ctx) => {
    const fd = Number(ctx.x(0));
    const statbuf = Number(ctx.x(1));
    const entry = fdTable.get(fd);
    if (!entry) return BigInt(-1);
    // Write a minimal struct stat64: st_size at offset 48, st_mode at offset 16
    const buf = new Uint8Array(128);
    new DataView(buf.buffer).setBigUint64(48, BigInt(entry.data.length), true); // st_size
    new DataView(buf.buffer).setUint32(16, 0x81a4, true); // st_mode = S_IFREG | 0644
    ctx.write(statbuf, buf);
    return 0n;
  });

  lib.set('access', (ctx) => {
    const path = readGuestCString(ctx, Number(ctx.x(0)));
    const fileMap = options.files;
    if (fileMap) {
      for (const key of fileMap.keys()) {
        if (path === key || path.endsWith('/' + key) || path.includes(key)) return 0n;
      }
    }
    return BigInt(-1);
  });

  lib.set('stat', (ctx) => {
    const path = readGuestCString(ctx, Number(ctx.x(0)));
    const statbuf = Number(ctx.x(1));
    const fileMap = options.files;
    if (fileMap) {
      for (const [key, data] of fileMap) {
        if (path === key || path.endsWith('/' + key) || path.includes(key)) {
          const buf = new Uint8Array(128);
          new DataView(buf.buffer).setBigUint64(48, BigInt(data.length), true); // st_size
          new DataView(buf.buffer).setUint32(16, 0x81a4, true); // st_mode
          ctx.write(statbuf, buf);
          return 0n;
        }
      }
    }
    return BigInt(-1);
  });

  lib.set('lseek', (ctx) => {
    const fd = Number(ctx.x(0));
    const offset = Number(ctx.x(1));
    const whence = Number(ctx.x(2));
    const entry = fdTable.get(fd);
    if (!entry) return BigInt(-1);
    let newOffset: number;
    if (whence === 0) newOffset = offset;
    else if (whence === 1) newOffset = entry.offset + offset;
    else if (whence === 2) newOffset = entry.data.length + offset;
    else return BigInt(-1);
    entry.offset = Math.max(0, newOffset);
    return BigInt(entry.offset);
  });

  for (const name of ['__open_2', 'faccessat', 'fstatat']) {
    lib.set(name, () => BigInt(-1));
  }
  lib.set('__system_property_get', (ctx) => {
    const value = options.onSystemPropertyGet?.(readGuestCString(ctx, Number(ctx.x(0))));
    return value === null || value === undefined
      ? 0n
      : BigInt(writeGuestCString(ctx, Number(ctx.x(1)), value));
  });

  lib.set('tmpfile', () => 0n);
  lib.set('tmpnam', () => 0n);
  lib.set('mkstemp', () => BigInt(-1));
  lib.set('mkdtemp', () => 0n);
  lib.set('setlocale', () => 0n);
  lib.set('localeconv', () => 0n);
  for (const name of ['signal', 'sigaction', 'sigprocmask', 'raise']) {
    lib.set(name, () => 0n);
  }
  lib.set('rand', randomInt);
  lib.set('srand', () => undefined);
  lib.set('random', randomInt);
  lib.set('srandom', () => undefined);
}

function failExit(name: string, code: number): never {
  throw new Error(`bionic: ${name}(${code}) called by emulated code`);
}

function randomInt(): bigint {
  return BigInt(Math.floor(Math.random() * 2147483647));
}
