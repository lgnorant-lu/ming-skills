import type { DetailedDataManager } from '@utils/DetailedDataManager';
import { argString, argEnum } from '@server/domains/shared/parse-args';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import { getOffloadRoot } from '@utils/sanitizeForCache';
import { resolveRelativeProjectPath } from '@utils/outputPaths';
import { readFile, stat } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { MAX_OFFLOADED_READ_BYTES } from '@src/constants';

interface DetailedDataHandlersDeps {
  detailedDataManager: DetailedDataManager;
}

export class DetailedDataHandlers {
  private deps: DetailedDataHandlersDeps;
  constructor(deps: DetailedDataHandlersDeps) {
    this.deps = deps;
  }

  async handleGetDetailedData(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const detailId = argString(args, 'detailId', '');
      const path = argString(args, 'path');

      const data = await this.deps.detailedDataManager.retrieveAsync(detailId, path);

      return R.ok().build({
        detailId,
        path: path || 'full',
        data,
      });
    } catch (error) {
      return R.fail(error)
        .set('hint', 'DetailId may have expired (TTL: 10 minutes) or is invalid')
        .build();
    }
  }

  /**
   * Retrieve the original bytes of a field offloaded to disk by sanitizeForCache
   * (issue #62). The path must point inside artifacts/offloaded/ — any attempt to
   * read elsewhere is rejected.
   */
  async handleGetOffloadedData(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const requestedPath = argString(args, 'path', '');
      const encoding = argEnum(args, 'encoding', new Set(['base64', 'utf8'] as const), 'base64');

      if (!requestedPath) {
        return R.fail('path is required').build();
      }

      // Resolve within the project root (rejects absolute paths and traversal).
      const absolutePath = resolveRelativeProjectPath(requestedPath);

      // Containment: the file MUST live under artifacts/offloaded/.
      const offloadRoot = getOffloadRoot();
      const rel = relative(offloadRoot, absolutePath);
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return R.fail(
          `path must point inside the offloaded artifacts directory (artifacts/offloaded/)`,
        ).build();
      }

      // Size guard before reading: refuse to pull a multi-MB blob back into
      // memory (and ~33% larger as base64) in one shot. Offloaded files are
      // meant to be left on disk, not re-emitted whole into the context window.
      const fileStat = await stat(absolutePath);
      if (fileStat.size > MAX_OFFLOADED_READ_BYTES) {
        return R.fail(
          `offloaded file is too large to read back (${fileStat.size} bytes > ${MAX_OFFLOADED_READ_BYTES} byte limit). ` +
            `Raise the MAX_OFFLOADED_READ_BYTES env var to read it back, or process the file on disk directly.`,
        ).build();
      }

      const buffer = await readFile(absolutePath);

      return R.ok().build({
        path: requestedPath,
        encoding,
        size: buffer.length,
        data: buffer.toString(encoding),
      });
    } catch (error) {
      return R.fail(error)
        .set(
          'hint',
          'Offloaded file may have been cleaned up by artifact retention, or the path is invalid',
        )
        .build();
    }
  }
}
