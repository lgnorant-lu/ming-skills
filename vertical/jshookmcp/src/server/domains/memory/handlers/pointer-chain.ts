import type { PointerChainEngine } from '@native/PointerChainEngine';
import type { PointerChain } from '@native/PointerChainEngine.types';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool, argNumber, argStringArray } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { parseJsonArg, validateHexAddress } from './validation';

const TOOL_POINTER_CHAIN = 'memory_pointer_chain';

/** Bounds for pointer-chain scan parameters — documented in the tool definition. */
const PTR_CHAIN_MAX_DEPTH = 6;
const PTR_CHAIN_MAX_OFFSET = 65536;

/**
 * Minimal structural validation for a PointerChain object. Only the required
 * `id` field is checked — the native engine is the final arbiter of the full
 * shape (links/targetAddress/etc.), so this stays loose to avoid rejecting
 * legitimate partial serialisations while still catching non-objects.
 */
function isValidPointerChain(value: unknown): value is PointerChain {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string';
}

export class PointerChainHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly ptrEngine: PointerChainEngine,
    private readonly processManager?: UnifiedProcessManager,
    private readonly ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.auditTrail = auditTrail ?? null;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
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

  async handlePointerChainScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const targetAddress = validateHexAddress(args.targetAddress, 'targetAddress');
      const maxDepth = argNumber(args, 'maxDepth');
      if (maxDepth !== undefined && (maxDepth < 1 || maxDepth > PTR_CHAIN_MAX_DEPTH)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: maxDepth must be 1–${PTR_CHAIN_MAX_DEPTH}, got ${maxDepth}`,
        );
      }
      const maxOffset = argNumber(args, 'maxOffset');
      if (
        maxOffset !== undefined &&
        (!Number.isFinite(maxOffset) || maxOffset <= 0 || maxOffset > PTR_CHAIN_MAX_OFFSET)
      ) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: maxOffset must be a positive number ≤ ${PTR_CHAIN_MAX_OFFSET}, got ${maxOffset}`,
        );
      }
      const start = Date.now();
      const result = await this.ptrEngine.scan(pid, targetAddress, {
        maxDepth,
        maxOffset,
        staticOnly: argBool(args, 'staticOnly', false),
        modules: argStringArray(args, 'modules'),
        maxResults: argNumber(args, 'maxResults'),
      });
      this.recordAudit({
        operation: 'pointer_chain_scan',
        pid,
        address: targetAddress,
        size: result.totalFound ?? 0,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return {
        ...result,
        hint:
          result.totalFound > 0
            ? `Found ${result.totalFound} pointer chains. Static chains survive process restarts.`
            : 'No pointer chains found. Try increasing maxDepth or maxOffset.',
      };
    });
  }

  async handlePointerChainValidate(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const chains = parseJsonArg<PointerChain[]>(args.chains, 'chains', TOOL_POINTER_CHAIN);
      if (!Array.isArray(chains)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" must be a JSON array of PointerChain objects, got: ${JSON.stringify(args.chains)}`,
        );
      }
      if (!chains.every(isValidPointerChain)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" contains a malformed entry — each PointerChain must have a string "id" and an array "levels"`,
        );
      }
      const results = await this.ptrEngine.validateChains(pid, chains);
      return {
        results,
        validCount: results.filter((r) => r.isValid).length,
        totalChecked: chains.length,
      };
    });
  }

  async handlePointerChainResolve(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const chain = parseJsonArg<PointerChain>(args.chain, 'chain', TOOL_POINTER_CHAIN);
      if (!isValidPointerChain(chain)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chain" is malformed — a PointerChain must have a string "id" and an array "levels"`,
        );
      }
      const resolved = await this.ptrEngine.resolveChain(pid, chain);
      return {
        chainId: chain.id,
        resolvedAddress: resolved,
        isResolvable: resolved !== null,
      };
    });
  }

  async handlePointerChainExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const chains = parseJsonArg<PointerChain[]>(args.chains, 'chains', TOOL_POINTER_CHAIN);
      if (!Array.isArray(chains)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" must be a JSON array of PointerChain objects, got: ${JSON.stringify(args.chains)}`,
        );
      }
      if (!chains.every(isValidPointerChain)) {
        throw new Error(
          `${TOOL_POINTER_CHAIN}: argument "chains" contains a malformed entry — each PointerChain must have a string "id" and an array "levels"`,
        );
      }
      return {
        exportedData: this.ptrEngine.exportChains(chains),
        chainCount: chains.length,
      };
    });
  }
}
