/**
 * CommandQueue — retry-delay regression tests.
 *
 * Regression for: the retry rate-limit used `setTimeout(() => {}, retryDelay)`
 * which never actually delays anything — a retry was re-attempted immediately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandQueue } from '@server/webhook/CommandQueue.impl';

describe('CommandQueue retry delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits retryDelay before the next retry becomes visible to the caller', async () => {
    const queue = new CommandQueue({ maxRetries: 3, retryDelay: 500, processTimeout: 60_000 });
    const id = queue.enqueue({ payload: {} });

    let rejection: unknown;
    const attempt = queue
      .process(id, async () => {
        throw new Error('handler failure');
      })
      .catch((err) => {
        rejection = err;
      });

    // Handler failed immediately, but the retry rejection must not surface
    // until the retryDelay has elapsed.
    await vi.advanceTimersByTimeAsync(499);
    expect(rejection).toBeUndefined();

    await vi.advanceTimersByTimeAsync(2);
    await attempt;
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe('handler failure');
    expect(queue.getStatus(id)).toBe('pending');
  });

  it('fails immediately when retryDelay is 0', async () => {
    const queue = new CommandQueue({ maxRetries: 3, retryDelay: 0, processTimeout: 60_000 });
    const id = queue.enqueue({ payload: {} });

    await expect(
      queue.process(id, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
  });

  it('does not delay when the final retry budget is exhausted', async () => {
    const queue = new CommandQueue({ maxRetries: 1, retryDelay: 500, processTimeout: 60_000 });
    const id = queue.enqueue({ payload: {} });

    await expect(
      queue.process(id, async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(queue.getStatus(id)).toBe('failed');
  });
});
