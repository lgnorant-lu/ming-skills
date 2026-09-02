import { beforeEach, describe, expect, it, vi } from 'vitest';

const existsSyncMock = vi.fn();
const executablePathMock = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: any[]) => existsSyncMock(...args),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: {
    executablePath: (...args: any[]) => executablePathMock(...args),
  },
  executablePath: (...args: any[]) => executablePathMock(...args),
}));

async function loadModule() {
  return import('@utils/browserExecutable');
}

describe('browserExecutable utils', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.BROWSER_EXECUTABLE_PATH;
  });

  it('resolves from BROWSER_EXECUTABLE_PATH when file exists', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/browser-bin';
    existsSyncMock.mockImplementation((p: string) => p === '/browser-bin');

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBe('/browser-bin');
  });

  it('falls back to puppeteer executable path when env missing', async () => {
    executablePathMock.mockReturnValue('/managed-browser-bin');
    existsSyncMock.mockImplementation((p: string) => p === '/managed-browser-bin');

    const { findBrowserExecutableAsync } = await loadModule();
    expect(await findBrowserExecutableAsync()).toBe('/managed-browser-bin');
  });

  it('returns undefined when no executable is available', async () => {
    executablePathMock.mockReturnValue('/none');
    existsSyncMock.mockReturnValue(false);

    const { findBrowserExecutable } = await loadModule();
    expect(findBrowserExecutable()).toBeUndefined();
  });

  it('uses cache on repeated calls', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/cached-browser';
    existsSyncMock.mockImplementation((p: string) => p === '/cached-browser');

    const { findBrowserExecutable } = await loadModule();
    // Importing the module chain now also loads @src/config/env-bootstrap,
    // which walks up the directory tree calling existsSync() on candidate
    // package.json files to locate the project root. That's unrelated to the
    // caching behavior under test here, so clear those import-time calls
    // before asserting on the two find calls below.
    existsSyncMock.mockClear();

    expect(findBrowserExecutable()).toBe('/cached-browser');
    expect(findBrowserExecutable()).toBe('/cached-browser');
    expect(existsSyncMock).toHaveBeenCalledTimes(2);
  });

  it('clearBrowserPathCache forces re-resolution', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/first-browser';
    existsSyncMock.mockImplementation(
      (p: string) => p === '/first-browser' || p === '/second-browser',
    );

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/first-browser');

    process.env.BROWSER_EXECUTABLE_PATH = '/second-browser';
    mod.clearBrowserPathCache();
    expect(mod.findBrowserExecutable()).toBe('/second-browser');
  });

  it('re-resolves when cached path no longer exists', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/stale-browser';
    executablePathMock.mockReturnValue('/fresh-browser');
    existsSyncMock.mockReturnValueOnce(true).mockReturnValue(true);

    const mod = await loadModule();
    expect(mod.findBrowserExecutable()).toBe('/stale-browser');

    delete process.env.BROWSER_EXECUTABLE_PATH;
    mod.clearBrowserPathCache();
    expect(await mod.findBrowserExecutableAsync()).toBe('/fresh-browser');
  });

  it('returns cachedBrowserPath via getCachedBrowserPath', async () => {
    process.env.BROWSER_EXECUTABLE_PATH = '/cached-browser';
    existsSyncMock.mockImplementation((p: string) => p === '/cached-browser');

    const mod = await loadModule();
    mod.findBrowserExecutable();
    expect(mod.getCachedBrowserPath()).toBe('/cached-browser');
    mod.clearBrowserPathCache();
    expect(mod.getCachedBrowserPath()).toBeUndefined();
  });

  it('deduplicates concurrent async resolutions (single-flight)', async () => {
    executablePathMock.mockReturnValue('/managed-browser-bin');
    existsSyncMock.mockImplementation((p: string) => p === '/managed-browser-bin');

    const mod = await loadModule();
    const [first, second] = await Promise.all([
      mod.findBrowserExecutableAsync(),
      mod.findBrowserExecutableAsync(),
    ]);

    expect(first).toBe('/managed-browser-bin');
    expect(second).toBe('/managed-browser-bin');
    // The puppeteer probe must run only once despite two concurrent callers.
    expect(executablePathMock).toHaveBeenCalledTimes(1);
  });

  it('a failed puppeteer probe is retried on the next async call, not memoized', async () => {
    executablePathMock.mockReturnValueOnce('/none').mockReturnValue('/fresh-browser');
    existsSyncMock.mockImplementation((p: string) => p === '/fresh-browser');

    const mod = await loadModule();
    expect(await mod.findBrowserExecutableAsync()).toBeUndefined();
    // Second call re-probes instead of being stuck on the failed result.
    expect(await mod.findBrowserExecutableAsync()).toBe('/fresh-browser');
    expect(executablePathMock).toHaveBeenCalledTimes(2);
  });

  it('retries puppeteer after a transient import failure', async () => {
    // First probe throws (simulates a transient import failure)…
    executablePathMock.mockImplementationOnce(() => {
      throw new Error('Cannot find module rebrowser-puppeteer-core');
    });
    // …second probe succeeds.
    executablePathMock.mockReturnValue('/fresh-browser');
    existsSyncMock.mockImplementation((p: string) => p === '/fresh-browser');

    const mod = await loadModule();
    expect(await mod.findBrowserExecutableAsync()).toBeUndefined();
    expect(await mod.findBrowserExecutableAsync()).toBe('/fresh-browser');
  });
});
