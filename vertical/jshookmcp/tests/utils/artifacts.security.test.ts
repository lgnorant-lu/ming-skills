import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveArtifactPath } from '@utils/artifacts';
import * as outputPaths from '@utils/outputPaths';

/**
 * The string-level PathGuard in resolveArtifactPath (relative() containment)
 * can be bypassed by a symlink / Windows junction inside the project root
 * that points outside it: the resolved string still looks contained while
 * mkdir/writes land outside the root. These tests pin the realpath-aware
 * containment check.
 */
describe('artifacts path guard (symlink/junction)', () => {
  let projectRoot: string;
  let outside: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'jshook-art-root-'));
    outside = await mkdtemp(join(tmpdir(), 'jshook-art-outside-'));
    vi.spyOn(outputPaths, 'getProjectRoot').mockReturnValue(projectRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('blocks a customDir that is a symlink/junction escaping the project root', async () => {
    // Junction: Windows directory link that needs no admin rights — the same
    // primitive a symlink provides on POSIX.
    const evilLink = join(projectRoot, 'evil-link');
    await symlink(outside, evilLink, 'junction');

    await expect(
      resolveArtifactPath({
        category: 'tmp',
        toolName: 'x',
        ext: 'txt',
        customDir: 'evil-link',
      }),
    ).rejects.toThrow(/Path traversal blocked/);

    // Nothing was written into the directory behind the link.
    expect(await readdir(outside)).toEqual([]);
  });

  it('blocks a customDir nested below a symlink escaping the root', async () => {
    const evilLink = join(projectRoot, 'evil-link');
    await symlink(outside, evilLink, 'junction');
    await mkdir(join(outside, 'sub'));

    await expect(
      resolveArtifactPath({
        category: 'tmp',
        toolName: 'x',
        ext: 'txt',
        customDir: 'evil-link/sub',
      }),
    ).rejects.toThrow(/Path traversal blocked/);

    expect(await readdir(outside)).toEqual(['sub']);
  });

  it('still allows existing directories inside the project root', async () => {
    await mkdir(join(projectRoot, 'artifacts'), { recursive: true });

    const result = await resolveArtifactPath({
      category: 'tmp',
      toolName: 'x',
      ext: 'txt',
      customDir: 'artifacts',
    });

    expect(result.absolutePath.startsWith(projectRoot)).toBe(true);
  });

  it('rejects raw parent-directory segments in customDir before resolution', async () => {
    // "a/../../b" collapses lexically inside the root — but the raw-segment
    // guard (mirroring resolveContainedPath) rejects '..' segments outright,
    // so the lexical check cannot be confused by separator/normalization
    // quirks. Nothing may be created.
    for (const evil of ['a/../../b', '..', '../escape', 'x/..']) {
      await expect(
        resolveArtifactPath({
          category: 'tmp',
          toolName: 'x',
          ext: 'txt',
          customDir: evil,
        }),
      ).rejects.toThrow('must not contain parent-directory segments');
    }
    expect(await readdir(projectRoot)).toEqual([]);
  });

  it('still accepts nested customDir without parent segments', async () => {
    const result = await resolveArtifactPath({
      category: 'tmp',
      toolName: 'x',
      ext: 'txt',
      customDir: 'custom/out',
    });

    expect(result.absolutePath).toContain(join(projectRoot, 'custom', 'out'));
  });
});
