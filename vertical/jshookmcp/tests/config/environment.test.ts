import { afterEach, describe, expect, it } from 'vitest';
import {
  autoInt,
  csv,
  list,
  readEnvBoolean,
  readEnvCsv,
  readEnvFloat,
  readEnvInteger,
  readEnvIntegerList,
  readEnvNullableString,
  readEnvString,
} from '@src/config/environment';

describe('runtime environment readers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads strings without destroying significant whitespace', () => {
    const env = { PRESENT: '  token value  ', EMPTY: '' };

    expect(readEnvString('MISSING', 'fallback', { env })).toBe('fallback');
    expect(readEnvString('EMPTY', 'fallback', { env })).toBe('fallback');
    expect(readEnvString('EMPTY', 'fallback', { env, allowEmpty: true })).toBe('');
    expect(readEnvString('PRESENT', 'fallback', { env })).toBe('  token value  ');
    expect(readEnvString('PRESENT', 'fallback', { env, trim: true })).toBe('token value');
    expect(readEnvNullableString('EMPTY', { env, trim: true })).toBeNull();
    expect(readEnvNullableString('PRESENT', { env, trim: true })).toBe('token value');
  });

  it('accepts only explicit boolean encodings', () => {
    const env = {
      TRUE_WORD: ' TrUe ',
      TRUE_NUMBER: '1',
      FALSE_WORD: 'FALSE',
      FALSE_NUMBER: '0',
      INVALID: 'yes',
      EMPTY: ' ',
    };

    expect(readEnvBoolean('TRUE_WORD', false, { env })).toBe(true);
    expect(readEnvBoolean('TRUE_NUMBER', false, { env })).toBe(true);
    expect(readEnvBoolean('FALSE_WORD', true, { env })).toBe(false);
    expect(readEnvBoolean('FALSE_NUMBER', true, { env })).toBe(false);
    expect(readEnvBoolean('INVALID', true, { env })).toBe(true);
    expect(readEnvBoolean('EMPTY', false, { env })).toBe(false);
  });

  it('strictly parses bounded integers and rejects partial or fractional values', () => {
    const env = {
      VALID: ' 42 ',
      PARTIAL: '42ms',
      FRACTIONAL: '2.5',
      TOO_LOW: '0',
      TOO_HIGH: '101',
      UNSAFE: '9007199254740992',
    };
    const options = { env, min: 1, max: 100 };

    expect(readEnvInteger('VALID', 7, options)).toBe(42);
    expect(readEnvInteger('PARTIAL', 7, options)).toBe(7);
    expect(readEnvInteger('FRACTIONAL', 7, options)).toBe(7);
    expect(readEnvInteger('TOO_LOW', 7, options)).toBe(7);
    expect(readEnvInteger('TOO_HIGH', 7, options)).toBe(7);
    expect(readEnvInteger('UNSAFE', 7, options)).toBe(7);
  });

  it('strictly parses finite decimal floats including exponent notation', () => {
    const env = { DECIMAL: '.25', EXPONENT: '1.5e2', PARTIAL: '1.2px', INFINITE: 'Infinity' };

    expect(readEnvFloat('DECIMAL', 3, { env })).toBe(0.25);
    expect(readEnvFloat('EXPONENT', 3, { env, max: 200 })).toBe(150);
    expect(readEnvFloat('PARTIAL', 3, { env })).toBe(3);
    expect(readEnvFloat('INFINITE', 3, { env })).toBe(3);
  });

  it('parses csv and integer lists with explicit compatibility behavior', () => {
    const env = { CSV: ' Alpha, BETA ,, ', INTS: '1, nope, 3', INVALID_INTS: 'x,y' };

    expect(readEnvCsv('CSV', ['fallback'], { env })).toEqual(['Alpha', 'BETA']);
    expect(readEnvCsv('CSV', ['fallback'], { env, lowercase: true })).toEqual(['alpha', 'beta']);
    expect(readEnvIntegerList('INTS', [9], { env })).toEqual([1, 3]);
    expect(readEnvIntegerList('INVALID_INTS', [9], { env })).toEqual([9]);

    process.env.CSV = env.CSV;
    process.env.INVALID_INTS = env.INVALID_INTS;
    expect(csv('CSV', ['fallback'])).toEqual(['alpha', 'beta']);
    // list() delegates to readEnvIntegerList, so all-invalid input returns the
    // fallback ([9]) — NOT [] — matching readEnvIntegerList. This unifies the
    // otherwise-divergent backward-compat alias. (Behavior change from the old
    // list(), which returned [] on all-invalid.)
    expect(list('INVALID_INTS', [9])).toEqual([9]);
  });

  it('resolves process environment values at call time', () => {
    delete process.env.RUNTIME_ENV_TEST_VALUE;
    expect(readEnvInteger('RUNTIME_ENV_TEST_VALUE', 4)).toBe(4);

    process.env.RUNTIME_ENV_TEST_VALUE = '8';
    expect(readEnvInteger('RUNTIME_ENV_TEST_VALUE', 4)).toBe(8);
  });

  it('supports auto-sized compatibility integers', () => {
    process.env.RUNTIME_ENV_TEST_AUTO = 'auto';
    expect(autoInt('RUNTIME_ENV_TEST_AUTO', 4, () => 6.9)).toBe(6);
    expect(autoInt('RUNTIME_ENV_TEST_AUTO', 4, () => Number.NaN)).toBe(4);
  });
});
