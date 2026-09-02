import { describe, it, expect, vi } from 'vitest';
import {
  createChaosWalker,
  createChaosRegionIterator,
  generateDummyPids,
  isChaosModeEnabled,
  getChaosConfigFromEnv,
  DEFAULT_CHAOS_CONFIG,
} from '@src/native/syscall/ChaosScanner';

describe('ChaosScanner', () => {
  describe('createChaosWalker', () => {
    it('creates a walker with default config', () => {
      const walker = createChaosWalker();
      expect(walker).toBeDefined();
      expect(walker.address).toBe(0n);
      expect(walker.maxAddress).toBe(0x7fffffffffffn);
      expect(walker.direction).toBe('forward');
      expect(walker.chunkSize).toBeGreaterThanOrEqual(DEFAULT_CHAOS_CONFIG.minChunkBytes);
      expect(walker.chunkSize).toBeLessThanOrEqual(DEFAULT_CHAOS_CONFIG.maxChunkBytes);
    });

    it('creates a walker with custom config', () => {
      const walker = createChaosWalker({
        minChunkBytes: 8192,
        maxChunkBytes: 65536,
        backwardReadProbability: 0.5,
        minThinkPauseMs: 100,
        maxThinkPauseMs: 1000,
      });

      expect(walker).toBeDefined();
      expect(walker.chunkSize).toBeGreaterThanOrEqual(8192);
      expect(walker.chunkSize).toBeLessThanOrEqual(65536);
    });

    it('next() advances the walker', () => {
      const walker = createChaosWalker({}, 42);
      // First call should advance
      const result = walker.next();
      // Should be true (not at end of address space yet)
      expect(typeof result).toBe('boolean');
      // Address should have moved up
      expect(walker.address).toBeGreaterThan(0n);
    });

    it('chunkSize returns values within configured bounds', () => {
      const walker = createChaosWalker({ minChunkBytes: 4096, maxChunkBytes: 8192 }, 123);

      for (let i = 0; i < 100; i++) {
        const size = walker.chunkSize;
        expect(size).toBeGreaterThanOrEqual(4096);
        expect(size).toBeLessThanOrEqual(8192);
      }
    });

    it('direction can flip (probabilistic)', () => {
      // With backwardReadProbability = 1.0, every call should flip
      const walker = createChaosWalker({ backwardReadProbability: 1.0 }, 1);
      expect(walker.direction).toBe('forward');
      walker.next();
      expect(walker.direction).toBe('backward');
      walker.next();
      expect(walker.direction).toBe('forward');
    });

    it('setDummyPids updates the pid list', () => {
      const walker = createChaosWalker();
      walker.setDummyPids([100, 200, 300]);
      // setDummyPids should not throw
      expect(() => walker.setDummyPids([400, 500])).not.toThrow();
    });

    it('thinkPause resolves (not all pauses actually sleep)', async () => {
      const walker = createChaosWalker(
        { thinkPauseProbability: 0.0 }, // 0% → never pause
        42,
      );
      // Should resolve immediately when probability is 0
      await expect(walker.thinkPause()).resolves.toBeUndefined();
    });

    it('delay resolves without error', async () => {
      const walker = createChaosWalker();
      await expect(walker.delay()).resolves.toBeUndefined();
    });

    it('shouldInterleaveDummy returns boolean', () => {
      const walker = createChaosWalker();
      for (let i = 0; i < 50; i++) {
        const result = walker.shouldInterleaveDummy();
        expect(typeof result).toBe('boolean');
      }
    });
  });

  describe('createChaosRegionIterator', () => {
    it('creates iterator for given region count', () => {
      const iter = createChaosRegionIterator(10, 42);
      expect(iter.total).toBe(10);
      expect(iter.consumed).toBe(0);
      expect(iter.order.length).toBe(10);
    });

    it('returns all indices exactly once (permutation)', () => {
      const iter = createChaosRegionIterator(50, 99);
      const seen = new Set<number>();

      for (let i = 0; i < 50; i++) {
        const idx = iter.next();
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(50);
        expect(seen.has(idx)).toBe(false);
        seen.add(idx);
      }

      expect(seen.size).toBe(50);
      expect(iter.consumed).toBe(50);

      // After exhaustion, returns -1
      expect(iter.next()).toBe(-1);
    });

    it('deterministic with same seed', () => {
      const iter1 = createChaosRegionIterator(10, 123);
      const iter2 = createChaosRegionIterator(10, 123);

      for (let i = 0; i < 10; i++) {
        expect(iter1.next()).toBe(iter2.next());
      }
    });

    it('different seeds produce different orders', () => {
      const iter1 = createChaosRegionIterator(20, 1);
      const iter2 = createChaosRegionIterator(20, 2);

      const order1 = Array.from({ length: 20 }, () => iter1.next());
      const order2 = Array.from({ length: 20 }, () => iter2.next());

      // Extremely unlikely to be identical with different seeds
      const same = order1.every((v, i) => v === order2[i]);
      expect(same).toBe(false);
    });

    it('length 1 region returns single-element order', () => {
      const iter = createChaosRegionIterator(1, 42);
      expect(iter.total).toBe(1);
      expect(iter.next()).toBe(0);
      expect(iter.next()).toBe(-1);
    });
  });

  describe('generateDummyPids', () => {
    it('returns empty array on non-Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const pids = generateDummyPids([1000], 5);
      expect(pids).toEqual([]);

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe('isChaosModeEnabled', () => {
    it('returns false when env var is not set', () => {
      const result = isChaosModeEnabled();
      expect(result).toBe(false);
    });

    it('returns true when env var is set to 1', () => {
      vi.stubEnv('JSHOOK_SCAN_CHAOS_MODE', '1');
      expect(isChaosModeEnabled()).toBe(true);
      vi.unstubAllEnvs();
    });
  });

  describe('getChaosConfigFromEnv', () => {
    it('returns defaults when no env vars set', () => {
      const config = getChaosConfigFromEnv();
      expect(config.backwardReadProbability).toBe(DEFAULT_CHAOS_CONFIG.backwardReadProbability);
      expect(config.minThinkPauseMs).toBe(DEFAULT_CHAOS_CONFIG.minThinkPauseMs);
      expect(config.maxThinkPauseMs).toBe(DEFAULT_CHAOS_CONFIG.maxThinkPauseMs);
      expect(config.dummyProcessReadRate).toBe(DEFAULT_CHAOS_CONFIG.dummyProcessReadRate);
      // New fields
      expect(config.chunkVariance).toBe(DEFAULT_CHAOS_CONFIG.chunkVariance);
      expect(config.minInterChunkDelayMs).toBe(DEFAULT_CHAOS_CONFIG.minInterChunkDelayMs);
      expect(config.maxInterChunkDelayMs).toBe(DEFAULT_CHAOS_CONFIG.maxInterChunkDelayMs);
    });

    it('reads backward probability from env', () => {
      vi.stubEnv('JSHOOK_CHAOS_BACKWARD_PROB', '0.8');
      const config = getChaosConfigFromEnv();
      expect(config.backwardReadProbability).toBe(0.8);
      vi.unstubAllEnvs();
    });

    it('reads think pause bounds from env', () => {
      vi.stubEnv('JSHOOK_CHAOS_THINK_MIN_MS', '200');
      vi.stubEnv('JSHOOK_CHAOS_THINK_MAX_MS', '3000');
      const config = getChaosConfigFromEnv();
      expect(config.minThinkPauseMs).toBe(200);
      expect(config.maxThinkPauseMs).toBe(3000);
      vi.unstubAllEnvs();
    });

    it('reads chunk variance from env', () => {
      vi.stubEnv('JSHOOK_CHAOS_CHUNK_VARIANCE', '0.5');
      const config = getChaosConfigFromEnv();
      expect(config.chunkVariance).toBe(0.5);
      vi.unstubAllEnvs();
    });

    it('clamps chunk variance to [0, 1]', () => {
      vi.stubEnv('JSHOOK_CHAOS_CHUNK_VARIANCE', '5.0');
      const config = getChaosConfigFromEnv();
      expect(config.chunkVariance).toBe(1.0);
      vi.unstubAllEnvs();

      vi.stubEnv('JSHOOK_CHAOS_CHUNK_VARIANCE', '-3.0');
      const config2 = getChaosConfigFromEnv();
      expect(config2.chunkVariance).toBe(0.0);
      vi.unstubAllEnvs();
    });

    it('reads inter-chunk delay bounds from env', () => {
      vi.stubEnv('JSHOOK_CHAOS_INTER_CHUNK_DELAY_MIN', '10');
      vi.stubEnv('JSHOOK_CHAOS_INTER_CHUNK_DELAY_MAX', '200');
      const config = getChaosConfigFromEnv();
      expect(config.minInterChunkDelayMs).toBe(10);
      expect(config.maxInterChunkDelayMs).toBe(200);
      vi.unstubAllEnvs();
    });

    it('ensures max inter-chunk delay is at least min', () => {
      vi.stubEnv('JSHOOK_CHAOS_INTER_CHUNK_DELAY_MIN', '100');
      vi.stubEnv('JSHOOK_CHAOS_INTER_CHUNK_DELAY_MAX', '50');
      const config = getChaosConfigFromEnv();
      expect(config.minInterChunkDelayMs).toBe(100);
      expect(config.maxInterChunkDelayMs).toBe(100); // clamped to min
      vi.unstubAllEnvs();
    });
  });
});
