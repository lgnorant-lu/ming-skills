import { describe, expect, it } from 'vitest';
import { escapeRegexStr } from '@utils/escapeForRegex';

describe('escapeRegexStr', () => {
  it('escapes all regex metacharacters', () => {
    expect(escapeRegexStr('a.b')).toBe('a\\.b');
    expect(escapeRegexStr('a+b')).toBe('a\\+b');
    expect(escapeRegexStr('a?b')).toBe('a\\?b');
    expect(escapeRegexStr('a^b')).toBe('a\\^b');
    expect(escapeRegexStr('a$b')).toBe('a\\$b');
    expect(escapeRegexStr('a{b}c')).toBe('a\\{b\\}c');
    expect(escapeRegexStr('a(b)c')).toBe('a\\(b\\)c');
    expect(escapeRegexStr('a|b')).toBe('a\\|b');
    expect(escapeRegexStr('a[b]')).toBe('a\\[b\\]');
    expect(escapeRegexStr('a\\b')).toBe('a\\\\b');
  });

  it('preserves the wildcard star for downstream glob-to-regex conversion', () => {
    expect(escapeRegexStr('*foo*')).toBe('*foo*');
    expect(escapeRegexStr('api/*/data')).toBe('api/*/data');
  });

  it('leaves plain strings untouched', () => {
    expect(escapeRegexStr('hello world')).toBe('hello world');
    expect(escapeRegexStr('foo-bar_42')).toBe('foo-bar_42');
    expect(escapeRegexStr('')).toBe('');
  });

  it('produces a regex that matches the original literal', () => {
    // After escaping, the only metacharacter left is the preserved `*`.
    const escaped = escapeRegexStr('a.b+c');
    expect(new RegExp(`^${escaped}$`).test('a.b+c')).toBe(true);
    expect(new RegExp(`^${escaped}$`).test('axbc')).toBe(false);
  });
});
