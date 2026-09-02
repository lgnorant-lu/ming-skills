import { describe, expect, it } from 'vitest';
import {
  isValidFunctionName,
  normalizeFunctionName,
  parseStatusLine,
  shouldWrapAsObjectMember,
} from '@modules/v8-inspector/isolated-v8-utils';

describe('isolated-v8-utils', () => {
  describe('isValidFunctionName', () => {
    it('accepts plain identifiers', () => {
      expect(isValidFunctionName('myFunc')).toBe(true);
      expect(isValidFunctionName('_private')).toBe(true);
      expect(isValidFunctionName('$dollar')).toBe(true);
      expect(isValidFunctionName('a1b2')).toBe(true);
    });

    it('rejects invalid identifiers', () => {
      expect(isValidFunctionName('my-func')).toBe(false);
      expect(isValidFunctionName('1abc')).toBe(false);
      expect(isValidFunctionName('a b')).toBe(false);
      expect(isValidFunctionName('')).toBe(false);
    });
  });

  describe('normalizeFunctionName', () => {
    const FALLBACK = '__jshookFallback__';

    it('keeps valid names', () => {
      expect(normalizeFunctionName('myFunc', FALLBACK)).toBe('myFunc');
      expect(normalizeFunctionName('  trimmed  ', FALLBACK)).toBe('trimmed');
    });

    it('falls back for empty, anonymous, and invalid names', () => {
      expect(normalizeFunctionName('', FALLBACK)).toBe(FALLBACK);
      expect(normalizeFunctionName('  ', FALLBACK)).toBe(FALLBACK);
      expect(normalizeFunctionName('anonymous', FALLBACK)).toBe(FALLBACK);
      expect(normalizeFunctionName('not valid', FALLBACK)).toBe(FALLBACK);
    });
  });

  describe('shouldWrapAsObjectMember', () => {
    it('wraps object-member style sources', () => {
      expect(shouldWrapAsObjectMember('myMethod() { return 1; }')).toBe(true);
      expect(shouldWrapAsObjectMember('get foo() { return 1; }')).toBe(true);
      expect(shouldWrapAsObjectMember('set foo(v) {}')).toBe(true);
      expect(shouldWrapAsObjectMember('*gen() {}')).toBe(true);
      expect(shouldWrapAsObjectMember('async run() {}')).toBe(true);
    });

    it('does not wrap standalone expressions', () => {
      expect(shouldWrapAsObjectMember('function myFunc() { return 1; }')).toBe(false);
      expect(shouldWrapAsObjectMember('async function f() {}')).toBe(false);
      expect(shouldWrapAsObjectMember('class Foo {}')).toBe(false);
      expect(shouldWrapAsObjectMember('(a, b) => a + b')).toBe(false);
      expect(shouldWrapAsObjectMember('() => 1')).toBe(false);
    });
  });

  describe('parseStatusLine', () => {
    const PREFIX = '__TEST_STATUS__:';

    it('extracts the marker line and strips the prefix', () => {
      const output = ['some V8 output', `${PREFIX}done`, ''].join('\n');
      expect(parseStatusLine(output, PREFIX)).toBe('done');
    });

    it('extracts invoke-error payloads', () => {
      const output = `${PREFIX}invoke-error:ReferenceError: x is not defined\n`;
      expect(parseStatusLine(output, PREFIX)).toBe('invoke-error:ReferenceError: x is not defined');
    });

    it('returns null when no status line is present', () => {
      expect(parseStatusLine('no marker here\n', PREFIX)).toBe(null);
    });

    it('ignores a bare prefix line with no payload', () => {
      expect(parseStatusLine(`${PREFIX}\n`, PREFIX)).toBe(null);
    });
  });
});
