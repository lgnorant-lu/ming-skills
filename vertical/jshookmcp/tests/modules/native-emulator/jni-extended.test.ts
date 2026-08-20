/**
 * L8 TDD — extended JNI table (Phase 3): fields, exceptions, references.
 *
 * Pins the slots added beyond the method-call core: GetFieldID + Get<Type>Field
 * returning a registered mock field value, the exception model
 * (Throw/ExceptionCheck/ExceptionClear), and reference identity
 * (NewGlobalRef/IsSameObject). Native code reaches these through the JNIEnv
 * function table exactly as a real `.so` does; we assemble the table-dispatch
 * sequence and assert the observable result in x0.
 *
 * Encoders mirror jni-reflection.test.ts (assembler-verified subset).
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

/** ldr x8,[x19] ; ldr x9,[x8,#idx*8] ; blr x9 — dispatch a JNI fn (x19 = env). */
const callJni = (idx: number): number[] => [
  ...le(ldrOff(8, 19, 0)),
  ...le(ldrOff(9, 8, idx * 8)),
  ...le(blr(9)),
];

const enc = (s: string): Uint8Array => new TextEncoder().encode(`${s}\0`);

const CLASS_ADDR = 0x4000;
const NAME_ADDR = 0x4100;
const SIG_ADDR = 0x4200;
const CODE_ADDR = 0x300000;

describe('JNI extended — field access', () => {
  it('GetFieldID + GetIntField returns the registered mock field value', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    jni.defineClass('com/app/Config');
    jni.registerJavaField('com/app/Config', 'magic', 'I', 1337n);

    // FindClass("com/app/Config") → x20
    // GetFieldID(clazz,"magic","I") → x21
    // GetIntField(thiz=clazz, fieldId) → x0
    const code: number[] = [];
    const emit = (...w: number[]): void => {
      for (const x of w) code.push(...le(x));
    };
    emit(movReg(0, 19), movz(1, CLASS_ADDR));
    code.push(...callJni(JNI_INDEX.FindClass));
    emit(movReg(20, 0));
    emit(movReg(0, 19), movReg(1, 20), movz(2, NAME_ADDR), movz(3, SIG_ADDR));
    code.push(...callJni(JNI_INDEX.GetFieldID));
    emit(movReg(21, 0));
    emit(movReg(0, 19), movReg(1, 20), movReg(2, 21));
    code.push(...callJni(JNI_INDEX.GetIntField));

    engine.mapMemory(CODE_ADDR, code.length + 16);
    engine.writeCode(CODE_ADDR, Uint8Array.from(code));
    engine.mapMemory(CLASS_ADDR, 0x300);
    engine.writeCode(CLASS_ADDR, enc('com/app/Config'));
    engine.writeCode(NAME_ADDR, enc('magic'));
    engine.writeCode(SIG_ADDR, enc('I'));
    engine.writeRegister('x19', jni.envPointer());
    engine.start(CODE_ADDR, CODE_ADDR + code.length);

    expect(engine.readRegister('x0')).toBe(1337);
  });
});

describe('JNI extended — exception model', () => {
  it('ExceptionCheck reports 0 initially, 1 after Throw, 0 after Clear', () => {
    // Fresh engine+jni per program so each run executes only its own code (a
    // shared, re-mapped region would leave stale zero padding past the body).
    const run = (body: number[]): number => {
      const engine = new CpuEngine();
      const jni = new JniEnvironment(engine);
      engine.mapMemory(CODE_ADDR, body.length + 16);
      engine.writeCode(CODE_ADDR, Uint8Array.from(body));
      engine.writeRegister('x19', jni.envPointer());
      engine.start(CODE_ADDR, CODE_ADDR + body.length);
      return engine.readRegister('x0');
    };

    // Initial: ExceptionCheck() → 0
    expect(run([...callJni(JNI_INDEX.ExceptionCheck)])).toBe(0);

    // Throw a fake throwable handle (x1 = 0xbeef), then ExceptionCheck() → 1
    const afterThrow: number[] = [];
    const emit = (...w: number[]): void => {
      for (const x of w) afterThrow.push(...le(x));
    };
    emit(movReg(0, 19), movz(1, 0xbeef));
    afterThrow.push(...callJni(JNI_INDEX.Throw));
    afterThrow.push(...callJni(JNI_INDEX.ExceptionCheck));
    expect(run(afterThrow)).toBe(1);

    // Within one session: Throw then Clear then Check → 0.
    const throwClearCheck: number[] = [];
    const emit2 = (...w: number[]): void => {
      for (const x of w) throwClearCheck.push(...le(x));
    };
    emit2(movReg(0, 19), movz(1, 0xbeef));
    throwClearCheck.push(...callJni(JNI_INDEX.Throw));
    throwClearCheck.push(...callJni(JNI_INDEX.ExceptionClear));
    throwClearCheck.push(...callJni(JNI_INDEX.ExceptionCheck));
    expect(run(throwClearCheck)).toBe(0);
  });
});

describe('JNI extended — references', () => {
  it('IsSameObject is true for a handle vs its NewGlobalRef', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const obj = jni.allocHandle({ kind: 'string', value: 'x' });

    // r = NewGlobalRef(obj) ; IsSameObject(obj, r) → expect 1.
    // obj is preset in x22 to avoid building a 32-bit immediate inline.
    engine.writeRegister('x22', obj);
    const code: number[] = [];
    const emit = (...w: number[]): void => {
      for (const x of w) code.push(...le(x));
    };
    emit(movReg(0, 19), movReg(1, 22));
    code.push(...callJni(JNI_INDEX.NewGlobalRef)); // x0 = global ref
    emit(movReg(23, 0)); // x23 = ref
    emit(movReg(0, 19), movReg(1, 22), movReg(2, 23));
    code.push(...callJni(JNI_INDEX.IsSameObject));

    engine.mapMemory(CODE_ADDR, code.length + 16);
    engine.writeCode(CODE_ADDR, Uint8Array.from(code));
    engine.writeRegister('x19', jni.envPointer());
    engine.start(CODE_ADDR, CODE_ADDR + code.length);

    expect(engine.readRegister('x0')).toBe(1);
  });
});

describe('JNI extended — GetArrayLength', () => {
  // GetArrayLength(env, array): x0 = env (preset in x19), x1 = array handle
  // (preset in x22 — handles are 32-bit guest addresses, awkward as inline imm).
  const lengthOf = (jni: JniEnvironment, engine: CpuEngine, handle: number): number => {
    engine.writeRegister('x22', handle);
    const code: number[] = [];
    for (const x of [movReg(0, 19), movReg(1, 22)]) code.push(...le(x));
    code.push(...callJni(JNI_INDEX.GetArrayLength));
    engine.mapMemory(CODE_ADDR, code.length + 16);
    engine.writeCode(CODE_ADDR, Uint8Array.from(code));
    engine.writeRegister('x19', jni.envPointer());
    engine.start(CODE_ADDR, CODE_ADDR + code.length);
    return engine.readRegister('x0');
  };

  it('reports the real length of an object array (String[]) — drives native for-loops', () => {
    // Regression: an objarray previously returned 0, so a native
    // `for (i=0; i<GetArrayLength(paths); i++)` loop (RootBeer's checkForRoot)
    // never iterated. It must report the element count.
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const elems = ['/system/xbin/su', '/sbin/su', '/data/local/su'].map((p) =>
      BigInt(jni.allocHandle({ kind: 'string', value: p })),
    );
    const arr = jni.allocHandle({ kind: 'objarray', value: elems });
    expect(lengthOf(jni, engine, arr)).toBe(3);
  });

  it('reports the real length of a byte array', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const arr = jni.allocHandle({ kind: 'bytes', value: new Uint8Array(7) });
    expect(lengthOf(jni, engine, arr)).toBe(7);
  });

  it('returns 0 for a non-array handle', () => {
    const engine = new CpuEngine();
    const jni = new JniEnvironment(engine);
    const str = jni.allocHandle({ kind: 'string', value: 'not-an-array' });
    expect(lengthOf(jni, engine, str)).toBe(0);
  });
});
