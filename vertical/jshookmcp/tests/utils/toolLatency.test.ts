import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOL_LATENCY_TOP_N,
  ToolLatencyTracker,
  computePercentiles,
  createToolLatencyTracker,
} from '@utils/toolLatency';

describe('computePercentiles', () => {
  it('computes nearest-rank p50/p90/p99 from an unsorted sample list', () => {
    expect(computePercentiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toEqual({
      p50Ms: 50,
      p90Ms: 90,
      p99Ms: 100,
      samples: 10,
    });
  });

  it('returns the single sample for every percentile when n=1', () => {
    expect(computePercentiles([7.5])).toEqual({
      p50Ms: 7.5,
      p90Ms: 7.5,
      p99Ms: 7.5,
      samples: 1,
    });
  });

  it('returns zeros for an empty sample list', () => {
    expect(computePercentiles([])).toEqual({ p50Ms: 0, p90Ms: 0, p99Ms: 0, samples: 0 });
  });

  it('does not mutate the input array', () => {
    const input = [5, 1, 4, 2, 3];
    computePercentiles(input);
    expect(input).toEqual([5, 1, 4, 2, 3]);
  });
});

describe('ToolLatencyTracker', () => {
  it('records samples per tool and reports percentiles + samples', () => {
    const tracker = new ToolLatencyTracker(200);
    for (let i = 0; i < 100; i++) tracker.record('slow_tool', 100);
    for (let i = 0; i < 100; i++) tracker.record('fast_tool', 1);

    const summary = tracker.getSummary();
    expect(summary.trackedTools).toBe(2);
    const byName = Object.fromEntries(summary.top.map((e) => [e.toolName, e]));
    expect(byName['slow_tool']).toEqual({
      toolName: 'slow_tool',
      p50Ms: 100,
      p90Ms: 100,
      p99Ms: 100,
      samples: 100,
    });
    expect(byName['fast_tool']).toEqual({
      toolName: 'fast_tool',
      p50Ms: 1,
      p90Ms: 1,
      p99Ms: 1,
      samples: 100,
    });
  });

  it('sorts the summary by p99 descending (slowest first)', () => {
    const tracker = new ToolLatencyTracker(200);
    tracker.record('a', 1);
    tracker.record('b', 100);
    tracker.record('c', 50);

    expect(tracker.getSummary().top.map((e) => e.toolName)).toEqual(['b', 'c', 'a']);
  });

  it('caps the retained samples per tool at the ring-buffer limit (evicts oldest)', () => {
    const tracker = new ToolLatencyTracker(3);
    tracker.record('t', 1);
    tracker.record('t', 2);
    tracker.record('t', 3);
    tracker.record('t', 4);

    const entry = tracker.getSummary().top.find((e) => e.toolName === 't');
    expect(entry?.samples).toBe(3);
    // The oldest sample (1) was evicted: [2, 3, 4] → p50 is the middle value 3.
    expect(entry?.p50Ms).toBe(3);
  });

  it('caps getSummary to topN entries while reporting the full tracked tool count', () => {
    const tracker = new ToolLatencyTracker(200);
    for (let i = 0; i < 20; i++) tracker.record(`tool_${i}`, i);

    expect(tracker.getSummary(5).top).toHaveLength(5);
    expect(tracker.getSummary(5).trackedTools).toBe(20);
    expect(DEFAULT_TOOL_LATENCY_TOP_N).toBe(10);
  });

  it('record is synchronous (returns undefined, not a promise)', () => {
    const tracker = new ToolLatencyTracker(200);
    expect(tracker.record('t', 5)).toBeUndefined();
  });

  it('defers sorting to getSummary — record never sorts (lazy percentiles)', () => {
    // computePercentiles uses Array#toSorted (copy-sort), so the spy proves the
    // hot path (record) does zero sorting and getSummary does it lazily.
    const sortSpy = vi.spyOn(Array.prototype, 'toSorted');
    const tracker = new ToolLatencyTracker(200);
    for (let i = 0; i < 500; i++) tracker.record('t', i % 100);
    expect(sortSpy).not.toHaveBeenCalled();
    tracker.getSummary();
    expect(sortSpy).toHaveBeenCalled();
    sortSpy.mockRestore();
  });

  it('ignores non-finite and negative durations', () => {
    const tracker = new ToolLatencyTracker(200);
    tracker.record('t', Number.NaN);
    tracker.record('t', Number.POSITIVE_INFINITY);
    tracker.record('t', -1);
    expect(tracker.getSummary().trackedTools).toBe(0);
  });

  it('dispose clears all retained samples', () => {
    const tracker = new ToolLatencyTracker(200);
    tracker.record('t', 5);
    tracker.dispose();
    expect(tracker.getSummary().trackedTools).toBe(0);
    expect(tracker.getSummary().top).toEqual([]);
  });
});

describe('createToolLatencyTracker', () => {
  it('returns a tracker with the default sample limit', () => {
    const tracker = createToolLatencyTracker();
    tracker.record('t', 5);
    expect(tracker.getSummary().top).toHaveLength(1);
    tracker.dispose();
  });
});
