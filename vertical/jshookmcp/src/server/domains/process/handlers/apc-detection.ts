/**
 * APC Injection Detection Handler — process_detect_apc
 *
 * Detects APC (Asynchronous Procedure Call) injection in target process threads.
 * APC injection uses QueueUserAPC / NtQueueApcThread to queue malicious code
 * onto a thread's APC queue, then triggers execution via alertable wait.
 *
 * Win32 only — excluded from registration on non-Win32 platforms.
 */

import { argNumber } from '@server/domains/shared/parse-args';
import { detectApcInjection } from '@native/APCDetector';
import type { ProcessHandlerDeps } from './shared-types';

export class ApcDetectionHandlers {
  private deps?: ProcessHandlerDeps;
  constructor(deps?: ProcessHandlerDeps) {
    this.deps = deps;
  }

  async handleProcessDetectApc(args: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    try {
      const pid = argNumber(args, 'pid');
      if (!pid || pid <= 0 || !Number.isInteger(pid)) {
        return {
          success: false,
          error: 'pid must be a positive integer',
        };
      }

      if (process.platform !== 'win32') {
        return {
          success: false,
          error: 'APC injection detection is Windows-only (requires NtQueryInformationThread)',
          platform: process.platform,
        };
      }

      const result = detectApcInjection(pid);

      // Enhance: cross-reference with process_enum_threads if available
      // (provides thread count baseline)
      if (this.deps?.auditTrail) {
        try {
          this.deps.auditTrail.record({
            operation: 'process_detect_apc',
            pid,
            // APC detection targets threads, not a memory address — AuditEntry
            // types address as string | null. Never write BigInt here: the
            // audit trail is JSON-serialized on export, and JSON.stringify
            // throws on BigInt, breaking memory_audit_export for all entries.
            address: null,
            size: 0,
            result: result.success ? 'success' : 'failure',
            error: result.error,
            durationMs: Date.now() - startedAt,
          });
        } catch {
          // fail-soft
        }
      }

      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
