import type { MemoryScanner } from '@native/MemoryScanner';
import type {
  ScanCompareMode,
  ScanOptions,
  ScanValueType,
} from '@native/NativeMemoryManager.types';
import type { EventBus, ServerEventMap } from '@server/EventBus';
import { MEMORY_SCAN_MAX_RESULTS } from '@src/constants';
import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolveMemoryDomainPid } from '@server/domains/memory/pid-resolver';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import {
  argBool,
  argEnum,
  argNumber,
  argObject,
  argString,
} from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import { validateHexAddress, requireStringArg, validateValueForType } from './validation';

// Mirror of ScanValueTypeOptions in definitions.ts — kept in sync so handler-layer
// validation rejects unknown value types before reaching the native scanner.
const SCAN_VALUE_TYPES = new Set<ScanValueType>([
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

const SCAN_COMPARE_MODES = new Set<ScanCompareMode>([
  'exact',
  'unknown_initial',
  'changed',
  'unchanged',
  'increased',
  'decreased',
  'greater_than',
  'less_than',
  'between',
  'not_equal',
]);

const TOOL_FIRST_SCAN = 'memory_first_scan';
const TOOL_NEXT_SCAN = 'memory_next_scan';
const TOOL_UNKNOWN_SCAN = 'memory_unknown_scan';
const TOOL_GROUP_SCAN = 'memory_group_scan';

/** Upper bound on group-scan pattern entries — more is almost always a mistake
 * and makes the scan extremely slow. */
const GROUP_SCAN_MAX_PATTERN = 64;

function capMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return MEMORY_SCAN_MAX_RESULTS;
  return Math.min(value, MEMORY_SCAN_MAX_RESULTS);
}

export class ScanHandlers {
  private readonly auditTrail: MemoryAuditTrail | null;

  constructor(
    private readonly scanner: MemoryScanner,
    private readonly eventBus?: EventBus<ServerEventMap>,
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

  async handleFirstScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const value = requireStringArg(args.value, 'value', TOOL_FIRST_SCAN);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_FIRST_SCAN}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      // Early-reject gross value/type mismatches (e.g. "abc" + int32) so they
      // surface here rather than as a cryptic native FFI error.
      validateValueForType(value, valueType, TOOL_FIRST_SCAN);
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const regionFilter = argObject(args, 'regionFilter') as ScanOptions['regionFilter'];
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const options: ScanOptions = { valueType, alignment, maxResults, regionFilter, onProgress };
      const start = Date.now();
      const result = await this.scanner.firstScan(pid, value, options);
      this.recordAudit({
        operation: 'first_scan',
        pid,
        address: null,
        size: result.totalMatches ?? 0,
        result: 'success',
        durationMs: Date.now() - start,
      });
      void this.eventBus?.emit('memory:scan_completed', {
        scanType: 'first',
        resultCount: result.totalMatches ?? 0,
        timestamp: new Date().toISOString(),
      });
      return {
        ...result,
        hint:
          result.totalMatches > 0
            ? `Found ${result.totalMatches} matches. Use memory_next_scan with sessionId "${result.sessionId}" to narrow down.`
            : 'No matches found. Try a different value or type.',
      };
    });
  }

  async handleNextScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const sessionId = requireStringArg(args.sessionId, 'sessionId', TOOL_NEXT_SCAN);
      const mode = argEnum(args, 'mode', SCAN_COMPARE_MODES);
      if (!mode) {
        throw new Error(
          `${TOOL_NEXT_SCAN}: missing or invalid required argument "mode" (expected one of: ${[...SCAN_COMPARE_MODES].join(', ')}), got: ${JSON.stringify(args.mode)}`,
        );
      }
      const value = typeof args.value === 'string' ? args.value : undefined;
      const value2 = typeof args.value2 === 'string' ? args.value2 : undefined;
      // "between" requires both bounds — enforce here so the native layer never
      // receives an undefined upper bound and produce a cryptic comparator error.
      if (mode === 'between') {
        if (!value || !value2) {
          throw new Error(
            `${TOOL_NEXT_SCAN}: mode "between" requires both "value" (lower bound) and "value2" (upper bound)`,
          );
        }
      }
      const result = await this.scanner.nextScan(sessionId, mode, value, value2);
      return {
        ...result,
        hint:
          result.totalMatches <= 10
            ? 'Few matches remaining — inspect these addresses.'
            : `${result.totalMatches} matches remain. Continue narrowing with memory_next_scan.`,
      };
    });
  }

  async handleUnknownScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const valueType = argEnum(args, 'valueType', SCAN_VALUE_TYPES);
      if (!valueType) {
        throw new Error(
          `${TOOL_UNKNOWN_SCAN}: missing or invalid required argument "valueType" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(args.valueType)}`,
        );
      }
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const regionFilter = argObject(args, 'regionFilter') as ScanOptions['regionFilter'];
      const onProgress = args.onProgress as ((p: number, t?: number) => void) | undefined;
      const options: ScanOptions = { valueType, alignment, maxResults, regionFilter, onProgress };
      const result = await this.scanner.unknownInitialScan(pid, options);
      return {
        ...result,
        hint: `Captured ${result.totalMatches} addresses. Use memory_next_scan with changed/unchanged/increased/decreased to narrow.`,
      };
    });
  }

  async handlePointerScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const targetAddress = validateHexAddress(args.targetAddress, 'targetAddress');
      const moduleOnly = argBool(args, 'moduleOnly', false);
      const result = await this.scanner.pointerScan(pid, targetAddress, {
        maxResults: capMaxResults(argNumber(args, 'maxResults')),
        moduleOnly,
      });
      return { ...result };
    });
  }

  async handleGroupScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const rawPattern = args.pattern;
      if (!Array.isArray(rawPattern) || rawPattern.length === 0) {
        throw new Error(
          `${TOOL_GROUP_SCAN}: missing or invalid required argument "pattern" (expected non-empty array of {offset, value, type}), got: ${JSON.stringify(rawPattern)}`,
        );
      }
      if (rawPattern.length > GROUP_SCAN_MAX_PATTERN) {
        throw new Error(
          `${TOOL_GROUP_SCAN}: pattern has ${rawPattern.length} entries, exceeds maximum ${GROUP_SCAN_MAX_PATTERN}. Split into multiple group scans.`,
        );
      }
      const pattern: Array<{ offset: number; value: string; type: ScanValueType }> = [];
      const seenOffsets = new Set<number>();
      for (let i = 0; i < rawPattern.length; i += 1) {
        const entry = rawPattern[i] as Record<string, unknown> | undefined;
        if (!entry || typeof entry !== 'object') {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} must be an object, got: ${JSON.stringify(entry)}`,
          );
        }
        const offset = entry.offset;
        const value = entry.value;
        const type = entry.type;
        if (typeof offset !== 'number' || !Number.isFinite(offset)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "offset" (expected number), got: ${JSON.stringify(offset)}`,
          );
        }
        if (seenOffsets.has(offset)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: duplicate offset ${offset} at pattern index ${i} — each entry must target a distinct offset`,
          );
        }
        seenOffsets.add(offset);
        if (typeof value !== 'string' || value.length === 0) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "value" (expected non-empty string), got: ${JSON.stringify(value)}`,
          );
        }
        if (typeof type !== 'string' || !SCAN_VALUE_TYPES.has(type as ScanValueType)) {
          throw new Error(
            `${TOOL_GROUP_SCAN}: pattern element at index ${i} has invalid "type" (expected one of: ${[...SCAN_VALUE_TYPES].join(', ')}), got: ${JSON.stringify(type)}`,
          );
        }
        pattern.push({ offset, value, type: type as ScanValueType });
      }
      const alignment = argNumber(args, 'alignment');
      const maxResults = capMaxResults(argNumber(args, 'maxResults'));
      const result = await this.scanner.groupScan(pid, pattern, { alignment, maxResults });
      return { ...result };
    });
  }

  async handleAobScan(args: Record<string, unknown>) {
    return handleSafe(async () => {
      const pid = await this.resolvePid(args.pid);
      const rawPattern = requireStringArg(args.pattern, 'pattern', 'memory_aob_scan');
      const moduleName = argString(args, 'moduleName');
      const maxResults = argNumber(args, 'maxResults', 10000);

      // Validate pattern format on the handler side before passing to scanner
      const trimmed = rawPattern.trim();
      if (trimmed.length === 0) {
        throw new Error(
          'memory_aob_scan: missing or invalid required argument "pattern" (expected non-empty AOB pattern like "48 8B ?? ??")',
        );
      }

      const tokens = trimmed.split(/\s+/);
      for (const token of tokens) {
        if (token === '??' || token === '?') {
          // wildcards are valid
          continue;
        }
        const hex = token.startsWith('0x') || token.startsWith('0X') ? token.slice(2) : token;
        if (hex.length !== 2 || !/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new Error(
            `Invalid AOB pattern: each token must be 2 hex chars (00-FF, optional "0x" prefix) or "??" for wildcard, got: "${token}"`,
          );
        }
      }

      if (tokens.length === 0) {
        throw new Error('Invalid AOB pattern: pattern must contain at least one byte or wildcard');
      }

      const result = await this.scanner.aobScan(pid, trimmed, { maxResults, moduleName });
      return {
        ...result,
        hint:
          result.totalMatches > 0
            ? `Found ${result.totalMatches} matches.`
            : 'No matches found. Try a shorter pattern or fewer wildcards.',
      };
    });
  }
}
