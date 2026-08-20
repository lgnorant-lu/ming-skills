import type { PathLike } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

const fixtureBase = resolve(__dirname, '../../tmp/fixtures');
const pluginRoot = resolve(fixtureBase, 'plugins-root');
const workflowRoot = resolve(fixtureBase, 'workflows-root');
const brokenRoot = resolve(fixtureBase, 'broken-root');
const okRoot = resolve(fixtureBase, 'ok-root');

const pluginAlphaMetadata = resolve(pluginRoot, 'alpha', '.jshook-install.json');
const pluginAlphaManifest = resolve(pluginRoot, 'alpha', 'manifest.ts');
const pluginAlphaEntry = resolve(pluginRoot, 'alpha', 'dist', 'index.js');
const pluginBetaManifest = resolve(pluginRoot, 'beta', 'manifest.js');

const workflowAlphaMetadata = resolve(workflowRoot, 'alpha', '.jshook-install.json');
const workflowAlphaEntry = resolve(workflowRoot, 'alpha', 'dist', 'index.js');
const workflowBetaManifest = resolve(workflowRoot, 'beta', 'build.workflow.js');

const normalizePath = (value: string | PathLike) => String(value).replace(/\\/g, '/');

const state = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string | PathLike) => boolean>(() => false),
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: state.existsSync,
}));

vi.mock('node:fs/promises', () => ({
  readdir: state.readdir,
  readFile: state.readFile,
}));

describe('ExtensionManager.discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    state.readdir.mockReset();
    state.existsSync.mockReset();
    state.existsSync.mockReturnValue(false);
    state.readFile.mockReset();
  });

  it('prefers installed plugin entry metadata over manifest filename guessing', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [
          { name: 'alpha', type: 'dir' },
          { name: 'beta', type: 'dir' },
        ],
        [resolve(pluginRoot, 'alpha')]: [
          { name: '.jshook-install.json', type: 'file' },
          { name: 'manifest.ts', type: 'file' },
          { name: 'dist', type: 'dir' },
        ],
        [resolve(pluginRoot, 'alpha', 'dist')]: [{ name: 'index.js', type: 'file' }],
        [resolve(pluginRoot, 'beta')]: [{ name: 'manifest.js', type: 'file' }],
      }),
    );
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(pluginAlphaMetadata)) {
        return JSON.stringify({
          version: 1,
          kind: 'plugin',
          slug: 'alpha',
          id: 'plugin.alpha.v1',
          source: {
            type: 'git',
            repo: withPath(TEST_URLS.root, 'alpha.git'),
            ref: 'main',
            commit: 'abc123',
            subpath: '.',
            entry: 'dist/index.js',
          },
        });
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    state.existsSync.mockImplementation(
      (path: string | PathLike) => normalizePath(path) === normalizePath(pluginAlphaEntry),
    );
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([
      pluginAlphaEntry,
      pluginBetaManifest,
    ]);
  });

  it('prefers installed workflow entry metadata over workflow filename guessing', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [workflowRoot]: [
          { name: 'alpha', type: 'dir' },
          { name: 'beta', type: 'dir' },
        ],
        [resolve(workflowRoot, 'alpha')]: [
          { name: '.jshook-install.json', type: 'file' },
          { name: 'workflow.ts', type: 'file' },
          { name: 'dist', type: 'dir' },
        ],
        [resolve(workflowRoot, 'alpha', 'dist')]: [{ name: 'index.js', type: 'file' }],
        [resolve(workflowRoot, 'beta')]: [{ name: 'build.workflow.js', type: 'file' }],
      }),
    );
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(workflowAlphaMetadata)) {
        return JSON.stringify({
          version: 1,
          kind: 'workflow',
          slug: 'alpha',
          id: 'workflow.alpha.v1',
          source: {
            type: 'git',
            repo: withPath(TEST_URLS.root, 'alpha.git'),
            ref: 'main',
            commit: 'abc123',
            subpath: '.',
            entry: 'dist/index.js',
          },
        });
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    state.existsSync.mockImplementation(
      (path: string | PathLike) => normalizePath(path) === normalizePath(workflowAlphaEntry),
    );
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles([workflowRoot])).resolves.toEqual([
      workflowAlphaEntry,
      workflowBetaManifest,
    ]);
  });

  it('scans dotfile install metadata so installed entries are discoverable after registry install', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [workflowRoot]: [{ name: 'alpha', type: 'dir' }],
        [resolve(workflowRoot, 'alpha')]: [
          { name: '.jshook-install.json', type: 'file' },
          { name: 'dist', type: 'dir' },
        ],
        [resolve(workflowRoot, 'alpha', 'dist')]: [{ name: 'index.js', type: 'file' }],
      }),
    );
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(workflowAlphaMetadata)) {
        return JSON.stringify({
          version: 1,
          kind: 'workflow',
          slug: 'alpha',
          id: 'workflow.alpha.v1',
          source: {
            type: 'git',
            repo: withPath(TEST_URLS.root, 'alpha.git'),
            ref: 'main',
            commit: 'abc123',
            subpath: '.',
            entry: 'dist/index.js',
          },
        });
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    state.existsSync.mockImplementation(
      (path: string | PathLike) => normalizePath(path) === normalizePath(workflowAlphaEntry),
    );
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles([workflowRoot])).resolves.toEqual([workflowAlphaEntry]);
  });

  it('falls back to legacy scans when installed metadata is invalid or missing output', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [
          { name: 'alpha', type: 'dir' },
          { name: 'beta', type: 'dir' },
        ],
        [resolve(pluginRoot, 'alpha')]: [
          { name: '.jshook-install.json', type: 'file' },
          { name: 'manifest.ts', type: 'file' },
          { name: 'dist', type: 'dir' },
        ],
        [resolve(pluginRoot, 'alpha', 'dist')]: [{ name: 'index.js', type: 'file' }],
        [resolve(pluginRoot, 'beta')]: [{ name: 'manifest.js', type: 'file' }],
      }),
    );
    state.readFile.mockResolvedValue('{"kind":"plugin"}');
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([
      pluginAlphaManifest,
      pluginBetaManifest,
    ]);
  });

  it('discovers workflow manifests in both workflow.* and *.workflow.* forms', async () => {
    const workflowA = resolve(workflowRoot, 'a', 'workflow.ts');
    const workflowB = resolve(workflowRoot, 'b', 'build.workflow.js');
    const workflowD = resolve(workflowRoot, 'd', 'workflow.mjs');
    const workflowE = resolve(workflowRoot, 'e', 'build.workflow.mts');

    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [workflowRoot]: [
          { name: 'a', type: 'dir' },
          { name: 'b', type: 'dir' },
          { name: 'c', type: 'dir' },
          { name: 'd', type: 'dir' },
          { name: 'e', type: 'dir' },
        ],
        [resolve(workflowRoot, 'a')]: [{ name: 'workflow.ts', type: 'file' }],
        [resolve(workflowRoot, 'b')]: [{ name: 'build.workflow.js', type: 'file' }],
        [resolve(workflowRoot, 'c')]: [{ name: 'workflow.md', type: 'file' }],
        [resolve(workflowRoot, 'd')]: [{ name: 'workflow.mjs', type: 'file' }],
        [resolve(workflowRoot, 'e')]: [{ name: 'build.workflow.mts', type: 'file' }],
      }),
    );
    const { discoverWorkflowFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverWorkflowFiles([workflowRoot])).resolves.toEqual([
      workflowA,
      workflowB,
      workflowD,
      workflowE,
    ]);
  });

  it('skips roots whose directory scan fails', async () => {
    const okManifest = resolve(okRoot, 'plugin', 'manifest.ts');

    state.readdir.mockImplementation(async (dir: string) => {
      if (normalizePath(dir) === normalizePath(brokenRoot)) {
        throw new Error('scan failed');
      }
      return directoryEntriesForPath(dir, {
        [okRoot]: [{ name: 'plugin', type: 'dir' }],
        [resolve(okRoot, 'plugin')]: [{ name: 'manifest.ts', type: 'file' }],
      });
    });
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([brokenRoot, okRoot])).resolves.toEqual([okManifest]);
  });

  it('ignores metadata files that contain invalid JSON', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [{ name: 'alpha', type: 'dir' }],
        [resolve(pluginRoot, 'alpha')]: [{ name: '.jshook-install.json', type: 'file' }],
      }),
    );
    state.readFile.mockResolvedValue('invalid-json');
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('ignores metadata files where entry string is empty', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [{ name: 'alpha', type: 'dir' }],
        [resolve(pluginRoot, 'alpha')]: [{ name: '.jshook-install.json', type: 'file' }],
      }),
    );
    state.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind: 'plugin',
        slug: 'a',
        id: 'a',
        source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: '  ' },
      }),
    );
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('ignores metadata files where entry file does not exist', async () => {
    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [{ name: 'alpha', type: 'dir' }],
        [resolve(pluginRoot, 'alpha')]: [{ name: '.jshook-install.json', type: 'file' }],
      }),
    );
    state.readFile.mockResolvedValue(
      JSON.stringify({
        version: 1,
        kind: 'plugin',
        slug: 'a',
        id: 'a',
        source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: 'index.js' },
      }),
    );
    state.existsSync.mockReturnValue(false);
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([]);
  });

  it('deduplicates correctly when candidate replaces existing file based on priority', async () => {
    const sameDirMeta = resolve(pluginRoot, 'same', '.jshook-install.json');
    const sameDirEntry = resolve(pluginRoot, 'same', 'z.js');
    const sameDirManifest = resolve(pluginRoot, 'same', 'manifest.ts');

    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [{ name: 'same', type: 'dir' }],
        [resolve(pluginRoot, 'same')]: [
          { name: '.jshook-install.json', type: 'file' },
          { name: 'manifest.ts', type: 'file' },
          { name: 'z.js', type: 'file' },
        ],
      }),
    );
    state.readFile.mockImplementation(async (path: string | PathLike) => {
      if (normalizePath(path) === normalizePath(sameDirMeta)) {
        return JSON.stringify({
          version: 1,
          kind: 'plugin',
          slug: 'same',
          id: 'same',
          source: { type: 'git', repo: 'a', ref: 'a', commit: 'a', subpath: '.', entry: 'z.js' },
        });
      }
      throw new Error(`Unexpected`);
    });
    // Both files exist
    state.existsSync.mockImplementation(
      (path: string | PathLike) =>
        normalizePath(path) === normalizePath(sameDirEntry) ||
        normalizePath(path) === normalizePath(sameDirManifest),
    );

    // alphabet order execution: manifest.ts (existing) -> z.js (candidate)
    // Both map to 'plugins-root::same'
    // manifest.ts is priority 1, z.js is priority 0.
    // Candidate priority (0) < Existing priority (1) so it replaces!
    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');
    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([sameDirEntry]);
  });

  it('skips ignored dependency and git directories while scanning', async () => {
    const ignoredManifest = resolve(pluginRoot, 'node_modules', 'pkg', 'manifest.ts');
    const gitManifest = resolve(pluginRoot, '.git', 'manifest.ts');
    const keptManifest = resolve(pluginRoot, 'visible', 'manifest.ts');

    state.readdir.mockImplementation(async (dir: string) =>
      directoryEntriesForPath(dir, {
        [pluginRoot]: [
          { name: 'node_modules', type: 'dir' },
          { name: '.git', type: 'dir' },
          { name: '.pnpm', type: 'dir' },
          { name: 'visible', type: 'dir' },
        ],
        [resolve(pluginRoot, 'visible')]: [{ name: 'manifest.ts', type: 'file' }],
        [resolve(pluginRoot, 'node_modules')]: [{ name: 'pkg', type: 'dir' }],
        [resolve(pluginRoot, 'node_modules', 'pkg')]: [{ name: 'manifest.ts', type: 'file' }],
        [resolve(pluginRoot, '.git')]: [{ name: 'manifest.ts', type: 'file' }],
        [resolve(pluginRoot, '.pnpm')]: [{ name: 'manifest.ts', type: 'file' }],
      }),
    );

    const { discoverPluginFiles } = await import('@server/extensions/ExtensionManager.discovery');

    await expect(discoverPluginFiles([pluginRoot])).resolves.toEqual([keptManifest]);
    expect(ignoredManifest).not.toEqual(keptManifest);
    expect(gitManifest).not.toEqual(keptManifest);
  });
});

type MockDirEntry = {
  name: string;
  type: 'file' | 'dir';
};

function directoryEntriesForPath(
  dir: string,
  map: Record<string, MockDirEntry[]>,
): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  const normalizedMap = Object.fromEntries(
    Object.entries(map).map(([key, value]) => [normalizePath(key), value]),
  );
  const entries = normalizedMap[normalizePath(dir)] ?? [];
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: () => entry.type === 'dir',
    isFile: () => entry.type === 'file',
  }));
}
