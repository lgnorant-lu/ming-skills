/**
 * Shared input-validation helpers for the memory domain handlers.
 *
 * These helpers throw `Error` with tool/field context on invalid input. Because
 * every memory handler is wrapped in `handleSafe`, thrown errors surface as
 * `{ success: false, error: "<message>" }` ToolResponses — no reflexive
 * try/catch needed at call sites.
 *
 * Design notes:
 * - Hex addresses accept both `0x...` and bare hex (native layer prepends `0x`).
 * - Byte arrays accept `number[]` with each element an integer in [0, 255].
 * - "Required" helpers throw a contextual message naming the tool + field.
 */

const HEX_ADDRESS_RE = /^(0x)?[0-9a-fA-F]+$/;

/**
 * Validate that `value` is a hex address string (e.g. "0x7FF612340000", "7FF6", "0x1234AB").
 * Throws `${fieldName} must be a hex address (e.g. "0x7FF612340000"), got: "<value>"` otherwise.
 */
export function validateHexAddress(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0 || !HEX_ADDRESS_RE.test(value)) {
    throw new Error(
      `${fieldName} must be a hex address (e.g. "0x7FF612340000"), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Validate that `value` is a non-empty array of integers in the byte range [0, 255].
 * Throws `${fieldName} must be an array of bytes (0-255), got invalid element at index N` on violation.
 */
export function validateBytesArray(value: unknown, fieldName: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `${fieldName} must be a non-empty array of bytes (0-255), got: ${JSON.stringify(value)}`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const el = value[i];
    if (typeof el !== 'number' || !Number.isInteger(el) || el < 0 || el > 255) {
      throw new Error(
        `${fieldName} must be an array of bytes (0-255), got invalid element at index ${i}: ${JSON.stringify(el)}`,
      );
    }
  }
  return value as number[];
}

/**
 * Require a non-empty string argument. Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected non-empty string)` on violation.
 */
export function requireStringArg(value: unknown, fieldName: string, toolName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected non-empty string), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Require a positive finite number argument (e.g. counts, sizes in bytes). Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected positive number)` on violation.
 */
export function requirePositiveNumberArg(
  value: unknown,
  fieldName: string,
  toolName: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected positive number), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Require a number argument within an inclusive `[min, max]` range. Throws
 * `${toolName}: argument "${fieldName}" must be in [min, max], got: <value>` on violation.
 *
 * Used to bound operator inputs that have sane operational ranges (e.g. speedhack
 * multipliers 0.01x–100x, freeze intervals ≥10ms) so extreme values cannot
 * destabilise the target process.
 */
export function requireNumberInRangeArg(
  value: unknown,
  fieldName: string,
  toolName: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `${toolName}: argument "${fieldName}" must be a finite number in [${min}, ${max}], got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Require a positive integer argument (e.g. counts, sizes in bytes). Throws
 * `${toolName}: missing or invalid required argument "${fieldName}" (expected positive integer)` on violation.
 */
export function requirePositiveIntArg(value: unknown, fieldName: string, toolName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected positive integer), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Validate that a scan value string is well-formed for its declared value type.
 *
 * This is an early-reject guard so that malformed inputs (e.g. "abc" paired
 * with `int32`, or "12.5" with `uint64`) surface as a clear handler-layer
 * error instead of a cryptic native FFI failure. The native scanner re-parses
 * the value, so this only needs to catch gross mismatches — it intentionally
 * stays looser than the native parser to avoid rejecting valid edge cases.
 *
 * Throws `${toolName}: value "<value>" is not valid for valueType "<type>" ...`
 * on violation. `string` values are accepted as-is (any non-empty content).
 */
export function validateValueForType(value: string, valueType: string, toolName: string): void {
  const v = value.trim();
  switch (valueType) {
    case 'int8':
    case 'int16':
    case 'int32':
    case 'int64':
    case 'uint8':
    case 'uint16':
    case 'uint32':
    case 'uint64': {
      if (!/^-?\d+$/.test(v)) {
        throw new Error(
          `${toolName}: value ${JSON.stringify(value)} is not a valid integer for valueType "${valueType}"`,
        );
      }
      break;
    }
    case 'float':
    case 'double': {
      if (!/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(v)) {
        throw new Error(
          `${toolName}: value ${JSON.stringify(value)} is not a valid number for valueType "${valueType}"`,
        );
      }
      break;
    }
    case 'hex': {
      if (!/^([0-9a-fA-F]{2}\s*)+$/.test(v)) {
        throw new Error(
          `${toolName}: value ${JSON.stringify(value)} is not valid hex bytes for valueType "hex" (expected space-separated byte pairs, e.g. "48 65 6C 6C 6F")`,
        );
      }
      break;
    }
    case 'byte': {
      if (!/^-?\d+$/.test(v) || Number(v) < 0 || Number(v) > 255) {
        throw new Error(
          `${toolName}: value ${JSON.stringify(value)} is not a valid byte (0-255) for valueType "byte"`,
        );
      }
      break;
    }
    case 'pointer': {
      if (!/^(0x)?[0-9a-fA-F]+$/.test(v)) {
        throw new Error(
          `${toolName}: value ${JSON.stringify(value)} is not a valid hex pointer for valueType "pointer"`,
        );
      }
      break;
    }
    case 'string':
      // Any non-empty string is a valid search subject.
      break;
    default:
      // Unknown types are passed through — the native layer is the final arbiter.
      break;
  }
}

/**
 * Parse a JSON string argument with contextual error wrapping.
 * Throws `${toolName}: argument "${fieldName}" must be valid JSON — <parseError>` on failure.
 */
export function parseJsonArg<T = unknown>(value: unknown, fieldName: string, toolName: string): T {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${toolName}: missing or invalid required argument "${fieldName}" (expected JSON string), got: ${JSON.stringify(value)}`,
    );
  }
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    throw new Error(
      `${toolName}: argument "${fieldName}" must be valid JSON — ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
