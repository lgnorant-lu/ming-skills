import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { GraphQLToolHandlersRuntime } from '@server/domains/graphql/handlers.impl.core.runtime.replay';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: inspect the serialized body sent to page.evaluate
function requestBodyOf(mockCalls: any): any {
  const input = mockCalls[0][1] as { body: string };
  return JSON.parse(input.body);
}

describe('GraphQLToolHandlersRuntime (replay)', () => {
  const page = {
    evaluate: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setRequestInterception: vi.fn(),
    on: vi.fn(),
    url: vi.fn(() => withPath(TEST_URLS.root, 'app')),
  };
  const collector = {
    getActivePage: vi.fn(async () => page),
  } as any;

  let handlers: GraphQLToolHandlersRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    isSsrfTargetMock.mockResolvedValue(false);
    handlers = new GraphQLToolHandlersRuntime(collector);
  });

  // ── argument validation ─────────────────────────────────────────────

  describe('argument validation', () => {
    it('returns error when endpoint is missing', async () => {
      const response = await handlers.handleGraphqlReplay({
        query: 'query { ok }',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when endpoint is empty after trim', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: '   ',
        query: 'query { ok }',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: endpoint');
    });

    it('returns error when query is missing', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: query');
    });

    it('returns error when query is empty string', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: '   ',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: query');
    });

    it('returns error when query is not a string', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 42,
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Missing required argument: query');
    });
  });

  // ── endpoint validation ─────────────────────────────────────────────

  describe('endpoint validation', () => {
    it('returns error for invalid URL', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'not-valid',
        query: 'query { ok }',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Invalid endpoint URL');
    });

    it('returns error for SSRF target', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      const response = await handlers.handleGraphqlReplay({
        endpoint: 'http://169.254.169.254/graphql',
        query: 'query { ok }',
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('Blocked');
    });

    it('allows same-origin private endpoints in browser mode', async () => {
      isSsrfTargetMock.mockResolvedValueOnce(true);
      page.url.mockReturnValueOnce('http://127.0.0.1/app');
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '',
        responseJson: { data: { ok: true } },
        responseHeaders: { 'content-type': 'application/json' },
      });

      const response = await handlers.handleGraphqlReplay({
        endpoint: 'http://127.0.0.1/graphql',
        query: 'query { ok }',
        useBrowser: true,
      });
      const body = parseJson<any>(response);

      expect((response as any).isError).toBeUndefined();
      expect(body.success).toBe(true);
    });
  });

  // ── successful replay with JSON response ────────────────────────────

  describe('successful replay with JSON response', () => {
    it('returns parsed JSON response data', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{"data":{"user":{"name":"Alice"}}}',
        responseJson: { data: { user: { name: 'Alice' } } },
        responseHeaders: { 'content-type': 'application/json' },
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query GetUser { user { name } }',
          useBrowser: true,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.status).toBe(200);
      expect(body.statusText).toBe('OK');
      expect(body.response).toEqual({ data: { user: { name: 'Alice' } } });
      expect(body.responseTruncated).toBe(false);
      expect(body.responseHeaders).toEqual({ 'content-type': 'application/json' });
    });

    it('serializes variables into the request body', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query GetUser($id: ID!) { user(id: $id) { name } }',
        variables: { id: '123' },
        useBrowser: true,
      });

      expect(requestBodyOf(page.evaluate.mock.calls).variables).toEqual({ id: '123' });
    });

    it('defaults variables to empty object when not provided', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        useBrowser: true,
      });

      expect(requestBodyOf(page.evaluate.mock.calls).variables).toEqual({});
    });

    it('passes operationName into the body and echoes it in the response', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query GetUser { user { name } }',
          operationName: 'GetUser',
          useBrowser: true,
        }),
      );

      expect(requestBodyOf(page.evaluate.mock.calls).operationName).toBe('GetUser');
      expect(body.operationName).toBe('GetUser');
    });

    it('sets operationName to null when empty string', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          operationName: '   ',
          useBrowser: true,
        }),
      );

      expect(body.operationName).toBeNull();
    });

    it('passes custom headers through', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        headers: { Authorization: 'Bearer xyz' },
        useBrowser: true,
      });

      expect(page.evaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          headers: { Authorization: 'Bearer xyz' },
        }),
      );
    });
  });

  // ── APQ (persisted query) ───────────────────────────────────────────

  describe('Apollo persisted-query (APQ)', () => {
    it('adds extensions.persistedQuery to the single-op body', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: { data: { ok: true } },
        responseHeaders: {},
      });

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        persistedQuery: { sha256Hash: 'abc123', version: 1 },
        useBrowser: true,
      });

      const parsed = requestBodyOf(page.evaluate.mock.calls);
      expect(parsed.extensions.persistedQuery).toEqual({ sha256Hash: 'abc123', version: 1 });
      // query is still sent so the server can cache it on a miss
      expect(parsed.query).toBe('query { ok }');
    });

    it('defaults APQ version to 1 when omitted', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      });

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        persistedQuery: { sha256Hash: 'deadbeef' },
        useBrowser: true,
      });

      expect(requestBodyOf(page.evaluate.mock.calls).extensions.persistedQuery).toEqual({
        sha256Hash: 'deadbeef',
        version: 1,
      });
    });

    it('ignores a persistedQuery without a sha256Hash', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      });

      await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        persistedQuery: { version: 1 },
        useBrowser: true,
      });

      expect(requestBodyOf(page.evaluate.mock.calls).extensions).toBeUndefined();
    });
  });

  // ── batch replay ────────────────────────────────────────────────────

  describe('batch replay', () => {
    it('builds a JSON array body and reports batchSize', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '[]',
        responseJson: [{ data: { a: 1 } }, { data: { b: 2 } }],
        responseHeaders: {},
      });

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          batch: [{ query: 'query A { a }', variables: { x: 1 } }, { query: 'query B { b }' }],
          useBrowser: true,
        }),
      );

      const sent = requestBodyOf(page.evaluate.mock.calls);
      expect(Array.isArray(sent)).toBe(true);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toEqual({ query: 'query A { a }', variables: { x: 1 }, operationName: null });
      expect(sent[1]).toEqual({ query: 'query B { b }', variables: {}, operationName: null });
      expect(body.mode).toBe('batch');
      expect(body.batchSize).toBe(2);
    });

    it('does not require a top-level query in batch mode', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '[]',
        responseJson: [],
        responseHeaders: {},
      });

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          batch: [{ query: 'query { ok }' }],
          useBrowser: true,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.batchSize).toBe(1);
    });

    it('rejects a batch item missing a query', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        batch: [{ variables: { x: 1 } }],
        useBrowser: true,
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('non-empty query');
    });

    it('rejects non-object batch items', async () => {
      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        batch: ['not an object'],
        useBrowser: true,
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toContain('batch items must be objects');
    });
  });

  // ── GraphQL errors structuring ──────────────────────────────────────

  describe('GraphQL errors structuring', () => {
    it('surfaces a structured graphqlErrors array from a single-op response', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {
          data: { user: null },
          errors: [{ message: 'Not authorized', path: ['user'] }],
        },
        responseHeaders: {},
      });

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { user { name } }',
          useBrowser: true,
        }),
      );

      expect(body.hasGraphqlErrors).toBe(true);
      expect(body.graphqlErrors).toEqual([{ message: 'Not authorized', path: ['user'] }]);
    });

    it('reports hasGraphqlErrors=false when errors array is empty', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: { data: { ok: true }, errors: [] },
        responseHeaders: {},
      });

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.hasGraphqlErrors).toBe(false);
      expect(body.graphqlErrors).toEqual([]);
    });

    it('omits graphqlErrors when the response has no errors field', async () => {
      page.evaluate.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: { data: { ok: true } },
        responseHeaders: {},
      });

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.graphqlErrors).toBeUndefined();
      expect(body.hasGraphqlErrors).toBeUndefined();
    });
  });

  // ── response with text fallback ─────────────────────────────────────

  describe('text response fallback', () => {
    it('uses text preview when responseJson is null', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: 'This is plain text, not JSON',
        responseJson: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.responseFormat).toBe('text');
      expect(body.responsePreview).toBe('This is plain text, not JSON');
      expect(body.response).toBeUndefined();
    });
  });

  // ── response truncation ─────────────────────────────────────────────

  describe('response truncation', () => {
    it('truncates large JSON responses', async () => {
      const largeData = { data: 'x'.repeat(200000) };
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: JSON.stringify(largeData),
        responseJson: largeData,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.responseTruncated).toBe(true);
      expect(body.response).toBeUndefined();
      expect(body.responsePreview).toBeDefined();
    });

    it('truncates large text responses', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 200,
        statusText: 'OK',
        responseText: 'y'.repeat(200000),
        responseJson: null,
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.responseTruncated).toBe(true);
      expect(body.responseFormat).toBe('text');
    });
  });

  // ── error in response ───────────────────────────────────────────────

  describe('error handling', () => {
    it('includes error field from browser result', async () => {
      const browserResult: BrowserFetchResult = {
        ok: false,
        status: 0,
        statusText: 'FETCH_ERROR',
        responseText: '',
        responseJson: null,
        error: 'Network request failed',
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.success).toBe(false);
      expect(body.error).toBe('Network request failed');
    });

    it('catches unexpected exceptions', async () => {
      collector.getActivePage.mockRejectedValueOnce(new Error('Browser disconnected'));

      const response = await handlers.handleGraphqlReplay({
        endpoint: withPath(TEST_URLS.root, 'graphql'),
        query: 'query { ok }',
        useBrowser: true,
      });
      const body = parseJson<any>(response);
      expect((response as any).isError).toBe(true);
      expect(body.error).toBe('Browser disconnected');
    });

    it('handles empty responseHeaders gracefully', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.responseHeaders).toEqual({});
    });
  });

  // ── response metadata ───────────────────────────────────────────────

  describe('response metadata', () => {
    it('includes endpoint and status in response', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{}',
        responseJson: {},
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(body.endpoint).toBe(withPath(TEST_URLS.root, 'graphql'));
      expect(body.status).toBe(200);
      expect(body.statusText).toBe('OK');
      expect(body.mode).toBe('single');
    });

    it('includes responseLength for JSON', async () => {
      const browserResult: BrowserFetchResult = {
        ok: true,
        status: 200,
        statusText: 'OK',
        responseText: '{"data":true}',
        responseJson: { data: true },
        responseHeaders: {},
      };
      page.evaluate.mockResolvedValueOnce(browserResult);

      const body = parseJson<any>(
        await handlers.handleGraphqlReplay({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          query: 'query { ok }',
          useBrowser: true,
        }),
      );

      expect(typeof body.responseLength).toBe('number');
      expect(body.responseLength).toBeGreaterThan(0);
    });
  });
});
