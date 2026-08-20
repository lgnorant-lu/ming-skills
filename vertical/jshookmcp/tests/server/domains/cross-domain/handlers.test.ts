import { describe, expect, it, beforeEach } from 'vitest';
import { CrossDomainHandlers } from '@server/domains/cross-domain/handlers';
import { ResponseBuilder } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import {
  CrossDomainEvidenceBridge,
  resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import { CrossDomainWorkflowClassifier } from '@server/domains/cross-domain/handlers';
import { WORKFLOWS } from '@server/domains/cross-domain/workflows/missions';
import {
  ReverseEvidenceGraph,
  resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

describe('CrossDomainHandlers', () => {
  let bridge: CrossDomainEvidenceBridge;
  let handlers: CrossDomainHandlers;

  beforeEach(() => {
    resetIdCounter();
    _resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
    handlers = new CrossDomainHandlers(bridge);
  });

  describe('handleCapabilities', () => {
    it('should return capability flags with workflow classifier unavailable', async () => {
      const result = (await handlers.handleCapabilities({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.capabilities).toBeDefined();
      expect(typeof data.capabilities.evidenceGraphAvailable).toBe('boolean');
    });
  });

  describe('handleSuggestWorkflow', () => {
    it('should return message when workflow classifier is unavailable', async () => {
      const result = (await handlers.handleSuggestWorkflow({
        query: 'completely unrelated xyz123',
      })) as {
        content: Array<{ text: string }>;
      };
      // Returns message when classifier not provided
      // @ts-expect-error
      expect(result.content[0].text).toContain('Cross-domain');
    });
  });

  describe('handleEvidenceExport', () => {
    it('should export the evidence graph snapshot', async () => {
      bridge.addV8Object({ address: '0x1', name: 'Test' });
      const result = (await handlers.handleEvidenceExport()) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.version).toBe(1);
      expect(data.nodes.length).toBeGreaterThan(0);
    });
  });

  describe('handleEvidenceQuery', () => {
    it('queries network URLs and returns edges between matched nodes', async () => {
      const heap = bridge.addV8Object({ address: '0x100', name: 'FetchWrapper' });
      const { node: request } = bridge.addNetworkRequest(
        { requestId: 'req-1', url: withPath(TEST_URLS.api, 'secure'), method: 'POST' },
        heap.id,
      );

      const result = await handlers.handleEvidenceQuery({
        queryType: 'network_url',
        value: 'secure',
      });
      const data = ResponseBuilder.parse<Record<string, any>>(result);

      expect(data.total).toBe(2);
      expect(data.nodes.map((node: Record<string, unknown>) => node.id)).toEqual(
        expect.arrayContaining([heap.id, request.id]),
      );
      expect(data.edges).toHaveLength(1);
      expect(data.edges[0].type).toBe('network-initiated-by');
    });

    it('queries evidence nodes by metadata key and value', async () => {
      const symbol = bridge.addBinarySymbol({
        moduleName: 'libnative.so',
        symbolName: 'native_encrypt',
        address: '0x7fff0000',
      });

      const result = await handlers.handleEvidenceQuery({
        queryType: 'metadata',
        metadataKey: 'moduleName',
        metadataValue: 'libnative.so',
      });
      const data = ResponseBuilder.parse<Record<string, any>>(result);

      expect(data.total).toBe(1);
      expect(data.nodes[0].id).toBe(symbol.id);
    });

    it('queries evidence chains by node id and direction', async () => {
      const heap = bridge.addV8Object({ address: '0x200', name: 'SceneFactory' });
      const canvas = bridge.addCanvasNode({ nodeId: 'layer-1', label: 'SceneLayer' }, heap.id);

      const result = await handlers.handleEvidenceQuery({
        queryType: 'chain',
        value: heap.id,
        direction: 'forward',
      });
      const data = ResponseBuilder.parse<Record<string, any>>(result);

      expect(data.nodes.map((node: Record<string, unknown>) => node.id)).toEqual([
        heap.id,
        canvas.id,
      ]);
      expect(data.edges[0].type).toBe('canvas-rendered-by');
    });

    it('rejects invalid evidence chain directions', async () => {
      await expect(
        handlers.handleEvidenceQuery({
          queryType: 'chain',
          value: 'node_1',
          direction: 'sideways',
        }),
      ).rejects.toThrow('Invalid evidence chain direction');
    });

    it('rejects metadata queries without a metadataKey', async () => {
      await expect(handlers.handleEvidenceQuery({ queryType: 'metadata' })).rejects.toThrow(
        'metadataKey is required',
      );
    });
  });

  describe('handleEvidenceStats', () => {
    it('should return evidence graph statistics', async () => {
      bridge.addV8Object({ address: '0xA', name: 'ObjA' });
      bridge.addNetworkRequest({ url: 'https://test.com' });
      const result = (await handlers.handleEvidenceStats()) as { content: Array<{ text: string }> };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.nodeCount).toBe(2);
      expect(data.edgeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handleCorrelateAll', () => {
    it('should run SKIA correlation and return results', async () => {
      const result = (await handlers.handleCorrelateAll({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.correlationResults).toBeDefined();
      // SKIA-03 should run and add nodes to the graph
      expect(data.correlationResults.errors).toBeDefined();
    });

    it('should return evidence graph snapshot in result', async () => {
      const result = (await handlers.handleCorrelateAll({})) as {
        content: Array<{ text: string }>;
      };
      // @ts-expect-error
      const data = JSON.parse(result.content[0].text);
      expect(data.evidenceGraph).toBeDefined();
      expect(data.evidenceGraph.version).toBe(1);
    });

    it('pulls missing inputs from live domain tools when requested', async () => {
      const calls: string[] = [];
      const ctx = {
        executeToolWithTracking: async (name: string) => {
          calls.push(name);
          if (name === 'skia_extract_scene') {
            return asJsonResponse({
              sceneTree: {
                layers: [{ id: 'layer-1', label: 'PlayerSprite', type: 'layer' }],
                drawCommands: [],
              },
            });
          }
          if (name === 'mojo_messages_get') {
            return asJsonResponse({ messages: [] });
          }
          if (name === 'network_get_requests') {
            return asJsonResponse({ requests: [] });
          }
          if (name === 'syscall_capture_events') {
            return asJsonResponse({ events: [] });
          }
          if (name === 'syscall_stack_capture') {
            return asJsonResponse({ events: [] });
          }
          return asJsonResponse({});
        },
      };
      handlers = new CrossDomainHandlers(bridge, undefined, ctx as any);

      const result = await handlers.handleCorrelateAll({
        pullFromDomains: true,
        jsObjects: [
          {
            objectId: 'heap-1',
            className: 'Sprite',
            name: 'PlayerSprite',
            stringProps: [],
            numericProps: {},
            colorProps: [],
            urlProps: [],
          },
        ],
      });

      const data = ResponseBuilder.parse<Record<string, any>>(result);
      expect(calls).toContain('skia_extract_scene');
      expect(data.correlationResults.liveState.sources.sceneTree.fetched).toBe(true);
      expect(data.correlationResults.skia.correlations).toHaveLength(1);
    });

    it('filters returned evidence edges by confidence', async () => {
      const result = await handlers.handleCorrelateAll({
        minConfidence: 0.5,
        syscallEvents: [{ pid: 1, tid: 2, syscallName: 'NtOpenFile', timestamp: 10 }],
        jsStacks: [{ threadId: 2, timestamp: 10, frames: [{ functionName: 'unrelated' }] }],
      });

      const data = ResponseBuilder.parse<Record<string, any>>(result);
      expect(data.correlationResults.syscall.correlations).toHaveLength(1);
      expect(data.evidenceGraph.edges).toHaveLength(0);
      expect(data.evidenceGraph.edgeFilterSummary.removedByConfidence).toBeGreaterThan(0);
    });

    it('truncates returned evidence edges per type', async () => {
      const result = await handlers.handleCorrelateAll({
        maxEdgesPerType: 1,
        sceneTree: {
          layers: [
            { id: 'layer-1', label: 'SpriteA', type: 'layer' },
            { id: 'layer-2', label: 'SpriteB', type: 'layer' },
          ],
          drawCommands: [],
        },
        jsObjects: [
          {
            objectId: 'heap-1',
            className: 'Sprite',
            name: 'SpriteA',
            stringProps: [],
            numericProps: {},
            colorProps: [],
            urlProps: [],
          },
          {
            objectId: 'heap-2',
            className: 'Sprite',
            name: 'SpriteB',
            stringProps: [],
            numericProps: {},
            colorProps: [],
            urlProps: [],
          },
        ],
      });

      const data = ResponseBuilder.parse<Record<string, any>>(result);
      const canvasEdges = data.evidenceGraph.edges.filter(
        (edge: Record<string, unknown>) => edge.type === 'canvas-rendered-by',
      );
      expect(canvasEdges).toHaveLength(1);
      expect(data.evidenceGraph.edgeFilterSummary.truncatedByType['canvas-rendered-by']).toBe(1);
    });
  });

  describe('CrossDomainWorkflowClassifier', () => {
    it('ships expanded workflow templates for common cross-domain reverse tasks', async () => {
      expect(Object.keys(WORKFLOWS)).toEqual(
        expect.arrayContaining([
          'WORKFLOW_NETWORK_V8_INITIATOR',
          'WORKFLOW_DEBUGGER_V8_CONTEXT',
          'WORKFLOW_WASM_MEMORY_TRACE',
          'WORKFLOW_GRAPHQL_API_REPLAY',
        ]),
      );
    });

    it('reports expanded v5 domain support', async () => {
      const ctx = {
        enabledDomains: new Set(['webgpu', 'trace']),
        selectedTools: [],
        resolveEnabledDomains: () => new Set<string>(),
      };
      const classifier = new CrossDomainWorkflowClassifier(ctx as any, true);
      const capabilities = classifier.getCapabilities();
      expect(capabilities.supportedDomains).toContain('webgpu');
      expect(capabilities.supportedDomains).toContain('trace');
      expect(capabilities.availableDomains).toEqual(['trace', 'webgpu']);
    });

    it('suggests the network/V8 workflow for request signing goals', async () => {
      const ctx = {
        enabledDomains: new Set(['cross-domain', 'network', 'v8-inspector']),
        selectedTools: [],
        resolveEnabledDomains: () => new Set<string>(),
      };
      const classifier = new CrossDomainWorkflowClassifier(ctx as any, true);

      const suggestion = classifier.suggestWorkflow(
        'find the JS function that signs fetch API requests',
        true,
      );

      expect(suggestion.id).toBe('network-v8-initiator');
      expect(suggestion.requiredDomains).toEqual(['network', 'v8-inspector', 'cross-domain']);
      expect(suggestion.coverage).toBe(1);
    });

    it('suggests the debugger/V8 workflow for breakpoint scope goals', async () => {
      const ctx = {
        enabledDomains: new Set(['debugger', 'v8-inspector']),
        selectedTools: [],
        resolveEnabledDomains: () => new Set<string>(),
      };
      const classifier = new CrossDomainWorkflowClassifier(ctx as any, true);

      const suggestion = classifier.suggestWorkflow(
        'pause at a breakpoint and inspect stack scope variables',
        true,
      );

      expect(suggestion.id).toBe('debugger-v8-pause-context');
      expect(suggestion.requiredDomains).toEqual(['debugger', 'v8-inspector']);
      expect(suggestion.coverage).toBe(1);
    });
  });

  describe('MCP-safe tool wrappers', () => {
    it('returns existing ToolResponse payloads without nesting', async () => {
      const result = await handlers.handleEvidenceStatsTool();
      const data = ResponseBuilder.parse<Record<string, unknown>>(result);
      expect(data).toMatchObject({
        nodeCount: 0,
        edgeCount: 0,
      });
      expect(data).not.toHaveProperty('content');
    });

    it('turns thrown evidence bridge failures into structured errors', async () => {
      const failingHandlers = new CrossDomainHandlers({
        getStats: () => {
          throw new Error('stats failed');
        },
      } as any);
      const result = await failingHandlers.handleEvidenceStatsTool();
      const data = ResponseBuilder.parse<Record<string, unknown>>(result);
      expect(data).toMatchObject({
        success: false,
        error: 'stats failed',
        message: 'stats failed',
      });
    });
  });
});
