/**
 * Tests for Dart AOT snapshot parsing, runtime, and execution.
 */

import { describe, it, expect } from 'vitest';
import { parseSnapshotHeader } from '@modules/native-emulator/dart/SnapshotParser';
import {
  isSmi,
  smiValue,
  pointerToSmi,
  isHeapObject,
  detagPointer,
  tagAsHeapObject,
  formatDartValue,
  isValidHeapPointer,
} from '@modules/native-emulator/dart/DartRuntime';
import { ObjectPool, ObjectPoolRegistry } from '@modules/native-emulator/dart/ObjectPool';
import {
  callDartBuiltin,
  hasBuiltin,
  getBuiltinNames,
} from '@modules/native-emulator/dart/DartBuiltins';
import { DART_SNAPSHOT_MAGIC } from '@modules/dart-inspector/snapshot-types';

describe('Dart AOT Layer', () => {
  describe('SnapshotParser', () => {
    it('should parse a valid snapshot header', () => {
      // Create a minimal valid snapshot header
      const buffer = new Uint8Array(0x100);
      const view = new DataView(buffer.buffer);

      // Set magic
      view.setUint32(0x00, DART_SNAPSHOT_MAGIC, true);
      // Set kind (full-aot = 2)
      view.setUint32(0x04, 2, true);
      // Set features
      view.setBigUint64(0x28, 0x1234n, true);
      // Set base objects
      view.setUint32(0x30, 100, true);
      // Set num objects
      view.setUint32(0x34, 1000, true);
      // Set num clusters
      view.setUint32(0x38, 5, true);
      // Set field table len
      view.setUint32(0x3c, 50, true);
      // Set code start offset
      view.setBigUint64(0x40, 0x10000n, true);
      // Set data start offset
      view.setBigUint64(0x48, 0x20000n, true);

      const header = parseSnapshotHeader(buffer);

      expect(header.magic).toBe(DART_SNAPSHOT_MAGIC);
      expect(header.kind).toBe(2);
      expect(header.features).toBe(0x1234n);
      expect(header.baseObjects).toBe(100);
      expect(header.numObjects).toBe(1000);
      expect(header.numClusters).toBe(5);
      expect(header.fieldTableLen).toBe(50);
      expect(header.codeStartOffset).toBe(0x10000n);
      expect(header.dataStartOffset).toBe(0x20000n);
    });

    it('reads modern common-header fields without scanning payload words', () => {
      const buffer = new Uint8Array(0x200);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, DART_SNAPSHOT_MAGIC, true);
      view.setUint32(4, 5, true); // modern version word, not a legacy kind
      buffer.set(new TextEncoder().encode('0123456789abcdef0123456789abcdef'), 0x14);
      const features = new TextEncoder().encode('compressed-pointers\0');
      buffer.set(features, 0x34);
      const common = (0x34 + features.length + 7) & ~7;
      view.setUint32(common, 12, true);
      view.setUint32(common + 4, 120, true);
      view.setUint32(common + 8, 1, true);
      view.setUint32(common + 12, 9, true);
      view.setBigUint64(common + 16, 0x180n, true);
      view.setBigUint64(common + 24, 0x100n, true);

      // Plausible-looking pairs in inline/payload data must not become clusters.
      view.setUint32(0xc0, 100, true);
      view.setUint32(0xc4, 500, true);
      view.setUint32(0x120, 101, true);
      view.setUint32(0x124, 600, true);

      const header = parseSnapshotHeader(buffer);
      expect(header.baseObjects).toBe(12);
      expect(header.numObjects).toBe(120);
      expect(header.numClusters).toBe(1);
      expect(header.fieldTableLen).toBe(9);
      expect(header.dataStartOffset).toBe(0x100n);
    });

    it('rejects modern headers whose declared cluster boundaries exceed the buffer', () => {
      const buffer = new Uint8Array(0x100);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, DART_SNAPSHOT_MAGIC, true);
      view.setUint32(4, 5, true);
      buffer[0x34] = 0;
      const common = 0x38;
      view.setUint32(common + 8, 2, true);
      view.setBigUint64(common + 24, 0xf8n, true);
      expect(() => parseSnapshotHeader(buffer)).toThrow('cluster boundaries are invalid');
    });

    it('should throw on invalid magic', () => {
      const buffer = new Uint8Array(0x100);
      const view = new DataView(buffer.buffer);
      view.setUint32(0x00, 0xdeadbeef, true);

      expect(() => parseSnapshotHeader(buffer)).toThrow('Invalid Dart snapshot magic');
    });

    it('should throw on buffer too small', () => {
      const buffer = new Uint8Array(16);
      expect(() => parseSnapshotHeader(buffer)).toThrow('too small for header');
    });
  });

  describe('DartRuntime - Tagged Pointers', () => {
    it('should identify Smi values correctly', () => {
      expect(isSmi(0n)).toBe(true);
      expect(isSmi(42n << 1n)).toBe(true);
      expect(isSmi(0x1n)).toBe(false); // Heap object
      expect(isSmi(0xabcdef01n)).toBe(false);
    });

    it('should decode Smi values correctly', () => {
      expect(smiValue(0n)).toBe(0n);
      expect(smiValue(42n << 1n)).toBe(42n);
      expect(smiValue(100n << 1n)).toBe(100n);
      expect(smiValue(-10n << 1n)).toBe(-10n);
    });

    it('should encode Smi values correctly', () => {
      expect(pointerToSmi(0n)).toBe(0n);
      expect(pointerToSmi(42n)).toBe(84n);
      expect(pointerToSmi(100n)).toBe(200n);
    });

    it('should identify heap objects correctly', () => {
      expect(isHeapObject(0x1n)).toBe(true);
      expect(isHeapObject(0x1001n)).toBe(true);
      expect(isHeapObject(0n)).toBe(false);
      expect(isHeapObject(42n << 1n)).toBe(false);
    });

    it('should detag pointers correctly', () => {
      expect(detagPointer(0x1001n)).toBe(0x1000n);
      expect(detagPointer(0xabcdef01n)).toBe(0xabcdef00n);
    });

    it('should tag pointers correctly', () => {
      expect(tagAsHeapObject(0x1000n)).toBe(0x1001n);
      expect(tagAsHeapObject(0xabcdef00n)).toBe(0xabcdef01n);
    });

    it('should format Dart values correctly', () => {
      expect(formatDartValue(0n)).toBe('nullptr');
      expect(formatDartValue(pointerToSmi(42n))).toBe('Smi(42)');
      expect(formatDartValue(0x1001n)).toBe('HeapObject(0x1000)');
    });

    it('should validate heap pointers', () => {
      expect(isValidHeapPointer(0x1001n)).toBe(true); // 8-byte aligned after detag
      expect(isValidHeapPointer(0x1009n)).toBe(true); // 8-byte aligned
      expect(isValidHeapPointer(0x1003n)).toBe(false); // Not 8-byte aligned
      expect(isValidHeapPointer(0n)).toBe(false); // Not a heap object
    });
  });

  describe('ObjectPool', () => {
    it('should parse ObjectPool with entries', () => {
      // Create a pool with 3 entries
      const buffer = new Uint8Array(8 + 3 * 8);
      const view = new DataView(buffer.buffer);

      view.setUint32(0, 3, true); // length = 3
      view.setBigUint64(8, 0x1001n, true); // Entry 0: heap object
      view.setBigUint64(16, pointerToSmi(42n), true); // Entry 1: Smi(42)
      view.setBigUint64(24, 0x12345678n, true); // Entry 2: immediate

      const pool = new ObjectPool(buffer);

      expect(pool.getLength()).toBe(3);
      expect(pool.lookup(0)).toBe(0x1001n);
      expect(pool.lookup(8)).toBe(pointerToSmi(42n));
      expect(pool.lookup(16)).toBe(0x12345678n);
    });

    it('should throw on invalid offset', () => {
      const buffer = new Uint8Array(8 + 2 * 8);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, 2, true);

      const pool = new ObjectPool(buffer);

      expect(() => pool.lookup(3)).toThrow('must be >= 0 and 8-byte aligned');
      expect(() => pool.lookup(-8)).toThrow('must be >= 0 and 8-byte aligned');
      expect(() => pool.lookup(32)).toThrow('out of bounds');
    });

    it('should support entry name annotation', () => {
      const buffer = new Uint8Array(8 + 1 * 8);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, 1, true);
      view.setBigUint64(8, 0x12345678n, true);

      const pool = new ObjectPool(buffer);
      pool.setEntryName(0, 'main');

      const entry = pool.getEntry(0);
      expect(entry.name).toBe('main');
    });
  });

  describe('ObjectPoolRegistry', () => {
    it('should register and retrieve pools', () => {
      const registry = new ObjectPoolRegistry();

      const buffer = new Uint8Array(8 + 1 * 8);
      const view = new DataView(buffer.buffer);
      view.setUint32(0, 1, true);

      const pool = registry.register(0x10000n, buffer);

      expect(registry.has(0x10000n)).toBe(true);
      expect(registry.get(0x10000n)).toBe(pool);
      expect(registry.size()).toBe(1);
    });

    it('should return undefined for unregistered pools', () => {
      const registry = new ObjectPoolRegistry();
      expect(registry.get(0x99999n)).toBeUndefined();
      expect(registry.has(0x99999n)).toBe(false);
    });

    it('should clear all pools', () => {
      const registry = new ObjectPoolRegistry();
      const buffer = new Uint8Array(16);
      new DataView(buffer.buffer).setUint32(0, 1, true);

      registry.register(0x10000n, buffer);
      expect(registry.size()).toBe(1);

      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.has(0x10000n)).toBe(false);
    });
  });

  describe('DartBuiltins', () => {
    it('should have registered built-ins', () => {
      expect(hasBuiltin('_List::[]')).toBe(true);
      expect(hasBuiltin('_StringBase::_interpolate')).toBe(true);
      expect(hasBuiltin('print')).toBe(true);
      expect(hasBuiltin('nonexistent')).toBe(false);
    });

    it('should return built-in names', () => {
      const names = getBuiltinNames();
      expect(names).toContain('_List::[]');
      expect(names).toContain('_StringBase::_interpolate');
      expect(names).toContain('print');
    });

    it('should call _List::[] builtin', () => {
      const mockCtx = {
        x: () => 0n,
        setX: () => {},
        setD: () => {},
        read: () => new Uint8Array(0),
        write: () => {},
      };

      const result = callDartBuiltin('_List::[]', [0x1001n, pointerToSmi(5n)], mockCtx);
      expect(result).toBe(pointerToSmi(50n)); // index * 10
    });

    it('should call identical builtin', () => {
      const mockCtx = {
        x: () => 0n,
        setX: () => {},
        setD: () => {},
        read: () => new Uint8Array(0),
        write: () => {},
      };

      const resultTrue = callDartBuiltin('identical', [42n, 42n], mockCtx);
      expect(resultTrue).toBe(0x3n); // true

      const resultFalse = callDartBuiltin('identical', [42n, 43n], mockCtx);
      expect(resultFalse).toBe(0x1n); // false
    });

    it('should return undefined for nonexistent builtin', () => {
      const mockCtx = {
        x: () => 0n,
        setX: () => {},
        setD: () => {},
        read: () => new Uint8Array(0),
        write: () => {},
      };

      const result = callDartBuiltin('nonexistent', [], mockCtx);
      expect(result).toBeUndefined();
    });
  });
});
