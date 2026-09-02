/**
 * Fix 5 [P2] — draw wrapper vertex/instance statistics.
 *
 * The page-script hook runs inside the browser, so module-level tests verify
 * the installed hook script contains the draw-argument capture logic, and the
 * handler-level trace passthrough is covered in
 * tests/server/domains/webgpu/webgpu-capture-commands.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';
import { installGPUCommandHook } from '@modules/webgpu/CommandHook';

function mockPage(): {
  evaluate: ReturnType<typeof vi.fn>;
  evaluateOnNewDocument: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

function installScript(page: { evaluate: ReturnType<typeof vi.fn> }): string {
  // evaluate calls: [0] = hookScript (ensureHookState), [1] = install script.
  return String(page.evaluate.mock.calls[1]?.[0] ?? '');
}

describe('CommandHook draw statistics (Fix 5)', () => {
  it('draw wrapper captures vertexCount from draw/drawIndexed args', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // draw(count) / drawIndexed(count) → vertexCount = args[0], instanceCount = args[1] ?? 1
    expect(script).toContain('vertexCount');
    expect(script).toContain('instanceCount');
    expect(script).toMatch(/draw.*drawIndexed/);
  });

  it('indirect draws are flagged with best-effort indirect buffer size', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // drawIndirect/drawIndexedIndirect → indirect:true, size read from buffer (best effort)
    expect(script).toContain('drawIndirect');
    expect(script).toContain('indirect');
    expect(script).toContain('indirectBufferSize');
  });

  it('aggregates totalVertexCount across draws in a pass', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toContain('totalVertexCount');
  });

  it('emits the stats fields on the captured render command', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // The end() push must carry the draw statistics.
    expect(script).toMatch(/commands\.push/);
    expect(script).toMatch(/vertexCount:\s*lastVertexCount/);
    expect(script).toMatch(/instanceCount:\s*lastInstanceCount/);
    expect(script).toMatch(/indirect:\s*lastIndirect/);
  });
});
