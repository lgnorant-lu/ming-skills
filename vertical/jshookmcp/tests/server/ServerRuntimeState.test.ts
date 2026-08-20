import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';

import {
  ServerRuntimeState,
  restorePendingDomainActivations,
} from '@server/runtime/ServerRuntimeState';

const state = vi.hoisted(() => ({
  ensureDomainLoaded: vi.fn(async () => null),
  getAllKnownDomains: vi.fn(() => new Set(['browser', 'network'])),
  allTools: [{ name: 'called_tool' }, { name: 'catalog_tool' }],
  getToolsByDomains: vi.fn((domains: string[]) => {
    if (domains.includes('browser')) {
      return [
        {
          name: 'page_navigate',
          description: 'Navigate',
          inputSchema: { type: 'object', properties: {} },
        },
      ];
    }
    return [];
  }),
  createToolHandlerMap: vi.fn((_: unknown, names?: Set<string>) =>
    Object.fromEntries(
      [...(names ?? new Set<string>())].map((name) => [name, vi.fn(async () => ({ name }))]),
    ),
  ),
  startDomainTtl: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@server/registry/index', () => ({
  ensureDomainLoaded: state.ensureDomainLoaded,
  getAllKnownDomains: state.getAllKnownDomains,
}));

vi.mock('@server/ToolCatalog', () => ({
  allTools: state.allTools,
  getToolsByDomains: state.getToolsByDomains,
}));

vi.mock('@server/ToolHandlerMap', () => ({
  createToolHandlerMap: state.createToolHandlerMap,
}));

vi.mock('@server/MCPServer.activation.ttl', () => ({
  startDomainTtl: state.startDomainTtl,
}));

vi.mock('@utils/logger', () => ({
  logger: state.logger,
}));

function createCtx(runtimeState: ServerRuntimeState) {
  return {
    selectedTools: [],
    activatedToolNames: new Set<string>(),
    extensionToolsByName: new Map<string, unknown>(),
    enabledDomains: new Set<string>(),
    activatedRegisteredTools: new Map<string, unknown>(),
    domainTtlEntries: new Map<string, unknown>(),
    metaToolsByName: new Map<string, unknown>(),
    router: {
      addHandlers: vi.fn(),
    },
    handlerDeps: {},
    registerSingleTool: vi.fn((toolDef: { name: string }) => ({
      remove: vi.fn(),
      name: toolDef.name,
    })),
    server: {
      sendToolListChanged: vi.fn(async () => undefined),
    },
    getDomainInstance: vi.fn((key: string) =>
      key === 'serverRuntimeState' ? runtimeState : undefined,
    ),
    mcpLog: { info: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() },
  } as any;
}

describe('ServerRuntimeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores pending domain activations into a fresh context', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.restoreSnapshot({
      schemaVersion: 1,
      savedAt: '2026-05-23T00:00:00.000Z',
      activatedDomains: ['browser'],
      domainTtls: {
        browser: {
          ttlMinutes: 30,
          toolNames: ['page_navigate'],
        },
      },
      browserAttach: {
        endpoint: null,
        selectedIndex: null,
        selectedUrl: null,
        selectedTitle: null,
        selectedTargetId: null,
        browserPid: null,
        rendererPid: null,
        attachedAt: null,
      },
      toolCoverage: {},
    });

    const ctx = createCtx(runtimeState);
    await restorePendingDomainActivations(ctx);

    expect(ctx.enabledDomains.has('browser')).toBe(true);
    expect(ctx.registerSingleTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'page_navigate' }),
    );
    expect(state.startDomainTtl).toHaveBeenCalledWith(ctx, 'browser', 30, ['page_navigate']);
    expect(ctx.server.sendToolListChanged).toHaveBeenCalledOnce();
  });

  it('restores malformed snapshot data defensively', () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.restoreSnapshot({
      schemaVersion: 1,
      savedAt: '2026-05-23T00:00:00.000Z',
      activatedDomains: ['browser', 42],
      domainTtls: {
        browser: {
          ttlMinutes: '15',
          toolNames: ['page_navigate', 7],
        },
        invalid: {
          ttlMinutes: 'nope',
          toolNames: ['ignored'],
        },
      },
      browserAttach: {
        endpoint: buildTestUrl('devtools', { scheme: 'ws', suffix: 'test' }),
        selectedIndex: 1.5,
        selectedUrl: buildTestUrl('page', { suffix: 'test' }),
        selectedTitle: 123,
        selectedTargetId: 'page-target',
        browserPid: 2001,
        rendererPid: 2002.5,
        attachedAt: 999,
      },
      toolCoverage: {
        called_tool: {
          count: 2.8,
          lastCalledAt: 123,
          lastArgsKeys: ['zeta', 9, 'alpha'],
        },
      },
    } as any);

    expect(runtimeState.getPendingActivatedDomains()).toEqual(['browser']);
    expect(runtimeState.getPendingDomainTtl('browser')).toEqual({
      ttlMinutes: 15,
      toolNames: ['page_navigate'],
    });
    expect(runtimeState.getPendingDomainTtl('invalid')).toBeNull();
    expect(runtimeState.getBrowserAttach()).toEqual({
      endpoint: buildTestUrl('devtools', { scheme: 'ws', suffix: 'test' }),
      selectedIndex: null,
      selectedUrl: buildTestUrl('page', { suffix: 'test' }),
      selectedTitle: null,
      selectedTargetId: 'page-target',
      browserPid: 2001,
      rendererPid: null,
      attachedAt: null,
    });

    const snapshot = runtimeState.exportSnapshot();
    expect(snapshot.toolCoverage.called_tool).toEqual({
      count: 2,
      lastCalledAt: null,
      lastArgsKeys: ['zeta', 'alpha'],
    });
    expect(runtimeState.isPersistDirty()).toBe(false);
  });

  it('tracks coverage summaries across catalogued and uncatalogued tools', () => {
    const runtimeState = new ServerRuntimeState();
    const ctx = createCtx(runtimeState);
    ctx.selectedTools = [{ name: 'selected_tool' }];
    ctx.activatedToolNames.add('activated_tool');
    ctx.extensionToolsByName.set('extension_tool', {});
    ctx.metaToolsByName.set('meta_tool', {});

    runtimeState.recordToolCall('called_tool', { beta: 2, alpha: 1, _meta: { sessionId: 's1' } });
    runtimeState.recordToolCall('uncatalogued_tool', {});

    const summary = runtimeState.getCoverageSummary(ctx);
    expect(summary.calledCount).toBe(2);
    expect(summary.called.called_tool?.lastArgsKeys).toEqual(['alpha', 'beta']);
    expect(summary.uncataloguedCalls).toEqual(['uncatalogued_tool']);
    expect(summary.uncataloguedCallCount).toBe(1);
    expect(summary.totalKnownTools).toBe(6);
    expect(summary.uncalled).toEqual([
      'activated_tool',
      'catalog_tool',
      'extension_tool',
      'meta_tool',
      'selected_tool',
    ]);
    expect(summary.uncalledCount).toBe(5);
  });

  it('only marks pending activation cleanup dirty when something was removed', () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.markPersisted();

    runtimeState.clearPendingDomainActivation('missing');
    expect(runtimeState.isPersistDirty()).toBe(false);

    runtimeState.setPendingDomainActivation('browser', 30, ['page_navigate']);
    runtimeState.markPersisted();
    runtimeState.clearPendingDomainActivation('browser');

    expect(runtimeState.getPendingActivatedDomains()).toEqual([]);
    expect(runtimeState.getPendingDomainTtl('browser')).toBeNull();
    expect(runtimeState.isPersistDirty()).toBe(true);
  });
});
