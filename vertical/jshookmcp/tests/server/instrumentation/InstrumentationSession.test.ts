import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InstrumentationSessionManager,
  MAX_ARCHIVED_SESSIONS,
  MAX_SESSIONS,
} from '@server/instrumentation/InstrumentationSession';
import { InstrumentationType } from '@server/instrumentation/types';
import type { ToolResponse } from '@server/types';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

function jsonToolResponse(payload: unknown): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

describe('InstrumentationSession', () => {
  let manager: InstrumentationSessionManager;

  beforeEach(() => {
    manager = new InstrumentationSessionManager();
  });

  // ── Session Lifecycle ──

  describe('lifecycle', () => {
    it('creates session with unique id and empty operations list', () => {
      const session = manager.createSession();
      expect(session.id).toBeTruthy();
      expect(session.operationCount).toBe(0);
      expect(session.artifactCount).toBe(0);
      expect(session.status).toBe('active');
    });

    it('creates session with optional name', () => {
      const session = manager.createSession('my-session');
      expect(session.name).toBe('my-session');
    });

    it('creates sessions with unique ids', () => {
      const s1 = manager.createSession();
      const s2 = manager.createSession();
      expect(s1.id).not.toBe(s2.id);
    });

    it('lists all active sessions', () => {
      manager.createSession('a');
      manager.createSession('b');
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.status === 'active')).toBe(true);
    });

    it('destroys session and archives it (removed from active registry)', () => {
      const session = manager.createSession();
      const result = manager.destroySession(session.id);
      expect(result.archived).toBe(true);
      expect(manager.getSession(session.id)?.status).toBe('destroyed');
      expect(manager.listSessions()).toHaveLength(0);
    });

    it('destroyed sessions are excluded from listSessions', () => {
      const s1 = manager.createSession();
      manager.createSession();
      manager.destroySession(s1.id);
      expect(manager.listSessions()).toHaveLength(1);
    });

    it('prevents operations on destroyed session', () => {
      const session = manager.createSession();
      manager.destroySession(session.id);
      expect(() =>
        manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'window.fetch', {}),
      ).toThrow(/not found/i);
    });
  });

  // ── Read-only archive on destroy ──

  describe('archiving', () => {
    it('keeps a destroyed session readable via getSessionSnapshot so export still works', () => {
      const s = manager.createSession('audit');
      const op = manager.registerOperation(s.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [1] });

      const result = manager.destroySession(s.id);

      expect(result.archived).toBe(true);
      expect(result.unexportedArtifactCount).toBe(1);

      const snapshot = manager.getSessionSnapshot(s.id);
      expect(snapshot).toBeDefined();
      expect(snapshot!.session.status).toBe('destroyed');
      expect(snapshot!.operations).toHaveLength(1);
      expect(snapshot!.artifacts).toHaveLength(1);
    });

    it('reports zero unexported artifacts when a session had none', () => {
      const s = manager.createSession('empty');
      const result = manager.destroySession(s.id);
      expect(result.unexportedArtifactCount).toBe(0);
    });

    it('evicts the oldest archived session once the cap is exceeded', () => {
      const ids: string[] = [];
      for (let i = 0; i < MAX_ARCHIVED_SESSIONS + 1; i++) {
        const s = manager.createSession(`s${i}`);
        ids.push(s.id);
        manager.destroySession(s.id);
      }

      expect((manager as any).archivedSessions.size).toBe(MAX_ARCHIVED_SESSIONS);
      // First destroyed is the oldest → evicted.
      expect(manager.getSessionSnapshot(ids[0]!)).toBeUndefined();
      // Latest destroyed is retained.
      expect(manager.getSessionSnapshot(ids[ids.length - 1]!)).toBeDefined();
    });

    it('getSession falls back to the archive for destroyed sessions', () => {
      const s = manager.createSession('status-probe');
      manager.destroySession(s.id);
      const session = manager.getSession(s.id);
      expect(session).toBeDefined();
      expect(session!.status).toBe('destroyed');
    });

    it('getSessionStats reads counts from the archived session', () => {
      const s = manager.createSession('stats-probe');
      const op = manager.registerOperation(s.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });
      manager.destroySession(s.id);
      expect(manager.getSessionStats(s.id)).toEqual({ operationCount: 1, artifactCount: 1 });
    });
  });

  // ── Operation Registration ──

  describe('registerOperation', () => {
    it('registers before-load inject operation', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.BEFORE_LOAD_INJECT,
        'console.log override',
        { code: '...' },
      );
      expect(op.type).toBe(InstrumentationType.BEFORE_LOAD_INJECT);
      expect(op.sessionId).toBe(session.id);
      expect(op.target).toBe('console.log override');
      expect(op.status).toBe('active');
    });

    it('registers runtime function hook', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.RUNTIME_HOOK,
        'window.fetch',
        { captureArgs: true },
      );
      expect(op.type).toBe(InstrumentationType.RUNTIME_HOOK);
    });

    it('registers XHR/Fetch intercept', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.NETWORK_INTERCEPT,
        withPath(TEST_URLS.api, '*'),
        {},
      );
      expect(op.type).toBe(InstrumentationType.NETWORK_INTERCEPT);
    });

    it('registers function trace', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'CryptoJS.AES.encrypt',
        {},
      );
      expect(op.type).toBe(InstrumentationType.FUNCTION_TRACE);
    });

    it('associates operation with session and increments count', () => {
      const session = manager.createSession();
      manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.registerOperation(session.id, InstrumentationType.FUNCTION_TRACE, 'y', {});
      const updated = manager.getSession(session.id)!;
      expect(updated.operationCount).toBe(2);
    });

    it('throws for non-existent session', () => {
      expect(() =>
        manager.registerOperation('no-such-id', InstrumentationType.RUNTIME_HOOK, 'x', {}),
      ).toThrow();
    });
  });

  // ── Artifact Production ──

  describe('artifacts', () => {
    it('records artifact with hook data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'fn', {});
      const artifact = manager.recordArtifact(op.id, {
        args: [1, 'hello'],
        returnValue: 42,
        callStack: 'fn@main.js:10',
      });
      expect(artifact.operationId).toBe(op.id);
      expect(artifact.sessionId).toBe(session.id);
      expect(artifact.type).toBe(InstrumentationType.RUNTIME_HOOK);
      expect(artifact.data.args).toEqual([1, 'hello']);
      expect(artifact.data.returnValue).toBe(42);
    });

    it('records artifact with intercept data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.NETWORK_INTERCEPT,
        'api',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        url: withPath(TEST_URLS.api, 'login'),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { user: 'test' },
      });
      expect(artifact.data.url).toBe(withPath(TEST_URLS.api, 'login'));
      expect(artifact.data.method).toBe('POST');
    });

    it('records artifact with trace data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'enc',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        functionName: 'encrypt',
        executionTimeMs: 12.5,
      });
      expect(artifact.data.functionName).toBe('encrypt');
      expect(artifact.data.executionTimeMs).toBe(12.5);
    });

    it('records artifact with inject data', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(
        session.id,
        InstrumentationType.BEFORE_LOAD_INJECT,
        'script',
        {},
      );
      const artifact = manager.recordArtifact(op.id, {
        scriptContent: 'window.x = 1;',
        injectionPoint: 'before-load',
      });
      expect(artifact.data.scriptContent).toBe('window.x = 1;');
      expect(artifact.data.injectionPoint).toBe('before-load');
    });

    it('getArtifacts returns all artifacts for a session', () => {
      const session = manager.createSession();
      const op1 = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      const op2 = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'b',
        {},
      );
      manager.recordArtifact(op1.id, { args: [1] });
      manager.recordArtifact(op2.id, { functionName: 'x' });
      expect(manager.getArtifacts(session.id)).toHaveLength(2);
    });

    it('getArtifacts filters by operation type', () => {
      const session = manager.createSession();
      const op1 = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      const op2 = manager.registerOperation(
        session.id,
        InstrumentationType.FUNCTION_TRACE,
        'b',
        {},
      );
      manager.recordArtifact(op1.id, { args: [1] });
      manager.recordArtifact(op2.id, { functionName: 'x' });
      const hooks = manager.getArtifacts(session.id, InstrumentationType.RUNTIME_HOOK);
      expect(hooks).toHaveLength(1);
      expect(hooks[0]!.type).toBe(InstrumentationType.RUNTIME_HOOK);
    });

    it('increments session artifact count', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });
      manager.recordArtifact(op.id, { args: [] });
      expect(manager.getSession(session.id)!.artifactCount).toBe(2);
    });
  });

  // ── Session Query ──

  describe('query', () => {
    it('getSession returns session by id', () => {
      const session = manager.createSession('test');
      const found = manager.getSession(session.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('test');
    });

    it('getSession returns undefined for non-existent id', () => {
      expect(manager.getSession('nope')).toBeUndefined();
    });

    it('getSessionOperations returns operations for session', () => {
      const session = manager.createSession();
      manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'a', {});
      manager.registerOperation(session.id, InstrumentationType.FUNCTION_TRACE, 'b', {});
      const ops = manager.getSessionOperations(session.id);
      expect(ops).toHaveLength(2);
      expect(ops[0]!.target).toBe('a');
    });

    it('getSessionStats returns operation count and artifact count', () => {
      const session = manager.createSession();
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });
      const stats = manager.getSessionStats(session.id);
      expect(stats).toEqual({ operationCount: 1, artifactCount: 1 });
    });
  });

  describe('integrations', () => {
    it('applies hook presets through the session and records a runtime hook artifact', async () => {
      const session = manager.createSession('preset-session');
      const hookPresetHandlers = {
        handleHookPreset: async () =>
          jsonToolResponse({
            success: true,
            injected: ['webassembly-full'],
            failed: [],
            method: 'evaluateOnNewDocument',
          }),
      };

      const result = await manager.applyHookPreset(session.id, hookPresetHandlers, {
        preset: 'webassembly-full',
        method: 'evaluateOnNewDocument',
      });

      expect(result.operation.type).toBe(InstrumentationType.RUNTIME_HOOK);
      expect(result.operation.status).toBe('completed');
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.data.presetIds).toEqual(['webassembly-full']);
      expect(result.artifacts[0]!.data.injectionPoint).toBe('before-load');
    });

    it('marks hook preset operations failed when nothing is injected', async () => {
      const session = manager.createSession('failed-preset-session');
      const hookPresetHandlers = {
        handleHookPreset: async () =>
          jsonToolResponse({
            success: false,
            injected: [],
            failed: [{ preset: 'missing', error: 'not found' }],
          }),
      };

      const result = await manager.applyHookPreset(session.id, hookPresetHandlers, {
        preset: 'missing',
      });

      expect(result.operation.status).toBe('failed');
      expect(result.artifacts).toHaveLength(0);
      expect(result.payload.failed).toEqual([{ preset: 'missing', error: 'not found' }]);
    });

    it('replays a captured network request through the session and records replay artifacts', async () => {
      const session = manager.createSession('replay-session');
      const advancedHandlers = {
        handleNetworkReplayRequest: async () =>
          jsonToolResponse({
            success: true,
            dryRun: false,
            requestId: 'req-1',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: '{"ok":true}',
            bodyTruncated: false,
          }),
      };

      const result = await manager.replayNetworkRequest(session.id, advancedHandlers, {
        requestId: 'req-1',
        methodOverride: 'POST',
        urlOverride: withPath(TEST_URLS.root, 'api/login'),
        dryRun: false,
      });

      expect(result.operation.type).toBe(InstrumentationType.NETWORK_INTERCEPT);
      expect(result.operation.status).toBe('completed');
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.data.requestId).toBe('req-1');
      expect(result.artifacts[0]!.data.statusCode).toBe(200);
      expect(result.artifacts[0]!.data.replayMode).toBe('live');
    });

    it('records dry-run replay previews as artifacts', async () => {
      const session = manager.createSession('replay-dry-run');
      const advancedHandlers = {
        handleNetworkReplayRequest: async () =>
          jsonToolResponse({
            success: true,
            dryRun: true,
            preview: {
              url: withPath(TEST_URLS.root, 'api/login'),
              method: 'POST',
              headers: { authorization: 'Bearer abc' },
              body: '{"user":"alice"}',
            },
          }),
      };

      const result = await manager.replayNetworkRequest(session.id, advancedHandlers, {
        requestId: 'req-2',
        dryRun: true,
      });

      expect(result.operation.status).toBe('completed');
      expect(result.artifacts[0]!.data.replayMode).toBe('dry-run');
      expect(result.artifacts[0]!.data.url).toBe(withPath(TEST_URLS.root, 'api/login'));
    });

    it('builds session snapshots for resources and exports', () => {
      const session = manager.createSession('snapshot');
      const op = manager.registerOperation(session.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [1] });

      const snapshot = manager.getSessionSnapshot(session.id);

      expect(snapshot).toBeDefined();
      expect(snapshot!.session.id).toBe(session.id);
      expect(snapshot!.operations).toHaveLength(1);
      expect(snapshot!.artifacts).toHaveLength(1);
      expect(manager.listSessionSnapshots()).toHaveLength(1);
    });
  });

  describe('edge cases and coverage', () => {
    it('throws when tool response lacks text payload', async () => {
      const session = manager.createSession();
      await expect(
        manager.applyHookPreset(
          session.id,
          { handleHookPreset: async () => ({ content: [] }) },
          {},
        ),
      ).rejects.toThrow('Expected JSON text payload from wrapped tool response');
    });

    it('throws when tool response is not valid JSON', async () => {
      const session = manager.createSession();
      await expect(
        manager.applyHookPreset(
          session.id,
          { handleHookPreset: async () => ({ content: [{ type: 'text', text: 'NOT JSON' }] }) },
          {},
        ),
      ).rejects.toThrow('Wrapped tool returned non-JSON text payload');
    });

    it('throws when tool response is not a JSON object', async () => {
      const session = manager.createSession();
      await expect(
        manager.applyHookPreset(
          session.id,
          { handleHookPreset: async () => ({ content: [{ type: 'text', text: '[]' }] }) },
          {},
        ),
      ).rejects.toThrow('Wrapped tool returned JSON that is not an object');
    });

    it('sets evidence bridge correctly', () => {
      manager.setEvidenceBridge({ onOperation: vi.fn(), onArtifact: vi.fn() } as any);
      expect((manager as any).evidenceBridge).toBeDefined();
    });

    it('throws when destroying non-existent session', () => {
      expect(() => manager.destroySession('nope')).toThrow();
    });

    it('clears operations, artifacts, and the reverse index when session destroyed', async () => {
      const s = manager.createSession();
      const op = manager.registerOperation(s.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [1] });

      manager.destroySession(s.id);

      expect(manager.getSessionOperations(s.id)).toEqual([]);
      expect(manager.getArtifacts(s.id)).toEqual([]);
      // Reverse index entry removed → stale operation can no longer record.
      expect(() => manager.recordArtifact(op.id, {})).toThrow(/not found/i);
    });

    it('releases every live internal Map on destroy, retaining a bounded archive (a3-04)', () => {
      const s = manager.createSession();
      const op = manager.registerOperation(s.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      manager.recordArtifact(op.id, { args: [] });

      manager.destroySession(s.id);

      expect((manager as any).sessions.size).toBe(0);
      expect((manager as any).operations.size).toBe(0);
      expect((manager as any).artifacts.size).toBe(0);
      expect((manager as any).operationIndex.size).toBe(0);
      // The destroyed session is retained read-only, bounded by the archive cap.
      expect((manager as any).archivedSessions.size).toBe(1);
    });

    it('rejects creating more than MAX_SESSIONS sessions', () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.createSession();
      }
      expect(() => manager.createSession()).toThrow(/limit/i);
    });

    it('throws when recording artifact for non-existent operation', () => {
      expect(() => manager.recordArtifact('nope', {})).toThrow();
    });

    it('throws when operation metadata missing for operation', () => {
      const s = manager.createSession();
      const op = manager.registerOperation(s.id, InstrumentationType.RUNTIME_HOOK, 'x', {});
      (manager as any).operations.get(s.id)!.pop();
      expect(() => manager.recordArtifact(op.id, {})).toThrow();
    });

    it('returns undefined snapshot for non-existent session', () => {
      expect(manager.getSessionSnapshot('nope')).toBeUndefined();
    });

    it('handles arrays in applyHookPreset payload failed definitions', async () => {
      const session = manager.createSession('preset-fail');
      const result = await manager.applyHookPreset(
        session.id,
        {
          handleHookPreset: async () =>
            jsonToolResponse({
              success: true,
              injected: ['webassembly-full'],
              failed: [{ preset: 'bad', error: 'boom' }, 'not-an-object'],
              method: 'runtime',
            }),
        },
        { preset: 'webassembly-full' },
      );
      expect(result.artifacts[0]!.data.failedPresets).toHaveLength(1);
    });

    it('returns zero stats for non-existent session', () => {
      expect(manager.getSessionStats('nope')).toEqual({ operationCount: 0, artifactCount: 0 });
    });

    it('setOperationStatus ignores if operation completely orphaned', () => {
      (manager as any).setOperationStatus('no-op', 'failed');
    });

    it('marks operation failed when tool invocation throws', async () => {
      const session = manager.createSession();
      await expect(
        manager.applyHookPreset(
          session.id,
          {
            handleHookPreset: () => {
              throw new Error('boom');
            },
          },
          {},
        ),
      ).rejects.toThrow('boom');
      const ops = manager.getSessionOperations(session.id);
      expect(ops[0]!.status).toBe('failed');
    });

    it('falls back to string error message in parseToolPayload', async () => {
      const session = manager.createSession();
      await expect(
        manager.applyHookPreset(
          session.id,
          {
            handleHookPreset: async () => {
              throw 'string boom';
            },
          },
          {},
        ),
      ).rejects.toThrow('string boom');
    });

    it('handles multiple presets and missing failed array in hook payload', async () => {
      const session = manager.createSession('preset-multi');
      const result = await manager.applyHookPreset(
        session.id,
        {
          handleHookPreset: async () =>
            jsonToolResponse({
              success: true,
              injected: ['a', 'b'],
              failed: 'not-an-array',
              method: 'other',
            }),
        },
        { presets: ['a', 'b'] },
      );
      expect(result.operation.target).toBe('a, b');
      expect(result.artifacts[0]!.data.failedPresets).toHaveLength(0);
      expect(result.artifacts[0]!.data.injectionPoint).toBe('runtime');
    });

    it('handles missing fields in dry-run network replay preview', async () => {
      const session = manager.createSession('replay-dry-run-miss');
      const result = await manager.replayNetworkRequest(
        session.id,
        {
          handleNetworkReplayRequest: async () =>
            jsonToolResponse({
              success: true,
              dryRun: true,
              preview: { body: 'body-only' },
            }),
        },
        {},
      );
      expect(result.artifacts[0]!.data.url).toBeUndefined();
      expect(result.artifacts[0]!.data.method).toBeUndefined();
      expect(result.artifacts[0]!.data.headers).toBeUndefined();
      expect(result.artifacts[0]!.data.body).toBe('body-only');
    });

    it('handles missing fields in live network replay', async () => {
      const session = manager.createSession('replay-live-miss');
      const result = await manager.replayNetworkRequest(
        session.id,
        {
          handleNetworkReplayRequest: async () =>
            jsonToolResponse({
              success: true,
              dryRun: false,
            }),
        },
        {},
      );
      expect(result.artifacts[0]!.data.requestId).toBe('network_replay');
      expect(result.artifacts[0]!.data.statusCode).toBeUndefined();
      expect(result.artifacts[0]!.data.statusText).toBeUndefined();
      expect(result.artifacts[0]!.data.bodyTruncated).toBeUndefined();
    });
  });
});
