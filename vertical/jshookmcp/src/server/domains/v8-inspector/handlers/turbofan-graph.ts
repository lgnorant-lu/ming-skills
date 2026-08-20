/**
 * TurboFan Graph Handler — v8_turbofan_graph
 *
 * Collect and visualize V8 TurboFan IR (sea-of-nodes / Turboshaft graph).
 *
 * Two collection modes:
 *   1. **Source mode**: Provide JS source code. An isolated V8 child process
 *      is spawned with --trace-turbo to generate the IR JSON, which is then
 *      parsed into structured graph objects (nodes, edges, phases, opcode histogram).
 *   2. **Directory mode**: Provide a traceDir path to read already-generated
 *      turbo-*.json files (e.g., from a browser launched with --trace-turbo).
 *
 * Also supports filtering by phase name, extracting specific node types,
 * and generating a text summary suitable for LLM consumption.
 *
 * Requires: Node.js (for isolated mode) or pre-existing trace directory (for directory mode).
 */

import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TurboFanGraphResult {
  success: boolean;
  error?: string;
  mode: 'source' | 'directory' | 'unavailable';
  functionCount: number;
  functions: Array<{
    functionName: string;
    sourceName: string;
    phaseCount: number;
    totalNodeCount: number;
    totalEdgeCount: number;
    opcodeHistogram: Record<string, number>;
    summary: string;
    inlineCount: number;
    phases?: Array<{
      name: string;
      nodeCount: number;
      edgeCount: number;
      sampleNodes?: Array<{ id: number; opcode: string; label: string; type: string }>;
    }>;
  }>;
  durationMs?: number | null;
  note?: string;
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function handleTurbofanGraph(
  args: Record<string, unknown>,
): Promise<TurboFanGraphResult> {
  const source = argString(args, 'source', '').trim();
  const traceDir = argString(args, 'traceDir', '').trim();
  const functionName = argString(args, 'functionName', '').trim();
  const phaseFilter = argString(args, 'phaseFilter', '').trim();
  const maxNodesPerPhase = argNumber(args, 'maxNodesPerPhase', 20);
  const includePhases = argBool(args, 'includePhases', false);
  const timeoutMs = argNumber(args, 'timeoutMs', 30000);
  const keepTraceDir = argBool(args, 'keepTraceDir', false);

  // Must provide either source or traceDir
  if (source.length === 0 && traceDir.length === 0) {
    return {
      success: false,
      error: 'Either "source" (JS code) or "traceDir" (path to turbo-*.json files) is required',
      mode: 'unavailable',
      functionCount: 0,
      functions: [],
    };
  }

  let traceResult: import('@modules/v8-inspector/TurboFanTraceCollector').TurboFanTraceResult;

  if (source.length > 0) {
    // Source mode: spawn isolated V8 process with --trace-turbo
    const { collectTurboFanIRIsolated } =
      await import('@modules/v8-inspector/TurboFanTraceCollector');
    traceResult = await collectTurboFanIRIsolated(
      {
        functionName: functionName.length > 0 ? functionName : 'anonymous',
        sourceSlice: source,
      },
      timeoutMs,
      keepTraceDir,
    );
  } else {
    // Directory mode: read existing turbo-*.json files
    const { collectTurboFanIRFromDir } =
      await import('@modules/v8-inspector/TurboFanTraceCollector');
    traceResult = collectTurboFanIRFromDir(traceDir);
  }

  if (!traceResult.available) {
    return {
      success: false,
      error: traceResult.reason,
      mode: source.length > 0 ? 'source' : 'directory',
      functionCount: 0,
      functions: [],
      durationMs: traceResult.durationMs,
    };
  }

  // Build structured result from parsed graphs
  const functions: TurboFanGraphResult['functions'] = [];

  for (const graph of traceResult.graphs) {
    // Filter phases if requested
    const phases =
      phaseFilter.length > 0
        ? graph.phases.filter((p) => p.name.toLowerCase().includes(phaseFilter.toLowerCase()))
        : graph.phases;

    const functionEntry: TurboFanGraphResult['functions'][number] = {
      functionName: graph.function.functionName,
      sourceName: graph.function.sourceName,
      phaseCount: phases.length,
      totalNodeCount: graph.totalNodeCount,
      totalEdgeCount: graph.totalEdgeCount,
      opcodeHistogram: graph.opcodeHistogram,
      summary: graph.summary,
      inlineCount: Object.keys(graph.inlinings).length,
    };

    if (includePhases) {
      functionEntry.phases = phases.map((phase) => {
        // Sample top nodes for brevity
        const nodes = phase.nodes ?? [];
        const sampled = nodes
          .filter((n) => n.opcode !== 'Parameter' && n.opcode !== 'OsrValue')
          .slice(0, maxNodesPerPhase);

        return {
          name: phase.name,
          nodeCount: phase.nodeCount ?? nodes.length,
          edgeCount: phase.edgeCount ?? 0,
          sampleNodes: sampled.map((n) => ({
            id: n.id,
            opcode: n.opcode,
            label: n.label,
            type: n.type,
          })),
        };
      });
    }

    functions.push(functionEntry);
  }

  return {
    success: true,
    mode: source.length > 0 ? 'source' : 'directory',
    functionCount: functions.length,
    functions,
    durationMs: traceResult.durationMs,
  };
}
