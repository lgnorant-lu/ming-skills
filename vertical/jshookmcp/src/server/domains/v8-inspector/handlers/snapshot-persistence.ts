/**
 * Persistence layer for V8 heap snapshots.
 *
 * Heap snapshots are large and expensive to capture; previously they lived only
 * in a process-local Map and were lost on every server restart. This module
 * writes each snapshot (concatenated chunks) + a sidecar `.meta.json` into the
 * `artifacts/heap-snapshots/` directory, and provides list / load / delete /
 * retention primitives that the v8-inspector control surface (list/delete/export
 * tools) and the capture handler (auto-persist + retention enforce) build on.
 *
 * All operations are fail-soft: corrupt sidecars are skipped, missing files are
 * no-ops. Nothing here throws — callers decide how to surface warnings.
 */

import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { getArtifactDir } from '@utils/artifacts';
import { getProjectRoot } from '@utils/outputPaths';

/** Metadata stored alongside each persisted heap snapshot (sidecar .meta.json). */
export interface PersistedSnapshotMeta {
  id: string;
  capturedAt: string;
  sizeBytes: number;
  chunkCount: number;
  simulated: boolean;
  /** Optional provenance hint (page URL) — populated when the capture path can read it. */
  targetUrl?: string | null;
}

export interface PersistResult {
  meta: PersistedSnapshotMeta;
  absolutePath: string;
  metaPath: string;
  displayPath: string;
  bytesWritten: number;
}

export interface ListedSnapshot extends PersistedSnapshotMeta {
  expired: boolean;
  fileName: string;
}

const HEAP_SNAPSHOT_CATEGORY = 'heap-snapshots' as const;
const DATA_EXT = '.heapsnapshot';
const META_EXT = '.meta.json';

export function getHeapSnapshotArtifactDir(): string {
  return getArtifactDir(HEAP_SNAPSHOT_CATEGORY);
}

/** Reduce an arbitrary snapshot id to a filename-safe segment. */
function sanitizeSnapshotId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 120);
}

function dataFilePath(dir: string, id: string): string {
  return join(dir, `${sanitizeSnapshotId(id)}${DATA_EXT}`);
}

function metaFilePath(dir: string, id: string): string {
  return join(dir, `${sanitizeSnapshotId(id)}${META_EXT}`);
}

function toDisplayPath(absolutePath: string): string {
  const root = getProjectRoot();
  const rel = relative(root, absolutePath);
  // If the path is outside the project root, fall back to the absolute form.
  return rel && !rel.startsWith('..') && !resolve(absolutePath).includes('..')
    ? rel.replace(/\\/g, '/')
    : absolutePath.replace(/\\/g, '/');
}

/**
 * Persist a heap snapshot (chunks concatenated) + sidecar meta into the artifact dir.
 * Overwrites any existing files for the same id (re-capture is idempotent).
 */
export async function persistSnapshot(snapshot: {
  id: string;
  chunks: string[];
  capturedAt: string;
  sizeBytes: number;
  simulated?: boolean;
  targetUrl?: string | null;
}): Promise<PersistResult> {
  const dir = getHeapSnapshotArtifactDir();
  await mkdir(dir, { recursive: true });

  const id = snapshot.id;
  const dataPath = dataFilePath(dir, id);
  const metaPath = metaFilePath(dir, id);

  // HeapProfiler.addHeapSnapshotChunk delivers the snapshot as a stream of JSON
  // fragments; concatenating them reconstructs the full .heapsnapshot document.
  const body = snapshot.chunks.join('');
  await writeFile(dataPath, body, 'utf8');

  const meta: PersistedSnapshotMeta = {
    id,
    capturedAt: snapshot.capturedAt,
    sizeBytes: snapshot.sizeBytes,
    chunkCount: snapshot.chunks.length,
    simulated: snapshot.simulated ?? false,
    ...(typeof snapshot.targetUrl === 'string' ? { targetUrl: snapshot.targetUrl } : {}),
  };
  await writeFile(metaPath, JSON.stringify(meta), 'utf8');

  let bytesWritten = snapshot.sizeBytes;
  try {
    bytesWritten = (await stat(dataPath)).size;
  } catch {
    // fall back to the declared sizeBytes
  }

  return {
    meta,
    absolutePath: dataPath,
    metaPath,
    displayPath: toDisplayPath(dataPath),
    bytesWritten,
  };
}

/**
 * List all persisted snapshots, newest-first by capturedAt. Applies an optional
 * ttl to flag (not delete) expired entries. Corrupt sidecars are skipped.
 */
export async function listPersistedSnapshots(options?: {
  now?: number;
  ttlMs?: number;
}): Promise<ListedSnapshot[]> {
  const dir = getHeapSnapshotArtifactDir();
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? 0;

  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const metaFiles = entries.filter((e) => e.isFile() && e.name.endsWith(META_EXT));
  const results: ListedSnapshot[] = [];

  for (const entry of metaFiles) {
    try {
      const raw = await readFile(join(dir, entry.name), 'utf8');
      const meta = JSON.parse(raw) as Partial<PersistedSnapshotMeta>;
      if (!meta || typeof meta.id !== 'string') {
        continue;
      }
      const capturedMs = Date.parse(meta.capturedAt ?? '');
      const expired = ttlMs > 0 && Number.isFinite(capturedMs) ? now - capturedMs > ttlMs : false;
      results.push({
        id: meta.id,
        capturedAt: meta.capturedAt ?? '',
        sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : 0,
        chunkCount: typeof meta.chunkCount === 'number' ? meta.chunkCount : 0,
        simulated: meta.simulated ?? false,
        ...(typeof meta.targetUrl === 'string' ? { targetUrl: meta.targetUrl } : {}),
        expired,
        fileName: entry.name,
      });
    } catch {
      // corrupt sidecar — skip silently (fail-soft)
    }
  }

  results.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0));
  return results;
}

/**
 * Load a persisted snapshot back into the in-memory chunk shape, so post-restart
 * analysis (analyzer/diff/retainers) can consume it without re-capturing.
 * Returns null if either file is missing or unreadable.
 */
export async function loadPersistedSnapshot(id: string): Promise<{
  id: string;
  chunks: string[];
  capturedAt: string;
  sizeBytes: number;
} | null> {
  const dir = getHeapSnapshotArtifactDir();
  const dataPath = dataFilePath(dir, id);
  const metaPath = metaFilePath(dir, id);

  let body: string;
  let meta: Partial<PersistedSnapshotMeta>;
  try {
    body = await readFile(dataPath, 'utf8');
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as Partial<PersistedSnapshotMeta>;
  } catch {
    return null;
  }

  return {
    id: meta.id ?? id,
    chunks: [body],
    capturedAt: meta.capturedAt ?? new Date().toISOString(),
    sizeBytes: meta.sizeBytes ?? Buffer.byteLength(body, 'utf8'),
  };
}

/**
 * Delete one persisted snapshot (data + sidecar). `deleted` is true only if at
 * least one file actually existed and was removed.
 */
export async function deletePersistedSnapshot(id: string): Promise<{
  deleted: boolean;
  freedBytes: number;
}> {
  const dir = getHeapSnapshotArtifactDir();
  const dataPath = dataFilePath(dir, id);
  const metaPath = metaFilePath(dir, id);
  let deleted = false;
  let freedBytes = 0;

  for (const path of [dataPath, metaPath]) {
    let size = 0;
    try {
      size = (await stat(path)).size;
    } catch {
      continue; // file not present
    }
    try {
      await rm(path, { force: true });
      deleted = true;
      freedBytes += size;
    } catch {
      // fail-soft: leave the other file to be cleaned up later
    }
  }

  return { deleted, freedBytes };
}

/** Delete every persisted snapshot. Returns aggregate counts over files removed. */
export async function deleteAllPersistedSnapshots(): Promise<{
  deletedCount: number;
  freedBytes: number;
}> {
  const dir = getHeapSnapshotArtifactDir();
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { deletedCount: 0, freedBytes: 0 };
  }

  const dataFiles = entries.filter((e) => e.isFile() && e.name.endsWith(DATA_EXT));
  let deletedCount = 0;
  let freedBytes = 0;

  for (const entry of dataFiles) {
    const id = entry.name.slice(0, -DATA_EXT.length);
    const res = await deletePersistedSnapshot(id);
    if (res.deleted) {
      deletedCount += 1;
      freedBytes += res.freedBytes;
    }
  }

  return { deletedCount, freedBytes };
}

/**
 * Enforce retention by evicting oldest snapshots until under both caps.
 * Zero/negative caps are ignored (no eviction on that axis).
 */
export async function enforceSnapshotRetention(options: {
  maxCount?: number;
  maxTotalBytes?: number;
}): Promise<{ evictedIds: string[]; freedBytes: number }> {
  const maxCount = options.maxCount ?? 0;
  const maxTotalBytes = options.maxTotalBytes ?? 0;
  if (maxCount <= 0 && maxTotalBytes <= 0) {
    return { evictedIds: [], freedBytes: 0 };
  }

  // listPersistedSnapshots returns newest-first; reverse for oldest-first eviction.
  let current = (await listPersistedSnapshots()).slice().toReversed();
  const evictedIds: string[] = [];
  let freedBytes = 0;

  if (maxCount > 0 && current.length > maxCount) {
    const toEvict = current.slice(0, current.length - maxCount);
    for (const meta of toEvict) {
      const res = await deletePersistedSnapshot(meta.id);
      if (res.deleted) {
        evictedIds.push(meta.id);
        freedBytes += res.freedBytes;
      }
    }
    current = current.slice(toEvict.length);
  }

  if (maxTotalBytes > 0) {
    let total = current.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);
    let i = 0;
    while (i < current.length && total > maxTotalBytes) {
      const meta = current[i]!;
      const res = await deletePersistedSnapshot(meta.id);
      if (res.deleted) {
        evictedIds.push(meta.id);
        freedBytes += res.freedBytes;
      }
      total -= meta.sizeBytes ?? 0;
      i += 1;
    }
  }

  return { evictedIds, freedBytes };
}
