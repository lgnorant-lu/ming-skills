/**
 * Behavioural tests for the D1 snapshot session cache.
 *
 * Two layers:
 *  1. {@link DartSnapshotSessionManager} unit tests — inject a mock loader so
 *     `loadSnapshot` call counts are observable. Pins the cache contract:
 *     create caches, getSession does NOT re-parse, destroy/cap/TTL/sweep all
 *     behave, and listSessions never leaks the snapshot instance.
 *  2. Handler-layer tests — `vi.mock` DartAotLoader + DartAotExecutor so the
 *     `dart_create_session` → `dart_list_functions({ sessionId })` flow can be
 *     proven to skip the re-parse (the whole point of D1).
 *
 * The core assertion is call-count: once a session exists, subsequent
 * dynamic-tool calls with that sessionId must NOT increment `loadSnapshot`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DartSnapshotSessionManager } from '@modules/native-emulator/dart/DartSnapshotSessionManager';
import type { DartAotLoader, LoadedSnapshot } from '@modules/native-emulator/dart/DartAotLoader';

/** Minimal valid-enough LoadedSnapshot shape for cache accounting (not parsed here). */
function makeFakeSnapshot(): LoadedSnapshot {
  return {
    header: {
      magic: 0xf5f5dcdc,
      kind: 'full',
      features: 0n,
      baseObjects: 0,
      numObjects: 0,
      numClusters: 0,
      fieldTableLen: 0,
      codeStartOffset: 0n,
      dataStartOffset: 0n,
    },
    clusters: [],
    codeObjects: [],
    objectPools: [],
    rawBytes: new Uint8Array(),
  } as unknown as LoadedSnapshot;
}

/** A stub DartAotLoader whose loadSnapshot counts calls and returns a fixed snapshot. */
function makeMockLoader(snapshot: LoadedSnapshot) {
  const calls = { loadSnapshot: 0 };
  const loader = {
    loadSnapshot: vi.fn(async (_path: string) => {
      calls.loadSnapshot++;
      return snapshot;
    }),
  };
  return { loader: loader as unknown as DartAotLoader, calls };
}

describe('DartSnapshotSessionManager (D1 cache)', () => {
  it('createSession returns a fresh id and parses the snapshot exactly once', async () => {
    const { loader, calls } = makeMockLoader(makeFakeSnapshot());
    const mgr = new DartSnapshotSessionManager();
    const session = await mgr.createSession('/x/libapp.so', loader);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.path).toBe('/x/libapp.so');
    expect(calls.loadSnapshot).toBe(1);
    mgr.dispose();
  });

  it('getSession hits the cache without re-parsing and refreshes lastUsedAt', async () => {
    const { loader, calls } = makeMockLoader(makeFakeSnapshot());
    const mgr = new DartSnapshotSessionManager();
    const session = await mgr.createSession('/x', loader);
    const before = session.lastUsedAt;
    // small delay so Date.now() can advance
    await new Promise((r) => setTimeout(r, 5));
    const hit = mgr.getSession(session.id);
    expect(hit).toBeDefined();
    expect(hit?.snapshot).toBe(session.snapshot);
    expect(
      (hit as DartSnapshotSessionManager extends never ? never : { lastUsedAt: number }).lastUsedAt,
    ).toBeGreaterThanOrEqual(before);
    expect(calls.loadSnapshot).toBe(1); // no re-parse on cache hit
    mgr.dispose();
  });

  it('getSession returns undefined for an unknown id (no throw)', () => {
    const mgr = new DartSnapshotSessionManager();
    expect(mgr.getSession('nope')).toBeUndefined();
    mgr.dispose();
  });

  it('destroySession returns true for a known session and false for unknown', async () => {
    const { loader } = makeMockLoader(makeFakeSnapshot());
    const mgr = new DartSnapshotSessionManager();
    const session = await mgr.createSession('/x', loader);
    expect(mgr.destroySession(session.id)).toBe(true);
    expect(mgr.count()).toBe(0);
    expect(mgr.destroySession(session.id)).toBe(false);
    mgr.dispose();
  });

  it('createSession throws once maxSessions is reached', async () => {
    const mgr = new DartSnapshotSessionManager({ maxSessions: 1 });
    const a = makeMockLoader(makeFakeSnapshot());
    await mgr.createSession('/a', a.loader);
    const b = makeMockLoader(makeFakeSnapshot());
    await expect(mgr.createSession('/b', b.loader)).rejects.toThrow(/session limit reached/);
    mgr.dispose();
  });

  it('listSessions exposes metadata but never the snapshot instance', async () => {
    const { loader } = makeMockLoader(makeFakeSnapshot());
    const mgr = new DartSnapshotSessionManager();
    const session = await mgr.createSession('/x', loader);
    const list = mgr.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(session.id);
    expect(list[0]?.path).toBe('/x');
    // SessionInfo has no `snapshot` key — the parsed structure must not leak.
    expect(list[0]).not.toHaveProperty('snapshot');
    mgr.dispose();
  });

  it('idle TTL sweep reaps untouched sessions', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    try {
      const mgr = new DartSnapshotSessionManager({ idleTtlMs: 1000, sweepIntervalMs: 500 });
      const { loader } = makeMockLoader(makeFakeSnapshot());
      const session = await mgr.createSession('/x', loader);
      expect(mgr.count()).toBe(1);
      // Advance past the idle TTL + a sweep tick.
      await vi.advanceTimersByTimeAsync(1500);
      expect(mgr.count()).toBe(0);
      expect(mgr.getSession(session.id)).toBeUndefined();
      mgr.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispose clears all sessions and stops the sweep (idempotent)', async () => {
    const { loader } = makeMockLoader(makeFakeSnapshot());
    const mgr = new DartSnapshotSessionManager();
    await mgr.createSession('/x', loader);
    expect(mgr.count()).toBe(1);
    mgr.dispose();
    expect(mgr.count()).toBe(0);
    // second dispose must not throw
    expect(() => mgr.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Handler-layer: dart_create_session / dart_destroy_session + sessionId reuse
// ---------------------------------------------------------------------------

const loaderCalls = vi.hoisted(() => ({ loadSnapshot: 0 }));
const executorCalls = vi.hoisted(() => ({ load: 0, loadFromSnapshot: 0, call: 0 }));
const fakeSnapshot = vi.hoisted(() => ({ current: makeFakeSnapshot() }));

vi.mock('@modules/native-emulator/dart/DartAotLoader', () => ({
  DartAotLoader: class MockDartAotLoader {
    async loadSnapshot(_path: string) {
      loaderCalls.loadSnapshot++;
      return fakeSnapshot.current as never;
    }
  },
}));

vi.mock('@modules/native-emulator/dart/DartAotExecutor', () => ({
  DartAotExecutor: class MockDartAotExecutor {
    async load(_path: string) {
      executorCalls.load++;
    }
    loadFromSnapshot(_snapshot: unknown) {
      executorCalls.loadFromSnapshot++;
    }
    async call(_opts: unknown) {
      executorCalls.call++;
      return { returnValue: 0n, steps: 1, trace: [] };
    }
  },
}));

import manifest from '@server/domains/dart-inspector/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';

describe('dart-inspector session cache handlers', () => {
  let handler: Awaited<ReturnType<typeof manifest.ensure>>;
  // Each test gets a fresh handler so the session map starts empty and the
  // global loadSnapshot counter can be reasoned about precisely.
  beforeEach(async () => {
    loaderCalls.loadSnapshot = 0;
    executorCalls.load = 0;
    executorCalls.loadFromSnapshot = 0;
    executorCalls.call = 0;
    handler = await manifest.ensure({} as MCPServerContext);
  });
  afterEach(() => {
    // The session cache's sweep timer is unref'd so it never blocks process
    // exit. No test-only seam is added to the handler — we simply let vitest
    // garbage-collect the handler + its session map between tests; every test
    // builds a fresh handler via manifest.ensure with an empty session map.
  });

  it('dart_create_session returns a sessionId + statistics and parses the snapshot once', async () => {
    const res = await handler.handleDartCreateSession({ libappPath: '/fake/libapp.so' });
    const body = R.parse<{
      success: boolean;
      sessionId: string;
      statistics: { codeObjectCount: number };
      hint: string;
    }>(res);
    expect(body.success).toBe(true);
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.statistics.codeObjectCount).toBe(0);
    expect(typeof body.hint).toBe('string');
    expect(loaderCalls.loadSnapshot).toBe(1);
  });

  it('dart_create_session surfaces a validation error when neither path is given', async () => {
    const res = await handler.handleDartCreateSession({});
    const body = R.parse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('dart_list_functions with sessionId reuses the cache (no second parse)', async () => {
    const create = await handler.handleDartCreateSession({ libappPath: '/fake/libapp.so' });
    const createBody = R.parse<{ sessionId: string }>(create);
    expect(loaderCalls.loadSnapshot).toBe(1);

    const list = await handler.handleDartListFunctions({ sessionId: createBody.sessionId });
    const listBody = R.parse<{ success: boolean; functions: unknown[]; totalCount: number }>(list);
    expect(listBody.success).toBe(true);
    expect(listBody.totalCount).toBe(0);
    // The whole point of D1: session reuse must NOT trigger a second parse.
    expect(loaderCalls.loadSnapshot).toBe(1);
  });

  it('dart_list_functions without sessionId still works (backward-compatible fresh parse)', async () => {
    const list = await handler.handleDartListFunctions({ libappPath: '/fake/libapp.so' });
    const listBody = R.parse<{ success: boolean; totalCount: number }>(list);
    expect(listBody.success).toBe(true);
    expect(loaderCalls.loadSnapshot).toBe(1);
  });

  it('an unknown sessionId yields NOT_FOUND, not a generic crash', async () => {
    const res = await handler.handleDartListFunctions({
      sessionId: '00000000-0000-0000-0000-000000000000',
    });
    const body = R.parse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/session/i);
  });

  it('omitting both sessionId and path yields a validation error', async () => {
    const res = await handler.handleDartListFunctions({});
    const body = R.parse<{ success: boolean; error: string }>(res);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('dart_call_function with sessionId takes the loadFromSnapshot path (executor.load not called)', async () => {
    const create = await handler.handleDartCreateSession({ libappPath: '/fake/libapp.so' });
    const { sessionId } = R.parse<{ sessionId: string }>(create);

    const res = await handler.handleDartCallFunction({
      sessionId,
      functionName: 'main',
    });
    const body = R.parse<{ success: boolean; result: { steps: number } }>(res);
    expect(body.success).toBe(true);
    expect(executorCalls.loadFromSnapshot).toBe(1);
    expect(executorCalls.load).toBe(0); // session reuse skips executor.load
    expect(executorCalls.call).toBe(1);
  });

  it('dart_destroy_session returns destroyed=true for a live session and false for unknown', async () => {
    const create = await handler.handleDartCreateSession({ libappPath: '/fake/libapp.so' });
    const { sessionId } = R.parse<{ sessionId: string }>(create);

    const destroyed = await handler.handleDartDestroySession({ sessionId });
    const dBody = R.parse<{ success: boolean; destroyed: boolean }>(destroyed);
    expect(dBody.success).toBe(true);
    expect(dBody.destroyed).toBe(true);

    // After destroy, the cache is gone — a subsequent list_functions with that
    // sessionId must fail with NOT_FOUND rather than silently re-parsing.
    const before = loaderCalls.loadSnapshot;
    const list = await handler.handleDartListFunctions({ sessionId });
    const listBody = R.parse<{ success: boolean; error: string }>(list);
    expect(listBody.success).toBe(false);
    expect(loaderCalls.loadSnapshot).toBe(before); // no re-parse attempted

    const again = await handler.handleDartDestroySession({ sessionId });
    const aBody = R.parse<{ destroyed: boolean }>(again);
    expect(aBody.destroyed).toBe(false);
  });
});
