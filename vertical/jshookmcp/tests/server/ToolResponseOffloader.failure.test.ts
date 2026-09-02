import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LargeDataOffloader } from '@server/ToolResponseOffloader';
import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { getOffloadDir } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';

/**
 * Regression tests: a disk-write or store failure while offloading must NOT
 * lose the original payload — the response keeps its original text and the
 * call succeeds (the previous behavior threw out of offload(), failing the
 * whole tool call and dropping data the tool had already produced).
 */

/** A project-relative path that resolves to a FILE, so writes under it fail ENOTDIR. */
const BLOCKER_REL = 'artifacts/offloaded/__offload_blocker__';
const BLOCKER_ABS = resolve(getProjectRoot(), BLOCKER_REL);

function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function createDetailManager(storeImpl: () => string): DetailedDataManager {
  return {
    store: vi.fn(storeImpl),
    cache: new Map(),
  } as unknown as DetailedDataManager;
}

describe('LargeDataOffloader — failure preserves original payload', () => {
  beforeAll(() => {
    mkdirSync(join(getProjectRoot(), 'artifacts', 'offloaded'), { recursive: true });
    writeFileSync(BLOCKER_ABS, 'i am a file, not a directory');
  });

  afterAll(() => {
    rmSync(BLOCKER_ABS, { force: true });
    rmSync(getOffloadDir(), { recursive: true, force: true });
  });

  it('keeps the original text when writing a data URI file fails', async () => {
    const offloader = new LargeDataOffloader(
      createDetailManager(() => 'detail_x'),
      {
        detailThreshold: 0,
        fileThreshold: 0,
        outputDir: BLOCKER_REL,
      },
    );
    const dataUri = 'data:image/png;base64,' + Buffer.from('AAA').toString('base64');

    const response = textResponse(dataUri);
    await expect(offloader.offload('some_tool', response)).resolves.toBe(response);

    // Original payload survives unchanged.
    expect((response.content[0] as { text: string }).text).toBe(dataUri);
  });

  it('keeps the original text when the detail manager store throws', async () => {
    const failing = createDetailManager(() => {
      throw new Error('disk full');
    });
    const offloader = new LargeDataOffloader(failing);
    const bigJson = JSON.stringify({ data: 'x'.repeat(600 * 1024) });

    const response = textResponse(bigJson);
    await expect(offloader.offload('some_tool', response)).resolves.toBe(response);

    expect((response.content[0] as { text: string }).text).toBe(bigJson);
    expect(failing.store).toHaveBeenCalled();
  });

  it('keeps the original text when writing a large raw string fails', async () => {
    const offloader = new LargeDataOffloader(
      createDetailManager(() => 'detail_x'),
      {
        detailThreshold: 0,
        fileThreshold: 10,
        outputDir: BLOCKER_REL,
      },
    );
    const raw = 'LARGE-RAW-' + 'z'.repeat(100);

    const response = textResponse(raw);
    await expect(offloader.offload('some_tool', response)).resolves.toBe(response);

    expect((response.content[0] as { text: string }).text).toBe(raw);
  });

  it('still offloads other entries when one entry fails', async () => {
    const ddm = createDetailManager(() => 'detail_ok');
    const offloader = new LargeDataOffloader(ddm, {
      detailThreshold: 10,
      fileThreshold: 10,
      outputDir: BLOCKER_REL,
    });
    const failingUri = 'data:image/png;base64,' + Buffer.from('BBB').toString('base64');
    const bigJson = JSON.stringify({ ok: true, data: 'y'.repeat(600 * 1024) });

    const response = {
      content: [
        { type: 'text' as const, text: failingUri },
        { type: 'text' as const, text: bigJson },
      ],
    };

    await offloader.offload('some_tool', response);

    // First entry: write failed → original preserved.
    expect((response.content[0] as { text: string }).text).toBe(failingUri);
    // Second entry: detail-manager offload still happened.
    expect(ddm.store).toHaveBeenCalled();
    expect((response.content[1] as { text: string }).text).toContain('_offload');
  });
});
