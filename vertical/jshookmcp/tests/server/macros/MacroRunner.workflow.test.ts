import { describe, expect, it, vi } from 'vitest';
import { MacroRunner } from '@server/macros/MacroRunner';
import type { MacroDefinition } from '@server/macros/types';

function successResponse(payload: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }) }],
  };
}

function failureResponse(error = 'failed') {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error }) }],
  };
}

function mockContext(executeToolWithTracking: ReturnType<typeof vi.fn>) {
  return {
    baseTier: 'workflow',
    config: {},
    executeToolWithTracking,
  } as any;
}

describe('MacroRunner workflow integration', () => {
  it('continues after optional step failures', async () => {
    const executeToolWithTracking = vi.fn(async (name: string) => {
      if (name === 'unstable_tool') {
        return failureResponse('optional failure');
      }
      return successResponse({ name });
    });
    const runner = new MacroRunner(mockContext(executeToolWithTracking));
    const def: MacroDefinition = {
      id: 'optional_macro',
      displayName: 'Optional Macro',
      description: 'Optional step should not stop the macro',
      tags: [],
      steps: [
        { id: 'maybe', toolName: 'unstable_tool', optional: true },
        { id: 'after', toolName: 'stable_tool' },
      ],
    };

    const result = await runner.execute(def);

    expect(result.ok).toBe(true);
    expect(result.stepsCompleted).toBe(1);
    expect(result.progress.map((step) => step.status)).toEqual(['skipped', 'complete']);
    expect(result.stepResults).not.toHaveProperty('maybe');
    expect(result.stepResults).toHaveProperty('after');
    expect(executeToolWithTracking).toHaveBeenCalledWith('stable_tool', {});
  });

  it('executes nested parallel, branch, and retry macro steps', async () => {
    let flakyAttempts = 0;
    const executeToolWithTracking = vi.fn(async (name: string) => {
      if (name === 'seed_tool') {
        return successResponse({ route: 'fast' });
      }
      if (name === 'flaky_tool') {
        flakyAttempts += 1;
        return flakyAttempts === 1
          ? failureResponse('retry me')
          : successResponse({ attempt: flakyAttempts });
      }
      return successResponse({ name });
    });
    const runner = new MacroRunner(mockContext(executeToolWithTracking));
    const def: MacroDefinition = {
      id: 'rich_macro',
      displayName: 'Rich Macro',
      description: 'Uses non-linear orchestration',
      tags: ['workflow'],
      steps: [
        { id: 'seed', toolName: 'seed_tool' },
        {
          id: 'fanout',
          parallelSteps: [
            { id: 'probe_a', toolName: 'probe_a_tool' },
            { id: 'probe_b', toolName: 'probe_b_tool' },
          ],
          maxConcurrency: 2,
          failFast: true,
        },
        {
          id: 'route',
          branchStep: {
            predicateId: 'variable_equals_seed.route_fast',
            whenTrue: { id: 'fast_path', toolName: 'fast_tool' },
            whenFalse: { id: 'slow_path', toolName: 'slow_tool' },
          },
        },
        {
          id: 'flaky',
          toolName: 'flaky_tool',
          retry: { maxAttempts: 2, backoffMs: 0, multiplier: 1 },
        },
      ],
    };

    const result = await runner.execute(def);

    expect(result.ok).toBe(true);
    expect(result.stepsCompleted).toBe(4);
    expect(result.progress.every((step) => step.status === 'complete')).toBe(true);
    expect(result.stepResults).toHaveProperty('fanout');
    expect(result.stepResults).toHaveProperty('fast_path');
    expect(result.stepResults).not.toHaveProperty('slow_path');
    expect(flakyAttempts).toBe(2);
    expect(executeToolWithTracking).toHaveBeenCalledWith('fast_tool', {});
  });
});
