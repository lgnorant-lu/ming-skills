import type { EvidenceNode } from '@server/evidence/types';
import type { NetworkInitiator, NetworkRequest } from './mojo-cdp-correlator';
import type { CrossDomainEvidenceBridge } from './evidence-graph-bridge';

export interface NetworkV8Correlation {
  requestId: string;
  matchType: 'heap-address' | 'function-name' | 'stack-frame' | 'none';
  initiatorFunctionName?: string;
  initiatorHeapAddress?: string;
  confidence: number;
}

export interface NetworkV8CorrelatorResult {
  networkRequests: number;
  correlations: NetworkV8Correlation[];
  unmatched: string[];
  confidence: number;
  graphNodeIds: string[];
}

function ensureRequestId(req: NetworkRequest, index: number): string {
  return req.requestId && req.requestId.length > 0 ? req.requestId : `network:${index}:${req.url}`;
}

function firstStackFrame(frames: string[] | undefined): string | undefined {
  if (!frames) return undefined;
  return frames.find((frame) => typeof frame === 'string' && frame.length > 0);
}

/**
 * NETWORK↔V8 correlator. For every network request that carries an `initiator`,
 * resolves the initiator against existing `v8-heap-object` (by address) or
 * `function` (by functionName) evidence nodes and records a
 * `network-initiated-by` edge. Reuses network-request nodes already created by
 * MOJO-03 (matched by `requestId`) so the graph stays deduplicated regardless of
 * correlator ordering.
 *
 * Confidence ladder:
 *  - 1.0  initiator.heapAddress resolved to an existing heap-object node
 *  - 0.8  initiator.functionName resolved to an existing function node
 *  - 0.5  initiator.functionName/stack[0] had no existing node — a best-effort
 *         function node is created so the chain is still traceable, but the link
 *         lacks independent corroboration.
 */
export function correlateNetworkToV8(
  bridge: CrossDomainEvidenceBridge,
  networkRequests: NetworkRequest[],
): NetworkV8CorrelatorResult {
  const graphNodeIds: string[] = [];
  const correlations: NetworkV8Correlation[] = [];
  const unmatched: string[] = [];

  if (networkRequests.length === 0) {
    return { networkRequests: 0, correlations, unmatched, confidence: 0, graphNodeIds };
  }

  const snapshot = bridge.exportGraph();
  const networkByRequestId = new Map<string, string>();
  const functionByName = new Map<string, string>();
  const heapByAddress = new Map<string, string>();
  for (const node of snapshot.nodes as EvidenceNode[]) {
    if (node.type === 'network-request' && typeof node.metadata['requestId'] === 'string') {
      networkByRequestId.set(node.metadata['requestId'], node.id);
    } else if (node.type === 'function' && typeof node.metadata['functionName'] === 'string') {
      functionByName.set(node.metadata['functionName'], node.id);
    } else if (node.type === 'v8-heap-object' && typeof node.metadata['address'] === 'string') {
      heapByAddress.set(node.metadata['address'], node.id);
    }
  }

  networkRequests.forEach((req, index) => {
    const requestId = ensureRequestId(req, index);
    let netNodeId = networkByRequestId.get(requestId);
    if (!netNodeId) {
      const { node } = bridge.addNetworkRequest({
        requestId,
        url: req.url,
        method: req.method,
      });
      netNodeId = node.id;
      networkByRequestId.set(requestId, node.id);
      graphNodeIds.push(node.id);
    }

    const initiator: NetworkInitiator | undefined = req.initiator;
    let linkedNodeId: string | undefined;
    let matchType: NetworkV8Correlation['matchType'] = 'none';
    let confidence = 0;

    if (initiator?.heapAddress) {
      const heapId = heapByAddress.get(initiator.heapAddress);
      if (heapId) {
        linkedNodeId = heapId;
        matchType = 'heap-address';
        confidence = 1.0;
      }
    }

    if (!linkedNodeId) {
      const explicitFunction = initiator?.functionName;
      const stackFrame = firstStackFrame(initiator?.stack);
      const fnName =
        explicitFunction && explicitFunction.length > 0 ? explicitFunction : stackFrame;
      if (fnName) {
        const existingFn = functionByName.get(fnName);
        if (existingFn) {
          linkedNodeId = existingFn;
          confidence = 0.8;
        } else {
          const created = bridge.addNode('function', fnName, {
            domain: 'v8-inspector',
            functionName: fnName,
          });
          functionByName.set(fnName, created.id);
          graphNodeIds.push(created.id);
          linkedNodeId = created.id;
          confidence = 0.5;
        }
        matchType =
          explicitFunction && explicitFunction.length > 0 ? 'function-name' : 'stack-frame';
      }
    }

    if (linkedNodeId) {
      bridge.getGraph().addEdge(linkedNodeId, netNodeId, 'network-initiated-by', {
        domain: 'cross-domain',
        relation: 'initiator-triggers-network',
        confidence,
        matchType,
      });
      correlations.push({
        requestId,
        matchType,
        initiatorFunctionName: initiator?.functionName,
        initiatorHeapAddress: initiator?.heapAddress,
        confidence,
      });
    } else {
      unmatched.push(requestId);
    }
  });

  const confidence = correlations.length / networkRequests.length;
  return {
    networkRequests: networkRequests.length,
    correlations,
    unmatched,
    confidence,
    graphNodeIds,
  };
}
