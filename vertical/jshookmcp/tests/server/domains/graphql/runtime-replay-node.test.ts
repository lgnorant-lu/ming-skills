/**
 * Regression tests for the Node-side (`useBrowser=false`) GraphQL replay path.
 *
 * Bug: after `JSON.parse(responseText)` failed, the handler still ran
 * `responseText = ''` ("Release raw text after parsing") and dropped the raw
 * body entirely — a non-JSON response (HTML error page, plain-text error)
 * came back with neither `response` nor `responseText`, silently losing the
 * only diagnostic content. The browser path already kept the raw text; the
 * Node path must behave identically.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersRuntime } from '@server/domains/graphql/handlers.impl.core.runtime.replay';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

function httpResponse(body: string, headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => body,
    headers: {
      forEach: (cb: (v: string, k: string) => void) => {
        for (const [k, v] of Object.entries(headers)) cb(v, k);
      },
    },
  };
}

describe('GraphQLToolHandlersRuntime — Node replay path (useBrowser=false)', () => {
  const page = { evaluate: vi.fn() };
  const collector = { getActivePage: vi.fn(async () => page) } as never;
  let handlers: GraphQLToolHandlersRuntime;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersRuntime(collector);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const endpoint = withPath(TEST_URLS.root, 'graphql');

  it('keeps the raw text when the response body is not JSON', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        httpResponse('<html><body>rate limited</body></html>', { 'content-type': 'text/html' }),
      ) as never;

    const response = await handlers.handleGraphqlReplay({
      endpoint,
      query: 'query { ok }',
      useBrowser: false,
    });
    const body = parseJson<Record<string, unknown>>(response);

    expect(body.success).toBe(true);
    expect(body.status).toBe(200);
    // The raw body must survive: it is the only diagnostic for non-JSON replies.
    expect(body.responseFormat).toBe('text');
    expect(body.responsePreview).toBe('<html><body>rate limited</body></html>');
    expect(body.responseLength).toBe('<html><body>rate limited</body></html>'.length);
    expect(body.response).toBeUndefined();
  });

  it('still parses JSON bodies into a structured response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      httpResponse('{"data":{"ok":true},"errors":[]}', {
        'content-type': 'application/json',
      }),
    ) as never;

    const response = await handlers.handleGraphqlReplay({
      endpoint,
      query: 'query { ok }',
      useBrowser: false,
    });
    const body = parseJson<Record<string, unknown>>(response);

    expect(body.success).toBe(true);
    expect(body.response).toEqual({ data: { ok: true }, errors: [] });
    expect(body.responseFormat).toBeUndefined();
    expect(body.hasGraphqlErrors).toBe(false);
  });

  it('reports fetch failures without a body instead of fabricating one', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused')) as never;

    const response = await handlers.handleGraphqlReplay({
      endpoint,
      query: 'query { ok }',
      useBrowser: false,
    });
    const body = parseJson<Record<string, unknown>>(response);

    expect(body.success).toBe(false);
    expect(body.status).toBe(0);
    expect(body.statusText).toBe('FETCH_ERROR');
    expect(body.error).toMatch(/connection refused/);
  });
});
