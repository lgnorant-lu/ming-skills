import { describe, expect, it } from 'vitest';
import { WorkflowRunStore } from '@server/workflows/WorkflowRunStore';
import type { ExecuteWorkflowResult } from '@server/workflows/WorkflowEngine.types';

function makeResult(workflowId: string, runId: string, stepKeys: string[]): ExecuteWorkflowResult {
  return {
    workflowId,
    displayName: workflowId,
    runId,
    profile: 'workflow',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    result: { ok: true },
    stepResults: Object.fromEntries(stepKeys.map((key) => [key, { payload: `output-${key}` }])),
    metrics: [],
    spans: [],
  };
}

describe('WorkflowRunStore bounded retention', () => {
  describe('runs cap', () => {
    it('caps retained runs and evicts the oldest entry', () => {
      const store = new WorkflowRunStore(3);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `run-${i}`, ['s1']));
      }
      expect(store.listRuns()).toHaveLength(3);
      expect(store.getRun('run-0')).toBeUndefined();
      expect(store.getRun('run-1')).toBeUndefined();
      expect(store.getRun('run-2')).toBeDefined();
      expect(store.getRun('run-4')).toBeDefined();
    });

    it('also evicts the oldest entry on error runs', () => {
      const store = new WorkflowRunStore(2);
      store.recordError('wf', 'run-0', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordError('wf', 'run-1', '2026-01-01T00:00:00.000Z', new Error('boom'));
      store.recordError('wf', 'run-2', '2026-01-01T00:00:00.000Z', new Error('boom'));
      expect(store.listRuns()).toHaveLength(2);
      expect(store.getRun('run-0')).toBeUndefined();
      expect(store.getRun('run-2')).toBeDefined();
    });
  });

  describe('listRuns pagination', () => {
    it('supports limit and offset with defaults that keep old behavior', () => {
      const store = new WorkflowRunStore(10);
      for (let i = 0; i < 5; i += 1) {
        store.recordSuccess(makeResult('wf', `run-${i}`, ['s1']));
      }
      expect(store.listRuns()).toHaveLength(5);
      expect(store.listRuns(undefined, { limit: 2 })).toHaveLength(2);
      const page = store.listRuns(undefined, { offset: 1, limit: 2 });
      expect(page.map((entry) => entry.runId)).toEqual(['run-1', 'run-2']);
    });
  });

  describe('lastSuccess summary', () => {
    it('retains only step-result keys, not the raw step outputs', () => {
      const store = new WorkflowRunStore(10);
      store.recordSuccess(makeResult('wf', 'run-0', ['alpha', 'beta']));
      const last = store.getLastSuccess('wf');
      expect(last).toBeDefined();
      expect(last!.status).toBe('success');
      expect(last!.stepResultKeys).toEqual(['alpha', 'beta']);
      expect(last).not.toHaveProperty('stepResults');
    });
  });
});
