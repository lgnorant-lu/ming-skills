import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

function createPage(overrides: Record<string, any> = {}) {
  return {
    evaluate: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('test')),
    url: vi.fn(() => buildTestUrl('test', { scheme: 'http', suffix: 'local', path: 'page' })),
    ...overrides,
  };
}

function createCollector(page: unknown) {
  return {
    getActivePage: vi.fn(async () => page),
  } as any;
}

async function loadModule() {
  vi.resetModules();
  return await import('@server/domains/browser/handlers/captcha-solver');
}

describe('captcha-solver runtime coverage', () => {
  let originalEnv: Record<string, string | undefined>;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = {
      CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY,
      CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER,
      CAPTCHA_SOLVER_BASE_URL: process.env.CAPTCHA_SOLVER_BASE_URL,
      CAPTCHA_POLL_INTERVAL_MS: process.env.CAPTCHA_POLL_INTERVAL_MS,
    };
    originalFetch = (globalThis as any).fetch;
    delete process.env.CAPTCHA_API_KEY;
    delete process.env.CAPTCHA_PROVIDER;
    process.env.CAPTCHA_SOLVER_BASE_URL = buildTestUrl('solver', { suffix: 'example', path: '/' });
    process.env.CAPTCHA_POLL_INTERVAL_MS = '0';
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete (process.env as any)[key];
      else (process.env as any)[key] = value;
    }
    (globalThis as any).fetch = originalFetch;
  });

  it('solves an image captcha through the external service path', async () => {
    vi.useFakeTimers();
    const { handleCaptchaVisionSolve } = await loadModule();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/in.php')) {
        return {
          json: async () => ({ status: 1, request: 'task-1' }),
        } as any;
      }
      if (url.includes('/res.php')) {
        return {
          json: async () => ({ status: 1, request: 'captcha-token-123' }),
        } as any;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const page = createPage();
    const collector = createCollector(page);
    const promise = handleCaptchaVisionSolve(
      {
        mode: 'external_service',
        apiKey: 'test-key',
        challengeType: 'image',
        imageBase64: 'dGVzdA==',
        timeoutMs: 6_000,
        maxRetries: 0,
      },
      collector,
    );
    await vi.runAllTimersAsync();
    const parsed = parseJson<any>(await promise);

    expect(parsed.success).toBe(true);
    expect(parsed.token).toBe('captcha-token-123');
    expect(parsed.challengeType).toBe('image');
    expect(parsed.attempt).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('captures a widget token in hook mode', async () => {
    const { handleWidgetChallengeSolve } = await loadModule();
    const page = createPage({
      evaluate: vi.fn(async (pageFunction: any, hookTimeoutMs: number, callbackName: string) => {
        const prevWindow = (globalThis as any).window;
        (globalThis as any).window = {
          [callbackName]: vi.fn(),
        };
        try {
          const promise = pageFunction(hookTimeoutMs, callbackName);
          (globalThis as any).window[callbackName]('hook-token');
          return await promise;
        } finally {
          (globalThis as any).window = prevWindow;
        }
      }),
    });
    const collector = createCollector(page);

    const parsed = parseJson<any>(
      await handleWidgetChallengeSolve(
        {
          mode: 'hook',
          siteKey: 'site-key-123',
          callbackName: 'captchaDone',
        },
        collector,
      ),
    );

    expect(parsed.success).toBe(true);
    expect(parsed.token).toBe('hook-token');
    expect(parsed.method).toBe('hook');
  });

  it('injects a solved widget token when requested', async () => {
    vi.useFakeTimers();
    const { handleWidgetChallengeSolve } = await loadModule();
    let injectedInputValue = '';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/in.php')) {
        return {
          json: async () => ({ status: 1, request: 'task-2' }),
        } as any;
      }
      if (url.includes('/res.php')) {
        return {
          json: async () => ({ status: 1, request: 'widget-token-456' }),
        } as any;
      }
      throw new Error(`Unexpected fetch url: ${url}`);
    });
    (globalThis as any).fetch = fetchMock;

    const page = createPage({
      evaluate: vi.fn(
        async (
          pageFunction: any,
          token: string,
          injectionConfig: { responseSelector?: string; callbackName?: string },
        ) => {
          const prevDocument = (globalThis as any).document;
          const prevWindow = (globalThis as any).window;
          const prevHtmlInputElement = (globalThis as any).HTMLInputElement;
          const prevHtmlTextAreaElement = (globalThis as any).HTMLTextAreaElement;
          const prevHtmlSelectElement = (globalThis as any).HTMLSelectElement;
          const prevHtmlElement = (globalThis as any).HTMLElement;
          const prevEvent = (globalThis as any).Event;
          const prevCustomEvent = (globalThis as any).CustomEvent;
          class MockElement {
            value = '';
            dispatchEvent = vi.fn();
            setAttribute = vi.fn();
          }
          class MockInputElement extends MockElement {}
          class MockTextAreaElement extends MockElement {}
          class MockSelectElement extends MockElement {}
          const input = new MockInputElement();
          (globalThis as any).document = {
            querySelector: vi.fn((selector: string) =>
              selector === injectionConfig.responseSelector ? input : null,
            ),
          };
          (globalThis as any).window = {
            [injectionConfig.callbackName ?? '']: vi.fn(),
          };
          (globalThis as any).HTMLInputElement = MockInputElement;
          (globalThis as any).HTMLTextAreaElement = MockTextAreaElement;
          (globalThis as any).HTMLSelectElement = MockSelectElement;
          (globalThis as any).HTMLElement = MockElement;
          (globalThis as any).Event = function MockEvent() {};
          (globalThis as any).CustomEvent = function MockCustomEvent() {};
          try {
            const result = await pageFunction(token, injectionConfig);
            injectedInputValue = input.value;
            return result;
          } finally {
            (globalThis as any).document = prevDocument;
            (globalThis as any).window = prevWindow;
            (globalThis as any).HTMLInputElement = prevHtmlInputElement;
            (globalThis as any).HTMLTextAreaElement = prevHtmlTextAreaElement;
            (globalThis as any).HTMLSelectElement = prevHtmlSelectElement;
            (globalThis as any).HTMLElement = prevHtmlElement;
            (globalThis as any).Event = prevEvent;
            (globalThis as any).CustomEvent = prevCustomEvent;
          }
        },
      ),
    });
    const collector = createCollector(page);

    const promise = handleWidgetChallengeSolve(
      {
        mode: 'external_service',
        apiKey: 'test-key',
        siteKey: 'site-key-456',
        taskKind: 'hcaptcha',
        responseSelector: '#captcha-response',
        callbackName: 'onCaptchaSolved',
        timeoutMs: 6_000,
      },
      collector,
    );
    await vi.runAllTimersAsync();
    const parsed = parseJson<any>(await promise);

    expect(parsed.success).toBe(true);
    expect(parsed.token).toBe('widget-token-456');
    expect(parsed.injected).toBe(true);
    expect(injectedInputValue).toBe('widget-token-456');
  });
});
