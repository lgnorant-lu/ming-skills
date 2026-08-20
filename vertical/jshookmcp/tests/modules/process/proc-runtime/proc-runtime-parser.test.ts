import { describe, it, expect } from 'vitest';

import {
  parseProcCmdline,
  parseProcEnviron,
  parseProcStatusSummary,
} from '@modules/process/proc-runtime/proc-runtime-parser';

describe('proc-runtime/proc-runtime-parser', () => {
  describe('parseProcEnviron', () => {
    it('splits NUL-separated KEY=VALUE entries', () => {
      const env = parseProcEnviron('PATH=/usr/bin\0HOME=/root\0TERM=xterm\0');
      expect(env).toEqual({
        PATH: '/usr/bin',
        HOME: '/root',
        TERM: 'xterm',
      });
    });

    it('keeps the last value for duplicate keys (getenv semantics)', () => {
      const env = parseProcEnviron('FOO=1\0FOO=2\0BAR=b\0');
      expect(env.FOO).toBe('2');
      expect(env.BAR).toBe('b');
    });

    it('preserves "=" characters inside the value', () => {
      const env = parseProcEnviron('SECRET=abc=def==ghi\0');
      expect(env.SECRET).toBe('abc=def==ghi');
    });

    it('skips empty entries and entries without "="', () => {
      const env = parseProcEnviron('A=1\0\0B=2\0NOEQUALSIGN\0C=3\0');
      expect(env).toEqual({ A: '1', B: '2', C: '3' });
    });

    it('returns an empty object for blank content', () => {
      expect(parseProcEnviron('')).toEqual({});
    });
  });

  describe('parseProcCmdline', () => {
    it('splits NUL-separated argv and drops the trailing empty', () => {
      const args = parseProcCmdline('/usr/bin/node\0--inspect\0app.js\0');
      expect(args).toEqual(['/usr/bin/node', '--inspect', 'app.js']);
    });

    it('preserves empty arguments in the middle', () => {
      // Real binaries occasionally pass "" as an explicit argv element.
      const args = parseProcCmdline('prog\0\0--flag\0');
      expect(args).toEqual(['prog', '', '--flag']);
    });

    it('returns an empty array for blank content', () => {
      expect(parseProcCmdline('')).toEqual([]);
    });
  });

  describe('parseProcStatusSummary', () => {
    const STATUS = `Name:   node
Umask:  0022
State:  S (sleeping)
Tgid:   4321
Ngid:   0
Pid:    4321
PPid:   1
Uid:    1000  1000  1000  1000
Gid:    1000  1000  1000  1000
VmPeak:   123456 kB
VmSize:   120000 kB
VmRSS:     45678 kB
Threads:        7
CapEff:   0000003fffffffff
NStgid:  0
`;

    it('extracts the well-known summary fields', () => {
      const s = parseProcStatusSummary(STATUS);
      expect(s).toMatchObject({
        name: 'node',
        pid: 4321,
        ppid: 1,
        state: 'S (Sleeping)',
        uid: '1000  1000  1000  1000',
        vmSize: '120000 kB',
        vmRSS: '45678 kB',
        vmPeak: '123456 kB',
        threads: 7,
        capEff: '0000003fffffffff',
      });
    });

    it('ignores unknown keys without failing', () => {
      const s = parseProcStatusSummary('Name: foo\nSomeUnknownField: bar\n');
      expect(s.name).toBe('foo');
      expect((s as unknown as Record<string, unknown>).SomeUnknownField).toBeUndefined();
    });

    it('returns an empty object for blank content', () => {
      expect(parseProcStatusSummary('')).toEqual({});
    });

    it('falls back to the raw state tail when the code is unrecognized', () => {
      const s = parseProcStatusSummary('State:  Q (queued-on-mars)\n');
      expect(s.state).toBe('Q (queued-on-mars)');
    });
  });
});
