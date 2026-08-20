import { beforeEach, describe, expect, it, vi } from 'vitest';

const yauzlState = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('yauzl', () => ({
  open: yauzlState.open,
}));

const statState = vi.hoisted(() => ({
  stat: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: statState.stat,
  readdir: vi.fn(async () => []),
}));

import { PackerDetector } from '@modules/apk-packer/PackerDetector';
import {
  BLOCK_ID_V2,
  BLOCK_ID_V3,
  BLOCK_ID_V3_1,
  BLOCK_ID_SOURCE_STAMP,
  BLOCK_ID_VERITY_PADDING,
} from '@modules/apk-packer/signing-block-types';

describe('apk-packer bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statState.stat.mockResolvedValue({ isFile: () => true, size: 1024 });
  });

  it('BLOCK_ID_VERITY_PADDING is distinct from other block IDs', () => {
    const ids = [BLOCK_ID_V2, BLOCK_ID_V3, BLOCK_ID_V3_1, BLOCK_ID_SOURCE_STAMP];
    expect(ids).not.toContain(BLOCK_ID_VERITY_PADDING);
    // AOSP value ("Brew")
    expect(BLOCK_ID_VERITY_PADDING).toBe(0x42726577);
  });

  it('rejects (does not hang) when yauzl open throws synchronously', async () => {
    yauzlState.open.mockImplementation(() => {
      throw new Error('sync open failure');
    });

    const detector = new PackerDetector();
    await expect(detector.detectFromApk('x.apk')).rejects.toThrow('Failed to open APK as ZIP');
  });
});
