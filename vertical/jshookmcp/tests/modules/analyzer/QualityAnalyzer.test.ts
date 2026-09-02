import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

import {
  analyzeComplexityMetrics,
  calculateCodeSimilarity,
  calculateQualityScore,
  detectCodePatterns,
  detectDuplicateCode,
} from '@modules/analyzer/QualityAnalyzer';

describe('QualityAnalyzer helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('calculates weighted quality score with security/complexity penalties', () => {
    const score = calculateQualityScore(
      {
        functions: [{ complexity: 12 }],
        classes: [],
        modules: [],
        callGraph: { nodes: [], edges: [] },
      } as any,
      [{ severity: 'critical' }, { severity: 'high' }] as any,
      { qualityScore: 80 },
      { cyclomaticComplexity: 15, cognitiveComplexity: 12, maintainabilityIndex: 60 },
      [{ severity: 'high' }],
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(80);
  });

  it('clamps quality score to valid range', () => {
    const score = calculateQualityScore(
      { functions: [], classes: [], modules: [], callGraph: { nodes: [], edges: [] } } as any,
      Array.from({ length: 30 }, () => ({ severity: 'critical' })) as any,
      { qualityScore: -50 },
      { cyclomaticComplexity: 100, cognitiveComplexity: 100, maintainabilityIndex: -10 },
      Array.from({ length: 20 }, () => ({ severity: 'high' })) as any,
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('detects design patterns and anti-patterns from code', () => {
    const code = `
      class Subject {
        subscribe() {}
        unsubscribe() {}
        notify() {}
      }
      var magic = 42;
      try { throw new Error('x'); } catch (e) {}
    `;
    const result = detectCodePatterns(code);

    expect(result.patterns.some((p) => p.name === 'Observer Pattern')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Use of var')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Magic Number')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Empty Catch Block')).toBe(true);
  });

  it('computes complexity and halstead metrics for nested code', () => {
    const code = `
      function x(a, b) {
        if (a > 1 && b > 2) {
          for (let i = 0; i < 3; i++) {
            if (i % 2 === 0) return i + a;
          }
        }
        return 0;
      }
    `;
    const metrics = analyzeComplexityMetrics(code);

    expect(metrics.cyclomaticComplexity).toBeGreaterThan(1);
    expect(metrics.cognitiveComplexity).toBeGreaterThan(0);
    expect(metrics.halsteadMetrics.vocabulary).toBeGreaterThan(0);
  });

  it('detects duplicate functions from AST', () => {
    const code = `
      function alpha(x){ return x + 1; }
      function beta(y){ return y + 1; }
    `;
    const ast = parser.parse(code, { sourceType: 'module' });
    const duplicates = detectDuplicateCode(ast as any);

    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0]!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('measures similarity and rejects drastically different lengths', () => {
    const close = calculateCodeSimilarity('abc123', 'abc124');
    const far = calculateCodeSimilarity('short', 'x'.repeat(200));

    expect(close).toBeGreaterThan(0.7);
    expect(far).toBe(0);
  });

  it('falls back to structural complexity when metrics are omitted', () => {
    const score = calculateQualityScore(
      {
        functions: [{ complexity: 6 }, { complexity: 12 }],
        classes: [],
        modules: [],
        callGraph: { nodes: [], edges: [] },
      } as any,
      [{ severity: 'medium' }, { severity: 'low' }] as any,
      {},
      undefined,
      [{ severity: 'medium' }, { severity: 'low' }],
    );

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('applies the highest complexity penalties when thresholds are exceeded', () => {
    const score = calculateQualityScore(
      {
        functions: [{ complexity: 25 }],
        classes: [],
        modules: [],
        callGraph: { nodes: [], edges: [] },
      } as any,
      [{ severity: 'low' }] as any,
      {},
      { cyclomaticComplexity: 25, cognitiveComplexity: 20, maintainabilityIndex: 95 },
      [],
    );

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(100);
  });

  it('detects singleton, deep nesting, and long-function patterns while skipping common numeric cases', () => {
    const longBody = Array.from({ length: 55 }, () => '    doWork();').join('\n');
    const code = `
      const singleton = (function () {
        return { ready: true };
      })();

      class Subject {
        subscribe() {}
        unsubscribe() {}
        notify() {}
      }

      function longFn() {
${longBody}
      }

      function nested() {
        if (a) {
          for (let i = 0; i < 1; i++) {
            while (b) {
              if (c) {
                if (d) {
                  if (e) {
                    obj[42];
                    return x;
                  }
                }
              }
            }
          }
        }
      }

      function defaultParam(x = 42) {
        return x;
      }

      const common = 1;
    `;

    const result = detectCodePatterns(code);

    expect(result.patterns.some((p) => p.name === 'Singleton Pattern')).toBe(true);
    expect(result.patterns.some((p) => p.name === 'Observer Pattern')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Long Function')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Deep Nesting')).toBe(true);
    expect(result.antiPatterns.some((p) => p.name === 'Magic Number')).toBe(false);
  });

  it('returns empty pattern sets for invalid source code', () => {
    const result = detectCodePatterns('function broken( {');

    expect(result.patterns).toEqual([]);
    expect(result.antiPatterns).toEqual([]);
    expect(loggerState.warn).toHaveBeenCalled();
  });

  it('returns default metrics and logs on parse failure', () => {
    const metrics = analyzeComplexityMetrics('function broken( {');

    expect(metrics.cyclomaticComplexity).toBe(1);
    expect(metrics.cognitiveComplexity).toBe(0);
    expect(metrics.halsteadMetrics.vocabulary).toBe(0);
    expect(loggerState.warn).toHaveBeenCalled();
  });
});

describe('QualityAnalyzer scoring constants (FP batch B28)', () => {
  it('exposes env-overridable scoring weights with stable defaults', async () => {
    const constants = await import('@src/constants');
    expect(constants.QUALITY_WEIGHT_SECURITY).toBe(0.4);
    expect(constants.QUALITY_WEIGHT_COMPLEXITY).toBe(0.25);
    expect(constants.QUALITY_WEIGHT_MAINTAINABILITY).toBe(0.2);
    expect(constants.QUALITY_WEIGHT_CODE_SMELL).toBe(0.15);
  });

  it('exposes severity penalties and complexity bands with stable defaults', async () => {
    const constants = await import('@src/constants');
    expect(constants.QUALITY_SECURITY_PENALTY_CRITICAL).toBe(20);
    expect(constants.QUALITY_SECURITY_PENALTY_HIGH).toBe(10);
    expect(constants.QUALITY_SECURITY_PENALTY_MEDIUM).toBe(5);
    expect(constants.QUALITY_SECURITY_PENALTY_LOW).toBe(2);
    expect(constants.QUALITY_SMELL_PENALTY_HIGH).toBe(10);
    expect(constants.QUALITY_SMELL_PENALTY_MEDIUM).toBe(5);
    expect(constants.QUALITY_SMELL_PENALTY_LOW).toBe(2);
    expect(constants.QUALITY_COMPLEXITY_BAND_HIGH).toBe(20);
    expect(constants.QUALITY_COMPLEXITY_PENALTY_HIGH).toBe(30);
    expect(constants.QUALITY_COMPLEXITY_BAND_MEDIUM).toBe(10);
    expect(constants.QUALITY_COMPLEXITY_PENALTY_MEDIUM).toBe(15);
    expect(constants.QUALITY_COMPLEXITY_BAND_LOW).toBe(5);
    expect(constants.QUALITY_COGNITIVE_BAND_HIGH).toBe(15);
    expect(constants.QUALITY_COGNITIVE_PENALTY_HIGH).toBe(20);
    expect(constants.QUALITY_COGNITIVE_BAND_LOW).toBe(10);
    expect(constants.QUALITY_AVG_COMPLEXITY_BAND_HIGH).toBe(10);
    expect(constants.QUALITY_AVG_COMPLEXITY_PENALTY_HIGH).toBe(20);
    expect(constants.QUALITY_AVG_COMPLEXITY_BAND_LOW).toBe(5);
    expect(constants.QUALITY_DEFAULT_MAINTAINABILITY).toBe(70);
    expect(constants.QUALITY_DEFAULT_AI_SCORE).toBe(70);
  });
});
