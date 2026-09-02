import { decode, ExtData, ExtensionCodec } from '@msgpack/msgpack';
import { bigIntToSafeValue } from '@server/domains/encoding/encoding-protobuf';

/**
 * MessagePack decoding via the official `@msgpack/msgpack` package.
 *
 * Binary output follows the grpc-raw convention: `base64` is the single
 * authoritative representation; `hex` is derived on demand only when
 * `includeHex` is set (it is recoverable from base64, so we don't store both
 * by default). `extType` is always retained on ext values — reverse
 * engineering needs the type discriminator.
 *
 * Adaptations over the raw package behaviour:
 * - `useBigInt64: true` then map back through `bigIntToSafeValue`, preserving
 *   the project convention of number-within-safe-range / string-beyond.
 * - A raw ext codec override for type -1 (timestamp): the package's default
 *   codec converts 4/8/12-byte payloads into `Date` and rejects others. We
 *   want the raw payload bytes, never an interpreted Date.
 * - `mapKeyConverter` reuses `msgPackMapKey` so bool/null/number keys keep
 *   their stringified behaviour.
 */
export function decodeMsgPack(buffer: Buffer, includeHex = false): unknown {
  const decoded = decode(buffer, {
    useBigInt64: true,
    extensionCodec: RAW_EXT_CODEC,
    mapKeyConverter: (key: unknown): string | number => msgPackMapKey(key),
  });
  return adapt(decoded, includeHex);
}

/** grpc-raw-style binary wrapper: base64 authoritative, hex derived on demand. */
function binPayload(payload: Buffer, includeHex: boolean): { base64: string; hex?: string } {
  return {
    base64: payload.toString('base64'),
    ...(includeHex ? { hex: payload.toString('hex') } : {}),
  };
}

/** grpc-raw-style ext wrapper: extType always retained, payload as base64 (+hex on demand). */
function extPayload(
  extType: number,
  payload: Buffer,
  includeHex: boolean,
): { extType: number; base64: string; hex?: string } {
  return {
    extType,
    ...binPayload(payload, includeHex),
  };
}

/** Disable the package's built-in timestamp (ext -1) decoding; keep raw bytes. */
const RAW_EXT_CODEC: ExtensionCodec = (() => {
  const codec = new ExtensionCodec();
  codec.register({
    type: -1,
    encode: () => null,
    decode: (data: Uint8Array, extType: number): unknown => new ExtData(extType, data),
  });
  return codec;
})();

function adapt(value: unknown, includeHex: boolean): unknown {
  if (value instanceof Uint8Array) {
    return binPayload(Buffer.from(value), includeHex);
  }
  if (value instanceof ExtData) {
    const raw = typeof value.data === 'function' ? value.data(0) : value.data;
    return extPayload(value.type, Buffer.from(raw as Uint8Array), includeHex);
  }
  if (typeof value === 'bigint') {
    return bigIntToSafeValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => adapt(item, includeHex));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = adapt(item, includeHex);
    }
    return out;
  }
  return value;
}

export function msgPackMapKey(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null) return 'null';

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
