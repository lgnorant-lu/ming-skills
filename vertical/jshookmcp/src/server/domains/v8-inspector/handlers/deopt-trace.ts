/**
 * V8 Deopt Trace Handler — v8_deopt_trace
 *
 * Dual-mode deoptimization tracing:
 *
 * 1. Tracing mode (primary — no V8 natives syntax needed). Starts a CDP
 *    Tracing session with the "v8" category and collects `V8.DeoptimizeFrame`
 *    trace events via `Tracing.dataCollected`. These are structured events
 *    with functionName / deoptReason / bailoutType / scriptId / lineNumber
 *    args, and their `ts` comes from the trace clock (µs epoch) — the same
 *    clock CPU profiles from profiler_cpu use, so deopts can be aligned with
 *    profile samples.
 *
 * 2. Natives mode (fallback). Uses %TraceDeoptimizations(true) via
 *    Runtime.evaluate and parses the "[deoptimizing (DEOPT …): begin/end]"
 *    lines V8 prints to the console (Runtime.consoleAPICalled). Requires V8
 *    natives syntax. The console output carries only the deopt type
 *    (eager/lazy/soft) — not the reason text — so the type lands in
 *    `deoptType` and `reason` stays empty. begin/end pairs are deduplicated
 *    (only begin lines emit events) and timestamps are absolute epoch
 *    milliseconds (Date.now()), not relative to the trace start.
 *
 * The listeners + tracing + CDP session are torn down in a finally block so
 * no handle leaks across calls (the pre-fix implementation left a
 * Debugger.paused listener and a setTimeout orphaned per call).
 */

import { argNumber, argBool } from '@server/domains/shared/parse-args';
import { normalizeSessionSource, resolveTargetSession } from './cdp-session';
import type { CDPSessionLike, SessionSource } from './cdp-session';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DeoptEvent {
  /** Absolute epoch milliseconds — trace clock (Tracing mode) or Date.now() (natives mode). */
  timestamp: number;
  functionName: string;
  /**
   * Deopt reason text. Tracing mode carries the real reason; the natives
   * console output prints only the deopt type, so reason is '' there and the
   * type lives in `deoptType`.
   */
  reason: string;
  /** DeoptimizeKind: 'eager' | 'lazy' | 'soft' (when the source provides it). */
  deoptType?: string;
  scriptId?: number | string;
  lineNumber?: number;
  bailoutId?: number;
  inliningId?: number;
  sourcePosition?: number;
  /** Raw trace-clock timestamp (µs epoch) — Tracing mode only. CPU profiles
   *  from profiler_cpu use the same µs epoch clock, so this aligns deopts
   *  with profile samples. */
  traceTsMicros?: number;
}

export interface DeoptTraceResult {
  success: boolean;
  error?: string;
  mode: 'tracing' | 'natives' | 'unavailable';
  traceEnabled: boolean;
  durationMs: number;
  events: DeoptEvent[];
  eventCount: number;
  summary: string;
  note?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Trace event name emitted by V8 when an optimized frame is deoptimized. */
const DEOPT_FRAME_EVENT = 'V8.DeoptimizeFrame';

/** Tracing categories that carry V8 deopt/compile events. */
const TRACING_CATEGORIES = ['v8', 'disabled-by-default-v8.compile'];

/** Grace window after Tracing.end for the final dataCollected batches. */
const TRACING_COMPLETE_TIMEOUT_MS = 2000;

// ── Helpers ────────────────────────────────────────────────────────────────────

type EventHandler = (params: Record<string, unknown>) => void;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Do not keep the event loop alive for the safety timeout once the
    // tracingComplete promise already resolved the race.
    (timer as { unref?: () => void }).unref?.();
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

async function checkNativesSupport(session: CDPSessionLike): Promise<boolean> {
  try {
    const resp = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression:
        'typeof %DebugTrace === "function" && typeof %TraceDeoptimizations === "function"',
      returnByValue: true,
      awaitPromise: false,
    });
    return resp?.result?.value === true;
  } catch {
    return false;
  }
}

// ── Trace-event parsing ────────────────────────────────────────────────────────

/**
 * Parse `V8.DeoptimizeFrame` events out of raw trace-event payloads collected
 * from `Tracing.dataCollected`. Field names differ across V8/Chromium
 * versions (camelCase vs snake_case args), so each field is resolved against
 * its known candidates. Unknown non-frame events are ignored.
 */
export function parseTraceDeoptEvents(rawEvents: unknown[]): DeoptEvent[] {
  const out: DeoptEvent[] = [];
  for (const item of rawEvents) {
    const ev = asRecord(item);
    if (!ev || ev['name'] !== DEOPT_FRAME_EVENT) continue;
    const args = asRecord(ev['args']) ?? {};
    const tsMicros = asNumber(ev['ts']);

    const functionName =
      asString(args['functionName']) ?? asString(args['function_name']) ?? '<anonymous>';
    const reason =
      asString(args['deoptReason']) ??
      asString(args['reason']) ??
      asString(args['deopt_reason']) ??
      '';
    const deoptType =
      asString(args['bailoutType']) ??
      asString(args['deoptType']) ??
      asString(args['bailout_type']) ??
      asString(args['deoptKind']);
    const scriptId =
      asNumber(args['scriptId']) ?? asString(args['scriptId']) ?? asNumber(args['script_id']);
    const lineNumber = asNumber(args['lineNumber']) ?? asNumber(args['line_number']);
    const bailoutId =
      asNumber(args['bailoutId']) ??
      asNumber(args['bailout_id']) ??
      asNumber(args['optimizationId']) ??
      asNumber(args['optimization_id']);
    const inliningId = asNumber(args['inliningId']) ?? asNumber(args['inlining_id']);
    const sourcePosition =
      asNumber(args['sourcePosition']) ??
      asNumber(args['source_position']) ??
      asNumber(args['nodeId']) ??
      asNumber(args['node_id']);

    const event: DeoptEvent = {
      timestamp: tsMicros !== undefined ? Math.round(tsMicros / 1000) : Date.now(),
      functionName,
      reason,
    };
    if (tsMicros !== undefined) event.traceTsMicros = tsMicros;
    if (deoptType !== undefined) event.deoptType = deoptType;
    if (scriptId !== undefined) event.scriptId = scriptId;
    if (lineNumber !== undefined) event.lineNumber = lineNumber;
    if (bailoutId !== undefined) event.bailoutId = bailoutId;
    if (inliningId !== undefined) event.inliningId = inliningId;
    if (sourcePosition !== undefined) event.sourcePosition = sourcePosition;
    out.push(event);
  }
  return out;
}

// ── Natives console parsing ────────────────────────────────────────────────────

/**
 * Parse one V8 deopt console line (as printed by %TraceDeoptimizations) into
 * a DeoptEvent, or null when the line is not a deopt-begin line. End lines
 * ("…: end …") are dropped so each deopt emits exactly one event, and lines
 * that merely mention "deoptimize" (e.g. the "deoptimize at file:line:col"
 * position line inside a begin block) are ignored — the begin line carries
 * the function name.
 */
export function parseConsoleDeoptLine(desc: string, at: number): DeoptEvent | null {
  if (!/deoptim/i.test(desc)) return null;
  if (/\[deoptimizing \(DEOPT \w+\): end/i.test(desc)) return null;
  const beginMatch = desc.match(/\[deoptimizing \(DEOPT (\w+)\): begin/i);
  if (!beginMatch) return null;

  // V8 prints "<JS Function NAME (sfi #N)>" or "<JS Function NAME>"; cut at
  // the first '(' or '<' after the name so the captured name is clean.
  const fnMatch = desc.match(/<JS Function ([^()<]+)/);
  const posMatch = desc.match(/deoptimize at [^:]+:(\d+):(\d+)/);
  const posLine = posMatch?.[1];

  const event: DeoptEvent = {
    timestamp: at,
    functionName: fnMatch?.[1]?.trim() ?? '<anonymous>',
    // %TraceDeoptimizations console output carries only the deopt type,
    // never the reason text — see the handler doc comment.
    reason: '',
    deoptType: beginMatch[1]?.toLowerCase() ?? undefined,
  };
  if (posLine !== undefined) event.sourcePosition = Number(posLine);
  return event;
}

// ── Console collection (natives fallback) ─────────────────────────────────────

/**
 * Collect deopt events from Runtime.consoleAPICalled while
 * %TraceDeoptimizations is enabled (or passively, when enableNatives is
 * false — observe existing console output without starting anything).
 * The listener is always removed before returning; no orphan persists.
 */
async function collectConsoleEvents(
  session: CDPSessionLike,
  durationMs: number,
  maxEvents: number,
  enableNatives: boolean,
): Promise<{ events: DeoptEvent[]; traceEnabled: boolean }> {
  const events: DeoptEvent[] = [];
  const cdp = session as unknown as {
    on?: (event: string, handler: EventHandler) => void;
    off?: (event: string, handler: EventHandler) => void;
    removeListener?: (event: string, handler: EventHandler) => void;
  };

  // %TraceDeoptimizations prints deopt diagnostics to the V8 console, it does
  // NOT raise Debugger.paused events. Subscribe to Runtime.consoleAPICalled
  // and parse the "deoptimizing" log lines V8 emits.
  const consoleHandler: EventHandler = (params) => {
    const type = params['type'];
    const apiArgs = Array.isArray(params['args']) ? params['args'] : [];
    // V8 deopt logging goes to 'log' / 'verbose' console channels.
    if (type !== 'log' && type !== 'verbose' && type !== 'info') return;
    for (const a of apiArgs) {
      const rec = asRecord(a);
      const desc = asString(rec?.['description']);
      if (!desc) continue;
      const event = parseConsoleDeoptLine(desc, Date.now());
      if (!event) continue;
      events.push(event);
      if (events.length >= maxEvents) return;
    }
  };

  const startTime = Date.now();
  try {
    await session.send('Runtime.enable').catch(() => {});
    if (typeof cdp.on === 'function') {
      cdp.on('Runtime.consoleAPICalled', consoleHandler);
    }

    if (enableNatives) {
      await session.send('Runtime.evaluate', {
        expression: `
          (() => {
            if (typeof %TraceDeoptimizations === 'function') {
              %TraceDeoptimizations(true);
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });
    }

    // Wait for the full collection window. durationMs is already clamped to
    // the [100, 60000] schema bounds above.
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, durationMs - elapsed);
    if (remaining > 0) {
      await sleep(remaining);
    }

    if (enableNatives) {
      await session
        .send('Runtime.evaluate', {
          expression: `
          (() => {
            if (typeof %TraceDeoptimizations === 'function') {
              %TraceDeoptimizations(false);
              return true;
            }
            return false;
          })()
        `,
          returnByValue: true,
          awaitPromise: false,
        })
        .catch(() => {});
    }
  } catch {
    // Best-effort — continue with whatever events we collected
  } finally {
    if (typeof cdp.off === 'function') {
      cdp.off('Runtime.consoleAPICalled', consoleHandler);
    } else if (typeof cdp.removeListener === 'function') {
      cdp.removeListener('Runtime.consoleAPICalled', consoleHandler);
    }
  }
  return { events, traceEnabled: enableNatives };
}

// ── Result builder ─────────────────────────────────────────────────────────────

function buildResult(
  mode: DeoptTraceResult['mode'],
  traceEnabled: boolean,
  events: DeoptEvent[],
  maxEvents: number,
  startTime: number,
  note?: string,
): DeoptTraceResult {
  const actualDuration = Date.now() - startTime;
  const functionNames = new Set(events.map((e) => e.functionName));
  const summaryParts: string[] = [];
  if (events.length > 0) {
    summaryParts.push(`${events.length} deopt events (${mode} mode)`);
    summaryParts.push(`${functionNames.size} unique functions affected`);
  } else {
    summaryParts.push(`No deopt events captured during trace window (${mode} mode)`);
  }

  const result: DeoptTraceResult = {
    success: true,
    mode,
    traceEnabled,
    durationMs: actualDuration,
    events: events.slice(0, maxEvents),
    eventCount: events.length,
    summary: summaryParts.join('; '),
  };
  if (note) result.note = note;
  return result;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleDeoptTrace(
  args: Record<string, unknown>,
  source?: SessionSource,
): Promise<DeoptTraceResult> {
  const durationRaw = argNumber(args, 'durationMs', 5000);
  // Mirror definitions.ts minimum:100 / maximum:60000 constraints at runtime
  // (argNumber alone does not enforce schema bounds).
  const durationMs = Math.min(
    60000,
    Math.max(100, Number.isFinite(durationRaw) ? durationRaw : 5000),
  );
  const maxEventsRaw = argNumber(args, 'maxEvents', 50);
  const maxEvents = Math.min(1000, Math.max(1, Number.isFinite(maxEventsRaw) ? maxEventsRaw : 50));
  const enableTracing = argBool(args, 'enable', true);

  const { session, owned } = await resolveTargetSession(normalizeSessionSource(source));
  if (!session) {
    return {
      success: false,
      error:
        'No CDP session available — browser must be connected via browser_launch or browser_attach',
      mode: 'unavailable',
      traceEnabled: false,
      durationMs: 0,
      events: [],
      eventCount: 0,
      summary: 'CDP session unavailable',
    };
  }

  const cdp = session as unknown as {
    on?: (event: string, handler: EventHandler) => void;
    off?: (event: string, handler: EventHandler) => void;
    removeListener?: (event: string, handler: EventHandler) => void;
  };

  const startTime = Date.now();
  let mode: DeoptTraceResult['mode'] = 'unavailable';
  let traceEnabled = false;
  let tracingStarted = false;
  let events: DeoptEvent[] = [];
  let note: string | undefined;

  const rawTraceEvents: unknown[] = [];
  let resolveComplete: (() => void) | null = null;
  const onDataCollected: EventHandler = (params) => {
    const value = params['value'];
    if (Array.isArray(value)) rawTraceEvents.push(...value);
  };
  const onTracingComplete: EventHandler = () => resolveComplete?.();

  try {
    if (!enableTracing) {
      // Passive collection — observe existing console output only, never
      // start a Tracing session or flip the natives flag.
      const r = await collectConsoleEvents(session, durationMs, maxEvents, false);
      events = r.events;
      traceEnabled = r.traceEnabled;
      mode = 'natives';
      return buildResult(mode, traceEnabled, events, maxEvents, startTime);
    }

    // ── Primary path: CDP Tracing ("v8" category, no natives needed) ──
    if (typeof cdp.on === 'function') {
      cdp.on('Tracing.dataCollected', onDataCollected);
      cdp.on('Tracing.tracingComplete', onTracingComplete);
    }
    const completePromise = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });

    try {
      await session.send('Tracing.start', {
        categories: TRACING_CATEGORIES,
        transferMode: 'ReportEvents',
      });
      tracingStarted = true;
      traceEnabled = true;
    } catch {
      // Tracing unavailable on this target (e.g. a worker session that does
      // not accept the Tracing domain) — fall back to natives console parsing.
      if (typeof cdp.off === 'function') {
        cdp.off('Tracing.dataCollected', onDataCollected);
        cdp.off('Tracing.tracingComplete', onTracingComplete);
      }
      const nativesAvailable = await checkNativesSupport(session);
      if (!nativesAvailable) {
        mode = 'unavailable';
        note =
          'Try launching Chrome with --js-flags="--allow-natives-syntax" or --no-sandbox for deopt tracing.';
        return {
          success: true,
          mode: 'unavailable',
          traceEnabled: false,
          durationMs: Date.now() - startTime,
          events: [],
          eventCount: 0,
          summary: 'V8 natives syntax (%TraceDeoptimizations) not available in this target',
          note,
        };
      }
      const r = await collectConsoleEvents(session, durationMs, maxEvents, true);
      events = r.events;
      traceEnabled = r.traceEnabled;
      mode = 'natives';
      return buildResult(mode, traceEnabled, events, maxEvents, startTime);
    }

    // Wait for the full collection window.
    await sleep(durationMs);

    // Tracing.end flushes the remaining dataCollected batches before
    // tracingComplete fires; wait for it with a safety timeout so a
    // non-compliant target cannot hang the call.
    await session.send('Tracing.end').catch(() => {});
    await Promise.race([completePromise, sleep(TRACING_COMPLETE_TIMEOUT_MS)]);

    events = parseTraceDeoptEvents(rawTraceEvents);
    mode = 'tracing';
    return buildResult(mode, traceEnabled, events, maxEvents, startTime);
  } finally {
    if (typeof cdp.off === 'function') {
      cdp.off('Tracing.dataCollected', onDataCollected);
      cdp.off('Tracing.tracingComplete', onTracingComplete);
    }
    if (tracingStarted) {
      await session.send('Tracing.disable').catch(() => {});
    }
    if (owned) await session.detach().catch(() => {});
  }
}
