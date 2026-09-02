/**
 * Memory Region Comparison Handler — memory_region_compare
 *
 * Compares two memory regions byte-by-byte and returns a diff summary.
 * Cross-platform. Max compare size: 64KB.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argNumber } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress, requirePositiveIntArg } from './validation';
import { createPlatformProvider } from '@native/platform/factory';
import type { PlatformMemoryAPI } from '@native/platform/PlatformMemoryAPI';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';

const TOOL_NAME = 'memory_region_compare';
const MAX_COMPARE_SIZE = 64 * 1024; // 64KB
const MAX_DIFFS = 256;

interface DiffEntry {
  offset: number;
  byte1: number;
  byte2: number;
}

export class RegionCompareHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  private getApi(): PlatformMemoryAPI | null {
    try {
      return createPlatformProvider();
    } catch {
      return null;
    }
  }

  async handleRegionCompare(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address1 = validateHexAddress(args.address1, 'address1');
      const address2 = validateHexAddress(args.address2, 'address2');
      const rawSize = argNumber(args, 'size');
      const size = rawSize !== undefined ? requirePositiveIntArg(rawSize, 'size', TOOL_NAME) : 256;

      if (size > MAX_COMPARE_SIZE) {
        throw new Error(
          `${TOOL_NAME}: size ${size} exceeds maximum ${MAX_COMPARE_SIZE} bytes (64KB). ` +
            'Compare smaller regions in multiple calls.',
        );
      }

      const addr1BigInt = BigInt(address1.startsWith('0x') ? address1 : `0x${address1}`);
      const addr2BigInt = BigInt(address2.startsWith('0x') ? address2 : `0x${address2}`);

      const api = this.getApi();
      if (!api) {
        throw new Error(
          `${TOOL_NAME}: no platform memory provider is available on ${process.platform}. ` +
            'This tool requires a native memory backend.',
        );
      }

      const handle = api.openProcess(pid, false);
      try {
        // Read both regions
        const result1 = await api.readMemory(handle, addr1BigInt, size);
        const result2 = await api.readMemory(handle, addr2BigInt, size);

        const buf1 = result1.data;
        const buf2 = result2.data;

        // Byte-by-byte comparison
        const diffs: DiffEntry[] = [];
        let diffCount = 0;
        const compareLen = Math.min(buf1.length, buf2.length);
        const sizeMismatch = buf1.length !== buf2.length;

        for (let i = 0; i < compareLen; i++) {
          if (buf1[i] !== buf2[i]) {
            diffCount++;
            if (diffs.length < MAX_DIFFS) {
              diffs.push({
                offset: i,
                byte1: buf1[i]!,
                byte2: buf2[i]!,
              });
            }
          }
        }

        // Handle size mismatch
        if (sizeMismatch) {
          const longer = buf1.length > buf2.length ? buf1 : buf2;
          const shorterLen = Math.min(buf1.length, buf2.length);
          for (let i = shorterLen; i < Math.min(longer.length, compareLen); i++) {
            diffCount++;
          }
        }

        const identical = diffCount === 0;
        const diffsTruncated = diffCount > MAX_DIFFS;

        return {
          identical,
          diffCount,
          diffsTruncated,
          bytesRead1: result1.bytesRead,
          bytesRead2: result2.bytesRead,
          sizeMismatch,
          size,
          diffs,
          hint: identical
            ? 'Regions are byte-identical.'
            : diffsTruncated
              ? `${diffCount} byte differences found (showing first ${MAX_DIFFS}).`
              : `${diffCount} byte differences found.`,
        };
      } finally {
        api.closeProcess(handle);
      }
    });
  }
}
