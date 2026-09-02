import { describe, expect, it } from 'vitest';

import { readS64Leb128, readU32Leb128 } from '@server/domains/wasm/handlers/binary-reader';
import { inspectModuleStructure } from '@server/domains/wasm/handlers/module-structure';

/** Canonical varuint32 byte sequences (least significant byte first). */
const u32Cases: Array<[string, number[], number]> = [
  ['zero', [0x00], 0],
  ['one byte', [0x7f], 127],
  ['two bytes', [0x80, 0x01], 128],
  ['u32 max (5 bytes)', [0xff, 0xff, 0xff, 0xff, 0x0f], 0xffffffff],
];

/** Canonical varint64 byte sequences (least significant byte first). */
const s64Cases: Array<[string, number[], number]> = [
  ['zero', [0x00], 0],
  ['63', [0x3f], 63],
  ['-1', [0x7f], -1],
  ['-64', [0x40], -64],
  ['-128', [0x80, 0x7f], -128],
  ['-16384', [0x80, 0x80, 0x7f], -16384],
  ['2^31', [0x80, 0x80, 0x80, 0x80, 0x08], 2 ** 31],
  ['-2^31', [0x80, 0x80, 0x80, 0x80, 0x78], -(2 ** 31)],
  ['2^40 (6 bytes)', [0x80, 0x80, 0x80, 0x80, 0x80, 0x20], 2 ** 40],
  // -2^40 canonical encoding is 9 bytes: sign bit lives in the 9th byte's
  // bit 6, so the value decodes exactly (a 10th byte would make it an
  // unsigned-64 approximation).
  ['-2^40 (9 bytes)', [0x80, 0x80, 0x80, 0x80, 0x80, 0xe0, 0xff, 0xff, 0x7f], -(2 ** 40)],
  ['2^52', [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x08], 2 ** 52],
  // i64 max = 2^63-1 is not representable in a double; the accumulation
  // rounds it up to 2^63 (documented precision boundary).
  ['i64 max (2^63-1)', [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00], 2 ** 63],
];

describe('readU32Leb128', () => {
  for (const [label, bytes, expected] of u32Cases) {
    it(`decodes ${label}`, () => {
      const buf = Buffer.from(bytes);
      const [value, next] = readU32Leb128(buf, 0);
      expect(value).toBe(expected);
      expect(next).toBe(bytes.length);
    });
  }

  it('respects a non-zero start offset', () => {
    const buf = Buffer.from([0x99, 0x2a, 0x00]); // padding, 42, padding
    const [value, next] = readU32Leb128(buf, 1);
    expect(value).toBe(42);
    expect(next).toBe(2);
  });

  it('throws on truncated input', () => {
    // Continuation bit set but no further byte
    expect(() => readU32Leb128(Buffer.from([0x80]), 0)).toThrow(/truncated LEB128/);
  });

  it('throws when a 6th byte would exceed the u32 range', () => {
    // 5 payload bytes + a 6th continuation byte: invalid varuint32
    expect(() => readU32Leb128(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0)).toThrow(
      /exceeds u32 range/,
    );
  });
});

describe('readS64Leb128', () => {
  for (const [label, bytes, expected] of s64Cases) {
    it(`decodes ${label}`, () => {
      const buf = Buffer.from(bytes);
      const [value, next] = readS64Leb128(buf, 0);
      expect(value).toBe(expected);
      expect(next).toBe(bytes.length);
    });
  }

  it('decodes a negative i64 whose payload spans bit 32+ (was the 32-bit-fold bug)', () => {
    // -2^31: payload bits 28-34 all ones in the 5th byte; bitwise << used to
    // fold the accumulator to -8.
    const [value] = readS64Leb128(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x78]), 0);
    expect(value).toBe(-(2 ** 31));
  });

  it('decodes values that need bit 40 (was the 32-bit-fold bug)', () => {
    // 2^40 = 0x10000000000: payload byte 6 contributes bit 35; bitwise << used
    // to fold it to 256.
    const [value] = readS64Leb128(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x20]), 0);
    expect(value).toBe(2 ** 40);
  });

  it('returns the unsigned-64 approximation for i64 min', () => {
    // i64 min = -2^63 encodes as [0x80 x9, 0x01]; wabt reads it as unsigned
    // 2^63 (the sign lives in bit 63, which a double cannot represent).
    const [value, next] = readS64Leb128(
      Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]),
      0,
    );
    expect(value).toBe(2 ** 63);
    expect(next).toBe(10);
  });

  it('throws on truncated input', () => {
    expect(() => readS64Leb128(Buffer.from([0x80]), 0)).toThrow(/truncated signed LEB128/);
  });

  it('throws when an 11th byte would exceed the i64 range', () => {
    const bytes = Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]);
    expect(() => readS64Leb128(bytes, 0)).toThrow(/exceeds i64 range/);
  });
});

describe('integration: const-expr skip with 32+ bit signed payloads', () => {
  it('keeps the section parse aligned across an i64.const 2^40 initializer', () => {
    // Global section whose initializer is i64.const 2^40 (0x42 followed by
    // the 6-byte varint) then `end` (0x0b). skipConstExpr consumes the const
    // via readS64Leb128; with the old 32-bit-fold bug the 6-byte payload
    // decodes to a short value but still advances correctly — this asserts
    // the parse stays aligned AND the section yields a global with no errors.
    const globalSectionBody = Buffer.concat([
      Buffer.from([0x01]), // 1 global
      Buffer.from([0x7e]), // i64
      Buffer.from([0x01]), // mutable
      Buffer.from([0x42]), // i64.const
      Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x20]), // 2^40
      Buffer.from([0x0b]), // end
    ]);
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), // header
      Buffer.from([0x06]), // section id: global
      Buffer.from([globalSectionBody.length]),
      globalSectionBody,
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.parseErrors).toEqual([]);
    expect(r.globals).toEqual([{ valueType: { raw: 0x7e, name: 'i64' }, mutable: true }]);
  });

  it('keeps the section parse aligned across an i64.const -2^31 initializer', () => {
    const globalSectionBody = Buffer.concat([
      Buffer.from([0x01]), // 1 global
      Buffer.from([0x7e]), // i64
      Buffer.from([0x00]), // immutable
      Buffer.from([0x42]), // i64.const
      Buffer.from([0x80, 0x80, 0x80, 0x80, 0x78]), // -2^31
      Buffer.from([0x0b]), // end
    ]);
    const bytes = Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), // header
      Buffer.from([0x06]),
      Buffer.from([globalSectionBody.length]),
      globalSectionBody,
    ]);
    const r = inspectModuleStructure(bytes);
    expect(r.parseErrors).toEqual([]);
    expect(r.globals).toEqual([{ valueType: { raw: 0x7e, name: 'i64' }, mutable: false }]);
  });
});
