/**
 * Handle Enumeration Handler — memory_handle_enum
 *
 * Enumerates open handles for a target process via NtQuerySystemInformation.
 * Wraps the native HandleEnumerator module with type filtering and safe defaults.
 * Win32-only, admin required.
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argNumber, argString, argBool } from '@server/domains/shared/parse-args';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { enumerateProcessHandles } from '@native/HandleEnumerator';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';

const TOOL_NAME = 'memory_handle_enum';

const HANDLE_TYPE_OPTIONS = new Set([
  'File',
  'Key',
  'Process',
  'Thread',
  'Token',
  'Section',
  'Event',
  'Mutant',
  'Semaphore',
  'Timer',
  'Job',
  'Directory',
  'SymbolicLink',
  'WindowStation',
  'Desktop',
  'IoCompletion',
  'EtwRegistration',
  'ALPC Port',
  'WaitCompletionPacket',
  'IoCompletionReserve',
  'TpWorkerFactory',
  'IRTimer',
  'Partition',
  'ActivityReference',
  'PcwObject',
  'RegistryTransaction',
] as const);

interface HandleEntry {
  handleValue: number;
  objectType: string;
  access: string;
  objectName: string;
  inheritable: boolean;
}

export class HandleEnumHandlers {
  private readonly processManager?: UnifiedProcessManager;
  private readonly ctx?: MCPServerContext;
  constructor(processManager?: UnifiedProcessManager, ctx?: MCPServerContext) {
    this.processManager = processManager;
    this.ctx = ctx;
  }

  private async resolvePid(value: unknown): Promise<number> {
    return await resolveMemoryDomainPid(value, this.processManager, this.ctx);
  }

  async handleHandleEnum(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);

      const filterType = argString(args, 'filterType');
      const includeNames = argBool(args, 'includeNames', true);
      const maxResults = argNumber(args, 'maxResults', 200);

      if (!Number.isFinite(maxResults) || maxResults <= 0 || maxResults > 1000) {
        throw new Error(
          `${TOOL_NAME}: argument "maxResults" must be between 1 and 1000, got: ${JSON.stringify(args.maxResults)}`,
        );
      }

      // Validate filterType against known types
      if (filterType && !(HANDLE_TYPE_OPTIONS as ReadonlySet<string>).has(filterType)) {
        throw new Error(
          `${TOOL_NAME}: argument "filterType" must be one of: ${[...HANDLE_TYPE_OPTIONS].join(', ')}, got: ${JSON.stringify(filterType)}`,
        );
      }

      // Call native enumerator
      const result = enumerateProcessHandles(pid, {
        includeNames,
        filterType: filterType || undefined,
      });

      if (!result.success) {
        return {
          success: false,
          pid,
          totalHandles: 0,
          handles: [],
          error: result.error,
          requiresElevation: result.requiresElevation,
        };
      }

      // Map to simplified output
      const handles: HandleEntry[] = result.entries.slice(0, maxResults).map((entry) => ({
        handleValue: entry.handleValue,
        objectType: entry.typeName,
        access: `0x${(entry.grantedAccess >>> 0).toString(16).padStart(8, '0')}`,
        objectName: entry.objectName,
        inheritable: !!(entry.handleAttributes & 0x02),
      }));

      // Build type summary
      const typeSummary: Record<string, number> = {};
      for (const entry of result.entries) {
        const t = entry.typeName;
        typeSummary[t] = (typeSummary[t] ?? 0) + 1;
      }

      const truncated = result.entries.length > maxResults;

      return {
        success: true,
        pid,
        totalHandles: result.entries.length,
        totalSystemHandles: result.totalSystemHandles,
        returnedHandles: handles.length,
        truncated,
        typeSummary,
        handles,
        hint: truncated
          ? `Returned ${handles.length} of ${result.entries.length} handles (capped at ${maxResults}). Use filterType to narrow results.`
          : `Found ${result.entries.length} handles. Use filterType to filter by type.`,
      };
    });
  }
}
