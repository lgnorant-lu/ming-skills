/**
 * Shared types and state store for shared-state-board sub-handlers.
 */

import { randomUUID } from 'node:crypto';
import { escapeRegexStr } from '@utils/escapeForRegex';

export interface StateEntry {
  key: string;
  value: unknown;
  namespace: string;
  createdAt: number;
  updatedAt: number;
  ttlSeconds?: number;
  expiresAt?: number;
  version: number;
}

export interface StateChangeRecord {
  id: string;
  key: string;
  namespace: string;
  action: 'set' | 'delete' | 'expire';
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: number;
  source?: string;
}

export interface StateWatch {
  id: string;
  key: string;
  namespace: string;
  pattern: boolean;
  pollIntervalMs: number;
  lastChecked: number;
  lastVersion: Record<string, number>;
  createdAt: number;
  /** Watch is auto-evicted after this timestamp if not polled. */
  expiresAt: number;
}

export interface StateBoardStats {
  totalEntries: number;
  entriesByNamespace: Record<string, number>;
  expiredEntries: number;
  totalWatches: number;
  historySize: number;
}

type PersistNotifier = () => void;

export function matchesKeyPattern(key: string, keyPattern?: string): boolean {
  if (!keyPattern) return true;
  const regex = new RegExp(
    `^${keyPattern
      .split('*')
      .map((segment) => escapeRegexStr(segment))
      .join('.*')}$`,
  );
  return regex.test(key);
}

export class StateBoardStore {
  readonly state = new Map<string, StateEntry>();
  readonly history = new Map<string, StateChangeRecord[]>();
  readonly watches = new Map<string, StateWatch>();
  readonly maxHistoryPerKey = 100;
  /** Maximum number of concurrent watches before oldest is evicted. */
  readonly maxWatches = 200;
  /** Watch is auto-evicted if not polled within this duration (ms). */
  readonly watchIdleTtlMs = 30 * 60_000;
  private mutationSeq = 0;
  private lastPersistedSeq = 0;
  private persistNotifier?: PersistNotifier;

  /** Evict expired or excess watches. Called on watch/poll/list paths. */
  pruneExpiredWatches(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [id, watch] of this.watches) {
      if (watch.expiresAt < now) {
        this.watches.delete(id);
        pruned++;
      }
    }
    // Hard cap: evict oldest if still over limit.
    if (this.watches.size > this.maxWatches) {
      const sorted = [...this.watches.entries()].toSorted(
        (a, b) => a[1].lastChecked - b[1].lastChecked,
      );
      const excess = this.watches.size - this.maxWatches;
      for (let i = 0; i < excess; i++) {
        const entry = sorted[i];
        if (entry) {
          this.watches.delete(entry[0]);
          pruned++;
        }
      }
    }
    return pruned;
  }

  setPersistNotifier(notify?: PersistNotifier): void {
    this.persistNotifier = notify;
  }

  private markDirty(): void {
    this.mutationSeq++;
    this.persistNotifier?.();
  }

  recordChange(fullKey: string, record: StateChangeRecord): void {
    this.markDirty();
    let history = this.history.get(fullKey);
    if (!history) {
      history = [];
      this.history.set(fullKey, history);
    }
    history.push(record);
    if (history.length > this.maxHistoryPerKey) {
      history.splice(0, history.length - this.maxHistoryPerKey);
    }
  }

  deleteEntry(fullKey: string): void {
    const entry = this.state.get(fullKey);
    if (!entry) return;
    this.state.delete(fullKey);
    this.recordChange(fullKey, {
      id: randomUUID().slice(0, 8),
      key: entry.key,
      namespace: entry.namespace,
      action: 'delete',
      oldValue: entry.value,
      timestamp: Date.now(),
    });
  }

  isExpired(entry: StateEntry): boolean {
    return !!(entry.expiresAt && Date.now() > entry.expiresAt);
  }

  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [fullKey, entry] of this.state.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.state.delete(fullKey);
        this.recordChange(fullKey, {
          id: randomUUID().slice(0, 8),
          key: entry.key,
          namespace: entry.namespace,
          action: 'expire',
          oldValue: entry.value,
          timestamp: now,
        });
        cleaned++;
      }
    }
    return cleaned;
  }

  getSnapshotSeq(): number {
    return this.mutationSeq;
  }

  getLastPersistedSeq(): number {
    return this.lastPersistedSeq;
  }

  markPersisted(): void {
    this.lastPersistedSeq = this.mutationSeq;
  }

  isPersistDirty(): boolean {
    return this.mutationSeq !== this.lastPersistedSeq;
  }

  exportSnapshot(): {
    schemaVersion: number;
    savedAt: string;
    entries: [string, StateEntry][];
    history: [string, StateChangeRecord[]][];
  } {
    return {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      entries: [...this.state.entries()],
      history: [...this.history.entries()],
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const snapshot = data as {
      schemaVersion?: number;
      entries?: [string, StateEntry][];
      history?: [string, StateChangeRecord[]][];
    };
    if (snapshot.schemaVersion !== 1) return;
    const now = Date.now();
    this.state.clear();
    this.history.clear();
    if (snapshot.entries) {
      for (const [key, entry] of snapshot.entries) {
        // Skip expired entries on restore
        if (entry.expiresAt && now > entry.expiresAt) continue;
        this.state.set(key, entry);
      }
    }
    if (snapshot.history) {
      for (const [key, records] of snapshot.history) {
        this.history.set(key, records);
      }
    }
    this.mutationSeq = this.state.size;
    this.lastPersistedSeq = this.mutationSeq;
  }
}
