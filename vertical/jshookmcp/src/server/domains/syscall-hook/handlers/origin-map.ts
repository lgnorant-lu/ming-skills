/**
 * syscall_origin_map — unified syscall→JS origin aggregation.
 *
 * Integrates syscall_stack_capture (live CDP stacks) with
 * syscall_correlate_js (SyscallToJSMapper heuristics) into a single
 * per-JS-function origin map. For each captured syscall event the handler
 * prefers a live debugger stack frame, falls back to the heuristic mapper,
 * and aggregates the result by JavaScript function so callers can answer
 * "which JS function triggered which syscalls, and how often".
 */

import type { MCPServerContext } from '@server/MCPServer.context';
import type { DebuggerManager, CallFrame } from '@modules/debugger/DebuggerManager';
import type { SyscallEvent } from '@modules/syscall-hook';
import { SyscallToJSMapper } from '@modules/syscall-hook';
import { argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StackFrame {
  functionName: string;
  scriptUrl?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface SyscallFootprint {
  syscall: string;
  count: number;
  /** Average correlation confidence across the events that mapped here. */
  avgConfidence: number;
  /** Sample arguments from the most recent event of this syscall. */
  sampleArgs: string[];
}

interface OriginEntry {
  jsFunction: string;
  totalEvents: number;
  /** How the JS function was identified for this entry. */
  source: 'debugger' | 'heuristic' | 'mixed' | 'unknown';
  syscalls: SyscallFootprint[];
  /** Top CDP stack frame when available (script + line for jump-to-source). */
  topFrame?: StackFrame;
}

interface OriginMapResult {
  success: boolean;
  error?: string;
  eventsAnalyzed: number;
  unmappedCount: number;
  mode: 'debugger' | 'heuristic' | 'mixed';
  origins: OriginEntry[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Pull the paused CDP call frames from the runtime debugger, if one is
 * attached and currently paused. Returns `undefined` when no debugger is
 * attached or the target isn't paused — in those cases the caller falls
 * back to the heuristic mapper.
 *
 * Uses the real `DebuggerManager.getPausedState()` contract (synchronous,
 * returns `PausedState | null`) rather than reflective property probing,
 * so a contract change surfaces at compile time. There is no async CDP
 * round-trip here — `getPausedState` reads the cached paused state already
 * captured by the DebuggerManager's event handler — so no try/catch is
 * needed.
 */
function tryGetJsStack(ctx: MCPServerContext): StackFrame[] | undefined {
  const dm = ctx.debuggerManager as DebuggerManager | undefined;
  if (!dm) return undefined;

  const state = dm.getPausedState();
  const callFrames = state?.callFrames;
  if (!callFrames || callFrames.length === 0) {
    return undefined;
  }

  return callFrames.map((frame: CallFrame) => ({
    functionName: frame.functionName || '<anonymous>',
    scriptUrl: frame.url || undefined,
    lineNumber: frame.location?.lineNumber,
    columnNumber: frame.location?.columnNumber,
  }));
}

interface AccumulatedEntry {
  jsFunction: string;
  totalEvents: number;
  sources: Set<'debugger' | 'heuristic' | 'unknown'>;
  syscallStats: Map<string, { count: number; confidenceSum: number; sampleArgs: string[] }>;
  topFrame?: StackFrame;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleSyscallOriginMap(
  args: Record<string, unknown>,
  capturedEvents: SyscallEvent[],
  ctx?: MCPServerContext,
): Promise<OriginMapResult> {
  const maxEvents = argNumber(args, 'maxEvents', 50);
  const useDebugger = argBool(args, 'useDebugger', true);

  const events = capturedEvents.slice(-maxEvents);
  const mapper = new SyscallToJSMapper();

  // The live stack is captured once (debugger must be paused for CDP to
  // expose frames); we attribute every event to that frame when available.
  let liveStack: StackFrame[] | undefined;
  if (useDebugger && ctx) {
    liveStack = tryGetJsStack(ctx);
  }

  const byFunction = new Map<string, AccumulatedEntry>();
  let unmappedCount = 0;

  for (const event of events) {
    const heuristic = mapper.map(event);
    const liveTopFrame = liveStack?.[0];
    const heuristicFunction = heuristic?.jsFunction;

    let jsFunction: string;
    let source: 'debugger' | 'heuristic' | 'unknown';

    if (liveTopFrame) {
      jsFunction = liveTopFrame.functionName;
      source = 'debugger';
    } else if (heuristicFunction) {
      jsFunction = heuristicFunction;
      source = 'heuristic';
    } else {
      jsFunction = '<unmapped>';
      source = 'unknown';
      unmappedCount++;
    }

    const confidence = liveTopFrame ? 1.0 : (heuristic?.confidence ?? 0);

    let entry = byFunction.get(jsFunction);
    if (!entry) {
      entry = {
        jsFunction,
        totalEvents: 0,
        sources: new Set(),
        syscallStats: new Map(),
        ...(liveTopFrame ? { topFrame: liveTopFrame } : {}),
      };
      byFunction.set(jsFunction, entry);
    }

    entry.totalEvents++;
    entry.sources.add(source);
    if (liveTopFrame && !entry.topFrame) {
      entry.topFrame = liveTopFrame;
    }

    const stats = entry.syscallStats.get(event.syscall) ?? {
      count: 0,
      confidenceSum: 0,
      sampleArgs: [],
    };
    stats.count++;
    stats.confidenceSum += confidence;
    // Keep the most recent non-empty sample args.
    if (event.args.length > 0) {
      stats.sampleArgs = event.args.slice(0, 4);
    }
    entry.syscallStats.set(event.syscall, stats);
  }

  let origins: OriginEntry[] = [];
  let sawDebugger = false;
  let sawHeuristic = false;

  for (const entry of byFunction.values()) {
    const syscalls: SyscallFootprint[] = Array.from(entry.syscallStats.entries())
      .map(([syscall, stats]) => ({
        syscall,
        count: stats.count,
        avgConfidence: stats.count > 0 ? Number((stats.confidenceSum / stats.count).toFixed(3)) : 0,
        sampleArgs: stats.sampleArgs,
      }))
      .toSorted((a, b) => b.count - a.count);

    const sourceSet = entry.sources;
    let resolvedSource: OriginEntry['source'];
    if (sourceSet.has('debugger')) {
      resolvedSource = 'debugger';
      sawDebugger = true;
    } else if (sourceSet.has('heuristic')) {
      resolvedSource = 'heuristic';
      sawHeuristic = true;
    } else {
      resolvedSource = 'unknown';
    }

    origins.push({
      jsFunction: entry.jsFunction,
      totalEvents: entry.totalEvents,
      source: resolvedSource,
      syscalls,
      ...(entry.topFrame ? { topFrame: entry.topFrame } : {}),
    });
  }

  origins = origins.toSorted((a, b) => b.totalEvents - a.totalEvents);

  // Override per-entry 'source' to 'mixed' when both debugger and heuristic
  // contributed across the whole origin map.
  if (sawDebugger && sawHeuristic) {
    for (const origin of origins) {
      if (origin.source === 'debugger' || origin.source === 'heuristic') {
        origin.source = 'mixed';
      }
    }
  }

  const mode: OriginMapResult['mode'] =
    sawDebugger && sawHeuristic ? 'mixed' : sawDebugger ? 'debugger' : 'heuristic';

  return {
    success: true,
    eventsAnalyzed: events.length,
    unmappedCount,
    mode,
    origins,
  };
}
