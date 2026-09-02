/**
 * Pattern parsing helpers shared between platform scan implementations.
 */

export interface PatternParseOptions {
  /**
   * Strict mode (macOS scanner contract): malformed tokens throw with a
   * specific message instead of being skipped.
   */
  strict?: boolean;
  /**
   * Throw 'Invalid pattern' when no bytes were produced. Default true for the
   * scanner path; BaseMemoryManager's legacy helper expects empty arrays.
   */
  throwOnEmpty?: boolean;
}

/**
 * Convert a pattern string + type into a byte array and bitmask.
 * Used by Windows (PowerShell), Linux (direct memory read) and macOS scanners.
 *
 * Lenient mode (default): malformed hex/numeric tokens are skipped; an empty
 * result throws 'Invalid pattern'. Strict mode: each malformed token throws a
 * specific message (macOS scanner contract). `throwOnEmpty: false` returns
 * empty arrays instead of throwing (BaseMemoryManager legacy behavior).
 */
export function buildPatternBytesAndMask(
  pattern: string,
  patternType: string,
  options: PatternParseOptions = {},
): { patternBytes: number[]; mask: number[] } {
  const { strict = false, throwOnEmpty = true } = options;
  let patternBytes: number[] = [];
  let mask: number[] = [];

  switch (patternType) {
    case 'hex': {
      const hexParts = pattern.trim().split(/\s+/);
      for (const part of hexParts) {
        if (part === '??' || part === '**' || part === '?') {
          patternBytes.push(0);
          mask.push(0);
        } else {
          const byte = parseInt(part, 16);
          if (!isNaN(byte)) {
            patternBytes.push(byte);
            mask.push(1);
          } else if (strict) {
            throw new Error(`Invalid hex byte: ${part}`);
          }
        }
      }
      if (strict && patternBytes.length === 0) {
        throw new Error('Pattern is empty');
      }
      break;
    }
    case 'int32': {
      const int32Val = parseInt(pattern);
      if (!isNaN(int32Val)) {
        const buf = Buffer.allocUnsafe(4);
        buf.writeInt32LE(int32Val, 0);
        patternBytes = Array.from(buf);
        mask = [1, 1, 1, 1];
      } else if (strict) {
        throw new Error('Invalid int32 value');
      }
      break;
    }
    case 'int64': {
      const int64Val = BigInt.asIntN(64, BigInt(pattern));
      const buf64 = Buffer.allocUnsafe(8);
      buf64.writeBigInt64LE(int64Val, 0);
      patternBytes = Array.from(buf64);
      mask = [1, 1, 1, 1, 1, 1, 1, 1];
      break;
    }
    case 'float': {
      const floatVal = parseFloat(pattern);
      if (!isNaN(floatVal)) {
        const bufFloat = Buffer.allocUnsafe(4);
        bufFloat.writeFloatLE(floatVal, 0);
        patternBytes = Array.from(bufFloat);
        mask = [1, 1, 1, 1];
      } else if (strict) {
        throw new Error('Invalid float value');
      }
      break;
    }
    case 'double': {
      const doubleVal = parseFloat(pattern);
      if (!isNaN(doubleVal)) {
        const bufDouble = Buffer.allocUnsafe(8);
        bufDouble.writeDoubleLE(doubleVal, 0);
        patternBytes = Array.from(bufDouble);
        mask = [1, 1, 1, 1, 1, 1, 1, 1];
      } else if (strict) {
        throw new Error('Invalid double value');
      }
      break;
    }
    case 'string': {
      const stringBuf = Buffer.from(pattern, 'utf8');
      patternBytes = Array.from(stringBuf);
      mask = patternBytes.map(() => 1);
      break;
    }
    default:
      if (strict) {
        throw new Error(`Unsupported pattern type: ${patternType}`);
      }
      break;
  }

  if (patternBytes.length === 0 && throwOnEmpty) {
    throw new Error('Invalid pattern');
  }

  return { patternBytes, mask };
}

/**
 * Strict variant (macOS scanner contract): malformed tokens throw with a
 * specific message. Thin wrapper over the shared core.
 */
export function patternToBytesMac(
  pattern: string,
  patternType: string,
): { bytes: number[]; mask: number[] } {
  const { patternBytes, mask } = buildPatternBytesAndMask(pattern, patternType, { strict: true });
  return { bytes: patternBytes, mask };
}
