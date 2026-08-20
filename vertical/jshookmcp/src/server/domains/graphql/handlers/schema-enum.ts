import {
  toError,
  toResponse,
  normalizeHeaders,
  validateExternalEndpoint,
} from '@server/domains/graphql/handlers/shared';
import { GRAPHQL_MAX_SCHEMA_CHARS } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argNumber, argString } from '@server/domains/shared/parse-args';
import {
  enumerateFieldsViaIntrospection,
  postGraphqlJson,
  type GraphqlErrorPayload,
} from '@server/domains/graphql/handlers/schema-enum.helpers';

const FIELD_SUGGESTION_RE =
  /Cannot query field\s+"[^"]+"\s+on type\s+"([^"]+)".*?Did you mean\s+(.+?)\?/i;
const QUOTED_NAME_RE = /"([^"]+)"/g;
const PROBE_FIELD = '__jshook_probe__';

function parseSuggestedFields(message: string): { typeName: string; suggestions: string[] } | null {
  const match = FIELD_SUGGESTION_RE.exec(message);
  if (!match) {
    return null;
  }
  const [, typeName, suggestionText] = match;
  if (!typeName || !suggestionText) {
    return null;
  }
  const suggestions = Array.from(
    suggestionText.matchAll(QUOTED_NAME_RE),
    (entry) => entry[1] ?? '',
  );
  const normalized = suggestions.filter((value) => value.length > 0);
  return normalized.length > 0 ? { typeName, suggestions: normalized } : null;
}

function buildProbeQuery(fieldPath: string[]): string {
  if (fieldPath.length === 0) {
    return `query EnumSchemaProbe { ${PROBE_FIELD} }`;
  }
  return `query EnumSchemaProbe { ${fieldPath.join(' { ')} { ${PROBE_FIELD} }${'}'.repeat(fieldPath.length)} }`;
}

function buildEnumResponse(input: {
  endpoint: string;
  typeName: string;
  parentType: string;
  maxDepth: number;
  concurrency: number;
  discovered: Map<string, string[]>;
}) {
  const fields =
    input.discovered.get(input.parentType) ?? input.discovered.get(input.typeName) ?? [];
  const preview = JSON.stringify(
    {
      rootType: input.typeName,
      parentType: input.parentType,
      fields,
    },
    null,
    2,
  );

  return toResponse({
    success: true,
    endpoint: input.endpoint,
    typeName: input.typeName,
    parentType: input.parentType,
    maxDepth: input.maxDepth,
    concurrency: input.concurrency,
    fields,
    discoveredTypes: Object.fromEntries(
      Array.from(input.discovered.entries()).filter(([key]) => !key.includes('.')),
    ),
    responsePreview:
      preview.length > GRAPHQL_MAX_SCHEMA_CHARS
        ? `${preview.slice(0, GRAPHQL_MAX_SCHEMA_CHARS)}\n... (truncated)`
        : preview,
  });
}

export class SchemaEnumHandlers {
  async handleGraphqlEnumSchema(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      const headers = normalizeHeaders(args.headers);
      const typeName = argString(args, 'typeName', 'Query')?.trim() || 'Query';
      const parentType = argString(args, 'parentType', typeName)?.trim() || typeName;
      const maxDepthRaw = argNumber(args, 'maxDepth', 1) ?? 1;
      const maxDepth = Math.min(Math.max(Math.trunc(maxDepthRaw), 1), 6);
      const concurrencyRaw = argNumber(args, 'concurrency', 3) ?? 3;
      const concurrency = Math.min(Math.max(Math.trunc(concurrencyRaw), 1), 10);
      const rootResponse = await postGraphqlJson(endpoint, headers, { query: buildProbeQuery([]) });

      if (!rootResponse.ok) {
        return toResponse({
          success: false,
          endpoint,
          typeName,
          parentType,
          status: rootResponse.status,
          statusText: rootResponse.statusText,
          error: rootResponse.error ?? 'Schema enumeration request failed',
        });
      }

      const rootSuggestions = this.extractSuggestions(rootResponse.errors);
      if (!rootSuggestions) {
        const introspected = await enumerateFieldsViaIntrospection(
          endpoint,
          headers,
          parentType,
          maxDepth,
        );
        return buildEnumResponse({
          endpoint,
          typeName,
          parentType,
          maxDepth,
          concurrency,
          discovered: introspected ?? new Map([[parentType, []]]),
        });
      }

      const queue: Array<{ path: string[]; depth: number; typeName: string }> = [];
      const discovered = new Map<string, string[]>();
      discovered.set(rootSuggestions.typeName, rootSuggestions.suggestions);

      if (maxDepth > 1) {
        for (const field of rootSuggestions.suggestions) {
          const nextPath = [field];
          const dedupeKey = nextPath.join('.');
          if (!discovered.has(dedupeKey)) {
            discovered.set(dedupeKey, []);
            queue.push({ path: nextPath, depth: 1, typeName: field });
          }
        }
      }

      while (queue.length > 0) {
        const current = queue.shift()!;
        const response = await postGraphqlJson(endpoint, headers, {
          query: buildProbeQuery(current.path),
        });
        if (!response.ok) {
          return toResponse({
            success: false,
            endpoint,
            typeName,
            parentType,
            status: response.status,
            statusText: response.statusText,
            error: response.error ?? 'Schema enumeration request failed',
          });
        }

        const suggestions = this.extractSuggestions(response.errors);
        if (!suggestions) {
          discovered.set(current.typeName, []);
          continue;
        }

        discovered.set(suggestions.typeName, suggestions.suggestions);

        if (current.depth + 1 >= maxDepth) {
          continue;
        }

        for (const field of suggestions.suggestions) {
          const nextPath = [...current.path, field];
          const dedupeKey = nextPath.join('.');
          if (!discovered.has(dedupeKey)) {
            discovered.set(dedupeKey, []);
            queue.push({ path: nextPath, depth: current.depth + 1, typeName: field });
          }
        }
      }

      return buildEnumResponse({
        endpoint,
        typeName,
        parentType,
        maxDepth,
        concurrency,
        discovered,
      });
    } catch (error) {
      return toError(error);
    }
  }

  private extractSuggestions(
    errors: GraphqlErrorPayload[],
  ): { typeName: string; suggestions: string[] } | null {
    for (const error of errors) {
      if (typeof error.message !== 'string') {
        continue;
      }
      const parsed = parseSuggestedFields(error.message);
      if (parsed) {
        return parsed;
      }
    }
    return null;
  }
}
