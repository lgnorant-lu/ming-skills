import { beforeEach, describe, expect, it, vi } from 'vitest';

const isSsrfTargetMock = vi.fn(async () => false);

vi.mock('@src/server/domains/network/replay', () => ({
  isSsrfTarget: vi.fn(async () => isSsrfTargetMock()),
}));

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { GraphQLToolHandlers } from '@server/domains/graphql/handlers';
import { graphqlTools } from '@server/domains/graphql/definitions';
import manifest from '@server/domains/graphql/manifest';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('graphql_enum_schema', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: GraphQLToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new GraphQLToolHandlers(collector);
  });

  it('enumerates root field suggestions from GraphQL errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message:
                  'Cannot query field "__jshook_probe__" on type "Query". Did you mean "user", "viewer", or "health"?',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message:
                  'Cannot query field "__jshook_probe__" on type "user". Did you mean "id" or "name"?',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ data: { __jshook_probe__: null } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify({ data: { __jshook_probe__: null } }),
      }) as any;

    try {
      const body = parseJson<any>(
        await handlers.handleGraphqlEnumSchema({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          maxDepth: 2,
        }),
      );

      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        withPath(TEST_URLS.root, 'graphql'),
        expect.objectContaining({
          body: JSON.stringify({ query: 'query EnumSchemaProbe { __jshook_probe__ }' }),
        }),
      );
      expect(body.success).toBe(true);
      expect(body.fields).toEqual(['user', 'viewer', 'health']);
      expect(body.discoveredTypes.Query).toEqual(['user', 'viewer', 'health']);
      expect(body.discoveredTypes.user).toEqual(['id', 'name']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to introspection when suggestion errors are unavailable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message: 'Cannot query field "__jshook_probe__" on type "Query".',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Query',
                fields: [
                  { name: 'country', type: { kind: 'OBJECT', name: 'Country' } },
                  {
                    name: 'continents',
                    type: { kind: 'LIST', ofType: { kind: 'OBJECT', name: 'Continent' } },
                  },
                ],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Country',
                fields: [
                  { name: 'code', type: { kind: 'SCALAR', name: 'String' } },
                  { name: 'name', type: { kind: 'SCALAR', name: 'String' } },
                ],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Continent',
                fields: [{ name: 'code', type: { kind: 'SCALAR', name: 'String' } }],
              },
            },
          }),
      }) as any;

    try {
      const body = parseJson<any>(
        await handlers.handleGraphqlEnumSchema({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          maxDepth: 2,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.fields).toEqual(['country', 'continents']);
      expect(body.discoveredTypes.Query).toEqual(['country', 'continents']);
      expect(body.discoveredTypes.Country).toEqual(['code', 'name']);
      expect(body.discoveredTypes.Continent).toEqual(['code']);
      const secondCall = (globalThis.fetch as any).mock.calls[1];
      expect(secondCall?.[0]).toBe(withPath(TEST_URLS.root, 'graphql'));
      expect(secondCall?.[1]).toMatchObject({
        method: 'POST',
      });
      expect(JSON.parse(secondCall?.[1]?.body ?? '{}')).toEqual({
        query: expect.stringContaining('__type(name: $typeName)'),
        variables: { typeName: 'Query' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('adapts introspection type-ref depth until wrapped named types resolve', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message: 'Cannot query field "__jshook_probe__" on type "Query".',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Query',
                fields: [
                  {
                    name: 'viewer',
                    type: {
                      kind: 'NON_NULL',
                      ofType: {
                        kind: 'LIST',
                      },
                    },
                  },
                ],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Query',
                fields: [
                  {
                    name: 'viewer',
                    type: {
                      kind: 'NON_NULL',
                      ofType: {
                        kind: 'LIST',
                        ofType: {
                          kind: 'OBJECT',
                          name: 'Viewer',
                        },
                      },
                    },
                  },
                ],
              },
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            data: {
              __type: {
                name: 'Viewer',
                fields: [{ name: 'id', type: { kind: 'SCALAR', name: 'ID' } }],
              },
            },
          }),
      }) as any;

    try {
      const body = parseJson<any>(
        await handlers.handleGraphqlEnumSchema({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
          maxDepth: 2,
        }),
      );

      expect(body.success).toBe(true);
      expect(body.discoveredTypes.Query).toEqual(['viewer']);
      expect(body.discoveredTypes.Viewer).toEqual(['id']);

      const secondCall = JSON.parse((globalThis.fetch as any).mock.calls[1][1].body);
      const thirdCall = JSON.parse((globalThis.fetch as any).mock.calls[2][1].body);
      expect((secondCall.query.match(/ofType/g) ?? []).length).toBe(0);
      expect((thirdCall.query.match(/ofType/g) ?? []).length).toBeGreaterThan(0);
      expect(thirdCall.variables).toEqual({ typeName: 'Query' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns fetch metadata when the probe fails without graphql errors', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as any;

    try {
      const body = parseJson<any>(
        await handlers.handleGraphqlEnumSchema({
          endpoint: withPath(TEST_URLS.root, 'graphql'),
        }),
      );

      expect(body.success).toBe(false);
      expect(body.status).toBe(0);
      expect(body.error).toContain('Connection refused');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('adds the tool definition and manifest registration', () => {
    const tool = graphqlTools.find((entry) => entry.name === 'graphql_enum_schema');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['endpoint']);

    const names = manifest.registrations.map((entry: any) => entry.tool.name);
    expect(names).toContain('graphql_enum_schema');
  });
});
