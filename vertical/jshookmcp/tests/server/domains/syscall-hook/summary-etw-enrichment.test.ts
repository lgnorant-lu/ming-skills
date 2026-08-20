import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyscallHookHandlers } from '@server/domains/syscall-hook/handlers.impl';
import { ETW_PROVIDER_CATALOG } from '@modules/syscall-hook';

// ---------------------------------------------------------------------------
// Coverage for the Session 61 pure-TS enhancements:
//   A. Ranked capture summary (topSyscalls + topPids, per-syscall error/duration)
//   B. ETW provider catalog discovery via syscall_get_stats
//   C. ETW provider validation feedback in syscall_start_monitor (no silent drop)
// All three close gaps verified against source — no new tools, no native deps.
// ---------------------------------------------------------------------------

function createMockMonitor() {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    captureEvents: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockReturnValue({ eventsCaptured: 0, uptime: 0, backend: 'etw' }),
    getSupportedBackends: vi.fn().mockReturnValue(['etw', 'strace', 'dtrace']),
    isRunning: vi.fn().mockReturnValue(false),
  };
}

function createMockMapper() {
  return { map: vi.fn().mockReturnValue(null) };
}

function evt(overrides?: Partial<Record<string, unknown>>) {
  return {
    timestamp: 0,
    pid: 1,
    syscall: 'read',
    args: [],
    ...overrides,
  };
}

describe('syscall-hook analysis enrichment', () => {
  let monitor: ReturnType<typeof createMockMonitor>;
  let mapper: ReturnType<typeof createMockMapper>;
  let handlers: SyscallHookHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    monitor = createMockMonitor();
    mapper = createMockMapper();
    handlers = new SyscallHookHandlers(
      monitor as any,
      mapper as any,
      undefined,
      undefined,
      undefined,
    );
  });

  // =========================================================================
  // A. Ranked summary — topSyscalls / topPids / per-syscall error + duration
  // =========================================================================
  describe('ranked capture summary', () => {
    it('ranks syscalls by count desc with per-syscall errorCount and avgDurationMs', async () => {
      // read: 3 (1 error), openat: 2 (0 errors), write: 1 (1 error)
      monitor.captureEvents.mockResolvedValueOnce([
        evt({ syscall: 'read', returnValue: 5, duration: 2 }),
        evt({ syscall: 'read', returnValue: -1, duration: 4 }),
        evt({ syscall: 'read', returnValue: 10 }),
        evt({ syscall: 'openat', returnValue: 3, duration: 1 }),
        evt({ syscall: 'openat', returnValue: 4, duration: 3 }),
        evt({ syscall: 'write', returnValue: -1, duration: 6 }),
      ]);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      const top = result.summary.topSyscalls;

      expect(top).toHaveLength(3);
      // Sorted by count desc: read(3) → openat(2) → write(1)
      expect(top.map((t: any) => t.name)).toEqual(['read', 'openat', 'write']);
      expect(top[0]).toMatchObject({ name: 'read', count: 3, errorCount: 1, avgDurationMs: 3 });
      expect(top[1]).toMatchObject({ name: 'openat', count: 2, errorCount: 0, avgDurationMs: 2 });
      expect(top[2]).toMatchObject({ name: 'write', count: 1, errorCount: 1, avgDurationMs: 6 });
    });

    it('omits avgDurationMs for syscalls that have no duration samples', async () => {
      monitor.captureEvents.mockResolvedValueOnce([
        evt({ syscall: 'read', returnValue: 5 }), // no duration
        evt({ syscall: 'openat', returnValue: 3, duration: 4 }),
      ]);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      const top = result.summary.topSyscalls;
      const readEntry = top.find((t: any) => t.name === 'read');
      const openatEntry = top.find((t: any) => t.name === 'openat');

      expect(readEntry).not.toHaveProperty('avgDurationMs');
      expect(openatEntry).toHaveProperty('avgDurationMs', 4);
    });

    it('breaks count ties by name asc for deterministic ordering', async () => {
      monitor.captureEvents.mockResolvedValueOnce([
        evt({ syscall: 'zebra', returnValue: 0 }),
        evt({ syscall: 'alpha', returnValue: 0 }),
        evt({ syscall: 'mid', returnValue: 0 }),
      ]);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      // All count=1 → tie broken by localeCompare name asc
      expect(result.summary.topSyscalls.map((t: any) => t.name)).toEqual(['alpha', 'mid', 'zebra']);
    });

    it('caps topSyscalls and topPids at the SUMMARY_TOP_N bound', async () => {
      // 30 distinct syscalls + 30 distinct pids — only the top 20 of each return.
      const events: Record<string, unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        // Vary counts so the ranking is meaningful: syscallN appears (30-i) times.
        for (let j = 0; j < 30 - i; j++) {
          events.push(evt({ syscall: `s${i}`, pid: i }));
        }
      }
      monitor.captureEvents.mockResolvedValueOnce(events);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      expect(result.summary.topSyscalls).toHaveLength(20);
      expect(result.summary.topPids).toHaveLength(20);
      // Highest count first (s0 = 30 occurrences, pid 0 = 30 occurrences)
      expect(result.summary.topSyscalls[0].name).toBe('s0');
      expect(result.summary.topPids[0].pid).toBe(0);
    });

    it('ranks pids by count desc with deterministic tie-break', async () => {
      monitor.captureEvents.mockResolvedValueOnce([
        evt({ pid: 5 }),
        evt({ pid: 5 }),
        evt({ pid: 5 }),
        evt({ pid: 9 }),
        evt({ pid: 9 }),
        evt({ pid: 1 }),
      ]);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      expect(result.summary.topPids).toEqual([
        { pid: 5, count: 3 },
        { pid: 9, count: 2 },
        { pid: 1, count: 1 },
      ]);
    });

    it('preserves legacy bySyscall/byPid/errorCount/averageDuration for backward compat', async () => {
      monitor.captureEvents.mockResolvedValueOnce([
        evt({ syscall: 'read', returnValue: 5, duration: 2 }),
        evt({ syscall: 'read', returnValue: -1, duration: 4 }),
      ]);

      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      // Legacy fields still present (no downstream breakage)
      expect(result.summary).toMatchObject({
        total: 2,
        bySyscall: { read: 2 },
        byPid: { '1': 2 },
        errorCount: 1,
        averageDuration: 3,
      });
      // New fields present alongside
      expect(result.summary.topSyscalls).toBeInstanceOf(Array);
      expect(result.summary.topPids).toBeInstanceOf(Array);
    });

    it('returns empty ranked arrays for an empty capture', async () => {
      monitor.captureEvents.mockResolvedValueOnce([]);
      const result = (await handlers.handleSyscallCaptureEvents({})) as any;
      expect(result.summary.topSyscalls).toEqual([]);
      expect(result.summary.topPids).toEqual([]);
      expect(result.summary.errorCount).toBe(0);
      expect(result.summary.averageDuration).toBeUndefined();
    });
  });

  // =========================================================================
  // B. ETW provider catalog discovery via get_stats
  // =========================================================================
  describe('ETW provider catalog discovery', () => {
    it('surfaces the full provider catalog in syscall_get_stats', async () => {
      const result = (await handlers.handleSyscallGetStats()) as any;
      expect(result.etwProviderCatalog).toBe(ETW_PROVIDER_CATALOG);
      // Every entry has the documented shape
      for (const entry of result.etwProviderCatalog) {
        expect(entry).toEqual(
          expect.objectContaining({
            name: expect.any(String),
            guid: expect.any(String),
            description: expect.any(String),
          }),
        );
      }
    });

    it('includes all five named kernel providers in the catalog', async () => {
      const result = (await handlers.handleSyscallGetStats()) as any;
      const names = result.etwProviderCatalog.map((e: any) => e.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'nt-kernel',
          'kernel-process',
          'kernel-network',
          'kernel-file',
          'kernel-image',
        ]),
      );
    });
  });

  // =========================================================================
  // C. ETW provider validation feedback in start_monitor (no silent drop)
  // =========================================================================
  describe('ETW provider validation feedback', () => {
    it('passes valid (lowercased, de-duplicated) providers to the monitor', async () => {
      await handlers.handleSyscallStartMonitor({
        backend: 'etw',
        etwProviders: ['Kernel-Network', 'kernel-network', 'kernel-file'],
      });
      expect(monitor.start).toHaveBeenCalledWith(
        expect.objectContaining({
          backend: 'etw',
          etwProviders: ['kernel-network', 'kernel-file'],
        }),
      );
    });

    it('surfaces unknown provider names instead of silently dropping them', async () => {
      const result = (await handlers.handleSyscallStartMonitor({
        backend: 'etw',
        etwProviders: ['kernel-network', 'kernel-net', 'typo-provider'],
      })) as any;
      // Still starts (best-effort with the valid name)
      expect(result).toMatchObject({ ok: true, started: true });
      expect(result.etwProviderWarning).toBeDefined();
      expect(result.etwProviderWarning.unknownProviders).toEqual(
        expect.arrayContaining(['kernel-net', 'typo-provider']),
      );
      expect(result.etwProviderWarning.validProviders).toEqual(['kernel-network']);
      // Available names enumerated so the caller can correct the typo
      expect(result.etwProviderWarning.availableProviders).toEqual(
        expect.arrayContaining([
          'nt-kernel',
          'kernel-process',
          'kernel-network',
          'kernel-file',
          'kernel-image',
        ]),
      );
    });

    it('omits the warning when all requested providers resolve', async () => {
      const result = (await handlers.handleSyscallStartMonitor({
        backend: 'etw',
        etwProviders: ['kernel-process', 'kernel-network'],
      })) as any;
      expect(result.ok).toBe(true);
      expect(result.etwProviderWarning).toBeUndefined();
      expect(monitor.start).toHaveBeenCalledWith(
        expect.objectContaining({ etwProviders: ['kernel-process', 'kernel-network'] }),
      );
    });

    it('omits the warning and does not pass etwProviders when none are requested', async () => {
      const result = (await handlers.handleSyscallStartMonitor({ backend: 'etw' })) as any;
      expect(result.ok).toBe(true);
      expect(result.etwProviderWarning).toBeUndefined();
      // No etwProviders key on the start call → legacy NT Kernel Logger fallback
      expect(monitor.start).toHaveBeenCalledWith({
        backend: 'etw',
        pid: undefined,
        simulate: false,
      });
    });

    it('does not run ETW validation for non-etw backends', async () => {
      const result = (await handlers.handleSyscallStartMonitor({
        backend: 'strace',
        etwProviders: ['kernel-process'],
      })) as any;
      expect(result.ok).toBe(true);
      expect(result.etwProviderWarning).toBeUndefined();
      // strace backend ignores etwProviders entirely
      expect(monitor.start).toHaveBeenCalledWith({
        backend: 'strace',
        pid: undefined,
        simulate: false,
      });
    });
  });
});
