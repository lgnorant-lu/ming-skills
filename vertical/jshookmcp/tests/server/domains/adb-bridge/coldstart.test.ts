import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers.impl';
import { probeCommand } from '@modules/external/ToolProbe';
import { execFile, spawn } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: vi.fn(),
}));

function parseResult(result: unknown) {
  const content = (result as { content: Array<{ text: string }> }).content;
  return JSON.parse(content[0]?.text ?? '{}');
}

/** Queue execFile responses; am start is the 3rd call (after force-stop and logcat -c). */
function mockExecFile(responses: Array<{ stdout?: string; stderr?: string; code?: number }>) {
  let callIndex = 0;
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: string, errOut: string) => void,
    ) => {
      const resp = responses[callIndex++] ?? { stdout: '' };
      const err =
        resp.code && resp.code !== 0 ? Object.assign(new Error('exit'), { code: resp.code }) : null;
      cb(err, resp.stdout ?? '', resp.stderr ?? '');
    },
  );
}

function mockSpawnChild() {
  const stdout = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  const stderr = new EventEmitter() as EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const child = {
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

describe('handleAppColdStartTrace launch failure detection', () => {
  let handlers: ADBBridgeHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ADBBridgeHandlers();
    (probeCommand as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      available: true,
      path: 'adb',
    });
  });

  it('reports success=false when am start exits 0 but stdout says the activity failed', async () => {
    // force-stop, logcat -c, am start -W (exit 0 with Error text)
    mockExecFile([
      { stdout: '' },
      { stdout: '' },
      { stdout: 'Error: Activity class {com.example/.Main} does not exist.\n', code: 0 },
    ]);
    const child = mockSpawnChild();

    const promise = handlers.handleAppColdStartTrace({
      serial: 'emulator-5554',
      packageName: 'com.example',
      activity: '.Main',
      waitMs: 0,
    });

    // Let the awaited execFile chain reach the spawn'd logcat capture first.
    await new Promise((resolve) => setTimeout(resolve, 25));
    // The logcat capture delivers no lines then closes cleanly.
    child.handlers['close']?.(0, null);

    const parsed = parseResult(await promise);
    expect(parsed.success).toBe(false);
  });

  it('reports success=true for a healthy am start output', async () => {
    mockExecFile([
      { stdout: '' },
      { stdout: '' },
      { stdout: 'Status: ok\nLaunchState: COLD\nTotalTime: 812\n', code: 0 },
    ]);
    const child = mockSpawnChild();

    const promise = handlers.handleAppColdStartTrace({
      serial: 'emulator-5554',
      packageName: 'com.example',
      activity: '.Main',
      waitMs: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    child.handlers['close']?.(0, null);

    const parsed = parseResult(await promise);
    expect(parsed.success).toBe(true);
    expect(parsed.launch).toMatchObject({ totalTime: 812 });
  });
});
