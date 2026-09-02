import { describe, expect, it } from 'vitest';
import { PredictiveBooster } from '@server/activation/PredictiveBooster';

/**
 * Reference implementation of the original eager-decay algorithm: every
 * recordCall decays every entry in both tables. Used to prove that the lazy
 * decay in PredictiveBooster is mathematically equivalent.
 */
function createEagerReference(options: {
  maxHistory: number;
  confidenceThreshold: number;
  decayFactor: number;
  maxSecondOrderKeys: number;
}) {
  const history: string[] = [];
  const t1 = new Map<string, Map<string, number>>();
  const t2 = new Map<string, Map<string, number>>();

  const decay = (table: Map<string, Map<string, number>>): void => {
    if (options.decayFactor >= 1) return;
    for (const targets of table.values()) {
      for (const [tool, weight] of targets) {
        const decayed = weight * options.decayFactor;
        if (decayed < 0.01) {
          targets.delete(tool);
        } else {
          targets.set(tool, decayed);
        }
      }
    }
  };

  const bump = (table: Map<string, Map<string, number>>, source: string, target: string): void => {
    let targets = table.get(source);
    if (!targets) {
      targets = new Map<string, number>();
      table.set(source, targets);
    }
    targets.set(target, (targets.get(target) ?? 0) + 1);
  };

  const enforceCap = (table: Map<string, Map<string, number>>): void => {
    if (table.size <= options.maxSecondOrderKeys) return;
    const overflow = table.size - options.maxSecondOrderKeys;
    const iter = table.keys();
    for (let i = 0; i < overflow; i++) {
      const { value, done } = iter.next();
      if (done || !value) break;
      table.delete(value);
    }
  };

  const pick = (targets: Map<string, number> | undefined): string[] => {
    if (!targets || targets.size === 0) return [];
    let total = 0;
    for (const count of targets.values()) total += count;
    if (total === 0) return [];
    const predictions: Array<{ tool: string; confidence: number }> = [];
    for (const [tool, count] of targets) {
      const confidence = count / total;
      if (confidence >= options.confidenceThreshold) {
        predictions.push({ tool, confidence });
      }
    }
    predictions.sort((a, b) => b.confidence - a.confidence);
    return predictions.map((p) => p.tool);
  };

  return {
    record(tool: string): void {
      const previous = history.length > 0 ? history[history.length - 1] : null;
      const prevPrev = history.length > 1 ? history[history.length - 2] : null;
      history.push(tool);
      if (history.length > options.maxHistory) {
        history.splice(0, history.length - options.maxHistory);
      }
      decay(t1);
      decay(t2);
      if (previous) bump(t1, previous, tool);
      if (prevPrev && previous) {
        bump(t2, `${prevPrev}\u0001${previous}`, tool);
        enforceCap(t2);
      }
    },
    predict(currentTool: string): string[] {
      const prev = history.length > 1 ? history[history.length - 2] : null;
      if (prev) {
        const secondPredictions = pick(t2.get(`${prev}\u0001${currentTool}`));
        if (secondPredictions.length > 0) return secondPredictions;
      }
      return pick(t1.get(currentTool));
    },
    firstOrderCount(): number {
      return t1.size;
    },
    secondOrderCount(): number {
      return t2.size;
    },
  };
}

describe('activation/PredictiveBooster', () => {
  it('builds transition table from recorded calls', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    expect(booster.transitionCount).toBeGreaterThan(0);
    expect(booster.historyLength).toBe(4);
  });

  it('predicts next tools above confidence threshold', () => {
    const booster = new PredictiveBooster({
      maxHistory: 50,
      confidenceThreshold: 0.3,
      decayFactor: 1,
    });

    // Build a strong pattern: navigate → click (100% transition)
    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('page_click');
    }

    const predictions = booster.predictNext('page_navigate');
    expect(predictions).toContain('page_click');
  });

  it('does not predict below confidence threshold', () => {
    const booster = new PredictiveBooster({
      maxHistory: 50,
      confidenceThreshold: 0.5,
      decayFactor: 1,
    });

    // Build a mixed pattern
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    booster.recordCall('page_navigate');
    booster.recordCall('debug_pause');
    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    // page_navigate → page_click is 2/3 ≈ 0.67 (above 0.5)
    // page_navigate → debug_pause is 1/3 ≈ 0.33 (below 0.5)
    const predictions = booster.predictNext('page_navigate');
    expect(predictions).toContain('page_click');
    expect(predictions).not.toContain('debug_pause');
  });

  it('sliding window capped at maxHistory', () => {
    const booster = new PredictiveBooster({ maxHistory: 5 });

    for (let i = 0; i < 10; i++) {
      booster.recordCall(`tool_${i}`);
    }

    expect(booster.historyLength).toBe(5);
  });

  it('returns empty for unknown tools', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');

    const predictions = booster.predictNext('unknown_tool');
    expect(predictions).toEqual([]);
  });

  it('predictNextDomains returns domains from predicted tools', () => {
    const booster = new PredictiveBooster({
      maxHistory: 50,
      confidenceThreshold: 0.3,
      decayFactor: 1,
    });

    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('debug_pause');
    }

    const domains = booster.predictNextDomains('page_navigate', (name) => {
      if (name.startsWith('debug_')) return 'debugger';
      if (name.startsWith('page_')) return 'browser';
      return null;
    });

    expect(domains).toContain('debugger');
  });

  it('reset clears all state', () => {
    const booster = new PredictiveBooster();

    booster.recordCall('page_navigate');
    booster.recordCall('page_click');
    expect(booster.historyLength).toBe(2);

    booster.reset();
    expect(booster.historyLength).toBe(0);
    expect(booster.transitionCount).toBe(0);
  });

  it('predictNext returns empty if total transitions is 0', () => {
    const booster = new PredictiveBooster();
    booster.recordCall('A');
    booster.recordCall('B');
    // Force total to 0 to simulate weird internal state
    (booster as any).transitions.get('A').set('B', { value: 0, lastDecayAt: 0 });
    expect(booster.predictNext('A')).toEqual([]);
  });

  it('predictNextDomains skips mapped tools that return null domains', () => {
    const booster = new PredictiveBooster({
      maxHistory: 50,
      confidenceThreshold: 0.3,
      decayFactor: 1,
    });
    for (let i = 0; i < 10; i++) {
      booster.recordCall('page_navigate');
      booster.recordCall('unknown_tool');
    }
    const domains = booster.predictNextDomains('page_navigate', () => null);
    expect(domains).toEqual([]);
  });

  it('first-order transition table respects the key cap', () => {
    const booster = new PredictiveBooster({ maxSecondOrderKeys: 50 });

    for (let i = 0; i < 500; i++) {
      booster.recordCall(`tool_${i}`);
    }

    expect(booster.transitionCount).toBeLessThanOrEqual(50);
    expect(booster.historyLength).toBe(100);
  });

  it('lazy decay leaves unrelated entries untouched by recordCall', () => {
    const booster = new PredictiveBooster({ decayFactor: 0.95 });
    booster.recordCall('A');
    booster.recordCall('B'); // A→B entry created at call #2

    for (let i = 0; i < 100; i++) {
      booster.recordCall('C');
      booster.recordCall('D');
    }

    // recordCall must not have walked the whole table: the A→B entry still
    // holds the raw bump value and the creation-time decay stamp.
    const entry = (booster as any).transitions.get('A').get('B');
    expect(entry).toEqual({ value: 1, lastDecayAt: 2 });
  });

  it('lazy decay is mathematically equivalent to eager per-call decay', () => {
    const options = {
      maxHistory: 100,
      confidenceThreshold: 0.3,
      decayFactor: 0.9,
      maxSecondOrderKeys: 1000,
    };
    const calls = [
      'page_navigate',
      'page_click',
      'page_navigate',
      'page_click',
      'page_navigate',
      'page_click',
      'page_navigate',
      'page_click',
      'debug_pause',
      'debug_resume',
      'debug_pause',
      'debug_resume',
      'page_navigate',
      'page_click',
      'debug_pause',
      'network_enable',
      'network_get_requests',
      'network_enable',
      'network_get_requests',
      'page_navigate',
      'debug_pause',
      'page_navigate',
      'page_click',
      'network_enable',
      'page_navigate',
      'page_click',
    ];

    const booster = new PredictiveBooster(options);
    const reference = createEagerReference(options);
    const allTools = [...new Set(calls)];

    for (let i = 0; i < calls.length; i++) {
      booster.recordCall(calls[i]!);
      reference.record(calls[i]!);

      if (i % 5 === 4 || i === calls.length - 1) {
        for (const tool of allTools) {
          expect(booster.predictNext(tool)).toEqual(reference.predict(tool));
        }
      }
    }

    expect(booster.transitionCount).toBe(reference.firstOrderCount());
    expect(booster.secondOrderTransitionCount).toBe(reference.secondOrderCount());
  });
});
