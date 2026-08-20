export interface PlaywrightLikeRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  resourceType(): string;
}

export interface PlaywrightLikeResponse {
  request(): unknown;
  url(): string;
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
  body?(): Promise<Buffer>;
  httpVersion?(): string;
  protocol?(): string;
}

export interface PlaywrightLikePage {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  evaluate?<T>(pageFunction: string | (() => T | Promise<T>)): Promise<T>;
  evaluateOnNewDocument?<T>(pageFunction: string | (() => T | Promise<T>)): Promise<T>;
}

export interface BridgeWindow extends Window {
  XMLHttpRequest: typeof XMLHttpRequest;
  __xhrRequests?: unknown[];
  __fetchRequests?: unknown[];
  __pwOriginalXMLHttpRequest?: typeof XMLHttpRequest;
  __pwOriginalFetch?: typeof fetch;
  __xhrInterceptorInjected?: boolean;
  __fetchInterceptorInjected?: boolean;
}

export type ClearedBuffersResult = { xhrCleared: number; fetchCleared: number };
export type ResetInterceptorsResult = { xhrReset: boolean; fetchReset: boolean };

// ── Type Guards ──────────────────────────────────────────────

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isClearedBuffersResult(value: unknown): value is ClearedBuffersResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.xhrCleared === 'number' && typeof candidate.fetchCleared === 'number';
}

export function isResetInterceptorsResult(value: unknown): value is ResetInterceptorsResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.xhrReset === 'boolean' && typeof candidate.fetchReset === 'boolean';
}

export function isPlaywrightLikeRequest(value: unknown): value is PlaywrightLikeRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlaywrightLikeRequest>;
  return (
    typeof candidate.url === 'function' &&
    typeof candidate.method === 'function' &&
    typeof candidate.headers === 'function' &&
    typeof candidate.postData === 'function' &&
    typeof candidate.resourceType === 'function'
  );
}

export function isPlaywrightLikeResponse(value: unknown): value is PlaywrightLikeResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PlaywrightLikeResponse>;
  return (
    typeof candidate.request === 'function' &&
    typeof candidate.url === 'function' &&
    typeof candidate.status === 'function' &&
    typeof candidate.statusText === 'function' &&
    typeof candidate.headers === 'function'
  );
}
