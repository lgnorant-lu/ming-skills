/**
 * Shared APK file pre-flight validation — stat + regular-file check + size
 * cap. Used by both PackerDetector and SigningBlockParser so the two entry
 * points can't drift on error codes or messages.
 */

import { stat } from 'node:fs/promises';

import { ToolError } from '@errors/ToolError';

import { APK_PACKER_MAX_APK_BYTES } from './constants';

export interface ValidatedApkFile {
  /** Validated size in bytes (≤ APK_PACKER_MAX_APK_BYTES). */
  size: number;
}

/**
 * Validate that `apkPath` exists, is a regular file, and is within the
 * configured size cap. Throws `ToolError(NOT_FOUND|VALIDATION)` for unusable
 * input; returns the validated size on success.
 */
export async function validateApkFile(apkPath: string): Promise<ValidatedApkFile> {
  if (!apkPath || apkPath.length === 0) {
    throw new ToolError('VALIDATION', 'apkPath must be a non-empty string');
  }

  let stats;
  try {
    stats = await stat(apkPath);
  } catch (cause) {
    throw new ToolError('NOT_FOUND', `APK not found: ${apkPath}`, {
      details: { apkPath },
      cause: cause as Error,
    });
  }
  if (!stats.isFile()) {
    throw new ToolError('VALIDATION', `APK path is not a regular file: ${apkPath}`, {
      details: { apkPath },
    });
  }
  if (stats.size > APK_PACKER_MAX_APK_BYTES) {
    throw new ToolError(
      'VALIDATION',
      `APK exceeds APK_PACKER_MAX_APK_BYTES (${APK_PACKER_MAX_APK_BYTES} bytes): ${stats.size}`,
      { details: { apkPath, size: stats.size, max: APK_PACKER_MAX_APK_BYTES } },
    );
  }

  return { size: stats.size };
}
