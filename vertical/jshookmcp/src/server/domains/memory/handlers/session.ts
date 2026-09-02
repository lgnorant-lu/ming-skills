import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { requireStringArg } from './validation';

const TOOL_SCAN_SESSION = 'memory_scan_session';
const TOOL_SESSION_EXPORT = 'memory_session_export';

/** Cap exported session size — a wide first scan can hold millions of addresses
 * and serialising it would balloon the MCP response. Narrow before exporting. */
const SCAN_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

/** Maximum addresses to include in structured session export. Above this cap,
 * addresses are truncated and the `truncated` flag is set. */
const SESSION_EXPORT_MAX_ADDRESSES = 100_000;

export class SessionHandlers {
  private readonly sessionManager: MemoryScanSessionManager;
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(sessionManager: MemoryScanSessionManager, auditTrail?: MemoryAuditTrail | null) {
    this.sessionManager = sessionManager;
    this.auditTrail = auditTrail ?? null;
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

  async handleScanList(_args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessions = this.sessionManager.listSessions();
      return { sessions, count: sessions.length };
    });
  }

  async handleScanDelete(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_SCAN_SESSION);
      const start = Date.now();
      const deleted = this.sessionManager.deleteSession(sessionId);
      this.recordAudit({
        operation: 'scan_session_delete',
        pid: null,
        address: null,
        size: null,
        result: deleted ? 'success' : 'failure',
        durationMs: Date.now() - start,
      });
      return { deleted };
    });
  }

  async handleScanExport(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_SCAN_SESSION);
      const exportedData = this.sessionManager.exportSession(sessionId);
      // Bound the response size — exports of un-narrowed sessions can be huge.
      const serialized =
        typeof exportedData === 'string' ? exportedData : JSON.stringify(exportedData);
      if (serialized.length > SCAN_EXPORT_MAX_BYTES) {
        throw new Error(
          `${TOOL_SCAN_SESSION}: export for session "${sessionId}" is ${serialized.length} bytes, ` +
            `exceeds ${SCAN_EXPORT_MAX_BYTES} bytes (${Math.round(SCAN_EXPORT_MAX_BYTES / 1024 / 1024)}MB). ` +
            `Narrow the session with memory_next_scan before exporting.`,
        );
      }
      return { exportedData };
    });
  }

  /**
   * Export a scan session's complete state as structured JSON.
   *
   * Pure data export — no workflow, no replay, no orchestration.
   * Addresses are capped at SESSION_EXPORT_MAX_ADDRESSES (100K) with a
   * `truncated` flag when the cap is hit.
   */
  async handleSessionExportData(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_SESSION_EXPORT);
      const session = this.sessionManager.getSession(sessionId);
      const { formatAddress } = await import('@native/formatAddress');

      const totalAddresses = session.addresses.length;
      const truncated = totalAddresses > SESSION_EXPORT_MAX_ADDRESSES;
      const addresses = session.addresses
        .slice(0, SESSION_EXPORT_MAX_ADDRESSES)
        .map((addr) => formatAddress(addr));

      const values: Record<string, string> = {};
      let valueIdx = 0;
      for (const [addr, buf] of session.previousValues) {
        if (valueIdx >= SESSION_EXPORT_MAX_ADDRESSES) break;
        values[formatAddress(addr)] = buf.toString('hex');
        valueIdx++;
      }

      return {
        success: true,
        sessionId: session.id,
        pid: session.pid,
        valueType: session.valueType,
        scanCount: session.scanCount,
        addresses,
        values,
        metadata: {
          createdAt: new Date(session.createdAt).toISOString(),
          lastScanAt: new Date(session.lastScanAt).toISOString(),
          alignment: session.alignment,
          totalAddresses,
          truncated,
        },
        hint: truncated
          ? `Exported ${SESSION_EXPORT_MAX_ADDRESSES.toLocaleString()} of ${totalAddresses.toLocaleString()} addresses (truncated). Narrow the scan to export all.`
          : `Exported ${totalAddresses} addresses.`,
      };
    });
  }
}
