/**
 * Auth Extractor — scans captured network requests for authentication credentials.
 * Masks sensitive values before returning (first 6 + last 4 chars).
 */

export interface AuthFinding {
  header: string;
  value_masked: string;
  request_url: string;
  confidence: number;
  source: 'header' | 'cookie' | 'query' | 'body' | 'signature';
  scheme?: string;
}

const AUTH_HEADER_KEYS = [
  'authorization',
  'cookie',
  'x-token',
  'x-auth-token',
  'x-access-token',
  'x-api-key',
  'x-signature',
  'x-sign',
  'x-csrf-token',
];

const TOKEN_BODY_KEYS =
  /^(token|access_token|refresh_token|sign|signature|auth|jwt|api_key|apikey|key|secret)$/i;

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BEARER_RE = /^Bearer\s+\S+/i;

/**
 * Recognised modern request-signing schemes. Matched before the generic
 * header/query/body extraction so signature values aren't misclassified as
 * low-confidence base64 blobs. `confidence` is the raw score; query/body
 * multipliers (0.9 / 0.85) are applied downstream.
 */
interface SigningSchemeMatch {
  scheme: string;
  header: string;
  value: string;
  confidence: number;
  source: AuthFinding['source'];
}

const AWS_SIGV4_AUTH_RE = /^AWS4-HMAC-SHA256\s/i;
const ACS3_AUTH_RE = /^ACS3-HMAC-SHA256\s/i;
const ALIYUN_SIGNATURE_HEADERS = new Set([
  'x-acs-signature-nonce',
  'x-acs-signature-version',
  'x-acs-signature-method',
  'x-acs-signature-version-tool',
]);
const ALIYUN_SIGNATURE_KEY = 'x-acs-signature';
const AWS_PRESIGNED_QUERY_KEYS = new Set([
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-algorithm',
  'x-amz-date',
  'x-amz-signedheaders',
  'x-amz-expires',
  'x-amz-security-token',
]);

function matchSigningHeaders(headers: Record<string, string>): SigningSchemeMatch[] {
  const matches: SigningSchemeMatch[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (!v || v.length < 4) continue;
    const lk = k.toLowerCase();

    if (lk === 'authorization') {
      if (AWS_SIGV4_AUTH_RE.test(v)) {
        matches.push({
          scheme: 'aws-sigv4',
          header: k,
          value: v,
          confidence: 0.92,
          source: 'header',
        });
      } else if (ACS3_AUTH_RE.test(v)) {
        matches.push({
          scheme: 'aliyun-acs3',
          header: k,
          value: v,
          confidence: 0.9,
          source: 'header',
        });
      }
      continue;
    }

    if (lk === 'dpop') {
      matches.push({ scheme: 'dpop', header: k, value: v, confidence: 0.9, source: 'header' });
      continue;
    }

    if (lk === ALIYUN_SIGNATURE_KEY || ALIYUN_SIGNATURE_HEADERS.has(lk)) {
      matches.push({
        scheme: 'aliyun-acs3',
        header: k,
        value: v,
        confidence: 0.9,
        source: 'header',
      });
    }
  }
  return matches;
}

function matchSigningQueryParams(searchParams: URLSearchParams): SigningSchemeMatch[] {
  const matches: SigningSchemeMatch[] = [];
  // URLSearchParams.get() is case-sensitive, but presigned URLs use mixed case
  // (e.g. X-Amz-Signature). Walk the entries and match case-insensitively.
  const seenKeys = new Set<string>();
  for (const [rawKey, value] of searchParams.entries()) {
    const key = rawKey.toLowerCase();
    if (!AWS_PRESIGNED_QUERY_KEYS.has(key)) continue;
    if (seenKeys.has(key)) continue;
    if (!value || value.length < 8) continue;
    seenKeys.add(key);
    matches.push({
      scheme: 'aws-sigv4',
      header: rawKey,
      value,
      confidence: 0.9,
      source: 'query',
    });
  }
  return matches;
}

function matchSigningBodyFields(fields: Map<string, string>): SigningSchemeMatch[] {
  const matches: SigningSchemeMatch[] = [];
  const assertionType = fields.get('client_assertion_type');
  const assertion = fields.get('client_assertion');
  if (assertion && assertion.length >= 8) {
    matches.push({
      scheme: 'oauth2-client-assertion',
      header: 'client_assertion',
      value: assertion,
      confidence: 0.85,
      source: 'body',
    });
  } else if (assertionType) {
    matches.push({
      scheme: 'oauth2-client-assertion',
      header: 'client_assertion_type',
      value: assertionType,
      confidence: 0.7,
      source: 'body',
    });
  }
  return matches;
}

function parseFormBody(postData: string): Map<string, string> | null {
  try {
    const params = new URLSearchParams(postData);
    // URLSearchParams treats raw JSON ("{...}") as a single empty key/value — skip that.
    if (params.toString().length === 0) return null;
    const map = new Map<string, string>();
    for (const [k, v] of params.entries()) {
      map.set(k, v);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function maskSecret(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 12) return '***';
  return `${trimmed.slice(0, 6)}***${trimmed.slice(-4)}`;
}

function scoreValue(value: string): number {
  const v = value.trim();
  if (BEARER_RE.test(v)) return 0.95;
  if (JWT_RE.test(v)) return 0.9;
  if (v.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return 0.7;
  if (v.length > 10) return 0.5;
  return 0.3;
}

interface CapturedRequest {
  url: string;
  headers?: Record<string, string>;
  postData?: string;
}

export function extractAuthFromRequests(requests: CapturedRequest[]): AuthFinding[] {
  const findings: AuthFinding[] = [];
  const seen = new Set<string>();

  for (const req of requests) {
    const headers = req.headers ?? {};

    // ── Signing-scheme recognition (runs before generic extraction so signature
    // values are surfaced as high-confidence findings with a named scheme, and
    // their header keys are marked as consumed to avoid a duplicate generic hit).
    const consumedHeaderKeys = new Set<string>();
    for (const match of matchSigningHeaders(headers)) {
      consumedHeaderKeys.add(match.header.toLowerCase());
      const dedupeKey = `signature:${match.scheme}:${match.value.slice(0, 8)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push({
        header: match.header,
        value_masked: maskSecret(match.value),
        request_url: req.url,
        confidence: match.confidence,
        source: 'signature',
        scheme: match.scheme,
      });
    }

    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (!AUTH_HEADER_KEYS.includes(lk)) continue;
      if (consumedHeaderKeys.has(lk)) continue;
      if (!v || v.length < 4) continue;

      // For Cookie header, extract individual cookies
      if (lk === 'cookie') {
        for (const part of v.split(';')) {
          const eqIdx = part.indexOf('=');
          if (eqIdx === -1) continue;
          const name = part.slice(0, eqIdx).trim();
          const val = part.slice(eqIdx + 1).trim();
          if (!val || val.length < 8) continue;
          const dedupeKey = `cookie:${name}:${val.slice(0, 8)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          findings.push({
            header: `cookie[${name}]`,
            value_masked: maskSecret(val),
            request_url: req.url,
            confidence: scoreValue(val),
            source: 'cookie',
          });
        }
        continue;
      }

      const dedupeKey = `header:${lk}:${v.slice(0, 8)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push({
        header: k,
        value_masked: maskSecret(v),
        request_url: req.url,
        confidence: scoreValue(v),
        source: 'header',
      });
    }

    try {
      const u = new URL(req.url);

      for (const match of matchSigningQueryParams(u.searchParams)) {
        const dedupeKey = `signature:${match.scheme}:${match.value.slice(0, 8)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          header: match.header,
          value_masked: maskSecret(match.value),
          request_url: req.url,
          confidence: match.confidence * 0.9,
          source: 'signature',
          scheme: match.scheme,
        });
      }

      for (const [k, v] of u.searchParams.entries()) {
        if (!TOKEN_BODY_KEYS.test(k)) continue;
        if (!v || v.length < 8) continue;
        const dedupeKey = `query:${k}:${v.slice(0, 8)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        findings.push({
          header: k,
          value_masked: maskSecret(v),
          request_url: req.url,
          confidence: scoreValue(v) * 0.9,
          source: 'query',
        });
      }
    } catch {
      // invalid URL, skip
    }

    if (req.postData) {
      // Try JSON first, then fall back to form-urlencoded (e.g. OAuth2 token
      // endpoint `grant_type=...&client_assertion=...`). Signature findings
      // from either body shape are recognised before the generic token sweep.
      let bodyEntries: Map<string, string> | null = null;
      try {
        const parsed = JSON.parse(req.postData);
        if (parsed && typeof parsed === 'object') {
          bodyEntries = new Map<string, string>();
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') bodyEntries.set(k, v);
          }
          if (bodyEntries.size === 0) bodyEntries = null;
        }
      } catch {
        // not JSON — try form-urlencoded below
      }
      if (!bodyEntries) {
        bodyEntries = parseFormBody(req.postData);
      }

      if (bodyEntries) {
        for (const match of matchSigningBodyFields(bodyEntries)) {
          const dedupeKey = `signature:${match.scheme}:${match.value.slice(0, 8)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          findings.push({
            header: match.header,
            value_masked: maskSecret(match.value),
            request_url: req.url,
            confidence: match.confidence * 0.85,
            source: 'signature',
            scheme: match.scheme,
          });
        }

        for (const [k, v] of bodyEntries) {
          if (!TOKEN_BODY_KEYS.test(k)) continue;
          if (typeof v !== 'string' || v.length < 8) continue;
          const dedupeKey = `body:${k}:${v.slice(0, 8)}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          findings.push({
            header: k,
            value_masked: maskSecret(v),
            request_url: req.url,
            confidence: scoreValue(v) * 0.85,
            source: 'body',
          });
        }
      }
    }
  }

  return findings.toSorted((a, b) => b.confidence - a.confidence);
}
