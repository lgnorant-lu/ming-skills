import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { JNI_INDEX, JniEnvironment } from '@modules/native-emulator/jni';

function readPointer(engine: CpuEngine, address: number): number {
  return Number(
    engine
      .readMemory(address, 8)
      .reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n),
  );
}

function writePointer(engine: CpuEngine, address: number, value: bigint): void {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  engine.writeCode(address, bytes);
}

function jniStub(engine: CpuEngine, jni: JniEnvironment, index: number): number {
  const table = readPointer(engine, jni.envPointer());
  return readPointer(engine, table + index * 8);
}

function resolveMethodId(
  engine: CpuEngine,
  jni: JniEnvironment,
  classHandle: number,
  name: string,
  signature: string,
): number {
  const strings = 0x8000;
  engine.mapMemory(strings, 0x200);
  engine.writeCode(strings, new TextEncoder().encode(`${name}\0`));
  engine.writeCode(strings + 0x100, new TextEncoder().encode(`${signature}\0`));
  engine.writeRegister('x1', classHandle);
  engine.writeRegister('x2', strings);
  engine.writeRegister('x3', strings + 0x100);
  engine.callHost(jniStub(engine, jni, JNI_INDEX.GetStaticMethodID));
  return engine.readRegister('x0');
}

describe('JNI stable slots and V/A marshalling', () => {
  it('binds weak-reference operations at slots 226 and 227', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const object = jni.allocHandle({ kind: 'object' });

    expect(JNI_INDEX.NewWeakGlobalRef).toBe(226);
    expect(JNI_INDEX.DeleteWeakGlobalRef).toBe(227);
    engine.writeRegister('x1', object);
    engine.callHost(jniStub(engine, jni, JNI_INDEX.NewWeakGlobalRef));
    expect(engine.readRegister('x0')).toBe(object);

    engine.writeRegister('x1', object);
    engine.callHost(jniStub(engine, jni, 29));
    expect(engine.readRegister('x0')).toBe(0);
    expect(jni.jniDiagnostics()).toContainEqual(expect.stringContaining('slot 29'));
  });

  it('decodes CallStaticIntMethodA from a jvalue array', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const classHandle = jni.defineClass('Calc');
    let seen: bigint[] = [];
    jni.registerJavaMethod('Calc', 'sum', '(IJ)I', ({ args }) => {
      seen = args;
      return args[0]! + args[1]!;
    });
    const methodId = resolveMethodId(engine, jni, classHandle, 'sum', '(IJ)I');

    const values = 0x9000;
    engine.mapMemory(values, 16);
    writePointer(engine, values, 7n);
    writePointer(engine, values + 8, 35n);
    engine.writeRegister('x1', classHandle);
    engine.writeRegister('x2', methodId);
    engine.writeRegister('x3', values);
    engine.callHost(jniStub(engine, jni, JNI_INDEX.CallStaticIntMethodA));

    expect(seen).toEqual([7n, 35n]);
    expect(engine.readRegister('x0')).toBe(42);
  });

  it('decodes CallStaticIntMethodV from the AArch64 va_list save area', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const classHandle = jni.defineClass('CalcV');
    let seen: bigint[] = [];
    jni.registerJavaMethod('CalcV', 'sum', '(II)I', ({ args }) => {
      seen = args;
      return args[0]! + args[1]!;
    });
    const methodId = resolveMethodId(engine, jni, classHandle, 'sum', '(II)I');

    const vaList = 0xa000;
    const grTop = 0xa100;
    engine.mapMemory(vaList, 0x200);
    writePointer(engine, vaList, 0xa180n);
    writePointer(engine, vaList + 8, BigInt(grTop));
    writePointer(engine, vaList + 16, 0xa180n);
    const offsets = new Uint8Array(8);
    const offsetView = new DataView(offsets.buffer);
    offsetView.setInt32(0, -16, true);
    offsetView.setInt32(4, 0, true);
    engine.writeCode(vaList + 24, offsets);
    writePointer(engine, grTop - 16, 11n);
    writePointer(engine, grTop - 8, 31n);

    engine.writeRegister('x1', classHandle);
    engine.writeRegister('x2', methodId);
    engine.writeRegister('x3', vaList);
    engine.callHost(jniStub(engine, jni, JNI_INDEX.CallStaticIntMethodV));

    expect(seen).toEqual([11n, 31n]);
    expect(engine.readRegister('x0')).toBe(42);
  });
});
