/**
 * Frame timing statistics — shared pure functions.
 *
 * Extracted from `src/server/domains/webgpu/handlers/frame-timing.ts` so that
 * frame-level timing analysis (avg/p95 frame time, dropped-frame detection,
 * 60fps budget misses, CPU/GPU-bound classification) can be reused by other
 * domains without importing a WebGPU handler. The WebGPU handler still owns
 * the GPU timestamp-query collection; this module owns only the math.
 *
 * Consumers:
 *  - webgpu_frame_timing — GPU timestamp queries → computeFrameStats
 *  - canvas_inject_draw_hook (timing mode) — rAF frame intervals → computeFrameStats
 */

/**
 * Frame timing statistics computed from per-frame CPU intervals and per-frame
 * GPU durations. Pure function — no page/device access.
 */
export interface FrameTimingStats {
  frameCount: number;
  avgFrameMs: number;
  p95FrameMs: number;
  /** True GPU pass duration (ms); null when only CPU round-trip timing exists. */
  avgGpuMs: number | null;
  p95GpuMs: number | null;
  /** Frames whose interval exceeded max(34ms, 1.5×median) — outlier detection, not absolute quality. */
  droppedFrames: number;
  /** Frames whose interval exceeded the 60fps budget (16.67ms) — absolute quality counter. */
  budgetMisses: number;
  /** 'gpu-bound' when GPU time ≥ 80% of frame time, 'cpu-bound' ≤ 50%. */
  cpuOrGpuBound: 'gpu-bound' | 'cpu-bound' | 'balanced' | 'unknown';
  /** 'gpu-timestamp' = real timestamp queries; 'cpu-roundtrip' = degraded. */
  precision: 'gpu-timestamp' | 'cpu-roundtrip';
  /** Per-frame breakdown (populated by the caller when includeTimestamps). */
  frames?: Array<{ frameIndex: number; frameMs: number; gpuMs: number | null }>;
}

/** Dropped-frame threshold: a frame interval beyond this is considered a drop. */
const DROPPED_FRAME_HARD_MS = 34;

/** Absolute 60fps frame budget in milliseconds. */
const FRAME_BUDGET_MS = 1000 / 60;

export function computeFrameStats(
  frameTimesMs: number[],
  gpuTimesMs: number[],
  precision: 'gpu-timestamp' | 'cpu-roundtrip',
): FrameTimingStats {
  const frameCount = frameTimesMs.length;
  const avgFrameMs = frameCount > 0 ? frameTimesMs.reduce((a, b) => a + b, 0) / frameCount : 0;
  const p95FrameMs = percentile(frameTimesMs, 0.95);
  const avgGpuMs =
    gpuTimesMs.length > 0 ? gpuTimesMs.reduce((a, b) => a + b, 0) / gpuTimesMs.length : null;
  const p95GpuMs = gpuTimesMs.length > 0 ? percentile(gpuTimesMs, 0.95) : null;
  const droppedFrames = countDroppedFrames(frameTimesMs);
  const budgetMisses = countBudgetMisses(frameTimesMs);
  const cpuOrGpuBound = classifyBound(avgFrameMs, avgGpuMs, precision);

  return {
    frameCount,
    avgFrameMs,
    p95FrameMs,
    avgGpuMs,
    p95GpuMs,
    droppedFrames,
    budgetMisses,
    cpuOrGpuBound,
    precision,
  };
}

/** p95 (or any p) of a numeric sample: sorted[floor(n × p)]. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

/** Median of a numeric sample. */
function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Count frames whose interval exceeds max(34ms, 1.5 × median) — outlier detector. */
function countDroppedFrames(frameTimesMs: number[]): number {
  if (frameTimesMs.length === 0) {
    return 0;
  }
  const threshold = Math.max(DROPPED_FRAME_HARD_MS, median(frameTimesMs) * 1.5);
  return frameTimesMs.filter((ms) => ms > threshold).length;
}

/** Count frames whose interval exceeds the absolute 60fps (16.67ms) budget. */
function countBudgetMisses(frameTimesMs: number[]): number {
  return frameTimesMs.filter((ms) => ms > FRAME_BUDGET_MS).length;
}

/**
 * CPU- vs GPU-bound classification:
 *  - real GPU timings: ratio ≥ 0.8 → gpu-bound, ≤ 0.5 → cpu-bound, else balanced.
 *  - CPU round-trip only: cannot separate CPU and GPU cost → 'unknown'.
 */
function classifyBound(
  avgFrameMs: number,
  avgGpuMs: number | null,
  precision: 'gpu-timestamp' | 'cpu-roundtrip',
): FrameTimingStats['cpuOrGpuBound'] {
  if (precision !== 'gpu-timestamp' || avgGpuMs === null || avgFrameMs <= 0) {
    return 'unknown';
  }
  const ratio = avgGpuMs / avgFrameMs;
  if (ratio >= 0.8) {
    return 'gpu-bound';
  }
  if (ratio <= 0.5) {
    return 'cpu-bound';
  }
  return 'balanced';
}
