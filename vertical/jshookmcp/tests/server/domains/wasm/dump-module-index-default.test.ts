/**
 * Regression test: `wasm_dump` without `moduleIndex` must default to 0
 * (handler-side fallback) instead of passing `undefined` into the page
 * evaluate — an undefined index would be compared against array lengths,
 * silently matching nothing and reporting "out of range".
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
  realpath: vi.fn((p) => Promise.resolve(p)),
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

describe('wasm_dump — moduleIndex defaults to 0', () => {
  const page = createPageMock();
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

  it('reads module 0 when moduleIndex is omitted', async () => {
    page.evaluate
      .mockResolvedValueOnce({
        exports: ['fn1'],
        importMods: ['env'],
        size: 4,
        moduleCount: 1,
      })
      .mockResolvedValueOnce([0x00, 0x61, 0x73, 0x6d]);

    const body = parseJson<{ success: boolean }>(
      await handlers.handleWasmDump({
        outputPath: path.join(os.tmpdir(), 'default-index.wasm'),
      }),
    );

    expect(body.success).toBe(true);
    // The page evaluate must receive a numeric 0, never undefined.
    const evaluateArg = page.evaluate.mock.calls[0]?.[1];
    expect(evaluateArg).toBe(0);
  });

  it('reports out-of-range for an explicit large index', async () => {
    page.evaluate.mockResolvedValueOnce({
      error: 'Module index 5 out of range. Found 1 instantiated modules.',
    });

    const body = parseJson<{ success: boolean; error?: string }>(
      await handlers.handleWasmDump({ moduleIndex: 5 }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/out of range/);
  });
});
