/**
 * CoordinationHandlers — unbounded-state bounds (b5-05).
 *
 * handoffs / insights / snapshots previously grew without limit. These tests
 * drive each collection past its cap and assert the oldest entry is evicted.
 * The caps are read from constants so the loops stay in lockstep with the
 * configured defaults.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoordinationHandlers } from '@server/domains/coordination/index';
import {
  COORDINATION_MAX_HANDOFFS,
  COORDINATION_MAX_INSIGHTS,
  COORDINATION_MAX_SNAPSHOTS,
} from '@src/constants';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

interface HandoffCreateResult {
  taskId: string;
}

interface TaskContextResult {
  completed?: Array<{ taskId?: string }>;
  failed?: Array<{ taskId?: string }>;
  sessionInsights?: Array<{ category?: string }>;
  summary?: { totalCompleted?: number; totalFailed?: number; totalInsights?: number };
}

interface SnapshotListResult {
  total: number;
  snapshots: Array<{ label?: string }>;
}

describe('CoordinationHandlers — bounded state', () => {
  const pageController: { getPage: ReturnType<typeof vi.fn> } = { getPage: vi.fn() };
  let handlers: CoordinationHandlers;

  function makePage(): Record<string, unknown> {
    return {
      url: () => withPath(TEST_URLS.root, 'app'),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ cookies: [] }),
        detach: vi.fn(),
      }),
      evaluate: vi.fn().mockImplementation((arg: unknown) => {
        if (typeof arg === 'string') return Promise.resolve([]);
        return Promise.resolve({});
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // pageController is a minimal mock; the full MCPServerContext shape is not
    // needed by the handler paths under test.
    handlers = new CoordinationHandlers({ pageController } as never);
  });

  it('ring-trims insights to COORDINATION_MAX_INSIGHTS, dropping the oldest', async () => {
    for (let i = 0; i < COORDINATION_MAX_INSIGHTS + 1; i++) {
      await handlers.handleAppendSessionInsight({
        category: `cat-${i}`,
        content: `content-${i}`,
      });
    }

    const context = (await handlers.handleGetTaskContext({})) as unknown as TaskContextResult;

    expect(context.summary?.totalInsights).toBe(COORDINATION_MAX_INSIGHTS);
    const categories = context.sessionInsights?.map((i) => i.category) ?? [];
    expect(categories).not.toContain('cat-0');
    expect(categories).toContain(`cat-${COORDINATION_MAX_INSIGHTS}`);
  });

  it('evicts the oldest completed handoff once the completed cap is reached', async () => {
    let now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now++);
    try {
      const created: string[] = [];
      for (let i = 0; i < COORDINATION_MAX_HANDOFFS + 1; i++) {
        const res = (await handlers.handleCreateTaskHandoff({
          description: `task-${i}`,
        })) as unknown as HandoffCreateResult;
        created.push(res.taskId);
        await handlers.handleCompleteTaskHandoff({ taskId: res.taskId, summary: `done-${i}` });
      }

      const context = (await handlers.handleGetTaskContext({})) as unknown as TaskContextResult;

      expect(context.summary?.totalCompleted).toBe(COORDINATION_MAX_HANDOFFS);
      const ids = context.completed?.map((h) => h.taskId) ?? [];
      expect(ids).not.toContain(created[0]);
      expect(ids).toContain(created[COORDINATION_MAX_HANDOFFS]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('evicts the oldest failed handoff once the terminal cap is reached', async () => {
    let now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now++);
    try {
      const created: string[] = [];
      for (let i = 0; i < COORDINATION_MAX_HANDOFFS + 1; i++) {
        const res = (await handlers.handleCreateTaskHandoff({
          description: `fail-task-${i}`,
        })) as unknown as HandoffCreateResult;
        created.push(res.taskId);
        await handlers.handleUpdateTaskHandoff({ taskId: res.taskId, status: 'failed' });
      }

      const context = (await handlers.handleGetTaskContext({})) as unknown as TaskContextResult;

      expect(context.summary?.totalFailed).toBe(COORDINATION_MAX_HANDOFFS);
      const ids = context.failed?.map((h) => h.taskId) ?? [];
      expect(ids).not.toContain(created[0]);
      expect(ids).toContain(created[COORDINATION_MAX_HANDOFFS]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('evicts the oldest page snapshot once the snapshot cap is reached', async () => {
    let now = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now++);
    pageController.getPage.mockResolvedValue(makePage());
    try {
      for (let i = 0; i < COORDINATION_MAX_SNAPSHOTS + 1; i++) {
        await handlers.handleSavePageSnapshot({ label: `snap-${i}` });
      }

      const list = (await handlers.handleListPageSnapshots()) as unknown as SnapshotListResult;

      expect(list.total).toBe(COORDINATION_MAX_SNAPSHOTS);
      const labels = list.snapshots.map((s) => s.label);
      expect(labels).not.toContain('snap-0');
      expect(labels).toContain(`snap-${COORDINATION_MAX_SNAPSHOTS}`);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
