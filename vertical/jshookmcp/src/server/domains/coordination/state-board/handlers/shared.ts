/**
 * Shared types and state store for shared-state-board sub-handlers.
 */

import { randomUUID } from 'node:crypto';
import { escapeRegexStr } from '@utils/escapeForRegex';
import { readEnvInteger } from '@src/config/environment';

/** Hard cap on live state-board entries before least-recently-used eviction. */
const MAX_ENTRIES = 10_000;
/** Default TTL (ms) applied to entries set without an explicit TTL. */
const DEFAULT_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
/** Interval (ms) between automatic expired-entry sweeps. */
const CLEANUP_INTERVAL_MS = 60_000;

/** Resolve the default entry TTL, overridable via env for ops/tests. */
function resolveDefaultTtlMs(): number {
  return readEnvInteger('JSHOOK_STATE_BOARD_DEFAULT_TTL_MS', DEFAULT_ENTRY_TTL_MS, { min: 1 });
}
const defaultEntryTtlMs = resolveDefaultTtlMs();

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
  /** Number of entries removed by the least-recently-used cap. */
  evictedEntries: number;
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

export interface StateBoardStoreOptions {
  /** Cap on live entries before least-recently-used eviction. */
  maxEntries?: number;
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
  private readonly maxEntries: number;
  private evictedEntries = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private mutationSeq = 0;
  private lastPersistedSeq = 0;
  private persistNotifier?: PersistNotifier;

  constructor(options: StateBoardStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? MAX_ENTRIES;
    // Wire periodic expired-entry cleanup at construction time so immortal
    // entries (and already-expired ones) cannot accumulate between explicit
    // sweeps. unref'd so it never blocks process exit.
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Number of entries removed by the least-recently-used cap. */
  getEvictedEntries(): number {
    return this.evictedEntries;
  }

  /**
   * Insert an entry and evict the least-recently-used entries when over the cap.
   *
   * TTL resolution: `ttlSeconds === 0` marks the entry explicitly permanent
   * (no `expiresAt`; the LRU cap still bounds memory). When both `ttlSeconds`
   * and `expiresAt` are absent, the bounded default TTL is applied so the key
   * space cannot grow without limit. Any other value is honored verbatim.
   */
  setEntry(fullKey: string, entry: StateEntry): void {
    if (entry.ttlSeconds === 0) {
      // Explicit permanent — the LRU cap remains the only bound on memory.
      entry.expiresAt = undefined;
    } else if (entry.expiresAt === undefined && entry.ttlSeconds === undefined) {
      entry.expiresAt = Date.now() + defaultEntryTtlMs;
      entry.ttlSeconds = Math.floor(defaultEntryTtlMs / 1000);
    }
    // Map insertion order is the incremental LRU queue. Refreshing an existing
    // key moves it to the newest position without rebuilding or sorting state.
    this.state.delete(fullKey);
    this.state.set(fullKey, entry);
    this.evictLruIfNeeded();
  }

  /** Evict the least-recently-written entries using Map insertion order. */
  private evictLruIfNeeded(): void {
    const excess = this.state.size - this.maxEntries;
    if (excess <= 0) return;
    let removed = 0;
    for (const fullKey of this.state.keys()) {
      if (removed >= excess) break;
      this.state.delete(fullKey);
      // History shares the entry's lifecycle: an evicted key must not leave an
      // orphaned history array (up to `maxHistoryPerKey` full oldValue copies)
      // pinning memory for the life of the process.
      this.history.delete(fullKey);
      this.evictedEntries++;
      removed++;
    }
  }

  /** Stop the periodic cleanup timer. Idempotent. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

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
    // History is deliberately retained here: a user-issued `delete` is an
    // auditable action, so the 'delete' record below stays in history. Contrast
    // cleanupExpired, where expiry is passive cleanup and history is removed
    // alongside state (no audit record is written).
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
        // History shares the entry's lifecycle. Previously an `expire` record
        // (with the full `oldValue` copy) was written here and left behind, so
        // every distinct key that ever expired permanently retained up to
        // `maxHistoryPerKey` copies of its value.
        this.history.delete(fullKey);
        this.markDirty();
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

  restoreSnapshot(data: unknown): { evictedHistoryKeys: number } {
    if (!data || typeof data !== 'object') return { evictedHistoryKeys: 0 };
    const snapshot = data as {
      schemaVersion?: number;
      entries?: [string, StateEntry][];
      history?: [string, StateChangeRecord[]][];
    };
    if (snapshot.schemaVersion !== 1) return { evictedHistoryKeys: 0 };
    const now = Date.now();
    this.state.clear();
    this.history.clear();
    if (snapshot.entries) {
      // Snapshot order is not trusted. Normalize once so subsequent capped
      // writes can evict from the Map head in O(1) per entry.
      const entriesByRecency = snapshot.entries.toSorted((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [key, entry] of entriesByRecency) {
        // Skip expired entries on restore
        if (entry.expiresAt && now > entry.expiresAt) continue;
        this.state.set(key, entry);
      }
    }
    // Restore history only for keys that have a live state entry. A hostile or
    // corrupt snapshot can carry history arrays for keys with no state entry
    // (delete/expire audit records, or injected pure-history keys) — those
    // would otherwise bypass the LRU cap and pin unbounded memory (up to
    // `maxHistoryPerKey` full oldValue copies per orphan key, with no bound on
    // the number of keys).
    let evictedHistoryKeys = 0;
    if (snapshot.history) {
      for (const [key, records] of snapshot.history) {
        if (!this.state.has(key)) {
          evictedHistoryKeys++;
          continue;
        }
        this.history.set(key, records);
      }
    }
    // A hostile or oversized snapshot can inject more entries than the cap
    // allows. Trim back to `maxEntries` (evicting history alongside state) so
    // restore cannot bypass the same bound that normal inserts enforce.
    this.evictLruIfNeeded();
    // mutationSeq is snapshotted to the restored entry count rather than
    // incremented, so it can move backwards relative to a pre-restore in-memory
    // seq. That is safe: dirtiness is a pure equality check (isPersistDirty
    // compares mutationSeq !== lastPersistedSeq) and both are snapped together
    // here, so no consumer relies on the seq being monotonic.
    this.mutationSeq = this.state.size;
    this.lastPersistedSeq = this.mutationSeq;
    return { evictedHistoryKeys };
  }
}
