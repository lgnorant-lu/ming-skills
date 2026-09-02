import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

import {
  buildFetchInterceptorCode,
  buildXHRInterceptorCode,
  CLEAR_INJECTED_BUFFERS_EXPRESSION,
  RESET_INJECTED_INTERCEPTORS_EXPRESSION,
} from '@modules/monitor/NetworkMonitor.interceptors';

describe('NetworkMonitor interceptors', () => {
  it('builds XHR interceptor code with buffer limits and request capture hooks', () => {
    const code = buildXHRInterceptorCode(25);

    expect(code).toContain('window.__xhrInterceptorInstalled');
    expect(code).toContain('window.XMLHttpRequest = function()');
    expect(code).toContain('xhrRequests.length > 25');
    expect(code).toContain('window.__getXHRRequests = function()');
  });

  it('builds fetch interceptor code with localStorage persistence and limit enforcement', () => {
    const code = buildFetchInterceptorCode(10);

    expect(code).toContain('window.__fetchInterceptorInstalled');
    expect(code).toContain('fetchRequests.length > 10');
    expect(code).toContain("localStorage.setItem('__capturedAPIs'");
    expect(code).toContain('window.__getFetchRequests = function()');
  });

  it('exports expressions for clearing buffers and restoring original interceptors', () => {
    expect(CLEAR_INJECTED_BUFFERS_EXPRESSION).toContain('xhrCleared');
    expect(CLEAR_INJECTED_BUFFERS_EXPRESSION).toContain('fetchCleared');
    expect(RESET_INJECTED_INTERCEPTORS_EXPRESSION).toContain(
      'window.XMLHttpRequest = window.__originalXMLHttpRequestForHook',
    );
    expect(RESET_INJECTED_INTERCEPTORS_EXPRESSION).toContain(
      'window.fetch = window.__originalFetchForHook',
    );
  });
});

describe('fetch interceptor in-page behaviour', () => {
  const PREVIEW_LIMIT = 2048;

  function runInterceptorCode(
    code: string,
    mockFetch: (url: string) => Promise<unknown>,
    fakeSetTimeout: (fn: () => void) => number,
  ): {
    windowObj: { fetch: (url: string) => Promise<unknown>; __fetchRequests: unknown[] };
    fakeLocalStorage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
  } {
    const fakeLocalStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const windowObj: { fetch: (url: string) => Promise<unknown>; __fetchRequests: unknown[] } = {
      fetch: mockFetch,
      __fetchRequests: [],
    };
    const sandbox = {
      window: windowObj,
      localStorage: fakeLocalStorage,
      console: { log: () => {}, error: () => {} },
      setTimeout: fakeSetTimeout,
    };
    runInNewContext(code, sandbox);
    return { windowObj, fakeLocalStorage };
  }

  it('stores a truncated response preview instead of the full body (b2-1)', async () => {
    const bigText = 'x'.repeat(5000);
    const mockResponse = { status: 200, clone: () => mockResponse, text: async () => bigText };
    const mockFetch = vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue(mockResponse);

    const { windowObj } = runInterceptorCode(buildFetchInterceptorCode(10), mockFetch, () => 0);

    const result = await windowObj.fetch('https://example.com/data');
    expect(result).toBe(mockResponse);

    const captured = windowObj.__fetchRequests as Array<Record<string, unknown>>;
    expect(captured).toHaveLength(1);
    expect(captured[0]!.responsePreview).toHaveLength(PREVIEW_LIMIT);
    expect(captured[0]!.responseTruncated).toBe(true);
    expect(captured[0]!.responseLength).toBe(5000);
    // BEHAVIOR CHANGE: the full body is no longer retained in-page.
    expect(captured[0]!.response).toBeUndefined();
  });

  it('throttles __capturedAPIs localStorage writes to one batched flush (b2-2)', async () => {
    const mockResponse = { status: 200, clone: () => mockResponse, text: async () => 'ok' };
    const mockFetch = vi.fn<(url: string) => Promise<unknown>>().mockResolvedValue(mockResponse);

    let scheduledFlush: (() => void) | null = null;
    // fake timer: capture the single scheduled flush callback instead of waiting 1s
    const fakeSetTimeout = (fn: () => void): number => {
      scheduledFlush = fn;
      return 1;
    };

    const { windowObj, fakeLocalStorage } = runInterceptorCode(
      buildFetchInterceptorCode(10),
      mockFetch,
      fakeSetTimeout,
    );

    for (let i = 0; i < 5; i += 1) {
      await windowObj.fetch(`https://example.com/${i}`);
    }

    // No synchronous write happens before the throttle timer fires.
    expect(fakeLocalStorage.setItem).not.toHaveBeenCalled();
    expect(scheduledFlush).toBeTypeOf('function');

    // Fire the throttled flush once and assert a single batched write.
    scheduledFlush!();
    expect(fakeLocalStorage.setItem).toHaveBeenCalledTimes(1);
    expect(fakeLocalStorage.setItem).toHaveBeenCalledWith('__capturedAPIs', expect.any(String));

    const written = JSON.parse(fakeLocalStorage.setItem.mock.calls[0]![1] as string) as unknown[];
    expect(written).toHaveLength(5);
  });
});
