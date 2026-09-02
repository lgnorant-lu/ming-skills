/**
 * MCPServer.execution — error-path regression tests.
 *
 * Regression for: executeToolWithTracking() built the error response via
 * asErrorResponse(error) but never logged the original error before
 * re-throwing it, so the stack was lost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  getToolDomain: vi.fn(() => 'browser'),
  refreshDomainTtlForTool: vi.fn(),
  getToolRequestContext: vi.fn(() => null),
  shouldCollectExecutionMetrics: vi.fn(() => false),
  BrowserSessionQueueError: class extends Error {
    code = 'QUEUE_FULL';
    retryAfterMs = 100;
    queueDepth = 3;
    queueLimit = 5;
  },
  BrowserFleetLeaseError: class extends Error {},
  SessionScopedResourcePoolCapacityError: class extends Error {},
}));

vi.mock('@utils/logger', () => ({ logger: mocks.logger }));
vi.mock('@server/ToolCatalog', () => ({ getToolDomain: mocks.getToolDomain }));
vi.mock('@server/MCPServer.activation.ttl', () => ({
  refreshDomainTtlForTool: mocks.refreshDomainTtlForTool,
}));
vi.mock('@server/runtime/ToolRequestContext', () => ({
  getToolRequestContext: mocks.getToolRequestContext,
}));
vi.mock('@server/MCPServer.metrics', () => ({
  shouldCollectExecutionMetrics: mocks.shouldCollectExecutionMetrics,
}));
vi.mock('@server/runtime/BrowserSessionCoordinator', () => ({
  BrowserSessionQueueError: mocks.BrowserSessionQueueError,
  parseBrowserSessionSnapshot: vi.fn(() => ({})),
}));
vi.mock('@server/runtime/BrowserFleetRouter', () => ({
  BrowserFleetLeaseError: mocks.BrowserFleetLeaseError,
}));
vi.mock('@server/runtime/SessionScopedResourcePool', () => ({
  SessionScopedResourcePoolCapacityError: mocks.SessionScopedResourcePoolCapacityError,
}));
vi.mock('@server/runtime/ServerRuntimeState', () => ({
  getRuntimeState: () => undefined,
}));

import { executeToolWithTracking } from '@server/MCPServer.execution';
import { R } from '@server/domains/shared/ResponseBuilder';
import type { MCPServerContext } from '@server/MCPServer.context';

function createMockCtx(routerExecute: () => Promise<unknown>): MCPServerContext {
  return {
    circuitBreaker: {
      shouldBlock: () => false,
      getState: () => null,
      getRecoveryMs: () => 30_000,
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
    },
    contextGuard: {
      isContextSensitive: () => false,
      recordCall: vi.fn(),
      enrichResponse: (_name: string, response: unknown) => response,
    },
    router: { execute: routerExecute },
    largeDataOffloader: { offload: vi.fn() },
    getDomainInstance: () => undefined,
    tokenBudget: { recordToolCall: vi.fn() },
    activatedToolNames: new Set<string>(),
    domainTtlEntries: new Map(),
    extensionToolsByName: new Map(),
    eventBus: { emit: vi.fn() },
    mcpLog: { info: vi.fn() },
    server: { sendToolListChanged: vi.fn(async () => undefined) },
    enabledDomains: new Set(['browser']),
    selectedTools: [],
    activatedRegisteredTools: new Map(),
    routerImpl: undefined,
  } as unknown as MCPServerContext;
}

describe('executeToolWithTracking — error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the original error (with stack) before re-throwing', async () => {
    const boom = new Error('handler exploded');
    const ctx = createMockCtx(async () => {
      throw boom;
    });

    await expect(executeToolWithTracking(ctx, 'page_navigate', {})).rejects.toBe(boom);

    expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining('page_navigate'), boom);
    // Circuit breaker failure is recorded for non-admission errors.
    expect(ctx.circuitBreaker.recordFailure).toHaveBeenCalledWith('page_navigate');
  });

  it('returns an error response for queue errors without re-throwing or error-logging', async () => {
    const queueError = new mocks.BrowserSessionQueueError('queue full');
    const ctx = createMockCtx(async () => {
      throw queueError;
    });

    const response = await executeToolWithTracking(ctx, 'page_navigate', {});

    expect(response).toMatchObject({ isError: true });
    const text = JSON.parse((response as { content: { text: string }[] }).content[0]!.text);
    expect(text.error).toBe('queue full');
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(ctx.circuitBreaker.recordFailure).not.toHaveBeenCalled();
  });
});

describe('executeToolWithTracking — success-flag extraction (a1-02)', () => {
  it('does not JSON.parse the response text when the ResponseBuilder success flag is present', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      const ctx = createMockCtx(async () => R.ok().json());
      await executeToolWithTracking(ctx, 'page_navigate', {});
      expect(ctx.circuitBreaker.recordSuccess).toHaveBeenCalledWith('page_navigate');
      expect(ctx.circuitBreaker.recordFailure).not.toHaveBeenCalled();
      expect(parseSpy).not.toHaveBeenCalled();
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('records failure for a ResponseBuilder soft failure via the success flag', async () => {
    const ctx = createMockCtx(async () => R.fail('boom').json());
    await executeToolWithTracking(ctx, 'page_navigate', {});
    expect(ctx.circuitBreaker.recordFailure).toHaveBeenCalledWith('page_navigate');
    expect(ctx.circuitBreaker.recordSuccess).not.toHaveBeenCalled();
  });

  it('still detects success:false in raw text responses without a success flag (parse fallback)', async () => {
    const ctx = createMockCtx(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'raw' }) }],
    }));
    await executeToolWithTracking(ctx, 'page_navigate', {});
    expect(ctx.circuitBreaker.recordFailure).toHaveBeenCalledWith('page_navigate');
  });
});
