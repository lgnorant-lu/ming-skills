/**
 * HAR 1.2 builder — converts NetworkMonitor captured data to standard HAR format.
 * Ref: http://www.softwareishard.com/blog/har-12-spec/
 */

import { NETWORK_HAR_BODY_CONCURRENCY } from '@src/constants';

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    queryString: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
      _bodyUnavailable?: boolean;
    };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, unknown>;
  timings: { send: number; wait: number; receive: number };
  _requestId?: string;
}

export interface Har {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

function headersToHar(
  headers: Record<string, string | undefined> = {},
): Array<{ name: string; value: string }> {
  return Object.entries(headers)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ({ name, value }));
}

function parseCookies(cookieHeader: string): Array<{ name: string; value: string }> {
  return cookieHeader.split(';').map((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return { name: part.trim(), value: '' };
    return { name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
  });
}

function queryStringFromUrl(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

/**
 * Normalize CDP protocol identifier to HAR-compatible HTTP version string.
 * Maps CDP protocol values (h2, h3, http/1.1, etc.) to HAR format (HTTP/2, HTTP/3, HTTP/1.1).
 *
 * Protocol mappings:
 * - http/1.0 → HTTP/1.0
 * - http/1.1 → HTTP/1.1
 * - h2, h2c → HTTP/2
 * - h3, http/2+quic/* → HTTP/3
 * - unknown/empty → HTTP/1.1 (fallback)
 */
function normalizeProtocol(protocol: string | undefined): string {
  if (!protocol || protocol.trim() === '') {
    return 'HTTP/1.1';
  }

  const normalized = protocol.toLowerCase().trim();

  // HTTP/1.x
  if (normalized === 'http/1.0') return 'HTTP/1.0';
  if (normalized === 'http/1.1') return 'HTTP/1.1';

  // HTTP/2
  if (normalized === 'h2' || normalized === 'h2c') return 'HTTP/2';

  // HTTP/3 (includes QUIC variants)
  if (normalized === 'h3' || normalized.startsWith('http/2+quic')) return 'HTTP/3';

  // Unknown protocols: preserve as-is with uppercase HTTP prefix if it looks like http/X.Y
  if (normalized.startsWith('http/')) {
    return protocol.replace(/^http\//i, 'HTTP/');
  }

  // Complete unknown: fallback to HTTP/1.1
  return 'HTTP/1.1';
}

interface RawRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string | undefined>;
  postData?: string;
  timestamp?: number;
  resourceType?: string;
  protocol?: string;
}

interface RawResponse {
  status?: number;
  statusText?: string;
  headers?: Record<string, string | undefined>;
  mimeType?: string;
  timing?: { receiveHeadersEnd?: number };
  protocol?: string;
}

export interface BuildHarParams {
  requests: RawRequest[];
  getResponse: (requestId: string) => RawResponse | undefined;
  getResponseBody: (requestId: string) => Promise<{ body: string; base64Encoded: boolean } | null>;
  includeBodies: boolean;
  creatorVersion?: string;
}

export async function buildHar(params: BuildHarParams): Promise<Har> {
  const {
    requests,
    getResponse,
    getResponseBody,
    includeBodies,
    creatorVersion = 'unknown',
  } = params;
  const entries: HarEntry[] = [];

  // Parallel body fetching with concurrency limit to avoid overwhelming CDP
  const bodyResults = new Map<string, { text?: string; _bodyUnavailable?: boolean }>();
  if (includeBodies) {
    const BODY_CONCURRENCY = NETWORK_HAR_BODY_CONCURRENCY;
    for (let i = 0; i < requests.length; i += BODY_CONCURRENCY) {
      const batch = requests.slice(i, i + BODY_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (req) => {
          try {
            const bodyResult = await getResponseBody(req.requestId);
            if (bodyResult) {
              return { requestId: req.requestId, text: bodyResult.body };
            }
            return { requestId: req.requestId, _bodyUnavailable: true as const };
          } catch {
            return { requestId: req.requestId, _bodyUnavailable: true as const };
          }
        }),
      );
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          const val = result.value;
          bodyResults.set(
            val.requestId,

            '_bodyUnavailable' in val ? { _bodyUnavailable: true } : { text: val.text },
          );
        }
      }
    }
  }

  for (const req of requests) {
    const res = getResponse(req.requestId);
    const startedDateTime = req.timestamp
      ? new Date(req.timestamp * 1000).toISOString()
      : new Date().toISOString();
    const bodyContent = includeBodies
      ? (bodyResults.get(req.requestId) ?? { _bodyUnavailable: true })
      : {};

    const postData = req.postData
      ? {
          mimeType: req.headers?.['content-type'] ?? 'application/octet-stream',
          text: req.postData,
        }
      : undefined;

    const reqCookieHeader = req.headers?.['cookie'] ?? '';
    const resCookieHeader = res?.headers?.['set-cookie'] ?? '';

    const entry: HarEntry = {
      startedDateTime,
      time: res?.timing?.receiveHeadersEnd ?? 0,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: normalizeProtocol(req.protocol),
        headers: headersToHar(req.headers),
        queryString: queryStringFromUrl(req.url),
        cookies: reqCookieHeader ? parseCookies(reqCookieHeader) : [],
        headersSize: -1,
        bodySize: req.postData ? req.postData.length : 0,
        ...(postData ? { postData } : {}),
      },
      response: {
        status: res?.status ?? 0,
        statusText: res?.statusText ?? '',
        httpVersion: normalizeProtocol(res?.protocol),
        headers: headersToHar(res?.headers),
        cookies: resCookieHeader ? parseCookies(resCookieHeader) : [],
        content: {
          size: bodyContent.text ? bodyContent.text.length : -1,
          mimeType: res?.mimeType ?? 'application/octet-stream',
          ...bodyContent,
        },
        redirectURL: res?.headers?.['location'] ?? '',
        headersSize: -1,
        bodySize: bodyContent.text ? bodyContent.text.length : -1,
      },
      cache: {},
      timings: { send: 0, wait: res?.timing?.receiveHeadersEnd ?? 0, receive: 0 },
      _requestId: req.requestId,
    };

    entries.push(entry);
  }

  return {
    log: {
      version: '1.2',
      creator: { name: 'jshookmcp', version: creatorVersion },
      entries,
    },
  };
}
