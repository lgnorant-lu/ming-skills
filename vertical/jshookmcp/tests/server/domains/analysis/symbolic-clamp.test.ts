/**
 * b4-03: user-supplied CPU budgets for symbolic execution must be clamped to
 * server-side caps. Clamped responses carry `clamped: true`; values at or
 * under the caps pass through unchanged without the marker.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYMBOLIC_CLAMP_MAX_DEPTH,
  SYMBOLIC_CLAMP_MAX_PATHS,
  SYMBOLIC_CLAMP_MAX_STEPS,
  SYMBOLIC_CLAMP_TIMEOUT_MS,
} from '@src/constants';

const mockExecute = vi.fn();
const mockExecuteJsvmp = vi.fn();

vi.mock('@modules/symbolic/SymbolicExecutor', () => ({
  SymbolicExecutor: class {
    execute = (...args: unknown[]) => mockExecute(...args);
  },
}));

vi.mock('@modules/symbolic/JSVMPSymbolicExecutor', () => ({
  JSVMPSymbolicExecutor: class {
    executeJSVMP = (...args: unknown[]) => mockExecuteJsvmp(...args);
  },
}));

import {
  handleJsSymbolicExecute,
  handleJsSymbolicExecuteJsvmp,
} from '@server/domains/analysis/handlers/symbolic';

function body(r: unknown): Record<string, unknown> {
  const resp = r as unknown as { content?: Array<{ text?: string }> };
  return JSON.parse(resp.content?.[0]?.text ?? '{}');
}

beforeEach(() => {
  mockExecute.mockReset();
  mockExecuteJsvmp.mockReset();
  mockExecute.mockResolvedValue({ paths: [], pathCount: 0 });
  mockExecuteJsvmp.mockResolvedValue({ steps: [], opcodes: [] });
});

describe('handleJsSymbolicExecute budget clamping', () => {
  it('clamps maxPaths to SYMBOLIC_CLAMP_MAX_PATHS and marks clamped', async () => {
    const r = await handleJsSymbolicExecute({ code: 'f()', maxPaths: 1000 } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ maxPaths: SYMBOLIC_CLAMP_MAX_PATHS }),
    );
    expect(body(r).clamped).toBe(true);
  });

  it('clamps maxDepth to SYMBOLIC_CLAMP_MAX_DEPTH and marks clamped', async () => {
    const r = await handleJsSymbolicExecute({ code: 'f()', maxDepth: 500 } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: SYMBOLIC_CLAMP_MAX_DEPTH }),
    );
    expect(body(r).clamped).toBe(true);
  });

  it('clamps timeout to SYMBOLIC_CLAMP_TIMEOUT_MS and marks clamped', async () => {
    const r = await handleJsSymbolicExecute({ code: 'f()', timeout: 120_000 } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SYMBOLIC_CLAMP_TIMEOUT_MS }),
    );
    expect(body(r).clamped).toBe(true);
  });

  it('marks clamped once when several budgets exceed their caps', async () => {
    const r = await handleJsSymbolicExecute({
      code: 'f()',
      maxPaths: 9999,
      maxDepth: 9999,
      timeout: 999_999,
    } as never);
    const opts = mockExecute.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.maxPaths).toBe(SYMBOLIC_CLAMP_MAX_PATHS);
    expect(opts.maxDepth).toBe(SYMBOLIC_CLAMP_MAX_DEPTH);
    expect(opts.timeout).toBe(SYMBOLIC_CLAMP_TIMEOUT_MS);
    expect(body(r).clamped).toBe(true);
  });

  it('passes budgets under the caps through without the clamped marker', async () => {
    const r = await handleJsSymbolicExecute({
      code: 'f()',
      maxPaths: 50,
      maxDepth: 10,
      timeout: 30_000,
    } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ maxPaths: 50, maxDepth: 10, timeout: 30_000 }),
    );
    expect(body(r).clamped).toBeUndefined();
  });

  it('omits budgets entirely when not supplied and never marks clamped', async () => {
    const r = await handleJsSymbolicExecute({ code: 'f()' } as never);
    const opts = mockExecute.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('maxPaths');
    expect(opts).not.toHaveProperty('maxDepth');
    expect(opts).not.toHaveProperty('timeout');
    expect(body(r).clamped).toBeUndefined();
  });
});

describe('handleJsSymbolicExecuteJsvmp budget clamping', () => {
  const instructions = [{ op: 'PUSH', args: [1] }];

  it('clamps maxSteps to SYMBOLIC_CLAMP_MAX_STEPS and marks clamped', async () => {
    const r = await handleJsSymbolicExecuteJsvmp({
      instructions,
      maxSteps: 50_000,
    } as never);
    expect(mockExecuteJsvmp).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: SYMBOLIC_CLAMP_MAX_STEPS }),
    );
    expect(body(r).clamped).toBe(true);
  });

  it('clamps timeout to SYMBOLIC_CLAMP_TIMEOUT_MS and marks clamped', async () => {
    const r = await handleJsSymbolicExecuteJsvmp({
      instructions,
      timeout: 120_000,
    } as never);
    expect(mockExecuteJsvmp).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: SYMBOLIC_CLAMP_TIMEOUT_MS }),
    );
    expect(body(r).clamped).toBe(true);
  });

  it('passes budgets under the caps through without the clamped marker', async () => {
    const r = await handleJsSymbolicExecuteJsvmp({
      instructions,
      maxSteps: 500,
      timeout: 10_000,
    } as never);
    expect(mockExecuteJsvmp).toHaveBeenCalledWith(
      expect.objectContaining({ maxSteps: 500, timeout: 10_000 }),
    );
    expect(body(r).clamped).toBeUndefined();
  });
});
