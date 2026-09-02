import { afterEach, describe, expect, it, vi } from 'vitest';

const loadConcurrencyModule = async () => {
  vi.resetModules();
  return import('@utils/concurrency');
};

describe('concurrency utilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('ioLimit runs a task and returns its result', async () => {
    process.env.jshook_IO_CONCURRENCY = '2';
    const { ioLimit } = await loadConcurrencyModule();
    await expect(ioLimit(async () => 123)).resolves.toBe(123);
  });

  it('ioLimit enforces configured max parallelism', async () => {
    process.env.jshook_IO_CONCURRENCY = '2';
    const { ioLimit } = await loadConcurrencyModule();

    let running = 0;
    let maxRunning = 0;
    const tasks = Array.from({ length: 6 }, (_, idx) =>
      ioLimit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        running--;
        return idx;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('prefers the canonical uppercase concurrency setting over the legacy name', async () => {
    process.env.JSHOOK_IO_CONCURRENCY = '1';
    process.env.jshook_IO_CONCURRENCY = '3';
    const { ioLimit } = await loadConcurrencyModule();

    let running = 0;
    let maxRunning = 0;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        ioLimit(async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 10));
          running -= 1;
        }),
      ),
    );

    expect(maxRunning).toBe(1);
  });

  it('cpuLimit can be forced to run sequentially', async () => {
    process.env.jshook_CPU_CONCURRENCY = '1';
    const { cpuLimit } = await loadConcurrencyModule();

    const order: string[] = [];
    const tasks = ['a', 'b', 'c'].map((id) =>
      cpuLimit(async () => {
        order.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`end-${id}`);
        return id;
      }),
    );
    await Promise.all(tasks);

    expect(order).toEqual(['start-a', 'end-a', 'start-b', 'end-b', 'start-c', 'end-c']);
  });

  it('cdpLimit propagates task failures', async () => {
    process.env.jshook_CDP_CONCURRENCY = '2';
    const { cdpLimit } = await loadConcurrencyModule();
    await expect(
      cdpLimit(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('falls back to the default for zero concurrency instead of crashing module load', async () => {
    // A raw parseInt('0') passed `concurrency < 1` and blew up the whole
    // module (and the server) at import time. Now it falls back to the default.
    process.env.jshook_IO_CONCURRENCY = '0';
    const { ioLimit } = await loadConcurrencyModule();
    await expect(ioLimit(async () => 42)).resolves.toBe(42);
  });

  it('falls back for non-numeric concurrency instead of deadlocking the limiter', async () => {
    // parseInt('abc') is NaN; `activeCount < NaN` is always false so every
    // task stayed queued forever. The limiter must degrade to the default.
    process.env.jshook_IO_CONCURRENCY = 'abc';
    const { ioLimit } = await loadConcurrencyModule();

    const tasks = Array.from({ length: 8 }, (_, idx) => ioLimit(async () => idx));
    await expect(Promise.all(tasks)).resolves.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('falls back for fractional concurrency values', async () => {
    process.env.jshook_CPU_CONCURRENCY = '2.5';
    const { cpuLimit } = await loadConcurrencyModule();
    await expect(cpuLimit(async () => 'ok')).resolves.toBe('ok');
  });
});
