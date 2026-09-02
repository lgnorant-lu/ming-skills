/**
 * Regression tests for captureLiveBpftrace stdout line-buffering.
 *
 * A JSON event line split across two stdout chunks must be reassembled before
 * parsing — the pre-fix code pushed every `\n`-split fragment (including the
 * trailing partial) as its own "line", so any event straddling a chunk
 * boundary was silently dropped (OCR finding, ebpf-attach.ts L349).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  // probeBpftrace promisifies execFile → resolves with { stdout }
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: unknown, res: { stdout: string }) => void;
    cb(null, { stdout: 'bpftrace v0.21.2' });
  },
}));

function makeChild(): EventEmitter & {
  stdout: Readable;
  stderr: Readable;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  return child;
}

describe('handleSyscallEbpfAttach — live stdout chunk reassembly', () => {
  let platformSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    mockSpawn.mockReset();
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux' as never);
  });

  afterEach(() => {
    platformSpy?.mockRestore();
  });

  it('parses a JSON event line split across two stdout chunks', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const promise = handleSyscallEbpfAttach({ pid: 42, durationSec: 1, syscalls: ['read'] });

    // The enter-event JSON line straddles two chunks.
    child.stdout.push(
      '{"type":"enter","elapsedMs":10,"pid":42,"tid":7,"syscall":"tracepoint:syscalls:sys_enter_re',
    );
    child.stdout.push('ad","args":""}\n');
    child.stdout.push(null);
    child.stderr.push(null);

    // Let the data handlers run, then close the child.
    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit('close', 0);

    const res = (await promise) as {
      success: boolean;
      mode: string;
      events?: Array<Record<string, unknown>>;
    };
    expect(res.success).toBe(true);
    expect(res.mode).toBe('live');
    expect(res.events).toHaveLength(1);
    expect(res.events![0]).toMatchObject({ pid: 42, syscall: 'read' });
  });

  it('does not corrupt a complete single-chunk line', async () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);

    const { handleSyscallEbpfAttach } =
      await import('@server/domains/syscall-hook/handlers/ebpf-attach');
    const promise = handleSyscallEbpfAttach({ pid: 42, durationSec: 1, syscalls: ['read'] });

    child.stdout.push(
      '{"type":"enter","elapsedMs":5,"pid":42,"tid":3,"syscall":"tracepoint:syscalls:sys_enter_read","args":""}\n',
    );
    child.stdout.push(null);
    child.stderr.push(null);

    await new Promise((resolve) => setTimeout(resolve, 20));
    child.emit('close', 0);

    const res = (await promise) as { success: boolean; mode: string; events?: unknown[] };
    expect(res.success).toBe(true);
    expect(res.events).toHaveLength(1);
  });
});
