/**
 * DartSnapshotSessionManager — concurrency-safe lifecycle for Dart AOT
 * snapshot sessions.
 *
 * Extends the shared {@link IdleSweepRegistry} base class (also used by the
 * native-emulator SessionManager). Every dynamic dart-inspector tool
 * (`dart_load_snapshot`, `dart_list_functions`, `dart_call_graph`,
 * `dart_call_function`, `dart_inspect_object_pool`, `dart_trace_execution`)
 * otherwise constructs a fresh `DartAotLoader` and re-parses `libapp.so`
 * (10–40 MB, hundreds of clusters) on each call. A multi-step reversing
 * session re-runs that parse on every tool invocation; this manager parses
 * once and hands the cached {@link LoadedSnapshot} to subsequent calls.
 *
 * Differences from the native-emulator SessionManager:
 *  - A Dart snapshot is pure parsed data (no mapped `.so` bytes, guest stack,
 *    or JNI object table), so destroying a session only drops the reference —
 *    `release()` stays the base no-op (GC reclaims the snapshot).
 *  - `DartAotExecutor` instances are *not* cached here: an executor owns
 *    mutable CPU registers and must not be shared across concurrent tool
 *    calls. Callers get the cached snapshot and build a fresh executor per
 *    call via `DartAotExecutor.loadFromSnapshot`.
 *  - `createSession` is async: the slot is reserved synchronously before the
 *    await (via `reservePendingSlot`) so concurrent createSession calls
 *    cannot all pass the ceiling check while one is mid-parse.
 *
 * Sessions still expire: an AI that forgets to destroy a session would
 * otherwise pin tens of MB of parsed clusters per orphan. The idle sweep
 * (modelled on AutoPruner's unref'd interval) reaps sessions untouched for
 * longer than the TTL.
 */
import { randomUUID } from 'node:crypto';

import { DART_SESSION_IDLE_TTL_MS, DART_SESSION_SWEEP_MS, DART_MAX_SESSIONS } from '@src/constants';
import { IdleSweepRegistry } from '../IdleSweepRegistry';
import { DartAotLoader, type LoadedSnapshot } from './DartAotLoader';

/** A live Dart snapshot session: its id, the source path, the parsed snapshot, and timestamps. */
export interface DartSnapshotSession {
  readonly id: string;
  /** Absolute path the snapshot was parsed from (APK or libapp.so). */
  readonly path: string;
  readonly snapshot: LoadedSnapshot;
  readonly createdAt: number;
  lastUsedAt: number;
}

/** Session metadata exposed to callers (never leaks the snapshot instance). */
export interface DartSessionInfo {
  id: string;
  path: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface DartSnapshotSessionManagerOptions {
  /** Idle threshold before an untouched session is swept (ms). */
  idleTtlMs?: number;
  /** Sweep interval (ms). */
  sweepIntervalMs?: number;
  /** Max concurrent sessions; createSession throws once exceeded. */
  maxSessions?: number;
}

export class DartSnapshotSessionManager extends IdleSweepRegistry<DartSnapshotSession> {
  protected readonly sessionLabel = 'dart snapshot';

  constructor(options: DartSnapshotSessionManagerOptions = {}) {
    super(options, {
      idleTtlMs: DART_SESSION_IDLE_TTL_MS,
      sweepIntervalMs: DART_SESSION_SWEEP_MS,
      maxSessions: DART_MAX_SESSIONS,
    });
  }

  /**
   * Parse `libapp.so` (or an APK) and cache the resulting snapshot under a
   * fresh session id. Throws once `maxSessions` is reached so a runaway
   * caller cannot exhaust memory. The slot is reserved synchronously before
   * the await, so concurrent createSession calls cannot all pass the ceiling
   * check while this one is mid-parse. An optional `loader` injection point is
   * exposed for tests (so a mock loader can stand in for the real parse).
   */
  async createSession(path: string, loader?: DartAotLoader): Promise<DartSnapshotSession> {
    if (this.isAtCapacity()) {
      throw new Error(
        `Dart snapshot session limit reached (${this.maxSessions}); destroy an existing session first`,
      );
    }
    const id = randomUUID();
    this.reservePendingSlot();
    try {
      const usedLoader = loader ?? new DartAotLoader();
      const snapshot = await usedLoader.loadSnapshot(path);
      const now = Date.now();
      const session: DartSnapshotSession = {
        id,
        path,
        snapshot,
        createdAt: now,
        lastUsedAt: now,
      };
      this.sessions.set(id, session);
      return session;
    } finally {
      this.releasePendingSlot();
    }
  }

  /** List session metadata without exposing the underlying snapshots. */
  listSessions(): DartSessionInfo[] {
    const infos: DartSessionInfo[] = [];
    for (const s of this.sessions.values()) {
      infos.push({ id: s.id, path: s.path, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt });
    }
    return infos;
  }
}
