import type { ExecuteWorkflowResult } from '@server/workflows/WorkflowEngine.types';
import { WORKFLOW_MAX_RUNS } from '@src/constants';
import { logger } from '@utils/logger';

export interface WorkflowRunEntry {
  workflowId: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error';
  stepResultKeys: string[];
}

export interface ListRunsOptions {
  /** Maximum number of entries to return (default: no limit). */
  limit?: number;
  /** Number of entries to skip from the oldest end (default: 0). */
  offset?: number;
}

export class WorkflowRunStore {
  private readonly runs = new Map<string, WorkflowRunEntry>();
  // Only the latest successful run per workflow is retained, and only as a
  // summary (step-result KEYS) — never the raw step outputs — so a long-lived
  // process cannot accumulate unbounded payloads here.
  private readonly lastSuccess = new Map<string, WorkflowRunEntry>();
  private readonly maxRuns: number;

  constructor(maxRuns: number = WORKFLOW_MAX_RUNS) {
    this.maxRuns = Math.max(1, Math.trunc(maxRuns) || 1);
  }

  recordSuccess(result: ExecuteWorkflowResult): void {
    const entry: WorkflowRunEntry = {
      workflowId: result.workflowId,
      runId: result.runId,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      status: 'success',
      stepResultKeys: Object.keys(result.stepResults),
    };
    this.setRun(result.runId, entry);
    this.lastSuccess.set(result.workflowId, entry);
    logger.debug(`workflow run recorded: ${result.runId} (${result.workflowId})`);
  }

  recordError(workflowId: string, runId: string, startedAt: string, error: unknown): void {
    const entry: WorkflowRunEntry = {
      workflowId,
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      status: 'error',
      stepResultKeys: [],
    };
    this.setRun(runId, entry);
    logger.debug(`workflow run error: ${runId} (${workflowId}): ${error}`);
  }

  getRun(runId: string): WorkflowRunEntry | undefined {
    return this.runs.get(runId);
  }

  getLastSuccess(workflowId: string): WorkflowRunEntry | undefined {
    return this.lastSuccess.get(workflowId);
  }

  listRuns(workflowId?: string, options: ListRunsOptions = {}): WorkflowRunEntry[] {
    const entries = [...this.runs.values()];
    const filtered = workflowId
      ? entries.filter((entry) => entry.workflowId === workflowId)
      : entries;
    const offset = options.offset ?? 0;
    if (typeof options.limit === 'number') {
      return filtered.slice(offset, offset + options.limit);
    }
    return offset > 0 ? filtered.slice(offset) : filtered;
  }

  clear(): void {
    this.runs.clear();
    this.lastSuccess.clear();
  }

  /**
   * Insert a run entry, evicting the oldest retained run once the cap is
   * reached (Map preserves insertion order, so the first key is the oldest).
   */
  private setRun(runId: string, entry: WorkflowRunEntry): void {
    if (this.runs.has(runId)) {
      this.runs.set(runId, entry);
      return;
    }
    if (this.runs.size >= this.maxRuns) {
      const oldestKey = this.runs.keys().next().value;
      if (oldestKey !== undefined) {
        this.runs.delete(oldestKey);
      }
    }
    this.runs.set(runId, entry);
  }
}
