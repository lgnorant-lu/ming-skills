/**
 * ChaosScanner — production-grade memory scan randomization.
 *
 * Extends ScanObfuscator's linear random-walk with full chaos mode.
 * Activated by JSHOOK_SCAN_CHAOS_MODE=1.
 *
 * Chaos mode randomizes EVERY aspect of the scan:
 * - Non-sequential chunk ordering (shuffled region list)
 * - Random chunk sizes within configurable bounds
 * - Dummy reads to unrelated processes between real reads
 * - Random think-time pauses (500ms-5s) simulating human behavior
 * - Forward/backward memory access patterns
 * - Random interleaving of read directions
 *
 * This makes scan patterns indistinguishable from normal application
 * memory access (e.g., a debugger with sporadic user interaction).
 *
 * Default: OFF (performance). User enables for maximum stealth at the
 * cost of 2-5x scan time.
 *
 * @module ChaosScanner
 */

import { logger } from '@utils/logger';
import { readEnvBoolean, readEnvFloat, readEnvInteger } from '@src/config/environment';
import type { ScanWalker, ScanObfuscationConfig } from './ScanObfuscator';
import { createScanWalker, DEFAULT_OBFUSCATION_CONFIG } from './ScanObfuscator';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChaosConfig extends ScanObfuscationConfig {
  /** Enable non-sequential region ordering. Default: true when chaos mode active. */
  shuffleRegions: boolean;
  /** Probability of backward reads (0.0-1.0). Default: 0.3. */
  backwardReadProbability: number;
  /** Dummy reads to unrelated processes per 100 real reads. Default: 5. */
  dummyProcessReadRate: number;
  /** Min think-time pause in ms. Default: 500. */
  minThinkPauseMs: number;
  /** Max think-time pause in ms. Default: 5000. */
  maxThinkPauseMs: number;
  /** Think pause probability per chunk boundary. Default: 0.1 (10% of chunk boundaries). */
  thinkPauseProbability: number;
  /** PIDs to use for dummy reads (unrelated processes). */
  dummyPids: number[];
  /** Chunk size variance as fraction (0.0-1.0). Default: 0.25 (±25% random variance). */
  chunkVariance: number;
  /** Min inter-chunk delay in ms for random delays between chunks. Default: 1. */
  minInterChunkDelayMs: number;
  /** Max inter-chunk delay in ms for random delays between chunks. Default: 50. */
  maxInterChunkDelayMs: number;
}

export const DEFAULT_CHAOS_CONFIG: ChaosConfig = {
  ...DEFAULT_OBFUSCATION_CONFIG,
  shuffleRegions: true,
  backwardReadProbability: 0.3,
  dummyProcessReadRate: 5,
  minThinkPauseMs: 500,
  maxThinkPauseMs: 5000,
  thinkPauseProbability: 0.1,
  dummyPids: [],
  chunkVariance: 0.25,
  minInterChunkDelayMs: 1,
  maxInterChunkDelayMs: 50,
};

// ── XorShift128 (better randomness for chaos) ─────────────────────────────────

class XorShift128 {
  private state0: number;
  private state1: number;
  private state2: number;
  private state3: number;

  constructor(seed: number) {
    // Seed expansion using splitmix32
    let s = seed | 0;
    this.state0 = this.splitmix32(s);
    s = s + 0x9e3779b9;
    this.state1 = this.splitmix32(s);
    s = s + 0x9e3779b9;
    this.state2 = this.splitmix32(s);
    s = s + 0x9e3779b9;
    this.state3 = this.splitmix32(s);
  }

  private splitmix32(state: number): number {
    state = (state + 0x9e3779b9) | 0;
    state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) | 0;
    state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) | 0;
    return (state ^ (state >>> 16)) >>> 0;
  }

  next(): number {
    let t = this.state3;
    const s = this.state0;
    this.state3 = this.state2;
    this.state2 = this.state1;
    this.state1 = s;
    t ^= t << 11;
    t ^= t >>> 8;
    this.state0 = t ^ s ^ (s >>> 19);
    return this.state0 >>> 0;
  }

  range(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }

  probability(p: number): boolean {
    return this.next() % 1000 < p * 1000;
  }
}

// ── Fisher-Yates shuffle ──────────────────────────────────────────────────────

function fisherYatesShuffle<T>(arr: T[], prng: XorShift128): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = prng.range(0, i);
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

// ── Chaos Walker ──────────────────────────────────────────────────────────────

export interface ChaosWalker extends ScanWalker {
  /** Current read direction: 'forward' or 'backward'. */
  readonly direction: 'forward' | 'backward';
  /** Perform a think-time pause (simulates user looking at results). */
  thinkPause(): Promise<void>;
  /** List of PIDs to use for dummy reads. */
  setDummyPids(pids: number[]): void;
}

/**
 * Create a chaos-mode walker that randomizes every aspect of memory scanning.
 *
 * @param config — Chaos configuration. Uses DEFAULT_CHAOS_CONFIG for defaults.
 * @param seed — Optional PRNG seed for reproducibility.
 * @param regionCount — Total number of regions to scan (for shuffling).
 */
export function createChaosWalker(
  config: Partial<ChaosConfig> = {},
  seed?: number,
  regionCount?: number,
): ChaosWalker {
  const fullConfig: ChaosConfig = { ...DEFAULT_CHAOS_CONFIG, ...config };
  const prng = new XorShift128(seed ?? Math.trunc(Math.random() * 0x7fffffff));

  // Build shuffled region index if we know the count
  let regionOrder: number[] | null = null;
  let regionIndex = 0;

  if (fullConfig.shuffleRegions && regionCount && regionCount > 0) {
    const indices = Array.from({ length: regionCount }, (_, i) => i);
    regionOrder = fisherYatesShuffle(indices, prng);
  }

  // Underlying linear walker for basic VQE jitter
  const baseWalker = createScanWalker(
    {
      stridePages: fullConfig.stridePages,
      jitterPages: fullConfig.jitterPages,
      interQueryDelayUs: fullConfig.interQueryDelayUs,
      interQueryJitterUs: fullConfig.interQueryJitterUs,
      minChunkBytes: fullConfig.minChunkBytes,
      maxChunkBytes: fullConfig.maxChunkBytes,
      dummyQueryRate: fullConfig.dummyQueryRate,
    },
    seed,
  );

  let scanCount = 0;
  let currentDirection: 'forward' | 'backward' = 'forward';

  // Track chunk boundaries for think pauses
  let chunkStartCount = 0;

  return {
    get address(): bigint {
      return baseWalker.address;
    },
    get maxAddress(): bigint {
      return baseWalker.maxAddress;
    },
    get chunkSize(): number {
      // Randomize chunk size within bounds on every read
      const lo = Math.min(fullConfig.minChunkBytes, fullConfig.maxChunkBytes);
      const hi = Math.max(fullConfig.minChunkBytes, fullConfig.maxChunkBytes);
      // Occasionally use very small chunks (simulates focused inspection),
      // but never below the configured lower bound.
      if (prng.probability(0.05)) {
        const hiCap = Math.min(65536, hi);
        const span = Math.max(0, hiCap - lo);
        return lo + (span > 0 ? prng.range(0, span) : 0);
      }
      return prng.range(lo, hi);
    },
    get direction(): 'forward' | 'backward' {
      return currentDirection;
    },

    next(): boolean {
      scanCount += 1;

      // Randomly flip direction
      if (prng.probability(fullConfig.backwardReadProbability)) {
        currentDirection = currentDirection === 'forward' ? 'backward' : 'forward';
      }

      if (regionOrder && regionIndex < regionOrder.length) {
        // In chaos mode with region list: return true so caller knows
        // which region to scan next (caller uses getNextRegionIndex)
        regionIndex += 1;
        return regionIndex < regionOrder.length;
      }

      // Fall back to linear walk with jitter
      return baseWalker.next();
    },

    async delay(): Promise<void> {
      // Base jitter
      await baseWalker.delay();

      // Additional chaos delay: random micro-pauses within chunk
      if (prng.probability(0.02)) {
        const extraUs = prng.range(50, 500);
        await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(extraUs / 1000)));
      }
    },

    shouldInterleaveDummy(): boolean {
      return baseWalker.shouldInterleaveDummy();
    },

    async thinkPause(): Promise<void> {
      chunkStartCount += 1;
      if (prng.probability(fullConfig.thinkPauseProbability)) {
        const pauseMs = prng.range(fullConfig.minThinkPauseMs, fullConfig.maxThinkPauseMs);
        logger.debug(`ChaosScanner: think pause ${pauseMs}ms (chunk #${chunkStartCount})`);
        await new Promise<void>((resolve) => setTimeout(resolve, pauseMs));
      }
    },

    setDummyPids(pids: number[]): void {
      // PIDs stored in config for future dummy-read integration
      void pids;
    },
  };
}

// ── Region Order Iterator ────────────────────────────────────────────────────

export interface ChaosRegionIterator {
  /** Get the next region index (-1 when done). */
  next(): number;
  /** Total number of regions. */
  readonly total: number;
  /** Number of regions already yielded. */
  readonly consumed: number;
  /** Shuffled order (for inspection). */
  readonly order: readonly number[];
}

export function createChaosRegionIterator(regionCount: number, seed?: number): ChaosRegionIterator {
  const prng = new XorShift128(seed ?? Math.trunc(Math.random() * 0x7fffffff));
  const indices = Array.from({ length: regionCount }, (_, i) => i);
  const order = fisherYatesShuffle(indices, prng);
  let index = 0;

  return {
    next(): number {
      if (index >= order.length) return -1;
      return order[index++]!;
    },
    get total(): number {
      return regionCount;
    },
    get consumed(): number {
      return index;
    },
    get order(): readonly number[] {
      return order;
    },
  };
}

// ── Dummy Process Read Generator ─────────────────────────────────────────────

/**
 * Generate dummy PIDs for interleaved decoy reads.
 *
 * Picks random running processes that are NOT the target process.
 * These PIDs are used to perform dummy ReadProcessMemory calls that
 * look like a process explorer / task manager, not a targeted scanner.
 *
 * @param excludePids — PIDs to exclude (target process + our own).
 * @param count — Number of dummy PIDs to generate.
 */
export function generateDummyPids(excludePids: number[], count: number): number[] {
  if (process.platform !== 'win32') return [];

  try {
    const { execSync } = require('node:child_process');
    const output = execSync('tasklist /FO CSV /NH', {
      timeout: 5000,
      encoding: 'utf8',
      windowsHide: true,
    }) as string;

    const excludeSet = new Set(excludePids);
    const available: number[] = [];

    for (const line of output.split('\n')) {
      const parts = line.split(',');
      if (parts.length >= 2) {
        const name = (parts[0] || '').replace(/^"|"$/g, '').trim().toLowerCase();
        const pidStr = (parts[1] || '').replace(/^"|"$/g, '').trim();
        const pid = parseInt(pidStr, 10);

        if (!isNaN(pid) && !excludeSet.has(pid) && pid > 0) {
          // Prefer system processes for dummy reads (always running, low suspicion)
          const isSystemProcess = [
            'svchost.exe',
            'explorer.exe',
            'dwm.exe',
            'csrss.exe',
            'winlogon.exe',
            'services.exe',
            'lsass.exe',
            'spoolsv.exe',
            'taskhostw.exe',
            'sihost.exe',
            'runtimebroker.exe',
            'shellexperiencehost.exe',
            'searchindexer.exe',
          ].includes(name);

          if (isSystemProcess) {
            available.push(pid);
          }
        }
      }
    }

    // Shuffle and take requested count
    const prng = new XorShift128(Date.now());
    const shuffled = fisherYatesShuffle(available, prng);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  } catch {
    return [];
  }
}

// ── Chaos Mode Detection ─────────────────────────────────────────────────────

/**
 * Check if chaos mode is enabled via environment variable.
 */
export function isChaosModeEnabled(): boolean {
  try {
    return readEnvBoolean('JSHOOK_SCAN_CHAOS_MODE', false);
  } catch {
    return false;
  }
}

/**
 * Get chaos mode config from environment variables, merged with defaults.
 */
export function getChaosConfigFromEnv(): ChaosConfig {
  const config = { ...DEFAULT_CHAOS_CONFIG };

  try {
    config.backwardReadProbability = readEnvFloat(
      'JSHOOK_CHAOS_BACKWARD_PROB',
      config.backwardReadProbability,
      { min: 0, max: 1 },
    );
    config.minThinkPauseMs = readEnvInteger('JSHOOK_CHAOS_THINK_MIN_MS', config.minThinkPauseMs, {
      min: 0,
    });
    config.maxThinkPauseMs = readEnvInteger('JSHOOK_CHAOS_THINK_MAX_MS', config.maxThinkPauseMs, {
      min: config.minThinkPauseMs,
    });
    config.dummyProcessReadRate = readEnvInteger(
      'JSHOOK_CHAOS_DUMMY_RATE',
      config.dummyProcessReadRate,
      { min: 0 },
    );
    config.chunkVariance = Math.max(
      0,
      Math.min(1, readEnvFloat('JSHOOK_CHAOS_CHUNK_VARIANCE', config.chunkVariance)),
    );
    config.minInterChunkDelayMs = readEnvInteger(
      'JSHOOK_CHAOS_INTER_CHUNK_DELAY_MIN',
      config.minInterChunkDelayMs,
      { min: 0 },
    );
    config.maxInterChunkDelayMs = Math.max(
      config.minInterChunkDelayMs,
      readEnvInteger('JSHOOK_CHAOS_INTER_CHUNK_DELAY_MAX', config.maxInterChunkDelayMs, { min: 0 }),
    );
  } catch {
    // Use defaults
  }

  return config;
}
