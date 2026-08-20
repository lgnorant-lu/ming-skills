/**
 * Native libraries list handler.
 */

import { listZipEntries } from '@modules/binary-instrument/apk-zip-inspection';
import { readRequiredString, jsonResponse } from './shared';

export class NativeLibsHandlers {
  async handleApkNativeLibsList(args: Record<string, unknown>): Promise<unknown> {
    const apkPath = readRequiredString(args, 'apkPath');
    const entriesResult = await listZipEntries(apkPath);
    if (!entriesResult.success) {
      return jsonResponse({
        available: false,
        apkPath,
        error: entriesResult.error,
      });
    }

    const libraries = entriesResult.entries
      .filter((entry) => /^lib\/.+\/[^/]+\.so$/i.test(entry))
      .map((entry) => {
        const parts = entry.split('/');
        return {
          path: entry,
          abi: parts[1] ?? '',
          name: parts[parts.length - 1] ?? '',
        };
      });

    return jsonResponse({
      available: true,
      apkPath,
      count: libraries.length,
      libraries,
    });
  }
}
