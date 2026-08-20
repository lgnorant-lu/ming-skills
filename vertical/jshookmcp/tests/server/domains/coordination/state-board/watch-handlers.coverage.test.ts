/**
 * Coverage tests for WatchHandlers — watch, unwatch, poll.
 *
 * The existing handlers.test.ts covers basic watch/unwatch/poll but
 * does NOT cover pattern-watch poll branches (created/changed/deleted
 * for pattern watches), nor the non-pattern poll branches for a
 * created key (entry exists but lastVersion undefined).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SharedStateBoardHandlers } from '@server/domains/coordination/state-board';

describe('WatchHandlers — pattern-watch poll coverage', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  // ── Pattern watch: created key after watch ─────────────────────────────

  describe('pattern watch poll — created', () => {
    it('detects a newly created key matching pattern', async () => {
      const watchResult = (await handler.handleWatch({
        key: 'user:*',
        namespace: 'default',
      })) as { watchId: string };
      await handler.handleSet({ key: 'user:1', value: 'Alice' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      const created = changes.find((c) => c.action === 'created');
      expect(created).toBeDefined();
      expect(created!.key).toBe('user:1');
    });

    it('detects multiple new keys matching pattern', async () => {
      const watchResult = (await handler.handleWatch({
        key: 'item:*',
      })) as { watchId: string };
      await handler.handleSet({ key: 'item:a', value: 1 });
      await handler.handleSet({ key: 'item:b', value: 2 });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.filter((c) => c.action === 'created').length).toBe(2);
    });
  });

  // ── Pattern watch: changed key after watch ─────────────────────────────

  describe('pattern watch poll — changed', () => {
    it('detects a value change on a key matching pattern', async () => {
      await handler.handleSet({ key: 'cfg:timeout', value: 30 });
      const watchResult = (await handler.handleWatch({
        key: 'cfg:*',
      })) as { watchId: string };
      // First poll picks up initial version (no changes reported — version matches)
      await handler.handlePoll({ watchId: watchResult.watchId });
      // Now modify
      await handler.handleSet({ key: 'cfg:timeout', value: 60 });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'changed')).toBe(true);
    });
  });

  // ── Pattern watch: deleted key after watch ─────────────────────────────

  describe('pattern watch poll — deleted', () => {
    it('detects a deleted key matching pattern', async () => {
      await handler.handleSet({ key: 'sess:abc', value: 'token1' });
      const watchResult = (await handler.handleWatch({
        key: 'sess:*',
      })) as { watchId: string };
      // First poll to register the initial version
      await handler.handlePoll({ watchId: watchResult.watchId });
      // Delete the key
      await handler.handleDelete({ key: 'sess:abc' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'deleted')).toBe(true);
    });
  });

  // ── Pattern watch: non-matching key is ignored ─────────────────────────

  describe('pattern watch poll — non-matching key ignored', () => {
    it('does not report changes for keys not matching the pattern', async () => {
      const watchResult = (await handler.handleWatch({
        key: 'user:*',
      })) as { watchId: string };
      await handler.handleSet({ key: 'config', value: 'no-match' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(false);
    });
  });

  // ── Pattern watch: different namespace ignored ─────────────────────────

  describe('pattern watch poll — different namespace', () => {
    it('does not report changes from other namespaces', async () => {
      const watchResult = (await handler.handleWatch({
        key: 'key:*',
        namespace: 'ns1',
      })) as { watchId: string };
      await handler.handleSet({ key: 'key:x', value: 'wrong-ns', namespace: 'ns2' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(false);
    });
  });
});

describe('WatchHandlers — non-pattern poll edge cases', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  // ── Non-pattern watch: key created after watch (entry exists, lastVersion undefined) ──

  describe('non-pattern watch poll — created after watch', () => {
    it('detects a newly created non-pattern key after watch was set', async () => {
      // Watch a key that does not yet exist
      const watchResult = (await handler.handleWatch({ key: 'future-key' })) as {
        watchId: string;
      };
      // Now create it
      await handler.handleSet({ key: 'future-key', value: 'new!' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes[0]!.action).toBe('created');
    });
  });

  // ── Non-pattern watch: key changed after watch ─────────────────────────

  describe('non-pattern watch poll — changed after initial poll', () => {
    it('detects a value change on subsequent poll', async () => {
      await handler.handleSet({ key: 'tracked', value: 'v1' });
      const watchResult = (await handler.handleWatch({ key: 'tracked' })) as { watchId: string };
      // First poll — no change (version matches initial)
      await handler.handlePoll({ watchId: watchResult.watchId });
      // Change the value
      await handler.handleSet({ key: 'tracked', value: 'v2' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'changed')).toBe(true);
    });
  });

  // ── Non-pattern watch: key deleted after watch ─────────────────────────

  describe('non-pattern watch poll — deleted after initial poll', () => {
    it('detects deletion of watched key', async () => {
      await handler.handleSet({ key: 'to-delete', value: 'x' });
      const watchResult = (await handler.handleWatch({ key: 'to-delete' })) as { watchId: string };
      await handler.handlePoll({ watchId: watchResult.watchId });
      await handler.handleDelete({ key: 'to-delete' });
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(true);
      const changes = pollResult.changes as Array<Record<string, unknown>>;
      expect(changes.some((c) => c.action === 'deleted')).toBe(true);
    });
  });

  // ── Non-pattern watch: no entry and no lastVersion — no change ──────────

  describe('non-pattern watch poll — key never existed', () => {
    it('reports no changes when key never existed', async () => {
      const watchResult = (await handler.handleWatch({ key: 'never-existed' })) as {
        watchId: string;
      };
      const pollResult = (await handler.handlePoll({ watchId: watchResult.watchId })) as Record<
        string,
        unknown
      >;
      expect(pollResult.hasChanges).toBe(false);
      expect(pollResult.changes).toEqual([]);
    });
  });
});

describe('WatchHandlers — watch with existing pattern keys and different namespace', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  it('initializes lastVersion from matching keys in the specified namespace only', async () => {
    await handler.handleSet({ key: 'metric:cpu', value: 80, namespace: 'monitor' });
    await handler.handleSet({ key: 'metric:mem', value: 60, namespace: 'monitor' });
    await handler.handleSet({ key: 'metric:disk', value: 40, namespace: 'other' });
    const result = (await handler.handleWatch({
      key: 'metric:*',
      namespace: 'monitor',
    })) as Record<string, unknown>;
    const initialKeys = result.initialKeys as string[];
    expect(initialKeys).toContain('metric:cpu');
    expect(initialKeys).toContain('metric:mem');
    expect(initialKeys).not.toContain('metric:disk');
  });

  it('pattern watch with exact key (no wildcard) sets pattern=false', async () => {
    const result = (await handler.handleWatch({ key: 'exact-key' })) as Record<string, unknown>;
    expect(result.pattern).toBe(false);
  });

  it('pattern watch with custom namespace and pollIntervalMs', async () => {
    const result = (await handler.handleWatch({
      key: 'ns:*',
      namespace: 'custom',
      pollIntervalMs: 500,
    })) as Record<string, unknown>;
    expect(result.namespace).toBe('custom');
    expect(result.pollIntervalMs).toBe(500);
  });
});
