import { beforeEach, describe, expect, it } from 'vitest';
import {
  CrossDomainEvidenceBridge,
  resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  resetIdCounter as resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';
import { correlateNetworkToV8 } from '@server/domains/cross-domain/handlers/network-v8-correlator';
import type { NetworkRequest } from '@server/domains/cross-domain/handlers/mojo-cdp-correlator';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('correlateNetworkToV8', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    resetIdCounter();
    resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  });

  it('returns an empty result when no network requests are supplied', () => {
    const result = correlateNetworkToV8(bridge, []);
    expect(result.networkRequests).toBe(0);
    expect(result.correlations).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(bridge.exportGraph().nodes).toHaveLength(0);
  });

  it('links a request to a pre-existing heap object by initiator.heapAddress at confidence 1.0', () => {
    const heap = bridge.addV8Object({ address: '0xdeadbeef', name: 'HttpClient' });
    const requests: NetworkRequest[] = [
      {
        requestId: 'req-1',
        url: withPath(TEST_URLS.api, 'v1/sign'),
        timestamp: 10,
        initiator: { heapAddress: '0xdeadbeef' },
      },
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations).toHaveLength(1);
    expect(result.correlations[0]).toMatchObject({
      requestId: 'req-1',
      matchType: 'heap-address',
      confidence: 1.0,
      initiatorHeapAddress: '0xdeadbeef',
    });
    expect(result.unmatched).toEqual([]);

    const graph = bridge.exportGraph();
    const initiatedEdges = graph.edges.filter((e) => e.type === 'network-initiated-by');
    expect(initiatedEdges).toHaveLength(1);
    expect(initiatedEdges[0]!.source).toBe(heap.id);
    expect(initiatedEdges[0]!.metadata).toMatchObject({
      confidence: 1.0,
      matchType: 'heap-address',
    });
  });

  it('links to a pre-existing function node at confidence 0.8', () => {
    const fn = bridge.addNode('function', 'signRequest', {
      domain: 'v8-inspector',
      functionName: 'signRequest',
    });
    const requests: NetworkRequest[] = [
      {
        requestId: 'req-2',
        url: withPath(TEST_URLS.api, 'v1/sign'),
        timestamp: 20,
        initiator: { functionName: 'signRequest' },
      },
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations[0]).toMatchObject({
      matchType: 'function-name',
      confidence: 0.8,
      initiatorFunctionName: 'signRequest',
    });
    // Should reuse the existing function node, not create a duplicate.
    const functionNodes = bridge.exportGraph().nodes.filter((n) => n.type === 'function');
    expect(functionNodes).toHaveLength(1);
    expect(functionNodes[0]!.id).toBe(fn.id);
  });

  it('creates a best-effort function node at confidence 0.5 when no match exists', () => {
    const requests: NetworkRequest[] = [
      {
        requestId: 'req-3',
        url: withPath(TEST_URLS.api, 'v1/fetch'),
        timestamp: 30,
        initiator: { functionName: 'unknownCaller' },
      },
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations[0]).toMatchObject({ matchType: 'function-name', confidence: 0.5 });
    const functionNodes = bridge
      .exportGraph()
      .nodes.filter((n) => n.metadata['functionName'] === 'unknownCaller');
    expect(functionNodes).toHaveLength(1);
  });

  it('falls back to the first stack frame as a stack-frame match', () => {
    const requests: NetworkRequest[] = [
      {
        requestId: 'req-4',
        url: withPath(TEST_URLS.api, 'v1/x'),
        timestamp: 40,
        initiator: { stack: ['', 'frameTwo', 'frameThree'] },
      },
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations[0]).toMatchObject({ matchType: 'stack-frame', confidence: 0.5 });
    expect(result.correlations[0]!.initiatorFunctionName).toBeUndefined();
    const functionNodes = bridge
      .exportGraph()
      .nodes.filter((n) => n.metadata['functionName'] === 'frameTwo');
    expect(functionNodes).toHaveLength(1);
  });

  it('records unmatched when a request carries no initiator', () => {
    const requests: NetworkRequest[] = [
      { requestId: 'req-5', url: withPath(TEST_URLS.api, 'v1/plain'), timestamp: 50 },
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations).toEqual([]);
    expect(result.unmatched).toEqual(['req-5']);
    // Still adds the network-request node so it is queryable downstream.
    expect(bridge.exportGraph().nodes.some((n) => n.type === 'network-request')).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('reuses a network-request node previously created by addNetworkRequest', () => {
    const pre = bridge.addNetworkRequest({
      requestId: 'req-6',
      url: withPath(TEST_URLS.api, 'v1/dup'),
    });
    const fn = bridge.addNode('function', 'knownCaller', {
      domain: 'v8-inspector',
      functionName: 'knownCaller',
    });
    const requests: NetworkRequest[] = [
      {
        requestId: 'req-6',
        url: withPath(TEST_URLS.api, 'v1/dup'),
        timestamp: 60,
        initiator: { functionName: 'knownCaller' },
      },
    ];

    correlateNetworkToV8(bridge, requests);

    const networkNodes = bridge.exportGraph().nodes.filter((n) => n.type === 'network-request');
    expect(networkNodes).toHaveLength(1);
    expect(networkNodes[0]!.id).toBe(pre.node.id);
    const edges = bridge.exportGraph().edges.filter((e) => e.type === 'network-initiated-by');
    expect(edges[0]!.source).toBe(fn.id);
    expect(edges[0]!.target).toBe(pre.node.id);
  });

  it('aggregates confidence across a mixed batch', () => {
    bridge.addV8Object({ address: '0xaaa', name: 'Obj' });
    const requests: NetworkRequest[] = [
      {
        requestId: 'r1',
        url: withPath(TEST_URLS.api, '1'),
        timestamp: 1,
        initiator: { heapAddress: '0xaaa' },
      }, // 1.0
      {
        requestId: 'r2',
        url: withPath(TEST_URLS.api, '2'),
        timestamp: 2,
        initiator: { functionName: 'lonely' },
      }, // 0.5
      { requestId: 'r3', url: withPath(TEST_URLS.api, '3'), timestamp: 3 }, // unmatched
    ];

    const result = correlateNetworkToV8(bridge, requests);

    expect(result.correlations).toHaveLength(2);
    expect(result.unmatched).toEqual(['r3']);
    expect(result.confidence).toBeCloseTo(2 / 3, 3);
  });
});
