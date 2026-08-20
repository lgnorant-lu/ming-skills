export type DetectSource = 'base64' | 'hex' | 'file' | 'raw';
export type EntropySource = 'base64' | 'hex' | 'raw' | 'file';
export type DecodeEncoding =
  | 'base64'
  | 'base32'
  | 'base32hex'
  | 'base32-crockford'
  | 'base58'
  | 'base85'
  | 'hex'
  | 'url'
  | 'gzip'
  | 'zlib'
  | 'deflate'
  | 'brotli'
  | 'protobuf'
  | 'msgpack';
export type OutputFormat = 'hex' | 'utf8' | 'json';
export type InputFormat = 'utf8' | 'hex' | 'json';
export type OutputEncoding =
  | 'base64'
  | 'base32'
  | 'base32hex'
  | 'base32-crockford'
  | 'base58'
  | 'base85'
  | 'hex'
  | 'url'
  | 'gzip'
  | 'zlib'
  | 'deflate'
  | 'brotli';
export type EntropyAssessment = 'plaintext' | 'encoded' | 'compressed' | 'encrypted' | 'random';

export interface MagicSignature {
  readonly format: string;
  readonly bytes: readonly number[];
  readonly offset?: number;
}

export interface ByteFrequencyEntry {
  byte: string;
  count: number;
  ratio: number;
}

export interface ProtobufFieldNode {
  index: number;
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  value: unknown;
}

export interface ProtobufParseResult {
  fields: ProtobufFieldNode[];
  bytesConsumed: number;
  error?: string;
}

export interface MsgPackDecodeResult {
  value: unknown;
  offset: number;
}

export const MAGIC_SIGNATURES = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46] },
  { format: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
  { format: 'zip/apk', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { format: 'gzip', bytes: [0x1f, 0x8b] },
  { format: 'elf', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { format: 'pe/dos', bytes: [0x4d, 0x5a] },
  { format: 'mach-o-32be', bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { format: 'mach-o-32le', bytes: [0xce, 0xfa, 0xed, 0xfe] },
  { format: 'mach-o-64be', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { format: 'mach-o-64le', bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { format: 'bmp', bytes: [0x42, 0x4d] },
  { format: 'webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { format: 'zstd', bytes: [0x28, 0xb5, 0x2f, 0xfd] },
  { format: 'cbor-self-described', bytes: [0xd9, 0xd9, 0xf7] },
] satisfies ReadonlyArray<MagicSignature>;

export const DETECT_SOURCE_SET: ReadonlySet<DetectSource> = new Set([
  'base64',
  'hex',
  'file',
  'raw',
]);
export const ENTROPY_SOURCE_SET: ReadonlySet<EntropySource> = new Set([
  'base64',
  'hex',
  'raw',
  'file',
]);
export const DECODE_ENCODING_SET: ReadonlySet<DecodeEncoding> = new Set([
  'base64',
  'base32',
  'base32hex',
  'base32-crockford',
  'base58',
  'base85',
  'hex',
  'url',
  'gzip',
  'zlib',
  'deflate',
  'brotli',
  'protobuf',
  'msgpack',
]);
export const OUTPUT_FORMAT_SET: ReadonlySet<OutputFormat> = new Set(['hex', 'utf8', 'json']);
export const INPUT_FORMAT_SET: ReadonlySet<InputFormat> = new Set(['utf8', 'hex', 'json']);
export const OUTPUT_ENCODING_SET: ReadonlySet<OutputEncoding> = new Set([
  'base64',
  'base32',
  'base32hex',
  'base32-crockford',
  'base58',
  'base85',
  'hex',
  'url',
  'gzip',
  'zlib',
  'deflate',
  'brotli',
]);
