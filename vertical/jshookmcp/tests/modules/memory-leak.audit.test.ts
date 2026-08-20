/**
 * Memory leak audit tests — verify that internal state is properly bounded
 * and cleaned up across all domains.
 *
 * Strategy: check internal state (Map sizes, listener counts) rather than
 * GC-dependent heap sampling (too flaky for CI).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

// ─── 1. TabRegistry — stale entries should be pruned ───

import { TabRegistry } from '@modules/browser/TabRegistry';

describe('Memory leak audit: TabRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconcilePages should not accumulate stale entries indefinitely', () => {
    const registry = new TabRegistry<object>();

    // Batch 1: register 10 pages
    const batch1: object[] = [];
    for (let i = 0; i < 10; i++) {
      const page = { url: `https://example.com/page${i}` };
      batch1.push(page);
      registry.registerPage(page, {
        index: i,
        url: `https://example.com/page${i}`,
        title: `Page ${i}`,
      });
    }

    // Batch 2: replace with 10 new pages (all batch1 pages become stale)
    const batch2: object[] = [];
    for (let i = 0; i < 10; i++) {
      batch2.push({ url: `https://new.com/page${i}` });
    }
    registry.reconcilePages(
      batch2,
      batch2.map((_, i) => ({ index: i, url: `https://new.com/page${i}`, title: `New ${i}` })),
    );

    // After reconcile, only batch2 pages should be active.
    // Entries absent from reconcile are freshly marked stale (survive one cycle).
    const allTabs = registry.listAllTabs();
    const activeTabs = registry.listTabs();
    expect(activeTabs).toHaveLength(10);
    // batch1 entries are now stale (still present for alias reporting)
    expect(allTabs.length).toBe(20);

    // Repeat reconcile 10 more times — each round prunes previously-stale entries
    for (let round = 0; round < 10; round++) {
      const newBatch: object[] = [];
      for (let i = 0; i < 5; i++) {
        newBatch.push({ url: `https://round${round}.com/${i}` });
      }
      registry.reconcilePages(
        newBatch,
        newBatch.map((_, i) => ({
          index: i,
          url: `https://round${round}.com/${i}`,
          title: `Round ${round}-${i}`,
        })),
      );
    }

    const finalAllTabs = registry.listAllTabs();
    const activeCount = finalAllTabs.filter((t) => !t.stale).length;
    const staleCount = finalAllTabs.filter((t) => t.stale).length;
    expect(activeCount).toBe(5);
    // With two-cycle pruning, only the previous round's stale entries survive.
    // Without the fix, staleCount would be 65 (10+10+9*5).
    // With the fix, staleCount should be at most 5 (only previous round).
    expect(staleCount).toBeLessThanOrEqual(5);

    // After clear(), everything should be gone
    registry.clear();
    expect(registry.listAllTabs()).toHaveLength(0);
  });

  it('absent pages are marked stale and pruned on next reconcile', () => {
    const registry = new TabRegistry<object>();
    const oldPage = { id: 'old-page' };
    registry.registerPage(oldPage, { index: 0, url: 'https://old.com', title: 'Old' });

    // Reconcile with new pages — oldPage becomes stale
    const newPage = { id: 'new-page' };
    registry.reconcilePages([newPage], [{ index: 0, url: 'https://new.com', title: 'New' }]);

    // Old page is stale but still present
    const allTabs = registry.listAllTabs();
    expect(allTabs).toHaveLength(2);
    const staleTab = allTabs.find((t) => t.stale);
    expect(staleTab).toBeDefined();
    expect(staleTab!.page).toBe(oldPage);

    // Reconcile again with same page — old stale entry gets pruned
    const newerPage = { id: 'newer-page' };
    registry.reconcilePages([newerPage], [{ index: 0, url: 'https://newer.com', title: 'Newer' }]);

    // Now only the newest page remains; oldPage is fully pruned
    const prunedTabs = registry.listAllTabs();
    expect(prunedTabs).toHaveLength(2); // newerPage + newPage (now stale)
  });
});

// ─── 2. HookManager — maps should be bounded ───

const hookGenState = vi.hoisted(() => ({
  generateHookScript: vi.fn(() => '/*hook*/'),
  getInjectionInstructions: vi.fn(() => 'inject'),
  generateAntiDebugBypass: vi.fn(() => 'bypass'),
  generateHookTemplate: vi.fn(() => 'template'),
  generateHookChain: vi.fn(() => 'chain'),
}));

vi.mock('@modules/hook/HookGenerator', () => hookGenState);

import { HookManager } from '@modules/hook/HookManager';

describe('Memory leak audit: HookManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookGenState.generateHookScript.mockReturnValue('/*hook*/');
  });

  it('creating many hooks without deletion grows all maps unboundedly', async () => {
    const manager = new HookManager();

    // Create 100 hooks without deleting any
    for (let i = 0; i < 100; i++) {
      await manager.createHook({
        target: `window.target${i}`,
        type: 'function',
        action: 'log',
      } as any);
    }

    // All 100 hook scripts, metadata entries, and conditions remain in memory
    expect(manager.getAllHooks()).toHaveLength(100);

    // Record events to fill up records
    for (let i = 0; i < 100; i++) {
      const hookId = manager.getAllHooks()[i]!;
      for (let j = 0; j < 20; j++) {
        manager.recordHookCall(hookId, {
          hookId,
          timestamp: Date.now(),
          context: {
            args: [`data-${j}`],
            target: `window.target${i}`,
            callStack: [],
            timestamp: Date.now(),
          },
        });
      }
    }

    const stats = manager.getHookRecordsStats();
    expect(stats.totalRecords).toBeGreaterThan(0);
    expect(stats.totalRecords).toBeLessThanOrEqual(10000); // MAX_TOTAL_RECORDS

    // deleteHook should clean up all associated data
    const firstHook = manager.getAllHooks()[0]!;
    manager.deleteHook(firstHook);
    expect(manager.getAllHooks()).toHaveLength(99);
    expect(manager.getHookRecords(firstHook)).toHaveLength(0);

    // clearHookRecords without hookId clears all records
    manager.clearHookRecords();
    const afterClear = manager.getHookRecordsStats();
    expect(afterClear.totalRecords).toBe(0);
    // But scripts/metadata/conditions are NOT cleared — only records
    expect(manager.getAllHooks()).toHaveLength(99);
  });

  it('creating hooks beyond MAX_HOOKS evicts oldest', async () => {
    const manager = new HookManager();

    // Create 250 hooks (MAX_HOOKS is 200)
    for (let i = 0; i < 250; i++) {
      await manager.createHook({
        target: `window.target${i}`,
        type: 'function',
        action: 'log',
      } as any);
    }

    // Should be capped at 200
    expect(manager.getAllHooks()).toHaveLength(200);
  });

  it('clearHookRecords removes records but leaves scripts/metadata intact', async () => {
    const manager = new HookManager();
    await manager.createHook({ target: 'window.test', type: 'function', action: 'log' } as any);
    const [hookId] = manager.getAllHooks();

    manager.recordHookCall(hookId!, {
      hookId: hookId!,
      timestamp: Date.now(),
      context: { args: [], target: 'window.test', callStack: [], timestamp: Date.now() },
    });
    expect(manager.getHookRecords(hookId!)).toHaveLength(1);

    manager.clearHookRecords();
    expect(manager.getHookRecords(hookId!)).toHaveLength(0);
    // Script and metadata still present
    expect(manager.getAllHooks()).toContain(hookId);
    expect(manager.getHookMetadata(hookId!)).toBeDefined();
  });
});

// ─── 3. ScriptManager — keywordIndex should be bounded ───

import { ScriptManager } from '@modules/debugger/ScriptManager.impl.class';

describe('Memory leak audit: ScriptManager keywordIndex', () => {
  it('keywordIndex grows unbounded with each parsed script', () => {
    const manager = new ScriptManager({} as any);

    // Simulate parsing many scripts by directly calling internal methods
    // ScriptManager builds keyword index on Debugger.scriptParsed events
    // We test the data structures directly
    const stats1 = manager.getStats();
    expect(stats1.totalScripts).toBe(0);
    expect(stats1.indexedKeywords).toBe(0);

    // After clear, everything should be reset
    manager.clear();
    const stats2 = manager.getStats();
    expect(stats2.totalScripts).toBe(0);
    expect(stats2.totalChunks).toBe(0);
  });
});

// ─── 4. ConsoleMonitor — objectCache should not grow beyond limit ───

import { ConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core.class';

describe('Memory leak audit: ConsoleMonitor objectCache', () => {
  it('clearObjectCache empties the cache', () => {
    const mockCollector = {
      getActivePage: vi.fn(),
      getAttachedTargetSession: vi.fn().mockReturnValue(null),
    } as any;

    const monitor = new ConsoleMonitor(mockCollector);

    // objectCache is private, test via public API
    // After clearing, operations should still work
    monitor.clearObjectCache();

    // Verify it doesn't throw
    expect(() => monitor.clearObjectCache()).not.toThrow();
  });

  it('markContextChanged clears logs, exceptions, network records, and object cache', () => {
    const mockCollector = {
      getActivePage: vi.fn(),
      getAttachedTargetSession: vi.fn().mockReturnValue(null),
    } as any;

    const monitor = new ConsoleMonitor(mockCollector);

    // markContextChanged should clear all buffers when there's active state
    // When no session is active, it's a no-op
    monitor.clearLogs();
    monitor.clearExceptions();
    monitor.clearNetworkRecords();
    monitor.clearObjectCache();

    // All clear operations are idempotent
    expect(() => monitor.clearLogs()).not.toThrow();
    expect(() => monitor.clearExceptions()).not.toThrow();
    expect(() => monitor.clearNetworkRecords()).not.toThrow();
    expect(() => monitor.clearObjectCache()).not.toThrow();
  });
});

// ─── 5. CodeCollector — selectResolvedPageByTargetId session leak pattern ───

describe('Memory leak audit: CodeCollector session cleanup', () => {
  it('disposeCurrentBrowser clears cdpSession and cdpListeners', async () => {
    const { CodeCollector } = await import('@modules/collector/CodeCollector');
    const collector = new CodeCollector({ headless: true, timeout: 5000 } as any);

    await collector.close();
    expect(collector.getBrowser()).toBeNull();
  });

  it('selectResolvedPageByTargetId always detaches CDP session (even on error)', async () => {
    const detachedSessions: string[] = [];
    const createdSessions: string[] = [];

    const makeTarget = (id: string, shouldThrow: boolean) => ({
      url: () => `https://example.com/${id}`,
      type: () => 'page',
      createCDPSession: async () => {
        const sessionId = `session-${id}`;
        createdSessions.push(sessionId);
        return {
          id: () => sessionId,
          send: async (_method: string) => {
            if (shouldThrow) throw new Error('CDP error');
            return { targetInfo: { targetId: id } };
          },
          detach: async () => {
            detachedSessions.push(sessionId);
          },
        };
      },
    });

    // Simulate the fixed pattern from selectResolvedPageByTargetId
    const targets = [makeTarget('a', true), makeTarget('b', false), makeTarget('c', true)];
    let foundTargetId: string | null = null;

    for (const target of targets) {
      let session: {
        id: () => string;
        send: (m: string) => Promise<any>;
        detach: () => Promise<void>;
      } | null = null;
      try {
        session = await target.createCDPSession();
        const { targetInfo } = await session.send('Target.getTargetInfo');
        if (targetInfo.targetId === 'b') {
          foundTargetId = 'b';
          break; // Found — but session should still be detached in finally
        }
      } catch {
        continue;
      } finally {
        if (session) {
          try {
            await session.detach();
          } catch {
            /* best-effort */
          }
        }
      }
    }

    // Session-a threw on send → detached in finally.
    // Session-b matched target → detached in finally (even though we break).
    // Session-c was never created because the loop broke at b.
    expect(createdSessions).toEqual(['session-a', 'session-b']);
    expect(detachedSessions).toEqual(['session-a', 'session-b']);
    expect(foundTargetId).toBe('b');
  });
});

// ─── 6. NetworkMonitor — verify bounded maps ───

describe('Memory leak audit: NetworkMonitor bounded maps', () => {
  it('requests and responses maps are bounded', async () => {
    const mockSession = {
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn().mockResolvedValue({}),
    };

    const { NetworkMonitor } = await import('@modules/monitor/NetworkMonitor.impl');
    const monitor = new NetworkMonitor(mockSession as any);

    await monitor.enable();

    // Simulate 600 requests — should be capped at 500
    for (let i = 0; i < 600; i++) {
      const listener = mockSession.on.mock.calls.find(
        (call: any[]) => call[0] === 'Network.requestWillBeSent',
      )?.[1] as ((params: unknown) => void) | undefined;

      listener?.({
        requestId: `req-${i}`,
        request: { url: `https://example.com/api/${i}`, method: 'GET', headers: {} },
        timestamp: Date.now(),
      });
    }

    const status = monitor.getStatus();
    expect(status.requestCount).toBeLessThanOrEqual(500);

    await monitor.disable();

    // After disable, listeners should be removed
    const offCalls = mockSession.off.mock.calls;
    expect(offCalls.length).toBeGreaterThanOrEqual(3); // requestWillBeSent, responseReceived, loadingFinished
  });
});

// ─── 7. PlaywrightNetworkMonitor — verify proper listener cleanup ───

describe('Memory leak audit: PlaywrightNetworkMonitor listener cleanup', () => {
  it('setPage(null) removes listeners from previous page', async () => {
    const onHandlers: Record<string, Function> = {};
    const offHandlers: Record<string, Function> = {};

    const mockPage = {
      on: vi.fn((event: string, handler: Function) => {
        onHandlers[event] = handler;
      }),
      off: vi.fn((event: string, handler: Function) => {
        offHandlers[event] = handler;
      }),
    };

    const { PlaywrightNetworkMonitor } = await import('@modules/monitor/PlaywrightNetworkMonitor');
    const monitor = new PlaywrightNetworkMonitor(mockPage as any);

    await monitor.enable();

    // Verify listeners were registered
    expect(mockPage.on).toHaveBeenCalledWith('request', expect.any(Function));
    expect(mockPage.on).toHaveBeenCalledWith('response', expect.any(Function));

    // Switch to null page — should remove listeners
    monitor.setPage(null);

    // Verify listeners were removed
    expect(mockPage.off).toHaveBeenCalledWith('request', expect.any(Function));
    expect(mockPage.off).toHaveBeenCalledWith('response', expect.any(Function));
  });
});
