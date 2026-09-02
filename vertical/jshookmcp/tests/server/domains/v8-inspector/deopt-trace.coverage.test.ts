/**
 * Coverage tests for handleDeoptTrace — exercises the no-CDP-session early
 * return, the Tracing primary path (V8.DeoptimizeFrame via Tracing.dataCollected),
 * the natives-unavailable path, and the console fallback (parse of
 * %TraceDeoptimizations output with begin/end dedup + absolute timestamps).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  handleDeoptTrace,
  parseConsoleDeoptLine,
  parseTraceDeoptEvents,
} from '@server/domains/v8-inspector/handlers/deopt-trace';

describe('handleDeoptTrace — no CDP session', () => {
  it('returns unavailable when getPage resolves to undefined', async () => {
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 5 }, async () => undefined);
    expect(r.success).toBe(false);
    expect(r.mode).toBe('unavailable');
    expect(r.eventCount).toBe(0);
    expect(r.summary).toMatch(/CDP session unavailable/);
  });

  it('returns unavailable when getPage is omitted entirely', async () => {
    const r = await handleDeoptTrace({ durationMs: 100 });
    expect(r.success).toBe(false);
    expect(r.mode).toBe('unavailable');
  });
});

describe('handleDeoptTrace — Tracing primary path', () => {
  type EventHandler = (params: Record<string, unknown>) => void;

  const frameEvent = {
    name: 'V8.DeoptimizeFrame',
    ph: 'I',
    ts: 1_700_000_000_000_000, // µs epoch → 1_700_000_000_000 ms
    args: {
      functionName: 'computeTotal',
      deoptReason: 'Not enough type info for adaptive inlining',
      bailoutType: 'eager',
      scriptId: 42,
      lineNumber: 17,
      optimizationId: 7,
    },
  };

  function makeTracingSession(opts: {
    pushEvents?: unknown[];
    pushComplete?: boolean;
    failStart?: boolean;
  }) {
    let capturedData: EventHandler | null = null;
    let capturedComplete: EventHandler | null = null;
    const send = vi.fn(async (method: string) => {
      if (method === 'Tracing.start') {
        if (opts.failStart) throw new Error('Tracing not supported on this target');
        // Push trace events + (optionally) tracingComplete once the listener
        // is wired — queueMicrotask lands before the first await resolves.
        if (capturedData && opts.pushEvents) {
          queueMicrotask(() => capturedData!({ value: opts.pushEvents }));
        }
        if (capturedComplete && opts.pushComplete !== false) {
          queueMicrotask(() => capturedComplete!({ data: null }));
        }
        return {};
      }
      if (method === 'Runtime.evaluate') {
        // Natives support probe — only consulted on the fallback path.
        return { result: { value: false } };
      }
      return {};
    });
    const detach = vi.fn(async () => undefined);
    const session = {
      send,
      detach,
      on: vi.fn((ev: string, h: EventHandler) => {
        if (ev === 'Tracing.dataCollected') capturedData = h;
        if (ev === 'Tracing.tracingComplete') capturedComplete = h;
      }),
      off: vi.fn(() => undefined),
    };
    return { session, send, detach, off: session.off, on: session.on };
  }

  it('collects V8.DeoptimizeFrame events from Tracing.dataCollected', async () => {
    const { session, detach, off, on } = makeTracingSession({ pushEvents: [frameEvent] });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 10 }, async () => page);

    expect(r).toMatchObject({ success: true, mode: 'tracing', traceEnabled: true });
    expect(r.eventCount).toBe(1);
    expect(on).toHaveBeenCalledWith('Tracing.dataCollected', expect.any(Function));
    expect(on).toHaveBeenCalledWith('Tracing.tracingComplete', expect.any(Function));
    expect(off).toHaveBeenCalledWith('Tracing.dataCollected', expect.any(Function));
    expect(off).toHaveBeenCalledWith('Tracing.tracingComplete', expect.any(Function));
    expect(detach).toHaveBeenCalled();

    const ev = r.events[0];
    expect(ev).toMatchObject({
      functionName: 'computeTotal',
      reason: 'Not enough type info for adaptive inlining',
      deoptType: 'eager',
      scriptId: 42,
      lineNumber: 17,
      bailoutId: 7,
      timestamp: 1_700_000_000_000,
      traceTsMicros: 1_700_000_000_000_000,
    });
  });

  it('reports tracing mode with no events when the window saw none', async () => {
    const { session } = makeTracingSession({ pushEvents: [], pushComplete: true });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100 }, async () => page);
    expect(r.mode).toBe('tracing');
    expect(r.eventCount).toBe(0);
    expect(r.summary).toMatch(/No deopt events captured during trace window \(tracing mode\)/);
  });

  it('caps returned events at maxEvents but reports the collected count', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...frameEvent,
      args: { ...frameEvent.args, functionName: `fn${i}` },
    }));
    const { session } = makeTracingSession({ pushEvents: many });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 2 }, async () => page);
    expect(r.mode).toBe('tracing');
    expect(r.events).toHaveLength(2);
    expect(r.eventCount).toBe(5);
  });

  it('survives a missing tracingComplete with the safety timeout', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeTracingSession({ pushEvents: [frameEvent], pushComplete: false });
      const page = { createCDPSession: async () => session };
      const promise = handleDeoptTrace({ durationMs: 100 }, async () => page);
      // durationMs window + tracingComplete safety timeout
      await vi.advanceTimersByTimeAsync(100 + 2000 + 50);
      const r = await promise;
      expect(r.mode).toBe('tracing');
      expect(r.eventCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('handleDeoptTrace — natives syntax unavailable', () => {
  it('returns unavailable-mode when Tracing fails and the target lacks %TraceDeoptimizations', async () => {
    // Mock page exposing createCDPSession; every CDP call throws → Tracing
    // start fails, the natives probe throws → "natives unavailable".
    const send = vi.fn().mockRejectedValue(new Error('not available'));
    const session = { send, detach: vi.fn().mockResolvedValue(undefined) };
    const page = {
      createCDPSession: async () => session,
    };
    const r = await handleDeoptTrace({ durationMs: 100 }, async () => page);
    expect(r.success).toBe(true);
    expect(r.mode).toBe('unavailable');
    expect(r.summary).toMatch(/natives syntax/);
    expect(session.detach).toHaveBeenCalled();
  });
});

// The console fallback is exercised when Tracing.start is rejected on the
// target. V8 prints deopt diagnostics to the console — this pins the wiring:
// subscribe to Runtime.consoleAPICalled, parse the "deoptimizing" begin lines
// only (end lines are deduped), and tear the listener down in a finally block.
describe('handleDeoptTrace — console fallback (Tracing unavailable)', () => {
  type ConsoleHandler = (params: Record<string, unknown>) => void;

  function makeSession(opts: { nativesAvailable: boolean; emitLines?: string[] }) {
    let captured: ConsoleHandler | null = null;
    const send = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'Tracing.start') {
        throw new Error('Tracing not supported on this target');
      }
      if (method === 'Runtime.evaluate') {
        // The natives-support probe (and every later evaluate) reports the
        // target's capability; false targets bail out before the wait window.
        void params;
        return { result: { value: opts.nativesAvailable } };
      }
      return {};
    });
    const detach = vi.fn(async () => undefined);
    const off = vi.fn((ev: string, h: ConsoleHandler) => {
      if (ev === 'Runtime.consoleAPICalled' && h === captured) captured = null;
    });
    const session = {
      send,
      detach,
      on: vi.fn((ev: string, h: ConsoleHandler) => {
        if (ev === 'Runtime.consoleAPICalled') {
          captured = h;
          // Fire the deopt log lines once, right after the listener is wired —
          // the console output happens continuously, independent of CDP calls.
          if (opts.nativesAvailable && opts.emitLines) {
            queueMicrotask(() =>
              captured!({
                type: 'log',
                args: opts.emitLines!.map((description) => ({
                  type: 'string',
                  description,
                })),
              }),
            );
          }
        }
      }),
      off,
    };
    return { session, send, detach, off, on: session.on };
  }

  const beginLine =
    '[deoptimizing (DEOPT eager): begin 0x123 <JS Function foo (sfi #12)> ' +
    'deoptimize at test.js:42:7]';

  it('captures a deopt event with deoptType and an absolute timestamp', async () => {
    const before = Date.now();
    const { session, detach, off, on } = makeSession({
      nativesAvailable: true,
      emitLines: [beginLine],
    });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 5 }, async () => page);

    expect(r).toMatchObject({ success: true, mode: 'natives' });
    expect(r.eventCount).toBeGreaterThanOrEqual(1);
    const ev = r.events[0]!;
    expect(ev.functionName).toBe('foo');
    // The console line carries the deopt TYPE, not a reason text — the type
    // lands in deoptType and reason stays empty.
    expect(ev.deoptType).toBe('eager');
    expect(ev.reason).toBe('');
    expect(ev.sourcePosition).toBe(42);
    // Absolute epoch ms, not relative to the trace start.
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(Date.now());
    expect(on).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
    expect(off).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
    expect(detach).toHaveBeenCalled();
  });

  it('deduplicates begin/end console pairs — only begin lines emit events', async () => {
    const endLine = '[deoptimizing (DEOPT eager): end 0x123 foo @1]';
    const { session } = makeSession({
      nativesAvailable: true,
      emitLines: [beginLine, endLine],
    });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, maxEvents: 5 }, async () => page);
    expect(r.mode).toBe('natives');
    expect(r.eventCount).toBe(1);
  });

  it('ignores non-begin/end deoptim lines (position lines inside the block)', async () => {
    const { session } = makeSession({
      nativesAvailable: true,
      emitLines: ['... : deoptimize at test.js:42:7'],
    });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100 }, async () => page);
    expect(r.mode).toBe('natives');
    expect(r.eventCount).toBe(0);
  });

  it('clamps durationMs to the [100, 60000] schema bounds', async () => {
    const { session } = makeSession({ nativesAvailable: false });
    const page = { createCDPSession: async () => session };
    // Negative / 0 / huge durations must not throw or hang.
    const rNeg = await handleDeoptTrace({ durationMs: -50 }, async () => page);
    expect(rNeg).toMatchObject({ mode: expect.any(String) });
    const rHuge = await handleDeoptTrace({ durationMs: 9_999_999 }, async () => page);
    expect(rHuge).toMatchObject({ mode: expect.any(String) });
  });

  it('waits the full requested window (no hidden 10s cap)', async () => {
    vi.useFakeTimers();
    try {
      const { session } = makeSession({ nativesAvailable: true, emitLines: [beginLine] });
      const page = { createCDPSession: async () => session };
      const promise = handleDeoptTrace({ durationMs: 60000, maxEvents: 5 }, async () => page);
      await vi.advanceTimersByTimeAsync(60000);
      const r = await promise;
      expect(r).toMatchObject({ success: true, mode: 'natives' });
      // A 60s request must collect for ~60s, not the old hardcoded 10s cap.
      expect(r.durationMs).toBeGreaterThanOrEqual(59900);
    } finally {
      vi.useRealTimers();
    }
  });

  it('enable=false collects passively without enabling natives', async () => {
    const { session, send } = makeSession({ nativesAvailable: true, emitLines: [beginLine] });
    const page = { createCDPSession: async () => session };
    const r = await handleDeoptTrace({ durationMs: 100, enable: false }, async () => page);
    expect(r.mode).toBe('natives');
    expect(r.traceEnabled).toBe(false);
    expect(r.eventCount).toBeGreaterThanOrEqual(1);
    // No %TraceDeoptimizations enable call on the passive path — only the
    // natives support probe evaluate may run, and no Tracing.start either.
    const evaluateCalls = send.mock.calls.filter((c) => c[0] === 'Runtime.evaluate');
    const traceStartCalls = send.mock.calls.filter((c) => c[0] === 'Tracing.start');
    expect(traceStartCalls).toHaveLength(0);
    for (const [method, params] of evaluateCalls) {
      void method;
      const expression = (params as { expression?: string } | undefined)?.expression ?? '';
      expect(expression).not.toContain('%TraceDeoptimizations');
    }
  });
});

describe('parseConsoleDeoptLine — pure parsing', () => {
  it('parses the deopt type from a begin line', () => {
    const ev = parseConsoleDeoptLine(
      '[deoptimizing (DEOPT lazy): begin 0x1 <JS Function bar (sfi #3)>]',
      1234,
    );
    expect(ev).toMatchObject({
      functionName: 'bar',
      deoptType: 'lazy',
      reason: '',
      timestamp: 1234,
    });
  });

  it('returns null for end lines, non-deoptim lines, and position lines', () => {
    expect(parseConsoleDeoptLine('[deoptimizing (DEOPT eager): end 0x1 bar @1]', 1)).toBeNull();
    expect(parseConsoleDeoptLine('[optimizing foo]', 1)).toBeNull();
    expect(parseConsoleDeoptLine('... : deoptimize at a.js:1:1', 1)).toBeNull();
  });

  it('falls back to <anonymous> when no function name is present', () => {
    const ev = parseConsoleDeoptLine('[deoptimizing (DEOPT soft): begin 0x1]', 1);
    expect(ev).toMatchObject({ functionName: '<anonymous>', deoptType: 'soft' });
  });
});

describe('parseTraceDeoptEvents — pure parsing', () => {
  it('filters non-deopt trace events and tolerates missing args', () => {
    const raw = [
      { name: 'V8.CompileCode', args: {}, ts: 1 },
      { name: 'V8.DeoptimizeFrame', args: { functionName: 'x', deoptReason: 'r' }, ts: 2_000_000 },
      { name: 'something.else', args: {}, ts: 3 },
      'not-an-object',
      null,
    ];
    const evs = parseTraceDeoptEvents(raw);
    expect(evs).toHaveLength(1);
    expect(evs[0]!).toMatchObject({
      functionName: 'x',
      reason: 'r',
      timestamp: 2000,
      traceTsMicros: 2_000_000,
    });
  });

  it('accepts snake_case arg variants and unknown-field tolerance', () => {
    const evs = parseTraceDeoptEvents([
      {
        name: 'V8.DeoptimizeFrame',
        args: {
          function_name: 'y',
          deopt_reason: 'sr',
          bailout_type: 'lazy',
          script_id: 9,
          line_number: 3,
          node_id: 11,
        },
        ts: 5_000_000,
      },
    ]);
    expect(evs[0]!).toMatchObject({
      functionName: 'y',
      reason: 'sr',
      deoptType: 'lazy',
      scriptId: 9,
      lineNumber: 3,
      sourcePosition: 11,
    });
  });

  it('defaults anonymous function, empty reason, and Date.now when ts missing', () => {
    const before = Date.now();
    const evs = parseTraceDeoptEvents([{ name: 'V8.DeoptimizeFrame', args: {}, ts: undefined }]);
    expect(evs[0]!).toMatchObject({ functionName: '<anonymous>', reason: '' });
    expect(evs[0]!.timestamp).toBeGreaterThanOrEqual(before);
    expect(evs[0]!.traceTsMicros).toBeUndefined();
  });
});
