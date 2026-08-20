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
  constructor(private deps?: ProcessHandlerDeps) {}

  async handleProcessDetectApc(args: Record<string, unknown>): Promise<unknown> {
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
            address: BigInt(0),
            size: 0,
            result: result.success ? 'success' : 'failure',
            error: result.error,
          } as never);
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
