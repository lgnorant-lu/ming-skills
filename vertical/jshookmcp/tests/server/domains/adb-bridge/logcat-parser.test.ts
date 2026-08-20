import { describe, expect, it } from 'vitest';
import {
  ALL_PRIORITIES,
  meetsMinPriority,
  parseLogcatLine,
  parsePriorityArg,
  priorityPredicate,
} from '@server/domains/adb-bridge/logcat-parser';

const LINE =
  '03-14 12:34:56.789  1234  5678 I ActivityManager: Displayed com.example/.MainActivity';

describe('parseLogcatLine', () => {
  it('parses threadtime format into structured fields', () => {
    const parsed = parseLogcatLine(LINE);
    expect(parsed).toMatchObject({
      timestamp: '03-14 12:34:56.789',
      pid: 1234,
      tid: 5678,
      priority: 'I',
      tag: 'ActivityManager',
      message: 'Displayed com.example/.MainActivity',
    });
  });

  it('handles a tag containing spaces and an empty message', () => {
    const parsed = parseLogcatLine('01-02 03:04:05.000  9 9 W Some Tag: ');
    expect(parsed.tag).toBe('Some Tag');
    expect(parsed.message).toBe('');
    expect(parsed.priority).toBe('W');
  });

  it('returns raw-only for non-threadtime lines', () => {
    const parsed = parseLogcatLine('--------- beginning of main');
    expect(parsed.raw).toBe('--------- beginning of main');
    expect(parsed.priority).toBeUndefined();
  });
});

describe('priority filtering', () => {
  it('ranks priorities V<D<I<W<E<F<S', () => {
    expect(ALL_PRIORITIES).toEqual(['V', 'D', 'I', 'W', 'E', 'F', 'S']);
  });

  it('meetsMinPriority keeps lines at or above the threshold', () => {
    const warn = parseLogcatLine('01-01 00:00:00.000 1 1 W Tag: oops');
    const info = parseLogcatLine('01-01 00:00:00.000 1 1 I Tag: ok');
    expect(meetsMinPriority(warn, 'W')).toBe(true);
    expect(meetsMinPriority(info, 'W')).toBe(false);
  });

  it('passes unparseable lines through (never silently drops)', () => {
    const header = parseLogcatLine('--------- beginning of main');
    expect(meetsMinPriority(header, 'E')).toBe(true);
  });

  it('priorityPredicate filters raw lines for LogcatLineCollector', () => {
    const pred = priorityPredicate('E');
    expect(pred('01-01 00:00:00.000 1 1 E Tag: fatal')).toBe(true);
    expect(pred('01-01 00:00:00.000 1 1 I Tag: ok')).toBe(false);
  });
});

describe('parsePriorityArg', () => {
  it('accepts single-letter priorities case-insensitively', () => {
    expect(parsePriorityArg('w')).toBe('W');
    expect(parsePriorityArg(undefined)).toBeUndefined();
  });

  it('rejects unknown priorities', () => {
    expect(() => parsePriorityArg('X')).toThrow(/Invalid minPriority/);
  });
});
