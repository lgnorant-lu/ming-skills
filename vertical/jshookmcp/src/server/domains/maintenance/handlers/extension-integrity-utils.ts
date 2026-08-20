/**
 * Extension integrity + version surfacing (research #4).
 *
 * Pure helpers that enrich the `list_extensions` payload with per-extension
 * provenance: the installed package version (package.json), a SHA-256 digest of
 * the entry file, whether the extension was installed via the registry
 * (`.jshook-install.json` present), and the registry-pinned commit. This lets a
 * user detect drift — a manually edited plugin, or a registry that moved to a
 * new commit — which the listing tool previously hid.
 *
 * The helpers are deliberately additive: when a field cannot be resolved they
 * omit it rather than throwing, so a partial filesystem never breaks the
 * listing.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExtensionListResult } from '@server/extensions/types';

/** A single extension's integrity summary. Omitted fields = unknown. */
export interface ExtensionIntegrityEntry {
  /** Extension source file path (matches the list_extensions `source` field). */
  source: string;
  /** package.json `version` if resolvable from the project root. */
  version?: string;
  /** Lowercased hex SHA-256 of the entry file bytes. */
  digest?: string;
  /** `true` when `.jshook-install.json` is present (registry-installed). */
  managed?: boolean;
  /** Commit SHA pinned at install time (from `.jshook-install.json`). */
  pinnedCommit?: string;
  /** Slug recorded at install time, when available. */
  slug?: string;
}

export interface ExtensionIntegritySummary {
  /** Per-extension integrity, keyed by the extension `source` path. */
  entries: ExtensionIntegrityEntry[];
  /** Count of extensions that were registry-installed. */
  managedCount: number;
  /** Count of extensions whose entry file could be hashed. */
  digestedCount: number;
}

/** Walk up from `startDir` to the first ancestor containing `fileName`. */
export function findMetadataFile(
  startDir: string,
  fileName: string,
): { dir: string; path: string } | null {
  let currentDir = startDir;
  // Bounded walk — stop at the filesystem root.
  for (let depth = 0; depth < 32; depth++) {
    const candidate = join(currentDir, fileName);
    if (existsSync(candidate)) {
      return { dir: currentDir, path: candidate };
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) {
      return null;
    }
    currentDir = parent;
  }
  return null;
}

/** Read + parse JSON, returning `undefined` on any error. */
async function readJsonOptional(filePath: string): Promise<unknown> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Best-effort SHA-256 of a file. `undefined` if unreadable. */
export async function hashFileOptional(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}

interface InstalledExtensionMetadataShape {
  source?: { commit?: string };
  slug?: string;
}

/**
 * Resolve the integrity entry for a single extension source file.
 *
 * Order:
 * 1. Hash the entry file (digest).
 * 2. Walk up to find `.jshook-install.json` (managed + pinnedCommit + slug).
 * 3. From that metadata's directory (or the entry dir if unmanaged), read
 *    `package.json` for the version.
 */
export async function resolveExtensionIntegrity(
  sourceFile: string,
  installedMetadataFilename: string,
): Promise<ExtensionIntegrityEntry> {
  const entryDir = dirname(sourceFile);
  const digest = await hashFileOptional(sourceFile);

  const metadataHit = findMetadataFile(entryDir, installedMetadataFilename);
  let managed: boolean | undefined;
  let pinnedCommit: string | undefined;
  let slug: string | undefined;
  let projectRoot = entryDir;

  if (metadataHit) {
    managed = true;
    projectRoot = metadataHit.dir;
    const metadata = (await readJsonOptional(metadataHit.path)) as
      | InstalledExtensionMetadataShape
      | undefined;
    if (metadata) {
      const commit = metadata.source?.commit;
      if (typeof commit === 'string' && commit.trim().length > 0) {
        pinnedCommit = commit.trim();
      }
      if (typeof metadata.slug === 'string' && metadata.slug.trim().length > 0) {
        slug = metadata.slug.trim();
      }
    }
  } else {
    managed = false;
  }

  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = (await readJsonOptional(packageJsonPath)) as
    | { version?: unknown }
    | undefined;
  let version: string | undefined;
  if (packageJson && typeof packageJson.version === 'string') {
    version = packageJson.version.trim() || undefined;
  }

  const entry: ExtensionIntegrityEntry = { source: sourceFile };
  if (version !== undefined) entry.version = version;
  if (digest !== undefined) entry.digest = digest;
  if (managed !== undefined) entry.managed = managed;
  if (pinnedCommit !== undefined) entry.pinnedCommit = pinnedCommit;
  if (slug !== undefined) entry.slug = slug;
  return entry;
}

/**
 * Build a full integrity summary for an `ExtensionListResult`.
 *
 * Collects every plugin + workflow source path, resolves each in parallel
 * (Promise.allSettled — one failure never blocks the rest), and returns the
 * entries plus aggregate counts. The caller merges `entries` into the listing
 * by matching on `source`.
 */
export async function summarizeExtensionIntegrity(
  list: ExtensionListResult,
  installedMetadataFilename: string,
): Promise<ExtensionIntegritySummary> {
  const sources: string[] = [
    ...list.plugins.map((plugin) => plugin.source),
    ...list.workflows.map((workflow) => workflow.source),
  ];
  const uniqueSources = [...new Set(sources.filter((source) => typeof source === 'string'))];

  const settled = await Promise.allSettled(
    uniqueSources.map((source) => resolveExtensionIntegrity(source, installedMetadataFilename)),
  );

  const entries: ExtensionIntegrityEntry[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      entries.push(result.value);
    }
  }

  const managedCount = entries.filter((entry) => entry.managed === true).length;
  const digestedCount = entries.filter((entry) => entry.digest !== undefined).length;

  return { entries, managedCount, digestedCount };
}
