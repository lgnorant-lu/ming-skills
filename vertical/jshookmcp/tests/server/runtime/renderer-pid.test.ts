import { describe, expect, it, vi } from 'vitest';
import { buildTestUrl } from '@tests/shared/test-urls';

import {
  resolveAttachedRendererPid,
  resolvePidOrAttachedRenderer,
} from '@server/runtime/renderer-pid';
import { ServerRuntimeState } from '@server/runtime/ServerRuntimeState';

function createCtx(runtimeState?: ServerRuntimeState | null) {
  return {
    getDomainInstance: vi.fn((key: string) =>
      key === 'serverRuntimeState' ? (runtimeState ?? undefined) : undefined,
    ),
  } as any;
}

function createProcessManager(rendererProcesses: Array<Record<string, unknown>>) {
  return {
    findBrowserProcesses: vi.fn(async () => ({
      rendererProcesses,
    })),
  } as any;
}

describe('renderer-pid runtime helpers', () => {
  it('returns cached renderer pid without touching process discovery', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.setBrowserAttach({
      browserPid: 111,
      rendererPid: 222,
    });
    const processManager = createProcessManager([]);

    await expect(resolveAttachedRendererPid(processManager, createCtx(runtimeState))).resolves.toBe(
      222,
    );
    expect(processManager.findBrowserProcesses).not.toHaveBeenCalled();
  });

  it('resolves a matching renderer by selected url and stores it back into runtime state', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.setBrowserAttach({
      browserPid: 100,
      selectedUrl: buildTestUrl('target', { suffix: 'test', path: 'page' }),
      selectedTitle: 'Ignored Title',
    });
    const processManager = createProcessManager([
      {
        pid: 201,
        parentPid: 100,
        commandLine: `--type=renderer ${buildTestUrl('other', { suffix: 'test' })}`,
        windowTitle: 'Other Page',
      },
      {
        pid: 202,
        parentPid: 100,
        commandLine: `--type=renderer ${buildTestUrl('target', { suffix: 'test', path: 'page' })}`,
        windowTitle: 'Target Page',
      },
    ]);

    await expect(resolveAttachedRendererPid(processManager, createCtx(runtimeState))).resolves.toBe(
      202,
    );
    expect(runtimeState.getBrowserAttach().rendererPid).toBe(202);
  });

  it('falls back to title matching and then first candidate when needed', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.setBrowserAttach({
      browserPid: 300,
      selectedUrl: 'about:blank',
      selectedTitle: 'Chosen Tab',
    });
    const processManager = createProcessManager([
      {
        pid: 401,
        parentPid: 300,
        commandLine: '--type=renderer',
        windowTitle: 'Fallback First',
      },
      {
        pid: 402,
        parentPid: 300,
        commandLine: '--type=renderer',
        windowTitle: 'Chosen Tab',
      },
    ]);

    await expect(resolveAttachedRendererPid(processManager, createCtx(runtimeState))).resolves.toBe(
      402,
    );

    runtimeState.clearBrowserAttach();
    runtimeState.setBrowserAttach({
      browserPid: 300,
      selectedUrl: 'about:blank',
      selectedTitle: 'Missing Title',
    });

    await expect(resolveAttachedRendererPid(processManager, createCtx(runtimeState))).resolves.toBe(
      401,
    );
  });

  it('returns null when attach context or browser pid is unavailable', async () => {
    const processManager = createProcessManager([]);

    await expect(resolveAttachedRendererPid(processManager)).resolves.toBeNull();
    await expect(
      resolveAttachedRendererPid(processManager, createCtx(new ServerRuntimeState())),
    ).resolves.toBeNull();
  });

  it('validates explicit pid values before attempting auto-discovery', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.setBrowserAttach({
      browserPid: 500,
      rendererPid: 777,
    });
    const processManager = createProcessManager([]);

    await expect(
      resolvePidOrAttachedRenderer('123', processManager, createCtx(runtimeState)),
    ).resolves.toBe(123);
    await expect(
      resolvePidOrAttachedRenderer('bad-pid', processManager, createCtx(runtimeState)),
    ).rejects.toThrow('Invalid PID: "bad-pid"');
    await expect(
      resolvePidOrAttachedRenderer(undefined, processManager, createCtx(runtimeState)),
    ).resolves.toBe(777);
  });

  it('throws a guided error when auto-discovery cannot produce a renderer pid', async () => {
    const runtimeState = new ServerRuntimeState();
    runtimeState.setBrowserAttach({
      browserPid: 900,
      selectedUrl: buildTestUrl('missing', { suffix: 'test' }),
    });
    const processManager = createProcessManager([]);

    await expect(
      resolvePidOrAttachedRenderer(undefined, processManager, createCtx(runtimeState)),
    ).rejects.toThrow(
      'Invalid PID. Attach a browser first to auto-discover the current renderer PID, or provide pid explicitly.',
    );
  });
});
