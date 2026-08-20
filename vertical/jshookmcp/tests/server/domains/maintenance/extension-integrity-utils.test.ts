import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  findMetadataFile,
  hashFileOptional,
  resolveExtensionIntegrity,
  summarizeExtensionIntegrity,
} from '@server/domains/maintenance/handlers/extension-integrity-utils';
import { INSTALLED_EXTENSION_METADATA_FILENAME } from '@server/extensions/types';

const META = INSTALLED_EXTENSION_METADATA_FILENAME;

async function makeTmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'jshook-integrity-'));
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('extension-integrity-utils', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeTmpRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('findMetadataFile', () => {
    it('locates the metadata file in an ancestor directory', async () => {
      const deep = join(root, 'a', 'b', 'c');
      await mkdir(deep, { recursive: true });
      const metaPath = join(root, 'a', META);
      await writeFile(metaPath, '{}');

      const hit = findMetadataFile(deep, META);
      expect(hit).not.toBeNull();
      expect(hit?.path).toBe(metaPath);
      expect(hit?.dir).toBe(join(root, 'a'));
    });

    it('returns null when no ancestor contains the file', async () => {
      const deep = join(root, 'x', 'y');
      await mkdir(deep, { recursive: true });
      expect(findMetadataFile(deep, META)).toBeNull();
    });
  });

  describe('hashFileOptional', () => {
    it('returns the hex sha256 of the file contents', async () => {
      const filePath = join(root, 'entry.js');
      const payload = 'console.log("hi");\n';
      await writeFile(filePath, payload);
      expect(await hashFileOptional(filePath)).toBe(sha256Hex(payload));
    });

    it('returns undefined when the file cannot be read', async () => {
      expect(await hashFileOptional(join(root, 'missing.js'))).toBeUndefined();
    });
  });

  describe('resolveExtensionIntegrity', () => {
    it('surfaces version + digest + managed + pinnedCommit for a registry install', async () => {
      const entryDir = join(root, 'my-plugin', 'dist');
      await mkdir(entryDir, { recursive: true });
      const entryPayload = 'export default {};\n';
      const entryFile = join(entryDir, 'index.js');
      await writeFile(entryFile, entryPayload);
      await writeFile(
        join(root, 'my-plugin', META),
        JSON.stringify({ source: { commit: 'abc123deadbeef' }, slug: 'my-plugin' }),
      );
      await writeFile(
        join(root, 'my-plugin', 'package.json'),
        JSON.stringify({ version: '1.2.3' }),
      );

      const entry = await resolveExtensionIntegrity(entryFile, META);
      expect(entry.source).toBe(entryFile);
      expect(entry.digest).toBe(sha256Hex(entryPayload));
      expect(entry.version).toBe('1.2.3');
      expect(entry.managed).toBe(true);
      expect(entry.pinnedCommit).toBe('abc123deadbeef');
      expect(entry.slug).toBe('my-plugin');
    });

    it('marks a hand-placed extension as unmanaged and still reads version from the entry dir', async () => {
      const entryDir = join(root, 'hand-rolled');
      await mkdir(entryDir, { recursive: true });
      const entryFile = join(entryDir, 'plugin.js');
      await writeFile(entryFile, 'module.exports = {};\n');
      await writeFile(join(entryDir, 'package.json'), JSON.stringify({ version: '0.0.9' }));

      const entry = await resolveExtensionIntegrity(entryFile, META);
      expect(entry.managed).toBe(false);
      expect(entry.version).toBe('0.0.9');
      expect(entry.digest).toBeDefined();
      expect(entry.pinnedCommit).toBeUndefined();
    });

    it('omits version when package.json is missing or malformed', async () => {
      const entryDir = join(root, 'no-pkg');
      await mkdir(entryDir, { recursive: true });
      const entryFile = join(entryDir, 'index.js');
      await writeFile(entryFile, 'x');

      const entry = await resolveExtensionIntegrity(entryFile, META);
      expect(entry.version).toBeUndefined();
      expect(entry.managed).toBe(false);
    });

    it('tolerates a malformed metadata file (managed=true but no pinnedCommit)', async () => {
      const entryDir = join(root, 'broken-meta');
      await mkdir(entryDir, { recursive: true });
      const entryFile = join(entryDir, 'index.js');
      await writeFile(entryFile, 'x');
      await writeFile(join(entryDir, META), '{ not valid json');

      const entry = await resolveExtensionIntegrity(entryFile, META);
      expect(entry.managed).toBe(true);
      expect(entry.pinnedCommit).toBeUndefined();
    });

    it('trims a whitespace-padded commit and ignores empty slug', async () => {
      const entryDir = join(root, 'padded');
      await mkdir(entryDir, { recursive: true });
      const entryFile = join(entryDir, 'index.js');
      await writeFile(entryFile, 'x');
      await writeFile(
        join(entryDir, META),
        JSON.stringify({ source: { commit: '  deadbeef  ' }, slug: '   ' }),
      );

      const entry = await resolveExtensionIntegrity(entryFile, META);
      expect(entry.pinnedCommit).toBe('deadbeef');
      expect(entry.slug).toBeUndefined();
    });
  });

  describe('summarizeExtensionIntegrity', () => {
    it('dedupes shared source paths and aggregates counts', async () => {
      const entryDir = join(root, 'shared');
      await mkdir(entryDir, { recursive: true });
      const entryFile = join(entryDir, 'index.js');
      await writeFile(entryFile, 'shared-bytes');
      await writeFile(join(entryDir, META), JSON.stringify({ source: { commit: 'c1' } }));
      await writeFile(join(entryDir, 'package.json'), JSON.stringify({ version: '2.0.0' }));

      // Two plugins + one workflow all point at the same source — must hash once.
      const list = {
        plugins: [
          { id: 'p1', name: 'p1', source: entryFile, domains: [], workflows: [], tools: [] },
          { id: 'p2', name: 'p2', source: entryFile, domains: [], workflows: [], tools: [] },
        ],
        workflows: [{ id: 'w1', displayName: 'w1', source: entryFile }],
      } as unknown as Parameters<typeof summarizeExtensionIntegrity>[0];

      const summary = await summarizeExtensionIntegrity(list, META);
      expect(summary.entries).toHaveLength(1);
      expect(summary.entries[0]?.digest).toBe(sha256Hex('shared-bytes'));
      expect(summary.managedCount).toBe(1);
      expect(summary.digestedCount).toBe(1);
    });

    it('reports managed/digested counts across a mixed set', async () => {
      const managedDir = join(root, 'managed');
      const looseDir = join(root, 'loose');
      await mkdir(managedDir, { recursive: true });
      await mkdir(looseDir, { recursive: true });
      const managedEntry = join(managedDir, 'a.js');
      const looseEntry = join(looseDir, 'b.js');
      await writeFile(managedEntry, 'a');
      await writeFile(looseEntry, 'b');
      await writeFile(join(managedDir, META), JSON.stringify({ source: { commit: 'c' } }));

      const list = {
        plugins: [
          { id: 'm', name: 'm', source: managedEntry, domains: [], workflows: [], tools: [] },
          { id: 'l', name: 'l', source: looseEntry, domains: [], workflows: [], tools: [] },
        ],
        workflows: [],
      } as unknown as Parameters<typeof summarizeExtensionIntegrity>[0];

      const summary = await summarizeExtensionIntegrity(list, META);
      expect(summary.entries).toHaveLength(2);
      expect(summary.managedCount).toBe(1);
      expect(summary.digestedCount).toBe(2);
    });
  });
});
