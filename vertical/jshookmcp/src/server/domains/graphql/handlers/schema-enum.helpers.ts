import { buildGraphqlTypeRefSelection } from '@server/domains/graphql/handlers.impl.core.runtime.shared';

export type GraphqlErrorPayload = {
  message?: string;
};

type GraphqlTypeRef = {
  kind?: string;
  name?: string;
  ofType?: GraphqlTypeRef | null;
};

type GraphqlFieldPayload = {
  name?: string;
  type?: GraphqlTypeRef | null;
};

type GraphqlTypePayload = {
  fields?: GraphqlFieldPayload[] | null;
};

export type GraphqlJsonResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  record: Record<string, unknown> | null;
  errors: GraphqlErrorPayload[];
  error?: string;
};

const typeFieldsQueryCache = new Map<number, string>();

function buildTypeFieldsQuery(typeRefDepth: number): string {
  const cached = typeFieldsQueryCache.get(typeRefDepth);
  if (cached) {
    return cached;
  }

  const query = `
query EnumSchemaTypeProbe($typeName: String!) {
  __type(name: $typeName) {
    fields(includeDeprecated: true) {
      name
      type {
        ${buildGraphqlTypeRefSelection(typeRefDepth)}
      }
    }
  }
}
`.trim();
  typeFieldsQueryCache.set(typeRefDepth, query);
  return query;
}

function unwrapNamedType(typeRef: GraphqlTypeRef | null | undefined): {
  kind: string | null;
  name: string | null;
} {
  let current = typeRef ?? null;
  while (current) {
    if (typeof current.name === 'string' && current.name.length > 0) {
      return {
        kind: typeof current.kind === 'string' ? current.kind : null,
        name: current.name,
      };
    }
    current = current.ofType ?? null;
  }
  return { kind: null, name: null };
}

function isTraversableType(kind: string | null): boolean {
  return kind === 'OBJECT' || kind === 'INTERFACE';
}

function extractTypePayload(record: Record<string, unknown> | null): GraphqlTypePayload | null {
  return record &&
    typeof record.data === 'object' &&
    record.data !== null &&
    '__type' in record.data
    ? ((record.data as Record<string, unknown>).__type as GraphqlTypePayload | null)
    : null;
}

function extractFields(record: Record<string, unknown> | null): GraphqlFieldPayload[] {
  const payload = extractTypePayload(record);
  return Array.isArray(payload?.fields)
    ? payload.fields.filter(
        (field): field is GraphqlFieldPayload =>
          typeof field === 'object' && field !== null && typeof field.name === 'string',
      )
    : [];
}

function getUnresolvedTypeRefDepth(typeRef: GraphqlTypeRef | null | undefined): number | null {
  let current = typeRef ?? null;
  let visibleDepth = 0;
  while (current) {
    visibleDepth += 1;
    if (typeof current.name === 'string' && current.name.length > 0) {
      return null;
    }
    if (!current.ofType) {
      return current.kind === 'LIST' || current.kind === 'NON_NULL' ? visibleDepth : null;
    }
    current = current.ofType ?? null;
  }
  return null;
}

function inferNextTypeRefDepth(fields: readonly GraphqlFieldPayload[]): number | null {
  let nextDepth: number | null = null;
  for (const field of fields) {
    const unresolvedDepth = getUnresolvedTypeRefDepth(field.type);
    if (unresolvedDepth === null) {
      continue;
    }
    nextDepth = Math.max(nextDepth ?? 0, unresolvedDepth);
  }
  return nextDepth;
}

function serializeTypeRef(typeRef: GraphqlTypeRef | null | undefined): string {
  const parts: string[] = [];
  let current = typeRef ?? null;
  while (current) {
    parts.push(`${current.kind ?? ''}:${current.name ?? ''}`);
    current = current.ofType ?? null;
  }
  return parts.join('>');
}

function buildFieldResolutionFingerprint(fields: readonly GraphqlFieldPayload[]): string {
  return fields.map((field) => `${field.name ?? ''}=${serializeTypeRef(field.type)}`).join('|');
}

async function fetchTypeFieldsAdaptive(
  endpoint: string,
  headers: Record<string, string>,
  typeName: string,
): Promise<GraphqlFieldPayload[] | null> {
  let bestFields: GraphqlFieldPayload[] | null = null;
  let previousFingerprint: string | null = null;
  let typeRefDepth = 0;

  while (true) {
    const response = await postGraphqlJson(endpoint, headers, {
      query: buildTypeFieldsQuery(typeRefDepth),
      variables: { typeName },
    });
    const payload = extractTypePayload(response.record);
    if (!payload) {
      return bestFields;
    }

    const fields = extractFields(response.record);
    bestFields = fields;

    const nextTypeRefDepth = inferNextTypeRefDepth(fields);
    if (nextTypeRefDepth === null) {
      return bestFields;
    }

    const fingerprint = buildFieldResolutionFingerprint(fields);
    if (nextTypeRefDepth <= typeRefDepth || fingerprint === previousFingerprint) {
      return bestFields;
    }

    previousFingerprint = fingerprint;
    typeRefDepth = nextTypeRefDepth;
  }
}

export async function postGraphqlJson(
  endpoint: string,
  headers: Record<string, string>,
  body: {
    query: string;
    variables?: Record<string, unknown>;
  },
): Promise<GraphqlJsonResponse> {
  const requestHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...headers,
  };

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      const errors = Array.isArray(record?.errors) ? (record.errors as GraphqlErrorPayload[]) : [];
      return {
        ok: response.ok || errors.length > 0,
        status: response.status,
        statusText: response.statusText,
        record,
        errors,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'FETCH_ERROR',
      record: null,
      errors: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function enumerateFieldsViaIntrospection(
  endpoint: string,
  headers: Record<string, string>,
  rootType: string,
  maxDepth: number,
): Promise<Map<string, string[]> | null> {
  const queue: Array<{ typeName: string; depth: number }> = [{ typeName: rootType, depth: 0 }];
  const discovered = new Map<string, string[]>();
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.typeName)) {
      continue;
    }
    visited.add(current.typeName);

    const fields = await fetchTypeFieldsAdaptive(endpoint, headers, current.typeName);
    if (!fields) {
      return discovered.size > 0 ? discovered : null;
    }
    discovered.set(
      current.typeName,
      fields.map((field) => field.name?.trim() ?? '').filter((name) => name.length > 0),
    );

    if (current.depth + 1 >= maxDepth) {
      continue;
    }

    for (const field of fields) {
      const namedType = unwrapNamedType(field.type);
      if (!namedType.name || !isTraversableType(namedType.kind) || visited.has(namedType.name)) {
        continue;
      }
      queue.push({ typeName: namedType.name, depth: current.depth + 1 });
    }
  }

  return discovered;
}
