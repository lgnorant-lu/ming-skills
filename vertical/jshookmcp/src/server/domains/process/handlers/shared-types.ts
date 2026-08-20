/**
 * Shared dependencies interface for process domain sub-handlers.
 *
 * Each sub-handler receives these deps via constructor injection,
 * enabling composition over inheritance.
 */

import type { AuditEntry } from '@modules/process/memory/AuditTrail';
import type { UnifiedProcessManager, MemoryManager } from '@server/domains/shared/modules/native';
import type { MemoryAuditTrail } from '@modules/process/memory/AuditTrail';
import type { MCPServerContext } from '@server/MCPServer.context';

export interface ProcessHandlerDeps {
  processManager: UnifiedProcessManager;
  memoryManager: MemoryManager;
  auditTrail: MemoryAuditTrail;
  platform: string;
  ctx?: MCPServerContext;
}

export type MemoryDiagnosticsRequest = {
  pid?: number;
  address?: string;
  size?: number;
  operation: string;
  error?: string;
};

export type MemoryAuditRecordInput = Omit<AuditEntry, 'timestamp' | 'user'>;

export interface MemoryOperationHost {
  readonly platformValue: string;
  safeBuildMemoryDiagnostics(input: MemoryDiagnosticsRequest): Promise<unknown>;
  recordMemoryAudit(entry: MemoryAuditRecordInput): void;
  exportMemoryAuditEntries(): unknown[];
  clearMemoryAuditEntries(): void;
  getMemoryAuditCount(): number;
}

export type { AuditEntry };
