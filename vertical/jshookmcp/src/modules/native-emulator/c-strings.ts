import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import type { HostContext } from './CpuEngine';
import { Aarch64VaListReader } from './aarch64-va-list';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const FORMAT_FLAGS = new Set(['-', '+', ' ', '#', '0']);
const FORMAT_LENGTH_MODIFIERS = new Set(['h', 'l', 'j', 'z', 't', 'L']);

export function readGuestCStringBytes(
  ctx: Pick<HostContext, 'read'>,
  address: number,
  maxBytes = getReverseEngineeringConfig().nativeEmulator.cstringDefaultLimitBytes,
): Uint8Array {
  if (address === 0 || maxBytes <= 0) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let current = address;
  let remaining = maxBytes;

  while (remaining > 0) {
    const requested = Math.min(
      getReverseEngineeringConfig().nativeEmulator.cstringReadChunkBytes,
      remaining,
    );
    const chunk = readGuestMemoryChunk(ctx, current, requested);
    if (chunk.length === 0) break;

    const nul = chunk.indexOf(0);
    const body = nul >= 0 ? chunk.subarray(0, nul) : chunk;
    if (body.length > 0) {
      chunks.push(body);
      total += body.length;
    }
    if (nul >= 0) break;

    current += chunk.length;
    remaining -= chunk.length;
  }

  return concatChunks(chunks, total);
}

export function readGuestCString(
  ctx: Pick<HostContext, 'read'>,
  address: number,
  maxBytes = getReverseEngineeringConfig().nativeEmulator.cstringDefaultLimitBytes,
): string {
  return decoder.decode(readGuestCStringBytes(ctx, address, maxBytes));
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Write a C string into guest memory. Returns the full UTF-8 byte length that
 * would have been written, matching sprintf/snprintf return semantics.
 */
export function writeGuestCString(
  ctx: Pick<HostContext, 'write'>,
  address: number,
  value: string,
  maxSize?: number,
): number {
  const bytes = encoder.encode(value);
  if (maxSize !== undefined && maxSize <= 0) return bytes.length;
  const body = maxSize === undefined ? bytes : bytes.subarray(0, Math.max(0, maxSize - 1));
  const out = new Uint8Array(body.length + 1);
  out.set(body, 0);
  ctx.write(address, out);
  return bytes.length;
}

export function formatGuestCString(
  ctx: Pick<HostContext, 'x' | 'read'>,
  formatAddress: number,
  firstVarargRegister: number,
): string {
  let argRegister = firstVarargRegister;
  return formatGuestCStringFromReader(ctx, formatAddress, () => ctx.x(argRegister++));
}

/** Format using an AArch64 glibc/bionic `va_list` structure in guest memory. */
export function formatGuestVaList(
  ctx: Pick<HostContext, 'read'>,
  formatAddress: number,
  vaListAddress: number,
): string {
  const args = new Aarch64VaListReader(ctx, vaListAddress);
  return formatGuestCStringFromReader(ctx, formatAddress, () => args.nextGeneral());
}

function formatGuestCStringFromReader(
  ctx: Pick<HostContext, 'read'>,
  formatAddress: number,
  nextArgument: () => bigint,
): string {
  const format = readGuestCString(ctx, formatAddress);
  let out = '';

  for (let i = 0; i < format.length; i++) {
    const ch = format[i] ?? '';
    if (ch !== '%') {
      out += ch;
      continue;
    }

    const parsed = parseFormatSpecifier(format, i + 1);
    if (!parsed) {
      out += ch;
      continue;
    }
    i = parsed.endIndex;
    if (parsed.specifier === '%') {
      out += '%';
      continue;
    }
    for (let arg = 0; arg < parsed.consumedWidthArgs; arg++) nextArgument();
    out += formatValue(ctx, parsed, nextArgument());
  }

  return out;
}

interface ParsedSpecifier {
  specifier: string;
  precision?: number;
  consumedWidthArgs: number;
  endIndex: number;
}

function parseFormatSpecifier(format: string, startIndex: number): ParsedSpecifier | null {
  let i = startIndex;
  let consumedWidthArgs = 0;

  while (FORMAT_FLAGS.has(format[i] ?? '')) i++;
  if (format[i] === '*') {
    consumedWidthArgs++;
    i++;
  } else {
    while (isDigit(format[i])) i++;
  }

  let precision: number | undefined;
  if (format[i] === '.') {
    i++;
    if (format[i] === '*') {
      consumedWidthArgs++;
      i++;
    } else {
      const precisionStart = i;
      while (isDigit(format[i])) i++;
      if (i > precisionStart) {
        precision = Number.parseInt(format.slice(precisionStart, i), 10);
      } else {
        precision = 0;
      }
    }
  }

  while (FORMAT_LENGTH_MODIFIERS.has(format[i] ?? '')) i++;
  const specifier = format[i];
  if (!specifier) return null;
  return { specifier, precision, consumedWidthArgs, endIndex: i };
}

function formatValue(
  ctx: Pick<HostContext, 'read'>,
  parsed: ParsedSpecifier,
  value: bigint,
): string {
  switch (parsed.specifier) {
    case 's': {
      const text = value === 0n ? '(null)' : readGuestCString(ctx, Number(value));
      return parsed.precision === undefined ? text : text.slice(0, parsed.precision);
    }
    case 'd':
    case 'i':
      return BigInt.asIntN(64, value).toString(10);
    case 'u':
      return BigInt.asUintN(64, value).toString(10);
    case 'x':
      return BigInt.asUintN(64, value).toString(16);
    case 'X':
      return BigInt.asUintN(64, value).toString(16).toUpperCase();
    case 'p':
      return value === 0n ? '(nil)' : `0x${BigInt.asUintN(64, value).toString(16)}`;
    case 'c':
      return String.fromCharCode(Number(value & 0xffn));
    case 'o':
      return BigInt.asUintN(64, value).toString(8);
    default:
      return `%${parsed.specifier}`;
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9';
}

function readGuestMemoryChunk(
  ctx: Pick<HostContext, 'read'>,
  address: number,
  requested: number,
): Uint8Array {
  let length = requested;
  for (;;) {
    try {
      return ctx.read(address, length);
    } catch (error) {
      if (length <= 1) throw error;
      length = Math.max(1, length >>> 1);
    }
  }
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
