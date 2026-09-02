/**
 * Bounds and default-TTL tests for StateBoardStore (a3-03).
 *
 * The handler-level tests exercise set/get/delete via StoreHandlers; these
 * exercise the store's unbounded-growth guards directly: default TTL, LRU
 * eviction with a drop counter, and the periodic cleanup timer wired at
 * construction time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateBoardStore } from '@server/domains/coordination/state-board/handlers/shared';
import type { StateEntry } from '@server/domains/coordination/state-board/handlers/shared';

function entry(key: string, updatedAt: number, expiresAt?: number): StateEntry {
  return {
    key,
    value: key,
    namespace: 'default',
    createdAt: updatedAt,
    updatedAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    version: 1,
  };
}

describe('StateBoardStore — bounds and default TTL (a3-03)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a default TTL to entries set without one', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    const e = entry('k', Date.now());
    store.setEntry('default:k', e);
    expect(e.expiresAt).toBeDefined();
    expect(e.ttlSeconds).toBe(24 * 60 * 60);
    store.dispose();
  });

  it('does not override an explicit TTL', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    const e = entry('k', Date.now(), Date.now() + 5000);
    e.ttlSeconds = 5;
    store.setEntry('default:k', e);
    expect(e.ttlSeconds).toBe(5);
    expect(e.expiresAt).toBeLessThan(Date.now() + 6000);
    store.dispose();
  });

  it('treats ttlSeconds: 0 as explicit permanent (no expiresAt)', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    const e = entry('k', Date.now());
    e.ttlSeconds = 0;
    store.setEntry('default:k', e);
    expect(e.expiresAt).toBeUndefined();
    expect(e.ttlSeconds).toBe(0);
    store.dispose();
  });

  it('evicts the least-recently-used entry when over the cap and counts it', () => {
    const store = new StateBoardStore({ maxEntries: 3 });
    const farFuture = Date.now() + 999_999;
    store.setEntry('a', entry('a', 1, farFuture));
    store.setEntry('b', entry('b', 2, farFuture));
    store.setEntry('c', entry('c', 3, farFuture));
    store.setEntry('d', entry('d', 4, farFuture));

    expect(store.state.size).toBe(3);
    expect(store.state.has('a')).toBe(false); // oldest updatedAt evicted
    expect(store.state.has('d')).toBe(true);
    expect(store.getEvictedEntries()).toBe(1);
    store.dispose();
  });

  it('evicts the single excess entry even after a prior cap reset', () => {
    const store = new StateBoardStore({ maxEntries: 2 });
    const farFuture = Date.now() + 999_999;
    store.setEntry('a', entry('a', 1, farFuture));
    store.setEntry('b', entry('b', 2, farFuture));
    store.setEntry('c', entry('c', 3, farFuture));

    expect(store.state.size).toBe(2);
    expect(store.state.has('a')).toBe(false);
    expect(store.getEvictedEntries()).toBe(1);
    store.dispose();
  });

  it('refreshes an existing key in the incremental LRU order', () => {
    const store = new StateBoardStore({ maxEntries: 2 });
    const farFuture = Date.now() + 999_999;
    store.setEntry('a', entry('a', 1, farFuture));
    store.setEntry('b', entry('b', 2, farFuture));
    store.setEntry('a', entry('a', 3, farFuture));
    store.setEntry('c', entry('c', 4, farFuture));

    expect(store.state.has('a')).toBe(true);
    expect(store.state.has('b')).toBe(false);
    expect(store.state.has('c')).toBe(true);
    expect(store.getEvictedEntries()).toBe(1);
    store.dispose();
  });

  it('deletes history for LRU-evicted keys (history shares the entry lifecycle)', () => {
    const store = new StateBoardStore({ maxEntries: 2 });
    const farFuture = Date.now() + 999_999;
    store.setEntry('a', entry('a', 1, farFuture));
    store.recordChange('a', {
      id: '1',
      key: 'a',
      namespace: 'default',
      action: 'set',
      timestamp: 1,
    });
    store.setEntry('b', entry('b', 2, farFuture));
    store.setEntry('c', entry('c', 3, farFuture)); // evicts 'a'

    expect(store.state.has('a')).toBe(false);
    // The evicted key's history array must not be orphaned behind.
    expect(store.history.has('a')).toBe(false);
    expect(store.state.has('b')).toBe(true);
    expect(store.state.has('c')).toBe(true);
    store.dispose();
  });

  it('deletes history for expired keys on cleanup', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    const now = Date.now();
    store.setEntry('expired', entry('expired', now, now - 1));
    store.recordChange('expired', {
      id: '1',
      key: 'expired',
      namespace: 'default',
      action: 'set',
      timestamp: now,
    });
    expect(store.history.has('expired')).toBe(true);

    store.cleanupExpired();

    expect(store.state.has('expired')).toBe(false);
    expect(store.history.has('expired')).toBe(false);
    store.dispose();
  });

  it('trims restored entries to maxEntries (hostile snapshot cannot bypass the cap)', () => {
    const store = new StateBoardStore({ maxEntries: 3 });
    const farFuture = Date.now() + 999_999;
    const entries: [string, StateEntry][] = [
      ['a', entry('a', 1, farFuture)],
      ['b', entry('b', 2, farFuture)],
      ['c', entry('c', 3, farFuture)],
      ['d', entry('d', 4, farFuture)],
      ['e', entry('e', 5, farFuture)],
    ];
    store.restoreSnapshot({
      schemaVersion: 1,
      entries,
      history: [
        ['a', [{ id: '1', key: 'a', namespace: 'default', action: 'set', timestamp: 1 }]],
        ['b', [{ id: '2', key: 'b', namespace: 'default', action: 'set', timestamp: 2 }]],
      ],
    });

    expect(store.state.size).toBe(3);
    expect(store.state.has('a')).toBe(false);
    expect(store.state.has('b')).toBe(false);
    expect(store.state.has('e')).toBe(true);
    // Evicted keys' history is trimmed alongside state.
    expect(store.history.has('a')).toBe(false);
    store.dispose();
  });

  it('drops orphan history keys (no state entry) on restore and reports the count', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    const farFuture = Date.now() + 999_999;
    const result = store.restoreSnapshot({
      schemaVersion: 1,
      entries: [['a', entry('a', 1, farFuture)]],
      history: [
        ['a', [{ id: '1', key: 'a', namespace: 'default', action: 'set', timestamp: 1 }]],
        // Orphan history: no corresponding state entry. A hostile snapshot can
        // inject any number of these (delete/expire audit records) with
        // arbitrarily large oldValue copies.
        ['b', [{ id: '2', key: 'b', namespace: 'default', action: 'delete', timestamp: 2 }]],
        ['c', [{ id: '3', key: 'c', namespace: 'default', action: 'set', timestamp: 3 }]],
      ],
    });

    expect(store.state.has('a')).toBe(true);
    // Only history for keys with a live state entry is retained.
    expect(store.history.has('a')).toBe(true);
    expect(store.history.has('b')).toBe(false);
    expect(store.history.has('c')).toBe(false);
    // The import response reports how many orphan history keys were dropped.
    expect(result.evictedHistoryKeys).toBe(2);
    store.dispose();
  });

  it('wires periodic cleanup at construction (unref timer sweeps expired entries)', () => {
    vi.useFakeTimers();
    const store = new StateBoardStore({ maxEntries: 10 });
    const now = Date.now();
    store.setEntry('expired', entry('expired', now, now - 1));
    expect(store.state.size).toBe(1);

    vi.advanceTimersByTime(120_000);
    expect(store.state.size).toBe(0);
    store.dispose();
  });

  it('dispose clears the cleanup timer and is idempotent', () => {
    const store = new StateBoardStore({ maxEntries: 10 });
    store.dispose();
    store.dispose();
    expect((store as any).cleanupTimer).toBeNull();
  });
});
