/**
 * Regression tests for ripgrep availability probing.
 *
 * `detectRipgrep` must fail closed when the PATH lookup succeeds but the
 * resolved `rg` cannot run (broken symlink, non-executable, or a `where`
 * info line emitted on stdout) — otherwise callers spawn a dead path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  detectRipgrep,
  resetRipgrepDetection,
} from '../../../src/modules/jadx-search/ripgrep-detector';

type ExecFileCb = (err: Error | null, result: { stdout: string; stderr: string }) => void;
type CbProvider = (cb: ExecFileCb) => void;

function stubExecFile(which: CbProvider, version: CbProvider): void {
  execFileMock.mockImplementation(
    (cmd: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
      if (cmd === 'where' || cmd === 'which') which(cb);
      else version(cb);
    },
  );
}

describe('detectRipgrep — fail-closed probing', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    resetRipgrepDetection();
  });

  it('reports available when PATH lookup and version check both succeed', async () => {
    stubExecFile(
      (cb) => cb(null, { stdout: '/usr/bin/rg\n', stderr: '' }),
      (cb) => cb(null, { stdout: 'ripgrep 14.1.0\n', stderr: '' }),
    );
    const result = await detectRipgrep();
    expect(result.available).toBe(true);
    expect(result.path).toBe('/usr/bin/rg');
    expect(result.version).toBe('ripgrep 14.1.0');
  });

  it('fails closed when the resolved rg cannot run its version check', async () => {
    stubExecFile(
      (cb) => cb(null, { stdout: '/broken/rg\n', stderr: '' }),
      (cb) => cb(new Error('spawn EACCES'), { stdout: '', stderr: '' }),
    );
    const result = await detectRipgrep();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('/broken/rg');
  });

  it('fails with ENOENT guidance when rg is not on PATH', async () => {
    stubExecFile(
      (cb) =>
        cb(Object.assign(new Error('spawn where ENOENT'), { code: 'ENOENT' }), {
          stdout: '',
          stderr: '',
        }),
      () => {
        throw new Error('should not reach version check');
      },
    );
    const result = await detectRipgrep();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('not found in PATH');
  });
});
