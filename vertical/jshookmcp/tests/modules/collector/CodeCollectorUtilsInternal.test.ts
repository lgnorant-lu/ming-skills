import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  collectPageMetadataImpl,
  getPerformanceMetricsImpl,
  navigateWithRetryImpl,
  shouldCollectUrlImpl,
} from '@modules/collector/CodeCollectorUtilsInternal';
import {
  E2E_DEFAULT_TARGET_URL,
  E2E_SPOOFED_TARGET_URL,
  TEST_URLS,
  withPath,
} from '@tests/shared/test-urls';

describe('CodeCollector utils internals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches urls against wildcard filter rules', () => {
    expect(shouldCollectUrlImpl(withPath(TEST_URLS.root, 'app.js'), ['*app.js'])).toBe(true);
    expect(shouldCollectUrlImpl(withPath(TEST_URLS.root, 'app.css'), ['*app.js'])).toBe(false);
    expect(shouldCollectUrlImpl(withPath(TEST_URLS.root, 'any'), [])).toBe(true);
  });

  it('treats dots in hostname rules as literal characters', () => {
    expect(
      shouldCollectUrlImpl(withPath(E2E_DEFAULT_TARGET_URL, 'app.js'), [E2E_DEFAULT_TARGET_URL]),
    ).toBe(true);
    expect(
      shouldCollectUrlImpl(withPath(E2E_SPOOFED_TARGET_URL, 'app.js'), [E2E_DEFAULT_TARGET_URL]),
    ).toBe(false);
  });

  it('retries navigation until it succeeds', async () => {
    vi.useFakeTimers();
    const goto = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce(undefined);

    const navigation = navigateWithRetryImpl({ goto } as any, TEST_URLS.root, {}, 2);
    await vi.advanceTimersByTimeAsync(1000);
    await navigation;

    expect(goto).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('collects performance metrics and page metadata with empty-object fallbacks', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValueOnce({ totalTime: 120 }).mockResolvedValueOnce({
        title: 'Example',
        url: TEST_URLS.root,
      }),
    };

    await expect(getPerformanceMetricsImpl(page as any)).resolves.toEqual({ totalTime: 120 });
    await expect(collectPageMetadataImpl(page as any)).resolves.toEqual({
      title: 'Example',
      url: TEST_URLS.root,
    });

    page.evaluate = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(getPerformanceMetricsImpl(page as any)).resolves.toEqual({});
    await expect(collectPageMetadataImpl(page as any)).resolves.toEqual({});
  });
});
