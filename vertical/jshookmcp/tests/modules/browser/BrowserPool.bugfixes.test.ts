import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

const unifiedBrowserManagerState = vi.hoisted(() => ({
  instances: [] as any[],
  launchImpl: null as null | ((instance: any) => Promise<any>),
}));

vi.mock('@modules/browser/UnifiedBrowserManager', () => {
  class UnifiedBrowserManager {
    configForTest: any;
    private browser: any = { isConnected: vi.fn(() => true) };
    launch = vi.fn(async () => {
      if (unifiedBrowserManagerState.launchImpl) {
        return unifiedBrowserManagerState.launchImpl(this);
      }
      return this.browser;
    });
    close = vi.fn(async () => {});
    getBrowser = vi.fn(() => this.browser);
    constructor(config: any) {
      this.configForTest = config;
      unifiedBrowserManagerState.instances.push(this);
    }
  }
  return { UnifiedBrowserManager };
});

import { BrowserPool } from '@modules/browser/BrowserPool';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('BrowserPool bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unifiedBrowserManagerState.instances = [];
    unifiedBrowserManagerState.launchImpl = null;
  });

  it('coalesces concurrent acquires of the same profile into one launch', async () => {
    const gate = deferred<any>();
    unifiedBrowserManagerState.launchImpl = async (instance: any) => {
      await gate.promise;
      return (instance as any).browser;
    };

    const pool = new BrowserPool();
    const profile = { name: 'default' };

    const first = pool.acquire(profile);
    const second = pool.acquire(profile);
    gate.resolve(null);

    const [m1, m2] = await Promise.all([first, second]);
    expect(m1).toBe(m2);
    expect(unifiedBrowserManagerState.instances).toHaveLength(1);
    expect(pool.getStats().totalEntries).toBe(1);

    await pool.dispose();
  });

  it('does not store an entry when launch yields no browser instance', async () => {
    unifiedBrowserManagerState.launchImpl = async (instance: any) => {
      (instance as any).browser = null;
      return null;
    };

    const pool = new BrowserPool();
    await expect(pool.acquire({ name: 'broken' })).rejects.toThrow('no browser instance');

    expect(pool.getStats().totalEntries).toBe(0);
    await pool.dispose();
  });
});
