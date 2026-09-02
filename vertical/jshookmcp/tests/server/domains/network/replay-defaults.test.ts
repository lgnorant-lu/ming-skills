/**
 * Locks replayRequest default limits to the @src/constants env-backed values.
 *
 * regression guard: if someone re-hardcodes the timeout / max-body defaults as
 * literals in replay.ts (they were 30_000 / 512_000 while the constants module
 * already defined NETWORK_REPLAY_TIMEOUT_MS / NETWORK_REPLAY_MAX_BODY_BYTES
 * with the same values but zero references), the sentry values below stop
 * flowing through and these tests go red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();

vi.mock('node:dns/promises', () => ({
  lookup: (...args: any[]) => lookupMock(...args),
}));

vi.mock('@src/constants', () => ({
  NETWORK_REPLAY_MAX_BODY_BYTES: 42,
  NETWORK_REPLAY_TIMEOUT_MS: 42,
  NETWORK_REPLAY_MAX_REDIRECTS: 5,
}));

import { replayRequest } from '@server/domains/network/replay';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('replayRequest default limits come from @src/constants', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    lookupMock.mockResolvedValue({ address: '8.8.8.8', family: 4 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('default maxBodyBytes is NETWORK_REPLAY_MAX_BODY_BYTES (sentry 42 truncates a 100-byte body)', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(100), { status: 200 }));

    const result = await replayRequest(
      {
        url: withPath(TEST_URLS.root, 'api'),
        method: 'GET',
        headers: {},
      },
      { requestId: 'r-defaults-maxbody', dryRun: false },
    );

    const live = result as { bodyTruncated: boolean; body: string };
    expect(live.bodyTruncated).toBe(true);
    expect(live.body.length).toBe(42);
  });

  it('default timeout is NETWORK_REPLAY_TIMEOUT_MS (sentry 42 aborts instead of waiting 30s)', async () => {
    // A mock fetch that never resolves on its own but honors the abort signal —
    // with the literal 30_000 regression the test would hang past the suite
    // timeout instead of failing fast on the sentry value.
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

    await expect(
      replayRequest(
        {
          url: withPath(TEST_URLS.root, 'api'),
          method: 'GET',
          headers: {},
        },
        { requestId: 'r-defaults-timeout', dryRun: false },
      ),
    ).rejects.toThrow(/aborted/i);
  });
});
