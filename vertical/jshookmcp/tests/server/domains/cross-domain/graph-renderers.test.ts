import { describe, expect, it } from 'vitest';
import type { EvidenceEdge, EvidenceGraphSnapshot, EvidenceNode } from '@server/evidence/types';
import {
  renderEvidenceGraphDot,
  renderEvidenceGraphMermaid,
} from '@server/domains/cross-domain/handlers/graph-renderers';

function node(id: string, type: EvidenceNode['type'], label: string): EvidenceNode {
  return { id, type, label, metadata: {}, createdAt: 0 };
}

function edge(
  id: string,
  source: string,
  target: string,
  type: EvidenceEdge['type'],
): EvidenceEdge {
  return { id, source, target, type };
}

const EMPTY: EvidenceGraphSnapshot = { version: 1, exportedAt: 't', nodes: [], edges: [] };

describe('renderEvidenceGraphMermaid', () => {
  it('emits a flowchart header and comment even for an empty graph', () => {
    const rendered = renderEvidenceGraphMermaid(EMPTY);
    expect(rendered.format).toBe('mermaid');
    expect(rendered.content.startsWith('flowchart LR\n')).toBe(true);
    expect(rendered.content).toContain('0 nodes, 0 edges');
    expect(rendered.nodeCount).toBe(0);
    expect(rendered.edgeCount).toBe(0);
    expect(rendered.renderedNodes).toBe(0);
    expect(rendered.renderedEdges).toBe(0);
    expect(rendered.truncated).toEqual({ nodes: 0, edges: 0 });
  });

  it('renders nodes and edges with stable N<index> identifiers', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'signRequest'), node('b', 'network-request', 'GET /api')],
      edges: [edge('e1', 'a', 'b', 'network-initiated-by')],
    };
    const rendered = renderEvidenceGraphMermaid(snapshot);
    const lines = rendered.content.split('\n');
    expect(lines).toContain('  N0["signRequest"]');
    expect(lines).toContain('  N1["GET /api"]');
    expect(lines).toContain('  N0 -- "network-initiated-by" --> N1');
    expect(rendered.renderedNodes).toBe(2);
    expect(rendered.renderedEdges).toBe(1);
  });

  it('escapes characters that would break the mermaid grammar', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'has "quote" and [bracket]\nnewline')],
      edges: [],
    };
    const rendered = renderEvidenceGraphMermaid(snapshot);
    const nodeLine = rendered.content.split('\n').find((line) => line.includes('N0'))!;
    // The label body (inside the mermaid ["..."]) must not carry unescaped quotes,
    // square brackets, or newlines — those would prematurely close the node shape.
    const labelBody = nodeLine.slice(nodeLine.indexOf('['), nodeLine.lastIndexOf(']') + 1);
    expect(labelBody).toContain('(bracket)');
    expect(labelBody).not.toContain('[bracket]');
    expect(labelBody).not.toContain('"quote"');
    expect(labelBody).toContain("'quote'");
    expect(labelBody).not.toContain('\n');
  });

  it('truncates nodes by budget and drops dangling edges', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [
        node('a', 'function', 'fnA'),
        node('b', 'function', 'fnB'),
        node('c', 'function', 'fnC'),
      ],
      edges: [
        edge('e1', 'a', 'b', 'correlates'),
        edge('e2', 'b', 'c', 'correlates'), // c is truncated → dangling
      ],
    };
    const rendered = renderEvidenceGraphMermaid(snapshot, { maxNodes: 2 });
    expect(rendered.renderedNodes).toBe(2);
    expect(rendered.renderedEdges).toBe(1); // only e1
    expect(rendered.truncated.nodes).toBe(1);
    expect(rendered.truncated.edges).toBe(1); // e2 dropped (dangling after node truncation)
    expect(rendered.content).toContain('N0');
    expect(rendered.content).toContain('N1');
    expect(rendered.content).not.toContain('N2');
  });

  it('truncates edges by budget while keeping node count intact', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'fnA'), node('b', 'function', 'fnB')],
      edges: [edge('e1', 'a', 'b', 'correlates'), edge('e2', 'a', 'b', 'references')],
    };
    const rendered = renderEvidenceGraphMermaid(snapshot, { maxEdges: 1 });
    expect(rendered.renderedNodes).toBe(2);
    expect(rendered.renderedEdges).toBe(1);
    expect(rendered.truncated.edges).toBe(1);
  });

  it('truncates over-long labels with an ellipsis', () => {
    const longLabel = 'A'.repeat(120);
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', longLabel)],
      edges: [],
    };
    const rendered = renderEvidenceGraphMermaid(snapshot, { labelMaxLength: 10 });
    const nodeLine = rendered.content.split('\n').find((line) => line.includes('N0'))!;
    expect(nodeLine).toContain('…');
    expect(nodeLine.length).toBeLessThan(longLabel.length);
  });
});

describe('renderEvidenceGraphDot', () => {
  it('emits a digraph header and closing brace for an empty graph', () => {
    const rendered = renderEvidenceGraphDot(EMPTY);
    expect(rendered.format).toBe('dot');
    expect(rendered.content.startsWith('digraph evidence {\n')).toBe(true);
    expect(rendered.content.trim().endsWith('}')).toBe(true);
    expect(rendered.content).toContain('rankdir=LR;');
  });

  it('renders nodes and edges in graphviz syntax', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'signRequest'), node('b', 'network-request', 'GET /api')],
      edges: [edge('e1', 'a', 'b', 'network-initiated-by')],
    };
    const rendered = renderEvidenceGraphDot(snapshot);
    expect(rendered.content).toContain('"N0" [label="signRequest"];');
    expect(rendered.content).toContain('"N1" [label="GET /api"];');
    expect(rendered.content).toContain('"N0" -> "N1" [label="network-initiated-by"];');
  });

  it('escapes quotes and backslashes for graphviz', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'path\\to "thing"')],
      edges: [],
    };
    const rendered = renderEvidenceGraphDot(snapshot);
    expect(rendered.content).toContain('path\\\\to \\"thing\\"');
  });

  it('honors maxNodes truncation and reports counts truthfully', () => {
    const snapshot: EvidenceGraphSnapshot = {
      ...EMPTY,
      nodes: [node('a', 'function', 'fnA'), node('b', 'function', 'fnB')],
      edges: [],
    };
    const rendered = renderEvidenceGraphDot(snapshot, { maxNodes: 1 });
    expect(rendered.nodeCount).toBe(2);
    expect(rendered.renderedNodes).toBe(1);
    expect(rendered.truncated.nodes).toBe(1);
    expect(rendered.content).toContain('"N0"');
    expect(rendered.content).not.toContain('"N1"');
  });
});
