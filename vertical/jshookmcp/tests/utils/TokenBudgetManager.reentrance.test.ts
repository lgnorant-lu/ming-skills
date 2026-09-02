import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenBudgetManager as TokenBudgetManagerType } from '@utils/TokenBudgetManager';

/**
 * Regression tests for re-entrance through the external cleanup callback
 * (see fix: cleanupRunning guard + auto-cleanup cooldown).
 *
 * The constants module is mocked with a small token budget, and the
 * DetailedDataResponse fast path ({ detailId, summary: { size } }) is used
 * so a single call already crosses the 90% auto-cleanup threshold.
 */
describe('utils/TokenBudgetManager re-entrance', () => {
  const MAX_TOKENS = 20_000;
  /** Fast-path DetailedDataResponse: 256KB summary = 65,536 estimated tokens (> MAX_TOKENS). */
  const bigRef = { detailId: 'detail_big', summary: { size: 262_144 } };
  const smallRef = { detailId: 'detail_small', summary: { size: 64 } };

  let manager: TokenBudgetManagerType;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@src/constants', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@src/constants')>()),
      TOKEN_BUDGET_MAX_TOKENS: MAX_TOKENS,
    }));
    const { TokenBudgetManager } = await import('@utils/TokenBudgetManager');
    manager = new TokenBudgetManager();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@src/constants');
  });

  it('does not recurse when the cleanup callback calls manualCleanup', () => {
    let callbackCalls = 0;
    manager.setExternalCleanup(() => {
      callbackCalls++;
      // Re-entrant manual cleanup must be a no-op while cleanup is running.
      manager.manualCleanup();
      manager.manualCleanup();
    });

    // Cross the 90% threshold.
    manager.recordToolCall('big', bigRef, bigRef);

    expect(callbackCalls).toBe(1);
    expect(manager.isTrackingEnabled()).toBe(true);
  });

  it('does not recurse when the cleanup callback records a tool call', () => {
    let callbackCalls = 0;
    manager.setExternalCleanup(() => {
      callbackCalls++;
      // Recording inside the callback must not trigger a nested cleanup.
      manager.recordToolCall('nested', bigRef, bigRef);
    });

    manager.recordToolCall('big', bigRef, bigRef);

    expect(callbackCalls).toBe(1);
  });

  it('applies a cooldown so a second oversized call right after cleanup does not re-trigger', () => {
    vi.useFakeTimers();
    let callbackCalls = 0;
    manager.setExternalCleanup(() => {
      callbackCalls++;
    });

    manager.recordToolCall('big', bigRef, bigRef);
    expect(callbackCalls).toBe(1);

    // Another oversized call within the cooldown window must not re-trigger.
    manager.recordToolCall('big', bigRef, bigRef);
    expect(callbackCalls).toBe(1);

    // Manual cleanup is always honored regardless of cooldown.
    manager.manualCleanup();
    expect(callbackCalls).toBe(2);

    vi.useRealTimers();
  });

  it('keeps recording tool calls while cleanup is running', () => {
    let callbackCalls = 0;
    manager.setExternalCleanup(() => {
      callbackCalls++;
      manager.recordToolCall('during-cleanup', smallRef, smallRef);
    });

    manager.recordToolCall('big', bigRef, bigRef);

    expect(callbackCalls).toBe(1);
    expect(manager.getStats().toolCallCount).toBeGreaterThanOrEqual(2);
  });
});
