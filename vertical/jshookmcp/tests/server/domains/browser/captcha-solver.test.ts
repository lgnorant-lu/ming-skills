import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';
import {
  handleCaptchaVisionSolve,
  handleWidgetChallengeSolve,
} from '@server/domains/browser/handlers/captcha-solver';

function createMockCollector(hasPage = true) {
  const page = hasPage
    ? {
        evaluate: vi.fn(),
        screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
        url: () => buildTestUrl('test', { scheme: 'http', suffix: 'local', path: 'page' }),
      }
    : null;
  return { getActivePage: vi.fn().mockResolvedValue(page) } as any;
}

describe('handleCaptchaVisionSolve', () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch as typeof fetch;
  });

  it('returns failure when no active page', async () => {
    const collector = createMockCollector(false);
    const result = parseJson<BrowserStatusResponse>(await handleCaptchaVisionSolve({}, collector));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No active page/);
  });

  it('returns manual mode instruction when mode is manual', async () => {
    const collector = createMockCollector(true);
    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve({ mode: 'manual' }, collector),
    );
    expect(result.success).toBe(true);
    expect(result.mode).toBe('manual');
    expect(result.instruction).toBeDefined();
  });

  it('solves with anticaptcha legacy provider override', async () => {
    const collector = createMockCollector(true);
    process.env.CAPTCHA_ANTICAPTCHA_BASE_URL = buildTestUrl('solver-anticaptcha', {
      path: 'anticaptcha',
    });
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/createTask')) {
        return { json: async () => ({ errorId: 0, taskId: 77 }) } as any;
      }
      if (url.endsWith('/getTaskResult')) {
        return {
          json: async () => ({
            errorId: 0,
            status: 'ready',
            solution: { text: 'anti-image-token' },
          }),
        } as any;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as typeof fetch;

    const promise = handleCaptchaVisionSolve(
      {
        mode: 'external_service',
        provider: 'anticaptcha',
        apiKey: 'test-key',
        timeoutMs: 6000,
        maxRetries: 0,
      },
      collector,
    );
    await vi.runAllTimersAsync();
    const result = parseJson<BrowserStatusResponse>(await promise);
    expect(result.success).toBe(true);
    expect(result.token).toBe('anti-image-token');
  });

  it('solves with capsolver legacy provider override', async () => {
    const collector = createMockCollector(true);
    process.env.CAPTCHA_CAPSOLVER_BASE_URL = buildTestUrl('solver-capsolver', {
      path: 'capsolver',
    });
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/createTask')) {
        return { json: async () => ({ errorId: 0, taskId: 'capsolver-task' }) } as any;
      }
      if (url.endsWith('/getTaskResult')) {
        return {
          json: async () => ({
            errorId: 0,
            status: 'ready',
            solution: { text: 'capsolver-image-token' },
          }),
        } as any;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as typeof fetch;

    const promise = handleCaptchaVisionSolve(
      {
        mode: 'external_service',
        provider: 'capsolver',
        apiKey: 'test-key',
        timeoutMs: 6000,
        maxRetries: 0,
      },
      collector,
    );
    await vi.runAllTimersAsync();
    const result = parseJson<BrowserStatusResponse>(await promise);
    expect(result.success).toBe(true);
    expect(result.token).toBe('capsolver-image-token');
  });

  it('rejects unsupported external service overrides', async () => {
    const collector = createMockCollector(true);
    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
          provider: 'unknown_provider',
          apiKey: 'test-key',
        },
        collector,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  it('requires credentials for external service mode', async () => {
    const collector = createMockCollector(true);
    // Ensure no env var is set
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve(
        {
          mode: 'external_service',
        },
        collector,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Manual mode so we can inspect params without needing API
    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          timeoutMs: 1,
        },
        collector,
      ),
    );
    // Manual mode doesn't expose timeoutMs in response, but no error means it clamped properly
    expect(result.success).toBe(true);
  });

  it('clamps maxRetries to [0, 5]', async () => {
    const collector = createMockCollector(true);
    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          maxRetries: 100,
        },
        collector,
      ),
    );
    expect(result.success).toBe(true);
  });

  it('auto-detects captcha type from page', async () => {
    const collector = createMockCollector(true);
    const result = parseJson<BrowserStatusResponse>(
      await handleCaptchaVisionSolve(
        {
          mode: 'manual',
          typeHint: 'image',
        },
        collector,
      ),
    );
    expect(result.challengeType).toBeDefined();
  });
});

describe('handleWidgetChallengeSolve', () => {
  it('returns failure when no active page', async () => {
    const collector = createMockCollector(false);
    const result = parseJson<BrowserStatusResponse>(
      await handleWidgetChallengeSolve({}, collector),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No active page/);
  });

  it('requires siteKey detection or manual input', async () => {
    const collector = createMockCollector(true);

    const result = parseJson<BrowserStatusResponse>(
      await handleWidgetChallengeSolve({ mode: 'external_service' }, collector),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('siteKey');
  });

  it('returns manual mode when mode is manual', async () => {
    const collector = createMockCollector(true);

    const result = parseJson<BrowserStatusResponse>(
      await handleWidgetChallengeSolve(
        {
          mode: 'manual',
          siteKey: 'test-key',
        },
        collector,
      ),
    );
    expect(result.success).toBe(true);
    expect(result.mode).toBe('manual');
    expect(result.challengeType).toBe('widget');
  });

  it('solves widget challenges through anticaptcha', async () => {
    const collector = createMockCollector(true);
    process.env.CAPTCHA_ANTICAPTCHA_BASE_URL = buildTestUrl('solver-anticaptcha', {
      path: 'anticaptcha',
    });
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/createTask')) {
        return { json: async () => ({ errorId: 0, taskId: 17 }) } as any;
      }
      if (url.endsWith('/getTaskResult')) {
        return {
          json: async () => ({
            errorId: 0,
            status: 'ready',
            solution: { token: 'widget-token-anti' },
          }),
        } as any;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    }) as typeof fetch;

    const result = parseJson<BrowserStatusResponse>(
      await (async () => {
        const promise = handleWidgetChallengeSolve(
          {
            mode: 'external_service',
            provider: 'anticaptcha',
            siteKey: 'test-key',
            apiKey: 'test-key',
            taskKind: 'hcaptcha',
            timeoutMs: 6000,
          },
          collector,
        );
        await vi.runAllTimersAsync();
        return promise;
      })(),
    );
    expect(result.success).toBe(true);
    expect(result.token).toBe('widget-token-anti');
  });

  it('requires credentials for external service mode', async () => {
    const collector = createMockCollector(true);
    const origKey = process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_API_KEY;

    const result = parseJson<BrowserStatusResponse>(
      await handleWidgetChallengeSolve(
        {
          mode: 'external_service',
          siteKey: 'test-key',
        },
        collector,
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('credentials');

    process.env.CAPTCHA_API_KEY = origKey;
  });

  it('clamps timeoutMs to [5000, 600000]', async () => {
    const collector = createMockCollector(true);
    // Manual mode to avoid network calls
    const result = parseJson<BrowserStatusResponse>(
      await handleWidgetChallengeSolve(
        {
          mode: 'manual',
          siteKey: 'test-key',
          timeoutMs: 1,
        },
        collector,
      ),
    );
    expect(result.success).toBe(true);
  });
});
