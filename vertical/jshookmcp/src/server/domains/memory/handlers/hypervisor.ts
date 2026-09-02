/**
 * EPT Hypervisor domain handlers — memory_hypervisor.
 *
 * Delegates to Hypervisor class for VT-x capability detection,
 * hypervisor lifecycle (load/unload), and status reporting.
 *
 * All operations are gated behind:
 *   - JSHOOK_HYPERVISOR_ENABLE=1 env var
 *   - Administrator privileges
 *   - Windows platform (VT-x is Intel-only + Win32 kernel driver)
 *   - BYOVD driver active (for MSR reads)
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argString } from '@server/domains/shared/parse-args';
import { HYPERVISOR_ENABLED } from '@src/constants/hypervisor';

const HYPERVISOR_ACTIONS: ReadonlySet<'capabilities' | 'load' | 'unload' | 'status'> = new Set([
  'capabilities',
  'load',
  'unload',
  'status',
]);

export class HypervisorHandlers {
  /** Handle memory_hypervisor tool: capabilities, load, unload, status. */
  async handleHypervisor(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      const action = argEnum(args, 'action', HYPERVISOR_ACTIONS);

      // Lazy-load Hypervisor (Win32 + koffi + BYOVD dependency)
      const { getHypervisor } = await import('@native/byovd');
      const hypervisor = getHypervisor();

      switch (action) {
        case 'capabilities': {
          const caps = await hypervisor.detectCapabilities();
          const vmcsConfig = hypervisor.getVmcsConfig();
          const exitTable = hypervisor.getExitHandlerTable();
          const vmxonReq = hypervisor.getVmxonRegionRequirements();
          return {
            enabled: HYPERVISOR_ENABLED,
            capabilities: caps,
            vmcsConfig,
            exitHandlerTable: exitTable,
            vmxonRegionRequirements: vmxonReq,
            note:
              caps.vtxSupported && !caps.hypervActive
                ? 'VT-x available. Kernel-mode component required for VMXON/VMLAUNCH execution.'
                : caps.hypervActive
                  ? 'Hyper-V detected — incompatible. Disable Hyper-V/WSL2/VBS first.'
                  : 'VT-x not supported on this system.',
          };
        }

        case 'load': {
          const detectFirst = argString(args, 'detectFirst');
          if (detectFirst !== 'false') {
            // Auto-detect before load
            await hypervisor.detectCapabilities();
          }
          const result = await hypervisor.load();
          if (!result.success) {
            return { success: false, error: result.error };
          }
          const status = hypervisor.getStatus();
          const vmcsConfig = hypervisor.getVmcsConfig();
          const exitHandlerTable = hypervisor.getExitHandlerTable();
          return {
            success: true,
            message:
              'Hypervisor Phase 1 loaded. VMCS configured. ' +
              'Kernel-mode component required for VMXON/VMLAUNCH.',
            status,
            vmcsConfig,
            exitHandlerTable,
          };
        }

        case 'unload': {
          const result = await hypervisor.unload();
          if (!result.success) {
            return { success: false, error: result.error };
          }
          return { success: true, message: 'Hypervisor unloaded' };
        }

        case 'status': {
          const status = hypervisor.getStatus();
          const caps = await hypervisor.detectCapabilities();
          const vmcsConfig = hypervisor.getVmcsConfig();
          return {
            status,
            capabilities: caps,
            vmcsConfig,
            hyperv: {
              active: caps.hypervActive,
              wsl2Active: caps.wsl2Active,
            },
          };
        }

        default:
          return { success: false, error: `Unknown action: ${String(action)}` };
      }
    });
  }
}
