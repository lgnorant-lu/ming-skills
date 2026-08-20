import type { MemoryController } from '@native/MemoryController';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { MEMORY_MAX_READ_BYTES } from '@src/constants';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argNumber } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { requireStringArg, validateHexAddress, validateValueForType } from './validation';

const TOOL_WRITE_VALUE = 'memory_write_value';
const TOOL_FREEZE = 'memory_freeze';
const TOOL_UNFREEZE = 'memory_freeze';
const TOOL_DUMP = 'memory_dump';

/** Minimum freeze write interval — faster than this destabilises the target. */
const FREEZE_MIN_INTERVAL_MS = 10;
/** Maximum concurrent freezes per process — each runs a setInterval timer. */
const FREEZE_MAX_CONCURRENT = 64;

const SCAN_VALUE_TYPES = new Set<string>([
  'byte',
  'int8',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float',
  'double',
  'string',
  'hex',
  'pointer',
]);

export class ReadWriteHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly memCtrl: MemoryController,
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

  async handleWriteValue(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const value = requireStringArg(args.value, 'value', TOOL_WRITE_VALUE);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_WRITE_VALUE}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      // Reject gross value/type mismatches (e.g. "hello" + int32) at the handler
      // layer so a clear error is returned instead of a native write failure.
      validateValueForType(value, valueType, TOOL_WRITE_VALUE);
      const start = Date.now();
      try {
        const entry = await this.memCtrl.writeValue(pid, address, value, valueType);
        this.recordAudit({
          operation: 'write_value',
          pid,
          address,
          size: Array.isArray(entry?.newValue) ? entry.newValue.length : null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          ...entry,
          hint: "Use memory_write_history with action='undo' to revert.",
        };
      } catch (e) {
        this.recordAudit({
          operation: 'write_value',
          pid,
          address,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleFreeze(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const value = requireStringArg(args.value, 'value', TOOL_FREEZE);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_FREEZE}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      const intervalMs = argNumber(args, 'intervalMs');
      if (intervalMs !== undefined && intervalMs < FREEZE_MIN_INTERVAL_MS) {
        throw new Error(
          `${TOOL_FREEZE}: intervalMs ${intervalMs} is below minimum ${FREEZE_MIN_INTERVAL_MS}ms — faster writes destabilise the target process.`,
        );
      }
      // Cap concurrent freezes — each spawns a setInterval timer, and unbounded
      // growth leaks resources and degrades target responsiveness.
      const activeFreezes = this.memCtrl.listFreezes();
      if (activeFreezes.length >= FREEZE_MAX_CONCURRENT) {
        throw new Error(
          `${TOOL_FREEZE}: ${FREEZE_MAX_CONCURRENT} concurrent freezes already active — unfreeze one (memory_freeze action=unfreeze) before adding more.`,
        );
      }
      const start = Date.now();
      try {
        const entry = await this.memCtrl.freeze(pid, address, value, valueType, intervalMs);
        this.recordAudit({
          operation: 'freeze',
          pid,
          address,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return {
          ...entry,
          hint: `Frozen. Use memory_freeze with action="unfreeze" and freezeId "${entry.id}" to stop.`,
        };
      } catch (e) {
        this.recordAudit({
          operation: 'freeze',
          pid,
          address,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleUnfreeze(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const freezeId = requireStringArg(args.freezeId, 'freezeId', TOOL_UNFREEZE);
      const start = Date.now();
      try {
        const unfrozen = await this.memCtrl.unfreeze(freezeId);
        this.recordAudit({
          operation: 'unfreeze',
          pid: null,
          address: null,
          size: null,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return { unfrozen };
      } catch (e) {
        this.recordAudit({
          operation: 'unfreeze',
          pid: null,
          address: null,
          size: null,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleDump(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const size = argNumber(args, 'size', 256);
      if (!Number.isFinite(size) || size <= 0) {
        throw new Error(
          `${TOOL_DUMP}: argument "size" must be a positive number, got: ${JSON.stringify(args.size)}`,
        );
      }
      if (size > MEMORY_MAX_READ_BYTES) {
        throw new Error(
          `${TOOL_DUMP}: size ${size} exceeds maximum ${MEMORY_MAX_READ_BYTES} bytes (${(MEMORY_MAX_READ_BYTES / 1024 / 1024).toFixed(0)}MB). Read smaller regions in multiple calls.`,
        );
      }
      const start = Date.now();
      try {
        const hexDump = await this.memCtrl.dumpMemoryHex(pid, address, size);
        this.recordAudit({
          operation: 'dump',
          pid,
          address,
          size,
          result: 'success',
          durationMs: Date.now() - start,
        });
        return { dump: hexDump };
      } catch (e) {
        this.recordAudit({
          operation: 'dump',
          pid,
          address,
          size,
          result: 'failure',
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - start,
        });
        throw e;
      }
    });
  }

  async handleWriteUndo(args: Record<string, unknown>) {
    return handleSafe(async () => {
      // Per-PID undo when pid is supplied; otherwise global (legacy behaviour).
      const pid = args.pid !== undefined ? await this.resolvePid(args.pid) : undefined;
      const entry = await this.memCtrl.undo(pid);
      this.recordAudit({
        operation: 'write_undo',
        pid: entry?.pid ?? null,
        address: entry?.address ?? null,
        size: Array.isArray(entry?.newValue) ? entry!.newValue.length : null,
        result: 'success',
        durationMs: 0,
      });
      return { undone: entry !== null, entry };
    });
  }

  async handleWriteRedo(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = args.pid !== undefined ? await this.resolvePid(args.pid) : undefined;
      const entry = await this.memCtrl.redo(pid);
      this.recordAudit({
        operation: 'write_redo',
        pid: entry?.pid ?? null,
        address: entry?.address ?? null,
        size: Array.isArray(entry?.newValue) ? entry!.newValue.length : null,
        result: 'success',
        durationMs: 0,
      });
      return { redone: entry !== null, entry };
    });
  }
}
