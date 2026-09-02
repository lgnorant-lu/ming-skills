import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── mocks ──────────────────────────────────────────────────────────────
const { mockExecuteToolWithTracking, mockGetWorkflowRunStore, mockRunStore } = vi.hoisted(() => {
  const store = {
    getLastSuccess: vi.fn(),
    listRuns: vi.fn(() => []),
    getRun: vi.fn(),
    recordSuccess: vi.fn(),
    recordError: vi.fn(),
  };
  return {
    mockExecuteToolWithTracking: vi.fn(),
    mockGetWorkflowRunStore: vi.fn(() => store),
    mockRunStore: store,
  };
});

vi.mock('@server/workflows/WorkflowEngine', () => ({
  getWorkflowRunStore: mockGetWorkflowRunStore,
}));

import { WorkflowHandlers } from '@server/domains/workflow/handlers';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';

// ── helpers ────────────────────────────────────────────────────────────
interface ConditionalStepResponse {
  success: boolean;
  error?: string;
  predicateId?: string;
  branch?: string;
  result?: unknown;
}

interface RetryPolicyResponse {
  success: boolean;
  error?: string;
  stored?: boolean;
  policy?: { maxAttempts: number; backoffMs: number; multiplier: number };
}

// ── tests ──────────────────────────────────────────────────────────────
describe('WorkflowHandlers — conditional_step + retry_policy', () => {
  const deps = {
    browserHandlers: {
      handlePageEvaluate: vi.fn(),
      handlePageNavigate: vi.fn(),
      handlePageClick: vi.fn(),
      handlePageType: vi.fn(),
      handleTabWorkflow: vi.fn(),
    },
    advancedHandlers: {
      handleNetworkMonitor: vi.fn(),
      handleConsoleInjectFetchInterceptor: vi.fn(),
      handleConsoleInjectXhrInterceptor: vi.fn(),
      handleNetworkGetStats: vi.fn(),
      handleNetworkGetRequests: vi.fn(),
      handleNetworkExtractAuth: vi.fn(),
      handleNetworkExportHar: vi.fn(),
    },
    serverContext: {
      extensionWorkflowsById: new Map(),
      extensionWorkflowRuntimeById: new Map(),
      executeToolWithTracking: mockExecuteToolWithTracking,
      baseTier: 'workflow',
      config: {},
    },
  };

  let handlers: WorkflowHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteToolWithTracking.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true, data: 'ok' }) }],
    });
    handlers = new WorkflowHandlers(
      deps as unknown as ConstructorParameters<typeof WorkflowHandlers>[0],
    );
  });

  // ── workflow_conditional_step ──────────────────────────────────────

  describe('workflow_conditional_step', () => {
    it('requires predicateId', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStepTool({
          whenTrue: { tool: 'fake_tool', args: {} },
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('predicateId');
    });

    it('requires whenTrue', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStepTool({
          predicateId: 'always_true',
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('whenTrue');
    });

    it('requires whenTrue.tool', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStepTool({
          predicateId: 'always_true',
          whenTrue: { args: {} },
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('whenTrue.tool');
    });

    it('executes whenTrue branch for always_true predicate', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'always_true',
          whenTrue: { tool: 'fake_tool', args: { key: 'val' } },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
      expect(mockExecuteToolWithTracking).toHaveBeenCalledWith('fake_tool', { key: 'val' });
    });

    it('executes whenFalse branch for always_false predicate', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'always_false',
          whenTrue: { tool: 'never_called' },
          whenFalse: { tool: 'fallback_tool', args: { reason: 'nope' } },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenFalse');
      expect(mockExecuteToolWithTracking).toHaveBeenCalledWith('fallback_tool', {
        reason: 'nope',
      });
      expect(mockExecuteToolWithTracking).not.toHaveBeenCalledWith(
        'never_called',
        expect.anything(),
      );
    });

    it('skips when predicate is false and no whenFalse is provided', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'always_false',
          whenTrue: { tool: 'skip_me' },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('skipped');
      expect(mockExecuteToolWithTracking).not.toHaveBeenCalled();
    });

    it('evaluates any_step_failed with provided stepResults', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'any_step_failed',
          whenTrue: { tool: 'recovery_tool' },
          stepResults: {
            'step-a': {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'boom' }) }],
            },
          },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
      expect(mockExecuteToolWithTracking).toHaveBeenCalledWith('recovery_tool', {});
    });

    it('evaluates success_rate_gte_N with provided stepResults', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'success_rate_gte_50',
          whenTrue: { tool: 'confidence_high' },
          whenFalse: { tool: 'confidence_low' },
          stepResults: {
            'step-1': {
              content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
            },
            'step-2': {
              content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'fail' }) }],
            },
          },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
      expect(mockExecuteToolWithTracking).toHaveBeenCalledWith('confidence_high', {});
    });

    it('evaluates variable_equals_KEY_VALUE with provided stepResults', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'variable_equals_status_active',
          whenTrue: { tool: 'handle_active' },
          stepResults: {
            status: 'active',
          },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
    });

    it('evaluates variable_contains_KEY_VALUE with provided stepResults', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'variable_contains_msg_error',
          whenTrue: { tool: 'handle_error_msg' },
          stepResults: {
            msg: 'an error occurred during processing',
          },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
    });

    it('evaluates variable_matches_KEY_REGEX with provided stepResults', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'variable_matches_code_[45]\\d{2}',
          whenTrue: { tool: 'handle_4xx_5xx' },
          stepResults: {
            code: '404',
          },
        }),
      );
      expect(body.success).toBe(true);
      expect(body.branch).toBe('whenTrue');
    });

    it('does not read prior-run step outputs when stepResults is omitted', async () => {
      mockRunStore.getLastSuccess.mockReturnValue({
        workflowId: 'workflow.demo.v1',
        runId: 'run-1',
        stepResultKeys: ['check-auth'],
      });

      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'any_step_failed',
          whenTrue: { tool: 'reauth' },
          workflowId: 'workflow.demo.v1',
        }),
      );
      // The bounded run store retains only step-result keys, not the raw step
      // outputs, so prior-run values cannot back value-based predicates.
      expect(body.success).toBe(true);
      expect(body.branch).toBe('skipped');
      expect(mockRunStore.getLastSuccess).not.toHaveBeenCalled();
    });

    it('rejects unknown predicateId', async () => {
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'magic_predicate',
          whenTrue: { tool: 'nope' },
          stepResults: {},
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unknown');
    });

    it('wraps errors from tool invocation gracefully', async () => {
      mockExecuteToolWithTracking.mockRejectedValue(new Error('tool crash'));
      const body = parseJson<ConditionalStepResponse>(
        await handlers.handleWorkflowConditionalStep({
          predicateId: 'always_true',
          whenTrue: { tool: 'crashy' },
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('tool crash');
    });
  });

  // ── workflow_retry_policy ──────────────────────────────────────────

  describe('workflow_retry_policy', () => {
    it('requires maxAttempts', async () => {
      const body = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicyTool({
          backoffMs: 1000,
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('maxAttempts');
    });

    it('requires backoffMs', async () => {
      const body = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicyTool({
          maxAttempts: 3,
        }),
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('backoffMs');
    });

    it('clamps maxAttempts to 1-10 range', async () => {
      const bodyLow = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 0,
          backoffMs: 500,
        }),
      );
      expect(bodyLow.success).toBe(true);
      expect(bodyLow.policy!.maxAttempts).toBe(1);

      const bodyHigh = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 100,
          backoffMs: 500,
        }),
      );
      expect(bodyHigh.success).toBe(true);
      expect(bodyHigh.policy!.maxAttempts).toBe(10);
    });

    it('clamps backoffMs to 0-60000 range', async () => {
      const bodyNeg = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 3,
          backoffMs: -100,
        }),
      );
      expect(bodyNeg.success).toBe(true);
      expect(bodyNeg.policy!.backoffMs).toBe(0);

      const bodyHigh = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 3,
          backoffMs: 120_000,
        }),
      );
      expect(bodyHigh.success).toBe(true);
      expect(bodyHigh.policy!.backoffMs).toBe(60_000);
    });

    it('defaults multiplier to 2 when omitted', async () => {
      const body = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 3,
          backoffMs: 1000,
        }),
      );
      expect(body.success).toBe(true);
      expect(body.stored).toBe(true);
      expect(body.policy!.multiplier).toBe(2);
    });

    it('clamps multiplier to 1-10 range', async () => {
      const bodyLow = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 3,
          backoffMs: 500,
          multiplier: 0.5,
        }),
      );
      expect(bodyLow.success).toBe(true);
      expect(bodyLow.policy!.multiplier).toBe(1);

      const bodyHigh = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 3,
          backoffMs: 500,
          multiplier: 20,
        }),
      );
      expect(bodyHigh.success).toBe(true);
      expect(bodyHigh.policy!.multiplier).toBe(10);
    });

    it('stores the policy in the state board for subsequent reads', async () => {
      // First call sets the policy
      const setBody = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 4,
          backoffMs: 2000,
          multiplier: 3,
        }),
      );
      expect(setBody.success).toBe(true);
      expect(setBody.stored).toBe(true);
      expect(setBody.policy).toEqual({ maxAttempts: 4, backoffMs: 2000, multiplier: 3 });

      // A second call with different values overwrites
      const overwriteBody = parseJson<RetryPolicyResponse>(
        await handlers.handleWorkflowRetryPolicy({
          maxAttempts: 2,
          backoffMs: 500,
        }),
      );
      expect(overwriteBody.success).toBe(true);
      expect(overwriteBody.policy).toEqual({ maxAttempts: 2, backoffMs: 500, multiplier: 2 });

      // Verify the stored values via a fresh handler (simulate cross-call persistence)
      expect(handlers.getStoredRetryPolicy()).toEqual({
        maxAttempts: 2,
        backoffMs: 500,
        multiplier: 2,
      });
    });

    it('keeps retry defaults isolated across ten MCP sessions', async () => {
      const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index}`);

      await Promise.all(
        sessionIds.map(
          async (sessionId, index) =>
            await runWithToolRequestContext({ sessionId }, async () => {
              await handlers.handleWorkflowRetryPolicy({
                maxAttempts: index + 1,
                backoffMs: index * 100,
                multiplier: 2,
              });
            }),
        ),
      );

      for (const [index, sessionId] of sessionIds.entries()) {
        await runWithToolRequestContext({ sessionId }, async () => {
          expect(handlers.getStoredRetryPolicy()).toEqual({
            maxAttempts: index + 1,
            backoffMs: index * 100,
            multiplier: 2,
          });
        });
      }
    });
  });
});
