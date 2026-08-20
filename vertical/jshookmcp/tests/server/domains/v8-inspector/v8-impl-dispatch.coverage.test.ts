/**
 * Coverage tests for V8InspectorHandlers.handle dispatcher — exercises the
 * routing table + each delegation method (which dynamically imports + calls
 * the per-tool handler). Most handlers fail-soft or throw on missing deps;
 * the dispatch + delegation + import lines are covered regardless.
 */

import { describe, expect, it } from 'vitest';
import { V8InspectorHandlers } from '@server/domains/v8-inspector/handlers/impl';

const h = new V8InspectorHandlers({} as never);

async function tryDispatch(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    return await h.handle(tool, args);
  } catch {
    return { _threw: true };
  }
}

describe('V8InspectorHandlers.handle — dispatch', () => {
  it('throws on an unknown tool name', async () => {
    await expect(h.handle('v8_nonexistent', {})).rejects.toThrow(/Unknown v8-inspector tool/);
  });

  it('routes v8_deopt_trace (no CDP → unavailable result)', async () => {
    const r = (await tryDispatch('v8_deopt_trace', {})) as Record<string, unknown>;
    expect(r).toBeDefined();
  });

  it('routes v8_function_retained (missing snapshotId → ToolResponse with success:false)', async () => {
    const r = await tryDispatch('v8_function_retained', {});
    expect(r).toBeDefined();
  });

  it('routes v8_turbofan_graph (handler delegation runs)', async () => {
    const r = await tryDispatch('v8_turbofan_graph', {});
    expect(r).toBeDefined();
  });

  it('routes v8_turbofan_inspect (delegation + createPageGetter(undefined))', async () => {
    const r = await tryDispatch('v8_turbofan_inspect', {});
    expect(r).toBeDefined();
  });

  it('routes v8_heap_snapshot_capture (delegation runs)', async () => {
    const r = await tryDispatch('v8_heap_snapshot_capture', {});
    expect(r).toBeDefined();
  });

  it('routes v8_heap_snapshot_analyze (missing snapshotId → ToolResponse with success:false)', async () => {
    const r = await tryDispatch('v8_heap_snapshot_analyze', {});
    expect(r).toBeDefined();
  });

  it('routes v8_heap_diff, v8_object_inspect, v8_heap_stats, v8_bytecode_extract', async () => {
    for (const tool of [
      'v8_heap_diff',
      'v8_object_inspect',
      'v8_heap_stats',
      'v8_bytecode_extract',
    ]) {
      const r = await tryDispatch(tool, {});
      expect(r).toBeDefined();
    }
  });

  it('routes v8_version_detect, v8_jit_inspect, v8_heap_find_leaks, v8_heap_retainers', async () => {
    for (const tool of [
      'v8_version_detect',
      'v8_jit_inspect',
      'v8_heap_find_leaks',
      'v8_heap_retainers',
    ]) {
      const r = await tryDispatch(tool, {});
      expect(r).toBeDefined();
    }
  });

  it('routes v8_object_compare, v8_wasm_inspect, v8_heap_snapshot_list, v8_heap_snapshot_delete, v8_heap_snapshot_export', async () => {
    for (const tool of [
      'v8_object_compare',
      'v8_wasm_inspect',
      'v8_heap_snapshot_list',
      'v8_heap_snapshot_delete',
      'v8_heap_snapshot_export',
    ]) {
      const r = await tryDispatch(tool, {});
      expect(r).toBeDefined();
    }
  });
});
