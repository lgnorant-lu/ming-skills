/**
 * Fix 2 [P0] — capture_commands GPU timestamp queries.
 *
 * The hook page-script runs inside the browser; module-level tests verify the
 * installed hook script wires timestamp-query into pass descriptors, resolves
 * queries after submit, and that getGPUCommandTrace attaches per-pass GPU
 * timings. The pure ns conversion helper is tested directly.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  installGPUCommandHook,
  getGPUCommandTrace,
  toNanoseconds,
} from '@modules/webgpu/CommandHook';

function mockPage(returnValue: unknown = undefined): {
  evaluate: ReturnType<typeof vi.fn>;
  evaluateOnNewDocument: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn().mockResolvedValue(returnValue),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

function installScript(page: { evaluate: ReturnType<typeof vi.fn> }): string {
  // evaluate calls: [0] = hookScript (ensureHookState), [1] = install script.
  return String(page.evaluate.mock.calls[1]?.[0] ?? '');
}

describe('CommandHook timestamp queries (Fix 2)', () => {
  it('install script initializes timestamp-query state from the page device', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toContain('timestamp-query');
    expect(script).toContain('createQuerySet');
    expect(script).toContain('timestampPeriod');
  });

  it('pass descriptors get timestampWrites when the feature is available', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toContain('timestampWrites');
    expect(script).toContain('beginningOfPassWriteIndex');
    expect(script).toContain('endOfPassWriteIndex');
  });

  it('submit hook resolves pending queries via onSubmittedWorkDone + mapAsync', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toContain('onSubmittedWorkDone');
    expect(script).toContain('resolveQuerySet');
    expect(script).toContain('mapAsync');
    expect(script).toContain('BigUint64Array');
  });

  it('getGPUCommandTrace waits for in-flight resolution and attaches gpuStartNs/gpuEndNs/gpuElapsedNs', async () => {
    const page = mockPage({
      commands: [{ type: 'render', drawCalls: 1, timestamp: 1.0 }],
      totalSubmissions: 1,
      captureStartTime: 0,
      captureEndTime: 2,
    });
    await getGPUCommandTrace(page as never);

    const script = String(page.evaluate.mock.calls[0]?.[0] ?? '');
    expect(script).toContain('resolving');
    expect(script).toContain('gpuStartNs');
    expect(script).toContain('gpuEndNs');
    expect(script).toContain('gpuElapsedNs');
  });

  it('reports timestamp-query capability metadata on the trace', async () => {
    const page = mockPage({
      commands: [],
      totalSubmissions: 0,
      captureStartTime: 0,
      captureEndTime: 0,
    });
    await getGPUCommandTrace(page as never);
    const script = String(page.evaluate.mock.calls[0]?.[0] ?? '');
    expect(script).toContain('timestampQuery');
  });

  it('toNanoseconds converts GPU ticks to ns via timestampPeriod', () => {
    expect(toNanoseconds(1000, 1)).toBe(1000);
    expect(toNanoseconds(500, 2)).toBe(1000);
    expect(toNanoseconds(0, 4)).toBe(0);
  });
});
