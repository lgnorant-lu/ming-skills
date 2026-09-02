import { mkdtemp, mkdir, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveSafeOutputPath,
  writeTextFileAtomically,
  writeBinaryFileAtomically,
} from '@utils/safeOutput';

/**
 * Regression tests for path-traversal / containment-bypass fixes in
 * src/utils/safeOutput.ts:
 *  - resolveSafeOutputPath now validates the REAL path (symlinks cannot
 *    smuggle the write outside the allowed roots);
 *  - writeFileAtomically refuses basename components of "." / "..";
 *  - the rm+rename fallback never removes a directory.
 */
describe('safeOutput security', () => {
  async function makeRoots(): Promise<{ root: string; outside: string }> {
    const root = await mkdtemp(join(tmpdir(), 'jshook-sec-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'jshook-sec-outside-'));
    return { root, outside };
  }

  it('resolveSafeOutputPath rejects a symlink inside the root that escapes it', async () => {
    const { root, outside } = await makeRoots();
    const link = join(root, 'linked');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      await mkdir(join(outside, 'nested'), { recursive: true });

      await expect(
        resolveSafeOutputPath(join(link, 'nested', 'trace.json'), {
          allowedRoots: [root],
          allowedRootsDescription: 'project root',
        }),
      ).rejects.toThrow('outputPath must be within the project root');
    } finally {
      await rm(link, { force: true, recursive: true });
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('resolveSafeOutputPath still accepts a plain path inside the root', async () => {
    const { root } = await makeRoots();
    try {
      await mkdir(join(root, 'sub'), { recursive: true });
      await expect(
        resolveSafeOutputPath(join(root, 'sub', 'x.json'), {
          allowedRoots: [root],
          allowedRootsDescription: 'project root',
        }),
      ).resolves.toBe(join(root, 'sub', 'x.json'));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('writeTextFileAtomically rejects a ".." basename without touching anything', async () => {
    const { root } = await makeRoots();
    try {
      await mkdir(join(root, 'keep'), { recursive: true });
      const parentPath = join(root, '..'); // basename ".."

      await expect(
        writeTextFileAtomically(parentPath, 'data', { allowedRoots: [root] }),
      ).rejects.toThrow();

      // Nothing under the root may have been removed or overwritten.
      expect(await readdir(join(root, 'keep'))).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('writeBinaryFileAtomically rejects a "." basename', async () => {
    const { root } = await makeRoots();
    try {
      await expect(
        writeBinaryFileAtomically(join(root, '.'), new Uint8Array([1]), {
          allowedRoots: [root],
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('writeTextFileAtomically never deletes a directory via the rm+rename fallback', async () => {
    const { root } = await makeRoots();
    try {
      const target = join(root, 'existing-dir');
      await mkdir(target, { recursive: true });

      await expect(
        writeTextFileAtomically(target, 'data', { allowedRoots: [root] }),
      ).rejects.toThrow();

      // The directory must still exist with its contents.
      expect(await readdir(target)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('writeTextFileAtomically rejects a symbolic-link target', async () => {
    const { root, outside } = await makeRoots();
    try {
      const target = join(root, 'link.txt');
      await symlink(join(outside, 'real.txt'), target);

      await expect(
        writeTextFileAtomically(target, 'data', { allowedRoots: [root] }),
      ).rejects.toThrow('must not be a symbolic link');
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('does not create directories outside the allowed roots (check runs before mkdir)', async () => {
    const { root } = await makeRoots();
    const outsideParent = join(root, '..', `new-dir-${Date.now()}`);
    try {
      await expect(
        writeTextFileAtomically(join(outsideParent, 'x.txt'), 'data', {
          allowedRoots: [root],
        }),
      ).rejects.toThrow('escapes the allowed roots');

      // The containment check must run before mkdir — no directory outside
      // the roots may have been created by the failed write.
      await expect(
        import('node:fs/promises').then(({ stat }) => stat(outsideParent)),
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects a write whose parent was swapped for a symlink after resolveSafeOutputPath', async () => {
    const { root, outside } = await makeRoots();
    try {
      await mkdir(join(root, 'sub'), { recursive: true });

      // t0: path validated inside the root…
      const validated = await resolveSafeOutputPath(join(root, 'sub', 'x.json'), {
        allowedRoots: [root],
        allowedRootsDescription: 'project root',
      });
      expect(validated).toBe(join(root, 'sub', 'x.json'));

      // …then the parent is replaced by a link to outside before the write.
      await rm(join(root, 'sub'), { force: true, recursive: true });
      await symlink(outside, join(root, 'sub'), process.platform === 'win32' ? 'junction' : 'dir');

      // The write-time re-check must catch the redirect and place nothing
      // outside the roots.
      await expect(
        writeTextFileAtomically(join(root, 'sub', 'x.json'), 'data', {
          allowedRoots: [root],
        }),
      ).rejects.toThrow('escapes the allowed roots');
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });
});
