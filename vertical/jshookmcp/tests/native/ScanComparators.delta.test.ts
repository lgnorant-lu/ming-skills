/**
 * ScanComparators — delta modes + tolerance tests.
 *
 * Covers: changed_by, increased_by, decreased_by, changed_by_variable,
 * plus float/double tolerance across delta modes.
 */

import { describe, it, expect } from 'vitest';
import { compareScanValues } from '../../src/native/ScanComparators';
import type { ScanCompareMode } from '../../src/native/NativeMemoryManager.types';

function int32Buf(value: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeInt32LE(value, 0);
  return b;
}

function floatBuf(value: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeFloatLE(value, 0);
  return b;
}

function doubleBuf(value: number): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeDoubleLE(value, 0);
  return b;
}

function int64Buf(value: bigint): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeBigInt64LE(value, 0);
  return b;
}

describe('ScanComparators — delta modes', () => {
  // ── changed_by ──

  describe('changed_by', () => {
    const mode: ScanCompareMode = 'changed_by';

    it('matches when value changed by exactly delta (int32)', () => {
      expect(compareScanValues(int32Buf(110), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('rejects when delta is different', () => {
      expect(compareScanValues(int32Buf(111), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        false,
      );
    });

    it('rejects when previous is null', () => {
      expect(compareScanValues(int32Buf(110), null, null, null, mode, 'int32', 10)).toBe(false);
    });

    it('rejects when delta is undefined', () => {
      expect(compareScanValues(int32Buf(110), int32Buf(100), null, null, mode, 'int32')).toBe(
        false,
      );
    });

    it('absolute delta — decreased by N also matches', () => {
      expect(compareScanValues(int32Buf(90), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('int64 bigint delta', () => {
      expect(
        compareScanValues(int64Buf(600n), int64Buf(500n), null, null, mode, 'int64', 100),
      ).toBe(true);
    });

    it('int64 bigint delta — negative direction', () => {
      expect(
        compareScanValues(int64Buf(400n), int64Buf(500n), null, null, mode, 'int64', 100),
      ).toBe(true);
    });
  });

  // ── increased_by ──

  describe('increased_by', () => {
    const mode: ScanCompareMode = 'increased_by';

    it('matches when value increased by at least delta', () => {
      expect(compareScanValues(int32Buf(115), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('matches at exact delta boundary', () => {
      expect(compareScanValues(int32Buf(110), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('rejects when increase is less than delta', () => {
      expect(compareScanValues(int32Buf(105), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        false,
      );
    });

    it('rejects when value decreased', () => {
      expect(compareScanValues(int32Buf(90), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        false,
      );
    });

    it('rejects when previous is null', () => {
      expect(compareScanValues(int32Buf(115), null, null, null, mode, 'int32', 10)).toBe(false);
    });

    it('rejects when delta is undefined', () => {
      expect(compareScanValues(int32Buf(115), int32Buf(100), null, null, mode, 'int32')).toBe(
        false,
      );
    });

    it('int64 bigint increase', () => {
      expect(
        compareScanValues(int64Buf(700n), int64Buf(500n), null, null, mode, 'int64', 200),
      ).toBe(true);
    });
  });

  // ── decreased_by ──

  describe('decreased_by', () => {
    const mode: ScanCompareMode = 'decreased_by';

    it('matches when value decreased by at least delta', () => {
      expect(compareScanValues(int32Buf(85), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('matches at exact delta boundary', () => {
      expect(compareScanValues(int32Buf(90), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        true,
      );
    });

    it('rejects when decrease is less than delta', () => {
      expect(compareScanValues(int32Buf(95), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        false,
      );
    });

    it('rejects when value increased', () => {
      expect(compareScanValues(int32Buf(110), int32Buf(100), null, null, mode, 'int32', 10)).toBe(
        false,
      );
    });

    it('rejects when previous is null', () => {
      expect(compareScanValues(int32Buf(85), null, null, null, mode, 'int32', 10)).toBe(false);
    });

    it('rejects when delta is undefined', () => {
      expect(compareScanValues(int32Buf(85), int32Buf(100), null, null, mode, 'int32')).toBe(false);
    });
  });

  // ── changed_by_variable ──

  describe('changed_by_variable', () => {
    const mode: ScanCompareMode = 'changed_by_variable';

    it('always returns true regardless of values', () => {
      expect(compareScanValues(int32Buf(100), int32Buf(50), null, null, mode, 'int32')).toBe(true);
    });

    it('always returns true even without previous', () => {
      expect(compareScanValues(int32Buf(42), null, null, null, mode, 'int32')).toBe(true);
    });

    it('always returns true for float type', () => {
      expect(compareScanValues(floatBuf(3.14), floatBuf(1.0), null, null, mode, 'float')).toBe(
        true,
      );
    });
  });
});

describe('ScanComparators — float tolerance', () => {
  // ── exact with tolerance ──

  it('exact float with custom tolerance', () => {
    const a = floatBuf(1.0);
    const b = floatBuf(1.001);
    // 1e-3 tolerance should accept 0.001 diff
    expect(compareScanValues(a, null, b, null, 'exact', 'float', undefined, 0.01)).toBe(true);
    // Default epsilon (1e-6) would reject
    expect(compareScanValues(a, null, b, null, 'exact', 'float')).toBe(false);
  });

  it('exact double with custom tolerance', () => {
    const a = doubleBuf(1.0);
    const b = doubleBuf(1.0001);
    expect(compareScanValues(a, null, b, null, 'exact', 'double', undefined, 0.001)).toBe(true);
  });

  // ── changed with tolerance ──

  it('changed float with tolerance — small change detected', () => {
    const cur = floatBuf(1.00000005);
    const prev = floatBuf(1.0);
    // Without tolerance, epsilon 1e-6 considers them equal → not changed
    expect(compareScanValues(cur, prev, null, null, 'changed', 'float')).toBe(false);
    // With zero tolerance, strict compare → changed
    expect(compareScanValues(cur, prev, null, null, 'changed', 'float', undefined, 0)).toBe(true);
  });

  // ── delta modes with tolerance ──

  it('changed_by float with tolerance — close delta matches', () => {
    // cur = 10.0001, prev = 0.0, diff = 10.0001, delta = 10, tolerance = 0.001
    expect(
      compareScanValues(
        floatBuf(10.0001),
        floatBuf(0.0),
        null,
        null,
        'changed_by',
        'float',
        10,
        0.001,
      ),
    ).toBe(true);
  });

  it('changed_by float with tolerance — diff exceeds tolerance', () => {
    expect(
      compareScanValues(
        floatBuf(10.002),
        floatBuf(0.0),
        null,
        null,
        'changed_by',
        'float',
        10,
        0.001,
      ),
    ).toBe(false);
  });
});

describe('ScanComparators — unchanged with tolerance', () => {
  it('unchanged float with custom tolerance considers close values equal', () => {
    const cur = floatBuf(1.001);
    const prev = floatBuf(1.0);
    expect(compareScanValues(cur, prev, null, null, 'unchanged', 'float', undefined, 0.01)).toBe(
      true,
    );
  });
});

describe('ScanComparators — not_equal with tolerance', () => {
  it('not_equal float with tolerance — close values considered equal', () => {
    const cur = floatBuf(1.001);
    const tgt = floatBuf(1.0);
    // With tolerance 0.01, diff 0.001 is within tolerance → not "not equal"
    expect(compareScanValues(cur, null, tgt, null, 'not_equal', 'float', undefined, 0.01)).toBe(
      false,
    );
  });

  it('not_equal float — significantly different values', () => {
    expect(compareScanValues(floatBuf(5.0), null, floatBuf(1.0), null, 'not_equal', 'float')).toBe(
      true,
    );
  });
});
