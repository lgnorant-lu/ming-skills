import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeTextFileAtomically } from '@utils/safeOutput';

// Count every fs.rm call: the atomic writer must never delete the target
// before renaming — that opens a window in which another process can create
// a fresh file that the rename would then silently overwrite.
const rmCalls = vi.hoisted(() => ({ count: 0 }));

const swapState = vi.hoisted(() => ({
  // Path whose open() returns a handle reporting a DIFFERENT inode than the
  // lstat saw — simulates a symlink/file swapped in between the lstat check
  // and the open in the read-only-target fallback.
  swappedTarget: '',
  handleChmodCalls: 0,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: (async (...args: Parameters<typeof actual.rm>) => {
      rmCalls.count++;
      return actual.rm(...args);
    }) as typeof actual.rm,
    open: (async (path: string, flags?: string | number) => {
      if (path === swapState.swappedTarget) {
        return {
          stat: async () => ({ ino: 987654321 }),
          chmod: async () => {
            swapState.handleChmodCalls++;
          },
          close: async () => undefined,
        };
      }
      return actual.open(path, flags);
    }) as typeof actual.open,
    rename: (async (from: string, to: string) => {
      if (to === swapState.swappedTarget) {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      return actual.rename(from, to);
    }) as typeof actual.rename,
  };
});

describe('safeOutput atomic writer replace semantics', () => {
  it('overwrites an existing read-only target without removing it first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jshook-safe-overwrite-'));
    const target = join(dir, 'out.txt');
    try {
      await writeFile(target, 'old');
      await chmod(target, 0o444);

      rmCalls.count = 0;
      await writeTextFileAtomically(target, 'new');

      expect(await readFile(target, 'utf8')).toBe('new');
      expect(rmCalls.count).toBe(0);
    } finally {
      await chmod(target, 0o644).catch(() => undefined);
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('refuses to chmod a target replaced after validation (inode mismatch)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jshook-safe-swap-'));
    const target = join(dir, 'out.txt');
    try {
      await writeFile(target, 'old');
      swapState.swappedTarget = target;
      swapState.handleChmodCalls = 0;

      // rename is mocked to EPERM so the read-only fallback runs; open is
      // mocked to a handle whose stat() reports a different inode than the
      // lstat saw — the swap-in scenario. The writer must abort instead of
      // chmodding (0o666) whatever is behind the swapped entry.
      await expect(writeTextFileAtomically(target, 'new', { allowedRoots: [dir] })).rejects.toThrow(
        'target changed while writing',
      );

      expect(swapState.handleChmodCalls).toBe(0);
      // The original file must be untouched — no rename over it, no chmod.
      expect(await readFile(target, 'utf8')).toBe('old');
    } finally {
      swapState.swappedTarget = '';
      await rm(dir, { force: true, recursive: true });
    }
  });
});
