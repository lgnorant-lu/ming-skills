export type PayloadEndian = 'big' | 'little';
export type PayloadDataEncoding = 'utf8' | 'ascii' | 'hex' | 'base64';
export type PayloadFieldType = 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'string' | 'bytes';
export type PayloadMutationStrategy =
  | 'set_byte'
  | 'flip_bit'
  | 'overwrite_bytes'
  | 'append_bytes'
  | 'truncate'
  | 'increment_integer';

export type PayloadTemplateField =
  | {
      name: string;
      type: 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32';
      value: number;
    }
  | {
      name: string;
      type: 'string';
      value: string;
      encoding: 'utf8' | 'ascii';
      length?: number;
      padByte: number;
    }
  | {
      name: string;
      type: 'bytes';
      value: string;
      encoding: PayloadDataEncoding;
      length?: number;
      padByte: number;
    };

export type PayloadMutation =
  | {
      strategy: 'set_byte';
      offset: number;
      value: number;
    }
  | {
      strategy: 'flip_bit';
      offset: number;
      bit: number;
    }
  | {
      strategy: 'overwrite_bytes';
      offset: number;
      data: Buffer;
    }
  | {
      strategy: 'append_bytes';
      data: Buffer;
    }
  | {
      strategy: 'truncate';
      length: number;
    }
  | {
      strategy: 'increment_integer';
      offset: number;
      width: 1 | 2 | 4;
      delta: number;
      endian: PayloadEndian;
      signed: boolean;
    };

export type PayloadFieldSegment = {
  name: string;
  offset: number;
  length: number;
  hex: string;
};

export type PayloadMutationSummary = {
  index: number;
  strategy: PayloadMutationStrategy;
  detail: string;
};

export const TEXT_ENCODINGS = ['utf8', 'ascii'] as const;
export const BINARY_ENCODINGS = ['utf8', 'ascii', 'hex', 'base64'] as const;
export const PAYLOAD_FIELD_TYPES = [
  'u8',
  'u16',
  'u32',
  'i8',
  'i16',
  'i32',
  'string',
  'bytes',
] as const;
export const MUTATION_STRATEGIES = [
  'set_byte',
  'flip_bit',
  'overwrite_bytes',
  'append_bytes',
  'truncate',
  'increment_integer',
] as const;

export function parseEndian(value: unknown, fallback: PayloadEndian = 'big'): PayloadEndian {
  return value === 'little' ? 'little' : fallback;
}

export function parseNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return value;
}

export function parsePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return value;
}

export function parseInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }

  return value;
}

export function parseByte(value: unknown, label: string): number {
  const parsed = parseInteger(value, label);
  if (parsed < 0 || parsed > 0xff) {
    throw new Error(`${label} must be between 0 and 255`);
  }

  return parsed;
}

export function parseOptionalLength(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : parsePositiveInteger(value, label);
}

export function parseEncoding<TEncoding extends string>(
  value: unknown,
  allowed: readonly TEncoding[],
  fallback: TEncoding,
  label: string,
): TEncoding {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || !allowed.includes(value as TEncoding)) {
    throw new Error(`${label} is invalid`);
  }

  return value as TEncoding;
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

export function normalizeHexString(value: string, label: string): string {
  const normalized = value.replace(/^0x/i, '').replace(/\s+/g, '');
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
    throw new Error(`${label} must be a valid even-length hex string`);
  }

  return normalized.toLowerCase();
}

export function decodeBinaryValue(
  value: string,
  encoding: PayloadDataEncoding,
  label: string,
): Buffer {
  switch (encoding) {
    case 'utf8':
    case 'ascii':
      return Buffer.from(value, encoding);
    case 'hex':
      return Buffer.from(normalizeHexString(value, label), 'hex');
    case 'base64':
      return Buffer.from(value, 'base64');
  }
}

export function getNumericRange(width: 1 | 2 | 4, signed: boolean): { min: number; max: number } {
  const bits = width * 8;
  if (signed) {
    return {
      min: -(2 ** (bits - 1)),
      max: 2 ** (bits - 1) - 1,
    };
  }

  return {
    min: 0,
    max: 2 ** bits - 1,
  };
}

export function getFieldNumericMetadata(type: PayloadFieldType): {
  width: 1 | 2 | 4;
  signed: boolean;
} | null {
  switch (type) {
    case 'u8':
      return { width: 1, signed: false };
    case 'u16':
      return { width: 2, signed: false };
    case 'u32':
      return { width: 4, signed: false };
    case 'i8':
      return { width: 1, signed: true };
    case 'i16':
      return { width: 2, signed: true };
    case 'i32':
      return { width: 4, signed: true };
    default:
      return null;
  }
}

export function writeIntegerToBuffer(
  buffer: Buffer,
  value: number,
  width: 1 | 2 | 4,
  signed: boolean,
  endian: PayloadEndian,
): void {
  if (signed) {
    switch (width) {
      case 1:
        buffer.writeInt8(value, 0);
        return;
      case 2:
        if (endian === 'little') {
          buffer.writeInt16LE(value, 0);
        } else {
          buffer.writeInt16BE(value, 0);
        }
        return;
      case 4:
        if (endian === 'little') {
          buffer.writeInt32LE(value, 0);
        } else {
          buffer.writeInt32BE(value, 0);
        }
        return;
    }
  }

  switch (width) {
    case 1:
      buffer.writeUInt8(value, 0);
      return;
    case 2:
      if (endian === 'little') {
        buffer.writeUInt16LE(value, 0);
      } else {
        buffer.writeUInt16BE(value, 0);
      }
      return;
    case 4:
      if (endian === 'little') {
        buffer.writeUInt32LE(value, 0);
      } else {
        buffer.writeUInt32BE(value, 0);
      }
      return;
  }
}

export function readIntegerFromBuffer(
  buffer: Buffer,
  offset: number,
  width: 1 | 2 | 4,
  signed: boolean,
  endian: PayloadEndian,
): number {
  if (signed) {
    switch (width) {
      case 1:
        return buffer.readInt8(offset);
      case 2:
        return endian === 'little' ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset);
      case 4:
        return endian === 'little' ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset);
    }
  }

  switch (width) {
    case 1:
      return buffer.readUInt8(offset);
    case 2:
      return endian === 'little' ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
    case 4:
      return endian === 'little' ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  }
}

export function applyFixedLength(
  encoded: Buffer,
  length: number | undefined,
  padByte: number,
): Buffer {
  if (length === undefined || encoded.length === length) {
    return encoded;
  }

  if (encoded.length > length) {
    return encoded.subarray(0, length);
  }

  return Buffer.concat([encoded, Buffer.alloc(length - encoded.length, padByte)]);
}
