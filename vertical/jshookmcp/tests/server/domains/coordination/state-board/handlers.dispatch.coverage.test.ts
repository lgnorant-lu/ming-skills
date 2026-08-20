/**
 * Coverage tests for SharedStateBoardHandlers.handleDispatch switch
 * and handleWatchDispatch/handleIODispatch if-chains.
 *
 * The existing handlers.dispatch.test.ts covers watch/IO dispatch but
 * does NOT cover the general handleDispatch switch (set/get/delete/
 * list/history/clear/default branches) or the action=poll branch
 * of handleWatchDispatch.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SharedStateBoardHandlers } from '@server/domains/coordination/state-board';

describe('SharedStateBoardHandlers — handleDispatch switch coverage', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  // ── handleDispatch(action='set') ─────────────────────────────────────

  describe('handleDispatch action=set', () => {
    it('sets a key via dispatch', async () => {
      const result = (await handler.handleDispatch({
        action: 'set',
        key: 'dispatch-set',
        value: 42,
      })) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.key).toBe('dispatch-set');
    });
  });

  // ── handleDispatch(action='get') ──────────────────────────────────────

  describe('handleDispatch action=get', () => {
    it('gets an existing key via dispatch', async () => {
      await handler.handleSet({ key: 'dg', value: 'val' });
      const result = (await handler.handleDispatch({
        action: 'get',
        key: 'dg',
      })) as Record<string, unknown>;
      expect(result.found).toBe(true);
      expect(result.value).toBe('val');
    });

    it('returns found=false for missing key via dispatch', async () => {
      const result = (await handler.handleDispatch({
        action: 'get',
        key: 'nonexistent',
      })) as Record<string, unknown>;
      expect(result.found).toBe(false);
    });
  });

  // ── handleDispatch(action='delete') ───────────────────────────────────

  describe('handleDispatch action=delete', () => {
    it('deletes an existing key via dispatch', async () => {
      await handler.handleSet({ key: 'del-me', value: 'x' });
      const result = (await handler.handleDispatch({
        action: 'delete',
        key: 'del-me',
      })) as Record<string, unknown>;
      expect(result.deleted).toBe(true);
    });

    it('returns deleted=false for missing key via dispatch', async () => {
      const result = (await handler.handleDispatch({
        action: 'delete',
        key: 'no-such-key',
      })) as Record<string, unknown>;
      expect(result.deleted).toBe(false);
    });
  });

  // ── handleDispatch(action='list') ─────────────────────────────────────

  describe('handleDispatch action=list', () => {
    it('lists entries via dispatch', async () => {
      await handler.handleSet({ key: 'l1', value: 1 });
      await handler.handleSet({ key: 'l2', value: 2 });
      const result = (await handler.handleDispatch({ action: 'list' })) as Record<string, unknown>;
      expect(result.total).toBe(2);
    });
  });

  // ── handleDispatch(action='history') ──────────────────────────────────

  describe('handleDispatch action=history', () => {
    it('returns history via dispatch', async () => {
      await handler.handleSet({ key: 'hist-key', value: 'v1' });
      const result = (await handler.handleDispatch({
        action: 'history',
        key: 'hist-key',
      })) as Record<string, unknown>;
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  // ── handleDispatch(action='clear') ────────────────────────────────────

  describe('handleDispatch action=clear', () => {
    it('clears all entries via dispatch', async () => {
      await handler.handleSet({ key: 'c1', value: 1 });
      await handler.handleSet({ key: 'c2', value: 2 });
      const result = (await handler.handleDispatch({ action: 'clear' })) as Record<string, unknown>;
      expect(result.cleared).toBe(2);
    });
  });

  // ── handleDispatch(action=unknown) — default branch ───────────────────

  describe('handleDispatch action=unknown (default branch)', () => {
    it('returns error response for invalid action', async () => {
      const result = (await handler.handleDispatch({
        action: 'invalid',
      })) as Record<string, unknown>;
      // asErrorResponse wraps the ToolError
      expect(result).toHaveProperty('content');
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('Invalid action: "invalid"');
    });

    it('returns error response for empty action', async () => {
      const result = (await handler.handleDispatch({ action: '' })) as Record<string, unknown>;
      expect(result).toHaveProperty('content');
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('Invalid action: ""');
    });

    it('returns error response when action is missing', async () => {
      const result = (await handler.handleDispatch({})) as Record<string, unknown>;
      expect(result).toHaveProperty('content');
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('Invalid action: ""');
    });
  });
});

describe('SharedStateBoardHandlers — handleWatchDispatch action=poll branch', () => {
  let handler: SharedStateBoardHandlers;

  beforeEach(() => {
    handler = new SharedStateBoardHandlers();
  });

  it('routes action=poll to handlePoll — detects changes', async () => {
    const watchResult = (await handler.handleWatch({ key: 'poll-dispatch' })) as {
      watchId: string;
    };
    await handler.handleSet({ key: 'poll-dispatch', value: 'new!' });
    const result = (await handler.handleWatchDispatch({
      action: 'poll',
      watchId: watchResult.watchId,
    })) as Record<string, unknown>;
    expect(result.hasChanges).toBe(true);
    const changes = result.changes as Array<Record<string, unknown>>;
    expect(changes.some((c) => c.action === 'created')).toBe(true);
  });

  it('routes action=poll to handlePoll — no changes', async () => {
    const watchResult = (await handler.handleWatch({ key: 'no-change-key' })) as {
      watchId: string;
    };
    // No mutation between watch and poll
    const result = (await handler.handleWatchDispatch({
      action: 'poll',
      watchId: watchResult.watchId,
    })) as Record<string, unknown>;
    expect(result.hasChanges).toBe(false);
  });

  it('routes action=poll — throws for unknown watchId', async () => {
    await expect(
      handler.handleWatchDispatch({ action: 'poll', watchId: 'watch_nonexistent' }),
    ).rejects.toThrow('Watch "watch_nonexistent" not found');
  });
});
