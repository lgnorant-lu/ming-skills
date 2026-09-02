/**
 * validateApkFile error-code mapping tests.
 *
 * Guards the errno→ToolErrorCode classification: ENOENT is NOT_FOUND,
 * EACCES/EPERM is PERMISSION, and anything else is VALIDATION — a
 * permission error must never be reported as "APK not found".
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const statMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', () => ({
  stat: statMock,
}));

import { validateApkFile } from '@modules/apk-packer/validate-apk';

const errno = (code: string): NodeJS.ErrnoException => {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
};

beforeEach(() => {
  statMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateApkFile — stat error classification', () => {
  it('maps ENOENT to NOT_FOUND', async () => {
    statMock.mockRejectedValue(errno('ENOENT'));
    await expect(validateApkFile('/missing.apk')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'NOT_FOUND',
    });
  });

  it('maps EACCES to PERMISSION, not NOT_FOUND', async () => {
    statMock.mockRejectedValue(errno('EACCES'));
    await expect(validateApkFile('/locked.apk')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'PERMISSION',
    });
  });

  it('maps EPERM to PERMISSION', async () => {
    statMock.mockRejectedValue(errno('EPERM'));
    await expect(validateApkFile('/locked.apk')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'PERMISSION',
    });
  });

  it('maps other stat failures (EIO) to VALIDATION', async () => {
    statMock.mockRejectedValue(errno('EIO'));
    await expect(validateApkFile('/weird.apk')).rejects.toMatchObject({
      name: 'ToolError',
      code: 'VALIDATION',
    });
  });
});
