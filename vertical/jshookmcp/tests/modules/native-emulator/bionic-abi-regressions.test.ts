import { describe, expect, it } from 'vitest';

import { CpuEngine, type HostContext } from '@modules/native-emulator/CpuEngine';
import {
  createBionicLibrary,
  hasBionicSymbol,
  type BionicMemoryMapper,
} from '@modules/native-emulator/bionic';

const ASCII = (value: string): Uint8Array => new TextEncoder().encode(value);

const NOOP_RUNTIME: BionicMemoryMapper = {
  mapMemory: () => undefined,
  lookupSymbol: () => undefined,
  bindImportStub: () => 1,
  callGuestFunction: () => 0,
};

function makeContext(
  mem: Uint8Array,
  registers: bigint[],
  setD?: (value: number) => void,
): HostContext {
  const x = [...registers];
  while (x.length < 31) x.push(0n);
  return {
    x: (index) => x[index] ?? 0n,
    setX: (index, value) => {
      x[index] = value;
    },
    setD: (_index, value) => setD?.(value),
    read: (address, length) => mem.subarray(address, address + length),
    write: (address, bytes) => mem.set(bytes, address),
  };
}

function makeEngineContext(engine: CpuEngine, registers: bigint[]): HostContext {
  const x = [...registers];
  while (x.length < 31) x.push(0n);
  return {
    x: (index) => x[index] ?? 0n,
    setX: (index, value) => {
      x[index] = value;
    },
    setD: () => undefined,
    read: (address, length) => engine.readMemory(address, length),
    write: (address, bytes) => engine.writeCode(address, bytes),
  };
}

function writeU64(mem: Uint8Array, address: number, value: bigint): void {
  new DataView(mem.buffer).setBigUint64(address, value, true);
}

describe('bionic AArch64 ABI regressions', () => {
  it('uses fortified printf register layouts and decodes the supplied va_list', () => {
    const lib = createBionicLibrary(NOOP_RUNTIME);
    const mem = new Uint8Array(0x500);
    const dst = 0x20;
    const format = 0x100;
    const string = 0x180;
    const vaList = 0x200;
    const grSave = 0x300;
    mem.set(ASCII('%s:%d\0'), format);
    mem.set(ASCII('value\0'), string);

    writeU64(mem, vaList, 0x400n); // stack
    writeU64(mem, vaList + 8, BigInt(grSave + 16)); // gr_top
    new DataView(mem.buffer).setInt32(vaList + 24, -16, true); // gr_offs
    writeU64(mem, grSave, BigInt(string));
    writeU64(mem, grSave + 8, 42n);

    const result = lib.get('__vsnprintf_chk')!(
      makeContext(mem, [BigInt(dst), 64n, 0n, 64n, BigInt(format), BigInt(vaList)]),
    );
    expect(result).toBe(8n);
    expect(new TextDecoder().decode(mem.subarray(dst, dst + 9))).toBe('value:42\0');

    mem.fill(0, dst, dst + 32);
    const direct = lib.get('__sprintf_chk')!(
      makeContext(mem, [BigInt(dst), 0n, 32n, BigInt(format), BigInt(string), 7n]),
    );
    expect(direct).toBe(7n);
    expect(new TextDecoder().decode(mem.subarray(dst, dst + 8))).toBe('value:7\0');
  });

  it('returns strtod and difftime through D0', () => {
    const lib = createBionicLibrary(NOOP_RUNTIME);
    const mem = new Uint8Array(64);
    mem.set(ASCII('3.25\0'), 8);
    let d0 = Number.NaN;
    lib.get('strtod')!(makeContext(mem, [8n], (value) => (d0 = value)));
    expect(d0).toBe(3.25);

    lib.get('difftime')!(makeContext(mem, [20n, 6n], (value) => (d0 = value)));
    expect(d0).toBe(14);

    const engine = new CpuEngine();
    const engineLib = createBionicLibrary(engine);
    const input = 0x7000;
    engine.mapMemory(input, 16);
    engine.writeCode(input, ASCII('6.5\0'));
    const stub = engine.bindImportStub('strtod', engineLib.get('strtod')!);
    engine.writeRegister('x0', input);
    engine.callHost(stub);
    expect(new DataView(engine.readVReg(0).buffer).getFloat64(0, true)).toBe(6.5);
  });

  it('aligns memalign/posix_memalign/valloc and maps each requested size', () => {
    const engine = new CpuEngine();
    const lib = createBionicLibrary(engine);
    lib.get('malloc')!(makeEngineContext(engine, [3n]));

    const aligned = Number(lib.get('memalign')!(makeEngineContext(engine, [4096n, 8192n])));
    expect(aligned % 4096).toBe(0);
    expect(() => engine.readMemory(aligned + 8191, 1)).not.toThrow();

    const out = 0x8000;
    engine.mapMemory(out, 8);
    expect(lib.get('posix_memalign')!(makeEngineContext(engine, [BigInt(out), 256n, 513n]))).toBe(
      0n,
    );
    const posixPtr = Number(
      engine
        .readMemory(out, 8)
        .reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n),
    );
    expect(posixPtr % 256).toBe(0);
    expect(() => engine.readMemory(posixPtr + 512, 1)).not.toThrow();

    const pagePtr = Number(lib.get('valloc')!(makeEngineContext(engine, [8192n])));
    expect(pagePtr % 4096).toBe(0);
    expect(() => engine.readMemory(pagePtr + 8191, 1)).not.toThrow();
  });

  it('passes syscall arguments from x1 through x6', () => {
    let seen: bigint[] = [];
    const lib = createBionicLibrary(NOOP_RUNTIME, {
      onSyscall: (number, ...args) => {
        seen = [BigInt(number), ...args];
        return 99n;
      },
    });
    const result = lib.get('syscall')!(
      makeContext(new Uint8Array(1), [123n, 1n, 2n, 3n, 4n, 5n, 6n]),
    );
    expect(result).toBe(99n);
    expect(seen).toEqual([123n, 1n, 2n, 3n, 4n, 5n, 6n]);
  });

  it('terminates strncat and preserves bcopy source/destination order', () => {
    const lib = createBionicLibrary(NOOP_RUNTIME);
    const mem = new Uint8Array(96).fill(0xaa);
    mem.set(ASCII('ab\0'), 8);
    mem.set(ASCII('cde\0'), 24);
    lib.get('strncat')!(makeContext(mem, [8n, 24n, 2n]));
    expect([...mem.subarray(8, 13)]).toEqual([0x61, 0x62, 0x63, 0x64, 0]);

    mem.set([1, 2, 3, 4], 40);
    lib.get('bcopy')!(makeContext(mem, [40n, 48n, 4n]));
    expect([...mem.subarray(40, 44)]).toEqual([1, 2, 3, 4]);
    expect([...mem.subarray(48, 52)]).toEqual([1, 2, 3, 4]);
  });

  it('executes pthread_once exactly once before marking the control word complete', () => {
    let calls = 0;
    const mapper: BionicMemoryMapper = {
      ...NOOP_RUNTIME,
      callGuestFunction: (address) => {
        expect(address).toBe(0x1234);
        calls++;
        return 0;
      },
    };
    const lib = createBionicLibrary(mapper);
    const mem = new Uint8Array(16);
    const ctx = makeContext(mem, [4n, 0x1234n]);
    lib.get('pthread_once')!(ctx);
    lib.get('pthread_once')!(ctx);
    expect(calls).toBe(1);
    expect(new DataView(mem.buffer).getUint32(4, true)).toBe(1);
  });

  it('exposes __sF as persistent mapped data rather than a host function', () => {
    const engine = new CpuEngine();
    const lib = createBionicLibrary(engine);
    const address = lib.dataSymbols.get('__sF');
    expect(address).toBeDefined();
    expect(lib.has('__sF')).toBe(false);
    expect(hasBionicSymbol('__sF')).toBe(true);
    expect(engine.readMemory(address!, 3 * 256)).toEqual(new Uint8Array(3 * 256));
  });
});
