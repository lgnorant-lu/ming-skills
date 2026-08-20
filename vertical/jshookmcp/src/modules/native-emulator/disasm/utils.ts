import type { DisasmResult, OpcodeInput } from './types';

export function formatDisasm(result: DisasmResult): string {
  return `${result.mnemonic.padEnd(8)} ${result.operands}`;
}

export function readOpcode32(input: OpcodeInput, endian: 'little' | 'big'): number {
  if (typeof input === 'number') return input >>> 0;

  const bytes = Array.from(input);
  if (bytes.length < 4) {
    throw new Error(
      `Need at least 4 bytes for fixed-width instruction decode, got ${bytes.length}`,
    );
  }

  const b0 = byteAt(bytes, 0);
  const b1 = byteAt(bytes, 1);
  const b2 = byteAt(bytes, 2);
  const b3 = byteAt(bytes, 3);

  if (endian === 'little') {
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

export function normalizeBytes(input: OpcodeInput): number[] {
  if (typeof input !== 'number') return Array.from(input, (value) => value & 0xff);
  if (input <= 0xff) return [input & 0xff];
  return [input & 0xff, (input >>> 8) & 0xff, (input >>> 16) & 0xff, (input >>> 24) & 0xff];
}

export function byteAt(bytes: readonly number[], index: number): number {
  return (bytes[index] ?? 0) & 0xff;
}

export function readInt8(bytes: readonly number[], index: number): number {
  const value = byteAt(bytes, index);
  return value & 0x80 ? value - 0x100 : value;
}

export function readInt32LE(bytes: readonly number[], index: number): number {
  return (
    byteAt(bytes, index) |
    (byteAt(bytes, index + 1) << 8) |
    (byteAt(bytes, index + 2) << 16) |
    (byteAt(bytes, index + 3) << 24)
  );
}

export function readUInt32LE(bytes: readonly number[], index: number): number {
  return readInt32LE(bytes, index) >>> 0;
}

export function readUInt64LE(bytes: readonly number[], index: number): bigint {
  const lo = BigInt(readUInt32LE(bytes, index));
  const hi = BigInt(readUInt32LE(bytes, index + 4));
  return (hi << 32n) | lo;
}

export function signExtend(value: number, bits: number): number {
  const shift = 32 - bits;
  return (value << shift) >> shift;
}

export function relativeTarget(pc: bigint, instructionLength: number, offset: number): string {
  return `0x${(pc + BigInt(instructionLength) + BigInt(offset)).toString(16)}`;
}
