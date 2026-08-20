import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  findBrowserExecutableAsync: vi.fn(async () => undefined),
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutableAsync: state.findBrowserExecutableAsync,
}));

function createBrowser() {
  return {
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    on: vi.fn(),
    process: vi.fn(() => ({ pid: 12345 })),
  };
}

describe('BrowserLifecycleManager idle reclamation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes a jshook-launched browser after the idle timeout', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const disconnected = vi.fn();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      disconnected,
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;
    (manager as any).chromePid = 12345;

    manager.touch();
    await vi.advanceTimersByTimeAsync(100);

    expect(browser.close).toHaveBeenCalledOnce();
    expect(browser.disconnect).not.toHaveBeenCalled();
    expect(manager.getBrowser()).toBeNull();
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('disconnects rather than kills an externally attached browser', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;
    (manager as any).connectedToExistingBrowser = true;

    manager.touch();
    await vi.advanceTimersByTimeAsync(100);

    expect(browser.disconnect).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
  });

  it('resets the idle deadline when browser activity is observed', async () => {
    const { BrowserLifecycleManager } = await import('@modules/collector/BrowserLifecycleManager');
    const browser = createBrowser();
    const manager = new BrowserLifecycleManager(
      { headless: true, timeout: 30_000 } as any,
      { width: 1280, height: 720 },
      vi.fn(),
      { idleTimeoutMs: 100 },
    );
    (manager as any).browser = browser;

    manager.touch();
    await vi.advanceTimersByTimeAsync(75);
    manager.touch();
    await vi.advanceTimersByTimeAsync(75);
    expect(browser.close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    expect(browser.close).toHaveBeenCalledOnce();
  });
});
