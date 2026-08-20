import { describe, expect, it } from 'vitest';
import type { EvidenceEdge, EvidenceGraphSnapshot, EvidenceNode } from '@server/evidence/types';
import { computeEvidenceGraphQuality } from '@server/domains/cross-domain/handlers.impl';

function node(id: string, type: EvidenceNode['type'], label: string): EvidenceNode {
  return { id, type, label, metadata: {}, createdAt: 0 };
}

function edge(
  id: string,
  source: string,
  target: string,
  type: EvidenceEdge['type'],
  metadata?: Record<string, unknown>,
): EvidenceEdge {
  return { id, source, target, type, ...(metadata ? { metadata } : {}) };
}

const EMPTY: EvidenceGraphSnapshot = { version: 1, exportedAt: 't', nodes: [], edges: [] };

describe('cross_domain_evidence_stats quality metrics', () => {
  it('breaks down edges by type and confidence buckets', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [
        node('a', 'function', 'fnA'),
        node('b', 'v8-heap-object', 'objB'),
        node('c', 'network-request', 'reqC'),
        node('orphan', 'script', 'scrO'),
      ],
      edges: [
        edge('e1', 'a', 'b', 'heap-allocates', { confidence: 0.9 }),
        edge('e2', 'b', 'c', 'network-initiated-by', { matchScore: 0.5 }),
        edge('e3', 'a', 'c', 'correlates', { confidence: 0.1 }),
        edge('e4', 'a', 'b', 'references'), // no confidence metadata → none
      ],
    };

    const q = computeEvidenceGraphQuality(snapshot);

    expect(q.edgesByType).toEqual({
      'heap-allocates': 1,
      'network-initiated-by': 1,
      correlates: 1,
      references: 1,
    });
    expect(q.confidenceBuckets).toEqual({ high: 1, medium: 1, low: 1, none: 1 });
    expect(q.avgConfidence).toBeCloseTo((0.9 + 0.5 + 0.1) / 3, 3);
    expect(q.orphanNodeCount).toBe(1);
    // a and b each touch 3 edges (a: e1/e3/e4, b: e1/e2/e4); c touches 2.
    expect(q.topNodesByDegree[0]!.degree).toBe(3);
    expect(['a', 'b']).toContain(q.topNodesByDegree[0]!.nodeId);
  });

  it('treats high/medium/low string confidence labels', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('x', 'function', 'x'), node('y', 'function', 'y')],
      edges: [
        edge('e1', 'x', 'y', 'correlates', { confidence: 'high' }),
        edge('e2', 'x', 'y', 'correlates', { confidence: 'medium' }),
        edge('e3', 'x', 'y', 'correlates', { confidence: 'low' }),
      ],
    };
    const q = computeEvidenceGraphQuality(snapshot);
    expect(q.confidenceBuckets).toEqual({ high: 1, medium: 1, low: 1, none: 0 });
    expect(q.avgConfidence).toBeCloseTo((0.9 + 0.6 + 0.3) / 3, 3);
  });

  it('handles an empty graph', () => {
    const q = computeEvidenceGraphQuality(EMPTY);
    expect(q.orphanNodeCount).toBe(0);
    expect(q.avgConfidence).toBe(0);
    expect(q.topNodesByDegree).toEqual([]);
    expect(q.confidenceBuckets).toEqual({ high: 0, medium: 0, low: 0, none: 0 });
    expect(q.edgesByType).toEqual({});
  });
});
