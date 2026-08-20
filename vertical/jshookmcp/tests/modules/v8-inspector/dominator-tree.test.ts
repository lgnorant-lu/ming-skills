import { describe, expect, it } from 'vitest';
import { DominatorTreeBuilder } from '@modules/v8-inspector/DominatorTreeBuilder';
import type { ParsedNode, ParsedEdge } from '@modules/v8-inspector/HeapSnapshotParser';

describe('DominatorTreeBuilder', () => {
  describe('simple graph dominator computation', () => {
    it('should compute dominators for a simple linear chain', () => {
      // Graph: 1 -> 2 -> 3
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      expect(tree.children.length).toBe(1);
      expect(tree.children[0]!.nodeId).toBe(2);
      expect(tree.children[0]!.children.length).toBe(1);
      expect(tree.children[0]!.children[0]!.nodeId).toBe(3);
    });

    it('should compute dominators for a diamond graph', () => {
      // Graph: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 100, type: 'object' },
        { id: 4, name: 'C', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'b', type: 'property' },
        { fromId: 2, toId: 4, nameOrIndex: 'c', type: 'property' },
        { fromId: 3, toId: 4, nameOrIndex: 'c', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      // Root should dominate all
      expect(tree.nodeId).toBe(1);
      // Node 4 has two paths, so it should be dominated by root
      const node4 = findNodeInTree(tree, 4);
      expect(node4).toBeDefined();
    });

    it('should handle graphs with cycles', () => {
      // Graph with cycle: 1 -> 2 -> 3 -> 2
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
        { fromId: 3, toId: 2, nameOrIndex: 'back', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      expect(tree.children.length).toBeGreaterThan(0);
    });

    it('should handle disconnected components', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 100, type: 'object' },
      ];

      // Only 1 -> 2, node 3 is disconnected
      const edges: ParsedEdge[] = [{ fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' }];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      // Should handle gracefully
      expect(tree.children.length).toBeGreaterThan(0);
    });
  });

  describe('retained size computation', () => {
    it('should compute retained sizes correctly for linear chain', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'ref', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(300); // 0 + 100 + 200
      expect(tree.children[0]!.retainedSize).toBe(300); // 100 + 200
      expect(tree.children[0]!.children[0]!.retainedSize).toBe(200); // 200
    });

    it('should compute retained sizes for branching tree', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 10, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
        { id: 4, name: 'C', selfSize: 50, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'b', type: 'property' },
        { fromId: 2, toId: 4, nameOrIndex: 'c', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(360); // 10 + 100 + 200 + 50
    });

    it('should handle zero shallow sizes', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 0, type: 'object' },
      ];

      const edges: ParsedEdge[] = [{ fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' }];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.retainedSize).toBe(0);
    });
  });

  describe('non-trivial graphs (Lengauer-Tarjan eval)', () => {
    // The previous `eval` stub returned `v` and so computed semi-dominators
    // using `semi[v]` instead of the minimum-semi ancestor on the DFS path.
    // That is wrong for any node reachable via a cross/forward edge whose
    // semidominator is *not* one of its direct DFS predecessors. The graph
    // below is hand-computable and distinguishes the stub from a correct LT.
    //
    //   1 (root) → 2 → 3
    //       └──→ 4 ───↗
    //   1 → 5 → 6 → 3   (5 and 6 only reach 3, not 2/4)
    //
    // Edges (DFS from 1 in adjacency order [2,4,5]):
    //   1→2, 1→4, 1→5, 2→3, 4→3, 5→6, 6→3
    //
    // Three distinct paths reach node 3: 1→2→3, 1→4→3, 1→5→6→3. The only
    // node that dominates 3 across all three paths is the root (1), so
    // idom(3) = 1. A buggy eval that ignores the 6→3 cross edge would let
    // semi(3) collapse to dfn(2) (the first DFS predecessor), yielding
    // idom(3) = 2 — wrong. This fixture pins idom(3) = 1.
    it('computes correct idom for a node reachable via cross/forward edges', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 10, type: 'object' },
        { id: 3, name: 'Sink', selfSize: 100, type: 'object' },
        { id: 4, name: 'B', selfSize: 10, type: 'object' },
        { id: 5, name: 'C', selfSize: 10, type: 'object' },
        { id: 6, name: 'D', selfSize: 10, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 4, nameOrIndex: 'b', type: 'property' },
        { fromId: 1, toId: 5, nameOrIndex: 'c', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'r', type: 'property' },
        { fromId: 4, toId: 3, nameOrIndex: 'r', type: 'property' },
        { fromId: 5, toId: 6, nameOrIndex: 'r', type: 'property' },
        { fromId: 6, toId: 3, nameOrIndex: 'r', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      // idom(3) must be 1 (root), NOT 2 — the cross edge 6→3 means 2 does not
      // dominate 3. Assert via the dominator tree: 3 must be a direct child of
      // the root, not a child of 2.
      const node3 = findNodeInTree(tree, 3);
      expect(node3).toBeDefined();
      const parentOf3 = findParent(tree, 3);
      expect(parentOf3).toBe(1);
    });

    // Nested diamond with a back-skipping forward edge.
    //   1 → 2 → 3 → 5
    //   1 → 4 → 5
    //   2 → 5      (forward edge skips 3)
    // idom(2)=1, idom(4)=1, idom(3)=2, idom(5)=1 (2→5 forward + 4→5 + 3→5
    // mean only root dominates 5). Retained sizes are hand-computable so we
    // also pin them: root retains everything (sum of self sizes).
    it('computes correct idom for a nested diamond with a forward edge', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 5, type: 'synthetic' },
        { id: 2, name: 'A', selfSize: 100, type: 'object' },
        { id: 3, name: 'B', selfSize: 200, type: 'object' },
        { id: 4, name: 'C', selfSize: 100, type: 'object' },
        { id: 5, name: 'D', selfSize: 300, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 4, nameOrIndex: 'b', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'c', type: 'property' },
        { fromId: 3, toId: 5, nameOrIndex: 'e', type: 'property' },
        { fromId: 4, toId: 5, nameOrIndex: 'e', type: 'property' },
        { fromId: 2, toId: 5, nameOrIndex: 'f', type: 'property' }, // forward (skips 3)
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);

      expect(tree.nodeId).toBe(1);
      // 5 is reachable via 1→2→5, 1→4→5, 1→2→3→5 → only root dominates 5.
      expect(findParent(tree, 5)).toBe(1);
      // 3's only parent in the dom tree is 2 (only path to 3 is through 2).
      expect(findParent(tree, 3)).toBe(2);
      // 4's only parent is the root.
      expect(findParent(tree, 4)).toBe(1);
      // Root retains the full graph: 5 + 100 + 200 + 100 + 300 = 705.
      expect(tree.retainedSize).toBe(705);
      // Node 2 still dominates 3, so 2 retains self(100) + 3(200) = 300.
      const node2 = findNodeInTree(tree, 2);
      expect(node2?.retainedSize).toBe(300);
    });
  });

  describe('leak detection', () => {
    it('should detect detached DOM nodes with explicit marker', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Detached HTMLDivElement', selfSize: 2048, type: 'object' },
      ];

      const edges: ParsedEdge[] = [{ fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' }];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find((l) => l.reason === 'detached-dom');
      expect(detachedLeak).toBeDefined();
      expect(detachedLeak?.confidence).toBeGreaterThan(0.8);
    });

    it('should detect DOM nodes with low connectivity', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'HTMLElement', selfSize: 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [{ fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' }];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find((l) => l.reason === 'detached-dom' && l.nodeId === 2);
      expect(detachedLeak).toBeDefined();
    });

    it('should detect large arrays', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Array', selfSize: 2 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [{ fromId: 1, toId: 2, nameOrIndex: 'ref', type: 'property' }];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 1024 * 1024);

      const arrayLeak = leaks.find((l) => l.reason === 'large-array');
      expect(arrayLeak).toBeDefined();
      expect(arrayLeak?.retainedSize).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    });

    it('should detect closure leaks', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Function', selfSize: 100, type: 'closure' },
        { id: 3, name: 'Context', selfSize: 5 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'fn', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'context', type: 'internal' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 1024 * 1024);

      const closureLeak = leaks.find((l) => l.reason === 'closure-leak');
      expect(closureLeak).toBeDefined();
    });

    it('should sort leaks by confidence then by size', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Detached HTMLElement', selfSize: 1024, type: 'object' },
        { id: 3, name: 'Array', selfSize: 10 * 1024 * 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'dom', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'arr', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      expect(leaks.length).toBeGreaterThan(0);
      // First leak should have highest confidence
      for (let i = 1; i < leaks.length; i++) {
        if (Math.abs(leaks[i - 1]!.confidence - leaks[i]!.confidence) > 0.01) {
          expect(leaks[i - 1]!.confidence).toBeGreaterThanOrEqual(leaks[i]!.confidence);
        }
      }
    });

    it('should include retaining paths in leak candidates', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'Container', selfSize: 100, type: 'object' },
        { id: 3, name: 'Detached HTMLElement', selfSize: 1024, type: 'object' },
      ];

      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'container', type: 'property' },
        { fromId: 2, toId: 3, nameOrIndex: 'element', type: 'property' },
      ];

      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const leaks = builder.findLeakCandidates(tree, 0);

      const detachedLeak = leaks.find((l) => l.reason === 'detached-dom');
      expect(detachedLeak?.path).toBeDefined();
      expect(detachedLeak?.path.length).toBeGreaterThan(0);
    });
  });

  describe('getRetainedByFunctionName minRetainedSize filter', () => {
    // The v8_function_retained handler wires args.minRetainedSize (advertised
    // in the tool schema) through to the 4th param of getRetainedByFunctionName.
    // Pin the filter behavior here at the builder level so a regression that
    // drops the arg reads as a red test, not a silently-wider result set.
    it('returns all matching nodes when minRetainedSize is 0', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'FuncSmall', selfSize: 1_000, type: 'object' },
        { id: 3, name: 'FuncLarge', selfSize: 5_000_000, type: 'object' },
      ];
      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'b', type: 'property' },
      ];
      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      const all = builder.getRetainedByFunctionName('Func', tree, 50, 0);
      expect(all.length).toBe(2);
    });

    it('filters out nodes below the threshold and keeps larger ones', () => {
      const nodes: ParsedNode[] = [
        { id: 1, name: 'Root', selfSize: 0, type: 'synthetic' },
        { id: 2, name: 'FuncSmall', selfSize: 1_000, type: 'object' },
        { id: 3, name: 'FuncLarge', selfSize: 5_000_000, type: 'object' },
      ];
      const edges: ParsedEdge[] = [
        { fromId: 1, toId: 2, nameOrIndex: 'a', type: 'property' },
        { fromId: 1, toId: 3, nameOrIndex: 'b', type: 'property' },
      ];
      const builder = new DominatorTreeBuilder();
      const tree = builder.buildDominatorTree(nodes, edges);
      // Threshold just above the small node's retained (== self, leaf) size.
      const filtered = builder.getRetainedByFunctionName('Func', tree, 50, 1_001);
      expect(filtered.length).toBe(1);
      expect(filtered[0]!.name).toBe('FuncLarge');
    });
  });

  describe('performance', () => {
    it('should handle 10k nodes within 2 seconds', () => {
      const nodeCount = 10000;
      const nodes: ParsedNode[] = [{ id: 1, name: 'Root', selfSize: 0, type: 'synthetic' }];
      const edges: ParsedEdge[] = [];

      for (let i = 2; i <= nodeCount; i++) {
        nodes.push({
          id: i,
          name: `Node${i}`,
          selfSize: Math.floor(Math.random() * 1000) + 100,
          type: 'object',
        });

        // Create edges to form a tree-like structure
        const parentId = Math.floor(Math.random() * (i - 1)) + 1;
        edges.push({
          fromId: parentId,
          toId: i,
          nameOrIndex: `ref${i}`,
          type: 'property',
        });
      }

      const builder = new DominatorTreeBuilder();
      const startTime = Date.now();
      const tree = builder.buildDominatorTree(nodes, edges);
      const elapsedMs = Date.now() - startTime;

      expect(tree.nodeId).toBe(1);
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});

// Helper function to find a node in the tree
function findNodeInTree(tree: any, nodeId: number): any {
  if (tree.nodeId === nodeId) {
    return tree;
  }

  for (const child of tree.children || []) {
    const found = findNodeInTree(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

// Helper: walk the dominator tree and return the nodeId of the parent of
// `targetId`, or undefined if the target is the root / not present.
function findParent(tree: any, targetId: number): number | undefined {
  const stack: any[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    for (const child of node.children || []) {
      if (child.nodeId === targetId) return node.nodeId;
      stack.push(child);
    }
  }
  return undefined;
}
