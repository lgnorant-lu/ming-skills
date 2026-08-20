import type { EmulatorSession } from '@modules/native-emulator/SessionManager';
import type { JavaMethodCall } from '@modules/native-emulator/jni';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import { ToolError } from '@errors/ToolError';
import type { ToolArgs } from '@server/types';
import { toUint8 } from './handler-memory';

/** JNI class descriptor for java.lang.String — used on every jstring mock handle. */
const JNI_JAVA_LANG_STRING = 'java/lang/String';

/** JNI class descriptor for a generic Object[] — used on objarray mock handles. */
const JNI_JAVA_LANG_OBJECT_ARRAY = '[Ljava/lang/Object;';

export interface JavaMockImpl {
  kind: 'int' | 'string' | 'bytes' | 'void' | 'conditional';
  fn: (call: JavaMethodCall) => bigint | number | void;
}

export interface JavaFieldValue {
  kind: 'int' | 'string' | 'bytes';
  value: bigint;
}

interface ConditionalEntry {
  type: 'int' | 'string' | 'bytes' | 'boolean';
  value: string; // raw: number string for int, "true"/"false" for boolean, plain string, or base64 for bytes
}

function providedKeys(args: ToolArgs, keys: string[]): string[] {
  return keys.filter((key) => args[key] !== undefined && args[key] !== null);
}

function assertSingleJavaMockReturn(args: ToolArgs): void {
  // returnMap pairs with an optional fallback (returnInt/returnString/returnBytes).
  // Without returnMap, at most one return type is allowed.
  const singles = providedKeys(args, [
    'returnInt',
    'returnString',
    'returnBytes',
    'returnObject',
    'returnArray',
  ]);
  if (singles.length > 1) {
    throw new Error(
      'returnInt, returnString, and returnBytes are mutually exclusive; provide at most one.',
    );
  }
}

function assertSingleJavaFieldValue(args: ToolArgs): void {
  const provided = providedKeys(args, ['valueInt', 'valueString', 'valueBytes']);
  if (provided.length > 1) {
    throw new Error(
      'valueInt, valueString, and valueBytes are mutually exclusive; provide only one field value.',
    );
  }
}

/** Resolve a jstring handle to its actual string value. */
function resolveJString(jni: JavaMethodCall['jni'], handle: number): string {
  const v = jni.handles.get(handle);
  if (v && typeof v === 'object') {
    const kind = (v as { kind?: string }).kind;
    // Both 'string' (NewStringUTF) and 'mock-string' (returnString/returnMap) carry a value
    if (kind === 'string' || kind === 'mock-string') {
      return (v as { value: string }).value;
    }
  }
  return '';
}

function buildConditionalDispatcher(
  returnMap: Record<string, ConditionalEntry>,
  defaultReturn: { kind: string; fn: (call: JavaMethodCall) => bigint | number | void },
): (call: JavaMethodCall) => bigint | number | void {
  // Pre-build the return functions for each conditional entry
  const entryFns = new Map<string, (call: JavaMethodCall) => bigint | number | void>();
  for (const [key, entry] of Object.entries(returnMap)) {
    switch (entry.type) {
      case 'int':
        entryFns.set(key, (call) =>
          // HashMap.get returns a jobject handle, not a raw int.
          // Create a self-describing handle so intValue() can unbox it later.
          BigInt(
            call.jni.allocHandle({ kind: 'mock-int', value: Math.trunc(Number(entry.value)) }),
          ),
        );
        break;
      case 'boolean':
        entryFns.set(key, (call) =>
          BigInt(call.jni.allocHandle({ kind: 'mock-boolean', value: entry.value === 'true' })),
        );
        break;
      case 'string':
        entryFns.set(key, (call) =>
          BigInt(
            call.jni.allocHandle({
              kind: 'mock-string',
              value: entry.value,
              cls: JNI_JAVA_LANG_STRING,
            }),
          ),
        );
        break;
      case 'bytes': {
        const entryBytes = toUint8(Buffer.from(entry.value, 'base64'));
        entryFns.set(key, (call) =>
          BigInt(call.jni.allocHandle({ kind: 'bytes', value: entryBytes })),
        );
        break;
      }
    }
  }

  return (call: JavaMethodCall) => {
    // args[0] is the first Java argument (the key for HashMap.get)
    const keyHandle = Number(call.args[0] ?? 0n);
    const keyStr = resolveJString(call.jni, keyHandle);
    const matchFn = entryFns.get(keyStr);
    if (matchFn) return matchFn(call);
    // Fall back to the default return (single-value constant or void)
    return defaultReturn.fn(call);
  };
}

export function buildJavaMockImpl(args: ToolArgs): JavaMockImpl {
  assertSingleJavaMockReturn(args);
  const returnInt = argNumber(args, 'returnInt');
  const returnString = argString(args, 'returnString');
  const returnBytes = argString(args, 'returnBytes');
  const returnObject = argString(args, 'returnObject');
  const returnArray = argString(args, 'returnArray');
  const returnMapRaw = argString(args, 'returnMap');

  // Build a base/default return fn (used for unmatched keys in conditional mode,
  // or as the sole return in simple mode).
  let defaultFn: (call: JavaMethodCall) => bigint | number | void;
  let defaultKind: string;

  if (returnInt !== undefined) {
    defaultFn = () => BigInt(Math.trunc(returnInt));
    defaultKind = 'int';
  } else if (returnString !== undefined) {
    defaultFn = (call) =>
      BigInt(
        call.jni.allocHandle({
          kind: 'mock-string',
          value: returnString,
          cls: JNI_JAVA_LANG_STRING,
        }),
      );
    defaultKind = 'string';
  } else if (returnArray !== undefined) {
    let arr: bigint[];
    try {
      const parsed: unknown = JSON.parse(returnArray);
      if (!Array.isArray(parsed)) {
        throw new Error(`expected a JSON array, got ${typeof parsed}`);
      }
      arr = parsed.map((n: unknown) => BigInt(Math.trunc(Number(n))));
    } catch (error) {
      // A malformed returnArray must NOT silently become an empty-array mock —
      // that hides the error and produces a wrong native-call result.
      throw new ToolError(
        'VALIDATION',
        `returnArray must be a JSON array of numbers: ${error instanceof Error ? error.message : String(error)}`,
        { toolName: 'nemu_setup_java_mock' },
      );
    }
    defaultFn = (call) =>
      BigInt(
        call.jni.allocHandle({ kind: 'objarray', value: arr, cls: JNI_JAVA_LANG_OBJECT_ARRAY }),
      );
    defaultKind = 'array';
  } else if (returnObject !== undefined) {
    defaultFn = (call) =>
      BigInt(call.jni.allocHandle({ kind: 'auto-object', desc: returnObject, cls: returnObject }));
    defaultKind = 'object';
  } else if (returnBytes !== undefined) {
    const bytes = toUint8(Buffer.from(returnBytes, 'base64'));
    defaultFn = (call) => BigInt(call.jni.allocHandle({ kind: 'bytes', value: bytes }));
    defaultKind = 'bytes';
  } else {
    defaultFn = () => undefined;
    defaultKind = 'void';
  }

  // If returnMap is provided, wrap in a conditional dispatcher.
  if (returnMapRaw !== undefined) {
    let returnMap: Record<string, ConditionalEntry>;
    try {
      returnMap = JSON.parse(returnMapRaw);
    } catch {
      throw new Error(
        'returnMap must be a valid JSON string, e.g. {"mykey":{"type":"string","value":"hello"}}',
      );
    }
    return {
      kind: 'conditional',
      fn: buildConditionalDispatcher(returnMap, { kind: defaultKind, fn: defaultFn }),
    };
  }

  return { kind: defaultKind as JavaMockImpl['kind'], fn: defaultFn };
}

export function buildJavaFieldValue(session: EmulatorSession, args: ToolArgs): JavaFieldValue {
  assertSingleJavaFieldValue(args);
  const valueInt = argNumber(args, 'valueInt');
  const valueString = argString(args, 'valueString');
  const valueBytes = argString(args, 'valueBytes');

  if (valueInt !== undefined) {
    return { kind: 'int', value: BigInt(Math.trunc(valueInt)) };
  }
  if (valueString !== undefined) {
    const handle = session.emulator.jni.allocHandle({
      kind: 'mock-string',
      value: valueString,
      cls: JNI_JAVA_LANG_STRING,
    });
    return { kind: 'string', value: BigInt(handle) };
  }
  if (valueBytes !== undefined) {
    const bytes = toUint8(Buffer.from(valueBytes, 'base64'));
    const handle = session.emulator.newByteArray(bytes);
    return { kind: 'bytes', value: BigInt(handle) };
  }
  return { kind: 'int', value: 0n };
}
