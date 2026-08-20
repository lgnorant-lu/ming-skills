import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted ensures the mock fn references exist before vi.mock factories run.
const mocks = vi.hoisted(() => ({
  readdirSync: vi.fn<(path: string) => string[]>(),
  exec: vi.fn<
    (
      cmd: string,
      opts: unknown,
      callback: (err: unknown, result: { stdout: string; stderr: string }) => void,
    ) => void
  >(),
}));

vi.mock('node:fs', () => ({
  readdirSync: (path: string) => mocks.readdirSync(path),
}));

vi.mock('node:child_process', () => ({
  // promisify(exec) calls exec(cmd, opts, callback) — match that 3-arg shape.
  exec: (
    cmd: string,
    opts: unknown,
    callback: (err: unknown, result: { stdout: string; stderr: string }) => void,
  ) => mocks.exec(cmd, opts, callback),
}));

// Static import is fine: vi.mock is hoisted above imports, so the module's
// `promisify(exec)` wraps the mocked exec, and readdirSync dispatches to the
// mock at call time.
import {
  enumerateThreadsByPlatform,
  enumerateThreadsLinux,
  enumerateThreadsMacos,
} from '@native/platform/ThreadEnumerator';

afterEach(() => {
  mocks.readdirSync.mockReset();
  mocks.exec.mockReset();
});

describe('ThreadEnumerator — Linux', () => {
  it('reads numeric TID entries from /proc/{pid}/task', () => {
    mocks.readdirSync.mockReturnValue(['100', '102', '101', '103']);

    const tids = enumerateThreadsLinux(42);

    expect(mocks.readdirSync).toHaveBeenCalledWith('/proc/42/task');
    expect(tids).toEqual([100, 101, 102, 103]); // sorted ascending
  });

  it('filters non-numeric entries (defensive — /proc/pid/task is numeric-only)', () => {
    mocks.readdirSync.mockReturnValue(['100', 'self', '101', '', '102']);
    expect(enumerateThreadsLinux(7)).toEqual([100, 101, 102]);
  });

  it('returns empty array when the process has no threads yet visible', () => {
    mocks.readdirSync.mockReturnValue([]);
    expect(enumerateThreadsLinux(7)).toEqual([]);
  });

  it('throws a contextual error when /proc/{pid}/task is unreadable', () => {
    mocks.readdirSync.mockImplementation(() => {
      const err: NodeJS.ErrnoException = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    });
    expect(() => enumerateThreadsLinux(9999)).toThrow(/Cannot read \/proc\/9999\/task/);
  });

  it('rejects invalid PID', () => {
    expect(() => enumerateThreadsLinux(0)).toThrow(/Invalid PID/);
    expect(() => enumerateThreadsLinux(-1)).toThrow(/Invalid PID/);
    expect(() => enumerateThreadsLinux(Number.NaN)).toThrow(/Invalid PID/);
  });
});

describe('ThreadEnumerator — macOS', () => {
  it('parses hex thread IDs from `ps -M` indented thread rows', async () => {
    mocks.exec.mockImplementation((_cmd, _opts, callback) => {
      // Realistic `ps -M -p <pid>` shape: header, process row, then thread rows
      // whose first field is a hex TID.
      const stdout = [
        '  USER   PID  PPID      CPU  PRI  NI   VSIZE  RSS  WCHAN    STAT  TT  TIME  COMMAND',
        '  user  1234  1233      0    46   0   ...     ...            S     ??  0:00.10 /Applications/App.app/Contents/MacOS/App',
        '         0x1a2b3                                                       0:00.00 ',
        '         0x1a2c4                                                       0:00.00 ',
        '         0x1a2d5                                                       0:00.00 ',
      ].join('\n');
      callback(null, { stdout, stderr: '' });
    });

    const tids = await enumerateThreadsMacos(1234);
    expect(tids).toEqual([0x1a2b3, 0x1a2c4, 0x1a2d5]); // 3 threads, ascending
  });

  it('returns empty array when ps output has no thread rows (e.g. process exited)', async () => {
    mocks.exec.mockImplementation((_cmd, _opts, callback) => {
      callback(null, { stdout: '  USER  PID  PPID ...\n', stderr: '' });
    });
    expect(await enumerateThreadsMacos(1234)).toEqual([]);
  });

  it('throws a contextual error when ps fails', async () => {
    mocks.exec.mockImplementation((_cmd, _opts, callback) => {
      callback(new Error('ps: No such process'), { stdout: '', stderr: 'ps: No such process' });
    });
    await expect(enumerateThreadsMacos(9999)).rejects.toThrow(/ps -M -p 9999 failed/);
  });

  it('ignores non-hex first fields (header/process rows do not match)', async () => {
    mocks.exec.mockImplementation((_cmd, _opts, callback) => {
      const stdout = [
        '  USER   PID  PPID',
        '  user  1234  1233   /path/to/app',
        '         0x100  ...',
        '  someline 1234 5678', // decimal-leading line should NOT match
      ].join('\n');
      callback(null, { stdout, stderr: '' });
    });
    expect(await enumerateThreadsMacos(1234)).toEqual([0x100]);
  });
});

describe('ThreadEnumerator — platform dispatcher', () => {
  it('routes linux to the /proc reader', async () => {
    mocks.readdirSync.mockReturnValue(['10', '20']);
    expect(await enumerateThreadsByPlatform('linux', 5)).toEqual([10, 20]);
  });

  it('routes darwin to the ps parser', async () => {
    mocks.exec.mockImplementation((_cmd, _opts, callback) => {
      callback(null, { stdout: '  USER  PID\n  u  1  0\n     0xff  ..\n', stderr: '' });
    });
    expect(await enumerateThreadsByPlatform('darwin', 1)).toEqual([0xff]);
  });

  it('throws on unsupported platform (win32 handled by caller)', async () => {
    await expect(enumerateThreadsByPlatform('win32', 1)).rejects.toThrow(
      /not supported on platform "win32"/,
    );
    await expect(enumerateThreadsByPlatform('solaris', 1)).rejects.toThrow(/solaris/);
  });
});
