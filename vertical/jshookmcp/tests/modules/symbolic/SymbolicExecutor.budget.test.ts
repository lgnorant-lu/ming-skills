import { describe, expect, it, vi } from 'vitest';
import { SymbolicExecutor } from '@modules/symbolic/SymbolicExecutor';

vi.mock('@modules/z3/Z3Solver', () => ({
  withZ3: vi.fn(async () => null),
  isZ3Failed: () => false,
}));

describe('SymbolicExecutor constraint-solving budget governance', () => {
  it('allocates per-path Z3 timeout from the remaining budget with a 1s floor', () => {
    const executor = new SymbolicExecutor() as any;
    // No paths: the whole remaining budget is available for the single solve.
    expect(executor.computePerPathTimeout(0, 30_000)).toBe(30_000);
    // 100 paths in 30s → 300ms each, floored to 1s.
    expect(executor.computePerPathTimeout(100, 30_000)).toBe(1_000);
    // 3 paths in 30s → 10s each.
    expect(executor.computePerPathTimeout(3, 30_000)).toBe(10_000);
    // A single path gets the whole remaining budget.
    expect(executor.computePerPathTimeout(1, 2_000)).toBe(2_000);
    // Below the 1s floor → floored to 1s.
    expect(executor.computePerPathTimeout(1, 500)).toBe(1_000);
  });

  it('skips constraint solving entirely when the executor budget is exhausted', async () => {
    const executor = new SymbolicExecutor();
    const result = await executor.execute({
      code: 'let x = 1; if (x) { x = 2; }',
      maxPaths: 5,
      maxDepth: 5,
      timeout: 0,
      enableConstraintSolving: true,
    });
    expect(result.warnings).toContain('Constraint solving skipped:budget');
  });

  it('passes the remaining budget (not the full budget) to the legacy fallback', async () => {
    const executor = new SymbolicExecutor() as any;
    const legacySpy = vi.spyOn(executor, 'solveConstraintsLegacy').mockImplementation(() => {});

    // Simulate the Z3 attempt consuming 500ms of the 3000ms budget: solveStartedAt
    // is read at t=1000, and the (spied) Z3 phase advances the clock to t=1500
    // before reporting failure, so the legacy solver must get the 2500ms remaining.
    let currentTime = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
    const z3Spy = vi.spyOn(executor, 'solveConstraintsZ3').mockImplementation(async () => {
      currentTime = 1_500;
      return false;
    });

    try {
      const paths = [{ id: 'p1', constraints: [], isFeasible: false, states: [], coverage: 0 }];
      await executor.solveConstraints(paths, [], 3_000);

      expect(legacySpy).toHaveBeenCalledTimes(1);
      expect(legacySpy).toHaveBeenCalledWith(paths, [], 2_500);
    } finally {
      nowSpy.mockRestore();
      z3Spy.mockRestore();
      legacySpy.mockRestore();
    }
  });
});
