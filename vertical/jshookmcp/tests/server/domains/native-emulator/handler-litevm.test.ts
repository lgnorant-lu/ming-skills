/**
 * Shared LiteVM bytecode-word decoding (handler-litevm.ts).
 *
 * decodeLiteVmWord backs nemu_bytecode_decode, nemu_bytecode_scan and
 * nemu_data_dump — previously each handler carried its own copy of the same
 * bit-field decoding, ASCII check and known-data filter. These tests lock the
 * shared semantics: group/sub/a1/imm/fl bit layout (matching the Python
 * sign_algorithm.py Opcode class), 13-bit sign-extended imm, printable-ASCII
 * rejection, the known-data constant list, and the handler-name mapping.
 */
import { describe, expect, it } from 'vitest';

import {
  decodeLiteVmWord,
  LITEVM_KNOWN_DATA,
  LITEVM_HANDLER_NAMES,
} from '@server/domains/native-emulator/handler-litevm';
import { NativeEmulatorHandlers } from '@server/domains/native-emulator/handlers.impl';

describe('LITEVM_KNOWN_DATA', () => {
  it('covers the single-bit masks and pointer-ish constants used as data words', () => {
    expect(LITEVM_KNOWN_DATA.size).toBe(10);
    for (const value of [
      0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000,
      0x80000000, 0xfffe8d80, 0xfffeaa44,
    ]) {
      expect(LITEVM_KNOWN_DATA.has(value)).toBe(true);
    }
  });
});

describe('LITEVM_HANDLER_NAMES', () => {
  it('maps groups 0-7 to their dispatch roles', () => {
    expect(LITEVM_HANDLER_NAMES).toEqual([
      'G0:SET',
      'G1:STORE',
      'G2:ARITH',
      'G3',
      'G4',
      'G5:ADVANCE',
      'G6:TABLE',
      'G7:COND_JMP',
    ]);
  });
});

describe('decodeLiteVmWord', () => {
  it('decodes a zero word as G0:SET with all-zero fields', () => {
    const d = decodeLiteVmWord(0x00000000);
    expect(d).toMatchObject({ group: 0, sub: 0, a1: 0, imm: 0, fl: 0, valid: true });
    expect(d.handler).toBe('G0:SET');
    expect(d.isAscii).toBe(false);
  });

  it('extracts the sub/a1/fl fields from the upper bit lanes', () => {
    const d = decodeLiteVmWord(0x18000aa8);
    // 0x18000aa8 = fl=3 (bits 27-31), a1=5 (bits 9-13), sub=5 (bits 5-8), group=8
    expect(d.fl).toBe(3);
    expect(d.a1).toBe(5);
    expect(d.sub).toBe(5);
    expect(d.group).toBe(8);
    expect(d.valid).toBe(false); // group > 7
    expect(d.handler).toBe('G8');
  });

  it('sign-extends a positive 13-bit imm', () => {
    const d = decodeLiteVmWord(0x00014000); // imm = 5 << 14
    expect(d.imm).toBe(5);
    expect(d.valid).toBe(true);
  });

  it('sign-extends a negative 13-bit imm (rawImm >= 0x1000)', () => {
    const d = decodeLiteVmWord(0x7ffc000); // rawImm = 0x1fff
    expect(d.imm).toBe(-1);
    expect(d.valid).toBe(true);
  });

  it('sign-extends 0x1234 as negative', () => {
    const d = decodeLiteVmWord(0x1234 << 14);
    expect(d.imm).toBe(0x1234 - 0x2000);
  });

  it('rejects single-bit mask words from the known-data list', () => {
    for (const w of [0x01000000, 0x80000000]) {
      const d = decodeLiteVmWord(w);
      expect(d.valid).toBe(false);
      expect(d.isAscii).toBe(false);
    }
  });

  it('rejects the pointer-ish known-data constants', () => {
    for (const w of [0xfffe8d80, 0xfffeaa44]) {
      expect(decodeLiteVmWord(w).valid).toBe(false);
    }
  });

  it('rejects words whose four bytes are all printable ASCII', () => {
    const d = decodeLiteVmWord(0x54534554); // 'TEST'
    expect(d.isAscii).toBe(true);
    expect(d.valid).toBe(false);
  });

  it('accepts words with one non-printable byte even when others are ASCII', () => {
    const d = decodeLiteVmWord(0x00455361); // 'aSE\0' — b0=0x61 keeps group=1
    expect(d.isAscii).toBe(false);
    expect(d.valid).toBe(true);
    expect(d.group).toBe(1);
  });

  it('maps groups 0-7 to handler names and unknown groups to G<n>', () => {
    expect(decodeLiteVmWord(0x00000000).handler).toBe('G0:SET');
    expect(decodeLiteVmWord(0x00000021).handler).toBe('G1:STORE'); // group=1, sub=1
    expect(decodeLiteVmWord(0x00000002).handler).toBe('G2:ARITH');
    expect(decodeLiteVmWord(0x00000003).handler).toBe('G3');
    expect(decodeLiteVmWord(0x00000004).handler).toBe('G4');
    expect(decodeLiteVmWord(0x00000005).handler).toBe('G5:ADVANCE');
    expect(decodeLiteVmWord(0x00000006).handler).toBe('G6:TABLE');
    expect(decodeLiteVmWord(0x7ffc67).handler).toBe('G7:COND_JMP'); // g7 offset -1
    expect(decodeLiteVmWord(0x00000019).handler).toBe('G25');
  });
});

describe('handleBytecodeDecode (nemu_bytecode_decode)', () => {
  const handlers = new NativeEmulatorHandlers();

  it('returns the shared fields plus group-specific extras for group 3', async () => {
    const res = await handlers.handleBytecodeDecode({ word: 0x00001463 });
    const text = res.content[0] as { type: string; text: string };
    const parsed = JSON.parse(text.text) as Record<string, unknown>;
    expect(parsed.group).toBe(3);
    expect(parsed.sub).toBe(0x63 & 0xf);
    expect(parsed.valid).toBe(true);
    expect(parsed.handler).toBe('G3');
    expect(parsed.g3_sel).toBeTypeOf('number');
    expect(parsed.g3_f1).toBeTypeOf('number');
    expect(parsed.g3_f2).toBeTypeOf('number');
    expect(parsed.g3_f3).toBeTypeOf('number');
  });

  it('reports group-7 offset fields sign-extended', async () => {
    const res = await handlers.handleBytecodeDecode({ word: 0x7ffc67 });
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.group).toBe(7);
    expect(parsed.g7_offset).toBe(-1);
    expect(parsed.valid).toBe(true);
  });

  it('flags known-data words as invalid', async () => {
    const res = await handlers.handleBytecodeDecode({ word: 0xfffe8d80 });
    const parsed = JSON.parse((res.content[0] as { text: string }).text) as Record<string, unknown>;
    expect(parsed.valid).toBe(false);
  });
});
