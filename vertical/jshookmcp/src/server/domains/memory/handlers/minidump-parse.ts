/**
 * Minidump Parsing Handler — memory_parse_dump
 *
 * Parses Windows Minidump (.dmp) files and extracts forensic information:
 * loaded modules, threads, memory ranges, system info, and exception records.
 * Supports address resolution against dump contents.
 *
 * Pure TS — cross-platform (can analyze Windows dumps on Linux/macOS).
 */

import { argBool, argString, argStringArray } from '@server/domains/shared/parse-args';
import { parseMinidump, resolveAddressBatch } from '@native/MinidumpParser';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';

export class MinidumpHandlers {
  async handleMemoryParseDump(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      const filePath = argString(args, 'filePath', '')?.trim();
      if (!filePath || filePath.length === 0) {
        throw new Error('filePath is required (absolute or relative path to .dmp file)');
      }

      const includeModules = argBool(args, 'includeModules', true);
      const includeThreads = argBool(args, 'includeThreads', true);
      const includeMemory = argBool(args, 'includeMemoryRanges', true);
      const includeException = argBool(args, 'includeException', true);
      const includeSystemInfo = argBool(args, 'includeSystemInfo', true);

      // Optional: resolve a list of addresses against the dump
      const resolveAddrs = argStringArray(args, 'resolveAddresses');

      const summary = parseMinidump(filePath);

      if (!summary.success) {
        return { success: false, error: summary.error, filePath };
      }

      const result: Record<string, unknown> = {
        success: true,
        filePath: summary.filePath,
        fileSize: summary.fileSize,
        streamCount: summary.streamCount,
        streams: summary.streams.map((s) => ({ type: s.streamName, size: s.size })),
      };

      if (includeModules && summary.modules.length > 0) {
        result.modules = summary.modules;
        result.moduleCount = summary.modules.length;
      }

      if (includeThreads && summary.threads.length > 0) {
        result.threads = summary.threads;
        result.threadCount = summary.threads.length;
      }

      if (includeMemory && summary.memoryRanges.length > 0) {
        // Memory ranges can be massive; cap at 500 for LLM context
        const capped = summary.memoryRanges.slice(0, 500);
        result.memoryRanges = capped;
        result.memoryRangeCount = summary.memoryRanges.length;
        if (summary.memoryRanges.length > 500) {
          result.memoryRangeTruncated = true;
        }
        result.hasMemory64 = summary.hasMemory64;
      }

      if (includeException && summary.exception) {
        result.exception = summary.exception;
      }

      if (includeSystemInfo && summary.systemInfo) {
        result.systemInfo = summary.systemInfo;
      }

      // Address resolution
      if (resolveAddrs && resolveAddrs.length > 0) {
        const resolutions = resolveAddressBatch(summary, resolveAddrs);
        const found = resolutions.filter((r) => r.found);
        result.addressResolutions = resolutions;
        result.resolvedCount = found.length;
        result.totalQueried = resolutions.length;
      }

      return result;
    });
  }
}
