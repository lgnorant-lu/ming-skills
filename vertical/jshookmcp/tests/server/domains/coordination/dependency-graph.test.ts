import { describe, it, expect, beforeEach } from 'vitest';
import type { MCPServerContext } from '@server/domains/shared/registry';
import { CoordinationHandlers } from '@server/domains/coordination';

function makeHandlers(): CoordinationHandlers {
  return new CoordinationHandlers({
    eventBus: { emit: () => {} },
  } as unknown as MCPServerContext);
}

function taskId(result: unknown): string {
  return (result as { taskId: string }).taskId;
}

describe('coordination task dependency graph', () => {
  let handlers: CoordinationHandlers;

  beforeEach(() => {
    handlers = makeHandlers();
  });

  it('creates a handoff with parentId and dependsOn', async () => {
    const parent = await handlers.handleCreateTaskHandoff({ description: 'parent task' });
    const pid = taskId(parent);

    const child = (await handlers.handleCreateTaskHandoff({
      description: 'child task',
      parentId: pid,
      dependsOn: [pid],
    })) as Record<string, unknown>;

    expect(child['parentId']).toBe(pid);
    expect(child['dependsOn']).toEqual([pid]);
    expect(child['dependencyWarnings']).toBeUndefined();
  });

  it('warns (non-fatal) on unknown dependency references', async () => {
    const result = (await handlers.handleCreateTaskHandoff({
      description: 'orphan deps',
      parentId: 'nope1',
      dependsOn: ['nope2'],
    })) as Record<string, unknown>;

    expect(result['parentId']).toBe('nope1');
    expect(result['dependencyWarnings']).toEqual([
      'parentId "nope1" does not match a known task',
      'dependsOn "nope2" does not match a known task',
    ]);
  });

  it('exposes a dependency graph (parent + depends-on edges) in get_task_context', async () => {
    const a = await handlers.handleCreateTaskHandoff({ description: 'A' });
    const b = await handlers.handleCreateTaskHandoff({
      description: 'B',
      parentId: taskId(a),
    });
    const c = await handlers.handleCreateTaskHandoff({
      description: 'C',
      dependsOn: [taskId(a)],
    });

    const ctx = (await handlers.handleGetTaskContext({})) as Record<string, unknown>;
    const graph = ctx['dependencyGraph'] as {
      nodes: Array<{ taskId: string }>;
      edges: Array<{ from: string; to: string; type: string }>;
    };

    expect(graph.nodes).toHaveLength(3);
    const parentEdge = graph.edges.find((e) => e.type === 'parent');
    const depEdge = graph.edges.find((e) => e.type === 'depends-on');
    expect(parentEdge).toMatchObject({ from: taskId(a), to: taskId(b) });
    expect(depEdge).toMatchObject({ from: taskId(a), to: taskId(c) });
  });

  it('returns an empty dependency graph when no handoffs have edges', async () => {
    await handlers.handleCreateTaskHandoff({ description: 'lonely' });
    const ctx = (await handlers.handleGetTaskContext({})) as Record<string, unknown>;
    const graph = ctx['dependencyGraph'] as { nodes: unknown[]; edges: unknown[] };
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
  });
});
