import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReverseEvidenceGraph, resetIdCounter } from '@server/evidence/ReverseEvidenceGraph';
import type { EvidenceNodeType } from '@server/evidence/types';
import * as testUrls from '@tests/shared/test-urls';
import { logger } from '@utils/logger';

describe('ReverseEvidenceGraph (EVID-01~03, EVID-05)', () => {
  let graph: ReverseEvidenceGraph;

  beforeEach(() => {
    resetIdCounter();
    graph = new ReverseEvidenceGraph();
  });

  // ── EVID-01: Data Structure ──────────────────────────

  describe('CRUD operations', () => {
    it('addNode creates a node with correct type and metadata', () => {
      const node = graph.addNode('request', 'GET /api/auth', {
        url: `${testUrls.TEST_URLS.root}/api/auth`,
        method: 'GET',
      });

      expect(node.id).toMatch(/^request-/);
      expect(node.type).toBe('request');
      expect(node.label).toBe('GET /api/auth');
      expect(node.metadata.url).toBe(`${testUrls.TEST_URLS.root}/api/auth`);
      expect(node.metadata.method).toBe('GET');
      expect(node.createdAt).toBeGreaterThan(0);
    });

    it('addEdge links two nodes with typed relationship', () => {
      const req = graph.addNode('request', 'GET /api/data', { url: '/api/data' });
      const stack = graph.addNode('initiator-stack', 'fetch stack', {});
      const edge = graph.addEdge(req.id, stack.id, 'initiates');

      expect(edge.source).toBe(req.id);
      expect(edge.target).toBe(stack.id);
      expect(edge.type).toBe('initiates');
    });

    it('addEdge throws for missing source/target', () => {
      const node = graph.addNode('request', 'req', {});
      expect(() => graph.addEdge('missing', node.id, 'initiates')).toThrow('Source node');
      expect(() => graph.addEdge(node.id, 'missing', 'initiates')).toThrow('Target node');
    });

    it('getNode returns undefined for missing ID', () => {
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    it('removeNode cascades edge removal', () => {
      const a = graph.addNode('script', 'main.js', {});
      const b = graph.addNode('function', 'decrypt', {});
      graph.addEdge(a.id, b.id, 'contains');

      expect(graph.edgeCount).toBe(1);
      graph.removeNode(a.id);
      expect(graph.getNode(a.id)).toBeUndefined();
      expect(graph.edgeCount).toBe(0);
    });

    it('removeNode returns false for missing node', () => {
      expect(graph.removeNode('nonexistent')).toBe(false);
    });
  });

  describe('EventBus Commit Transactions', () => {
    it('does not emit updates until commit is called', () => {
      let fired = false;
      const fakeBus = {
        emit: () => {
          fired = true;
          return Promise.resolve();
        },
      } as any;
      graph.setEventBus(fakeBus);

      graph.addNode('script', 'test.js', {});
      expect(fired).toBe(false);

      graph.commit();
      expect(fired).toBe(true);
    });

    it('does not emit on commit if isDirty is false', () => {
      let fired = false;
      const fakeBus = {
        emit: () => {
          fired = true;
          return Promise.resolve();
        },
      } as any;
      graph.setEventBus(fakeBus);

      // Clean graph
      graph.commit();
      expect(fired).toBe(false);
    });
  });

  // ── EVID-01: 7 Node Types ────────────────────────────

  it('supports all 7 node types', () => {
    const types: EvidenceNodeType[] = [
      'request',
      'initiator-stack',
      'script',
      'function',
      'breakpoint-hook',
      'captured-data',
      'replay-artifact',
    ];

    for (const type of types) {
      const node = graph.addNode(type, `test-${type}`, { testType: type });
      expect(node.type).toBe(type);
      expect(graph.getNode(node.id)).toBeDefined();
    }
    expect(graph.nodeCount).toBe(7);
  });

  // ── Chain traversal ──────────────────────────────────

  describe('getEvidenceChain', () => {
    it('traverses forward chain from request to artifact', () => {
      const req = graph.addNode('request', 'GET /api', { url: '/api' });
      const stack = graph.addNode('initiator-stack', 'fetch', {});
      const script = graph.addNode('script', 'app.js', { scriptId: '1' });
      const func = graph.addNode('function', 'handleAuth', { functionName: 'handleAuth' });
      const hook = graph.addNode('breakpoint-hook', 'hook:handleAuth', {});
      const data = graph.addNode('captured-data', 'auth tokens', {});

      graph.addEdge(req.id, stack.id, 'initiates');
      graph.addEdge(stack.id, script.id, 'loads');
      graph.addEdge(script.id, func.id, 'contains');
      graph.addEdge(func.id, hook.id, 'triggers');
      graph.addEdge(hook.id, data.id, 'captures');

      const chain = graph.getEvidenceChain(req.id, 'forward');
      expect(chain).toHaveLength(6);
      expect(chain[0]!.id).toBe(req.id);
      expect(chain[chain.length - 1]!.id).toBe(data.id);
    });

    it('traverses backward chain from captured-data to request', () => {
      const req = graph.addNode('request', 'req', {});
      const data = graph.addNode('captured-data', 'data', {});
      graph.addEdge(req.id, data.id, 'captures');

      const chain = graph.getEvidenceChain(data.id, 'backward');
      expect(chain).toHaveLength(2);
      expect(chain.map((n) => n.id)).toContain(req.id);
    });

    it('returns empty array for missing node', () => {
      expect(graph.getEvidenceChain('missing')).toEqual([]);
    });

    it('handles cyclic graphs gracefully without infinite loops', () => {
      const a = graph.addNode('function', 'a', {});
      const b = graph.addNode('function', 'b', {});
      graph.addEdge(a.id, b.id, 'triggers');
      graph.addEdge(b.id, a.id, 'triggers'); // Cycle

      const chain = graph.getEvidenceChain(a.id, 'forward');
      expect(chain).toHaveLength(2); // Should only visit a and b once
    });
  });

  // ── EVID-02: Query Engine ────────────────────────────

  describe('queryByUrl', () => {
    it('returns all nodes associated with a URL', () => {
      const req = graph.addNode('request', 'GET /api/auth', {
        url: `${testUrls.TEST_URLS.root}/api/auth`,
      });
      const stack = graph.addNode('initiator-stack', 'fetch', {});
      const unrelated = graph.addNode('request', 'unrelated', { url: testUrls.TEST_URLS.other });
      graph.addEdge(req.id, stack.id, 'initiates');

      const result = graph.queryByUrl(`${testUrls.TEST_HOSTS.root}/api/auth`);
      const ids = result.map((n) => n.id);
      expect(ids).toContain(req.id);
      expect(ids).toContain(stack.id);
      expect(ids).not.toContain(unrelated.id);
    });

    it('returns non-request nodes if they contain url metadata', () => {
      const func = graph.addNode('function', 'someFunc', {
        url: `${testUrls.TEST_URLS.root}/api/test`,
      });
      const unrelated = graph.addNode('script', 'unrelated', { url: testUrls.TEST_URLS.other });

      const result = graph.queryByUrl(`${testUrls.TEST_HOSTS.root}/api/test`);
      const ids = result.map((n) => n.id);
      expect(ids).toContain(func.id);
      expect(ids).not.toContain(unrelated.id);
    });
  });

  describe('queryByFunction', () => {
    it('returns matching function/hook/captured-data chain', () => {
      const func = graph.addNode('function', 'decrypt', { functionName: 'decrypt' });
      const hook = graph.addNode('breakpoint-hook', 'hook:decrypt', {});
      const data = graph.addNode('captured-data', 'key material', {});
      const unrelated = graph.addNode('function', 'encrypt', { functionName: 'encrypt' });

      graph.addEdge(func.id, hook.id, 'triggers');
      graph.addEdge(hook.id, data.id, 'captures');

      const result = graph.queryByFunction('decrypt');
      const ids = result.map((n) => n.id);
      expect(ids).toContain(func.id);
      expect(ids).toContain(hook.id);
      expect(ids).toContain(data.id);
      expect(ids).not.toContain(unrelated.id);
    });
  });

  describe('queryByScriptId', () => {
    it('returns script + associated nodes', () => {
      const script = graph.addNode('script', 'main.js', { scriptId: 'script-42' });
      const func = graph.addNode('function', 'init', { functionName: 'init' });
      const unrelated = graph.addNode('script', 'other.js', { scriptId: 'script-99' });

      graph.addEdge(script.id, func.id, 'contains');

      const result = graph.queryByScriptId('script-42');
      const ids = result.map((n) => n.id);
      expect(ids).toContain(script.id);
      expect(ids).toContain(func.id);
      expect(ids).not.toContain(unrelated.id);
    });
  });

  // ── EVID-03: Export ──────────────────────────────────

  describe('exportJson', () => {
    it('produces valid JSON with nodes and edges', () => {
      const a = graph.addNode('request', 'req', { url: '/api' });
      const b = graph.addNode('script', 'app.js', {});
      graph.addEdge(a.id, b.id, 'loads');

      const snapshot = graph.exportJson();
      expect(snapshot.version).toBe(1);
      expect(snapshot.nodes).toHaveLength(2);
      expect(snapshot.edges).toHaveLength(1);
      expect(snapshot.exportedAt).toMatch(/^\d{4}-/);
    });
  });

  describe('snapshot persistence', () => {
    it('re-seeds the ID counter on restore so new nodes cannot collide with restored ids', () => {
      // Build a snapshot containing request-1 / request-2, then simulate a fresh
      // process (counter reset at module level) restoring it.
      const source = new ReverseEvidenceGraph();
      const n1 = source.addNode('request', 'original a', { url: '/a' });
      const n2 = source.addNode('request', 'original b', { url: '/b' });
      const snapshot = source.exportSnapshot();
      expect(n1.id).toBe('request-1');
      expect(n2.id).toBe('request-2');

      resetIdCounter();

      const restored = new ReverseEvidenceGraph();
      restored.restoreSnapshot(snapshot);
      expect(restored.nodeCount).toBe(2);

      // The next node must NOT reuse request-1 (which would silently overwrite
      // the restored entry in the nodes Map).
      const n3 = restored.addNode('request', 'fresh c', { url: '/c' });
      expect(n3.id).toBe('request-3');
      expect(restored.nodeCount).toBe(3);
      expect(restored.getNode('request-1')!.label).toBe('original a');
      expect(restored.getNode('request-3')!.label).toBe('fresh c');
    });

    it('re-seeds the counter past edge ids as well', () => {
      const source = new ReverseEvidenceGraph();
      const a = source.addNode('request', 'a');
      const b = source.addNode('script', 'b');
      const e = source.addEdge(a.id, b.id, 'loads');
      expect(e.id).toBe('edge-3'); // counter shared across node/edge prefixes

      resetIdCounter();
      const restored = new ReverseEvidenceGraph();
      restored.restoreSnapshot(source.exportSnapshot());

      const x = restored.addNode('request', 'x');
      const y = restored.addNode('script', 'y');
      restored.addEdge(x.id, y.id, 'loads');
      // No collision with edge-3 from the snapshot.
      expect(restored.getEdgesFrom(x.id)).toHaveLength(1);
    });

    it('ignores invalid snapshots', () => {
      const graph2 = new ReverseEvidenceGraph();
      graph2.restoreSnapshot(null);
      graph2.restoreSnapshot({ schemaVersion: 2, graph: { nodes: [], edges: [] } });
      expect(graph2.nodeCount).toBe(0);
    });

    it('trims restored nodes and edges back to the configured caps', () => {
      const source = new ReverseEvidenceGraph();
      const nodes = Array.from({ length: 6 }, (_, i) => source.addNode('request', `n${i}`, {}));
      for (let i = 0; i < nodes.length - 1; i++) {
        source.addEdge(nodes[i]!.id, nodes[i + 1]!.id, 'triggers');
      }
      const snapshot = source.exportSnapshot();
      resetIdCounter();

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const capped = new ReverseEvidenceGraph({ maxNodes: 3, maxEdges: 2 });
      capped.restoreSnapshot(snapshot);
      warnSpy.mockRestore();

      expect(capped.nodeCount).toBe(3);
      expect(capped.edgeCount).toBe(2);
      expect(capped.droppedNodeCount).toBe(3);
    });

    it('restoreSnapshot returns the counts dropped by the restore trim', () => {
      const source = new ReverseEvidenceGraph();
      const nodes = Array.from({ length: 6 }, (_, i) => source.addNode('request', `n${i}`, {}));
      for (let i = 0; i < nodes.length - 1; i++) {
        source.addEdge(nodes[i]!.id, nodes[i + 1]!.id, 'triggers');
      }
      const snapshot = source.exportSnapshot();
      resetIdCounter();

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const capped = new ReverseEvidenceGraph({ maxNodes: 3, maxEdges: 2 });
      const dropped = capped.restoreSnapshot(snapshot);
      warnSpy.mockRestore();

      // 3 oldest nodes evicted, cascading 3 connected edges; the 2 surviving
      // edges stay under the edge cap.
      expect(dropped).toEqual({ droppedNodes: 3, droppedEdges: 3 });
    });

    it('restoreSnapshot reports zero drops for a snapshot within the caps', () => {
      const source = new ReverseEvidenceGraph();
      source.addNode('request', 'a', {});
      source.addNode('request', 'b', {});
      const snapshot = source.exportSnapshot();
      resetIdCounter();

      const restored = new ReverseEvidenceGraph();
      const dropped = restored.restoreSnapshot(snapshot);
      expect(dropped).toEqual({ droppedNodes: 0, droppedEdges: 0 });
    });

    it('restoreSnapshot reports zero drops for an invalid snapshot', () => {
      const graph2 = new ReverseEvidenceGraph();
      expect(graph2.restoreSnapshot(null)).toEqual({ droppedNodes: 0, droppedEdges: 0 });
      expect(graph2.restoreSnapshot({ schemaVersion: 2, graph: { nodes: [], edges: [] } })).toEqual(
        {
          droppedNodes: 0,
          droppedEdges: 0,
        },
      );
    });
  });

  describe('unbounded growth caps (a3-02)', () => {
    it('evicts the oldest nodes when the node cap is exceeded and counts drops', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 3, maxEdges: 10 });
      const n1 = capped.addNode('request', 'n1', {});
      capped.addNode('request', 'n2', {});
      capped.addNode('request', 'n3', {});
      const n4 = capped.addNode('request', 'n4', {});

      expect(capped.nodeCount).toBe(3);
      expect(capped.getNode(n1.id)).toBeUndefined(); // oldest evicted
      expect(capped.getNode(n4.id)).toBeDefined();
      expect(capped.droppedNodeCount).toBe(1);
    });

    it('evicts the oldest edges when the edge cap is exceeded and counts drops', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 10, maxEdges: 2 });
      const nodes = Array.from({ length: 4 }, (_, i) => capped.addNode('function', `f${i}`, {}));
      capped.addEdge(nodes[0]!.id, nodes[1]!.id, 'triggers');
      capped.addEdge(nodes[1]!.id, nodes[2]!.id, 'triggers');
      capped.addEdge(nodes[2]!.id, nodes[3]!.id, 'triggers');

      expect(capped.edgeCount).toBe(2);
      expect(capped.getEdgesFrom(nodes[0]!.id)).toHaveLength(0); // e1 evicted
      expect(capped.getEdgesFrom(nodes[1]!.id)).toHaveLength(1); // e2 survives
      expect(capped.droppedEdgeCount).toBe(1);
    });

    it('cascades connected-edge removal when a node is evicted', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 2, maxEdges: 10 });
      const a = capped.addNode('script', 'a', {});
      const b = capped.addNode('function', 'b', {});
      capped.addEdge(a.id, b.id, 'contains');

      capped.addNode('function', 'c', {}); // evicts node a

      expect(capped.getNode(a.id)).toBeUndefined();
      expect(capped.edgeCount).toBe(0); // edge a→b cascaded away
      expect(capped.droppedNodeCount).toBe(1);
    });

    it('does not evict anything below the cap', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 5, maxEdges: 5 });
      for (let i = 0; i < 3; i++) {
        const n = capped.addNode('request', `r${i}`, {});
        capped.addEdge(n.id, n.id, 'references');
      }
      expect(capped.nodeCount).toBe(3);
      expect(capped.edgeCount).toBe(3);
      expect(capped.droppedNodeCount).toBe(0);
      expect(capped.droppedEdgeCount).toBe(0);
    });

    it('counts node-eviction cascade edges as dropped', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 2, maxEdges: 10 });
      const a = capped.addNode('script', 'a', {});
      const b = capped.addNode('function', 'b', {});
      capped.addEdge(a.id, b.id, 'contains');
      capped.addNode('function', 'c', {}); // evicts a → cascades the edge

      expect(capped.droppedNodeCount).toBe(1);
      expect(capped.droppedEdgeCount).toBe(1); // cascade edges are observable drops
    });
  });

  describe('eviction observability (security-s3)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('warns once per node-eviction batch', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const capped = new ReverseEvidenceGraph({ maxNodes: 2, maxEdges: 10 });
      capped.addNode('request', 'n1', {});
      capped.addNode('request', 'n2', {});
      capped.addNode('request', 'n3', {}); // one eviction batch

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('evicted'));
    });

    it('warns once per edge-eviction batch', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const capped = new ReverseEvidenceGraph({ maxNodes: 10, maxEdges: 1 });
      const nodes = Array.from({ length: 3 }, (_, i) => capped.addNode('function', `f${i}`, {}));
      capped.addEdge(nodes[0]!.id, nodes[1]!.id, 'triggers');
      capped.addEdge(nodes[1]!.id, nodes[2]!.id, 'triggers'); // evicts the first edge

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('evicted'));
    });

    it('emits evidence-evicted event with batch counts', () => {
      const emitted: Array<{ event: string; payload: Record<string, unknown> }> = [];
      const fakeBus = {
        emit: (event: string, payload: Record<string, unknown>) => {
          emitted.push({ event, payload });
          return Promise.resolve();
        },
      } as any;
      const capped = new ReverseEvidenceGraph({ maxNodes: 2, maxEdges: 10 });
      capped.setEventBus(fakeBus);

      capped.addNode('request', 'n1', {});
      capped.addNode('request', 'n2', {});
      capped.addNode('request', 'n3', {}); // evicts n1

      const evict = emitted.find((e) => e.event === 'evidence-evicted');
      expect(evict).toBeDefined();
      expect(evict!.payload.reason).toBe('node-cap');
      expect(evict!.payload.droppedNodes).toBe(1);
      expect(evict!.payload.droppedEdges).toBe(0);
    });

    it('exportSnapshot reports cumulative dropped counts', () => {
      const capped = new ReverseEvidenceGraph({ maxNodes: 2, maxEdges: 10 });
      capped.addNode('request', 'n1', {});
      capped.addNode('request', 'n2', {});
      capped.addNode('request', 'n3', {}); // evicts n1

      const snap = capped.exportSnapshot();
      expect(snap.droppedNodes).toBe(1);
      expect(snap.droppedEdges).toBe(0);
    });
  });

  describe('exportMarkdown', () => {
    it('produces readable report with sections per node type', () => {
      graph.addNode('request', 'GET /api/data', { url: '/api/data' });
      graph.addNode('function', 'processData', { functionName: 'processData' });

      const md = graph.exportMarkdown();
      expect(md).toContain('# Reverse Evidence Graph Report');
      expect(md).toContain('## request (1)');
      expect(md).toContain('## function (1)');
      expect(md).toContain('GET /api/data');
      expect(md).toContain('processData');
    });

    it('produces readable report with connected edges and complex metadata', () => {
      const a = graph.addNode('request', 'GET /api/data', { count: 42, complex: { flag: true } });
      const b = graph.addNode('function', 'processData', {});
      graph.addEdge(a.id, b.id, 'initiates');

      const md = graph.exportMarkdown();
      expect(md).toContain('**→ Out:**');
      expect(md).toContain('**← In:**');
      expect(md).toContain('**count:** 42');
      expect(md).toContain('**complex:** {"flag":true}');
    });
  });
});
