import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestId } from '@modelcontextprotocol/sdk/types.js';

export interface ToolRequestExtra {
  _meta?: unknown;
  sessionId?: string;
  requestId?: RequestId;
  requestInfo?: {
    headers?: Record<string, string | string[] | undefined>;
  };
  signal?: AbortSignal;
}

export interface ToolRequestContextValue {
  sessionId: string | null;
  requestId: RequestId | null;
  signal?: AbortSignal;
}

const requestContext = new AsyncLocalStorage<ToolRequestContextValue>();

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0)?.trim() ?? null;
  }
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveToolRequestSessionId(extra?: ToolRequestExtra): string | null {
  if (typeof extra?.sessionId === 'string' && extra.sessionId.trim().length > 0) {
    return extra.sessionId.trim();
  }

  const headers = extra?.requestInfo?.headers;
  const headerSessionId = headers
    ? firstHeaderValue(headers['mcp-session-id'] ?? headers['Mcp-Session-Id'])
    : null;
  if (headerSessionId) return headerSessionId;

  const meta = extra?._meta;
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null;
  return firstHeaderValue((meta as Record<string, unknown>)['sessionId'] as string | undefined);
}

export function runWithToolRequestContext<T>(
  extra: ToolRequestExtra | undefined,
  callback: () => T,
): T {
  return requestContext.run(
    {
      sessionId: resolveToolRequestSessionId(extra),
      requestId: extra?.requestId ?? null,
      ...(extra?.signal ? { signal: extra.signal } : {}),
    },
    callback,
  );
}

export function getToolRequestContext(): ToolRequestContextValue | null {
  return requestContext.getStore() ?? null;
}
