/**
 * Coverage for the JNI object/array/string/native-registration slots that the
 * existing jni suites don't reach: RegisterNatives (+ its pointer reads),
 * NewObjectArray with Get/SetObjectArrayElement, GetStringUTFLength,
 * GetObjectClass (both the typed and the fallback branch), the static field
 * getters, GetJavaVM, the three ReleaseByteArrayElements modes, and the
 * GetByteArrayRegion read-back. Each drives the real JNIEnv function table
 * through the same assembled ldr/ldr/blr dispatch a `.so` uses.
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';
import { JniEnvironment, JNI_INDEX } from '@modules/native-emulator/jni';

const le = (w: number): number[] => [
  w & 0xff,
  (w >>> 8) & 0xff,
  (w >>> 16) & 0xff,
  (w >>> 24) & 0xff,
];
const movz = (rd: number, imm: number, hw = 0): number =>
  (0xd2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;
const movReg = (rd: number, rm: number): number => (0xaa000000 | (rm << 16) | (31 << 5) | rd) >>> 0;
const ldrOff = (rt: number, rn: number, byteOff: number): number =>
  (0xf9400000 | ((byteOff / 8) << 10) | (rn << 5) | rt) >>> 0;
const blr = (rn: number): number => (0xd63f0000 | (rn << 5)) >>> 0;
const strb = (rt: number, rn: number, imm = 0): number =>
  (0x39000000 | ((imm & 0xfff) << 10) | (rn << 5) | rt) >>> 0;
const movk = (rd: number, imm: number, hw: number): number =>
  (0xf2800000 | (hw << 21) | ((imm & 0xffff) << 5) | rd) >>> 0;

/** Load a full 64-bit value into rd via MOVZ + MOVK×3 (handles exceed 16-bit movz). */
const movImm64 = (rd: number, value: number): number[] => {
  const v = BigInt(value);
  return [
    movz(rd, Number(v & 0xffffn), 0),
    movk(rd, Number((v >> 16n) & 0xffffn), 1),
    movk(rd, Number((v >> 32n) & 0xffffn), 2),
    movk(rd, Number((v >> 48n) & 0xffffn), 3),
  ];
};

/** ldr x8,[x19] ; ldr x9,[x8,#idx*8] ; blr x9 — dispatch a JNI fn (x19 = env). */
const callJni = (idx: number): number[] => [ldrOff(8, 19, 0), ldrOff(9, 8, idx * 8), blr(9)];

const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

/** Build a little-endian 8-byte pointer. */
const ptr8 = (value: number): Uint8Array => {
  const out = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};

const CODE_ADDR = 0x300000;

/** Assemble a code block from a list of instruction words, run it with x19=env. */
function runJni(jni: JniEnvironment, engine: CpuEngine, words: number[]): void {
  const code: number[] = [];
  for (const w of words) code.push(...le(w));
  engine.mapMemory(CODE_ADDR, code.length + 16);
  engine.writeCode(CODE_ADDR, Uint8Array.from(code));
  engine.writeRegister('x19', jni.envPointer());
  engine.start(CODE_ADDR, CODE_ADDR + code.length);
}

describe('JNI RegisterNatives', () => {
  it('reads the JNINativeMethod[] array and records the native binding', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const clazz = jni.defineClass('com/app/Native');

    // Lay out one JNINativeMethod { char* name; char* sig; void* fn } at REC.
    const NAME = 0x4000;
    const SIG = 0x4100;
    const REC = 0x4200;
    engine.mapMemory(NAME, 0x40);
    engine.writeCode(NAME, enc('sign'));
    engine.mapMemory(SIG, 0x40);
    engine.writeCode(SIG, enc('([B)[B'));
    engine.mapMemory(REC, 0x40);
    engine.writeCode(REC, ptr8(NAME));
    engine.writeCode(REC + 8, ptr8(SIG));
    engine.writeCode(REC + 16, ptr8(0xdead00));

    // RegisterNatives(env, clazz, methods=REC, count=1)
    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, clazz),
      movz(2, REC),
      movz(3, 1),
      ...callJni(JNI_INDEX.RegisterNatives),
    ]);

    const binding = jni.nativeBinding('com/app/Native', 'sign', '([B)[B');
    expect(binding).toBeDefined();
    expect(binding?.fnAddr).toBe(0xdead00);
    expect(engine.readRegister('x0')).toBe(0); // JNI_OK
  });
});

describe('JNI object arrays', () => {
  it('NewObjectArray + Set/GetObjectArrayElement round-trips a handle', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const elemClass = jni.defineClass('java/lang/Object');

    // arr = NewObjectArray(len=3, elemClass, init=0) ; x20 = arr
    // SetObjectArrayElement(arr, idx=1, val=0x42)
    // GetObjectArrayElement(arr, idx=1) -> x0
    runJni(jni, engine, [
      movReg(0, 19),
      movz(1, 3),
      movz(2, elemClass),
      movz(3, 0),
      ...callJni(JNI_INDEX.NewObjectArray),
      movReg(20, 0),
      movReg(0, 19),
      movReg(1, 20),
      movz(2, 1),
      movz(3, 0x42),
      ...callJni(JNI_INDEX.SetObjectArrayElement),
      movReg(0, 19),
      movReg(1, 20),
      movz(2, 1),
      ...callJni(JNI_INDEX.GetObjectArrayElement),
    ]);

    expect(engine.readRegister('x0')).toBe(0x42);
  });

  it('GetObjectArrayElement of an out-of-range index returns 0', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    runJni(jni, engine, [
      movReg(0, 19),
      movz(1, 2),
      movz(2, 0),
      movz(3, 0),
      ...callJni(JNI_INDEX.NewObjectArray),
      movReg(20, 0),
      movReg(0, 19),
      movReg(1, 20),
      movz(2, 99),
      ...callJni(JNI_INDEX.GetObjectArrayElement),
    ]);
    expect(engine.readRegister('x0')).toBe(0);
  });
});

describe('JNI strings & class', () => {
  it('GetStringUTFLength returns the UTF-8 byte length', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const BYTES = 0x4000;
    engine.mapMemory(BYTES, 0x40);
    engine.writeCode(BYTES, enc('héllo')); // é = 2 UTF-8 bytes → length 6

    // s = NewStringUTF(BYTES) ; GetStringUTFLength(s)
    runJni(jni, engine, [
      movReg(0, 19),
      movz(1, BYTES),
      ...callJni(JNI_INDEX.NewStringUTF),
      movReg(20, 0),
      movReg(0, 19),
      movReg(1, 20),
      ...callJni(JNI_INDEX.GetStringUTFLength),
    ]);
    expect(engine.readRegister('x0')).toBe(6);
  });

  it('GetObjectClass falls back to java/lang/Object for a plain string handle', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const strHandle = jni.allocHandle({ kind: 'string', value: 'x' });

    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, strHandle),
      ...callJni(JNI_INDEX.GetObjectClass),
    ]);
    const clsHandle = engine.readRegister('x0');
    expect(jni.classNameOf(clsHandle)).toBe('java/lang/Object');
  });

  it('GetObjectClass resolves the declared class of a handle that carries one', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const objHandle = jni.allocHandle({ kind: 'object', cls: 'com/app/Widget' });

    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, objHandle),
      ...callJni(JNI_INDEX.GetObjectClass),
    ]);
    expect(jni.classNameOf(engine.readRegister('x0'))).toBe('com/app/Widget');
  });
});

describe('JNI static fields', () => {
  it('GetStaticFieldID + GetStaticIntField returns the registered value', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const clazz = jni.defineClass('com/app/Config');
    jni.registerJavaField('com/app/Config', 'VERSION', 'I', 42n);

    const NAME = 0x4000;
    const SIG = 0x4100;
    engine.mapMemory(NAME, 0x40);
    engine.writeCode(NAME, enc('VERSION'));
    engine.mapMemory(SIG, 0x40);
    engine.writeCode(SIG, enc('I'));

    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, clazz),
      movz(2, NAME),
      movz(3, SIG),
      ...callJni(JNI_INDEX.GetStaticFieldID),
      movReg(21, 0),
      movReg(0, 19),
      ...movImm64(1, clazz),
      movReg(2, 21),
      ...callJni(JNI_INDEX.GetStaticIntField),
    ]);
    expect(engine.readRegister('x0')).toBe(42);
  });
});

describe('JNI GetJavaVM', () => {
  it('writes the JavaVM pointer into the out slot and returns 0', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const OUT = 0x5000;
    engine.mapMemory(OUT, 0x10);

    runJni(jni, engine, [movReg(0, 19), movz(1, OUT), ...callJni(JNI_INDEX.GetJavaVM)]);

    expect(engine.readRegister('x0')).toBe(0);
    const written = engine.readMemory(OUT, 8);
    let value = 0;
    for (let i = 0; i < 8; i++) value += written[i]! * 2 ** (i * 8);
    expect(value).toBe(jni.javaVmPointer());
  });
});

describe('JNI byte-array region & release modes', () => {
  it('GetByteArrayRegion copies array bytes into a guest buffer', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    // Pre-seed an array handle with known bytes.
    const arr = jni.allocHandle({ kind: 'bytes', value: Uint8Array.from([1, 2, 3, 4, 5]) });
    const OUT = 0x5000;
    engine.mapMemory(OUT, 0x10);

    // GetByteArrayRegion(arr, start=1, len=3, buf=OUT)
    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, arr),
      movz(2, 1),
      movz(3, 3),
      movz(4, OUT),
      ...callJni(JNI_INDEX.GetByteArrayRegion),
    ]);
    expect([...engine.readMemory(OUT, 3)]).toEqual([2, 3, 4]);
  });

  // GetByteArrayElements(arr) → ptr ; native writes 0xAB at ptr[0] ; Release(arr, ptr, mode).
  // mode 0/1 commit the edit back to the array handle, mode 2 (JNI_ABORT) discards it.
  const runRelease = (mode: number): { jni: JniEnvironment; arr: number } => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const arr = jni.allocHandle({
      kind: 'bytes',
      value: Uint8Array.from([0x11, 0x22, 0x33, 0x44]),
    });
    runJni(jni, engine, [
      // ptr = GetByteArrayElements(arr, isCopy=0) ; x20 = ptr
      movReg(0, 19),
      ...movImm64(1, arr),
      movz(2, 0),
      ...callJni(JNI_INDEX.GetByteArrayElements),
      movReg(20, 0),
      // *(byte*)ptr = 0xAB
      movz(1, 0xab),
      strb(1, 20, 0),
      // ReleaseByteArrayElements(env, arr, ptr, mode)
      movReg(0, 19),
      ...movImm64(1, arr),
      movReg(2, 20),
      movz(3, mode),
      ...callJni(JNI_INDEX.ReleaseByteArrayElements),
    ]);
    return { jni, arr };
  };

  it('mode 0 commits the native edit back to the array', () => {
    const { jni, arr } = runRelease(0);
    const value = jni.valueOf(arr) as { value: Uint8Array };
    expect(value.value[0]).toBe(0xab);
  });

  it('mode 2 (JNI_ABORT) discards the native edit', () => {
    const { jni, arr } = runRelease(2);
    const value = jni.valueOf(arr) as { value: Uint8Array };
    expect(value.value[0]).toBe(0x11); // unchanged
  });
});

describe('JNI fallback branches — invalid handles & unregistered ids', () => {
  // Each call hits the "wrong kind / not found / null" branch of a JNI slot,
  // which must degrade to a benign zero/empty rather than fault.
  const run = (jni: JniEnvironment, engine: CpuEngine, words: number[]): number => {
    runJni(jni, engine, words);
    return engine.readRegister('x0');
  };

  it('typed getters/length on a non-matching handle return 0 or empty', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    // A 'string' handle fed to array/byte ops; a 'bytes' handle fed to string ops.
    const strH = jni.allocHandle({ kind: 'string', value: 'hi' });
    const bytesH = jni.allocHandle({ kind: 'bytes', value: Uint8Array.from([9, 9]) });

    // GetArrayLength(strH) → 0 (not a bytes value)
    expect(
      run(jni, engine, [movReg(0, 19), ...movImm64(1, strH), ...callJni(JNI_INDEX.GetArrayLength)]),
    ).toBe(0);
    // GetStringUTFLength(bytesH) → 0 (not a string value)
    expect(
      run(jni, engine, [
        movReg(0, 19),
        ...movImm64(1, bytesH),
        ...callJni(JNI_INDEX.GetStringUTFLength),
      ]),
    ).toBe(0);
  });

  it('Call*Method / Get*Field with an unregistered id return 0', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const bogusId = jni.allocHandle({ kind: 'method', name: 'x', sig: '()I' });

    // CallIntMethod(self=0, methodId=bogus) → 0 (no impl registered)
    expect(
      run(jni, engine, [
        movReg(0, 19),
        movz(1, 0),
        ...movImm64(2, bogusId),
        ...callJni(JNI_INDEX.CallIntMethod),
      ]),
    ).toBe(0);
    // GetIntField(obj=0, fieldId=bogus) → 0 (no field registered)
    expect(
      run(jni, engine, [
        movReg(0, 19),
        movz(1, 0),
        ...movImm64(2, bogusId),
        ...callJni(JNI_INDEX.GetIntField),
      ]),
    ).toBe(0);
    // GetStaticIntField likewise → 0
    expect(
      run(jni, engine, [
        movReg(0, 19),
        movz(1, 0),
        ...movImm64(2, bogusId),
        ...callJni(JNI_INDEX.GetStaticIntField),
      ]),
    ).toBe(0);
  });

  it('IsSameObject returns 0 for distinct handles, 1 for identical', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    expect(
      run(jni, engine, [
        movReg(0, 19),
        movz(1, 0x11),
        movz(2, 0x22),
        ...callJni(JNI_INDEX.IsSameObject),
      ]),
    ).toBe(0);
    expect(
      run(jni, engine, [
        movReg(0, 19),
        movz(1, 0x33),
        movz(2, 0x33),
        ...callJni(JNI_INDEX.IsSameObject),
      ]),
    ).toBe(1);
  });

  it('NewStringUTF on a null pointer yields an empty string (length 0)', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    runJni(jni, engine, [
      movReg(0, 19),
      movz(1, 0), // null bytes pointer → readCString returns ''
      ...callJni(JNI_INDEX.NewStringUTF),
      movReg(20, 0),
      movReg(0, 19),
      movReg(1, 20),
      ...callJni(JNI_INDEX.GetStringUTFLength),
    ]);
    expect(engine.readRegister('x0')).toBe(0);
  });

  it('SetByteArrayRegion on a non-bytes handle is a silent no-op', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const strH = jni.allocHandle({ kind: 'string', value: 'x' });
    const SRC = 0x5000;
    engine.mapMemory(SRC, 0x10);
    engine.writeCode(SRC, Uint8Array.from([1, 2]));
    // Must not throw; x0 is irrelevant (void).
    runJni(jni, engine, [
      movReg(0, 19),
      ...movImm64(1, strH),
      movz(2, 0),
      movz(3, 2),
      movz(4, SRC),
      ...callJni(JNI_INDEX.SetByteArrayRegion),
    ]);
    expect((jni.valueOf(strH) as { kind: string }).kind).toBe('string'); // untouched
  });
});
