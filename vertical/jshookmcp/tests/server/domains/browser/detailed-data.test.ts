import { parseJson } from '@tests/server/domains/shared/mock-factories';
import type { BrowserStatusResponse } from '@tests/shared/common-test-types';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, truncateSync } from 'node:fs';
import { join } from 'node:path';

import { DetailedDataHandlers } from '@server/domains/browser/handlers/detailed-data';
import { getOffloadDir } from '@utils/sanitizeForCache';
import { getProjectRoot } from '@utils/outputPaths';
import { MAX_OFFLOADED_READ_BYTES } from '@src/constants';

describe('DetailedDataHandlers', () => {
  const detailedDataManager = {
    retrieveAsync: vi.fn(),
  } as any;

  let handlers: DetailedDataHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DetailedDataHandlers({ detailedDataManager });
  });

  it('returns detailed data and defaults path to full', async () => {
    detailedDataManager.retrieveAsync.mockReturnValue({
      nested: { value: 42 },
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetDetailedData({ detailId: 'detail-1' }),
    );

    expect(detailedDataManager.retrieveAsync).toHaveBeenCalledWith('detail-1', undefined);
    expect(body).toEqual({
      success: true,
      detailId: 'detail-1',
      path: 'full',
      data: {
        nested: { value: 42 },
      },
    });
  });

  it('passes through the requested path', async () => {
    detailedDataManager.retrieveAsync.mockReturnValue(['line 1', 'line 2']);

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetDetailedData({
        detailId: 'detail-2',
        path: 'scripts[0].source',
      }),
    );

    expect(detailedDataManager.retrieveAsync).toHaveBeenCalledWith('detail-2', 'scripts[0].source');
    expect(body.path).toBe('scripts[0].source');
    expect(body.data).toEqual(['line 1', 'line 2']);
  });

  it('returns an error payload when retrieval fails', async () => {
    detailedDataManager.retrieveAsync.mockImplementation(() => {
      throw new Error('detail expired');
    });

    const body = parseJson<BrowserStatusResponse>(
      await handlers.handleGetDetailedData({ detailId: 'expired-detail' }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toBe('detail expired');
    expect(body.hint).toContain('TTL: 10 minutes');
  });

  describe('handleGetOffloadedData', () => {
    const offloadDir = getOffloadDir();
    const fixtureName = 'offload-test-fixture.bin';
    const fixtureAbs = join(offloadDir, fixtureName);
    const fixtureRel = fixtureAbs
      .replace(getProjectRoot(), '')
      .replace(/^[\\/]/, '')
      .replace(/\\/g, '/');

    afterAll(() => {
      rmSync(fixtureAbs, { force: true });
    });

    it('reads back an offloaded file as base64 by default', async () => {
      mkdirSync(offloadDir, { recursive: true });
      writeFileSync(fixtureAbs, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const body = parseJson<BrowserStatusResponse & { data: string; encoding: string }>(
        await handlers.handleGetOffloadedData({ path: fixtureRel }),
      );

      expect(body.success).toBe(true);
      expect(body.encoding).toBe('base64');
      expect(Buffer.from(body.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    it('reads back an offloaded file as utf8 text', async () => {
      mkdirSync(offloadDir, { recursive: true });
      const textName = 'offload-text-fixture.txt';
      const textAbs = join(offloadDir, textName);
      const textRel = textAbs
        .replace(getProjectRoot(), '')
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/');
      writeFileSync(textAbs, 'hello offloaded world');

      try {
        const body = parseJson<
          BrowserStatusResponse & { data: string; encoding: string; size: number }
        >(await handlers.handleGetOffloadedData({ path: textRel, encoding: 'utf8' }));

        expect(body.success).toBe(true);
        expect(body.encoding).toBe('utf8');
        expect(body.data).toBe('hello offloaded world');
        expect(body.size).toBe(Buffer.byteLength('hello offloaded world'));
      } finally {
        rmSync(textAbs, { force: true });
      }
    });

    it('rejects an offloaded file larger than MAX_OFFLOADED_READ_BYTES', async () => {
      mkdirSync(offloadDir, { recursive: true });
      const largeName = 'offload-large-fixture.bin';
      const largeAbs = join(offloadDir, largeName);
      const largeRel = largeAbs
        .replace(getProjectRoot(), '')
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/');

      // Sparse-extend to just past the cap: sets the logical size without
      // writing real bytes, so the guard is exercised without allocating ~64 MB.
      writeFileSync(largeAbs, '');
      truncateSync(largeAbs, MAX_OFFLOADED_READ_BYTES + 1);

      try {
        const body = parseJson<BrowserStatusResponse>(
          await handlers.handleGetOffloadedData({ path: largeRel }),
        );

        expect(body.success).toBe(false);
        expect(body.error).toContain('too large');
      } finally {
        rmSync(largeAbs, { force: true });
      }
    });

    it('rejects an empty path', async () => {
      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleGetOffloadedData({ path: '' }),
      );
      expect(body.success).toBe(false);
    });

    it('rejects a path outside artifacts/offloaded (traversal)', async () => {
      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleGetOffloadedData({ path: 'package.json' }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('offloaded');
    });

    it('rejects an absolute path', async () => {
      const body = parseJson<BrowserStatusResponse>(
        await handlers.handleGetOffloadedData({ path: 'C:/Windows/system32/drivers/etc/hosts' }),
      );
      expect(body.success).toBe(false);
    });
  });
});
