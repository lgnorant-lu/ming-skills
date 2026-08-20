import { describe, expect, it, vi } from 'vitest';
import {
  BrowserSessionCoordinator,
  parseBrowserSessionSnapshot,
} from '@server/runtime/BrowserSessionCoordinator';

describe('BrowserSessionCoordinator', () => {
  it('provides isolated TabRegistry instances per session', () => {
    const collector = {
      selectPage: vi.fn(async () => undefined),
      attachCdpTarget: vi.fn(async () => ({ targetId: 't-1' })),
    } as any;
    const coordinator = new BrowserSessionCoordinator(() => collector);

    const a = coordinator.getTabRegistry('session-a');
    const b = coordinator.getTabRegistry('session-b');

    expect(a).not.toBe(b);

    a.setSharedContext('owner', 'a');
    b.setSharedContext('owner', 'b');

    expect(a.getSharedContext('owner').value).toBe('a');
    expect(b.getSharedContext('owner').value).toBe('b');
  });

  it('restores saved page context when switching sessions', async () => {
    const collector = {
      selectPage: vi.fn(async () => undefined),
      attachCdpTarget: vi.fn(async () => ({ targetId: 't-1' })),
    } as any;
    const coordinator = new BrowserSessionCoordinator(() => collector);

    coordinator.noteToolResult('session-a', 'browser_attach', {
      currentTabIndex: 2,
      currentPageId: 'tab-2',
      currentTargetId: null,
    });
    coordinator.noteToolResult('session-b', 'browser_attach_cdp_target', {
      currentTabIndex: 4,
      currentPageId: 'tab-4',
      currentTargetId: 'target-4',
    });

    await coordinator.restoreSessionContext('session-a');
    await coordinator.restoreSessionContext('session-b');

    expect(collector.selectPage).toHaveBeenNthCalledWith(1, 2);
    expect(collector.selectPage).toHaveBeenNthCalledWith(2, 4);
    expect(collector.attachCdpTarget).toHaveBeenCalledWith('target-4');
  });

  it('drops state when the owning HTTP session closes', () => {
    const coordinator = new BrowserSessionCoordinator(() => null);
    const original = coordinator.getTabRegistry('session-a');
    original.setSharedContext('owner', 'a');

    expect(coordinator.dropSession('session-a')).toBe(true);
    expect(coordinator.dropSession('session-a')).toBe(false);
    expect(coordinator.getTabRegistry('session-a')).not.toBe(original);
  });

  it('tracks browser ownership independently from tab state', () => {
    const coordinator = new BrowserSessionCoordinator(() => null);

    expect(coordinator.claimBrowserLease('session-a')).toEqual({
      alreadyOwned: false,
      totalOwners: 1,
    });
    expect(coordinator.getBrowserLease('session-b')).toEqual({
      owned: false,
      otherOwners: 1,
      totalOwners: 1,
    });
    coordinator.claimBrowserLease('session-b');
    expect(coordinator.releaseBrowserLease('session-a')).toEqual({
      released: true,
      remainingOwners: 1,
    });
  });

  it('keeps tab workflow shared context isolated across ten sessions', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null);
    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`);

    await Promise.all(
      sessionIds.map(
        async (sessionId, index) =>
          await coordinator.runExclusive(sessionId, async () => {
            coordinator
              .getTabRegistry(coordinator.getCurrentSessionId())
              .setSharedContext('owner', {
                sessionId,
                index,
              });
          }),
      ),
    );

    for (const [index, sessionId] of sessionIds.entries()) {
      expect(coordinator.getTabRegistry(sessionId).getSharedContext('owner')).toEqual({
        found: true,
        value: { sessionId, index },
      });
    }
  });

  it('charges an active session before serving nine waiting peers', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 64,
      maxPendingPerSession: 16,
      waitTimeoutMs: 5_000,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const executionOrder: string[] = [];

    const active = coordinator.runExclusive('session-0', async () => {
      executionOrder.push('session-0-active');
      await activeGate;
    });
    const noisy = Array.from({ length: 9 }, (_, index) =>
      coordinator.runExclusive('session-0', async () => {
        executionOrder.push(`session-0-${index}`);
      }),
    );
    const peers = Array.from({ length: 9 }, (_, index) => {
      const sessionId = `session-${index + 1}`;
      return coordinator.runExclusive(sessionId, async () => {
        executionOrder.push(sessionId);
      });
    });

    expect(coordinator.getQueueStats()).toMatchObject({
      pending: 18,
      pendingSessions: 10,
      activeSessionId: 'session-0',
    });
    releaseActive();
    await Promise.all([active, ...noisy, ...peers]);

    expect(executionOrder.slice(0, 11)).toEqual([
      'session-0-active',
      'session-1',
      'session-2',
      'session-3',
      'session-4',
      'session-5',
      'session-6',
      'session-7',
      'session-8',
      'session-9',
      'session-0-0',
    ]);
    expect(coordinator.getQueueStats()).toMatchObject({
      pending: 0,
      pendingSessions: 0,
      activeSessionId: null,
    });
  });

  it('enforces global and per-session pending limits', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 3,
      maxPendingPerSession: 2,
      waitTimeoutMs: 5_000,
      reservedPendingPerSession: 0,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('session-0', async () => await activeGate);
    const sameSession = [
      coordinator.runExclusive('session-0', async () => undefined),
      coordinator.runExclusive('session-0', async () => undefined),
    ];

    await expect(
      coordinator.runExclusive('session-0', async () => undefined),
    ).rejects.toMatchObject({ code: 'BROWSER_SESSION_QUEUE_FULL' });

    const otherSession = coordinator.runExclusive('session-1', async () => undefined);
    await expect(
      coordinator.runExclusive('session-2', async () => undefined),
    ).rejects.toMatchObject({ code: 'BROWSER_SESSION_QUEUE_FULL' });
    expect(coordinator.getQueueStats().pending).toBe(3);

    releaseActive();
    await Promise.all([active, ...sameSession, otherSession]);
  });

  it('removes and rejects requests that exceed the configured queue wait timeout', async () => {
    vi.useFakeTimers();
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 4,
      maxPendingPerSession: 2,
      waitTimeoutMs: 50,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('session-0', async () => await activeGate);
    const queued = coordinator.runExclusive('session-1', async () => undefined);
    const rejected = expect(queued).rejects.toMatchObject({
      code: 'BROWSER_SESSION_QUEUE_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(coordinator.getQueueStats().pending).toBe(0);

    releaseActive();
    await active;
    vi.useRealTimers();
  });

  it('uses one deadline timer for many pending sessions', async () => {
    vi.useFakeTimers();
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 128,
      maxPendingPerSession: 2,
      waitTimeoutMs: 50,
      reservedPendingPerSession: 0,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('active', async () => await activeGate);
    const queued = Array.from({ length: 100 }, (_, index) =>
      coordinator.runExclusive(`session-${index}`, async () => undefined),
    );
    const settled = Promise.allSettled(queued);

    expect(vi.getTimerCount()).toBe(1);
    expect(coordinator.getQueueStats()).toMatchObject({
      pending: 100,
      readySessions: 100,
      deadlineTimerActive: true,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
    expect(coordinator.getQueueStats()).toMatchObject({
      pending: 0,
      readySessions: 0,
      deadlineTimerActive: false,
    });

    releaseActive();
    await active;
    vi.useRealTimers();
  });

  it('cancels queued work in O(1) without disturbing session FIFO', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 8,
      maxPendingPerSession: 4,
      waitTimeoutMs: 5_000,
      reservedPendingPerSession: 0,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('active', async () => await activeGate);
    const controller = new AbortController();
    const cancelled = coordinator.runExclusive(
      'session-a',
      { signal: controller.signal },
      async () => 'cancelled',
    );
    const survivor = coordinator.runExclusive('session-a', async () => 'survived');
    const cancellation = expect(cancelled).rejects.toMatchObject({
      code: 'BROWSER_SESSION_QUEUE_CANCELLED',
    });

    controller.abort();
    await cancellation;
    expect(coordinator.getQueueStats().pending).toBe(1);

    releaseActive();
    await expect(survivor).resolves.toBe('survived');
    await active;
  });

  it('rejects queued work when its HTTP session closes', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 4,
      maxPendingPerSession: 2,
      waitTimeoutMs: 5_000,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('session-0', async () => await activeGate);
    coordinator.getTabRegistry('session-closing');
    const queued = coordinator.runExclusive('session-closing', async () => undefined);
    const rejected = expect(queued).rejects.toMatchObject({ code: 'BROWSER_SESSION_CLOSED' });

    expect(coordinator.dropSession('session-closing')).toBe(true);
    await rejected;
    expect(coordinator.getQueueStats()).toMatchObject({ pending: 0, pendingSessions: 0 });

    releaseActive();
    await active;
  });

  it('uses deficit credits so an expensive request survives a continuous cheap backlog', async () => {
    let now = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      {
        maxPending: 64,
        maxPendingPerSession: 32,
        waitTimeoutMs: 5_000,
        quantumMs: 10,
        agingMs: 4_000,
        reservedPendingPerSession: 0,
      },
      () => now,
    );
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const order: string[] = [];

    const active = coordinator.runExclusive('active', { costHintMs: 1 }, async () => {
      await activeGate;
    });
    const expensive = coordinator.runExclusive(
      'expensive',
      { toolName: 'page_navigate', costHintMs: 100 },
      async () => {
        order.push('expensive');
        now += 100;
      },
    );
    const cheap = Array.from({ length: 20 }, (_, index) =>
      coordinator.runExclusive('cheap', { toolName: 'browser_status', costHintMs: 1 }, async () => {
        order.push(`cheap-${index}`);
        now += 1;
      }),
    );

    releaseActive();
    await Promise.all([active, expensive, ...cheap]);

    expect(order.indexOf('expensive')).toBeGreaterThan(0);
    expect(order.indexOf('expensive')).toBeLessThanOrEqual(10);
    expect(coordinator.getQueueStats()).toMatchObject({
      dispatchCount: 22,
      pending: 0,
    });
  });

  it('promotes the oldest aged session at a dispatch boundary', async () => {
    let now = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      {
        maxPending: 16,
        maxPendingPerSession: 8,
        waitTimeoutMs: 5_000,
        quantumMs: 10,
        agingMs: 50,
        reservedPendingPerSession: 0,
      },
      () => now,
    );
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const order: string[] = [];

    const active = coordinator.runExclusive('active', async () => await activeGate);
    const old = coordinator.runExclusive('old', { costHintMs: 30_000 }, async () => {
      order.push('old');
    });
    const recent = coordinator.runExclusive('recent', { costHintMs: 1 }, async () => {
      order.push('recent');
    });
    now = 100;
    releaseActive();
    await Promise.all([active, old, recent]);

    expect(order).toEqual(['old', 'recent']);
    expect(coordinator.getQueueStats().agedDispatchCount).toBeGreaterThanOrEqual(1);
  });

  it('learns bounded tool costs from active service time only', async () => {
    let now = 0;
    const coordinator = new BrowserSessionCoordinator(
      () => null,
      { costEwmaAlpha: 0.2 },
      () => now,
    );

    await coordinator.runExclusive('session-a', { toolName: 'page_navigate' }, async () => {
      now += 1_000;
    });
    expect(coordinator.getToolCostStats('page_navigate')).toEqual({
      estimateMs: 1_000,
      samples: 1,
    });

    await coordinator.runExclusive('session-a', { toolName: 'page_navigate' }, async () => {
      now += 500;
    });
    expect(coordinator.getToolCostStats('page_navigate')).toEqual({
      estimateMs: 900,
      samples: 2,
    });
  });

  it('reserves admission slots for all ten sessions under saturation', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null, {
      maxPending: 19,
      maxPendingPerSession: 16,
      waitTimeoutMs: 5_000,
      expectedConcurrency: 10,
      reservedPendingPerSession: 1,
    });
    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const active = coordinator.runExclusive('session-0', async () => await activeGate);
    const sessionZero = Array.from({ length: 10 }, () =>
      coordinator.runExclusive('session-0', async () => undefined),
    );

    await expect(
      coordinator.runExclusive('session-0', async () => undefined),
    ).rejects.toMatchObject({ code: 'BROWSER_SESSION_QUEUE_FULL' });
    const lateSessions = Array.from({ length: 9 }, (_, index) =>
      coordinator.runExclusive(`session-${index + 1}`, async () => undefined),
    );
    expect(coordinator.getQueueStats()).toMatchObject({ pending: 19, admissionLimit: 19 });

    releaseActive();
    await Promise.all([active, ...sessionZero, ...lateSessions]);
  });

  it('rejects cross-session nested entry instead of deadlocking the drain loop', async () => {
    const coordinator = new BrowserSessionCoordinator(() => null);

    await coordinator.runExclusive('session-a', async () => {
      await expect(
        coordinator.runExclusive('session-b', async () => undefined),
      ).rejects.toMatchObject({ code: 'BROWSER_SESSION_CROSS_SESSION_REENTRY' });
    });
  });

  it('reads nested tab context without clearing absent snapshot fields', () => {
    const snapshot = parseBrowserSessionSnapshot({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            _tabContext: { tabIndex: 3, pageId: 'tab-3' },
          }),
        },
      ],
    });

    expect(snapshot).toEqual({ currentTabIndex: 3, currentPageId: 'tab-3' });
    expect(
      parseBrowserSessionSnapshot({
        content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      }),
    ).toBeNull();
  });
});
