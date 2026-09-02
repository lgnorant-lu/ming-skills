import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureAdbLogcat, LogcatLineCollector } from '@server/domains/adb-bridge/logcat';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';

interface FakeChild {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  handlers: Record<string, (...args: unknown[]) => void>;
}

function mockSpawnChild(): FakeChild {
  const stdout = new EventEmitter() as FakeChild['stdout'];
  const stderr = new EventEmitter() as FakeChild['stderr'];
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const child: FakeChild = {
    stdout,
    stderr,
    kill: vi.fn(),
    on: vi.fn((ev: string, cb: (...args: unknown[]) => void) => {
      handlers[ev] = cb;
      return child;
    }),
    handlers,
  };
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(child);
  return child;
}

describe('LogcatLineCollector', () => {
  it('filters across chunk boundaries and keeps only the requested tail', () => {
    const collector = new LogcatLineCollector({
      pid: '1234',
      pattern: /loader/i,
      maxLines: 2,
    });

    collector.pushChunk('06-10 I/App( 1234 ): loader sta');
    collector.pushChunk('rted\n06-10 I/App( 9999 ): loader ignored\n');
    collector.pushChunk('06-10 I/App( 1234 ): other ignored\n06-10 I/App( 1234 ): loader done\n');

    expect(collector.finish()).toEqual([
      '06-10 I/App( 1234 ): loader started',
      '06-10 I/App( 1234 ): loader done',
    ]);
  });

  it('uses package matching only when pid is absent', () => {
    const collector = new LogcatLineCollector({
      packageName: 'com.example',
      maxLines: 10,
    });

    collector.pushChunk('line for com.example\nline for other\n');
    expect(collector.finish()).toEqual(['line for com.example']);
  });

  it('matches pid as a whitespace-delimited token, including line start', () => {
    const collector = new LogcatLineCollector({ pid: '1234', maxLines: 10 });

    collector.pushChunk('1234 I/Tag: line at line start\n5678 I/Tag: other\n12345 I/Tag: longer\n');
    expect(collector.finish()).toEqual(['1234 I/Tag: line at line start']);
  });
});

describe('captureAdbLogcat', () => {
  let child: FakeChild;

  beforeEach(() => {
    child = mockSpawnChild();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves with captured lines once close arrives', async () => {
    const promise = captureAdbLogcat({
      adb: 'adb',
      args: ['logcat'],
      timeoutMs: 10_000,
      maxLines: 100,
    });

    child.stdout.emit('data', '06-10 I/App: line one\n06-10 I/App: line two\n');
    child.handlers['close']?.(0, null);

    await expect(promise).resolves.toMatchObject({
      lines: ['06-10 I/App: line one', '06-10 I/App: line two'],
      exitCode: 0,
    });
  });

  it('settles with partial output when the timeout fires and close never arrives', async () => {
    vi.useFakeTimers();
    const promise = captureAdbLogcat({
      adb: 'adb',
      args: ['logcat'],
      timeoutMs: 5_000,
      maxLines: 100,
    });

    child.stdout.emit('data', '06-10 I/App: captured before timeout\n');
    await vi.advanceTimersByTimeAsync(5_000);

    expect(child.kill).toHaveBeenCalled();
    await expect(promise).resolves.toMatchObject({
      lines: ['06-10 I/App: captured before timeout'],
      exitCode: -1,
      signal: 'SIGKILL',
    });

    // A late close must not overwrite the timeout result.
    child.handlers['close']?.(0, null);
    await expect(promise).resolves.toMatchObject({ exitCode: -1 });
  });

  it('never splits a surrogate pair when truncating stderr at the byte cap', async () => {
    function hasUnpairedSurrogate(s: string): boolean {
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          if (i + 1 >= s.length) return true;
          const next = s.charCodeAt(i + 1);
          if (next < 0xdc00 || next > 0xdfff) return true;
          i++;
        } else if (c >= 0xdc00 && c <= 0xdfff) {
          return true;
        }
      }
      return false;
    }

    const promise = captureAdbLogcat({
      adb: 'adb',
      args: ['logcat'],
      timeoutMs: 10_000,
      maxLines: 100,
      maxStderrBytes: 2,
    });

    // "a😀b" — a 1-code-unit char, a surrogate pair, another char. With a
    // 2-char cap the slice ends right after the pair's high surrogate
    // unless it backs off.
    child.stderr.emit('data', 'a😀b');
    child.handlers['close']?.(0, null);

    const result = await promise;
    expect(hasUnpairedSurrogate(result.stderr)).toBe(false);
    expect(result.stderr.length).toBeLessThanOrEqual(2);
  });
});
