import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';

export interface BinaryMagicHint {
  label: string;
  prefix: Uint8Array;
  description?: string;
}

export interface BinaryMagicHintInput {
  label: string;
  prefixHex?: string;
  prefixAscii?: string;
  description?: string;
}

const config = getReverseEngineeringConfig().binaryMagic;

export const BINARY_MAGIC_HINTS: readonly BinaryMagicHint[] = [
  {
    label: 'dex',
    prefix: asciiPrefix(config.dexMagicAscii),
    description: 'Dalvik executable header',
  },
  {
    label: 'cdex',
    prefix: asciiPrefix(config.compactDexMagicAscii),
    description: 'Compact DEX header',
  },
  {
    label: 'elf',
    prefix: bytesPrefix([0x7f, 0x45, 0x4c, 0x46]),
    description: 'ELF object header',
  },
  {
    label: 'gzip',
    prefix: bytesPrefix([0x1f, 0x8b]),
    description: 'Gzip stream header',
  },
  {
    label: 'zip',
    prefix: bytesPrefix([0x50, 0x4b]),
    description: 'ZIP container header',
  },
] as const;

export function resolveBinaryMagicHints(
  customHints: readonly BinaryMagicHintInput[] = [],
): readonly BinaryMagicHint[] {
  if (customHints.length === 0) return BINARY_MAGIC_HINTS;
  return [...BINARY_MAGIC_HINTS, ...customHints.map(parseBinaryMagicHint)];
}

export function matchBinaryMagicHints(
  buffer: Uint8Array,
  hints: readonly BinaryMagicHint[] = BINARY_MAGIC_HINTS,
): string[] {
  const labels: string[] = [];
  for (const hint of hints) {
    if (hint.prefix.length === 0 || hint.prefix.length > buffer.length) continue;
    if (hasPrefix(buffer, hint.prefix)) labels.push(hint.label);
  }
  return [...new Set(labels)];
}

function parseBinaryMagicHint(input: BinaryMagicHintInput): BinaryMagicHint {
  if (!input || typeof input !== 'object') {
    throw new Error('customMagicHints entries must be objects');
  }
  const label = input.label.trim();
  if (!label) throw new Error('customMagicHints label must be a non-empty string');
  const prefix =
    typeof input.prefixHex === 'string' && input.prefixHex.trim().length > 0
      ? hexPrefix(input.prefixHex)
      : typeof input.prefixAscii === 'string'
        ? asciiPrefix(input.prefixAscii)
        : new Uint8Array(0);
  if (prefix.length === 0) {
    throw new Error('customMagicHints entries require prefixHex or prefixAscii');
  }
  return {
    label,
    prefix,
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
  };
}

function asciiPrefix(value: string): Uint8Array {
  return boundedPrefix(Buffer.from(value, 'ascii'));
}

function bytesPrefix(value: readonly number[]): Uint8Array {
  return boundedPrefix(Uint8Array.from(value));
}

function hexPrefix(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '');
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
    throw new Error('customMagicHints prefixHex must contain an even number of hex bytes');
  }
  return boundedPrefix(Buffer.from(normalized, 'hex'));
}

function boundedPrefix(prefix: Uint8Array): Uint8Array {
  const maxBytes = getReverseEngineeringConfig().binaryMagic.hintPrefixMaxBytes;
  if (prefix.length > maxBytes) {
    throw new Error(`Binary magic prefix is too long: ${prefix.length} bytes > ${maxBytes} bytes`);
  }
  return prefix;
}

function hasPrefix(buffer: Uint8Array, prefix: Uint8Array): boolean {
  for (let index = 0; index < prefix.length; index++) {
    if (buffer[index] !== prefix[index]) return false;
  }
  return true;
}
