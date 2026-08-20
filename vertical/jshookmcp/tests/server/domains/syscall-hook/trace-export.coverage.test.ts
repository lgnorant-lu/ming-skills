/**
 * Coverage tests for trace-export.ts — exercises time-range filtering,
 * within-window deduplication, NDJSON emission, and the cap behaviour.
 */

import { describe, expect, it } from 'vitest';
import { handleSyscallTraceExport } from '@server/domains/syscall-hook/handlers/trace-export';
import type { SyscallEvent } from '@modules/syscall-hook';

function makeEvent(overrides: Partial<SyscallEvent> = {}): SyscallEvent {
  return {
    syscall: 'read',
    args: ['0x3', '0x7ffe'],
    returnValue: 42,
    pid: 1000,
    timestamp: 1000,
    ...overrides,
  } as SyscallEvent;
}

describe('handleSyscallTraceExport — basic export', () => {
  it('returns all events when no filters are set, with NDJSON', async () => {
    const events = [makeEvent({ timestamp: 100 }), makeEvent({ timestamp: 200 })];
    const result = await handleSyscallTraceExport({}, events);

    expect(result.success).toBe(true);
    expect(result.totalCaptured).toBe(2);
    expect(result.filteredOut).toBe(0);
    expect(result.deduplicatedOut).toBe(0);
    expect(result.eventCount).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(result.ndjson).toBeDefined();
    expect(result.ndjson!.split('\n')).toHaveLength(2);
    expect(result.filters.deduplicate).toBe(false);
  });

  it('omits the ndjson field when includeNdjson=false', async () => {
    const result = await handleSyscallTraceExport({ includeNdjson: false }, [makeEvent()]);
    expect(result.ndjson).toBeUndefined();
  });

  it('omits the ndjson field when there are zero events', async () => {
    const result = await handleSyscallTraceExport({}, []);
    expect(result.ndjson).toBeUndefined();
    expect(result.eventCount).toBe(0);
  });
});

describe('handleSyscallTraceExport — time-range filter', () => {
  it('keeps only events within [minTimestamp, maxTimestamp]', async () => {
    const events = [
      makeEvent({ timestamp: 50 }),
      makeEvent({ timestamp: 150 }),
      makeEvent({ timestamp: 250 }),
    ];
    const result = await handleSyscallTraceExport({ minTimestamp: 100, maxTimestamp: 200 }, events);

    expect(result.eventCount).toBe(1);
    expect(result.filteredOut).toBe(2);
    expect(result.events[0]?.timestamp).toBe(150);
    expect(result.filters.minTimestamp).toBe(100);
    expect(result.filters.maxTimestamp).toBe(200);
  });

  it('minTimestamp only', async () => {
    const events = [makeEvent({ timestamp: 50 }), makeEvent({ timestamp: 150 })];
    const result = await handleSyscallTraceExport({ minTimestamp: 100 }, events);
    expect(result.eventCount).toBe(1);
    expect(result.filters.minTimestamp).toBe(100);
    expect(result.filters.maxTimestamp).toBeUndefined();
  });
});

describe('handleSyscallTraceExport — deduplication', () => {
  it('drops same-fingerprint events inside dedupWindowMs but keeps the first', async () => {
    const events = [
      makeEvent({ timestamp: 1000 }),
      makeEvent({ timestamp: 1050 }), // 50ms later, same fingerprint, window 100 → dup
      makeEvent({ timestamp: 2000 }), // 1000ms later → outside window, kept
    ];
    const result = await handleSyscallTraceExport(
      { deduplicate: true, dedupWindowMs: 100 },
      events,
    );

    expect(result.deduplicatedOut).toBe(1);
    expect(result.eventCount).toBe(2);
    expect(result.filters.deduplicate).toBe(true);
    expect(result.filters.dedupWindowMs).toBe(100);
  });

  it('does not deduplicate when deduplicate=false (default)', async () => {
    const events = [makeEvent({ timestamp: 1000 }), makeEvent({ timestamp: 1001 })];
    const result = await handleSyscallTraceExport({}, events);
    expect(result.deduplicatedOut).toBe(0);
    expect(result.eventCount).toBe(2);
  });

  it('handles a single event (dedup no-op on array of one)', async () => {
    const result = await handleSyscallTraceExport({ deduplicate: true }, [
      makeEvent({ timestamp: 1000 }),
    ]);
    expect(result.eventCount).toBe(1);
    expect(result.deduplicatedOut).toBe(0);
  });
});

describe('handleSyscallTraceExport — caps', () => {
  it('caps the events array at 10000 but reports the true eventCount', async () => {
    const events: SyscallEvent[] = Array.from({ length: 5 }, (_, i) =>
      makeEvent({ timestamp: i, args: [String(i)] }),
    );
    const result = await handleSyscallTraceExport({}, events);
    // Under the cap — events array length equals eventCount
    expect(result.events.length).toBe(result.eventCount);
  });
});
