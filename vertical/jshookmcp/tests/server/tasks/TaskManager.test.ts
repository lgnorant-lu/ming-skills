import { describe, expect, it } from 'vitest';
import { TaskManager } from '@server/tasks/TaskManager';

describe('TaskManager (MCP 2.0 Tasks Protocol)', () => {
  it('should create and execute a background task successfully', async () => {
    const manager = new TaskManager();
    const task = await manager.createTask({
      name: 'test_async_scan',
      executor: async (ctx) => {
        ctx.updateProgress(50, 100, 'scanning memory');
        return { matched: 42 };
      },
    });

    expect(task.taskId).toBeDefined();
    expect(task.name).toBe('test_async_scan');

    // Wait a tick for async completion
    await new Promise((r) => setTimeout(r, 20));

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('completed');
    expect(record?.result).toEqual({ matched: 42 });
    expect(record?.progress).toBe(100);

    const payload = manager.getTaskPayload(task.taskId);
    expect(payload?.status).toBe('completed');
    expect(payload?.result).toEqual({ matched: 42 });
  });

  it('should handle task errors gracefully', async () => {
    const manager = new TaskManager();
    const task = await manager.createTask({
      name: 'failing_task',
      executor: async () => {
        throw new Error('Process terminated unexpectedly');
      },
    });

    await new Promise((r) => setTimeout(r, 20));

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toContain('Process terminated unexpectedly');
  });

  it('should support task cancellation with cleanup handler', async () => {
    const manager = new TaskManager();
    let cleanedUp = false;

    const task = await manager.createTask({
      name: 'cancellable_task',
      executor: async (ctx) => {
        await new Promise((r) => setTimeout(r, 100));
        if (ctx.isCancelled()) return null;
        return 'done';
      },
      cancelHandler: () => {
        cleanedUp = true;
      },
    });

    expect(task.status).toBe('working');
    const cancelled = await manager.cancelTask(task.taskId);
    expect(cancelled).toBe(true);
    expect(cleanedUp).toBe(true);

    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('cancelled');
  });

  it('should list tasks and prune based on TTL', async () => {
    const manager = new TaskManager({ defaultTtlMs: 50 });
    const task = await manager.createTask({
      name: 'quick_task',
      executor: async () => 'ok',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(manager.listTasks().length).toBeGreaterThan(0);

    // Wait for TTL expiry
    await new Promise((r) => setTimeout(r, 60));
    // Trigger prune
    const list = manager.listTasks();
    expect(list.find((t) => t.taskId === task.taskId)).toBeUndefined();
  });

  it('resolves the completion/cancel race in whichever order transitions land', async () => {
    const manager = new TaskManager();

    // complete-then-cancel: cancellation of a finished task is refused.
    const done = await manager.createTask({ name: 'done', executor: async () => 'ok' });
    await new Promise((r) => setTimeout(r, 10));
    await expect(manager.cancelTask(done.taskId)).resolves.toBe(false);
    expect(manager.getTask(done.taskId)?.status).toBe('completed');

    // cancel-then-complete: the late executor result is discarded.
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const cancelled = await manager.createTask({
      name: 'cancelled',
      executor: async () => {
        await gate;
        return 'late';
      },
    });
    await manager.cancelTask(cancelled.taskId);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(manager.getTask(cancelled.taskId)?.status).toBe('cancelled');
    expect(manager.getTask(cancelled.taskId)?.result).toBeUndefined();
  });

  it('hard-ceiling evicts only terminal tasks, never working ones', async () => {
    const manager = new TaskManager({ maxTasks: 5 });
    for (let i = 0; i < 5; i++) {
      await manager.createTask({ name: `t${i}`, executor: async () => i });
    }
    const stuck = await manager.createTask({
      name: 'stuck',
      executor: () => new Promise(() => undefined), // never settles
    });

    manager.listTasks(); // triggers prune
    expect(manager.getTask(stuck.taskId)).toBeDefined();
    expect(manager.listTasks().filter((t) => t.status === 'working')).toHaveLength(1);
  });

  it('propagates cancelHandler throws without corrupting the state machine', async () => {
    const manager = new TaskManager();
    const task = await manager.createTask({
      name: 'boom_cancel',
      executor: () => new Promise(() => undefined),
      cancelHandler: () => {
        throw new Error('cleanup exploded');
      },
    });

    await expect(manager.cancelTask(task.taskId)).resolves.toBe(true);
    expect(manager.getTask(task.taskId)?.status).toBe('cancelled');
  });

  it('fails working tasks that exceed maxWorkingAgeMs', async () => {
    const manager = new TaskManager({ maxWorkingAgeMs: 10 });
    const task = await manager.createTask({
      name: 'hung',
      executor: () => new Promise(() => undefined),
    });

    // maxWorkingAgeMs is enforced on the next prune pass.
    await new Promise((r) => setTimeout(r, 30));
    manager.listTasks();
    const record = manager.getTask(task.taskId);
    expect(record?.status).toBe('failed');
    expect(record?.error).toContain('maxWorkingAgeMs');
  });

  it('aborts the execution-context signal on cancellation', async () => {
    const manager = new TaskManager();
    let observed: AbortSignal | undefined;
    const task = await manager.createTask({
      name: 'cancellable_scan',
      executor: async (ctx) => {
        observed = ctx.signal;
        await new Promise((r) => setTimeout(r, 200));
        return 'done';
      },
    });

    expect(observed?.aborted).toBe(false);
    await manager.cancelTask(task.taskId);
    expect(observed?.aborted).toBe(true);
  });

  it('hides tasks from callers of a different owning session', async () => {
    const { runWithToolRequestContext } = await import('@server/runtime/ToolRequestContext');
    const manager = new TaskManager();

    const owned = await runWithToolRequestContext({ sessionId: 'session-a' }, () =>
      manager.createTask({ name: 'owned', executor: async () => 1 }),
    );
    // Created outside any request context — process-level, visible to all.
    const unowned = await manager.createTask({ name: 'unowned', executor: async () => 2 });

    // Owner sees it; a foreign session does not.
    expect(manager.getTask(owned.taskId, 'session-a')?.taskId).toBe(owned.taskId);
    expect(manager.getTask(owned.taskId, 'session-b')).toBeUndefined();
    expect(manager.getTask(owned.taskId)?.taskId).toBe(owned.taskId); // internal caller

    // listTasks scopes to the caller session (plus process-level tasks).
    const seenByB = manager.listTasks('session-b').map((t) => t.taskId);
    expect(seenByB).toContain(unowned.taskId);
    expect(seenByB).not.toContain(owned.taskId);

    // Foreign callers cannot cancel or read payloads either.
    await expect(manager.cancelTask(owned.taskId, 'session-b')).resolves.toBe(false);
    expect(manager.getTaskPayload(owned.taskId, 'session-b')).toBeNull();
    expect(manager.getTaskPayload(owned.taskId, 'session-a')?.status).toBe('completed');
  });
});
