/**
 * Tests for the `wasm_dump` `autoInject` path.
 *
 * autoInject installs a bytes-capturing hook (the stock webassembly-full preset
 * records events only, not raw bytes), reloads the page so the hook re-runs
 * against page WASM, then re-reads. These cover: the happy retry, the opt-out
 * (no inject/reload), and the still-empty-after-reload case.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCodeCollectorMock,
  createPageMock,
  parseJson,
} from '@tests/server/domains/shared/mock-factories';

const writeFileMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  writeFile: (...args: unknown[]) => writeFileMock(...(args as never[])),
  stat: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock('@src/utils/artifacts', () => ({ resolveArtifactPath: vi.fn() }));
vi.mock('@src/modules/external/ToolRegistry', () => ({ ToolRegistry: vi.fn() }));
vi.mock('@src/modules/external/ExternalToolRunner', () => ({
  ExternalToolRunner: class {
    run = vi.fn();
    probeAll = vi.fn();
  },
}));

import { WasmToolHandlers } from '@server/domains/wasm/handlers';

describe('wasm_dump autoInject', () => {
  const page = createPageMock();
  // createPageMock exposes evaluateOnNewDocument but not reload; add it.
  const reloadMock = vi.fn(async () => undefined);
  (page as unknown as { reload: typeof reloadMock }).reload = reloadMock;
  const collector = createCodeCollectorMock({
    getActivePage: vi.fn(async () => page),
  });

  let handlers: WasmToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    page.evaluate.mockReset();
    // @ts-expect-error — WasmToolHandlers ctor accepts the collector mock
    handlers = new WasmToolHandlers(collector);
  });

  it('injects the capture hook, reloads, and retries when autoInject is set and no WASM is present', async () => {
    page.evaluate
      .mockResolvedValueOnce({ error: 'No WASM modules captured.' }) // 1st readEvents
      .mockResolvedValueOnce({
        // re-read after reload
        exports: ['fn1'],
        importMods: ['env'],
        size: 4,
        moduleCount: 1,
      })
      .mockResolvedValueOnce([0x00, 0x61, 0x73, 0x6d]); // raw bytes read

    const body = parseJson<{ success: boolean; hash?: string }>(
      await handlers.handleWasmDump({
        moduleIndex: 0,
        autoInject: true,
        outputPath: path.join(os.tmpdir(), 'auto-inject.wasm'),
      }),
    );

    expect(body.success).toBe(true);
    expect(body.hash).toBeDefined();
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
    expect(reloadMock).toHaveBeenCalledOnce();
    expect(writeFileMock).toHaveBeenCalledOnce();
  });

  it('does not inject or reload when autoInject is false (preserves the original error)', async () => {
    page.evaluate.mockResolvedValueOnce({ error: 'No WASM modules captured.' });

    const body = parseJson<{ success: boolean; error?: string }>(
      await handlers.handleWasmDump({ moduleIndex: 0 }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(page.evaluateOnNewDocument).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('returns the error when the post-reload re-read still finds no WASM', async () => {
    page.evaluate
      .mockResolvedValueOnce({ error: 'No WASM modules captured.' }) // 1st readEvents
      .mockResolvedValueOnce({ error: 'No WASM modules captured.' }); // re-read still empty

    const body = parseJson<{ success: boolean; error?: string }>(
      await handlers.handleWasmDump({ moduleIndex: 0, autoInject: true }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
    expect(reloadMock).toHaveBeenCalledOnce();
  });
});
