/**
 * IdleSweepRegistry — concurrency-safe session registry with an idle-TTL
 * sweep. Shared by {@link SessionManager} (native-emulator) and
 * `DartSnapshotSessionManager` (dart-inspector), which were ~90% mirrors of
 * each other before this base class.
 *
 * Sessions expire: a caller that forgets to destroy a session would otherwise
 * leak resources per orphan. An idle sweep, modelled on AutoPruner's unref'd
 * interval, reaps sessions untouched for longer than the TTL. dispose()
 * (wired into the server's graceful shutdown) stops the timer and drops every
 * session.
 *
 * Subclasses own the session shape and creation: they call
 * {@link isAtCapacity} / {@link reservePendingSlot} before their async create
 * and register the entry in {@link sessions}; they override {@link release}
 * to free per-session resources on destroy/sweep/dispose (default no-op).
 */

/** Minimal shape every registered session must carry. */
export interface RegistryEntry {
  readonly id: string;
  readonly createdAt: number;
  lastUsedAt: number;
}

/** Session metadata exposed to callers (never leaks the underlying entry). */
export interface SessionInfo {
  id: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface IdleSweepRegistryOptions {
  /** Idle threshold before an untouched session is swept (ms). */
  idleTtlMs?: number;
  /** Sweep interval (ms). */
  sweepIntervalMs?: number;
  /** Max concurrent sessions; creation throws once exceeded. */
  maxSessions?: number;
}

/** Defaults for the sweep/TTL/cap settings when the caller omits them. */
export interface IdleSweepDefaults {
  idleTtlMs: number;
  sweepIntervalMs: number;
  maxSessions: number;
}

export class IdleSweepRegistry<T extends RegistryEntry> {
  protected readonly sessions = new Map<string, T>();
  /**
   * Slots reserved for sessions that are mid-creation (e.g. a Dart snapshot
   * still parsing): counted against maxSessions so concurrent createSession
   * calls cannot all pass the ceiling check while one is still loading.
   */
  protected pendingCount = 0;
  /** Label used in requireSession error messages ("Unknown <label> session"). */
  protected readonly sessionLabel: string = 'session';
  protected readonly idleTtlMs: number;
  protected readonly sweepIntervalMs: number;
  protected readonly maxSessions: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: IdleSweepRegistryOptions = {}, defaults: IdleSweepDefaults) {
    this.idleTtlMs = options.idleTtlMs ?? defaults.idleTtlMs;
    this.sweepIntervalMs = options.sweepIntervalMs ?? defaults.sweepIntervalMs;
    this.maxSessions = options.maxSessions ?? defaults.maxSessions;
    this.startSweep();
  }

  /** True when the session ceiling is reached (including pending creations). */
  protected isAtCapacity(): boolean {
    return this.sessions.size + this.pendingCount >= this.maxSessions;
  }

  /** Reserve a slot before an async creation; must be paired with releasePendingSlot. */
  protected reservePendingSlot(): void {
    this.pendingCount++;
  }

  /** Release a slot reserved by reservePendingSlot (always pair in a finally). */
  protected releasePendingSlot(): void {
    this.pendingCount--;
  }

  /** Look up a session, refreshing its lastUsedAt; undefined when unknown. */
  getSession(id: string): T | undefined {
    const session = this.sessions.get(id);
    if (session) session.lastUsedAt = Date.now();
    return session;
  }

  /** Look up a session, refreshing its lastUsedAt; throws when unknown. */
  requireSession(id: string): T {
    const session = this.getSession(id);
    if (!session) {
      throw new Error(`Unknown ${this.sessionLabel} session: ${id}`);
    }
    return session;
  }

  /** Destroy a session; returns whether it existed. */
  destroySession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      // Release session resources before removing from the registry.
      this.release(session);
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  /** List session metadata without exposing the underlying entries. */
  listSessions(): SessionInfo[] {
    const infos: SessionInfo[] = [];
    for (const s of this.sessions.values()) {
      infos.push({ id: s.id, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt });
    }
    return infos;
  }

  /** Current live session count. */
  count(): number {
    return this.sessions.size;
  }

  /** Stop the sweep timer and drop every session. Idempotent. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    // Release all entries before clearing.
    for (const session of this.sessions.values()) {
      this.release(session);
    }
    this.sessions.clear();
  }

  /** Release per-session resources before removal. Override in subclasses. */
  protected release(_session: T): void {}

  private startSweep(): void {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    // Don't keep the event loop (and thus the process) alive for the sweep.
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /** Reap sessions whose last use is older than the idle TTL. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastUsedAt >= this.idleTtlMs) {
        try {
          // Release session resources before removing.
          this.release(session);
        } catch {
          // A faulty release must not kill the sweep: it runs on an unref'd
          // timer, so an uncaught throw would crash the whole process.
        }
        this.sessions.delete(id);
      }
    }
  }
}
