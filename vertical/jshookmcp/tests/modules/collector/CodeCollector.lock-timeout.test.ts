import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PuppeteerConfig } from '@internal-types/index';
import { CodeCollector } from '@modules/collector/CodeCollector';
import { TEST_URLS } from '@tests/shared/test-urls';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  connect: vi.fn(),
  findBrowserExecutable: vi.fn(),
  connectPlaywrightCdpFallback: vi.fn(),
  collectInnerImpl: vi.fn(),
  shouldCollectUrlImpl: vi.fn(),
  navigateWithRetryImpl: vi.fn(),
  getPerformanceMetricsImpl: vi.fn(),
  collectPageMetadataImpl: vi.fn(),
  calculatePriorityScore: vi.fn(),
}));

vi.mock('rebrowser-puppeteer-core', () => ({
  default: { launch: mocks.launch, connect: mocks.connect },
  launch: mocks.launch,
  connect: mocks.connect,
}));

vi.mock('@utils/browserExecutable', () => ({
  findBrowserExecutableAsync: mocks.findBrowserExecutable,
}));

vi.mock('@modules/collector/playwright-cdp-fallback', () => ({
  connectPlaywrightCdpFallback: mocks.connectPlaywrightCdpFallback,
}));

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@modules/collector/CodeCollectorCollectInternal', () => ({
  collectInnerImpl: mocks.collectInnerImpl,
}));

vi.mock('@modules/collector/CodeCollectorUtilsInternal', () => ({
  shouldCollectUrlImpl: mocks.shouldCollectUrlImpl,
  navigateWithRetryImpl: mocks.navigateWithRetryImpl,
  getPerformanceMetricsImpl: mocks.getPerformanceMetricsImpl,
  collectPageMetadataImpl: mocks.collectPageMetadataImpl,
}));

vi.mock('@modules/collector/PageScriptCollectors', () => ({
  calculatePriorityScore: mocks.calculatePriorityScore,
}));

describe('CodeCollector collect lock timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    process.env.JSHOOK_CONNECT_TIMEOUT_MS = '1000';
    mocks.findBrowserExecutable.mockResolvedValue(undefined);
    mocks.connectPlaywrightCdpFallback.mockRejectedValue(new Error('fallback unavailable'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JSHOOK_CONNECT_TIMEOUT_MS;
  });

  it('throws PrerequisiteError when a hung predecessor holds the collect lock', async () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

    // Predecessor collect() that never settles — holds the lock forever.
    mocks.collectInnerImpl.mockImplementation(() => new Promise(() => {}));
    const hungCollect = collector.collect({ url: TEST_URLS.root } as any);
    await vi.advanceTimersByTimeAsync(0);

    const waitingCollect = collector.collect({ url: TEST_URLS.root } as any);
    const assertion = expect(waitingCollect).rejects.toThrow(
      /Timed out after 1000ms waiting for a concurrent collect/,
    );

    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    void hungCollect;
  });

  it('does not time out when the predecessor finishes in time', async () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

    let releaseFirst!: (v: unknown) => void;
    mocks.collectInnerImpl.mockImplementation(
      () => new Promise((resolve) => (releaseFirst = resolve)),
    );
    const firstCollect = collector.collect({ url: TEST_URLS.root } as any);
    await vi.advanceTimersByTimeAsync(0);

    // The once-result must be queued BEFORE the second collect calls
    // collectInner — otherwise it falls into the hanging implementation.
    mocks.collectInnerImpl.mockResolvedValueOnce({ manifest: { second: true } } as any);
    const secondCollect = collector.collect({ url: TEST_URLS.root } as any);
    // Predecessor resolves before the 1000ms timeout elapses.
    await vi.advanceTimersByTimeAsync(500);
    releaseFirst({ manifest: { ok: true } } as any);
    await vi.advanceTimersByTimeAsync(0);

    await expect(secondCollect).resolves.toEqual({ manifest: { second: true } });
    await expect(firstCollect).resolves.toEqual({ manifest: { ok: true } });
  });

  it('still ignores predecessor failures while waiting', async () => {
    const collector = new CodeCollector({ headless: true, timeout: 1000 } as PuppeteerConfig);

    mocks.collectInnerImpl.mockImplementation(() => Promise.reject(new Error('boom')));
    const firstCollect = collector.collect({ url: TEST_URLS.root } as any);
    // Attach the rejection handler BEFORE advancing timers: the rejection
    // lands during advanceTimersByTimeAsync's microtask flush, and a handler
    // attached only after it returns would be flagged as an unhandled
    // rejection by Node.
    const firstAssertion = expect(firstCollect).rejects.toThrow('boom');
    await vi.advanceTimersByTimeAsync(0);
    await firstAssertion;

    // Lock was released despite the failure — the next collect must not wait
    // forever or inherit the predecessor error.
    mocks.collectInnerImpl.mockResolvedValueOnce({ manifest: { after: true } } as any);
    const second = collector.collect({ url: TEST_URLS.root } as any);
    await vi.advanceTimersByTimeAsync(0);
    await expect(second).resolves.toEqual({ manifest: { after: true } });
  });
});
