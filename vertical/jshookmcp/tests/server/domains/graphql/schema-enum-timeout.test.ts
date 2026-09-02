import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

// The abort timeout for postGraphqlJson comes from the env-configurable
// GRAPHQL_REPLAY_FETCH_TIMEOUT_MS constant (read at module load), so the env
// must be stubbed before the dynamic import below. Keep this file free of
// static server-module imports.
describe('schema-enum.helpers postGraphqlJson timeout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('uses GRAPHQL_REPLAY_FETCH_TIMEOUT_MS from env as its abort timeout', async () => {
    vi.stubEnv('GRAPHQL_REPLAY_FETCH_TIMEOUT_MS', '50');
    vi.resetModules();
    const { postGraphqlJson } =
      await import('@server/domains/graphql/handlers/schema-enum.helpers');

    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal?: AbortSignal }): Promise<never> => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        });
      }),
    );

    const start = Date.now();
    const result = await postGraphqlJson(
      withPath(TEST_URLS.root, 'graphql'),
      {},
      { query: '{ x }' },
    );
    const elapsed = Date.now() - start;

    expect(signal?.aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(result).toMatchObject({ ok: false, status: 0, statusText: 'FETCH_ERROR' });
    expect(result.error).toBe('Aborted');
  });
});
