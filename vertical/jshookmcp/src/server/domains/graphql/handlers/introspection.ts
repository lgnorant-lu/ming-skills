/**
 * GraphQL introspection handler.
 *
 * Runs a GraphQL introspection query against a target endpoint.
 * Defaults to in-page fetch so same-origin cookies / CSRF context are
 * preserved. Callers can opt into Node-side fetch with `useBrowser=false`
 * when they explicitly want to avoid routing through the browser session.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import {
  toResponse,
  toError,
  normalizeHeaders,
  validateBrowserEndpoint,
  validateExternalEndpoint,
  createPreview,
  serializeForPreview,
} from '@server/domains/graphql/handlers/shared';
import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  FEDERATION_SERVICE_QUERY,
  INTROSPECTION_QUERY,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString, argBool } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

interface BrowserIntrospectionFetchResult extends BrowserFetchResult {
  federation?: BrowserFetchResult;
}

function getObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractFederationDirectives(sdl: string): string[] {
  const directives = new Set<string>();
  for (const match of sdl.matchAll(/@([_A-Za-z][_0-9A-Za-z]*)\b/g)) {
    if (match[1]) directives.add(match[1]);
  }
  return [...directives].toSorted();
}

function extractFederationEntityTypes(sdl: string): string[] {
  const entityTypes = new Set<string>();
  const entityTypeRe =
    /(?:^|\n)\s*(?:extend\s+)?(?:type|interface)\s+([_A-Za-z][_0-9A-Za-z]*)[^{\n]*@key\b/g;
  for (const match of sdl.matchAll(entityTypeRe)) {
    if (match[1]) entityTypes.add(match[1]);
  }
  return [...entityTypes].toSorted();
}

function buildFederationPayload(result: BrowserFetchResult | undefined): Record<string, unknown> {
  if (!result) {
    return { attempted: false, supported: false };
  }

  const payload: Record<string, unknown> = {
    attempted: true,
    supported: false,
    status: result.status,
    statusText: result.statusText,
    responseHeaders: result.responseHeaders ?? {},
  };

  if (result.error) {
    payload.error = result.error;
  }

  const jsonRecord = getObjectRecord(result.json ?? result.responseJson);
  if (jsonRecord && Array.isArray(jsonRecord.errors)) {
    payload.errors = jsonRecord.errors;
  }

  const dataRecord = getObjectRecord(jsonRecord?.data);
  const serviceRecord = getObjectRecord(dataRecord?.['_service']);
  const sdl = serviceRecord?.sdl;
  if (typeof sdl !== 'string') {
    return payload;
  }

  const preview = createPreview(sdl, GRAPHQL_MAX_SCHEMA_CHARS);
  payload.supported = true;
  payload.sdlLength = preview.totalLength;
  payload.sdlPreview = preview.preview;
  payload.sdlTruncated = preview.truncated;
  payload.directives = extractFederationDirectives(sdl);
  payload.entityTypes = extractFederationEntityTypes(sdl);
  if (!preview.truncated) {
    payload.sdl = sdl;
  }
  return payload;
}

export class IntrospectionHandlers {
  constructor(private collector: CodeCollector) {}

  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const headers = normalizeHeaders(args.headers);
      const useBrowser = argBool(args, 'useBrowser', true);
      const includeFederation = argBool(args, 'includeFederation', true);

      if (useBrowser) {
        const page = await this.collector.getActivePage();
        const currentPageUrl = typeof page.url === 'function' ? page.url() : null;
        const endpointValidationError = await validateBrowserEndpoint(endpoint, currentPageUrl);
        if (endpointValidationError) {
          return toError(endpointValidationError);
        }

        return await this.introspectViaBrowser(page, endpoint, headers, includeFederation);
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      return await this.introspectViaNode(endpoint, headers, includeFederation);
    } catch (error) {
      return toError(error);
    }
  }

  private async postGraphqlViaNode(
    endpoint: string,
    requestHeaders: Record<string, string>,
    query: string,
    operationName: string,
  ): Promise<BrowserFetchResult> {
    let response: Response;
    let responseText: string;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10_000);
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ query, operationName }),
          signal: ac.signal,
        });
        responseText = await response.text();
      } finally {
        clearTimeout(t);
      }
    } catch (error) {
      return {
        ok: false,
        status: 0,
        statusText: 'FETCH_ERROR',
        responseHeaders: {},
        totalLength: 0,
        preview: '',
        truncated: false,
        json: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const totalLength = responseText.length;
    let json: unknown = null;
    try {
      json = JSON.parse(responseText);
    } catch {
      // not JSON
    }
    const preview = json === null ? responseText : '';
    responseText = '';

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseHeaders,
      totalLength,
      preview,
      truncated: false,
      json,
    };
  }

  private async introspectViaNode(
    endpoint: string,
    headers: Record<string, string>,
    includeFederation: boolean,
  ) {
    const requestHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...headers,
    };

    const primaryResult = await this.postGraphqlViaNode(
      endpoint,
      requestHeaders,
      INTROSPECTION_QUERY,
      'IntrospectionQuery',
    );
    const federationResult = includeFederation
      ? await this.postGraphqlViaNode(
          endpoint,
          requestHeaders,
          FEDERATION_SERVICE_QUERY,
          'FederationServiceQuery',
        )
      : undefined;

    if (!primaryResult.ok && !primaryResult.json) {
      return toResponse({
        success: false,
        endpoint,
        status: primaryResult.status,
        statusText: primaryResult.statusText,
        error: primaryResult.error ?? 'Introspection request failed',
        responsePreview: createPreview(primaryResult.preview || '', GRAPHQL_MAX_PREVIEW_CHARS),
        ...(includeFederation ? { federation: buildFederationPayload(federationResult) } : {}),
      });
    }

    const json = primaryResult.json;
    const jsonRecord = getObjectRecord(json);

    const schemaPayload = jsonRecord && 'data' in jsonRecord ? jsonRecord.data : json;
    const schemaPreviewPayload =
      json !== null && json !== undefined && typeof schemaPayload !== 'undefined'
        ? serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS)
        : { preview: '', truncated: false, totalLength: 0 };

    const payload: Record<string, unknown> = {
      success: primaryResult.ok,
      endpoint,
      status: primaryResult.status,
      statusText: primaryResult.statusText,
      schemaLength: schemaPreviewPayload.totalLength,
      schemaPreview: schemaPreviewPayload.preview,
      schemaTruncated: schemaPreviewPayload.truncated,
      responseHeaders: primaryResult.responseHeaders ?? {},
    };

    if (!schemaPreviewPayload.truncated) {
      payload.schema = schemaPayload;
    }

    if (jsonRecord && Array.isArray(jsonRecord.errors)) {
      payload.errors = jsonRecord.errors;
    }

    if (includeFederation) {
      payload.federation = buildFederationPayload(federationResult);
    }

    return toResponse(payload);
  }

  private async introspectViaBrowser(
    page: Awaited<ReturnType<CodeCollector['getActivePage']>>,
    endpoint: string,
    headers: Record<string, string>,
    includeFederation: boolean,
  ) {
    const browserResult = (await evaluateWithTimeout(
      page,
      async (input: {
        endpoint: string;
        headers: Record<string, string>;
        query: string;
        federationQuery: string;
        includeFederation: boolean;
        maxSchemaChars: number;
      }): Promise<BrowserIntrospectionFetchResult> => {
        const requestHeaders: Record<string, string> = {
          'content-type': 'application/json',
          ...input.headers,
        };

        const postGraphql = async (
          query: string,
          operationName: string,
        ): Promise<BrowserFetchResult> => {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 10000);
          let responseText: string;
          let response: Response;
          try {
            response = await fetch(input.endpoint, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify({
                query,
                operationName,
              }),
              signal: ac.signal,
            });
            responseText = await response.text();
          } finally {
            clearTimeout(t);
          }

          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          const totalLength = responseText.length;

          let json: unknown = null;
          try {
            json = JSON.parse(responseText);
          } catch {
            // not JSON — json stays null
          }

          const preview = json === null ? responseText : '';
          responseText = '';

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            responseHeaders,
            totalLength,
            preview,
            truncated: false,
            json,
          };
        };

        try {
          const primary = await postGraphql(input.query, 'IntrospectionQuery');
          if (!input.includeFederation) {
            return primary;
          }

          const federation = await postGraphql(input.federationQuery, 'FederationServiceQuery');
          return { ...primary, federation };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            statusText: 'FETCH_ERROR',
            responseHeaders: {},
            totalLength: 0,
            preview: '',
            truncated: false,
            json: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      {
        endpoint,
        headers,
        query: INTROSPECTION_QUERY,
        federationQuery: FEDERATION_SERVICE_QUERY,
        includeFederation,
        maxSchemaChars: GRAPHQL_MAX_SCHEMA_CHARS,
      },
    )) as BrowserIntrospectionFetchResult;

    if (!browserResult.ok && !browserResult.json) {
      return toResponse({
        success: false,
        endpoint,
        status: browserResult.status,
        statusText: browserResult.statusText,
        error: browserResult.error ?? 'Introspection request failed',
        responsePreview: createPreview(browserResult.preview || '', GRAPHQL_MAX_PREVIEW_CHARS),
        ...(includeFederation
          ? { federation: buildFederationPayload(browserResult.federation) }
          : {}),
      });
    }

    const jsonRecord = getObjectRecord(browserResult.json);

    const schemaPayload = jsonRecord && 'data' in jsonRecord ? jsonRecord.data : browserResult.json;
    const schemaPreviewPayload =
      browserResult.json !== null &&
      browserResult.json !== undefined &&
      typeof schemaPayload !== 'undefined'
        ? serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS)
        : {
            preview: browserResult.preview ?? '',
            truncated: browserResult.truncated ?? false,
            totalLength: browserResult.totalLength ?? 0,
          };

    const payload: Record<string, unknown> = {
      success: browserResult.ok,
      endpoint,
      status: browserResult.status,
      statusText: browserResult.statusText,
      schemaLength: schemaPreviewPayload.totalLength,
      schemaPreview: schemaPreviewPayload.preview,
      schemaTruncated: schemaPreviewPayload.truncated,
      responseHeaders: browserResult.responseHeaders ?? {},
    };

    if (!schemaPreviewPayload.truncated) {
      payload.schema = schemaPayload;
    }

    if (jsonRecord && Array.isArray(jsonRecord.errors)) {
      payload.errors = jsonRecord.errors;
    }

    if (includeFederation) {
      payload.federation = buildFederationPayload(browserResult.federation);
    }

    if (browserResult.error) {
      payload.error = browserResult.error;
    }

    return toResponse(payload);
  }
}
