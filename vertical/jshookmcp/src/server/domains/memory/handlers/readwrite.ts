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
const TOOL_BATCH_EDIT = 'memory_batch_edit';
const TOOL_WATCH = 'memory_watch';

/** Minimum freeze write interval — faster than this destabilises the target. */
const FREEZE_MIN_INTERVAL_MS = 10;
/** Maximum concurrent freezes per process — each runs a setInterval timer. */
const FREEZE_MAX_CONCURRENT = 64;
/** Maximum addresses per batch_edit call — prevents accidental mass writes. */
const BATCH_EDIT_MAX_ADDRESSES = 1000;
/** Minimum poll interval for memory_watch — faster polls destabilise the target. */
const WATCH_MIN_INTERVAL_MS = 100;
/** Maximum watch timeout — prevents unbounded polling. */
const WATCH_MAX_TIMEOUT_MS = 120_000;

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

/** Return the byte size for a numeric value type, or undefined for variable-length types. */
function getByteSizeForValueType(valueType: string): number | undefined {
  switch (valueType) {
    case 'byte':
    case 'int8':
      return 1;
    case 'int16':
    case 'uint16':
      return 2;
    case 'int32':
    case 'uint32':
    case 'float':
      return 4;
    case 'int64':
    case 'uint64':
    case 'double':
    case 'pointer':
      return 8;
    default:
      return undefined; // string, hex — caller must supply explicit size
  }
}

/** Promise-based sleep (no setInterval leak). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Read/write still via MemoryController (win32 sync readBuffer/writeBuffer) —
// not yet migrated to createPlatformProvider(); see a4-01/b3-09 (commit c047a09b).
export class ReadWriteHandlers {
  private readonly memCtrl: MemoryController;
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    memCtrl: MemoryController,
    processManager?: UnifiedProcessManager,
    ctx?: MCPServerContext,
    auditTrail?: MemoryAuditTrail | null,
  ) {
    this.memCtrl = memCtrl;
    this.processManager = processManager;
    this.ctx = ctx;
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

  // ── Batch Edit ──

  async handleBatchEdit(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_BATCH_EDIT);
      const value = requireStringArg(args.value, 'value', TOOL_BATCH_EDIT);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_BATCH_EDIT}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      validateValueForType(value, valueType, TOOL_BATCH_EDIT);

      // Resolve the scan session to get the address list
      const { scanSessionManager } = await import('@native/MemoryScanSession');
      const session = scanSessionManager.getSession(sessionId);

      if (session.addresses.length === 0) {
        throw new Error(
          `${TOOL_BATCH_EDIT}: scan session "${sessionId}" has no addresses. Run a scan first.`,
        );
      }

      if (session.addresses.length > BATCH_EDIT_MAX_ADDRESSES) {
        throw new Error(
          `${TOOL_BATCH_EDIT}: session has ${session.addresses.length} addresses, exceeds maximum ${BATCH_EDIT_MAX_ADDRESSES}. Narrow your scan first (memory_next_scan) to reduce the address count.`,
        );
      }

      const { formatAddress } = await import('@native/formatAddress');
      const start = Date.now();
      const results: Array<{ address: string; result: 'success' | 'failure'; error?: string }> = [];
      let successCount = 0;
      let failureCount = 0;

      for (const addrBigInt of session.addresses) {
        const addrStr = formatAddress(addrBigInt);
        try {
          await this.memCtrl.writeValue(session.pid, addrStr, value, valueType);
          results.push({ address: addrStr, result: 'success' });
          successCount++;
          this.recordAudit({
            operation: 'batch_edit',
            pid: session.pid,
            address: addrStr,
            size: null,
            result: 'success',
            durationMs: 0,
          });
        } catch (e) {
          results.push({
            address: addrStr,
            result: 'failure',
            error: e instanceof Error ? e.message : String(e),
          });
          failureCount++;
          this.recordAudit({
            operation: 'batch_edit',
            pid: session.pid,
            address: addrStr,
            size: null,
            result: 'failure',
            error: e instanceof Error ? e.message : String(e),
            durationMs: 0,
          });
        }
      }

      const elapsedMs = Date.now() - start;
      return {
        success: true,
        total: session.addresses.length,
        successCount,
        failureCount,
        elapsedMs,
        results: results.slice(0, 50), // trim for response size; audit trail has full list
        resultsTruncated: results.length > 50,
        hint:
          failureCount === 0
            ? `Wrote "${value}" (${valueType}) to all ${successCount} addresses in ${elapsedMs}ms.`
            : `Wrote to ${successCount}/${results.length} addresses in ${elapsedMs}ms (${failureCount} failed).`,
      };
    });
  }

  // ── Watch on Value Change ──

  async handleWatch(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const address = validateHexAddress(args.address, 'address');
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_WATCH}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }

      // Determine read size
      const size = argNumber(args, 'size');
      const autoSize = getByteSizeForValueType(valueType);
      const readSize = size !== undefined ? size : autoSize;
      if (readSize === undefined || readSize <= 0) {
        throw new Error(
          `${TOOL_WATCH}: cannot auto-detect byte size for valueType "${valueType}". Provide an explicit "size" argument (e.g. 256 for string).`,
        );
      }

      const intervalMs = argNumber(args, 'intervalMs', 500);
      if (intervalMs < WATCH_MIN_INTERVAL_MS) {
        throw new Error(
          `${TOOL_WATCH}: intervalMs ${intervalMs} is below minimum ${WATCH_MIN_INTERVAL_MS}ms.`,
        );
      }

      const timeoutMs = Math.min(argNumber(args, 'timeoutMs', 30_000), WATCH_MAX_TIMEOUT_MS);

      // Read initial value
      const initialBuf = await this.memCtrl.dumpMemory(pid, address, readSize);
      const initialHex = initialBuf.toString('hex');

      const pollStart = Date.now();
      let currentHex = initialHex;
      let changed = false;

      while (Date.now() - pollStart < timeoutMs) {
        await sleep(intervalMs);
        const currentBuf = await this.memCtrl.dumpMemory(pid, address, readSize);
        currentHex = currentBuf.toString('hex');
        if (currentHex !== initialHex) {
          changed = true;
          break;
        }
      }

      const elapsedMs = Date.now() - pollStart;
      this.recordAudit({
        operation: 'watch',
        pid,
        address,
        size: readSize,
        result: 'success',
        durationMs: elapsedMs,
      });

      if (changed) {
        return {
          success: true,
          changed: true,
          oldValue: initialHex,
          newValue: currentHex,
          elapsedMs,
          hint: `Value at ${address} changed after ${elapsedMs}ms. Old: ${initialHex}, new: ${currentHex}.`,
        };
      }

      return {
        success: true,
        changed: false,
        value: initialHex,
        elapsedMs,
        hint: `Value at ${address} did not change within ${timeoutMs}ms timeout. Current value: ${initialHex}.`,
      };
    });
  }

  /**
   * Export all active freeze entries as structured JSON.
   *
   * Pure data export — no workflow, no replay, no orchestration.
   * Optionally filtered by pid. Returns freeze entries with their
   * current state (id, pid, address, value, valueType, intervalMs, active).
   */
  async handleFreezeExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const allFreezes = this.memCtrl.listFreezes();

      // Optional PID filter
      let freezes = allFreezes;
      if (args.pid !== undefined) {
        const pid = await this.resolvePid(args.pid);
        freezes = allFreezes.filter((f) => f.pid === pid);
      }

      const entries = freezes.map((f) => ({
        freezeId: f.id,
        pid: f.pid,
        address: f.address,
        value: f.value,
        valueType: f.valueType,
        intervalMs: f.intervalMs,
        active: f.isActive,
      }));

      return {
        success: true,
        freezes: entries,
        count: entries.length,
        totalActive: allFreezes.length,
        filtered: args.pid !== undefined,
        hint:
          entries.length > 0
            ? `Exported ${entries.length} freeze entries${args.pid !== undefined ? ` for PID ${freezes[0]?.pid ?? '?'}` : ''}.`
            : 'No active freeze entries.',
      };
    });
  }
}
