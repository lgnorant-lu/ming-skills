import { describe, expect, it } from 'vitest';
import { workflowToolDefinitions } from '@server/domains/workflow/definitions';

interface ToolInputSchema {
  properties?: Record<string, { description?: string }>;
}

function toolDef(name: string) {
  const def = workflowToolDefinitions.find((tool) => tool.name === name);
  if (!def) throw new Error(`missing workflow tool definition: ${name}`);
  return def;
}

function propertyDescription(name: string, property: string): string {
  const schema = toolDef(name).inputSchema as unknown as ToolInputSchema;
  return schema.properties?.[property]?.description ?? '';
}

// Locks the description/implementation sync fixes from 9877d86a: tool
// descriptions must reflect what the handlers actually do, not what they
// used to do before the bounded WorkflowRunStore removed prior-run output.
describe('workflow tool definitions — description/implementation sync', () => {
  it('workflow_run_inspect.lastSuccess describes a summary, not a full result', () => {
    const desc = toolDef('workflow_run_inspect').description ?? '';
    expect(desc).not.toContain('stepResults, spans, metrics');
    expect(desc).toContain('summary');
    expect(desc).toContain('stepResultKeys');
  });

  it('workflow_conditional_step does not promise prior-run stepResults resolution', () => {
    const desc = toolDef('workflow_conditional_step').description ?? '';
    expect(desc).not.toContain('last successful');
    expect(desc).not.toContain('reads from');
  });

  it('workflow_conditional_step.stepResults describes an args-only empty-set fallback', () => {
    const stepResults = propertyDescription('workflow_conditional_step', 'stepResults');
    expect(stepResults).not.toContain('last successful workflow run');
    expect(stepResults).toContain('empty');
  });

  it('workflow_conditional_step.workflowId is marked deprecated (no longer resolves stepResults)', () => {
    const workflowId = propertyDescription('workflow_conditional_step', 'workflowId');
    expect(workflowId).toContain('Deprecated');
    expect(workflowId).not.toContain('look up the last successful run');
  });
});
