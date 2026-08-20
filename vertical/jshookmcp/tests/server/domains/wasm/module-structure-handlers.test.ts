import { describe, expect, it, vi } from 'vitest';

const readFileMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileMock(...(args as never[])),
}));

import { ExternalToolHandlers } from '@server/domains/wasm/handlers/external-tool-handlers';
import type { WasmSharedState } from '@server/domains/wasm/handlers/shared';
import { parseJson } from '@tests/server/domains/shared/mock-factories';

const WASM_HEADER = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

function leb128(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Buffer.from(out);
}

function makeSection(id: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([id]), leb128(body.length), body]);
}

/** A minimal but non-trivial module: 1 export + 1 memory. */
function minimalModule(): Buffer {
  const memBody = Buffer.concat([leb128(1), Buffer.from([0x00]), leb128(1)]); // 1 mem, min 1
  const exportName = Buffer.from('memory', 'utf8');
  const exportBody = Buffer.concat([
    leb128(1),
    leb128(exportName.length),
    exportName,
    Buffer.from([0x02]), // memory kind
    leb128(0),
  ]);
  return Buffer.concat([WASM_HEADER, makeSection(5, memBody), makeSection(7, exportBody)]);
}

function createHandlers(): ExternalToolHandlers {
  const state: WasmSharedState = {
    collector: {} as never,
    runner: { run: vi.fn(), probeAll: vi.fn() },
  } as unknown as WasmSharedState;
  return new ExternalToolHandlers(state);
}

describe('ExternalToolHandlers — wasm_inspect', () => {
  it('returns structured module surface for a valid wasm binary', async () => {
    readFileMock.mockResolvedValueOnce(minimalModule());
    const handlers = createHandlers();
    const body = parseJson<{
      success: boolean;
      byteSize: number;
      exportCount: number;
      exports: Array<{ name: string; kind: string; index: number }>;
      memories: Array<{ limits: { min: number; shared: boolean } }>;
      honestBoundary: string;
    }>(await handlers.handleWasmInspect({ inputPath: 'mod.wasm' }));

    expect(body.success).toBe(true);
    expect(body.byteSize).toBe(minimalModule().length);
    expect(body.exportCount).toBe(1);
    expect(body.exports[0]).toMatchObject({ name: 'memory', kind: 'memory', index: 0 });
    expect(body.memories[0]!.limits).toEqual({ min: 1, shared: false });
    expect(body.honestBoundary).toContain('Structure only');
  });

  it('fails cleanly when the file cannot be read', async () => {
    readFileMock.mockRejectedValueOnce(new Error('ENOENT: no such file'));
    const handlers = createHandlers();
    const body = parseJson<{ success: boolean; error: string }>(
      await handlers.handleWasmInspect({ inputPath: 'missing.wasm' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('Failed to read wasm file');
  });

  it('fails cleanly when the bytes are not a wasm binary', async () => {
    readFileMock.mockResolvedValueOnce(Buffer.from('not wasm'));
    const handlers = createHandlers();
    const body = parseJson<{ success: boolean; error: string }>(
      await handlers.handleWasmInspect({ inputPath: 'bad.bin' }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('magic header');
  });
});
