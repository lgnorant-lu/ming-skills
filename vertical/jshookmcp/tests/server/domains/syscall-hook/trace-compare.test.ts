import { describe, expect, it } from 'vitest';
import { handleSyscallTraceCompare } from '@server/domains/syscall-hook/handlers/trace-compare';
import type { SyscallEvent } from '@modules/syscall-hook';

function ev(syscall: string, timestamp: number, args: string[] = []): SyscallEvent {
  return { timestamp, pid: 1234, syscall, args };
}

describe('handleSyscallTraceCompare', () => {
  it('detects syscalls that appeared in target but not baseline', async () => {
    const baseline: SyscallEvent[] = [ev('read', 0), ev('write', 1)];
    const target: SyscallEvent[] = [ev('read', 0), ev('write', 1), ev('openat', 2)];

    const result = await handleSyscallTraceCompare({}, baseline, target);

    expect(result.success).toBe(true);
    expect(result.appeared.map((e) => e.syscall)).toEqual(['openat']);
    expect(result.disappeared).toEqual([]);
  });

  it('detects syscalls that disappeared from target', async () => {
    const baseline: SyscallEvent[] = [ev('read', 0), ev('close', 1), ev('fstat', 2)];
    const target: SyscallEvent[] = [ev('read', 0)];

    const result = await handleSyscallTraceCompare({}, baseline, target);

    expect(result.disappeared.map((e) => e.syscall).toSorted()).toEqual(['close', 'fstat']);
    expect(result.appeared).toEqual([]);
  });

  it('reports frequency deltas for syscalls whose count changed', async () => {
    const baseline: SyscallEvent[] = [ev('read', 0), ev('read', 1), ev('write', 2)];
    const target: SyscallEvent[] = [
      ev('read', 0),
      ev('read', 1),
      ev('read', 2),
      ev('read', 3),
      ev('write', 4),
      ev('write', 5),
      ev('write', 6),
    ];

    const result = await handleSyscallTraceCompare({}, baseline, target);

    const byName = new Map(result.freqDeltas.map((d) => [d.name, d]));
    expect(byName.get('read')!.delta).toBe(2); // 2 → 4
    expect(byName.get('write')!.delta).toBe(2); // 1 → 3
  });

  it('respects maxDeltas to cap the returned list', async () => {
    const baseline: SyscallEvent[] = [];
    const target: SyscallEvent[] = [];
    for (let i = 0; i < 10; i++) {
      target.push(ev(`syscall_${i}`, i));
    }

    const result = await handleSyscallTraceCompare({ maxDeltas: 3 }, baseline, target);

    expect(result.freqDeltas.length).toBeLessThanOrEqual(3);
  });

  it('reports no significant differences when baseline and target match', async () => {
    const baseline: SyscallEvent[] = [ev('read', 0), ev('write', 1)];
    const target: SyscallEvent[] = [ev('read', 0), ev('write', 1)];

    const result = await handleSyscallTraceCompare({}, baseline, target);

    expect(result.appeared).toEqual([]);
    expect(result.disappeared).toEqual([]);
    expect(result.freqDeltas).toEqual([]);
    expect(result.summary).toContain('no significant differences');
  });

  it('builds a human-readable summary mixing appeared/deltas', async () => {
    const baseline: SyscallEvent[] = [ev('read', 0)];
    const target: SyscallEvent[] = [
      ev('read', 0),
      ev('read', 1),
      ev('connect', 2),
      ev('connect', 3),
      ev('connect', 4),
      ev('connect', 5),
    ];

    const result = await handleSyscallTraceCompare({}, baseline, target);

    expect(result.summary).toContain('appeared');
    expect(result.baselineCount).toBe(1);
    expect(result.targetCount).toBe(6);
  });

  it('handles empty baseline and target', async () => {
    const result = await handleSyscallTraceCompare({}, [], []);
    expect(result.success).toBe(true);
    expect(result.summary).toContain('no significant differences');
  });
});
