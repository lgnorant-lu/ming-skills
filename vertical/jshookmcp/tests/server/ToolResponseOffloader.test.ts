import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { LargeDataOffloader } from '@server/ToolResponseOffloader';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { getOffloadDir } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';

function textResponse(obj: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }],
  };
}

function createDetailManager(): DetailedDataManager {
  return {
    store: vi.fn(() => 'detail_123'),
    cache: new Map([['detail_123', { size: 1024 * 1024 }]]),
  } as unknown as DetailedDataManager;
}

describe('LargeDataOffloader — issue #62 structural detection', () => {
  const offloadDir = getOffloadDir();

  afterAll(() => {
    // Best-effort cleanup of any files written by these tests.
    rmSync(offloadDir, { recursive: true, force: true });
  });

  it('sanitizes a data: URI nested in a get_detailed_data wrapper instead of skipping it', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    const dataUri = 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024);
    const response = textResponse({
      success: true,
      detailId: 'detail_abc',
      path: 'requests',
      data: [{ url: dataUri, method: 'GET', requestId: 'r1' }],
    });

    await offloader.offload('get_detailed_data', response);

    const text = (response.content[0] as { text: string }).text;
    // The wrapper is NOT skipped: the multi-MB blob is gone, replaced by a placeholder.
    expect(text).toContain('_offload');
    expect(text).not.toContain('A'.repeat(500));
    expect(text.length).toBeLessThan(5000);
    // Wrapper metadata survives.
    expect(text).toContain('detail_abc');
  });

  it('still skips a pure offload placeholder response (idempotent)', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    // A response that is already an offload placeholder padded over the threshold.
    const placeholder = {
      _offload: { type: 'file', path: 'artifacts/offloaded/x.bin', size: '2.0MB' },
      padding: 'p'.repeat(600 * 1024),
    };
    const response = textResponse(placeholder);
    const before = (response.content[0] as { text: string }).text;

    await offloader.offload('some_tool', response);

    const after = (response.content[0] as { text: string }).text;
    // Unchanged — the pure placeholder branch is left alone.
    expect(after).toBe(before);
  });

  it('leaves small responses untouched', async () => {
    const offloader = new LargeDataOffloader(createDetailManager());
    const response = textResponse({ success: true, detailId: 'd1', data: { ok: true } });
    const before = (response.content[0] as { text: string }).text;

    await offloader.offload('get_detailed_data', response);

    expect((response.content[0] as { text: string }).text).toBe(before);
  });

  it('actually writes a top-level data URI to disk and references it from the placeholder', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 0,
    });
    const payload = Buffer.from('PNG-DATA-HELLO-1234');
    const dataUri = `data:image/png;base64,${payload.toString('base64')}`;
    const response = { content: [{ type: 'text' as const, text: dataUri }] };

    await offloader.offload('some_tool', response);

    const placeholder = JSON.parse((response.content[0] as { text: string }).text);
    expect(placeholder._offload.type).toBe('file');
    expect(typeof placeholder._offload.path).toBe('string');
    expect(placeholder._offload.mimeType).toBe('image/png');

    const filePath = resolve(getProjectRoot(), placeholder._offload.path);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(payload);
  });

  it('stores large JSON payloads in the detail manager with a detailId reference', async () => {
    const ddm = createDetailManager();
    const offloader = new LargeDataOffloader(ddm);
    const bigObject = { data: 'x'.repeat(600 * 1024), ok: true };
    const response = textResponse(bigObject);

    await offloader.offload('some_tool', response);

    const placeholder = JSON.parse((response.content[0] as { text: string }).text);
    expect(placeholder._offload).toMatchObject({ type: 'detailId', detailId: 'detail_123' });
    expect(ddm.store).toHaveBeenCalledOnce();
  });

  it('writes large non-JSON strings to a .txt file referenced by the placeholder', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      detailThreshold: 0,
      fileThreshold: 10,
    });
    const raw = 'LARGE-RAW-STRING-' + 'z'.repeat(50);
    const plain = { content: [{ type: 'text' as const, text: raw }] };

    await offloader.offload('some_tool', plain);

    const placeholder = JSON.parse((plain.content[0] as { text: string }).text);
    expect(placeholder._offload.type).toBe('file');
    expect(placeholder._offload.path).toMatch(/\.txt$/);
    const filePath = resolve(getProjectRoot(), placeholder._offload.path);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it('offloads resource-type entries the same way as text entries', async () => {
    const ddm = createDetailManager();
    const offloader = new LargeDataOffloader(ddm);
    const response = {
      content: [
        { type: 'resource' as const, text: JSON.stringify({ big: 'y'.repeat(600 * 1024) }) },
      ],
    };

    await offloader.offload('some_tool', response);

    const placeholder = JSON.parse((response.content[0] as { text: string }).text);
    expect(placeholder._offload).toMatchObject({ type: 'detailId', detailId: 'detail_123' });
  });

  it('returns the response unchanged for error responses and excluded tools', async () => {
    const offloader = new LargeDataOffloader(createDetailManager(), {
      excludeTools: new Set(['excluded_tool']),
    });
    const errorResponse = {
      isError: true,
      content: [{ type: 'text' as const, text: 'x'.repeat(700 * 1024) }],
    };
    await offloader.offload('excluded_tool', errorResponse);
    expect((errorResponse.content[0] as { text: string }).text).toBe('x'.repeat(700 * 1024));

    const big = { content: [{ type: 'text' as const, text: 'y'.repeat(700 * 1024) }] };
    await offloader.offload('excluded_tool', big);
    expect((big.content[0] as { text: string }).text).toBe('y'.repeat(700 * 1024));
  });
});
