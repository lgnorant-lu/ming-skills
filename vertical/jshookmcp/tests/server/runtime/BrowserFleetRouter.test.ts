import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserFleetLeaseError,
  BrowserFleetRouter,
  InMemoryBrowserFleetLeaseStore,
} from '@server/runtime/BrowserFleetRouter';

describe('BrowserFleetRouter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'routes one million logical session keys without allocating leases',
    { timeout: 15_000 },
    () => {
      const workers = Array.from({ length: 64 }, (_, index) => ({ id: `worker-${index}` }));
      const router = new BrowserFleetRouter({
        localWorkerId: 'worker-0',
        workers,
        virtualNodes: 32,
      });
      let checksum = 0;

      for (let index = 0; index < 1_000_000; index += 1) {
        checksum ^= Number(router.getAssignedWorker(`session-${index}`).id.slice(7));
      }

      expect(checksum).toBeGreaterThanOrEqual(0);
      expect(router.getStats()).toMatchObject({
        workers: 64,
        acceptingWorkers: 64,
        locallyOwnedRoutes: 0,
        leaseStore: { activeLeases: 0 },
      });
    },
  );

  it('routes affinity keys deterministically across the accepting worker ring', async () => {
    const workers = [{ id: 'worker-a' }, { id: 'worker-b' }, { id: 'worker-c' }];
    const first = new BrowserFleetRouter({ localWorkerId: 'worker-a', workers });
    const second = new BrowserFleetRouter({ localWorkerId: 'worker-b', workers });
    const assignments = new Set<string>();

    for (let index = 0; index < 1_000; index += 1) {
      const sessionId = `session-${index}`;
      const left = first.getAssignedWorker(sessionId).id;
      const right = second.getAssignedWorker(sessionId).id;
      expect(left).toBe(right);
      assignments.add(left);
    }

    expect(assignments).toEqual(new Set(['worker-a', 'worker-b', 'worker-c']));
  });

  it('keeps a live lease stable across topology changes and fences reassignment', async () => {
    let now = 1_000;
    const store = new InMemoryBrowserFleetLeaseStore(10);
    const router = new BrowserFleetRouter(
      {
        localWorkerId: 'worker-a',
        workers: [{ id: 'worker-a' }, { id: 'worker-b' }],
        leaseTtlMs: 100,
      },
      store,
      () => now,
    );
    const sessionId = Array.from({ length: 1_000 }, (_, index) => `session-${index}`).find(
      (candidate) => router.getAssignedWorker(candidate).id === 'worker-b',
    )!;
    const first = await router.routeSession(sessionId);
    expect(first.workerId).toBe('worker-b');

    router.setWorkers([{ id: 'worker-a' }, { id: 'worker-b' }, { id: 'worker-c' }]);
    const preserved = await router.routeSession(sessionId);
    expect(preserved.workerId).toBe('worker-b');
    expect(preserved.fencingToken).toBe(first.fencingToken);

    router.setWorkers([{ id: 'worker-a' }, { id: 'worker-c' }]);
    const reassigned = await router.routeSession(sessionId);
    expect(reassigned.workerId).not.toBe('worker-b');
    expect(reassigned.fencingToken).not.toBe(first.fencingToken);

    now += 101;
    const expired = await router.routeSession(sessionId);
    expect(expired.fencingToken).not.toBe(reassigned.fencingToken);
  });

  it('honors an existing local lease while a new ring drains the session elsewhere', async () => {
    const initialWorkers = [{ id: 'worker-a' }, { id: 'worker-b' }];
    const nextWorkers = [...initialWorkers, { id: 'worker-c' }];
    const router = new BrowserFleetRouter({
      localWorkerId: 'worker-a',
      workers: initialWorkers,
    });
    const planner = new BrowserFleetRouter({
      localWorkerId: 'worker-a',
      workers: nextWorkers,
    });
    const sessionId = Array.from({ length: 10_000 }, (_, index) => `moving-${index}`).find(
      (candidate) =>
        router.getAssignedWorker(candidate).id === 'worker-a' &&
        planner.getAssignedWorker(candidate).id !== 'worker-a',
    )!;
    const first = await router.admitLocalSession(sessionId);

    router.setWorkers(nextWorkers);
    expect(router.getAssignedWorker(sessionId).id).not.toBe('worker-a');
    const preserved = await router.admitLocalSession(sessionId);

    expect(preserved.local).toBe(true);
    expect(preserved.workerId).toBe('worker-a');
    expect(preserved.fencingToken).toBe(first.fencingToken);
  });

  it('drains in two phases by preserving leases while rejecting new local sessions', async () => {
    const store = new InMemoryBrowserFleetLeaseStore(10);
    const local = new BrowserFleetRouter(
      {
        localWorkerId: 'worker-a',
        workers: [{ id: 'worker-a' }, { id: 'worker-b' }],
      },
      store,
    );
    const existingSession = Array.from({ length: 1_000 }, (_, index) => `local-${index}`).find(
      (candidate) => local.getAssignedWorker(candidate).id === 'worker-a',
    )!;
    const first = await local.admitLocalSession(existingSession);

    local.setWorkers([{ id: 'worker-a', accepting: false }, { id: 'worker-b' }]);
    expect(local.getAssignedWorker(existingSession).id).toBe('worker-b');
    await expect(local.admitLocalSession(existingSession)).resolves.toMatchObject({
      local: true,
      fencingToken: first.fencingToken,
    });
    await expect(local.claimLocalSession('new-session')).rejects.toMatchObject({
      code: 'BROWSER_FLEET_WORKER_DRAINING',
    });

    local.setWorkers([{ id: 'worker-b' }]);
    await expect(local.admitLocalSession(existingSession)).rejects.toMatchObject({
      code: 'BROWSER_FLEET_WRONG_WORKER',
      targetWorkerId: 'worker-b',
    });
    const reassigned = await local.routeSession(existingSession);
    expect(reassigned.workerId).toBe('worker-b');
    expect(reassigned.fencingToken).not.toBe(first.fencingToken);
  });

  it('pins a worker-issued MCP session locally before stateless ring admission', async () => {
    const router = new BrowserFleetRouter({
      localWorkerId: 'worker-a',
      workers: [{ id: 'worker-a' }, { id: 'worker-b' }],
    });
    const sessionId = Array.from({ length: 1_000 }, (_, index) => `issued-${index}`).find(
      (candidate) => router.getAssignedWorker(candidate).id === 'worker-b',
    )!;

    const claimed = await router.claimLocalSession(sessionId);
    const admitted = await router.admitLocalSession(sessionId);

    expect(claimed).toMatchObject({ workerId: 'worker-a', local: true });
    expect(admitted.fencingToken).toBe(claimed.fencingToken);
  });

  it('rejects wrong-worker admission with route metadata before allocating a lease', async () => {
    const router = new BrowserFleetRouter({
      localWorkerId: 'worker-a',
      workers: [
        { id: 'worker-a', endpoint: 'http://worker-a' },
        { id: 'worker-b', endpoint: 'http://worker-b' },
      ],
    });
    const sessionId = Array.from({ length: 1_000 }, (_, index) => `remote-${index}`).find(
      (candidate) => router.getAssignedWorker(candidate).id === 'worker-b',
    )!;
    await expect(router.admitLocalSession(sessionId)).rejects.toBeInstanceOf(
      BrowserFleetLeaseError,
    );
    await expect(router.admitLocalSession(sessionId)).rejects.toMatchObject({
      code: 'BROWSER_FLEET_WRONG_WORKER',
      targetWorkerId: 'worker-b',
      targetEndpoint: 'http://worker-b',
      fencingToken: null,
    });
    expect(router.getStats().leaseStore?.activeLeases).toBe(0);
  });

  it('bounds the local lease working set and honors fencing on release', async () => {
    let now = 0;
    const store = new InMemoryBrowserFleetLeaseStore(1);
    const router = new BrowserFleetRouter(
      { localWorkerId: 'local', leaseTtlMs: 100 },
      store,
      () => now,
    );
    const first = await router.routeSession('session-a');

    await expect(router.routeSession('session-b')).rejects.toMatchObject({
      code: 'BROWSER_FLEET_LEASE_CAPACITY',
    });
    await expect(
      router.releaseSession({ sessionId: first.sessionId, fencingToken: 'stale' }),
    ).resolves.toBe(false);
    await expect(router.releaseSession(first)).resolves.toBe(true);

    const second = await router.routeSession('session-b');
    expect(second.fencingToken).not.toBe(first.fencingToken);
    now += 101;
    await expect(router.routeSession('session-c')).resolves.toMatchObject({
      sessionId: 'session-c',
    });
  });

  it('keeps the lease alive while a non-preemptive browser operation is active', async () => {
    vi.useFakeTimers();
    let now = 0;
    const store = new InMemoryBrowserFleetLeaseStore(1);
    const router = new BrowserFleetRouter(
      { localWorkerId: 'local', leaseTtlMs: 90 },
      store,
      () => now,
    );
    const route = await router.admitLocalSession('session-a');
    let release!: () => void;
    const operation = router.runWithLeaseKeepAlive(
      route,
      async () =>
        await new Promise<string>((resolve) => {
          release = () => resolve('done');
        }),
    );

    now = 31;
    await vi.advanceTimersByTimeAsync(31);
    expect(await store.get('session-a', now)).toMatchObject({ expiresAt: 121 });
    expect(router.getStats()).toMatchObject({
      activeLeaseKeepAlives: 1,
      leaseRenewalCount: 2,
      leaseLossCount: 0,
    });

    release();
    await expect(operation).resolves.toMatchObject({ value: 'done' });
    expect(router.getStats().activeLeaseKeepAlives).toBe(0);
  });

  it('fails closed at the tool boundary after losing an active lease', async () => {
    vi.useFakeTimers();
    let now = 0;
    const store = new InMemoryBrowserFleetLeaseStore(1);
    const router = new BrowserFleetRouter(
      { localWorkerId: 'local', leaseTtlMs: 90 },
      store,
      () => now,
    );
    const route = await router.admitLocalSession('session-a');
    let release!: () => void;
    const operation = router.runWithLeaseKeepAlive(
      route,
      async () =>
        await new Promise<string>((resolve) => {
          release = () => resolve('stale-result');
        }),
    );
    await Promise.resolve();
    await store.release(route.sessionId, route.fencingToken);

    now = 31;
    await vi.advanceTimersByTimeAsync(31);
    release();

    await expect(operation).rejects.toMatchObject({ code: 'BROWSER_FLEET_LEASE_LOST' });
    expect(router.getStats()).toMatchObject({
      activeLeaseKeepAlives: 0,
      leaseLossCount: 1,
    });
  });
});
