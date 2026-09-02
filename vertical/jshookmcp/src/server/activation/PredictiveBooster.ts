/**
 * PredictiveBooster — analyzes LLM tool call history to pre-load likely next tools.
 *
 * Model:
 *  - First-order Markov transitions (A → B) indexed by the immediate
 *    previous tool name.
 *  - Second-order Markov transitions ((A,B) → C) for richer context when
 *    the session has enough history; falls back to first-order otherwise.
 *  - Exponential decay keeps the tables biased toward recent behavior.
 *    Decay is applied lazily: each entry stores the call counter of its
 *    last touch and the accumulated decay is folded in on access. This is
 *    mathematically equivalent to decaying every entry on each record,
 *    but keeps recordCall O(1) instead of O(|edges|).
 *  - Both transition tables are capped at maxSecondOrderKeys source keys.
 *
 * All tuning knobs (history cap, confidence threshold, decay factor) are
 * sourced from `src/constants.ts` and therefore overridable via `.env`.
 *
 * Requirement addressed: BOOST-06
 */

import {
  PREDICTIVE_CONFIDENCE_THRESHOLD,
  PREDICTIVE_DECAY_FACTOR,
  PREDICTIVE_MAX_HISTORY,
  PREDICTIVE_MAX_SECOND_ORDER_KEYS,
} from '@src/constants';

export interface PredictiveBoosterOptions {
  maxHistory?: number;
  confidenceThreshold?: number;
  decayFactor?: number;
  maxSecondOrderKeys?: number;
}

/** Transition entry with lazy decay: value is the weight as of `lastDecayAt`. */
interface TransitionEntry {
  /** Weight at `lastDecayAt` (post-bump, pre-elapsed-decay). */
  value: number;
  /** callCounter value when the entry was last materialized or bumped. */
  lastDecayAt: number;
}

export class PredictiveBooster {
  private readonly callHistory: string[] = [];
  private readonly maxHistory: number;
  private readonly confidenceThreshold: number;
  private readonly decayFactor: number;

  /** First-order transitions: toolA → (toolB → entry). */
  private readonly transitions = new Map<string, Map<string, TransitionEntry>>();

  /** Second-order transitions: (toolA|toolB) → (toolC → entry). */
  private readonly transitions2 = new Map<string, Map<string, TransitionEntry>>();

  /** Caps source-key growth in both transition tables. */
  private readonly maxSecondOrderKeys: number;

  /** Monotonic recordCall counter; the decay clock for lazy materialization. */
  private callCounter = 0;

  constructor(options: PredictiveBoosterOptions = {}) {
    this.maxHistory = options.maxHistory ?? PREDICTIVE_MAX_HISTORY;
    this.confidenceThreshold = options.confidenceThreshold ?? PREDICTIVE_CONFIDENCE_THRESHOLD;
    this.decayFactor = options.decayFactor ?? PREDICTIVE_DECAY_FACTOR;
    this.maxSecondOrderKeys = options.maxSecondOrderKeys ?? PREDICTIVE_MAX_SECOND_ORDER_KEYS;
  }

  /**
   * Record a tool call and update both transition tables.
   */
  recordCall(toolName: string): void {
    this.callCounter++;
    const previous =
      this.callHistory.length > 0 ? this.callHistory[this.callHistory.length - 1] : null;
    const prevPrev =
      this.callHistory.length > 1 ? this.callHistory[this.callHistory.length - 2] : null;

    this.callHistory.push(toolName);
    if (this.callHistory.length > this.maxHistory) {
      this.callHistory.splice(0, this.callHistory.length - this.maxHistory);
    }

    // Lazy decay: entries are materialized on access, so recording a call
    // only touches the current source's edges (O(1) instead of O(|edges|)).
    if (previous) {
      this.bumpTransition(this.transitions, previous, toolName);
    }
    if (prevPrev && previous) {
      const key = `${prevPrev}\u0001${previous}`;
      this.bumpTransition(this.transitions2, key, toolName);
    }
  }

  /**
   * Predict the next likely tools based on transition history.
   * Prefers the second-order table when a prediction is available; otherwise
   * falls back to first-order. Returns tool names above the confidence
   * threshold, sorted by probability descending.
   */
  predictNext(currentTool: string): string[] {
    const prev = this.callHistory.length > 1 ? this.callHistory[this.callHistory.length - 2] : null;

    if (prev) {
      const secondKey = `${prev}\u0001${currentTool}`;
      const secondTargets = this.transitions2.get(secondKey);
      const secondPredictions = this.pickPredictions(secondTargets);
      if (secondPredictions.length > 0) {
        return secondPredictions;
      }
    }

    return this.pickPredictions(this.transitions.get(currentTool));
  }

  /**
   * Get domains of predicted tools (for pre-activation).
   */
  predictNextDomains(
    currentTool: string,
    getToolDomain: (name: string) => string | null,
  ): string[] {
    const predictedTools = this.predictNext(currentTool);
    const domains = new Set<string>();

    for (const tool of predictedTools) {
      const domain = getToolDomain(tool);
      if (domain) {
        domains.add(domain);
      }
    }

    return [...domains];
  }

  /** Current history length. */
  get historyLength(): number {
    return this.callHistory.length;
  }

  /** Unique source states in the first-order transition table. */
  get transitionCount(): number {
    return this.transitions.size;
  }

  /** Unique context keys in the second-order transition table. */
  get secondOrderTransitionCount(): number {
    return this.transitions2.size;
  }

  /** Clear all history and transitions. */
  reset(): void {
    this.callHistory.length = 0;
    this.transitions.clear();
    this.transitions2.clear();
    this.callCounter = 0;
  }

  // ── internals ──

  /**
   * Fold decay accumulated since the entry's last touch into its value.
   *
   * Eager decay multiplied every entry by decayFactor on every recordCall,
   * so an entry with value v at call c reads v * decayFactor^(now - c) at
   * call `now`. Applying that power once on access is mathematically
   * equivalent and keeps recordCall independent of table size.
   */
  private materializeEntry(targets: Map<string, TransitionEntry>, tool: string): number {
    const entry = targets.get(tool);
    if (!entry) return 0;
    if (this.decayFactor >= 1) return entry.value;

    const elapsed = this.callCounter - entry.lastDecayAt;
    if (elapsed <= 0) return entry.value;

    const effective = entry.value * this.decayFactor ** elapsed;
    if (effective < 0.01) {
      // Same cutoff as the old eager decay: entries that per-call decay
      // would have deleted must not resurface.
      targets.delete(tool);
      return 0;
    }
    targets.set(tool, { value: effective, lastDecayAt: this.callCounter });
    return effective;
  }

  private bumpTransition(
    table: Map<string, Map<string, TransitionEntry>>,
    source: string,
    target: string,
  ): void {
    let targets = table.get(source);
    if (!targets) {
      targets = new Map<string, TransitionEntry>();
      table.set(source, targets);
      this.enforceKeyCap(table);
    }
    const effective = this.materializeEntry(targets, target);
    targets.set(target, { value: effective + 1, lastDecayAt: this.callCounter });
  }

  /** Drop the oldest source keys when the table exceeds its cap. */
  private enforceKeyCap(table: Map<string, Map<string, TransitionEntry>>): void {
    if (table.size <= this.maxSecondOrderKeys) return;
    const overflow = table.size - this.maxSecondOrderKeys;
    const iter = table.keys();
    for (let i = 0; i < overflow; i++) {
      const { value, done } = iter.next();
      if (done || !value) break;
      table.delete(value);
    }
  }

  private pickPredictions(targets: Map<string, TransitionEntry> | undefined): string[] {
    if (!targets || targets.size === 0) return [];

    let total = 0;
    const effective = new Map<string, number>();
    // Deleting the current entry during Map iteration is safe in JS, so no
    // key snapshot is needed even though materializeEntry may delete.
    for (const tool of targets.keys()) {
      const weight = this.materializeEntry(targets, tool);
      if (weight > 0) {
        effective.set(tool, weight);
        total += weight;
      }
    }
    if (total === 0) return [];

    const predictions: Array<{ tool: string; confidence: number }> = [];
    for (const [tool, count] of effective) {
      const confidence = count / total;
      if (confidence >= this.confidenceThreshold) {
        predictions.push({ tool, confidence });
      }
    }

    predictions.sort((a, b) => b.confidence - a.confidence);
    return predictions.map((p) => p.tool);
  }
}
