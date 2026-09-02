/**
 * BYOVD domain handlers — memory_byovd, memory_byovd_scan.
 *
 * Delegates to ByovdManager for driver lifecycle and kernel-memory
 * R/W operations.  All operations are gated behind:
 *   - JSHOOK_BYOVD_ENABLE=1 env var
 *   - Administrator privileges
 *   - Windows platform (BYOVD is Win32-only)
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argStringRequired } from '@server/domains/shared/parse-args';
import { BYOVD_ENABLED } from '@src/constants';

const BYOVD_ACTIONS: ReadonlySet<
  | 'list'
  | 'load'
  | 'unload'
  | 'status'
  | 'callbacks'
  | 'disable_callbacks'
  | 'restore_callbacks'
  | 'detect_stale'
> = new Set([
  'list',
  'load',
  'unload',
  'status',
  'callbacks',
  'disable_callbacks',
  'restore_callbacks',
  'detect_stale',
]);

/**
 * In-memory store for callback restore points so they survive
 * across MCP tool calls within the same server lifetime.
 */
const restorePointStore = new Map<string, import('@native/byovd').CallbackRestorePoint>();

export class ByovdHandlers {
  /** Handle memory_byovd tool: list, load, unload, status, callbacks, disable_callbacks, restore_callbacks, detect_stale. */
  async handleByovd(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      const action = argEnum(args, 'action', BYOVD_ACTIONS);

      // Lazy-load ByovdManager (Win32 + koffi dependency)
      const { byovdManager } = await import('@native/byovd');

      switch (action) {
        case 'list': {
          const drivers = byovdManager.listDrivers();
          return {
            total: drivers.length,
            drivers,
            enabled: BYOVD_ENABLED,
            active: byovdManager.isActive(),
          };
        }

        case 'load': {
          const driverName = argStringRequired(args, 'driverName');
          const result = await byovdManager.loadDriver(driverName);
          if (!result.success) {
            return { success: false, error: result.error };
          }
          const status = byovdManager.getStatus();
          return { success: true, message: `Driver "${driverName}" loaded`, status };
        }

        case 'unload': {
          if (args.driverName !== undefined) {
            // Only unload if the active driver matches
            if (!byovdManager.isActive()) {
              return { success: false, error: 'No driver is currently loaded' };
            }
            const activeName = byovdManager.getActiveDriver()?.driver.name;
            const reqName = argStringRequired(args, 'driverName');
            if (activeName !== reqName) {
              return {
                success: false,
                error: `Active driver is "${activeName}", not "${reqName}"`,
              };
            }
          }
          const result = await byovdManager.unloadDriver();
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, message: 'Driver unloaded' };
        }

        case 'status': {
          const status = byovdManager.getStatus();
          if (!status.active && !status.enabled) {
            return {
              ...status,
              hint: 'BYOVD is disabled. Set JSHOOK_BYOVD_ENABLE=1 and run as Administrator on Windows to enable.',
            };
          }
          return status;
        }

        // ── Kernel Callback Operations ──

        case 'callbacks': {
          if (!byovdManager.isActive()) {
            return {
              success: false,
              error:
                'No BYOVD driver is loaded. Load a physical-memory driver first (action=load).',
            };
          }

          // Lazy-import KernelCallbackManager (heavy, only when needed)
          const { KernelCallbackManager } = await import('@native/byovd');
          const mgr = await KernelCallbackManager.createForByovd(byovdManager);

          await mgr.resolveArrays();
          const entries = await mgr.enumerateCallbacks();

          const antiCheatEntries = entries.filter((e) => e.isAntiCheat);
          const protectedEntries = entries.filter((e) => e.isProtected);
          const resolvedArrays = mgr.getResolvedArrays();

          return {
            success: true,
            totalCallbacks: entries.length,
            antiCheatCallbacks: antiCheatEntries.length,
            protectedCallbacks: protectedEntries.length,
            resolvedArrays: resolvedArrays.length,
            arrayNames: resolvedArrays.map((a) => a.name),
            callbacks: entries.map((e) => ({
              arrayName: e.arrayName,
              index: e.index,
              driverDescription: e.driverDescription,
              isAntiCheat: e.isAntiCheat,
              isProtected: e.isProtected,
              callbackFunction: `0x${e.callbackFunction.toString(16)}`,
            })),
            warning:
              'Enumerating kernel callbacks is a read-only operation. ' +
              'DANGEROUS: disabling kernel callbacks can destabilize the system. ' +
              'Windows system callbacks are NEVER disabled — only anti-cheat driver callbacks are targeted.',
          };
        }

        case 'disable_callbacks': {
          if (!byovdManager.isActive()) {
            return {
              success: false,
              error:
                'No BYOVD driver is loaded. Load a physical-memory driver first (action=load).',
            };
          }

          const { KernelCallbackManager } = await import('@native/byovd');
          const mgr = await KernelCallbackManager.createForByovd(byovdManager);

          await mgr.resolveArrays();

          const onlyAntiCheat = args.onlyAntiCheat !== false; // default true
          const driverPattern =
            typeof args.driverPattern === 'string' ? args.driverPattern : undefined;

          const restorePoint = await mgr.disableCallbacks({
            onlyAntiCheat,
            driverPattern,
            maxCallbacks: typeof args.maxCallbacks === 'number' ? args.maxCallbacks : 128,
          });

          const restoreId = `byovd_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          restorePointStore.set(restoreId, restorePoint);

          return {
            success: true,
            restoreId,
            disabledCount: restorePoint.entries.length,
            disabledCallbacks: restorePoint.entries.map((e) => ({
              arrayName: e.entry.arrayName,
              index: e.entry.index,
              driverDescription: e.entry.driverDescription,
              originalFunction: `0x${e.originalValue.toString(16)}`,
            })),
            warning:
              'Callbacks are now disabled. Call restore_callbacks with the restoreId to re-enable them. ' +
              'A watchdog timer will auto-restore after 30 seconds if the server is still running. ' +
              'If the server crashes, callbacks will remain disabled until next reboot — use detect_stale to find them.',
          };
        }

        case 'restore_callbacks': {
          if (!byovdManager.isActive()) {
            return {
              success: false,
              error:
                'No BYOVD driver is loaded. Load a physical-memory driver first (action=load).',
            };
          }

          const restoreId = argStringRequired(args, 'restoreId');
          const restorePoint = restorePointStore.get(restoreId);
          if (!restorePoint) {
            return {
              success: false,
              error: `Restore point "${restoreId}" not found. It may have already been restored or expired.`,
            };
          }

          const { KernelCallbackManager } = await import('@native/byovd');
          const mgr = await KernelCallbackManager.createForByovd(byovdManager);

          await mgr.restoreCallbacks(restorePoint);
          restorePointStore.delete(restoreId);

          return {
            success: true,
            message: `Restored ${restorePoint.entries.length} callback(s)`,
            restoredCount: restorePoint.entries.length,
          };
        }

        case 'detect_stale': {
          if (!byovdManager.isActive()) {
            return {
              success: false,
              error:
                'No BYOVD driver is loaded. Load a physical-memory driver first (action=load).',
            };
          }

          const { KernelCallbackManager } = await import('@native/byovd');
          const mgr = await KernelCallbackManager.createForByovd(byovdManager);

          await mgr.resolveArrays();
          const staleEntries = await mgr.detectStaleDisables();

          return {
            success: true,
            staleCount: staleEntries.length,
            staleCallbacks: staleEntries.map((e) => ({
              arrayName: e.arrayName,
              index: e.index,
              driverDescription: e.driverDescription,
            })),
            warning:
              staleEntries.length > 0
                ? 'Found stale (zeroed) callback entries from a likely crashed previous session. ' +
                  'Original callback values are lost — reboot to restore kernel callback state.'
                : undefined,
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    });
  }

  /** Handle memory_byovd_scan tool: scan for loaded vulnerable drivers. */
  async handleByovdScan(_args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      if (!BYOVD_ENABLED) {
        return {
          success: false,
          error: 'BYOVD is disabled. Set JSHOOK_BYOVD_ENABLE=1.',
        };
      }

      // Lazy-load ByovdManager
      const { byovdDriverRegistry } = await import('@native/byovd');

      // On non-Windows, report zero findings (no kernel driver scanning)
      if (process.platform !== 'win32') {
        return {
          success: true,
          platform: process.platform,
          note: 'BYOVD driver scanning is only supported on Windows',
          found: 0,
          results: [],
        };
      }

      const results: Array<{
        name: string;
        version: string;
        serviceName: string;
        cve: string[];
        status: string;
        loaded: boolean;
        note?: string;
      }> = [];

      // Cross-reference known driver services against the registry
      // We try to open each known driver device to check if it's loaded
      for (const driver of byovdDriverRegistry) {
        const loaded = await this.checkDriverLoaded(driver.devicePath);
        results.push({
          name: driver.name,
          version: driver.version,
          serviceName: driver.serviceName,
          cve: [...driver.cve],
          status: driver.status,
          loaded,
          note: loaded
            ? 'Driver is currently loaded and accessible'
            : 'Driver is not currently loaded',
        });
      }

      const foundCount = results.filter((r) => r.loaded).length;

      return {
        success: true,
        platform: process.platform,
        totalChecked: results.length,
        found: foundCount,
        results,
        warning:
          'This scan only checks known vulnerable drivers from the registry. ' +
          'It does NOT enumerate all kernel drivers on the system.',
      };
    });
  }

  /**
   * Check if a driver device is accessible by trying to open it.
   * Returns true if CreateFile succeeds (driver is loaded).
   */
  private async checkDriverLoaded(devicePath: string): Promise<boolean> {
    try {
      // Dynamic FFI import — only try on Windows. Intentional exception to
      // koffi-loader's single-load-point rule: this probes the driver device on
      // demand (try/catch-guarded) and hits the ESM module cache, so the
      // binding is not re-executed.
      const koffi = await import('koffi');
      const kernel32 = koffi.default.load('kernel32.dll');
      const createFileFn = kernel32.func(
        'void * CreateFileW(str, uint32, uint32, void *, uint32, uint32, void *)',
      );
      const closeHandleFn = kernel32.func('int CloseHandle(void *)');

      const GENERIC_READ = 0x80000000;
      const OPEN_EXISTING = 3;
      const FILE_ATTRIBUTE_NORMAL = 0x80;

      const handle = createFileFn(
        devicePath,
        GENERIC_READ,
        0,
        null,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        null,
      ) as bigint | number;

      const isValid = handle !== 0n && handle !== BigInt(-1) && handle !== 0;

      if (isValid) {
        closeHandleFn(handle);
      }

      kernel32.unload();
      return isValid;
    } catch {
      return false;
    }
  }
}
