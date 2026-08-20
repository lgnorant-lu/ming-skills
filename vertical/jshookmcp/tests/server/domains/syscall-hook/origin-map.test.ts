import { describe, expect, it } from 'vitest';
import { handleSyscallOriginMap } from '@server/domains/syscall-hook/handlers/origin-map';
import type { SyscallEvent } from '@modules/syscall-hook';

function makeEvent(
  syscall: string,
  args: string[] = [],
  timestamp = 0,
  returnValue?: number,
): SyscallEvent {
  return {
    timestamp,
    pid: 1234,
    syscall,
    args,
    ...(returnValue !== undefined ? { returnValue } : {}),
  };
}

describe('handleSyscallOriginMap', () => {
  it('aggregates heuristically-mapped syscalls by JS function', async () => {
    const events: SyscallEvent[] = [
      makeEvent('openat', ['path=/app/index.js'], 0),
      makeEvent('read', ['fd=3', 'count=1024'], 10),
      makeEvent('openat', ['path=/app/data.json'], 20),
      makeEvent('write', ['fd=4', 'count=64'], 30),
      makeEvent('connect', ['fd=5', 'port=443'], 40),
    ];

    const result = await handleSyscallOriginMap({ maxEvents: 50 }, events);

    expect(result.success).toBe(true);
    expect(result.eventsAnalyzed).toBe(5);
    expect(result.mode).toBe('heuristic');
    expect(result.unmappedCount).toBe(0);

    const byFunction = new Map(result.origins.map((o) => [o.jsFunction, o]));
    expect(byFunction.has('fs.readFile')).toBe(true);
    expect(byFunction.has('fs.writeFile')).toBe(true);
    expect(byFunction.has('fetch')).toBe(true);

    // fs.open aggregates the two openat events.
    expect(byFunction.get('fs.open')!.totalEvents).toBe(2);
    expect(byFunction.get('fs.readFile')!.totalEvents).toBe(1);
  });

  it('maps openat to fs.open and read to fs.readFile separately', async () => {
    const events: SyscallEvent[] = [
      makeEvent('openat', ['path=/x.js']),
      makeEvent('read', ['fd=3']),
    ];

    const result = await handleSyscallOriginMap({}, events);

    const functions = result.origins.map((o) => o.jsFunction).toSorted();
    expect(functions).toEqual(['fs.open', 'fs.readFile']);
  });

  it('counts unmapped syscalls that no heuristic covers', async () => {
    const events: SyscallEvent[] = [
      makeEvent('openat', ['path=/x.js']),
      makeEvent('sched_yield', []),
      makeEvent('futex', []),
    ];

    const result = await handleSyscallOriginMap({}, events);

    expect(result.unmappedCount).toBe(2);
    const unmapped = result.origins.find((o) => o.jsFunction === '<unmapped>');
    expect(unmapped).toBeDefined();
    expect(unmapped!.source).toBe('unknown');
    expect(unmapped!.syscalls.map((s) => s.syscall).toSorted()).toEqual(['futex', 'sched_yield']);
  });

  it('respects maxEvents to analyze only the tail', async () => {
    const events: SyscallEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(makeEvent('openat', [`path=/f${i}.js`], i));
    }

    const result = await handleSyscallOriginMap({ maxEvents: 3 }, events);

    expect(result.eventsAnalyzed).toBe(3);
  });

  it('aggregates syscall footprints per JS function with counts and avg confidence', async () => {
    const events: SyscallEvent[] = [
      makeEvent('connect', ['port=443'], 0),
      makeEvent('connect', ['port=443'], 10),
      makeEvent('sendto', ['fd=5'], 20),
    ];

    const result = await handleSyscallOriginMap({}, events);

    const fetch = result.origins.find((o) => o.jsFunction === 'fetch')!;
    expect(fetch).toBeDefined();
    expect(fetch.totalEvents).toBe(3);
    const byName = new Map(fetch.syscalls.map((s) => [s.syscall, s]));
    expect(byName.get('connect')!.count).toBe(2);
    expect(byName.get('sendto')!.count).toBe(1);
    expect(byName.get('connect')!.avgConfidence).toBeGreaterThan(0);
    expect(byName.get('connect')!.avgConfidence).toBeLessThanOrEqual(1);
  });

  it('reports mode as heuristic when no debugger context is provided', async () => {
    const events: SyscallEvent[] = [makeEvent('read', ['fd=3'])];
    const result = await handleSyscallOriginMap({}, events);
    expect(result.mode).toBe('heuristic');
  });

  it('handles an empty event list cleanly', async () => {
    const result = await handleSyscallOriginMap({}, []);
    expect(result.success).toBe(true);
    expect(result.eventsAnalyzed).toBe(0);
    expect(result.origins).toEqual([]);
    expect(result.unmappedCount).toBe(0);
  });

  it('attributes events to the live debugger frame when one is paused', async () => {
    // Synthesize a MCPServerContext with a paused debugger whose top frame is
    // `app.handleRequest`. tryGetJsStack reads getPausedState() synchronously,
    // so every event should be attributed to that frame as the 'debugger'
    // source (mode 'debugger').
    const events: SyscallEvent[] = [makeEvent('read', ['fd=3']), makeEvent('write', ['fd=4'])];
    const callFrames = [
      {
        callFrameId: 'cf-0',
        functionName: 'app.handleRequest',
        url: 'app.js',
        location: { scriptId: 's1', lineNumber: 10, columnNumber: 0 },
        scopeChain: [],
        this: undefined,
      },
    ];
    const fakeDebuggerManager = {
      getPausedState: () => ({ callFrames, reason: 'other' }),
    };
    const ctx = { debuggerManager: fakeDebuggerManager } as unknown as Parameters<
      typeof handleSyscallOriginMap
    >[2];

    const result = await handleSyscallOriginMap({ useDebugger: true }, events, ctx);

    expect(result.success).toBe(true);
    expect(result.mode).toBe('debugger');
    expect(result.origins).toHaveLength(1);
    expect(result.origins[0]?.jsFunction).toBe('app.handleRequest');
    expect(result.origins[0]?.source).toBe('debugger');
    expect(result.origins[0]?.topFrame?.scriptUrl).toBe('app.js');
  });
});
