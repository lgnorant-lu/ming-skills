import { describe, expect, it } from 'vitest';
import { matchesWildcardPattern } from '@utils/matchesWildcardPattern';

describe('matchesWildcardPattern', () => {
  it('empty pattern matches everything', () => {
    expect(matchesWildcardPattern('anything', '')).toBe(true);
    expect(matchesWildcardPattern('', '')).toBe(true);
  });

  it('pattern of only stars matches everything', () => {
    expect(matchesWildcardPattern('anything', '*')).toBe(true);
    expect(matchesWildcardPattern('', '*')).toBe(true);
    expect(matchesWildcardPattern('anything', '**')).toBe(true);
  });

  it('pattern without stars is a literal substring match', () => {
    expect(matchesWildcardPattern('example.com', 'example.com')).toBe(true);
    expect(matchesWildcardPattern('https://example.com/app.js', 'example.com')).toBe(true);
    expect(matchesWildcardPattern('abcdef', 'bcd')).toBe(true);
    expect(matchesWildcardPattern('axcdef', 'bcd')).toBe(false);
    expect(matchesWildcardPattern('', 'api')).toBe(false);
  });

  it('anchors the first segment to the start when the pattern has no leading star', () => {
    expect(matchesWildcardPattern('foobar', 'foo*')).toBe(true);
    expect(matchesWildcardPattern('foo', 'foo*')).toBe(true);
    expect(matchesWildcardPattern('xfoobar', 'foo*')).toBe(false);
    expect(matchesWildcardPattern('xfoo', 'foo*')).toBe(false);
  });

  it('anchors the last segment to the end when the pattern has no trailing star', () => {
    expect(matchesWildcardPattern('xfoo', '*foo')).toBe(true);
    expect(matchesWildcardPattern('foo', '*foo')).toBe(true);
    expect(matchesWildcardPattern('foobar', '*foo')).toBe(false);
    expect(matchesWildcardPattern('xfooy', '*foo')).toBe(false);
  });

  it('requires segments to appear in order', () => {
    expect(matchesWildcardPattern('aXXbYYc', 'a*b*c')).toBe(true);
    expect(matchesWildcardPattern('aXbYc', 'a*b*c')).toBe(true);
    expect(matchesWildcardPattern('bXaYc', 'a*b*c')).toBe(false);
  });

  it('enforces the end anchor even when all segments matched somewhere', () => {
    expect(matchesWildcardPattern('foobar', 'foo*bar')).toBe(true);
    expect(matchesWildcardPattern('foobazbar', 'foo*bar')).toBe(true);
    expect(matchesWildcardPattern('xfoobar', 'foo*bar')).toBe(false);
    expect(matchesWildcardPattern('foobarx', 'foo*bar')).toBe(false);
    expect(matchesWildcardPattern('xxapi.yydatazz', 'api/*/data')).toBe(false);
    expect(matchesWildcardPattern('api/x/data', 'api/*/data')).toBe(true);
  });

  it('treats consecutive stars like a single star', () => {
    expect(matchesWildcardPattern('aXbYc', 'a**b**c')).toBe(true);
    expect(matchesWildcardPattern('abc', 'a**b**c')).toBe(true);
    expect(matchesWildcardPattern('abXc', 'a**b**c')).toBe(true);
  });

  it('star matches zero characters', () => {
    expect(matchesWildcardPattern('abc', 'a*b*c')).toBe(true);
    expect(matchesWildcardPattern('ac', 'a*c')).toBe(true);
  });

  it('is case sensitive by default', () => {
    expect(matchesWildcardPattern('FOO', 'foo*')).toBe(false);
    expect(matchesWildcardPattern('foo', 'FOO*')).toBe(false);
  });
});
