/**
 * Regression tests for RipgrepEngine termination paths.
 *
 * The timeout handler must mark the engine stopped BEFORE killing the
 * child, so trailing stdout `data` events arriving before the SIGKILL
 * takes effect are discarded instead of re-entering the buffer guard
 * after the promise already rejected.
 */
import { EventEmitter } from 'node:events';
import type { spawn } from 'node:child_process';
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

vi.mock('../../../src/modules/jadx-search/constants', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../src/modules/jadx-search/constants')>();
  return { ...mod, JADX_SEARCH_TIMEOUT_MS: 50, JADX_SEARCH_RG_MAX_BUFFER_BYTES: 1024 };
});

import { RipgrepEngine } from '../../../src/modules/jadx-search/ripgrep-engine';
import type { NormalizedSearchOptions } from '../../../src/modules/jadx-search/types';

const OPTS: NormalizedSearchOptions = {
  decompileDir: 'C:/decompile',
  query: 'aes',
  globs: ['**/*.java'],
  literal: false,
  caseInsensitive: false,
  contextLines: 0,
  maxMatchesPerFile: 50,
  maxResults: 500,
};

type MockChild = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
};

function makeChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.kill = vi.fn(() => true);
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  return child;
}

describe('RipgrepEngine — timeout termination', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with TIMEOUT and SIGKILLs the child when the timeout fires', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockReturnValue(child);

    const engine = new RipgrepEngine(spawnMock as unknown as typeof spawn, 'rg');
    const promise = engine.run(OPTS);
    const expectation = expect(promise).rejects.toMatchObject({
      name: 'ToolError',
      code: 'TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('discards trailing stdout data after the timeout fired (no second kill)', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockReturnValue(child);

    const engine = new RipgrepEngine(spawnMock as unknown as typeof spawn, 'rg');
    const promise = engine.run(OPTS);
    const expectation = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;

    // Oversized trailing chunk: without the stopped flag the buffer guard
    // would fire a second SIGKILL on an already-rejected promise.
    child.stdout.emit('data', 'x'.repeat(64 * 1024));
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('resolves normally when the child exits cleanly before the timeout', async () => {
    vi.useFakeTimers();
    const child = makeChild();
    spawnMock.mockReturnValue(child);

    const engine = new RipgrepEngine(spawnMock as unknown as typeof spawn, 'rg');
    const promise = engine.run(OPTS);
    child.stdout.emit('data', '{"type":"end","data":{"path":{"text":"C:/decompile/A.java"}}}\n');
    child.emit('close', 0, null);

    await expect(promise).resolves.toMatchObject({ matches: [], truncated: false });
    expect(child.kill).not.toHaveBeenCalled();
  });
});
