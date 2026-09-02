/**
 * Shared LiteVM bytecode-word decoding for the native-emulator domain.
 *
 * nemu_bytecode_decode, nemu_bytecode_scan and nemu_data_dump each need the
 * same word-level analysis: bit-field extraction (group/sub/a1/imm/fl), a
 * printable-ASCII rejection (all-ASCII words are data, not opcodes), a
 * known-data filter (single-bit masks and pointer-ish constants), and the
 * group→handler-name mapping. This module is the single source of that logic —
 * previously each handler carried its own copy, and the data-dump copy even
 * used a different (shorter) name table than the other two.
 */

/** Single-bit mask / pointer-ish words that are data, not opcodes. */
export const LITEVM_KNOWN_DATA = new Set<number>([
  0x01000000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000, 0x80000000,
  0xfffe8d80, 0xfffeaa44,
]);

/** Dispatch role per group 0-7 (mirrors the Python sign_algorithm.py handler table). */
export const LITEVM_HANDLER_NAMES = [
  'G0:SET',
  'G1:STORE',
  'G2:ARITH',
  'G3',
  'G4',
  'G5:ADVANCE',
  'G6:TABLE',
  'G7:COND_JMP',
] as const;

export interface LiteVmWordDecode {
  group: number;
  sub: number;
  a1: number;
  imm: number;
  fl: number;
  valid: boolean;
  isAscii: boolean;
  handler: string;
}

/**
 * Decode a u32 LiteVM bytecode word into its opcode fields.
 *
 * Bit layout (matching the Python sign_algorithm.py Opcode class):
 *   Bits[4:0]   = group (0-7)
 *   Bits[8:5]   = sub (4 bits)
 *   Bits[13:9]  = a1 (5 bits)
 *   Bits[26:14] = imm (13 bits, signed)
 *   Bits[31:27] = fl (5 bits)
 */
export function decodeLiteVmWord(word: number): LiteVmWordDecode {
  const w = word >>> 0; // treat as unsigned 32-bit
  const group = w & 0x1f;
  const sub = (w >>> 5) & 0xf;
  const a1 = (w >>> 9) & 0x1f;
  const rawImm = (w >>> 14) & 0x1fff;
  const imm = rawImm < 0x1000 ? rawImm : rawImm - 0x2000; // sign-extend 13-bit
  const fl = (w >>> 27) & 0x1f;

  // ASCII check — if all 4 bytes are printable ASCII, it's data not an opcode
  const b0 = w & 0xff,
    b1 = (w >>> 8) & 0xff,
    b2 = (w >>> 16) & 0xff,
    b3 = (w >>> 24) & 0xff;
  const isAscii =
    b0 >= 0x20 &&
    b0 < 0x7f &&
    b1 >= 0x20 &&
    b1 < 0x7f &&
    b2 >= 0x20 &&
    b2 < 0x7f &&
    b3 >= 0x20 &&
    b3 < 0x7f;

  const valid = group <= 7 && !isAscii && !LITEVM_KNOWN_DATA.has(w);
  const handler = LITEVM_HANDLER_NAMES[group] ?? `G${group}`;

  return { group, sub, a1, imm, fl, valid, isAscii, handler };
}
