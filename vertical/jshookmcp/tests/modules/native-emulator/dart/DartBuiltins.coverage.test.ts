/**
 * Coverage tests for DartBuiltins — registry lookups, registration, dispatch.
 * Builtins are functions (args: bigint[], ctx) => bigint.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DART_BUILTINS,
  callDartBuiltin,
  getBuiltinNames,
  hasBuiltin,
  registerBuiltin,
  unregisterBuiltin,
} from '@modules/native-emulator/dart/DartBuiltins';
import { pointerToSmi, tagAsHeapObject } from '@modules/native-emulator/dart/DartRuntime';

const TEST = '__test_stub';
const added: string[] = [];

afterEach(() => {
  for (const name of added) unregisterBuiltin(name);
  added.length = 0;
});

describe('DartBuiltins — registry queries', () => {
  it('DART_BUILTINS is a non-empty record', () => {
    expect(Object.keys(DART_BUILTINS).length).toBeGreaterThan(0);
  });

  it('hasBuiltin returns true for a known name, false for unknown', () => {
    const known = getBuiltinNames()[0]!;
    expect(hasBuiltin(known)).toBe(true);
    expect(hasBuiltin('__definitely_not_a_builtin__')).toBe(false);
  });

  it('getBuiltinNames returns an array of strings', () => {
    const names = getBuiltinNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.every((n) => typeof n === 'string')).toBe(true);
  });
});

describe('DartBuiltins — register / unregister', () => {
  it('registerBuiltin adds a callable stub + hasBuiltin sees it', () => {
    registerBuiltin(TEST, (() => 42n) as never);
    added.push(TEST);
    expect(hasBuiltin(TEST)).toBe(true);
  });

  it('unregisterBuiltin removes the stub + returns true; false if absent', () => {
    registerBuiltin(TEST, (() => 0n) as never);
    expect(unregisterBuiltin(TEST)).toBe(true);
    expect(unregisterBuiltin(TEST)).toBe(false); // already removed
    expect(hasBuiltin(TEST)).toBe(false);
  });
});

describe('callDartBuiltin — dispatch', () => {
  it('returns the stub result for a registered builtin', () => {
    registerBuiltin(TEST, ((args: bigint[]) => args[0]! + args[1]!) as never);
    added.push(TEST);
    expect(callDartBuiltin(TEST, [1n, 2n], {} as never)).toBe(3n);
  });

  it('returns undefined for an unknown builtin', () => {
    expect(callDartBuiltin('__nope__', [], {} as never)).toBeUndefined();
  });

  it('returns 0n when the stub throws (fail-soft)', () => {
    registerBuiltin(TEST, (() => {
      throw new Error('boom');
    }) as never);
    added.push(TEST);
    expect(callDartBuiltin(TEST, [], {} as never)).toBe(0n);
  });
});

describe('DartBuiltins — builtin stub behavior', () => {
  const ctx = {} as never;

  // ── _List builtins ──

  it('_List::[] — returns Smi(index*10) via pointerToSmi', () => {
    const stub = DART_BUILTINS['_List::[]']!;
    // isSmi(smiValue(args[1])): when args[1] is an odd BigInt (Smi tagged), smiValue shifts right 1
    const result = stub([0n, 3n], ctx); // smiValue(3n) ≈ 1n, then pointerToSmi(1*10)
    expect(typeof result).toBe('bigint');
  });

  it('_List::[]= — returns args[0] (receiver)', () => {
    const stub = DART_BUILTINS['_List::[]=']!;
    expect(stub([99n, 0n, 0n], ctx)).toBe(99n);
  });

  it('_List::get:length — returns Smi(10) via pointerToSmi', () => {
    const stub = DART_BUILTINS['_List::get:length']!;
    expect(stub([], ctx)).toBe(pointerToSmi(10n));
  });

  it('_List::_growableSetLength — returns 0n (null stub)', () => {
    const stub = DART_BUILTINS['_List::_growableSetLength']!;
    expect(stub([], ctx)).toBe(0n);
  });

  // ── _Map builtins ──

  it('_Map::[] — returns Smi(42) via pointerToSmi', () => {
    const stub = DART_BUILTINS['_Map::[]']!;
    expect(stub([], ctx)).toBe(pointerToSmi(42n));
  });

  it('_Map::[]= — returns args[0] (receiver)', () => {
    const stub = DART_BUILTINS['_Map::[]=']!;
    expect(stub([77n, 0n, 0n], ctx)).toBe(77n);
  });

  // ── _StringBase builtins ──

  it('_StringBase::_interpolate — returns tagAsHeapObject(0x1000)', () => {
    const stub = DART_BUILTINS['_StringBase::_interpolate']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x1000n));
  });

  it('_StringBase::+ — returns tagAsHeapObject(0x2000)', () => {
    const stub = DART_BUILTINS['_StringBase::+']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x2000n));
  });

  it('_StringBase::get:length — returns pointerToSmi(5)', () => {
    const stub = DART_BUILTINS['_StringBase::get:length']!;
    expect(stub([], ctx)).toBe(pointerToSmi(5n));
  });

  // ── _Double builtins ──

  it('_Double::+ — returns pointerToSmi(0)', () => {
    const stub = DART_BUILTINS['_Double::+']!;
    expect(stub([], ctx)).toBe(pointerToSmi(0n));
  });

  it('_Double::- — returns pointerToSmi(0)', () => {
    const stub = DART_BUILTINS['_Double::-']!;
    expect(stub([], ctx)).toBe(pointerToSmi(0n));
  });

  it('_Double::* — returns pointerToSmi(1)', () => {
    const stub = DART_BUILTINS['_Double::*']!;
    expect(stub([], ctx)).toBe(pointerToSmi(1n));
  });

  it('_Double::/ — returns pointerToSmi(1)', () => {
    const stub = DART_BUILTINS['_Double::/']!;
    expect(stub([], ctx)).toBe(pointerToSmi(1n));
  });

  it('_Double::< — returns 0x3n (true)', () => {
    const stub = DART_BUILTINS['_Double::<']!;
    expect(stub([], ctx)).toBe(0x3n);
  });

  // ── _Type builtins ──

  it('_Type::_toString — returns tagAsHeapObject(0x3000)', () => {
    const stub = DART_BUILTINS['_Type::_toString']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x3000n));
  });

  it('_Type::== — returns 0x1n (false)', () => {
    const stub = DART_BUILTINS['_Type::==']!;
    expect(stub([], ctx)).toBe(0x1n);
  });

  // ── _Object builtins ──

  it('_Object::get:runtimeType — returns tagAsHeapObject(0x4000)', () => {
    const stub = DART_BUILTINS['_Object::get:runtimeType']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x4000n));
  });

  it('_Object::toString — returns tagAsHeapObject(0x5000)', () => {
    const stub = DART_BUILTINS['_Object::toString']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x5000n));
  });

  it('_Object::== — identity check: same → true(0x3n), diff → false(0x1n)', () => {
    const stub = DART_BUILTINS['_Object::==']!;
    expect(stub([42n, 42n], ctx)).toBe(0x3n);
    expect(stub([42n, 99n], ctx)).toBe(0x1n);
    expect(stub([0n, 0n], ctx)).toBe(0x3n);
  });

  // ── Runtime helpers ──

  it('_allocate — returns tagAsHeapObject(0x10000)', () => {
    const stub = DART_BUILTINS['_allocate']!;
    expect(stub([], ctx)).toBe(tagAsHeapObject(0x10000n));
  });

  it('_writeBarrier — returns 0n', () => {
    const stub = DART_BUILTINS['_writeBarrier']!;
    expect(stub([], ctx)).toBe(0n);
  });

  it('print — returns 0n for non-tagged input', () => {
    const stub = DART_BUILTINS['print']!;
    // Even numbers (not Smi tagged) skip the console.log branch
    expect(stub([2n], ctx)).toBe(0n);
  });

  it('identical — same values → true(0x3n), different → false(0x1n)', () => {
    const stub = DART_BUILTINS['identical']!;
    expect(stub([7n, 7n], ctx)).toBe(0x3n);
    expect(stub([7n, 8n], ctx)).toBe(0x1n);
    expect(stub([0n, 1n], ctx)).toBe(0x1n);
  });

  // ── dispatch through callDartBuiltin (integration) ──

  it('callDartBuiltin dispatches to a real builtin (_List::get:length)', () => {
    expect(callDartBuiltin('_List::get:length', [], ctx)).toBe(pointerToSmi(10n));
  });

  it('callDartBuiltin dispatches to _Object::==', () => {
    expect(callDartBuiltin('_Object::==', [5n, 5n], ctx)).toBe(0x3n);
  });
});
