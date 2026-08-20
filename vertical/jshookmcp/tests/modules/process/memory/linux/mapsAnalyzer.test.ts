import { describe, it, expect } from 'vitest';

import { parseProcMaps } from '@modules/process/memory/linux/mapsParser';
import {
  analyzeMaps,
  annotateRegion,
  classifyRegion,
} from '@modules/process/memory/linux/mapsAnalyzer';

describe('memory/linux/mapsAnalyzer', () => {
  describe('annotateRegion', () => {
    it('marks a vanilla r-xp file-backed region as executable, non-anonymous, clean', () => {
      const [region] = parseProcMaps('00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat');
      const a = annotateRegion(region!);
      expect(a.executable).toBe(true);
      expect(a.writable).toBe(false);
      expect(a.isAnonymous).toBe(false);
      expect(a.isWritableExecutable).toBe(false);
      expect(a.isDeletedBacking).toBe(false);
      expect(a.start).toBe('0x400000');
      expect(a.end).toBe('0x452000');
      expect(a.size).toBe(0x52000);
      expect(a.perms).toBe('r-xp');
    });

    it('flags an anonymous RWX region (no pathname) as anonymous + writable-executable', () => {
      const [region] = parseProcMaps('7f0000000000-7f0000100000 rwxp 00000000 00:00 0 ');
      const a = annotateRegion(region!);
      expect(a.isAnonymous).toBe(true);
      expect(a.writable).toBe(true);
      expect(a.executable).toBe(true);
      expect(a.isWritableExecutable).toBe(true);
      expect(a.pathname).toBe('');
    });

    it('detects the "(deleted)" backing suffix', () => {
      const [region] = parseProcMaps(
        '00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat (deleted)',
      );
      const a = annotateRegion(region!);
      expect(a.isDeletedBacking).toBe(true);
    });
  });

  describe('classifyRegion', () => {
    it('returns no flags for a clean read-only data mapping', () => {
      const [region] = parseProcMaps('600000-700000 r--p 00000000 08:01 1 /lib/foo.dat');
      expect(classifyRegion(annotateRegion(region!))).toEqual([]);
    });

    it('returns anonymous-executable for anon r-x (e.g. JIT)', () => {
      const [region] = parseProcMaps('7f1000000000-7f1000100000 r-xp 00000000 00:00 0 ');
      expect(classifyRegion(annotateRegion(region!))).toEqual(['anonymous-executable']);
    });

    it('returns both anonymous-executable and writable-executable for anon rwx', () => {
      const [region] = parseProcMaps('7f1000000000-7f1000100000 rwxp 00000000 00:00 0 ');
      expect(classifyRegion(annotateRegion(region!))).toEqual([
        'anonymous-executable',
        'writable-executable',
      ]);
    });

    it('returns writable-executable for a file-backed rwx mapping', () => {
      const [region] = parseProcMaps('100000-200000 rwxp 00000000 08:01 5 /tmp/jit.so');
      expect(classifyRegion(annotateRegion(region!))).toEqual(['writable-executable']);
    });

    it('returns deleted-backing for a replaced-on-disk image', () => {
      const [region] = parseProcMaps('400000-500000 r-xp 00000000 08:01 9 /opt/app/bin (deleted)');
      expect(classifyRegion(annotateRegion(region!))).toEqual(['deleted-backing']);
    });
  });

  describe('analyzeMaps', () => {
    const SAMPLE = [
      '00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat',
      'bad line ignored',
      '7f0000000000-7f0000100000 rwxp 00000000 00:00 0 ',
      '7f1000000000-7f1000100000 r-xp 00000000 00:00 0 ',
      '00600000-00610000 r--p 00000000 08:01 1 /lib/foo.dat',
      '00400000-00452000 r-xp 00000000 08:01 12345 /usr/bin/cat (deleted)',
    ].join('\n');

    it('tallies the summary counts correctly', () => {
      const { summary } = analyzeMaps(parseProcMaps(SAMPLE));
      // 5 valid lines (bad line dropped): cat(r-x), anon-rwx, anon-r-x, foo(r--), cat(deleted r-x)
      expect(summary.totalRegions).toBe(5);
      expect(summary.executable).toBe(4); // cat, anon-rwx, anon-r-x, deleted-cat
      expect(summary.anonymous).toBe(2); // anon-rwx + anon-r-x
      expect(summary.anonymousExecutable).toBe(2);
      expect(summary.writableExecutable).toBe(1); // anon-rwx only
      expect(summary.deletedBacking).toBe(1);
    });

    it('collects only regions with ≥1 signal, each with named flags', () => {
      const { signals } = analyzeMaps(parseProcMaps(SAMPLE));
      const starts = signals.map((s) => s.start).toSorted();
      // clean cat (0x400000 r-xp file-backed) is NOT flagged; deleted cat IS.
      expect(starts).toEqual(['0x400000', '0x7f0000000000', '0x7f1000000000'].toSorted());
      const anonRwx = signals.find((s) => s.start === '0x7f0000000000');
      expect(anonRwx?.flags).toEqual(['anonymous-executable', 'writable-executable']);
      const deletedCat = signals.find((s) => s.pathname.includes('cat'));
      expect(deletedCat?.flags).toEqual(['deleted-backing']);
    });

    it('emits the honest framing note (not a threat verdict)', () => {
      const { note } = analyzeMaps(parseProcMaps(SAMPLE));
      expect(note).toMatch(/Not a threat verdict/i);
      expect(note).toMatch(/JIT/i);
    });

    it('produces empty signals and zeroed counts for a clean mapping set', () => {
      const clean = ['00400000-00452000 r-xp 00000000 08:01 1 /bin/true'].join('\n');
      const result = analyzeMaps(parseProcMaps(clean));
      expect(result.signals).toEqual([]);
      expect(result.summary).toEqual({
        totalRegions: 1,
        executable: 1,
        anonymous: 0,
        anonymousExecutable: 0,
        writableExecutable: 0,
        deletedBacking: 0,
      });
    });
  });
});
