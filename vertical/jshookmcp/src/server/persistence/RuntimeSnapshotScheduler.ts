import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '@utils/logger';
import { readEnvNullableString } from '@src/config/environment';

/**
 * Counts reported by a snapshot restore — the number of records dropped or
 * evicted while trimming a restored snapshot back to its configured caps.
 * The shape is intentionally loose: each source reports its own subset of keys
 * (e.g. `{ droppedNodes, droppedEdges }` for the evidence graph, or
 * `{ evictedHistoryKeys }` for the state board).
 */
export interface SnapshotRestoreSummary {
  droppedNodes?: number;
  droppedEdges?: number;
  evictedHistoryKeys?: number;
}

export interface SnapshotSource {
  isPersistDirty(): boolean;
  exportSnapshot(): unknown;
  restoreSnapshot(data: unknown): void | SnapshotRestoreSummary;
  markPersisted(): void;
}

interface SnapshotSourceEntry {
  source: SnapshotSource;
  filePath: string;
}

/** Default debounce window (ms) before persisting dirty snapshots after notifyDirty(). */
const DEFAULT_DEBOUNCE_MS = 2000;
/** Default periodic flush interval (ms) for dirty snapshots while the scheduler is started. */
const DEFAULT_PERIODIC_MS = 30_000;

export class RuntimeSnapshotScheduler {
  private readonly sources: SnapshotSourceEntry[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly debounceMs: number;
  private readonly periodicMs: number;
  private disposed = false;
  private started = false;

  constructor(options?: { debounceMs?: number; periodicMs?: number }) {
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.periodicMs = options?.periodicMs ?? DEFAULT_PERIODIC_MS;
  }

  register(filePath: string, source: SnapshotSource): void {
    const existing = this.sources.find(
      (entry) => entry.filePath === filePath || entry.source === source,
    );
    if (existing) {
      if (existing.filePath !== filePath || existing.source !== source) {
        logger.warn(`skipping conflicting snapshot registration for ${filePath}`);
      }
      return;
    }

    const entry = { source, filePath };
    this.sources.push(entry);
    if (this.started) {
      void this.restoreOne(entry).catch((err) =>
        logger.warn(`snapshot restore failed for ${entry.filePath}:`, err),
      );
    }
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.restoreAll();
    if (this.disposed || this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.scheduleFlush().catch((err) => logger.warn('periodic snapshot failed:', err));
    }, this.periodicMs);
    // unref so a running periodic flush never blocks graceful process exit.
    if (this.periodicTimer.unref) {
      this.periodicTimer.unref();
    }
  }

  notifyDirty(): void {
    if (this.disposed) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.scheduleFlush().catch((err) => logger.warn('debounce snapshot failed:', err));
    }, this.debounceMs);
  }

  async flushAll(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.writeDirtySources();
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  private async restoreAll(): Promise<void> {
    for (const entry of this.sources) {
      await this.restoreOne(entry);
    }
  }

  private async restoreOne(entry: SnapshotSourceEntry): Promise<void> {
    try {
      const data = await readFile(entry.filePath, 'utf-8');
      const parsed = JSON.parse(data);
      const summary = entry.source.restoreSnapshot(parsed);
      logger.info(`restored snapshot from ${entry.filePath}${describeRestoreSummary(summary)}`);
    } catch {
      // No snapshot file or corrupt — start fresh (normal on first run)
    }
  }

  private async scheduleFlush(): Promise<void> {
    await this.writeDirtySources();
  }

  private async writeDirtySources(): Promise<void> {
    for (const entry of this.sources) {
      if (!entry.source.isPersistDirty()) continue;
      try {
        await this.writeSnapshot(entry);
      } catch (err) {
        logger.warn(`snapshot write failed for ${entry.filePath}:`, err);
      }
    }
  }

  private async writeSnapshot(entry: SnapshotSourceEntry): Promise<void> {
    const dir = dirname(entry.filePath);
    await mkdir(dir, { recursive: true });
    const data = JSON.stringify(entry.source.exportSnapshot());
    const tmpPath = entry.filePath + '.tmp';
    await writeFile(tmpPath, data, 'utf-8');
    await rename(tmpPath, entry.filePath);
    entry.source.markPersisted();
  }
}

export function getStateDir(): string {
  const overridden = readEnvNullableString('JSHOOK_STATE_DIR', { trim: true });
  if (overridden) {
    return resolve(homedir(), overridden);
  }
  return resolve(homedir(), '.jshookmcp', 'state');
}

/** Renders restore summary counts as a compact ` (key=value, ...)` log suffix. */
function describeRestoreSummary(summary: void | SnapshotRestoreSummary): string {
  if (!summary || typeof summary !== 'object') return '';
  const parts = Object.entries(summary)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}
