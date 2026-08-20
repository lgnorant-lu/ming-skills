import { describe, it, expect, beforeEach } from 'vitest';
import {
  V8InspectorHandlers,
  type V8InspectorDomainDependencies,
} from '../../../../src/server/domains/v8-inspector/handlers/impl';
import { ResponseBuilder } from '../../../../src/server/domains/shared/ResponseBuilder';
import { clearSnapshotCache } from '../../../../src/server/domains/v8-inspector/handlers/heap-snapshot';

// In-impl handlers now return a ToolResponse envelope (handleSafe wrap).
// Unwrap the JSON body for assertions.
const parseBody = (res: unknown): Record<string, unknown> =>
  ResponseBuilder.parse<Record<string, unknown>>(
    res as Parameters<typeof ResponseBuilder.parse>[0],
  );

function createMockDeps(
  overrides?: Partial<V8InspectorDomainDependencies>,
): V8InspectorDomainDependencies {
  // @ts-expect-error
  return {
    ctx: {} as import('@server/MCPServer.context').MCPServerContext,
    ...overrides,
  };
}

describe('V8InspectorHandlers', () => {
  beforeEach(() => {
    clearSnapshotCache();
  });

  describe('construction', () => {
    it('should create handler instance with minimal deps', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      expect(handlers).toBeDefined();
    });

    it('should expose expected tool methods', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      expect(typeof handlers.v8_heap_snapshot_capture).toBe('function');
      expect(typeof handlers.v8_heap_snapshot_analyze).toBe('function');
      expect(typeof handlers.v8_heap_diff).toBe('function');
      expect(typeof handlers.v8_object_inspect).toBe('function');
      expect(typeof handlers.v8_heap_stats).toBe('function');
      expect(typeof handlers.v8_heap_snapshot_list).toBe('function');
      expect(typeof handlers.v8_heap_snapshot_delete).toBe('function');
      expect(typeof handlers.v8_heap_snapshot_export).toBe('function');
      expect(typeof handlers.handle).toBe('function');
    });
  });

  describe('handle() routing', () => {
    it('should route to known tool', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      // Should not throw for a known tool name (even if underlying CDP fails).
      // The handler returns a ToolResponse with success:false when the browser
      // is not connected — previously this threw via requirePageController.
      const body = parseBody(await handlers.handle('v8_heap_stats', {}));
      expect(body.success).toBe(false);
    });

    it('should throw for unknown tool', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      await expect(handlers.handle('nonexistent_tool', {})).rejects.toThrow(
        'Unknown v8-inspector tool: nonexistent_tool',
      );
    });
  });

  describe('v8_heap_snapshot_capture', () => {
    it('should fail gracefully without browser connection', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_capture({}));
      expect(body.success).toBe(false);
    });
  });

  describe('v8_heap_snapshot_analyze', () => {
    it('should fail if snapshotId is missing', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_analyze({}));
      expect(body).toMatchObject({
        success: false,
        error: 'Missing required string argument: "snapshotId"',
      });
    });

    it('should fail if snapshot not found', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(
        await handlers.v8_heap_snapshot_analyze({ snapshotId: 'nonexistent' }),
      );
      expect(body).toMatchObject({ success: false, error: 'Snapshot nonexistent not found' });
    });
  });

  describe('v8_heap_diff', () => {
    it('should fail if snapshot IDs are missing', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_diff({}));
      expect(body).toMatchObject({
        success: false,
        error: 'Both beforeSnapshotId and afterSnapshotId are required',
      });
    });

    it('should fail if before snapshot not found', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(
        await handlers.v8_heap_diff({
          beforeSnapshotId: 'missing',
          afterSnapshotId: 'also-missing',
        }),
      );
      expect(body).toMatchObject({ success: false, error: 'Snapshot missing not found' });
    });
  });

  describe('v8_heap_snapshot_list', () => {
    it('returns structured listing with snapshots array and stats', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_list({}));
      expect(body.success).toBe(true);
      expect(Array.isArray((body as any).snapshots)).toBe(true);
      // snapshots count depends on other test artifacts on disk; structure is the invariant.
      expect(typeof (body as any).count).toBe('number');
      expect(typeof (body as any).totalBytes).toBe('number');
    });

    it('respects includeExpired option', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_list({ includeExpired: true }));
      expect(body.success).toBe(true);
    });
  });

  describe('v8_heap_snapshot_delete', () => {
    it('requires snapshotId when deleteAll is not set', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_delete({}));
      expect(body).toMatchObject({
        success: false,
        error: 'Missing required string argument: "snapshotId"',
      });
    });

    it('handles deleteAll=true without snapshotId', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_delete({ deleteAll: true }));
      expect(body.success).toBe(true);
      expect((body as any).deleteAll).toBe(true);
      // deletedCount may be non-zero if snapshot-persistence tests left disk artifacts.
      expect(typeof (body as any).deletedCount).toBe('number');
    });
  });

  describe('v8_heap_snapshot_export', () => {
    it('requires snapshotId', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_export({}));
      expect(body).toMatchObject({
        success: false,
        error: 'Missing required string argument: "snapshotId"',
      });
    });

    it('fails if snapshot not found', async () => {
      const handlers = new V8InspectorHandlers(createMockDeps());
      const body = parseBody(await handlers.v8_heap_snapshot_export({ snapshotId: 'nonexistent' }));
      expect(body.success).toBe(false);
      expect(String((body as any).error)).toMatch(/not found/);
    });
  });
});
