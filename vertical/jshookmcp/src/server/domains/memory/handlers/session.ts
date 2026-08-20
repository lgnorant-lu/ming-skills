import type { MemoryScanSessionManager } from '@native/MemoryScanSession';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { requireStringArg } from './validation';

const TOOL_SCAN_SESSION = 'memory_scan_session';

/** Cap exported session size — a wide first scan can hold millions of addresses
 * and serialising it would balloon the MCP response. Narrow before exporting. */
const SCAN_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

export class SessionHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly sessionManager: MemoryScanSessionManager,
    auditTrail?: MemoryAuditTrail | null,
  ) {
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
}
