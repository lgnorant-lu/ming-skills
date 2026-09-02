import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/constants', () => ({
  SEARCH_AFFINITY_BASE_WEIGHT: 0.3,
  SEARCH_AFFINITY_BOOST_FACTOR: 0.5,
  SEARCH_AFFINITY_TOP_N: 2,
  SEARCH_DOMAIN_HUB_THRESHOLD: 2,
  SEARCH_DOMAIN_HUB_BOOST_MULTIPLIER: 1.08,
  SEARCH_RRF_BM25_BLEND: 0.39,
  SEARCH_RRF_RESCALE_FACTOR: 2100,
}));

import {
  applyGraphExpansionToScores,
  blendRrfIntoScores,
  buildAffinityGraph,
  findDelimitedIndex,
  rankByMap,
  rankByScores,
} from '@server/search/ToolSearchEngine.helpers';

describe('search/ToolSearchEngine.helpers', () => {
  describe('buildAffinityGraph', () => {
    it('builds mutual edges only for prefix groups between 2 and 15 members', () => {
      const graph = buildAffinityGraph([
        { name: 'breakpoint_code', domain: 'debugger' },
        { name: 'breakpoint_event', domain: 'debugger' },
        { name: 'lonely', domain: 'browser' },
        ...Array.from({ length: 16 }, (_, index) => ({
          name: `huge_${index}`,
          domain: 'huge',
        })),
      ]);

      expect(graph.get(0)).toEqual([{ docIndex: 1, weight: 0.3 / Math.sqrt(2) }]);
      expect(graph.get(1)).toEqual([{ docIndex: 0, weight: 0.3 / Math.sqrt(2) }]);
      // Singleton group gets no edges
      expect(graph.has(2)).toBe(false);
      // Groups over 15 members are skipped entirely
      expect(graph.has(3)).toBe(false);
    });
  });

  describe('applyGraphExpansionToScores', () => {
    it('expands only already-relevant affinity neighbors', () => {
      const docs = [
        { name: 'breakpoint_code', domain: 'debugger' },
        { name: 'breakpoint_event', domain: 'debugger' },
        { name: 'page_navigate', domain: 'browser' },
      ];
      const graph = buildAffinityGraph(docs);
      const scores = new Float64Array([10, 1, 0]);

      applyGraphExpansionToScores({ scores, docs, affinityGraph: graph });

      expect(scores[1]).toBeGreaterThan(1);
      expect(scores[2]).toBe(0);
    });

    it('applies rank decay to affinity boosts of top results', () => {
      // Four distinct domains keep the domain-hub branch inert, isolating the
      // affinity-expansion arithmetic.
      const docs = [
        { name: 'breakpoint_code', domain: 'a' },
        { name: 'breakpoint_event', domain: 'b' },
        { name: 'page_navigate', domain: 'c' },
        { name: 'page_click', domain: 'd' },
      ];
      const graph = buildAffinityGraph(docs);
      const scores = new Float64Array([10, 1, 9, 1]);

      applyGraphExpansionToScores({ scores, docs, affinityGraph: graph });

      // Rank-0 neighbor boost: score * weight * (1/(1+0)) * boostFactor
      const boostRank0 = 10 * (0.3 / Math.sqrt(2)) * 1 * 0.5;
      // Rank-1 neighbor boost: score * weight * (1/(1+1)) * boostFactor
      const boostRank1 = 9 * (0.3 / Math.sqrt(2)) * 0.5 * 0.5;
      expect(scores[1]).toBeCloseTo(1 + boostRank0);
      expect(scores[3]).toBeCloseTo(1 + boostRank1);
    });

    it('applies domain hub expansion only when a domain reaches the threshold', () => {
      // Distinct name prefixes keep the affinity graph empty, isolating the
      // domain-hub branch.
      const docs = [
        { name: 'alpha_one', domain: 'debugger' },
        { name: 'beta_two', domain: 'debugger' },
        { name: 'gamma_three', domain: 'browser' },
        { name: 'delta_four', domain: 'browser' },
      ];
      const graph = buildAffinityGraph(docs);
      const scores = new Float64Array([3, 2, 1, 4]);

      applyGraphExpansionToScores({ scores, docs, affinityGraph: graph });

      expect(scores[0]).toBeCloseTo(3 * 1.08);
      expect(scores[1]).toBeCloseTo(2 * 1.08);
      expect(scores[2]).toBeCloseTo(1 * 1.08);
      expect(scores[3]).toBeCloseTo(4 * 1.08);
    });
  });

  describe('findDelimitedIndex', () => {
    const wordChar = /[a-z0-9_]/i;

    it('finds a needle only at word boundaries', () => {
      // Space-delimited occurrence at the start of the string matches
      expect(findDelimitedIndex('fetch events and fetcher', 'fetch', wordChar)).toBe(0);
      // Underscore is a word char for the identifier variant — not delimited
      expect(findDelimitedIndex('fetch_events and fetcher', 'fetch', wordChar)).toBe(-1);
      // "fetcher" contains "fetch" but the following char is a word char
      expect(findDelimitedIndex('a fetcher', 'fetch', wordChar)).toBe(-1);
    });

    it('finds later occurrences when the first is not delimited', () => {
      const haystack = 'fetcher fetch';
      expect(findDelimitedIndex(haystack, 'fetch', wordChar)).toBe(8);
    });

    it('returns -1 when no delimited occurrence exists', () => {
      expect(findDelimitedIndex('fetcher', 'fetch', wordChar)).toBe(-1);
      expect(findDelimitedIndex('', 'fetch', wordChar)).toBe(-1);
      expect(findDelimitedIndex('anything', '', wordChar)).toBe(-1);
    });
  });

  describe('rankByScores / rankByMap', () => {
    it('ranks only positive scores from highest to lowest', () => {
      const ranked = rankByScores(new Float64Array([0, 5, 3, 0, 7]));
      expect([...ranked.entries()]).toEqual([
        [4, 0],
        [1, 1],
        [2, 2],
      ]);
    });

    it('ranks map entries from highest score to lowest', () => {
      const ranked = rankByMap(
        new Map([
          [0, 0.1],
          [1, 0.9],
          [2, 0.5],
        ]),
      );
      expect([...ranked.entries()]).toEqual([
        [1, 0],
        [2, 1],
        [0, 2],
      ]);
    });
  });

  describe('blendRrfIntoScores', () => {
    it('adds rescaled RRF scores into BM25 scores only for positive RRF entries', () => {
      const scores = new Float64Array([10, 5, 3]);
      const rrfScores = new Float64Array([0.02, 0, 0.01]);

      blendRrfIntoScores(scores, rrfScores);

      expect(scores[0]).toBeCloseTo(10 + 0.02 * 2100 * 0.39);
      expect(scores[1]).toBe(5);
      expect(scores[2]).toBeCloseTo(3 + 0.01 * 2100 * 0.39);
    });
  });
});
