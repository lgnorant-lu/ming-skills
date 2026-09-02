/**
 * Memory Protection Handler — memory_protect
 *
 * Changes page protection for a memory region in a target process.
 * Cross-platform: VirtualProtectEx (Win32) / mprotect (Linux) / mach_vm_protect (macOS).
 * Destructive — audit trail records old protection.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { validateHexAddress, requirePositiveNumberArg } from './validation';
import { createPlatformProvider } from '@native/platform/factory';
import { MemoryProtection } from '@native/platform/types';
import type { PlatformMemoryAPI } from '@native/platform/PlatformMemoryAPI';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { logger } from '@utils/logger';

const TOOL_NAME = 'memory_protect';
const PROTECTION_MAP: Record<string, MemoryProtection> = {
  r: MemoryProtection.Read,
  rw: MemoryProtection.ReadWrite,
  rx: MemoryProtection.ReadExecute,
  rwx: MemoryProtection.ReadWriteExecute,
  none: MemoryProtection.NoAccess,
} as const;
const PROTECTION_OPTIONS = new Set(Object.keys(PROTECTION_MAP));

function protectionToString(prot: MemoryProtection): string {
  const r = (prot & MemoryProtection.Read) !== 0 ? 'r' : '';
  const w = (prot & MemoryProtection.Write) !== 0 ? 'w' : '';
  const x = (prot & MemoryProtection.Execute) !== 0 ? 'x' : '';
  return r + w + x || 'none';
}

export class ProtectHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  private readonly auditTrail?: MemoryAuditTrail | null;
  constructor(
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.processManager = processManager;
    this.ctx = ctx;
    this.auditTrail = auditTrail;
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

  private recordAudit(entry: {
    operation: string;
    pid: number | null;
    address: string | null;
    size: number | null;
    result: 'success' | 'failure';
    error?: string;
    durationMs: number;
  }): void {
    if (!this.auditTrail) return;
    try {
      this.auditTrail.record(entry);
    } catch (auditError) {
      logger.warn('Memory audit trail recording failed:', auditError);
    }
  }

  async handleProtect(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const size = requirePositiveNumberArg(args.size, 'size', TOOL_NAME);
      const protection = argEnum(args, 'protection', PROTECTION_OPTIONS);
      if (!protection) {
        throw new Error(
          `${TOOL_NAME}: missing or invalid required argument "protection" (expected one of: ${[...PROTECTION_OPTIONS].join(', ')}), got: ${JSON.stringify(args.protection)}`,
        );
      }

      // Parse address
      const addrBigInt = BigInt(address.startsWith('0x') ? address : `0x${address}`);

      const api = this.getApi();
      if (!api) {
        throw new Error(
          `${TOOL_NAME}: no platform memory provider is available on ${process.platform}. ` +
            'This tool requires a native memory backend.',
        );
      }

      const newProt = PROTECTION_MAP[protection]!;
      const handle = api.openProcess(pid, true);
      const start = Date.now();

      try {
        const result = api.changeProtection(handle, addrBigInt, size, newProt);

        this.recordAudit({
          operation: 'memory_protect',
          pid,
          address,
          size,
          result: 'success',
          durationMs: Date.now() - start,
        });

        return {
          success: true,
          pid,
          address,
          size,
          oldProtection: protectionToString(result.oldProtection),
          newProtection: protection,
          platform: api.platform,
          hint: 'Memory protection changed. Some anti-cheat systems monitor page protection changes.',
        };
      } catch (err) {
        this.recordAudit({
          operation: 'memory_protect',
          pid,
          address,
          size,
          result: 'failure',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
        throw err;
      } finally {
        api.closeProcess(handle);
      }
    });
  }
}
