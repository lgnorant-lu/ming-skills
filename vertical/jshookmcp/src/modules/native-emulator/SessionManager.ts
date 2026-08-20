/**
 * SessionManager — concurrency-safe lifecycle for native-emulator sessions.
 *
 * Each MCP tool call that needs emulator state gets its own NativeEmulator,
 * keyed by a session id. Because a NativeEmulator owns mutable CPU registers,
 * a guest stack, and a JNI object table, sharing one instance across concurrent
 * AI tool calls would let them overwrite each other's state — the production bug
 * this manager exists to prevent. Distinct sessions are fully isolated; within a
 * single session, CpuEngine.callSymbol runs synchronously (no await in its fetch
 * loop), so even interleaved async handler calls on the same session cannot tear
 * register state mid-instruction.
 *
 * Sessions also expire: an AI that forgets to destroy a session would otherwise
 * leak tens of MB (mapped .so bytes + stack + JNI tables) per orphan. The idle
 * sweep lives in the shared {@link IdleSweepRegistry} base class (also used by
 * the dart-inspector snapshot manager); this subclass adds the per-session
 * emulator construction and the emulator `dispose()` on reap.
 */
import { randomUUID } from 'node:crypto';

import { NEMU_SESSION_IDLE_TTL_MS, NEMU_SESSION_SWEEP_MS, NEMU_MAX_SESSIONS } from '@src/constants';
import { IdleSweepRegistry, type SessionInfo } from './IdleSweepRegistry';
import { NativeEmulator, type NativeEmulatorOptions } from './NativeEmulator';
import type { BionicOptions } from './bionic';
import type { AndroidSyscallOptions } from './syscalls';

/** A live emulator session: its id, the isolated emulator, and usage timestamps. */
export interface EmulatorSession {
  readonly id: string;
  readonly emulator: NativeEmulator;
  readonly createdAt: number;
  lastUsedAt: number;
}

/** Session metadata exposed to callers (never leaks the emulator instance). */
export type { SessionInfo };

export interface SessionManagerOptions {
  /** Idle threshold before an untouched session is swept (ms). */
  idleTtlMs?: number;
  /** Sweep interval (ms). */
  sweepIntervalMs?: number;
  /** Options applied to every new NativeEmulator. */
  emulatorOptions?: NativeEmulatorOptions;
  /** Max concurrent sessions; createSession throws once exceeded. */
  maxSessions?: number;
}

/** Per-session emulator options (e.g. opt out of the Android syscall table). */
export interface CreateSessionOptions {
  syscalls?: AndroidSyscallOptions | false;
  bionic?: BionicOptions;
}

export class SessionManager extends IdleSweepRegistry<EmulatorSession> {
  protected readonly sessionLabel = 'emulator';
  private readonly emulatorOptions: NativeEmulatorOptions;

  constructor(options: SessionManagerOptions = {}) {
    super(options, {
      idleTtlMs: NEMU_SESSION_IDLE_TTL_MS,
      sweepIntervalMs: NEMU_SESSION_SWEEP_MS,
      maxSessions: NEMU_MAX_SESSIONS,
    });
    this.emulatorOptions = options.emulatorOptions ?? {};
  }

  /**
   * Create an isolated emulator session. Per-call `syscalls` overrides the
   * manager-wide emulator options. Throws once `maxSessions` is reached so a
   * runaway caller can't exhaust memory.
   */
  createSession(options: CreateSessionOptions = {}): EmulatorSession {
    if (this.isAtCapacity()) {
      throw new Error(
        `Emulator session limit reached (${this.maxSessions}); destroy an existing session first`,
      );
    }
    const emulatorOptions: NativeEmulatorOptions = {
      ...this.emulatorOptions,
      ...(options.syscalls !== undefined ? { syscalls: options.syscalls } : {}),
      ...(options.bionic !== undefined ? { bionic: options.bionic } : {}),
    };
    const now = Date.now();
    const session: EmulatorSession = {
      id: randomUUID(),
      emulator: new NativeEmulator(emulatorOptions),
      createdAt: now,
      lastUsedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Release emulator resources before the session is removed (destroy/sweep/dispose). */
  protected release(session: EmulatorSession): void {
    session.emulator.dispose();
  }
}
