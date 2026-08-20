import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MacroRunner } from '@server/macros/MacroRunner';
import type { MacroDefinition, MacroResult } from '@server/macros/types';

// Mock WorkflowEngine
vi.mock('@server/workflows/WorkflowEngine', () => ({
  executeExtensionWorkflow: vi.fn(),
}));

import { executeExtensionWorkflow } from '@server/workflows/WorkflowEngine';

const mockCtx = {} as any;

function makeDef(overrides?: Partial<MacroDefinition>): MacroDefinition {
  return {
    id: 'test_macro',
    displayName: 'Test Macro',
    description: 'A test macro',
    tags: ['test'],
    timeoutMs: 5000,
    steps: [
      { id: 'step_a', toolName: 'tool_a' },
      { id: 'step_b', toolName: 'tool_b' },
    ],
    ...overrides,
  };
}

describe('MacroRunner', () => {
  let runner: MacroRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new MacroRunner(mockCtx);
  });

  it('buildWorkflowFromDefinition creates valid WorkflowContract', () => {
    const def = makeDef();
    const wf = runner.buildWorkflowFromDefinition(def);
    expect(wf.id).toBe('test_macro');
    expect(wf.displayName).toBe('Test Macro');
    expect(wf.kind).toBe('workflow-contract');
    expect(wf.version).toBe(1);
    expect(wf.timeoutMs).toBe(5000);
    expect(wf.tags).toEqual(['test']);
  });

  it('buildWorkflowFromDefinition maps macro orchestration nodes', () => {
    const def = makeDef({
      steps: [
        {
          id: 'retry_step',
          toolName: 'tool_retry',
          retry: { maxAttempts: 3, backoffMs: 25, multiplier: 2 },
        },
        {
          id: 'parallel_group',
          parallelSteps: [
            { id: 'parallel_a', toolName: 'tool_a' },
            { id: 'parallel_b', toolName: 'tool_b' },
          ],
          maxConcurrency: 2,
          failFast: true,
        },
        {
          id: 'branch_group',
          branchStep: {
            predicateId: 'always_true',
            whenTrue: { id: 'yes', toolName: 'tool_yes' },
            whenFalse: { id: 'no', toolName: 'tool_no' },
          },
        },
        {
          id: 'fallback_group',
          fallbackStep: {
            primary: { id: 'primary', toolName: 'tool_primary' },
            fallback: { id: 'fallback', toolName: 'tool_fallback' },
          },
        },
      ],
    });

    const wf = runner.buildWorkflowFromDefinition(def);
    const root = wf.build({} as any) as any;

    expect(root.kind).toBe('sequence');
    expect(root.steps).toHaveLength(4);
    expect(root.steps[0]).toMatchObject({
      kind: 'tool',
      id: 'retry_step',
      retry: { maxAttempts: 3, backoffMs: 25, multiplier: 2 },
    });
    expect(root.steps[1]).toMatchObject({
      kind: 'parallel',
      id: 'parallel_group',
      maxConcurrency: 2,
      failFast: true,
    });
    expect(root.steps[1].steps.map((step: any) => step.id)).toEqual(['parallel_a', 'parallel_b']);
    expect(root.steps[2]).toMatchObject({
      kind: 'branch',
      id: 'branch_group',
      predicateId: 'always_true',
    });
    expect(root.steps[2].whenTrue.id).toBe('yes');
    expect(root.steps[2].whenFalse.id).toBe('no');
    expect(root.steps[3]).toMatchObject({ kind: 'fallback', id: 'fallback_group' });
    expect(root.steps[3].primary.id).toBe('primary');
    expect(root.steps[3].fallback.id).toBe('fallback');
  });

  it('buildWorkflowFromDefinition honors optional steps with fallback wrappers', () => {
    const def = makeDef({
      steps: [{ id: 'optional_step', toolName: 'unstable_tool', optional: true }],
    });

    const wf = runner.buildWorkflowFromDefinition(def);
    const root = wf.build({} as any) as any;

    expect(root.steps[0]).toMatchObject({
      kind: 'fallback',
      id: 'optional_step-optional',
    });
    expect(root.steps[0].primary).toMatchObject({
      kind: 'tool',
      id: 'optional_step',
      toolName: 'unstable_tool',
    });
    expect(root.steps[0].fallback).toMatchObject({
      kind: 'sequence',
      id: 'optional_step-optional-skip',
    });
  });

  it('execute() returns ok=true on success', async () => {
    const def = makeDef();
    (executeExtensionWorkflow as any).mockResolvedValue({
      workflowId: 'test_macro',
      durationMs: 100,
      stepResults: { step_a: {}, step_b: {} },
      spans: [
        {
          name: 'workflow.node.start',
          attrs: { nodeId: 'step_a' },
          at: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'workflow.node.finish',
          attrs: { nodeId: 'step_a' },
          at: '2026-01-01T00:00:00.050Z',
        },
        {
          name: 'workflow.node.start',
          attrs: { nodeId: 'step_b' },
          at: '2026-01-01T00:00:00.050Z',
        },
        {
          name: 'workflow.node.finish',
          attrs: { nodeId: 'step_b' },
          at: '2026-01-01T00:00:00.100Z',
        },
      ],
    });

    const result = await runner.execute(def);
    expect(result.ok).toBe(true);
    expect(result.macroId).toBe('test_macro');
    expect(result.stepsCompleted).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.progress).toHaveLength(2);
  });

  it('execute() captures step progress with timing', async () => {
    const def = makeDef({ steps: [{ id: 'only_step', toolName: 'some_tool' }] });
    (executeExtensionWorkflow as any).mockResolvedValue({
      durationMs: 42,
      stepResults: { only_step: { value: 'ok' } },
      spans: [
        {
          name: 'workflow.node.start',
          attrs: { nodeId: 'only_step' },
          at: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'workflow.node.finish',
          attrs: { nodeId: 'only_step' },
          at: '2026-01-01T00:00:00.042Z',
        },
      ],
    });

    const result = await runner.execute(def);
    expect(result.progress[0]!.step).toBe(1);
    expect(result.progress[0]!.totalSteps).toBe(1);
    expect(result.progress[0]!.stepName).toBe('only_step');
    expect(result.progress[0]!.status).toBe('complete');
    expect(result.progress[0]!.durationMs).toBe(42);
  });

  it('execute() returns partial results on step failure (atomic bailout)', async () => {
    const def = makeDef();
    (executeExtensionWorkflow as any).mockRejectedValue(new Error('step_b failed: SyntaxError'));

    const result = await runner.execute(def);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('step_b failed: SyntaxError');
    expect(result.totalSteps).toBe(2);
    expect(result.progress).toHaveLength(2);
    expect(result.progress[0]!.status).toBe('failed');
  });

  it('execute() passes inputOverrides to executeExtensionWorkflow', async () => {
    const def = makeDef();
    (executeExtensionWorkflow as any).mockResolvedValue({
      durationMs: 10,
      stepResults: {},
      spans: [],
    });

    const overrides = { step_a: { code: 'test()' } };
    await runner.execute(def, overrides);

    expect(executeExtensionWorkflow).toHaveBeenCalledWith(
      mockCtx,
      expect.anything(),
      expect.objectContaining({ nodeInputOverrides: overrides }),
    );
  });

  it('execute() uses default timeout of 120s when not specified', () => {
    const def = makeDef({ timeoutMs: undefined });
    const wf = runner.buildWorkflowFromDefinition(def);
    expect(wf.timeoutMs).toBe(120_000);
  });

  it('formatProgressReport() generates inline progress text for success', () => {
    const result: MacroResult = {
      macroId: 'test',
      displayName: 'Test',
      ok: true,
      durationMs: 100,
      stepsCompleted: 2,
      totalSteps: 2,
      stepResults: {},
      progress: [
        { step: 1, totalSteps: 2, stepName: 'a', status: 'complete', durationMs: 40 },
        { step: 2, totalSteps: 2, stepName: 'b', status: 'complete', durationMs: 60 },
      ],
    };

    const report = runner.formatProgressReport(result);
    expect(report).toContain('[stage 1/2]');
    expect(report).toContain('[stage 2/2]');
    expect(report).toContain('✓ Macro complete (2/2 steps, 100ms)');
    expect(report).toContain('✓ a — complete (40ms)');
  });

  it('formatProgressReport() shows failure for failed macros', () => {
    const result: MacroResult = {
      macroId: 'test',
      displayName: 'Test',
      ok: false,
      durationMs: 50,
      stepsCompleted: 1,
      totalSteps: 3,
      stepResults: {},
      progress: [
        { step: 1, totalSteps: 3, stepName: 'a', status: 'complete', durationMs: 30 },
        { step: 2, totalSteps: 3, stepName: 'b', status: 'failed', error: 'timeout' },
      ],
      error: 'timeout at step b',
    };

    const report = runner.formatProgressReport(result);
    expect(report).toContain('✗ Macro failed at step 2/3');
    expect(report).toContain('✗ b — failed');
  });
});
