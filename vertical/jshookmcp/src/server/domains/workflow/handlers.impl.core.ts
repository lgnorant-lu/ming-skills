/**
 * Workflow domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts and ./handlers/network-policy.ts.
 * Handler methods delegated to sub-handler instances.
 */

import type { WorkflowHandlersDeps } from './handlers/shared';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import {
  createWorkflowSharedState,
  getOptionalString,
  getOptionalRecord,
  jsonTextResult,
} from './handlers/shared';
import { ScriptHandlers } from './handlers/script-handlers';
import { ApiHandlers } from './handlers/api-handlers';
import { AccountHandlers } from './handlers/account-handlers';
import { ReverseSessionHandlers } from '@server/reverse-session/ReverseSessionHandlers';
import { getWorkflowRunStore } from '@server/workflows/WorkflowEngine';
import { evaluatePredicate } from '@server/workflows/WorkflowPredicates';
import type { BranchNode } from '@server/workflows/WorkflowContract';
import type { InternalExecutionContext } from '@server/workflows/WorkflowEngine.types';
import type { RetryPolicy } from '@server/workflows/WorkflowContract';
import {
  clearSessionRetryPolicy,
  getGlobalRetryPolicy,
  setGlobalRetryPolicy,
} from './retry-policy';

export type { WorkflowHandlersDeps } from './handlers/shared';

export class WorkflowHandlers {
  private readonly deps: WorkflowHandlersDeps;
  private scripts: ScriptHandlers;
  private api: ApiHandlers;
  private account: AccountHandlers;
  private reverseSession: ReverseSessionHandlers;
  /** Exposed for tests — returns the stored retry policy (or null). */
  getStoredRetryPolicy(): RetryPolicy | null {
    return getGlobalRetryPolicy() ?? null;
  }

  dropSessionState(sessionId: string): void {
    clearSessionRetryPolicy(sessionId);
  }

  constructor(deps: WorkflowHandlersDeps) {
    this.deps = deps;
    const state = createWorkflowSharedState(deps);
    this.scripts = new ScriptHandlers(state);
    this.api = new ApiHandlers(state);
    this.account = new AccountHandlers(state);
    this.reverseSession = new ReverseSessionHandlers(
      deps.serverContext
        ? (toolName, args) => deps.serverContext!.executeToolWithTracking(toolName, args)
        : undefined,
    );
  }

  async handlePageScriptRegisterTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePageScriptRegister(args));
  }

  async handlePageScriptRunTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePageScriptRun(args));
  }

  async handleListExtensionWorkflowsTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleListExtensionWorkflows());
  }

  async handleRunExtensionWorkflowTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleRunExtensionWorkflow(args));
  }

  async handleApiProbeBatchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleApiProbeBatch(args));
  }

  async handleJsBundleSearchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleJsBundleSearch(args));
  }

  async handleReverseSessionTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleReverseSession(args));
  }

  async handleWorkflowRunInspectTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWorkflowRunInspect(args));
  }

  async handleWorkflowConditionalStepTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWorkflowConditionalStep(args));
  }

  async handleWorkflowRetryPolicyTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleWorkflowRetryPolicy(args));
  }

  handlePageScriptRegister(args: Record<string, unknown>) {
    return this.scripts.handlePageScriptRegister(args);
  }
  handlePageScriptRun(args: Record<string, unknown>) {
    return this.scripts.handlePageScriptRun(args);
  }
  handleListExtensionWorkflows() {
    return this.scripts.handleListExtensionWorkflows();
  }
  handleRunExtensionWorkflow(args: Record<string, unknown>) {
    return this.scripts.handleRunExtensionWorkflow(args, getGlobalRetryPolicy());
  }
  handleApiProbeBatch(args: Record<string, unknown>) {
    return this.api.handleApiProbeBatch(args);
  }
  handleJsBundleSearch(args: Record<string, unknown>) {
    return this.account.handleJsBundleSearch(args);
  }
  handleReverseSession(args: Record<string, unknown>) {
    return this.reverseSession.handleReverseSession(args);
  }

  /**
   * Inspect the global workflow run store. Every executeExtensionWorkflow call
   * (extension workflows + macros, which MacroRunner routes through the engine)
   * is recorded here; reverse_session runs go through executeToolWithTracking
   * directly and are not captured.
   */
  async handleWorkflowRunInspect(args: Record<string, unknown>): Promise<ToolResponse> {
    const action = (getOptionalString(args.action) ?? 'list') as 'list' | 'get' | 'lastSuccess';
    const store = getWorkflowRunStore();

    if (action === 'get') {
      const runId = getOptionalString(args.runId);
      if (!runId) {
        return jsonTextResult({
          success: false,
          error: 'runId is required for action=get',
        });
      }
      const run = store.getRun(runId);
      if (!run) {
        return jsonTextResult({ success: false, error: `Run "${runId}" not found` });
      }
      return jsonTextResult({ success: true, run });
    }

    if (action === 'lastSuccess') {
      const workflowId = getOptionalString(args.workflowId);
      if (!workflowId) {
        return jsonTextResult({
          success: false,
          error: 'workflowId is required for action=lastSuccess',
        });
      }
      const result = store.getLastSuccess(workflowId);
      if (!result) {
        return jsonTextResult({
          success: false,
          error: `No successful run recorded for workflow "${workflowId}"`,
        });
      }
      return jsonTextResult({ success: true, result });
    }

    // action === 'list'
    const workflowId = getOptionalString(args.workflowId);
    const runs = store.listRuns(workflowId);
    return jsonTextResult({ success: true, count: runs.length, runs });
  }

  /**
   * Evaluate a predicate against step results from args only and execute the
   * appropriate tool branch. Prior-run resolution was removed because the bounded
   * WorkflowRunStore retains only step-result KEYS, not raw step outputs, so a
   * previous run's values cannot back value-based predicates here.
   */
  async handleWorkflowConditionalStep(args: Record<string, unknown>): Promise<ToolResponse> {
    const predicateId = getOptionalString(args.predicateId);
    if (!predicateId) {
      return jsonTextResult({ success: false, error: 'predicateId is required' });
    }

    const whenTrue = getOptionalRecord(args.whenTrue);
    if (!whenTrue) {
      return jsonTextResult({ success: false, error: 'whenTrue is required' });
    }
    const whenTrueTool = getOptionalString(whenTrue.tool);
    if (!whenTrueTool) {
      return jsonTextResult({ success: false, error: 'whenTrue.tool is required' });
    }
    const whenTrueArgs =
      (typeof whenTrue.args === 'object' && whenTrue.args !== null && !Array.isArray(whenTrue.args)
        ? (whenTrue.args as Record<string, unknown>)
        : undefined) ?? {};

    const whenFalse = getOptionalRecord(args.whenFalse);
    const whenFalseTool = whenFalse ? getOptionalString(whenFalse.tool) : undefined;
    const whenFalseArgs =
      whenFalse &&
      typeof whenFalse.args === 'object' &&
      whenFalse.args !== null &&
      !Array.isArray(whenFalse.args)
        ? (whenFalse.args as Record<string, unknown>)
        : {};

    // Resolve stepResults: from args only. Prior-run resolution was removed
    // because the bounded WorkflowRunStore retains only step-result KEYS
    // (see WorkflowRunStore.getLastSuccess), not the raw step outputs, so a
    // previous run's values cannot back value-based predicates here.
    let stepResults: Record<string, unknown> | undefined =
      typeof args.stepResults === 'object' &&
      args.stepResults !== null &&
      !Array.isArray(args.stepResults)
        ? (args.stepResults as Record<string, unknown>)
        : undefined;

    if (!stepResults) {
      stepResults = {};
    }

    // Build a minimal execution context for evaluatePredicate
    const stepResultsMap = new Map(Object.entries(stepResults));
    const stubCtx: InternalExecutionContext = {
      workflowRunId: 'conditional-step',
      profile: 'workflow',
      stepResults: stepResultsMap,
      dataBus: null as unknown as InternalExecutionContext['dataBus'],
      invokeTool: () => Promise.resolve(undefined),
      emitSpan: () => {},
      emitMetric: () => {},
      getConfig: <T>(_path: string, fallback?: T) => fallback as T,
    };

    // Build a synthetic BranchNode for evaluatePredicate
    const syntheticBranch: BranchNode = {
      kind: 'branch',
      id: 'conditional-step',
      predicateId,
      whenTrue: { kind: 'tool', id: 'dummy-true', toolName: 'dummy' },
    };

    let predicateResult: boolean;
    try {
      predicateResult = await evaluatePredicate(syntheticBranch, stubCtx);
    } catch (error) {
      return jsonTextResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Execute the appropriate branch
    if (predicateResult) {
      try {
        const result = await this.deps.serverContext!.executeToolWithTracking(
          whenTrueTool,
          whenTrueArgs,
        );
        return jsonTextResult({
          success: true,
          predicateId,
          branch: 'whenTrue',
          result,
        });
      } catch (error) {
        return jsonTextResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (whenFalseTool) {
      try {
        const result = await this.deps.serverContext!.executeToolWithTracking(
          whenFalseTool,
          whenFalseArgs,
        );
        return jsonTextResult({
          success: true,
          predicateId,
          branch: 'whenFalse',
          result,
        });
      } catch (error) {
        return jsonTextResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return jsonTextResult({
      success: true,
      predicateId,
      branch: 'skipped',
      reason: 'Predicate evaluated to false and no whenFalse branch was provided',
    });
  }

  /**
   * Store a global retry policy with exponential backoff. The stored policy
   * serves as a default that run_extension_workflow / run_macro can apply
   * when individual nodes lack an explicit retry config.
   */
  async handleWorkflowRetryPolicy(args: Record<string, unknown>): Promise<ToolResponse> {
    const maxAttemptsRaw = args.maxAttempts;
    if (maxAttemptsRaw === undefined || maxAttemptsRaw === null) {
      return jsonTextResult({ success: false, error: 'maxAttempts is required' });
    }
    const maxAttempts = Math.max(1, Math.min(10, Math.trunc(Number(maxAttemptsRaw)) || 1));

    const backoffMsRaw = args.backoffMs;
    if (backoffMsRaw === undefined || backoffMsRaw === null) {
      return jsonTextResult({ success: false, error: 'backoffMs is required' });
    }
    const backoffMs = Math.max(0, Math.min(60_000, Math.trunc(Number(backoffMsRaw)) || 0));

    const multiplierRaw = args.multiplier;
    const multiplier =
      multiplierRaw !== undefined && multiplierRaw !== null
        ? Math.max(1, Math.min(10, Number(multiplierRaw) || 1))
        : 2;

    const policy: RetryPolicy = { maxAttempts, backoffMs, multiplier };

    setGlobalRetryPolicy(policy);

    return jsonTextResult({ success: true, stored: true, policy });
  }
}
