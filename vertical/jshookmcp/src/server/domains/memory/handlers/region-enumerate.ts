/**
 * Region enumeration handler — lists memory regions in a target process.
 *
 * Supports filtering by module name and protection flags.
 * Cross-platform via PlatformMemoryAPI: works on Windows, macOS, and Linux.
 */
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber, argString } from '@server/domains/shared/parse-args';
import { createPlatformProvider } from '@native/platform/factory';
import type {
  PlatformMemoryAPI,
  PlatformMemoryAPI as PlatformApi,
} from '@native/platform/PlatformMemoryAPI';
import type { ProcessHandle, MemoryRegionInfo } from '@native/platform/types';
import { MemoryProtection } from '@native/platform/types';
import { MEMORY_ENUM_REGIONS_RETURN_LIMIT, USERSPACE_MAX_ADDRESS } from '@src/constants';

const TOOL_NAME = 'memory_region_enumerate';
const PROTECTION_OPTIONS = new Set(['r', 'w', 'x', 'rw', 'rx', 'wx', 'rwx'] as const);

interface RegionEntry {
  base: string;
  size: number;
  protection: string;
  state: string;
  type: string;
  moduleName: string | null;
}

function protectionToString(prot: MemoryProtection): string {
  const r = (prot & MemoryProtection.Read) !== 0 ? 'r' : '';
  const w = (prot & MemoryProtection.Write) !== 0 ? 'w' : '';
  const x = (prot & MemoryProtection.Execute) !== 0 ? 'x' : '';
  return r + w + x || '---';
}

function protectionFromFilterString(filter: string): MemoryProtection {
  let prot = MemoryProtection.NoAccess;
  if (filter.includes('r')) prot |= MemoryProtection.Read;
  if (filter.includes('w')) prot |= MemoryProtection.Write;
  if (filter.includes('x')) prot |= MemoryProtection.Execute;
  return prot;
}

function buildModuleMap(
  api: PlatformApi,
  handle: ProcessHandle,
): {
  byName: Map<string, { baseAddress: bigint; size: number; displayName: string }>;
  byAddress: Map<string, string>;
} {
  const byName = new Map<string, { baseAddress: bigint; size: number; displayName: string }>();
  const byAddress = new Map<string, string>();
  try {
    const modules = api.enumerateModules(handle);
    for (const mod of modules) {
      const key = mod.name.toLowerCase();
      byName.set(key, { baseAddress: mod.baseAddress, size: mod.size, displayName: mod.name });
      byAddress.set(`0x${mod.baseAddress.toString(16)}`, mod.name);
    }
  } catch {
    // Module enumeration is best-effort
  }
  return { byName, byAddress };
}

/** Find which module (if any) a region address falls within. Returns the original display name. */
function findModuleName(
  addr: bigint,
  moduleMap: Map<string, { baseAddress: bigint; size: number; displayName: string }>,
): string | null {
  for (const [, info] of moduleMap) {
    if (addr >= info.baseAddress && addr < info.baseAddress + BigInt(info.size)) {
      return info.displayName;
    }
  }
  return null;
}

export class RegionHandlers {
  private getApi(): PlatformMemoryAPI | null {
    try {
      return createPlatformProvider();
    } catch {
      return null;
    }
  }

  async handleRegionEnumerate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      // Resolve PID (validates it's a positive integer)
      const pidValue = args.pid;
      const numericPid = Number(pidValue);
      if (!Number.isInteger(numericPid) || numericPid <= 0) {
        throw new Error(
          `Invalid PID: ${JSON.stringify(pidValue)} (expected a positive integer). Provide an explicit pid.`,
        );
      }
      const pid = numericPid;

      const moduleNameFilter = argString(args, 'moduleName');
      const protectionFilter = argEnum(args, 'protection', PROTECTION_OPTIONS);
      const maxRegions = argNumber(args, 'maxRegions', MEMORY_ENUM_REGIONS_RETURN_LIMIT);

      if (!Number.isFinite(maxRegions) || maxRegions <= 0) {
        throw new Error(
          `${TOOL_NAME}: argument "maxRegions" must be a positive number, got: ${JSON.stringify(args.maxRegions)}`,
        );
      }

      const api = this.getApi();
      if (!api) {
        throw new Error(
          `${TOOL_NAME}: no platform memory provider is available on ${process.platform}. ` +
            'This tool requires a native memory backend.',
        );
      }

      // Parse protection filter
      const requiredProt = protectionFilter ? protectionFromFilterString(protectionFilter) : null;

      const handle = api.openProcess(pid, false);
      try {
        // Build module map for moduleName resolution
        const moduleMap = buildModuleMap(api, handle);

        const regions: RegionEntry[] = [];
        const targetModules = moduleNameFilter
          ? new Map(
              [...moduleMap.byName].filter(([name]) =>
                name.includes(moduleNameFilter.toLowerCase()),
              ),
            )
          : moduleMap.byName;

        let address = 0n;
        let truncated = false;

        while (address < USERSPACE_MAX_ADDRESS && regions.length < maxRegions) {
          const regionInfo: MemoryRegionInfo | null = api.queryRegion(handle, address);
          if (!regionInfo) break;

          const regionSize = regionInfo.size;

          // Apply protection filter
          let include = true;
          if (requiredProt !== null) {
            include = (regionInfo.protection & requiredProt) === requiredProt;
            // Also ensure no extra bits are set beyond what the filter specifies
            const extraBits = regionInfo.protection & ~requiredProt;
            if (
              (extraBits &
                (MemoryProtection.Read | MemoryProtection.Write | MemoryProtection.Execute)) !==
              0
            ) {
              include = false;
            }
          }

          // Apply moduleName filter
          if (include && moduleNameFilter) {
            // Only include if region falls within a matching module
            let inModule = false;
            for (const [, info] of targetModules) {
              if (
                regionInfo.baseAddress >= info.baseAddress &&
                regionInfo.baseAddress < info.baseAddress + BigInt(info.size)
              ) {
                inModule = true;
                break;
              }
            }
            include = inModule;
          }

          if (include) {
            const moduleName = findModuleName(regionInfo.baseAddress, moduleMap.byName);

            regions.push({
              base: `0x${regionInfo.baseAddress.toString(16)}`,
              size: regionSize,
              protection: protectionToString(regionInfo.protection),
              state: regionInfo.state,
              type: regionInfo.type,
              moduleName,
            });
          }

          address = regionInfo.baseAddress + BigInt(regionInfo.size);
        }

        truncated = regions.length >= maxRegions;

        return {
          regions,
          totalRegions: regions.length,
          truncated,
          platform: api.platform,
          hint:
            regions.length === 0
              ? 'No regions matched the filter. Try broader criteria.'
              : truncated
                ? `Returned ${regions.length} regions (capped at ${maxRegions}). Narrow with moduleName or protection to see more specific results.`
                : `Found ${regions.length} regions. Use moduleName to filter by module.`,
        };
      } finally {
        api.closeProcess(handle);
      }
    });
  }
}
