import { sha256trunc12 } from './fingerprint-utils';

export function normalizeObservedHttpVersion(httpVersion: unknown): string | undefined {
  if (typeof httpVersion !== 'string') return undefined;
  const normalized = httpVersion.trim().toLowerCase();
  if (normalized === '1.0' || normalized === 'http/1.0') return '1.0';
  if (normalized === '1.1' || normalized === 'http/1.1') return '1.1';
  if (
    normalized === '2' ||
    normalized === '2.0' ||
    normalized === 'http/2' ||
    normalized === 'h2'
  ) {
    return 'h2';
  }
  if (
    normalized === '3' ||
    normalized === '3.0' ||
    normalized === 'http/3' ||
    normalized === 'h3'
  ) {
    return 'h3';
  }
  return undefined;
}

export function computeHttpFingerprint(
  method: string,
  headers: string[],
  httpVersion?: string,
  cookieHeader?: string,
  acceptLanguage?: string,
): { http: string } {
  // HTTP fingerprint format:
  // {method2}{version}{cookie}{referer}{headerLen}{lang}_{headersHash}_{cookieNamesHash}_{cookieValuesHash}
  const methodUpper = method.toUpperCase();
  const methodCode =
    {
      GET: 'ge',
      POST: 'po',
      PUT: 'pu',
      DELETE: 'de',
      HEAD: 'he',
      PATCH: 'pa',
      OPTIONS: 'ot',
    }[methodUpper] ??
    methodUpper.toLowerCase().substring(0, 2).padEnd(2, methodUpper.charAt(0).toLowerCase());

  // HTTP version: 10=HTTP/1.0, 11=HTTP/1.1, 20=HTTP/2, 30=HTTP/3
  const normalizedHttpVersion =
    typeof httpVersion === 'string' ? httpVersion.trim().toLowerCase() : '';
  const versionStr =
    normalizedHttpVersion === '2' ||
    normalizedHttpVersion === '2.0' ||
    normalizedHttpVersion === 'h2' ||
    normalizedHttpVersion === 'http/2'
      ? '20'
      : normalizedHttpVersion === '3' ||
          normalizedHttpVersion === '3.0' ||
          normalizedHttpVersion === 'h3' ||
          normalizedHttpVersion === 'http/3'
        ? '30'
        : normalizedHttpVersion === '1.0' || normalizedHttpVersion === 'http/1.0'
          ? '10'
          : normalizedHttpVersion === '1.1' || normalizedHttpVersion === 'http/1.1'
            ? '11'
            : '00';

  const lowerHeaders = headers.map((h) => h.toLowerCase());
  const hasCookie = lowerHeaders.includes('cookie') ? 'c' : 'n';
  const hasReferer = lowerHeaders.includes('referer') ? 'r' : 'n';

  // Header count excludes cookie and referer
  const nonCookieRefererHeaders = lowerHeaders.filter((h) => h !== 'cookie' && h !== 'referer');
  const numHeaders = String(Math.min(nonCookieRefererHeaders.length, 99)).padStart(2, '0');

  // Language: first 4 chars of accept-language, stripped of -/;, lowercased, first comma-split
  let langStr = '0000';
  if (acceptLanguage && acceptLanguage.length > 0) {
    const firstLang = acceptLanguage.split(',')[0] ?? '';
    const stripped = firstLang.replace(/[-;]/g, '').toLowerCase().trim();
    langStr = stripped.padEnd(4, '0').substring(0, 4);
  }

  const a = `${methodCode}${versionStr}${hasCookie}${hasReferer}${numHeaders}${langStr}`;

  // Headers hash: sorted header names excluding :pseudo, cookie, referer
  const sortedHeaders = nonCookieRefererHeaders.filter((h) => !h.startsWith(':')).toSorted();
  const headerHash =
    sortedHeaders.length > 0 ? sha256trunc12(sortedHeaders.join(',')) : '000000000000';

  // Cookie names hash: sorted cookie field names
  let cookieNamesHash = '000000000000';
  let cookieValuesHash = '000000000000';
  if (hasCookie === 'c' && cookieHeader) {
    const cookiePairs = cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);
    const cookieNames = cookiePairs
      .map((c) => c.split('=')[0]?.trim() ?? '')
      .filter(Boolean)
      .toSorted();
    cookieNamesHash =
      cookieNames.length > 0 ? sha256trunc12(cookieNames.join(',')) : '000000000000';

    // Cookie values hash: pairs sorted by cookie NAME, then hash the full pair strings
    const cookiePairsForSort = cookiePairs.map((c) => {
      const eqIdx = c.indexOf('=');
      const name = eqIdx >= 0 ? c.substring(0, eqIdx).trim() : c.trim();
      return { name, pair: c };
    });
    const sortedByCookieName = cookiePairsForSort.toSorted((x, y) => x.name.localeCompare(y.name));
    const sortedValues = sortedByCookieName.map((p) => p.pair);
    cookieValuesHash =
      sortedValues.length > 0 ? sha256trunc12(sortedValues.join(',')) : '000000000000';
  }

  const http = `${a}_${headerHash}_${cookieNamesHash}_${cookieValuesHash}`;
  return { http };
}
