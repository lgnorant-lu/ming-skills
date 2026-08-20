import { describe, expect, it } from 'vitest';
import { handleSyscallPatternDetect } from '@server/domains/syscall-hook/handlers/pattern-detect';
import type { SyscallEvent } from '@modules/syscall-hook';

function ev(syscall: string, timestamp: number): SyscallEvent {
  return { timestamp, pid: 1234, syscall, args: [] };
}

describe('handleSyscallPatternDetect', () => {
  it('detects an anti-debug probe from a single ptrace syscall', async () => {
    const events: SyscallEvent[] = [ev('ptrace', 0), ev('read', 1), ev('write', 2)];

    const result = await handleSyscallPatternDetect({}, events);

    expect(result.success).toBe(true);
    const antiDebug = result.patterns.find((p) => p.kind === 'anti_debug');
    expect(antiDebug).toBeDefined();
    expect(antiDebug!.eventCount).toBe(1);
    expect(antiDebug!.syscalls).toContain('ptrace');
    expect(antiDebug!.confidence).toBeGreaterThan(0);
  });

  it('detects system fingerprinting when 3+ identity syscalls cluster', async () => {
    const events: SyscallEvent[] = [
      ev('uname', 0),
      ev('getuid', 1),
      ev('getgid', 2),
      ev('sysinfo', 3),
      ev('read', 4),
    ];

    const result = await handleSyscallPatternDetect({}, events);

    const fingerprint = result.patterns.find((p) => p.kind === 'fingerprint');
    expect(fingerprint).toBeDefined();
    expect(fingerprint!.eventCount).toBe(4);
    expect(fingerprint!.syscalls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not fire fingerprint when fewer than 3 distinct identity syscalls', async () => {
    const events: SyscallEvent[] = [ev('uname', 0), ev('uname', 1), ev('uname', 2)];

    const result = await handleSyscallPatternDetect({}, events);

    expect(result.patterns.find((p) => p.kind === 'fingerprint')).toBeUndefined();
  });

  it('detects filesystem enumeration from openat + getdents burst', async () => {
    const events: SyscallEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(ev('openat', i));
    for (let i = 0; i < 4; i++) events.push(ev('getdents64', 10 + i));

    const result = await handleSyscallPatternDetect({}, events);

    const fileEnum = result.patterns.find((p) => p.kind === 'file_enum');
    expect(fileEnum).toBeDefined();
    expect(fileEnum!.eventCount).toBe(10);
    expect(fileEnum!.syscalls).toEqual(['getdents64', 'openat']);
  });

  it('detects network beaconing from repeated connect calls', async () => {
    const events: SyscallEvent[] = [
      ev('connect', 0),
      ev('connect', 1000),
      ev('connect', 2000),
      ev('sendto', 2100),
    ];

    const result = await handleSyscallPatternDetect({}, events);

    const beacon = result.patterns.find((p) => p.kind === 'network_beacon');
    expect(beacon).toBeDefined();
    expect(beacon!.eventCount).toBe(4);
  });

  it('detects process spawning from a single clone', async () => {
    const events: SyscallEvent[] = [ev('read', 0), ev('clone', 1), ev('read', 2)];

    const result = await handleSyscallPatternDetect({}, events);

    const spawn = result.patterns.find((p) => p.kind === 'process_spawn');
    expect(spawn).toBeDefined();
    expect(spawn!.syscalls).toContain('clone');
  });

  it('detects Windows registry probing', async () => {
    const events: SyscallEvent[] = [
      ev('RegOpenKeyEx', 0),
      ev('RegQueryValueEx', 1),
      ev('RegEnumKey', 2),
      ev('RegOpenKeyEx', 3),
    ];

    const result = await handleSyscallPatternDetect({}, events);

    const registry = result.patterns.find((p) => p.kind === 'registry_probe');
    expect(registry).toBeDefined();
    expect(registry!.eventCount).toBe(4);
  });

  it('returns no patterns for benign syscall traffic', async () => {
    const events: SyscallEvent[] = [ev('read', 0), ev('write', 1), ev('read', 2), ev('write', 3)];

    const result = await handleSyscallPatternDetect({}, events);

    expect(result.patterns).toEqual([]);
  });

  it('sorts detected patterns by descending confidence', async () => {
    const events: SyscallEvent[] = [
      ev('ptrace', 0),
      ev('uname', 1),
      ev('getuid', 2),
      ev('sysinfo', 3),
    ];

    const result = await handleSyscallPatternDetect({}, events);

    const confidences = result.patterns.map((p) => p.confidence);
    const sorted = [...confidences].toSorted((a, b) => b - a);
    expect(confidences).toEqual(sorted);
  });

  it('respects maxEvents to scan only the tail', async () => {
    const events: SyscallEvent[] = [];
    for (let i = 0; i < 20; i++) events.push(ev('ptrace', i));

    const result = await handleSyscallPatternDetect({ maxEvents: 5 }, events);

    expect(result.eventsAnalyzed).toBe(5);
    const antiDebug = result.patterns.find((p) => p.kind === 'anti_debug');
    expect(antiDebug!.eventCount).toBe(5);
  });

  it('includes event timestamps as evidence', async () => {
    const events: SyscallEvent[] = [ev('ptrace', 42)];

    const result = await handleSyscallPatternDetect({}, events);

    const antiDebug = result.patterns.find((p) => p.kind === 'anti_debug');
    expect(antiDebug!.eventTimestamps).toContain(42);
  });

  it('handles an empty event list', async () => {
    const result = await handleSyscallPatternDetect({}, []);
    expect(result.success).toBe(true);
    expect(result.patterns).toEqual([]);
    expect(result.eventsAnalyzed).toBe(0);
  });
});
