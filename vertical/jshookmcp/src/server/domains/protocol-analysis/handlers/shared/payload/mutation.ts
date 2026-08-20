import { isRecord } from '../protocol-schema';
import {
  BINARY_ENCODINGS,
  decodeBinaryValue,
  expectString,
  getNumericRange,
  MUTATION_STRATEGIES,
  parseByte,
  parseEncoding,
  parseEndian,
  parseInteger,
  parseNonNegativeInteger,
  readIntegerFromBuffer,
  type PayloadMutation,
  type PayloadMutationStrategy,
  type PayloadMutationSummary,
  writeIntegerToBuffer,
} from './core';

export function parsePayloadMutation(value: unknown, index: number): PayloadMutation {
  if (!isRecord(value)) {
    throw new Error(`mutations[${index}] must be an object`);
  }

  const strategy = value.strategy;
  if (
    typeof strategy !== 'string' ||
    !MUTATION_STRATEGIES.includes(strategy as PayloadMutationStrategy)
  ) {
    throw new Error(`mutations[${index}].strategy is invalid`);
  }

  switch (strategy as PayloadMutationStrategy) {
    case 'set_byte':
      return {
        strategy: 'set_byte',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        value: parseByte(value.value, `mutations[${index}].value`),
      };
    case 'flip_bit':
      return {
        strategy: 'flip_bit',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        bit: (() => {
          const bit = parseInteger(value.bit, `mutations[${index}].bit`);
          if (bit < 0 || bit > 7) {
            throw new Error(`mutations[${index}].bit must be between 0 and 7`);
          }
          return bit;
        })(),
      };
    case 'overwrite_bytes':
      return {
        strategy: 'overwrite_bytes',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        data: decodeBinaryValue(
          expectString(value.data, `mutations[${index}].data`),
          parseEncoding(value.encoding, BINARY_ENCODINGS, 'hex', `mutations[${index}].encoding`),
          `mutations[${index}].data`,
        ),
      };
    case 'append_bytes':
      return {
        strategy: 'append_bytes',
        data: decodeBinaryValue(
          expectString(value.data, `mutations[${index}].data`),
          parseEncoding(value.encoding, BINARY_ENCODINGS, 'hex', `mutations[${index}].encoding`),
          `mutations[${index}].data`,
        ),
      };
    case 'truncate':
      return {
        strategy: 'truncate',
        length: parseNonNegativeInteger(value.length, `mutations[${index}].length`),
      };
    case 'increment_integer': {
      const width = value.width;
      if (width !== 1 && width !== 2 && width !== 4) {
        throw new Error(`mutations[${index}].width must be 1, 2, or 4`);
      }

      return {
        strategy: 'increment_integer',
        offset: parseNonNegativeInteger(value.offset, `mutations[${index}].offset`),
        width,
        delta: parseInteger(value.delta, `mutations[${index}].delta`),
        endian: parseEndian(value.endian),
        signed: value.signed === true,
      };
    }
  }
}

export function applyPayloadMutation(
  payload: Buffer,
  mutation: PayloadMutation,
  index: number,
): { payload: Buffer; summary: PayloadMutationSummary } {
  const working = Buffer.from(payload);
  switch (mutation.strategy) {
    case 'set_byte':
      if (mutation.offset >= working.length) {
        throw new Error(`mutations[${index}] offset is outside the payload`);
      }
      working[mutation.offset] = mutation.value;
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `set payload[${mutation.offset}] to ${mutation.value}`,
        },
      };
    case 'flip_bit':
      if (mutation.offset >= working.length) {
        throw new Error(`mutations[${index}] offset is outside the payload`);
      }
      {
        const currentByte = working[mutation.offset]!;
        working[mutation.offset] = currentByte ^ (1 << mutation.bit);
      }
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `flipped bit ${mutation.bit} at offset ${mutation.offset}`,
        },
      };
    case 'overwrite_bytes':
      if (mutation.offset + mutation.data.length > working.length) {
        throw new Error(`mutations[${index}] overwrite exceeds payload length`);
      }
      mutation.data.copy(working, mutation.offset);
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `overwrote ${mutation.data.length} bytes at offset ${mutation.offset}`,
        },
      };
    case 'append_bytes':
      return {
        payload: Buffer.concat([working, mutation.data]),
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `appended ${mutation.data.length} bytes`,
        },
      };
    case 'truncate':
      if (mutation.length > working.length) {
        throw new Error(`mutations[${index}] length exceeds payload size`);
      }
      return {
        payload: working.subarray(0, mutation.length),
        summary: {
          index,
          strategy: mutation.strategy,
          detail: `truncated payload to ${mutation.length} bytes`,
        },
      };
    case 'increment_integer': {
      if (mutation.offset + mutation.width > working.length) {
        throw new Error(`mutations[${index}] integer range exceeds payload length`);
      }
      const current = readIntegerFromBuffer(
        working,
        mutation.offset,
        mutation.width,
        mutation.signed,
        mutation.endian,
      );
      const next = current + mutation.delta;
      const range = getNumericRange(mutation.width, mutation.signed);
      if (next < range.min || next > range.max) {
        throw new Error(`mutations[${index}] integer overflow (${range.min}..${range.max})`);
      }
      const slice = working.subarray(mutation.offset, mutation.offset + mutation.width);
      writeIntegerToBuffer(slice, next, mutation.width, mutation.signed, mutation.endian);
      return {
        payload: working,
        summary: {
          index,
          strategy: mutation.strategy,
          detail:
            `incremented ${mutation.signed ? 'signed' : 'unsigned'} ${mutation.width}-byte integer at offset ` +
            `${mutation.offset} by ${mutation.delta}`,
        },
      };
    }
  }
}
