/**
 * ProcessHandlersBase — backward-compatible legacy class.
 *
 * Inherits process management + diagnostic helpers from ProcessHandlersCore and
 * delegates all memory operations to the shared MemoryOperationHandlers module.
 */

import { ProcessHandlersCore } from './handlers.base.process';
import { MemoryOperationHandlers } from './handlers/memory-operations';
import type { MemoryOperationHost, ProcessHandlerDeps } from './handlers/shared-types';

export { validatePid, requireString, requirePositiveNumber } from './handlers.base.types';

export class ProcessHandlersBase extends ProcessHandlersCore {
  private readonly memoryOps: MemoryOperationHandlers;

  constructor() {
    super();

    const deps: ProcessHandlerDeps = {
      processManager: this.processManager,
      memoryManager: this.memoryManager,
      auditTrail: this.auditTrail,
      platform: this.platform,
    };
    const host: MemoryOperationHost = {
      platformValue: this.platform,
      safeBuildMemoryDiagnostics: (input) => this.safeBuildMemoryDiagnostics(input),
      recordMemoryAudit: (entry) => this.recordMemoryAudit(entry),
      exportMemoryAuditEntries: () => JSON.parse(this.auditTrail.exportJson()) as unknown[],
      clearMemoryAuditEntries: () => this.auditTrail.clear(),
      getMemoryAuditCount: () => this.auditTrail.size(),
    };

    this.memoryOps = new MemoryOperationHandlers(deps, host);
  }

  async handleMemoryRead(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryRead(args);
  }

  async handleMemoryWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryWrite(args);
  }

  async handleMemoryScan(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScan(args);
  }

  async handleMemoryAuditExport(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryAuditExport(args);
  }

  async handleMemoryCheckProtection(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryCheckProtection(args);
  }

  async handleMemoryScanFiltered(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryScanFiltered(args);
  }

  async handleMemoryBatchWrite(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryBatchWrite(args);
  }

  async handleMemoryDumpRegion(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryDumpRegion(args);
  }

  async handleMemoryListRegions(args: Record<string, unknown>) {
    return this.memoryOps.handleMemoryListRegions(args);
  }
}
