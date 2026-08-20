import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetZ3ForTests,
  getZ3Api,
  isZ3Enabled,
  isZ3Failed,
  isZ3Ready,
  withZ3,
} from '@modules/z3/Z3Solver';

// Real Z3 WASM integration tests are gated behind Z3_TEST_REAL=1 because
// they load the WASM module (slow, ~150ms) and require SharedArrayBuffer.
// CI runs the pure-logic / fallback tests by default.
const realZ3 = process.env.Z3_TEST_REAL === '1';

describe('Z3Solver', () => {
  beforeEach(() => {
    resetZ3ForTests();
  });

  afterEach(() => {
    resetZ3ForTests();
    vi.restoreAllMocks();
  });

  describe('config flags', () => {
    it('isZ3Enabled reflects the Z3_ENABLED constant', () => {
      expect(typeof isZ3Enabled()).toBe('boolean');
    });

    it('isZ3Ready is false before init', () => {
      expect(isZ3Ready()).toBe(false);
    });

    it('isZ3Failed is false before init', () => {
      expect(isZ3Failed()).toBe(false);
    });
  });

  describe('getZ3Api', () => {
    it('returns null when Z3 is disabled', async () => {
      vi.doMock('@src/constants', () => ({
        Z3_ENABLED: false,
        Z3_INIT_TIMEOUT_MS: 5000,
        Z3_SOLVE_TIMEOUT_MS: 10000,
        Z3_BMC_MAX_GADGETS: 12,
      }));
      vi.resetModules();
      const { getZ3Api: freshGet, resetZ3ForTests: freshReset } =
        await import('@modules/z3/Z3Solver');
      freshReset();
      const api = await freshGet();
      expect(api).toBeNull();
      vi.doUnmock('@src/constants');
      vi.resetModules();
    });

    it.runIf(realZ3)(
      'returns the Z3 API surface on first successful init (real WASM)',
      async () => {
        const api = await getZ3Api();
        expect(api).not.toBeNull();
        expect(api).toHaveProperty('Context');
        expect(isZ3Ready()).toBe(true);
        expect(isZ3Failed()).toBe(false);
      },
    );

    it.runIf(realZ3)('caches the init promise across concurrent callers (real WASM)', async () => {
      const p1 = getZ3Api();
      const p2 = getZ3Api();
      const [a1, a2] = await Promise.all([p1, p2]);
      expect(a1).toBe(a2);
    });

    it('caches init failure and returns null on subsequent calls', async () => {
      // Mock the z3-solver init to throw once; verify failure is sticky.
      vi.doMock('z3-solver', () => ({
        init: vi.fn().mockRejectedValue(new Error('boom: WASM missing')),
      }));
      vi.resetModules();
      const {
        getZ3Api: freshGet,
        isZ3Failed: freshFailed,
        resetZ3ForTests: freshReset,
      } = await import('@modules/z3/Z3Solver');
      freshReset();

      const first = await freshGet();
      expect(first).toBeNull();
      expect(freshFailed()).toBe(true);

      // Second call must not re-attempt init.
      const second = await freshGet();
      expect(second).toBeNull();

      vi.doUnmock('z3-solver');
      vi.resetModules();
    });
  });

  describe('withZ3', () => {
    it.runIf(realZ3)(
      'runs the callback with the Z3 API and returns its result (real WASM)',
      async () => {
        const result = await withZ3(async (api) => {
          const { Solver, Int, And } = new api.Context('main');
          const x = Int.const('x');
          const solver = new Solver();
          solver.set('timeout', 5000);
          solver.add(And(x.ge(0), x.le(9)));
          const res = await solver.check();
          if (res !== 'sat') return null;
          return solver.model().get(x)?.toString() ?? null;
        });
        // Z3 picks a value in [0,9]; just assert it's a valid integer string.
        expect(result).not.toBeNull();
        const n = Number(result);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(9);
      },
    );

    it('returns null when Z3 is unavailable (init failed)', async () => {
      vi.doMock('z3-solver', () => ({
        init: vi.fn().mockRejectedValue(new Error('no wasm')),
      }));
      vi.resetModules();
      const { withZ3: freshWith, resetZ3ForTests: freshReset } =
        await import('@modules/z3/Z3Solver');
      freshReset();

      const cb = vi.fn();
      const result = await freshWith(cb, 1000);
      expect(result).toBeNull();
      expect(cb).not.toHaveBeenCalled();

      vi.doUnmock('z3-solver');
      vi.resetModules();
    });

    it('returns null when the callback rejects', async () => {
      vi.doMock('z3-solver', () => ({
        init: vi.fn().mockResolvedValue({ Context: function () {} }),
      }));
      vi.resetModules();
      const { withZ3: freshWith, resetZ3ForTests: freshReset } =
        await import('@modules/z3/Z3Solver');
      freshReset();

      const result = await freshWith(async () => {
        throw new Error('callback boom');
      }, 5000);
      expect(result).toBeNull();

      vi.doUnmock('z3-solver');
      vi.resetModules();
    });

    it.runIf(realZ3)('serializes concurrent callbacks via the mutex (real WASM)', async () => {
      // Two concurrent withZ3 calls: the second must start after the first
      // releases. We detect serialization by having call A hold a flag while
      // running and call B assert the flag was already cleared.
      let aRunning = false;
      let overlap = false;

      const makeCall = (label: string) =>
        withZ3(async () => {
          if (label === 'B' && aRunning) overlap = true;
          if (label === 'A') {
            aRunning = true;
            await new Promise((r) => setTimeout(r, 50));
            aRunning = false;
          } else {
            await new Promise((r) => setTimeout(r, 10));
          }
          return label;
        });

      const [r1, r2] = await Promise.all([makeCall('A'), makeCall('B')]);
      expect(r1).toBe('A');
      expect(r2).toBe('B');
      expect(overlap).toBe(false);
    });
  });
});
