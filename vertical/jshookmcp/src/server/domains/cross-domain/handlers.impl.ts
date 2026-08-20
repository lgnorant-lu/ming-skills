import type { MCPServerContext } from '@server/domains/shared/registry';
import { asJsonResponse } from '@server/domains/shared/response';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argBool, argNumber, argString } from '@server/domains/shared/parse-args';
import type { ToolResponse } from '@server/types';
import type { EvidenceGraphSnapshot, EvidenceNode } from '@server/evidence/types';
import type { CrossDomainEvidenceBridge } from './handlers/evidence-graph-bridge';
import { correlateSkiaToJS } from './handlers/skia-correlator';
import { correlateMojoToCDP } from './handlers/mojo-cdp-correlator';
import { correlateSyscallToJS } from './handlers/syscall-js-correlator';
import { buildBinaryToJSPipeline } from './handlers/binary-to-js-pipeline';
import { correlateNetworkToV8 } from './handlers/network-v8-correlator';
import { LiveStateFetcher } from './handlers/live-state-fetcher';
import { querySynonyms, getSynonymGraphMeta } from './handlers/synonym-engine';
import {
  extractCDPEvents,
  extractGhidraOutput,
  extractJSObjectArray,
  extractJSStacks,
  extractMojoMessages,
  extractNetworkRequests,
  extractSkiaSceneTree,
  extractSyscallEvents,
} from './handlers/input-extractors';
import { WORKFLOWS, type CrossDomainWorkflowDefinition } from './workflows/missions';

const V5_DOMAIN_NAMES = [
  'adb-bridge',
  'analysis',
  'binary-instrument',
  'boringssl-inspector',
  'browser',
  'network',
  'canvas',
  'coordination',
  'cross-domain',
  'dart-inspector',
  'debugger',
  'encoding',
  'exploit-dev',
  'extension-registry',
  'graphql',
  'instrumentation',
  'maintenance',
  'memory',
  'v8-inspector',
  'mojo-ipc',
  'native-bridge',
  'native-emulator',
  'platform',
  'process',
  'protocol-analysis',
  'proxy',
  'sourcemap',
  'streaming',
  'syscall-hook',
  'trace',
  'transform',
  'wasm',
  'webgpu',
  'workflow',
];

export class CrossDomainWorkflowClassifier {
  constructor(
    private readonly ctx: MCPServerContext,
    private readonly evidenceBridgeReady: boolean,
  ) {}

  getCapabilities(): {
    availableDomains: string[];
    missingDomains: string[];
    supportedDomains: string[];
    workflows: Array<{
      workflowKey: string;
      id: string;
      displayName: string;
      stepCount: number;
      requiredDomains: string[];
      availableDomains: string[];
      missingDomains: string[];
      coverage: number;
    }>;
  } {
    const availableDomains = this.getAvailableDomains();
    const missingDomains = V5_DOMAIN_NAMES.filter((d) => !availableDomains.includes(d));

    const workflows = Object.entries(WORKFLOWS).map(([workflowKey, workflow]) => {
      const evaluation = this.evaluateWorkflow(workflow);
      return {
        workflowKey,
        id: workflow.id,
        displayName: workflow.displayName,
        stepCount: workflow.steps.length,
        ...evaluation,
      };
    });

    return { availableDomains, missingDomains, supportedDomains: [...V5_DOMAIN_NAMES], workflows };
  }

  suggestWorkflow(
    goal: string,
    preferAvailableOnly: boolean,
  ): {
    workflowKey: string;
    id: string;
    displayName: string;
    reason: string;
    requiredDomains: string[];
    availableDomains: string[];
    missingDomains: string[];
    coverage: number;
  } {
    const normalizedGoal = goal.toLowerCase();
    const scored = Object.entries(WORKFLOWS).map(([workflowKey, workflow]) => {
      const keywordScore = this.scoreWorkflowGoal(normalizedGoal, workflow);
      const evaluation = this.evaluateWorkflow(workflow);
      return { workflowKey, workflow, keywordScore, evaluation };
    });

    const candidates = preferAvailableOnly
      ? scored.filter((item) => item.evaluation.missingDomains.length === 0)
      : scored;

    const rankedPool = candidates.length > 0 ? candidates : scored;
    rankedPool.sort((a, b) => {
      if (b.keywordScore !== a.keywordScore) {
        return b.keywordScore - a.keywordScore;
      }
      return b.evaluation.coverage - a.evaluation.coverage;
    });

    const selected = rankedPool[0];
    if (!selected) {
      throw new Error('No workflow definitions are available for cross-domain suggestion');
    }
    const reason = this.describeWorkflowReason(normalizedGoal, selected.evaluation);

    return {
      workflowKey: selected.workflowKey,
      id: selected.workflow.id,
      displayName: selected.workflow.displayName,
      reason,
      ...selected.evaluation,
    };
  }

  getHealth(): {
    evidenceBridgeReady: boolean;
    orchestratorReady: boolean;
    availableDomains: string[];
    missingDomains: string[];
  } {
    const availableDomains = this.getAvailableDomains();
    return {
      evidenceBridgeReady: this.evidenceBridgeReady,
      orchestratorReady: true,
      availableDomains,
      missingDomains: V5_DOMAIN_NAMES.filter((d) => !availableDomains.includes(d)),
    };
  }

  private getAvailableDomains(): string[] {
    const currentEnabledDomains =
      this.ctx.enabledDomains.size > 0
        ? this.ctx.enabledDomains
        : this.ctx.resolveEnabledDomains(this.ctx.selectedTools);

    const available: string[] = [];
    for (const d of V5_DOMAIN_NAMES) {
      if (currentEnabledDomains.has(d)) {
        available.push(d);
      }
    }
    return available;
  }

  private evaluateWorkflow(workflow: CrossDomainWorkflowDefinition): {
    requiredDomains: string[];
    availableDomains: string[];
    missingDomains: string[];
    coverage: number;
  } {
    const requiredSet = new Set<string>();
    for (const step of workflow.steps) {
      for (const d of this.inferDomainsForTool(step.tool)) {
        requiredSet.add(d);
      }
    }
    const requiredDomains = [...requiredSet];
    const available = this.getAvailableDomains().filter((d) => requiredSet.has(d));
    const missing = requiredDomains.filter((d) => !available.includes(d));
    const coverage = requiredDomains.length === 0 ? 1 : available.length / requiredDomains.length;
    return { requiredDomains, availableDomains: available, missingDomains: missing, coverage };
  }

  private inferDomainsForTool(toolName: string): string[] {
    if (toolName.startsWith('deobfuscate') || toolName.startsWith('advanced_deobfuscate')) {
      return ['analysis'];
    }
    if (toolName.startsWith('adb_')) return ['adb-bridge'];
    if (toolName.startsWith('js_heap') || toolName.startsWith('performance_take_heap_snapshot')) {
      return ['v8-inspector'];
    }
    if (toolName.startsWith('v8_')) return ['v8-inspector'];
    if (toolName.startsWith('webgpu_')) return ['webgpu'];
    if (toolName.startsWith('wasm_')) return ['wasm'];
    if (toolName.startsWith('transform_')) return ['transform'];
    if (toolName.startsWith('sourcemap_')) return ['sourcemap'];
    if (toolName.startsWith('debugger_')) return ['debugger'];
    if (
      toolName === 'breakpoint' ||
      toolName === 'get_call_stack' ||
      toolName === 'get_scope_variables_enhanced' ||
      toolName === 'get_object_properties'
    ) {
      return ['debugger'];
    }
    if (toolName.startsWith('memory_')) return ['memory'];
    if (toolName.startsWith('process_')) return ['process'];
    if (toolName.startsWith('protocol_') || toolName.startsWith('proto_'))
      return ['protocol-analysis'];
    if (toolName.startsWith('proxy_')) return ['proxy'];
    if (toolName.startsWith('graphql_')) return ['graphql'];
    if (toolName.startsWith('encoding_') || toolName.startsWith('encode_')) return ['encoding'];
    if (toolName.startsWith('coordinate_') || toolName.startsWith('coordination_'))
      return ['coordination'];
    if (toolName.startsWith('dart_')) return ['dart-inspector'];
    if (toolName.startsWith('native_emulate_') || toolName.startsWith('native_emulator_'))
      return ['native-emulator'];
    if (toolName.startsWith('native_bridge_')) return ['native-bridge'];
    if (toolName.startsWith('platform_')) return ['platform'];
    if (toolName.startsWith('stream_') || toolName.startsWith('streaming_')) return ['streaming'];
    if (
      toolName.startsWith('trace_') ||
      toolName.startsWith('start_trace_') ||
      toolName.startsWith('stop_trace_')
    ) {
      return ['trace'];
    }
    if (toolName.startsWith('workflow_')) return ['workflow'];
    if (toolName.startsWith('exploit_')) return ['exploit-dev'];
    if (toolName.startsWith('maintenance_')) return ['maintenance'];
    if (toolName.startsWith('network_')) return ['network'];
    if (toolName.startsWith('console_') || toolName.startsWith('page_')) return ['browser'];
    if (toolName.startsWith('tls_') || toolName.startsWith('net_raw_'))
      return ['boringssl-inspector'];
    if (toolName.startsWith('canvas_')) return ['canvas'];
    if (toolName.startsWith('skia_')) return ['canvas'];
    if (toolName.startsWith('mojo_')) return ['mojo-ipc'];
    if (toolName.startsWith('syscall_')) return ['syscall-hook'];
    if (
      toolName.startsWith('ghidra_') ||
      toolName.startsWith('frida_') ||
      toolName.startsWith('generate_hooks') ||
      toolName.startsWith('unidbg_') ||
      toolName.startsWith('export_hook_script')
    ) {
      return ['binary-instrument'];
    }
    if (toolName.startsWith('extension_') || toolName === 'webhook') {
      return ['extension-registry'];
    }
    if (toolName.startsWith('cross_domain_')) {
      return ['cross-domain'];
    }
    if (toolName.startsWith('evidence_') || toolName.startsWith('instrument_')) {
      return ['instrumentation'];
    }
    if (toolName.startsWith('boringssl_')) {
      return ['boringssl-inspector'];
    }
    return [];
  }

  private scoreWorkflowGoal(
    normalizedGoal: string,
    workflow: CrossDomainWorkflowDefinition,
  ): number {
    let score = 0;

    const goalTokens = tokenizeForWorkflowScoring(normalizedGoal);
    for (const keyword of workflow.keywords) {
      const normalizedKeyword = keyword.toLowerCase();
      if (normalizedGoal.includes(normalizedKeyword)) {
        score += normalizedKeyword.includes(' ') ? 4 : 3;
        continue;
      }
      if (goalTokens.has(normalizedKeyword)) {
        score += 3;
        continue;
      }
      if (
        normalizedKeyword.length >= 4 &&
        [...goalTokens].some(
          (token) =>
            token.length >= 4 &&
            (token.includes(normalizedKeyword) || normalizedKeyword.includes(token)),
        )
      ) {
        score += 1;
      }
    }

    for (const displayToken of tokenizeForWorkflowScoring(workflow.displayName.toLowerCase())) {
      if (goalTokens.has(displayToken)) {
        score += 1;
      }
    }

    const workflowDomains = new Set<string>();
    for (const step of workflow.steps) {
      for (const domain of this.inferDomainsForTool(step.tool)) {
        workflowDomains.add(domain);
      }
    }
    for (const domain of workflowDomains) {
      const spacedDomain = domain.replaceAll('-', ' ');
      if (normalizedGoal.includes(domain) || normalizedGoal.includes(spacedDomain)) {
        score += 1;
      }
    }

    return score;
  }

  private describeWorkflowReason(
    normalizedGoal: string,
    evaluation: { missingDomains: string[]; coverage: number },
  ): string {
    if (evaluation.missingDomains.length === 0) {
      return `Matched goal "${normalizedGoal}" and all required domains are enabled.`;
    }
    return (
      `Matched goal "${normalizedGoal}" with ${Math.round(evaluation.coverage * 100)}% domain coverage. ` +
      `Missing: ` +
      `${evaluation.missingDomains.join(', ')}.`
    );
  }
}

export class CrossDomainHandlers {
  constructor(
    private readonly evidenceBridge: CrossDomainEvidenceBridge,
    private readonly workflowClassifier?: CrossDomainWorkflowClassifier,
    private readonly ctx?: MCPServerContext,
  ) {}

  async handleCapabilitiesTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCapabilities(args));
  }

  async handleSuggestWorkflowTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSuggestWorkflow(args));
  }

  async handleHealthTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleHealth());
  }

  async handleCorrelateAllTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleCorrelateAll(args));
  }

  async handleEvidenceExportTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleEvidenceExport());
  }

  async handleEvidenceQueryTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleEvidenceQuery(args));
  }

  async handleEvidenceStatsTool(): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleEvidenceStats());
  }

  async handleSynonymTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSynonym(args));
  }

  async handleCapabilities(_args: Record<string, unknown>): Promise<ToolResponse> {
    const capabilities = {
      evidenceGraphAvailable: true,
      workflowClassifierAvailable: this.workflowClassifier !== undefined,
    };
    if (this.workflowClassifier) {
      return asJsonResponse({
        capabilities,
        ...this.workflowClassifier.getCapabilities(),
      });
    }
    return asJsonResponse({ capabilities });
  }

  async handleSuggestWorkflow(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = argString(args, 'query', '') || argString(args, 'goal', '');
    const preferAvailableOnly = argBool(args, 'preferAvailableOnly', true);
    if (this.workflowClassifier && query) {
      return asJsonResponse(this.workflowClassifier.suggestWorkflow(query, preferAvailableOnly));
    }
    return asJsonResponse({
      message: 'Cross-domain workflow suggestion requires a classifier and query.',
    });
  }

  async handleHealth(): Promise<ToolResponse> {
    const stats = this.evidenceBridge.getStats();
    if (this.workflowClassifier) {
      const health = this.workflowClassifier.getHealth();
      return asJsonResponse({ ...health, evidenceGraph: stats });
    }
    return asJsonResponse({
      evidenceBridgeReady: true,
      orchestratorReady: false,
      evidenceGraph: stats,
    });
  }

  async handleCorrelateAll(args: Record<string, unknown>): Promise<ToolResponse> {
    const errors: string[] = [];
    const results: Record<string, unknown> = {};
    const pullFromDomains = argBool(args, 'pullFromDomains', false);
    const minConfidence = Math.max(0, Math.min(1, argNumber(args, 'minConfidence', 0)));
    const maxEdgesPerType = Math.max(0, Math.floor(argNumber(args, 'maxEdgesPerType', 0)));
    let correlateArgs = args;
    let liveSources: Record<string, unknown> | undefined;

    if (pullFromDomains) {
      const live = await new LiveStateFetcher(this.ctx).hydrate(args);
      correlateArgs = live.args;
      liveSources = live.sources;
      errors.push(...live.errors.map((error) => `LIVE: ${error}`));
    }

    // SKIA-03
    try {
      const sceneTree = extractSkiaSceneTree(correlateArgs['sceneTree']);
      const jsObjects = extractJSObjectArray(correlateArgs['jsObjects']);
      results['skia'] = correlateSkiaToJS(this.evidenceBridge, { sceneTree, jsObjects });
    } catch (e) {
      errors.push(`SKIA-03: ${e instanceof Error ? e.message : String(e)}`);
    }

    // MOJO-03
    try {
      const mojoMessages = extractMojoMessages(correlateArgs['mojoMessages']);
      const cdpEvents = extractCDPEvents(correlateArgs['cdpEvents']);
      const networkRequests = extractNetworkRequests(correlateArgs['networkRequests']);
      results['mojo'] = correlateMojoToCDP(
        this.evidenceBridge,
        mojoMessages,
        cdpEvents,
        networkRequests,
      );
    } catch (e) {
      errors.push(`MOJO-03: ${e instanceof Error ? e.message : String(e)}`);
    }

    // SYSCALL-02
    try {
      const syscallEvents = extractSyscallEvents(correlateArgs['syscallEvents']);
      const jsStacks = extractJSStacks(correlateArgs['jsStacks']);
      results['syscall'] = correlateSyscallToJS(this.evidenceBridge, syscallEvents, jsStacks);
    } catch (e) {
      errors.push(`SYSCALL-02: ${e instanceof Error ? e.message : String(e)}`);
    }

    // BIN-04
    try {
      const ghidraOutput = extractGhidraOutput(correlateArgs['ghidraOutput']);
      if (ghidraOutput) {
        results['binary'] = buildBinaryToJSPipeline(this.evidenceBridge, ghidraOutput);
      }
    } catch (e) {
      errors.push(`BIN-04: ${e instanceof Error ? e.message : String(e)}`);
    }

    // NET-V8 (network↔v8 correlator with bidirectional edges)
    try {
      const netRequests = extractNetworkRequests(correlateArgs['networkRequests']);
      if (netRequests.length > 0) {
        const netV8Result = correlateNetworkToV8(this.evidenceBridge, netRequests);
        results['networkV8'] = netV8Result;
        // Add bidirectional reverse edges: for each correlation, add a
        // v8-triggers-network edge pointing opposite direction so the graph
        // can be traversed both forward (initiator→request) and backward
        // (request→initiator). We iterate the snapshot edges to find
        // the matching network-initiated-by edges just created.
        const snapshot = this.evidenceBridge.exportGraph();
        for (const corr of netV8Result.correlations) {
          const matchingEdges = snapshot.edges.filter(
            (e: {
              type: string;
              metadata?: Record<string, unknown>;
              source: string;
              target: string;
            }) =>
              e.type === 'network-initiated-by' &&
              e.metadata &&
              (e.metadata as Record<string, unknown>)['requestId'] === corr.requestId,
          );
          for (const edge of matchingEdges) {
            this.evidenceBridge
              .getGraph()
              .addEdge(edge.target, edge.source, 'v8-triggers-network', {
                domain: 'cross-domain',
                relation: 'v8-function-triggers-network-request',
                confidence: corr.confidence,
                matchType: corr.matchType,
                requestId: corr.requestId,
              });
          }
        }
      }
    } catch (e) {
      errors.push(`NET-V8: ${e instanceof Error ? e.message : String(e)}`);
    }

    const snapshot = filterEvidenceSnapshot(
      this.evidenceBridge.exportGraph(),
      minConfidence,
      maxEdgesPerType,
    );

    return asJsonResponse({
      correlationResults: {
        ...results,
        errors,
        liveState: pullFromDomains ? { pullFromDomains, sources: liveSources } : undefined,
        edgeFilters: { minConfidence, maxEdgesPerType },
      },
      evidenceGraph: snapshot,
    });
  }

  async handleEvidenceExport(): Promise<ToolResponse> {
    return asJsonResponse(this.evidenceBridge.exportGraph());
  }

  async handleEvidenceQuery(args: Record<string, unknown>): Promise<ToolResponse> {
    const queryType = argString(args, 'queryType', '');
    const value = argString(args, 'value', '');
    const limit = Math.max(1, Math.min(500, Math.floor(argNumber(args, 'limit', 50))));
    const graph = this.evidenceBridge.getGraph();

    let nodes: EvidenceNode[];
    let chainDirection: 'forward' | 'backward' | undefined;
    switch (queryType) {
      case 'network_url':
        requireQueryValue(queryType, value);
        nodes = this.evidenceBridge.queryByNetworkUrl(value);
        break;
      case 'heap_address':
        requireQueryValue(queryType, value);
        nodes = this.evidenceBridge.queryByHeapAddress(value);
        break;
      case 'function':
        requireQueryValue(queryType, value);
        nodes = graph.queryByFunction(value);
        break;
      case 'script_id':
        requireQueryValue(queryType, value);
        nodes = graph.queryByScriptId(value);
        break;
      case 'node_id': {
        requireQueryValue(queryType, value);
        const node = graph.getNode(value);
        nodes = node ? [node] : [];
        break;
      }
      case 'node_type':
        requireQueryValue(queryType, value);
        nodes = this.evidenceBridge.exportGraph().nodes.filter((node) => node.type === value);
        break;
      case 'metadata':
        nodes = queryNodesByMetadata(this.evidenceBridge.exportGraph().nodes, args);
        break;
      case 'chain':
        requireQueryValue(queryType, value);
        chainDirection = readChainDirection(args['direction']);
        nodes = graph.getEvidenceChain(value, chainDirection);
        break;
      default:
        throw new Error(
          'Invalid evidence queryType. Expected one of: network_url, heap_address, function, script_id, node_id, node_type, metadata, chain',
        );
    }

    const total = nodes.length;
    const returnedNodes = nodes.slice(0, limit);
    const returnedNodeIds = new Set(returnedNodes.map((node) => node.id));
    const edges = this.evidenceBridge
      .exportGraph()
      .edges.filter((edge) => returnedNodeIds.has(edge.source) && returnedNodeIds.has(edge.target));

    return asJsonResponse({
      query: {
        queryType,
        value: value || undefined,
        metadataKey: argString(args, 'metadataKey'),
        metadataValue: argString(args, 'metadataValue'),
        direction: chainDirection,
        limit,
      },
      total,
      returned: returnedNodes.length,
      truncated: total > returnedNodes.length,
      nodes: returnedNodes,
      edges,
    });
  }

  async handleEvidenceStats(): Promise<ToolResponse> {
    const base = this.evidenceBridge.getStats();
    const snapshot = this.evidenceBridge.exportGraph();
    return asJsonResponse({ ...base, ...computeEvidenceGraphQuality(snapshot) });
  }

  async handleSynonym(args: Record<string, unknown>): Promise<ToolResponse> {
    const query = argString(args, 'query', '');
    if (!query.trim()) {
      return asJsonResponse({
        message: 'Provide a natural-language query describing the task or concept.',
        graphMeta: getSynonymGraphMeta(),
      });
    }
    const maxResults = Math.max(1, Math.min(20, Math.floor(argNumber(args, 'maxResults', 10))));
    const matches = querySynonyms(query, maxResults);
    return asJsonResponse({
      query,
      matchCount: matches.length,
      maxResults,
      matches,
      graphMeta: getSynonymGraphMeta(),
    });
  }
}

function requireQueryValue(queryType: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`value is required for evidence queryType=${queryType}`);
  }
}

function readChainDirection(value: unknown): 'forward' | 'backward' {
  if (value === undefined || value === null) return 'forward';
  if (value === 'forward' || value === 'backward') return value;
  throw new Error('Invalid evidence chain direction. Expected one of: forward, backward');
}

function queryNodesByMetadata(
  nodes: EvidenceNode[],
  args: Record<string, unknown>,
): EvidenceNode[] {
  const metadataKey = argString(args, 'metadataKey', '');
  if (!metadataKey.trim()) {
    throw new Error('metadataKey is required for evidence queryType=metadata');
  }
  const hasMetadataValue = Object.prototype.hasOwnProperty.call(args, 'metadataValue');
  const metadataValue = args['metadataValue'];
  return nodes.filter((node) => {
    if (!Object.prototype.hasOwnProperty.call(node.metadata, metadataKey)) return false;
    if (!hasMetadataValue) return true;
    return String(node.metadata[metadataKey]) === String(metadataValue);
  });
}

function tokenizeForWorkflowScoring(value: string): Set<string> {
  return new Set(value.split(/[^a-z0-9+#.-]+/i).filter((token) => token.length > 1));
}

function edgeConfidence(edge: EvidenceGraphSnapshot['edges'][number]): number {
  const metadata = edge.metadata ?? {};
  const confidence = metadata['confidence'];
  const matchScore = metadata['matchScore'];
  if (typeof confidence === 'number' && Number.isFinite(confidence)) return confidence;
  if (typeof matchScore === 'number' && Number.isFinite(matchScore)) return matchScore;
  if (confidence === 'high') return 0.9;
  if (confidence === 'medium') return 0.6;
  if (confidence === 'low') return 0.3;
  return 1;
}

/**
 * Quality metrics layered on top of `getStats()` so analysts can gauge evidence
 * signal vs. noise without exporting the whole graph: edge-type breakdown,
 * confidence distribution (high/medium/low/unannotated), mean confidence, count
 * of orphan nodes with no edges, and the highest-degree hub nodes.
 */
export function computeEvidenceGraphQuality(snapshot: EvidenceGraphSnapshot): {
  edgesByType: Record<string, number>;
  confidenceBuckets: { high: number; medium: number; low: number; none: number };
  avgConfidence: number;
  orphanNodeCount: number;
  topNodesByDegree: Array<{ nodeId: string; label: string; type: string; degree: number }>;
} {
  const edgesByType: Record<string, number> = {};
  const confidenceBuckets = { high: 0, medium: 0, low: 0, none: 0 };
  let confidenceSum = 0;
  let confidenceSamples = 0;
  const degree = new Map<string, number>();
  const connected = new Set<string>();

  for (const edge of snapshot.edges) {
    edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
    connected.add(edge.source);
    connected.add(edge.target);
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);

    const meta = edge.metadata ?? {};
    const hasConfidence =
      typeof meta['confidence'] === 'number' ||
      typeof meta['confidence'] === 'string' ||
      typeof meta['matchScore'] === 'number';
    if (!hasConfidence) {
      confidenceBuckets.none += 1;
      continue;
    }
    const c = edgeConfidence(edge);
    confidenceSum += c;
    confidenceSamples += 1;
    if (c >= 0.7) confidenceBuckets.high += 1;
    else if (c >= 0.4) confidenceBuckets.medium += 1;
    else confidenceBuckets.low += 1;
  }

  const orphanNodeCount = snapshot.nodes.filter((n) => !connected.has(n.id)).length;

  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const topNodesByDegree = [...degree.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nodeId, deg]) => {
      const node = nodeById.get(nodeId);
      return {
        nodeId,
        label: node?.label ?? nodeId,
        type: node?.type ?? 'unknown',
        degree: deg,
      };
    });

  return {
    edgesByType,
    confidenceBuckets,
    avgConfidence:
      confidenceSamples > 0 ? Number((confidenceSum / confidenceSamples).toFixed(4)) : 0,
    orphanNodeCount,
    topNodesByDegree,
  };
}

function filterEvidenceSnapshot(
  snapshot: EvidenceGraphSnapshot,
  minConfidence: number,
  maxEdgesPerType: number,
): EvidenceGraphSnapshot & { edgeFilterSummary?: Record<string, unknown> } {
  const perType = new Map<string, number>();
  const truncatedByType: Record<string, number> = {};
  const edges = snapshot.edges.filter((edge) => {
    if (edgeConfidence(edge) < minConfidence) return false;
    if (maxEdgesPerType <= 0) return true;
    const count = perType.get(edge.type) ?? 0;
    if (count >= maxEdgesPerType) {
      truncatedByType[edge.type] = (truncatedByType[edge.type] ?? 0) + 1;
      return false;
    }
    perType.set(edge.type, count + 1);
    return true;
  });

  const removedByConfidence =
    snapshot.edges.length -
    edges.length -
    Object.values(truncatedByType).reduce((a, b) => a + b, 0);
  return {
    ...snapshot,
    edges,
    edgeFilterSummary: {
      originalEdges: snapshot.edges.length,
      returnedEdges: edges.length,
      removedByConfidence,
      truncatedByType,
    },
  };
}
