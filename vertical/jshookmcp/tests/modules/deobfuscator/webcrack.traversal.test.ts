/**
 * Regression test: the module-path traversal guard in `saveWebcrackArtifacts`
 * must reject a `path.relative` result that is an absolute path.
 *
 * `path.relative(from, to)` returns the *absolute* `to` path itself (instead of
 * a `..`-prefixed relative path) when `from` and `to` live on different drives
 * on Windows. The old guard only checked `.startsWith('..')`, so that absolute
 * result slipped straight through to `writeFile` — a cross-drive / absolute
 * path written to a location outside the resolved outputDir.
 */

import { describe, expect, it, vi } from 'vitest';

const relativeState = vi.hoisted(() => ({
  abs: '' as string,
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  // A platform-appropriate absolute path (e.g. `C:\evil\abs.js` on Windows,
  // `/evil/abs.js` on POSIX) — exactly what `path.relative` yields on a
  // cross-drive comparison.
  const abs = actual.resolve('/evil/abs.js');
  relativeState.abs = abs;
  // `node:path` is CJS: its ESM namespace exposes `default` at runtime but the
  // namespace *type* omits it, so reach it through a cast.
  const defaultPath = (actual as unknown as { default: Record<string, unknown> }).default;
  return {
    ...actual,
    default: {
      ...defaultPath,
      relative: vi.fn(() => abs),
    },
  };
});

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  rm: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ size: 0 })),
}));

import { saveWebcrackArtifacts } from '@modules/deobfuscator/webcrack';

describe('saveWebcrackArtifacts traversal guard', () => {
  it('rejects a module whose relative() result is an absolute path', async () => {
    expect(relativeState.abs).not.toBe('');
    const bundle = {
      type: 'webpack' as const,
      entryId: '0',
      modules: new Map([['0', { id: '0', path: 'evil.js', isEntry: true, code: 'x' }]]),
    };

    await expect(
      // `bundle` matches the private WebcrackBundleLike shape; `as any` avoids
      // naming the module-private type.
      saveWebcrackArtifacts('/out', 'code', bundle as any),
    ).rejects.toThrow('path traversal');
  });
});
