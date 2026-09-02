/**
 * Frame timing statistics — pure-function tests.
 *
 * computeFrameStats was extracted from webgpu/handlers/frame-timing.ts into
 * @utils/FrameStats so it can be shared with canvas_inject_draw_hook (timing
 * mode) and other frame-level timing consumers. These tests verify the math
 * independent of any page/device access.
 */

import { describe, it, expect } from 'vitest';
import { computeFrameStats } from '@utils/FrameStats';

describe('computeFrameStats', () => {
  it('computes avg and p95 from frame timings', () => {
    const stats = computeFrameStats([10, 11, 12, 13, 14, 15, 16, 17, 18, 100], [], 'gpu-timestamp');
    expect(stats.frameCount).toBe(10);
    expect(stats.avgFrameMs).toBeCloseTo(22.6, 5);
    // p95 = index floor(10*0.95)=9 → 100
    expect(stats.p95FrameMs).toBe(100);
  });

  it('computes avg and p95 GPU timings from resolved timestamp queries', () => {
    const stats = computeFrameStats(
      [16, 17, 16, 16, 16, 16, 16, 16, 16, 16],
      [8, 9, 8, 8, 8, 8, 8, 8, 8, 8],
      'gpu-timestamp',
    );
    expect(stats.avgGpuMs).toBeCloseTo(8.1, 5);
    expect(stats.p95GpuMs).toBe(9);
  });

  it('flags dropped frames beyond 1.5x median or 34ms', () => {
    const timings = [16, 16, 16, 16, 16, 16, 16, 16, 16, 80, 16, 16];
    const stats = computeFrameStats(timings, [], 'gpu-timestamp');
    // median 16 → threshold max(34, 24) = 34 → 80 counts as dropped
    expect(stats.droppedFrames).toBe(1);
  });

  it('counts budget misses — frames exceeding the 60fps 16.67ms budget', () => {
    // All frames exceed 16.67ms — every one is a budget miss
    const slow = [50, 52, 51, 50, 53];
    const stats = computeFrameStats(slow, [], 'gpu-timestamp');
    // droppedFrames uses adaptive threshold: median 51 → max(34, 76.5)=76.5 → 0 outliers
    expect(stats.droppedFrames).toBe(0);
    // budgetMisses counts absolute 16.67ms target: all 5 frames miss
    expect(stats.budgetMisses).toBe(5);
  });

  it('budgetMisses is zero when all frames are within 16.67ms', () => {
    const healthy = [14, 15, 16, 15, 14];
    const stats = computeFrameStats(healthy, [], 'gpu-timestamp');
    expect(stats.budgetMisses).toBe(0);
    expect(stats.droppedFrames).toBe(0);
  });

  it('budgetMisses and droppedFrames can diverge on mixed workloads', () => {
    // One extreme outlier (~200ms), rest consistently slow (~50ms)
    const timings = [50, 51, 50, 200, 51, 50];
    const stats = computeFrameStats(timings, [], 'gpu-timestamp');
    // Adaptive: median 50.5 → threshold max(34, 75.75)=75.75 → only 200 is outlier
    expect(stats.droppedFrames).toBe(1);
    // Absolute: all 6 frames exceed 16.67ms
    expect(stats.budgetMisses).toBe(6);
  });

  it('per-frame breakdown does not drop entries when arrays are equal length', () => {
    // Bug #1 regression: both arrays same length → all entries preserved
    const frameTimesMs = [16, 17, 16, 16, 16];
    const gpuTimesMs = [8, 9, 8, 8, 8];
    const stats = computeFrameStats(frameTimesMs, gpuTimesMs, 'gpu-timestamp');
    // frameCount should match the number of frames with both CPU+GPU data
    expect(stats.frameCount).toBe(5);
    // avgGpuMs should use all 5 GPU measurements
    expect(stats.avgGpuMs).toBeCloseTo(8.2, 5);
  });

  it('classifies GPU-bound when gpu/frame ratio ≥ 0.8', () => {
    const stats = computeFrameStats([16, 16, 16, 16], [14, 14, 14, 14], 'gpu-timestamp');
    expect(stats.cpuOrGpuBound).toBe('gpu-bound');
  });

  it('classifies CPU-bound when gpu/frame ratio ≤ 0.5', () => {
    const stats = computeFrameStats([16, 16, 16, 16], [5, 5, 5, 5], 'gpu-timestamp');
    expect(stats.cpuOrGpuBound).toBe('cpu-bound');
  });

  it('reports unknown bound when falling back to CPU round-trip timing', () => {
    const stats = computeFrameStats([16, 17, 18, 16], [], 'cpu-roundtrip');
    expect(stats.precision).toBe('cpu-roundtrip');
    expect(stats.cpuOrGpuBound).toBe('unknown');
    expect(stats.avgGpuMs).toBeNull();
    expect(stats.p95GpuMs).toBeNull();
  });

  it('handles empty input without throwing', () => {
    const stats = computeFrameStats([], [], 'gpu-timestamp');
    expect(stats.frameCount).toBe(0);
    expect(stats.avgFrameMs).toBe(0);
    expect(stats.p95FrameMs).toBe(0);
    expect(stats.droppedFrames).toBe(0);
    expect(stats.avgGpuMs).toBeNull();
  });
});
