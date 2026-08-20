/**
 * DartBuiltins — host stubs for Dart VM built-in functions.
 *
 * Dart's compiled code calls into VM built-in functions for:
 *  - Collection operations (_List::[], _Map::[], etc.)
 *  - String operations (_StringBase::_interpolate, _StringBase::+, etc.)
 *  - Type operations (_Type::_toString, _Type::==, etc.)
 *  - Arithmetic on boxed types (_Double::+, _Double::*, etc.)
 *  - Runtime helpers (_allocate, _writeBarrier, etc.)
 *
 * This module provides **simplified host stubs** that return mock values,
 * allowing Dart code to run without a full Dart VM runtime. These are not
 * semantically correct implementations — they exist to prevent crashes and
 * let control flow continue for analysis purposes.
 *
 * Real implementations would require:
 *  - Full Dart object model (heap layout, GC, etc.)
 *  - Type system implementation
 *  - String/collection internals
 *
 * References:
 *  - Dart SDK: `runtime/lib/` (built-in implementations)
 *  - Dart SDK: `runtime/vm/bootstrap_natives.h` (native entry points)
 */

import type { HostContext } from '../CpuEngine';
import { isSmi, smiValue, pointerToSmi, tagAsHeapObject } from './DartRuntime';

/**
 * A Dart built-in function stub.
 * Receives arguments as an array of BigInt values and returns a result.
 */
export type DartBuiltinStub = (args: bigint[], ctx: HostContext) => bigint;

/**
 * Registry of Dart built-in functions, keyed by mangled name.
 *
 * Naming convention: `_ClassName::methodName` (e.g., `_List::[]`).
 *
 * These are **mock implementations** that return plausible values to keep
 * execution flowing. They do NOT implement real Dart semantics.
 */
export const DART_BUILTINS: Record<string, DartBuiltinStub> = {
  /**
   * _List::[] — list indexing operator.
   * Args: [list object, index (Smi)]
   * Returns: element at index (mocked as Smi derived from index)
   */
  '_List::[]': (args) => {
    if (args.length < 2) return 0n;
    const index = isSmi(args[1] ?? 0n) ? smiValue(args[1] ?? 0n) : 0n;
    // Mock: return Smi(index * 10)
    return pointerToSmi(index * 10n);
  },

  /**
   * _List::[]= — list assignment operator.
   * Args: [list object, index (Smi), value]
   * Returns: the list object (convention: setters return receiver)
   */
  '_List::[]=': (args) => {
    // No-op: we don't maintain a real list structure
    return args[0] ?? 0n;
  },

  /**
   * _List::get:length — list length getter.
   * Args: [list object]
   * Returns: length (mocked as Smi(10))
   */
  '_List::get:length': () => {
    // Mock: all lists have length 10
    return pointerToSmi(10n);
  },

  /**
   * _List::_growableSetLength — set growable list length.
   * Args: [list object, new length (Smi)]
   * Returns: null
   */
  '_List::_growableSetLength': () => {
    return 0n; // Return null (stub)
  },

  /**
   * _Map::[] — map indexing operator.
   * Args: [map object, key]
   * Returns: value at key (mocked as Smi(42))
   */
  '_Map::[]': () => {
    return pointerToSmi(42n);
  },

  /**
   * _Map::[]= — map assignment operator.
   * Args: [map object, key, value]
   * Returns: the map object
   */
  '_Map::[]=': (args) => {
    return args[0] ?? 0n;
  },

  /**
   * _StringBase::_interpolate — string interpolation.
   * Args: [array of values to interpolate]
   * Returns: a string object (mocked as heap object at 0x1000)
   */
  '_StringBase::_interpolate': () => {
    // Mock: return a fake string object
    return tagAsHeapObject(0x1000n);
  },

  /**
   * _StringBase::+ — string concatenation.
   * Args: [this (string), other (string)]
   * Returns: concatenated string (mocked as heap object at 0x2000)
   */
  '_StringBase::+': () => {
    return tagAsHeapObject(0x2000n);
  },

  /**
   * _StringBase::get:length — string length getter.
   * Args: [this (string)]
   * Returns: length (mocked as Smi(5))
   */
  '_StringBase::get:length': () => {
    return pointerToSmi(5n);
  },

  /**
   * _Double::+ — double addition.
   * Args: [this (double), other (double)]
   * Returns: sum (mocked as Smi(0))
   */
  '_Double::+': () => {
    // Real implementation would box the result
    return pointerToSmi(0n);
  },

  /**
   * _Double::- — double subtraction.
   * Args: [this (double), other (double)]
   * Returns: difference (mocked as Smi(0))
   */
  '_Double::-': () => {
    return pointerToSmi(0n);
  },

  /**
   * _Double::* — double multiplication.
   * Args: [this (double), other (double)]
   * Returns: product (mocked as Smi(1))
   */
  '_Double::*': () => {
    return pointerToSmi(1n);
  },

  /**
   * _Double::/ — double division.
   * Args: [this (double), other (double)]
   * Returns: quotient (mocked as Smi(1))
   */
  '_Double::/': () => {
    return pointerToSmi(1n);
  },

  /**
   * _Double::< — double less-than comparison.
   * Args: [this (double), other (double)]
   * Returns: bool (mocked as true = 0x3)
   */
  '_Double::<': () => {
    // Dart bool true is tagged as 0x3, false as 0x1
    return 0x3n;
  },

  /**
   * _Type::_toString — type to string conversion.
   * Args: [this (Type object)]
   * Returns: string representation (mocked as heap object at 0x3000)
   */
  '_Type::_toString': () => {
    return tagAsHeapObject(0x3000n);
  },

  /**
   * _Type::== — type equality.
   * Args: [this (Type), other (Type)]
   * Returns: bool (mocked as false = 0x1)
   */
  '_Type::==': () => {
    return 0x1n; // false
  },

  /**
   * _Object::get:runtimeType — get runtime type of object.
   * Args: [this (Object)]
   * Returns: Type object (mocked as heap object at 0x4000)
   */
  '_Object::get:runtimeType': () => {
    return tagAsHeapObject(0x4000n);
  },

  /**
   * _Object::toString — object to string conversion.
   * Args: [this (Object)]
   * Returns: string (mocked as heap object at 0x5000)
   */
  '_Object::toString': () => {
    return tagAsHeapObject(0x5000n);
  },

  /**
   * _Object::== — object equality.
   * Args: [this (Object), other (Object)]
   * Returns: bool (mocked as false = 0x1)
   */
  '_Object::==': (args) => {
    // Simple identity check
    const a = args[0] ?? 0n;
    const b = args[1] ?? 0n;
    return a === b ? 0x3n : 0x1n;
  },

  /**
   * _allocate — allocate a Dart object.
   * Args: [class ID (Smi), size (Smi)]
   * Returns: allocated object (mocked as heap object at 0x10000)
   */
  _allocate: () => {
    // Mock: return a fake heap object
    return tagAsHeapObject(0x10000n);
  },

  /**
   * _writeBarrier — write barrier for GC.
   * Args: [object, slot, value]
   * Returns: void (returns 0)
   */
  _writeBarrier: () => {
    return 0n;
  },

  /**
   * print — Dart print function.
   * Args: [string object]
   * Returns: null
   */
  print: (args) => {
    // Try to read the string if it's a heap object (simplified)
    const str = args[0];
    if (str && (str & 0x1n) === 0x1n) {
      // In a real implementation, we'd dereference and read the string bytes
      console.log(`[Dart print] 0x${str.toString(16)}`);
    }
    return 0n; // null
  },

  /**
   * identical — Dart identical() built-in function.
   * Args: [a, b]
   * Returns: bool (true if identical)
   */
  identical: (args) => {
    const a = args[0] ?? 0n;
    const b = args[1] ?? 0n;
    return a === b ? 0x3n : 0x1n;
  },
};

/**
 * Call a Dart built-in function by name.
 *
 * @param name - Mangled function name (e.g., "_List::[]")
 * @param args - Array of argument values (BigInt)
 * @param ctx - Host context (for memory access if needed)
 * @returns The return value, or undefined if the built-in is not registered
 */
export function callDartBuiltin(
  name: string,
  args: bigint[],
  ctx: HostContext,
): bigint | undefined {
  const builtin = DART_BUILTINS[name];
  if (!builtin) return undefined;

  try {
    return builtin(args, ctx);
  } catch (error) {
    console.error(`[DartBuiltins] Error calling ${name}:`, error);
    return 0n; // Return null on error
  }
}

/**
 * Check if a built-in function is registered.
 */
export function hasBuiltin(name: string): boolean {
  return name in DART_BUILTINS;
}

/**
 * Get all registered built-in function names.
 */
export function getBuiltinNames(): string[] {
  return Object.keys(DART_BUILTINS);
}

/**
 * Register a custom built-in stub (for testing or extensions).
 *
 * @param name - Function name
 * @param stub - Implementation
 */
export function registerBuiltin(name: string, stub: DartBuiltinStub): void {
  DART_BUILTINS[name] = stub;
}

/**
 * Unregister a built-in stub.
 */
export function unregisterBuiltin(name: string): boolean {
  if (name in DART_BUILTINS) {
    delete DART_BUILTINS[name];
    return true;
  }
  return false;
}
