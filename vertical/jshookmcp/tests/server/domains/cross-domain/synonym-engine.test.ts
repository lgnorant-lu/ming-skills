import { describe, expect, it } from 'vitest';
import {
  querySynonyms,
  getSynonymGraphMeta,
} from '@server/domains/cross-domain/handlers/synonym-engine';

describe('synonym-engine', () => {
  describe('querySynonyms', () => {
    it('returns empty for empty query', () => {
      expect(querySynonyms('')).toEqual([]);
      expect(querySynonyms('  ')).toEqual([]);
    });

    it('matches direct synonyms to tools', () => {
      const results = querySynonyms('deobfuscate this code');
      expect(results.length).toBeGreaterThan(0);
      const deobf = results.find((r) => r.concept === 'deobfuscation');
      expect(deobf).toBeDefined();
      expect(deobf!.recommendedTools).toContain('deobfuscate');
    });

    it('matches network analysis keywords', () => {
      const results = querySynonyms('intercept http requests and export har');
      const network = results.find((r) => r.concept === 'network-analysis');
      expect(network).toBeDefined();
      expect(network!.recommendedTools).toContain('network_enable');
      expect(network!.recommendedTools).toContain('network_export_har');
    });

    it('matches memory heap concepts', () => {
      const results = querySynonyms('find memory leaks in the heap');
      const memory = results.find((r) => r.concept === 'memory-heap');
      expect(memory).toBeDefined();
      expect(memory!.recommendedTools).toContain('v8_heap_find_leaks');
    });

    it('matches debugging concepts', () => {
      const results = querySynonyms('set a breakpoint and inspect the call stack');
      const debug = results.find((r) => r.concept === 'debugging');
      expect(debug).toBeDefined();
      expect(debug!.recommendedTools).toContain('breakpoint');
      expect(debug!.recommendedTools).toContain('get_call_stack');
    });

    it('matches multiple concepts in one query', () => {
      const results = querySynonyms('hook network requests and deobfuscate the api calls');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('scores higher confidence matches first', () => {
      const results = querySynonyms('debug graphql');
      expect(results.length).toBeGreaterThan(0);
      // First result should have highest score
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it('respects maxResults limit', () => {
      const results = querySynonyms('network debug memory heap hook intercept', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('matches crypto detection', () => {
      const results = querySynonyms('detect aes encryption and sha hashing');
      const crypto = results.find((r) => r.concept === 'crypto-detection');
      expect(crypto).toBeDefined();
    });

    it('matches webgpu shader concepts', () => {
      const results = querySynonyms('capture the webgpu shader and inspect the pipeline');
      const gpu = results.find((r) => r.concept === 'webgpu-shader');
      expect(gpu).toBeDefined();
    });

    it('returns no results for unrelated query', () => {
      const results = querySynonyms('xyzzy nothing matches this nonsense');
      expect(results).toEqual([]);
    });
  });

  describe('getSynonymGraphMeta', () => {
    it('returns graph metadata', () => {
      const meta = getSynonymGraphMeta();
      expect(meta.conceptCount).toBeGreaterThan(0);
      expect(meta.totalToolReferences).toBeGreaterThan(0);
      expect(meta.concepts.length).toBe(meta.conceptCount);
      for (const c of meta.concepts) {
        expect(c.concept).toBeTruthy();
        expect(c.synonymCount).toBeGreaterThan(0);
        expect(c.toolCount).toBeGreaterThan(0);
      }
    });
  });
});
