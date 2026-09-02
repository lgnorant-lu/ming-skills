/**
 * Typed access to runtime environment variables.
 *
 * This module is deliberately a dependency leaf: runtime consumers and the
 * legacy constants facade can depend on it without pulling in server/config
 * objects (and their import-time side effects). Values are resolved on every
 * call unless a consumer intentionally snapshots them.
 */
import { cpus } from 'node:os';
import { bootstrapRuntimeEnv } from './env-bootstrap.js';

bootstrapRuntimeEnv();

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface EnvironmentReadOptions {
  /** Alternate source used by tests and callers parsing detached env maps. */
  env?: EnvironmentSource;
}

export interface EnvironmentStringOptions extends EnvironmentReadOptions {
  /** Trim leading/trailing whitespace before checking or returning the value. */
  trim?: boolean;
  /** Return an explicitly empty value instead of the fallback. */
  allowEmpty?: boolean;
}

export interface EnvironmentNumberOptions extends EnvironmentReadOptions {
  /** Inclusive lower bound. Out-of-range values fall back. */
  min?: number;
  /** Inclusive upper bound. Out-of-range values fall back. */
  max?: number;
}

export interface EnvironmentCsvOptions extends EnvironmentReadOptions {
  /** Normalize parsed items to lowercase. */
  lowercase?: boolean;
}

/**
 * Strict integer pattern: optional sign + digits only. Rejects hex (`0x10`),
 * decimals, and trailing junk (`42ms` → no match). Exported so the Zod config
 * layer (`utils/config.ts`) reuses the single source of truth instead of
 * re-declaring an identical regex.
 */
export const INTEGER_PATTERN = /^[+-]?\d+$/;
/**
 * Strict float pattern: decimal or exponent forms. Exported for the same
 * single-source reason as {@link INTEGER_PATTERN}.
 */
export const FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function sourceFor(options: EnvironmentReadOptions): EnvironmentSource {
  return options.env ?? process.env;
}

function isWithinBounds(value: number, options: EnvironmentNumberOptions): boolean {
  if (options.min !== undefined && value < options.min) return false;
  if (options.max !== undefined && value > options.max) return false;
  return true;
}

function parseStrictInteger(raw: string): number | null {
  const normalized = raw.trim();
  if (!INTEGER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseStrictFloat(raw: string): number | null {
  const normalized = raw.trim();
  if (!FLOAT_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readEnvString(
  key: string,
  fallback: string,
  options: EnvironmentStringOptions = {},
): string {
  const raw = sourceFor(options)[key];
  if (raw === undefined) return fallback;
  const value = options.trim === true ? raw.trim() : raw;
  return value.length > 0 || options.allowEmpty === true ? value : fallback;
}

export function readEnvNullableString(
  key: string,
  options: Omit<EnvironmentStringOptions, 'allowEmpty'> = {},
): string | null {
  const raw = sourceFor(options)[key];
  if (raw === undefined) return null;
  const value = options.trim === true ? raw.trim() : raw;
  return value.length > 0 ? value : null;
}

export function readEnvInteger(
  key: string,
  fallback: number,
  options: EnvironmentNumberOptions = {},
): number {
  const raw = sourceFor(options)[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = parseStrictInteger(raw);
  return parsed !== null && isWithinBounds(parsed, options) ? parsed : fallback;
}

export function readEnvFloat(
  key: string,
  fallback: number,
  options: EnvironmentNumberOptions = {},
): number {
  const raw = sourceFor(options)[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = parseStrictFloat(raw);
  return parsed !== null && isWithinBounds(parsed, options) ? parsed : fallback;
}

export function readEnvBoolean(
  key: string,
  fallback: boolean,
  options: EnvironmentReadOptions = {},
): boolean {
  const raw = sourceFor(options)[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
      return true;
    case '0':
    case 'false':
      return false;
    default:
      return fallback;
  }
}

export function readEnvCsv(
  key: string,
  fallback: string[],
  options: EnvironmentCsvOptions = {},
): string[] {
  const raw = sourceFor(options)[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => (options.lowercase === true ? item.toLowerCase() : item));
  return parsed.length > 0 ? parsed : fallback;
}

export function readEnvIntegerList(
  key: string,
  fallback: number[],
  options: EnvironmentNumberOptions = {},
): number[] {
  const raw = sourceFor(options)[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = raw
    .split(',')
    .map((item) => parseStrictInteger(item))
    .filter((item): item is number => item !== null && isWithinBounds(item, options));
  return parsed.length > 0 ? parsed : fallback;
}

export function cpuCount(): number {
  try {
    return cpus().length;
  } catch {
    return 4;
  }
}

// Compatibility aliases for the existing constants modules. New runtime code
// should prefer the explicit readEnv* names above.
export const int = readEnvInteger;
export const float = readEnvFloat;
export const bool = readEnvBoolean;
export const str = readEnvString;
export function csv(
  key: string,
  fallback: string[],
  options: EnvironmentCsvOptions = {},
): string[] {
  return readEnvCsv(key, fallback, { lowercase: true, ...options });
}

/**
 * Backward-compatible alias for `readEnvIntegerList`.
 *
 * Historical compatibility note: the old `list` implementation returned `[]`
 * when every item parsed invalid (no fallback). `readEnvIntegerList` returns
 * the fallback instead — a strictly more robust behavior (config errors
 * preserve the effective default rather than silently emptying a list that a
 * caller then treats as "no values"). Delegating keeps one parse path instead
 * of two subtly-different ones.
 */
export function list(
  key: string,
  fallback: number[],
  options: EnvironmentNumberOptions = {},
): number[] {
  return readEnvIntegerList(key, fallback, options);
}

/** Compatibility form: historically auto-derived fractional values were floored. */
export function autoInt(key: string, fallback: number, autoSupplier: () => number): number {
  const raw = process.env[key];
  if (raw !== undefined && raw.trim().toLowerCase() === 'auto') {
    const derived = autoSupplier();
    return Number.isFinite(derived) && derived > 0 ? Math.floor(derived) : fallback;
  }
  return readEnvInteger(key, fallback);
}
