import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '@utils/network/fetch';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the fetch response on success and forwards init', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchWithTimeout('https://example.com', { method: 'POST' }, 1000);

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('normalizes a timeout abort into a descriptive error', async () => {
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithTimeout('https://example.com', {}, 10)).rejects.toThrow(
      /timed out after 10ms/,
    );
  });

  it('propagates a caller-supplied signal abort unchanged', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          reject(new DOMException('caller aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchWithTimeout('https://example.com', { signal: controller.signal }, 1000);
    controller.abort();

    await expect(promise).rejects.toThrow('caller aborted');
  });

  it('propagates non-timeout fetch failures unchanged', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithTimeout('https://example.com', {}, 1000)).rejects.toThrow(
      'connection refused',
    );
  });
});
