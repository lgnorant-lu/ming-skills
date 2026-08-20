import {
  asOptionalNumber,
  asOptionalString,
  isNetworkRequestPayload,
  isObjectRecord,
  type NetworkRequestPayload,
} from './handlers.base.types';

const REQUEST_MERGE_TIMESTAMP_WINDOW_MS = 1_500;

interface NetworkRequestMonitorLike {
  getNetworkRequests(): unknown[];
  getXHRRequests?(): Promise<unknown[]>;
  getFetchRequests?(): Promise<unknown[]>;
}

function normalizeInjectedRequest(
  source: 'XHR' | 'Fetch',
  request: unknown,
  index: number,
): NetworkRequestPayload | null {
  if (!isObjectRecord(request)) {
    return null;
  }

  const url = asOptionalString(request.url);
  const method = asOptionalString(request.method);
  if (!url || !method) {
    return null;
  }

  const timestamp = asOptionalNumber(request.timestamp);
  const requestId =
    asOptionalString(request.requestId) ??
    `${source.toLowerCase()}-injected-${timestamp ?? 0}-${index}`;

  return {
    ...request,
    requestId,
    url,
    method,
    type: asOptionalString(request.type) ?? source,
    timestamp,
    injected: true,
    captureSource: 'inpage',
  };
}

function normalizeType(request: NetworkRequestPayload): string {
  const type = (request.type ?? '').toString().toLowerCase();
  if (type.includes('xhr')) return 'xhr';
  if (type.includes('fetch')) return 'fetch';
  return type || 'unknown';
}

function buildFingerprint(request: NetworkRequestPayload): string {
  return `${request.targetId ?? ''}|${request.sessionId ?? ''}|${request.method.toUpperCase()}|${request.url}|${normalizeType(request)}`;
}

function buildLooseFingerprint(request: NetworkRequestPayload): string {
  return `${request.targetId ?? ''}|${request.sessionId ?? ''}|${request.method.toUpperCase()}|${request.url}`;
}

function hasCloseTimestamp(left: NetworkRequestPayload, right: NetworkRequestPayload): boolean {
  const leftTimestamp = asOptionalNumber(left.timestamp);
  const rightTimestamp = asOptionalNumber(right.timestamp);
  if (leftTimestamp === undefined || rightTimestamp === undefined) {
    return false;
  }
  return Math.abs(leftTimestamp - rightTimestamp) <= REQUEST_MERGE_TIMESTAMP_WINDOW_MS;
}

function isLooseTypeCompatible(
  existing: NetworkRequestPayload,
  incoming: NetworkRequestPayload,
): boolean {
  const existingType = normalizeType(existing);
  const incomingType = normalizeType(incoming);
  return existingType === incomingType || existingType === 'unknown' || incomingType === 'unknown';
}

function consumeTimestampMatchedIndex(
  queue: number[] | undefined,
  merged: NetworkRequestPayload[],
  matchedIndexes: Set<number>,
  request: NetworkRequestPayload,
  allowLooseTypeMatch: boolean,
): number | null {
  if (!queue) {
    return null;
  }

  for (let i = 0; i < queue.length; i += 1) {
    const index = queue[i];
    if (index === undefined || matchedIndexes.has(index)) {
      continue;
    }

    const existing = merged[index];
    if (!existing || !hasCloseTimestamp(existing, request)) {
      continue;
    }
    if (allowLooseTypeMatch && !isLooseTypeCompatible(existing, request)) {
      continue;
    }

    queue.splice(i, 1);
    return index;
  }

  return null;
}

export async function getMergedNetworkRequestsFromMonitor(
  consoleMonitor: NetworkRequestMonitorLike,
): Promise<NetworkRequestPayload[]> {
  const cdpRequests: NetworkRequestPayload[] = consoleMonitor
    .getNetworkRequests()
    .filter((req: unknown): req is NetworkRequestPayload => isNetworkRequestPayload(req))
    .map((request) => ({ ...request, captureSource: 'cdp' }));

  const [xhrRequests, fetchRequests] = await Promise.all([
    typeof consoleMonitor.getXHRRequests === 'function'
      ? consoleMonitor.getXHRRequests().catch(() => [])
      : Promise.resolve([]),
    typeof consoleMonitor.getFetchRequests === 'function'
      ? consoleMonitor.getFetchRequests().catch(() => [])
      : Promise.resolve([]),
  ]);

  const normalizedXHR = xhrRequests
    .map((request, index) => normalizeInjectedRequest('XHR', request, index))
    .filter((request): request is NetworkRequestPayload => request !== null);
  const normalizedFetch = fetchRequests
    .map((request, index) => normalizeInjectedRequest('Fetch', request, index))
    .filter((request): request is NetworkRequestPayload => request !== null);

  const injectedRequests = [...normalizedXHR, ...normalizedFetch];
  const matchedCdpIndexes = new Set<number>();
  const exactQueues = new Map<string, number[]>();
  const looseQueues = new Map<string, number[]>();

  cdpRequests.forEach((request, index) => {
    const exactKey = buildFingerprint(request);
    const looseKey = buildLooseFingerprint(request);
    exactQueues.set(exactKey, [...(exactQueues.get(exactKey) ?? []), index]);
    looseQueues.set(looseKey, [...(looseQueues.get(looseKey) ?? []), index]);
  });

  for (const request of injectedRequests) {
    const matchedById = request.requestId
      ? cdpRequests.findIndex(
          (existing, index) =>
            !matchedCdpIndexes.has(index) && existing.requestId === request.requestId,
        )
      : -1;
    const exactKey = buildFingerprint(request);
    const looseKey = buildLooseFingerprint(request);
    const matchedIndex =
      matchedById >= 0
        ? matchedById
        : (consumeTimestampMatchedIndex(
            exactQueues.get(exactKey),
            cdpRequests,
            matchedCdpIndexes,
            request,
            false,
          ) ??
          consumeTimestampMatchedIndex(
            looseQueues.get(looseKey),
            cdpRequests,
            matchedCdpIndexes,
            request,
            true,
          ));

    if (matchedIndex === null || matchedIndex === -1) {
      cdpRequests.push(request);
      continue;
    }

    matchedCdpIndexes.add(matchedIndex);
    const existing = cdpRequests[matchedIndex]!;
    cdpRequests[matchedIndex] = {
      ...request,
      ...existing,
      injected: Boolean(existing.injected || request.injected),
      captureSource: request.captureSource ?? existing.captureSource,
    };
  }

  return cdpRequests;
}
