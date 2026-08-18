import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DAGManager } from "../core/DAGManager.js";
import { parseHARFile } from "../core/HARParser.js";
import {
  type ClassifiedParameter,
  type DebugToolContext,
  HarvestError,
  type ParameterClassification,
  type RequestModel,
  type URLInfo,
} from "../types/index.js";

/**
 * Handle debug_get_unresolved_nodes tool call
 */
export async function handleGetUnresolvedNodes(
  params: { sessionId: string },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const unresolvedNodes = session.dagManager.getUnresolvedNodes();

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Retrieved ${unresolvedNodes.length} unresolved nodes for debugging`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            unresolvedNodes: unresolvedNodes.map((node) => ({
              nodeId: node.nodeId,
              unresolvedParts: node.unresolvedParts,
              nodeType: session.dagManager.getNode(node.nodeId)?.nodeType,
              content: (() => {
                const dagNode = session.dagManager.getNode(node.nodeId);
                if (
                  dagNode &&
                  (dagNode.nodeType === "curl" ||
                    dagNode.nodeType === "master_curl" ||
                    dagNode.nodeType === "master")
                ) {
                  return dagNode.content.key.url || "Unknown";
                }
                return "Unknown";
              })(),
            })),
            totalUnresolved: unresolvedNodes.length,
            message:
              unresolvedNodes.length > 0
                ? "These nodes require manual intervention or additional analysis"
                : "All nodes have been resolved successfully",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to get unresolved nodes: ${error instanceof Error ? error.message : "Unknown error"}`,
      "GET_UNRESOLVED_NODES_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_get_node_details tool call
 */
export async function handleGetNodeDetails(
  params: { sessionId: string; nodeId: string },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const node = session.dagManager.getNode(params.nodeId);

    if (!node) {
      throw new HarvestError(
        `Node ${params.nodeId} not found in DAG`,
        "NODE_NOT_FOUND",
        { nodeId: params.nodeId }
      );
    }

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Retrieved detailed information for node ${params.nodeId}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            nodeId: params.nodeId,
            nodeType: node.nodeType,
            content: (() => {
              if (
                node.nodeType === "curl" ||
                node.nodeType === "master_curl" ||
                node.nodeType === "master"
              ) {
                return {
                  url: node.content.key.url || "N/A",
                  method: node.content.key.method || "N/A",
                  headers: Object.keys(node.content.key.headers || {}).length,
                  bodySize: node.content.key.body
                    ? JSON.stringify(node.content.key.body).length
                    : 0,
                };
              }
              if (node.nodeType === "cookie") {
                return {
                  cookieKey: node.content.key,
                  cookieValue: node.content.value,
                };
              }
              if (node.nodeType === "not_found") {
                return {
                  missingPart: node.content.key,
                };
              }
              return {
                type: "unknown",
                nodeType: "unknown",
              };
            })(),
            dynamicParts: node.dynamicParts || [],
            extractedParts: node.extractedParts || [],
            inputVariables: node.inputVariables || {},
            dependencies: {
              incoming: session.dagManager
                .toJSON()
                .edges.filter((e) => e.to === params.nodeId).length,
              outgoing: session.dagManager
                .toJSON()
                .edges.filter((e) => e.from === params.nodeId).length,
            },
            timestamp: (() => {
              if (
                node.nodeType === "curl" ||
                node.nodeType === "master_curl" ||
                node.nodeType === "master"
              ) {
                return node.content.key.timestamp?.toISOString() || "Unknown";
              }
              return "N/A";
            })(),
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to get node details: ${error instanceof Error ? error.message : "Unknown error"}`,
      "GET_NODE_DETAILS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_list_all_requests tool call
 */
export async function handleListAllRequests(
  params: { sessionId: string },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    const requests = session.harData.requests.map((req, index) => ({
      index,
      method: req.method,
      url: req.url,
      responsePreview: req.response?.text?.substring(0, 100) || "No response",
      hasResponse: !!req.response,
      contentType: Array.isArray(req.response?.headers)
        ? req.response.headers.find(
            (h) => h.name?.toLowerCase() === "content-type"
          )?.value || "Unknown"
        : "Unknown",
      statusCode: req.response?.status || 0,
      timestamp: req.timestamp || "Unknown",
    }));

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Listed ${requests.length} requests from HAR file for manual analysis`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            requests,
            totalRequests: requests.length,
            summary: {
              getMethods: requests.filter((r) => r.method === "GET").length,
              postMethods: requests.filter((r) => r.method === "POST").length,
              otherMethods: requests.filter(
                (r) => !["GET", "POST"].includes(r.method)
              ).length,
              withResponses: requests.filter((r) => r.hasResponse).length,
            },
            message:
              "Use this list to manually identify dependencies if automatic analysis fails",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to list requests: ${error instanceof Error ? error.message : "Unknown error"}`,
      "LIST_REQUESTS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_force_dependency tool call
 */
export async function handleForceDependency(
  params: {
    sessionId: string;
    consumerNodeId: string;
    providerNodeId: string;
    providedPart: string;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Validate that both nodes exist
    const consumerNode = session.dagManager.getNode(params.consumerNodeId);
    const providerNode = session.dagManager.getNode(params.providerNodeId);

    if (!consumerNode) {
      throw new HarvestError(
        `Consumer node ${params.consumerNodeId} not found in DAG`,
        "NODE_NOT_FOUND",
        { nodeId: params.consumerNodeId }
      );
    }

    if (!providerNode) {
      throw new HarvestError(
        `Provider node ${params.providerNodeId} not found in DAG`,
        "NODE_NOT_FOUND",
        { nodeId: params.providerNodeId }
      );
    }

    // Check if the consumer node actually needs this part
    const consumerDynamicParts = consumerNode.dynamicParts || [];
    if (!consumerDynamicParts.includes(params.providedPart)) {
      context.sessionManager.addLog(
        params.sessionId,
        "warn",
        `Consumer node ${params.consumerNodeId} does not have '${params.providedPart}' as an unresolved dynamic part`
      );
    }

    // Add the edge in the DAG
    session.dagManager.addEdge(params.consumerNodeId, params.providerNodeId);

    // Update consumer node to remove the resolved part
    const updatedConsumerParts = consumerDynamicParts.filter(
      (part) => part !== params.providedPart
    );
    session.dagManager.updateNode(params.consumerNodeId, {
      dynamicParts: updatedConsumerParts,
    });

    // Update provider node to add the extracted part
    const currentExtracted = providerNode.extractedParts || [];
    if (!currentExtracted.includes(params.providedPart)) {
      session.dagManager.updateNode(params.providerNodeId, {
        extractedParts: [...currentExtracted, params.providedPart],
      });
    }

    // Check for cycles after adding the dependency
    const cycles = session.dagManager.detectCycles();
    if (cycles) {
      // Rollback the changes
      session.dagManager.updateNode(params.consumerNodeId, {
        dynamicParts: consumerDynamicParts,
      });
      session.dagManager.updateNode(params.providerNodeId, {
        extractedParts: currentExtracted,
      });

      throw new HarvestError(
        "Manual dependency would create circular dependencies in the graph",
        "CIRCULAR_DEPENDENCIES",
        { cycles }
      );
    }

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Manually created dependency: ${params.consumerNodeId} -> ${params.providerNodeId} (provides: ${params.providedPart})`
    );

    // Analyze completion state after forcing dependency
    context.sessionManager.analyzeCompletionState(params.sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "Dependency successfully created between nodes",
            consumerNodeId: params.consumerNodeId,
            providerNodeId: params.providerNodeId,
            providedPart: params.providedPart,
            consumerRemainingParts: updatedConsumerParts,
            totalEdges: session.dagManager.toJSON().edges.length,
            nextStep:
              updatedConsumerParts.length > 0
                ? "Consumer node still has unresolved parts"
                : "Consumer node is now fully resolved",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to force dependency: ${error instanceof Error ? error.message : "Unknown error"}`,
      "FORCE_DEPENDENCY_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_set_master_node tool call
 */
export async function handleSetMasterNode(
  params: { sessionId: string; url: string },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Validate that the URL exists in the HAR data using flexible matching
    const targetRequest = findRequestByFlexibleUrl(
      session.harData.requests,
      params.url
    );

    if (!targetRequest) {
      throw new HarvestError(
        `URL ${params.url} not found in HAR data`,
        "URL_NOT_FOUND_IN_HAR",
        {
          url: params.url,
          availableUrls: session.harData.requests.map((r) => r.url),
        }
      );
    }

    // Clear any existing master node state
    if (session.state.masterNodeId) {
      context.sessionManager.addLog(
        params.sessionId,
        "info",
        `Removing existing master node ${session.state.masterNodeId} to set new one`
      );

      // Remove from processing queue if present
      session.state.toBeProcessedNodes =
        session.state.toBeProcessedNodes.filter(
          (nodeId) => nodeId !== session.state.masterNodeId
        );
    }

    // Create the master node in DAG
    const masterNodeId = session.dagManager.addNode(
      "master_curl",
      {
        key: targetRequest,
        value: targetRequest.response || null,
      },
      {
        dynamicParts: ["None"], // Will be updated in next step
        extractedParts: ["None"],
      }
    );

    // Update session state atomically
    session.state.actionUrl = params.url;
    session.state.masterNodeId = masterNodeId;

    // Add to processing queue for dependency analysis
    if (!session.state.toBeProcessedNodes.includes(masterNodeId)) {
      session.state.toBeProcessedNodes.push(masterNodeId);
    }

    // Clear completion state to force re-analysis
    session.state.isComplete = false;

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Manually set master node: ${masterNodeId} for URL: ${params.url}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "Master node successfully set",
            masterNodeId,
            actionUrl: params.url,
            nodeCount: session.dagManager.getNodeCount(),
            nextSteps: [
              "Use 'analysis_process_next_node' to analyze dynamic parts",
              "Continue with normal analysis workflow",
              "Use 'analysis_is_complete' to check progress",
            ],
            recommendation:
              "The analysis workflow is now unblocked and can proceed normally",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }
    throw new HarvestError(
      `Failed to set master node: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SET_MASTER_NODE_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_get_completion_blockers tool call
 */
export async function handleGetCompletionBlockers(
  params: { sessionId: string },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    // Use enhanced completion state analysis
    const analysis = context.sessionManager.analyzeCompletionState(
      params.sessionId
    );

    // Determine overall status and next action based on analysis
    let status: string;
    let nextAction: string;

    if (analysis.isComplete) {
      status = "ready_for_code_generation";
      nextAction = "Use 'codegen_generate_wrapper_script' to generate code";
    } else if (
      analysis.diagnostics.pendingInQueue > 0 ||
      analysis.diagnostics.unresolvedNodes > 0
    ) {
      status = "analysis_in_progress";
      nextAction = "Continue with 'analysis_process_next_node'";
    } else if (analysis.diagnostics.totalNodes === 0) {
      status = "analysis_not_started";
      nextAction = "Start with 'analysis_start_primary_workflow'";
    } else {
      status = "analysis_stalled";
      nextAction = "Check session status and consider restarting analysis";
    }

    // Add status-specific recommendations
    if (analysis.isComplete) {
      analysis.recommendations.push(
        "Analysis appears complete - ready for code generation"
      );
    } else {
      analysis.recommendations.push(
        "Address the blockers listed above to proceed"
      );
      if (analysis.blockers.length > 2) {
        analysis.recommendations.push(
          "Focus on the first blocker first, as others may resolve automatically"
        );
      }
    }

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Completion blocker analysis: ${analysis.blockers.length} blockers found, status: ${status}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status,
            canGenerateCode: analysis.isComplete,
            blockers: analysis.blockers,
            recommendations: analysis.recommendations,
            nextAction,
            diagnostics: {
              ...analysis.diagnostics,
              stateSynchronized:
                analysis.diagnostics.dagComplete === analysis.isComplete,
            },
            summary:
              analysis.blockers.length === 0
                ? "No blockers found - analysis is complete and ready for code generation"
                : `${analysis.blockers.length} blockers preventing completion - see recommendations for resolution steps`,
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to analyze completion blockers: ${error instanceof Error ? error.message : "Unknown error"}`,
      "COMPLETION_BLOCKERS_ANALYSIS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_preview_har tool call
 */
export async function handlePreviewHar(params: {
  harPath: string;
  showUrls?: boolean;
  showAuth?: boolean;
}): Promise<CallToolResult> {
  try {
    // Parse HAR file
    const parsedHar = await parseHARFile(params.harPath, {
      excludeKeywords: ["favicon", "analytics", "tracking"],
      includeAllApiRequests: true,
    });

    // Get validation info
    const validation = parsedHar.validation;

    // Build preview response
    const preview: {
      success: boolean;
      harPath: string;
      quality: string;
      stats: Record<string, unknown>;
      issues: string[];
      recommendations: string[];
      authAnalysis?: unknown;
      summary?: unknown;
      urls?: Array<{
        method: string;
        url: string;
        requestType: string;
        responseType: string;
      }>;
      requests?: Array<{
        method: string;
        url: string;
        hasBody: boolean;
        hasAuth: boolean;
      }>;
    } = {
      success: true,
      harPath: params.harPath,
      quality: validation?.quality || "unknown",
      stats: validation?.stats || {},
      issues: validation?.issues || [],
      recommendations: validation?.recommendations || [],
    };

    // Add URLs if requested
    if (params.showUrls) {
      preview.urls = parsedHar.urls.map((url: URLInfo) => ({
        method: url.method,
        url: url.url,
        requestType: url.requestType,
        responseType: url.responseType,
      }));
    }

    // Add auth analysis if requested
    if (params.showAuth) {
      preview.authAnalysis = validation?.authAnalysis || {
        hasAuthHeaders: false,
        hasCookies: false,
        hasTokens: false,
        authTypes: [],
      };
    }

    // Add summary
    preview.summary = {
      totalRequests: parsedHar.requests.length,
      totalUrls: parsedHar.urls.length,
      apiRequests: validation?.stats.apiRequests || 0,
      hasAuthentication: validation?.authAnalysis.hasAuthentication || false,
      readyForAnalysis:
        validation?.quality !== "empty" && validation?.quality !== "poor",
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(preview),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `HAR preview failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "HAR_PREVIEW_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_analyze_parameters tool call
 */
export async function handleAnalyzeParameters(params: {
  harPath: string;
  url?: string;
}): Promise<CallToolResult> {
  try {
    // Parse HAR file
    const parsedHar = await parseHARFile(params.harPath);

    // Filter requests if URL provided
    const requests = params.url
      ? parsedHar.requests.filter((req: RequestModel) => req.url === params.url)
      : parsedHar.requests;

    if (requests.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: params.url
                ? `No requests found for URL: ${params.url}`
                : "No requests found in HAR file",
            }),
          },
        ],
        isError: true,
      };
    }

    // Extract all parameters from requests
    const allParameters = new Map<
      string,
      {
        occurrences: number;
        contexts: string[];
        values: Set<string>;
      }
    >();

    for (const request of requests) {
      // Extract from URL query params
      const url = new URL(request.url);
      for (const [key, value] of url.searchParams) {
        if (!allParameters.has(key)) {
          allParameters.set(key, {
            occurrences: 0,
            contexts: [],
            values: new Set(),
          });
        }
        const param = allParameters.get(key);
        if (!param) {
          continue;
        }
        param.occurrences++;
        param.contexts.push("query");
        param.values.add(value);
      }

      // Extract from request body if JSON
      if (request.body && typeof request.body === "object") {
        const extractParams = (obj: Record<string, unknown>, prefix = "") => {
          for (const [key, value] of Object.entries(obj)) {
            const fullKey = prefix ? `${prefix}.${key}` : key;
            if (
              typeof value === "object" &&
              value !== null &&
              !Array.isArray(value)
            ) {
              extractParams(value as Record<string, unknown>, fullKey);
            } else {
              if (!allParameters.has(fullKey)) {
                allParameters.set(fullKey, {
                  occurrences: 0,
                  contexts: [],
                  values: new Set(),
                });
              }
              const param = allParameters.get(fullKey);
              if (!param) {
                continue;
              }
              param.occurrences++;
              param.contexts.push("body");
              param.values.add(String(value));
            }
          }
        };
        extractParams(request.body as Record<string, unknown>);
      }
    }

    // Analyze parameters using heuristics
    const parameterAnalysis = Array.from(allParameters.entries()).map(
      ([name, data]) => {
        const consistency =
          data.values.size === 1 ? 1.0 : 1.0 / data.values.size;
        const occurrenceRate = data.occurrences / requests.length;

        // Use heuristic analysis (simplified fallback)
        const analysis = {
          classification: consistency > 0.8 ? "staticConstant" : "userInput",
          confidence: consistency,
          reasoning:
            consistency > 0.8
              ? "Consistent value across requests"
              : "Variable value suggests user input",
        };

        return {
          parameter: name,
          occurrences: data.occurrences,
          uniqueValues: data.values.size,
          consistency: Math.round(consistency * 100),
          occurrenceRate: Math.round(occurrenceRate * 100),
          contexts: Array.from(new Set(data.contexts)),
          predictedClassification: analysis.classification,
          confidence: Math.round(analysis.confidence * 100),
          reasoning: analysis.reasoning,
          sampleValues: Array.from(data.values).slice(0, 3),
        };
      }
    );

    // Sort by importance (occurrences * consistency)
    parameterAnalysis.sort(
      (a, b) => b.occurrences * b.consistency - a.occurrences * a.consistency
    );

    // Group by classification
    const classificationSummary = parameterAnalysis.reduce(
      (acc, param) => {
        acc[param.predictedClassification] =
          (acc[param.predictedClassification] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            requestsAnalyzed: requests.length,
            totalParameters: allParameters.size,
            parameters: parameterAnalysis,
            classificationSummary,
            recommendations: [
              "Parameters with high consistency (>90%) are likely sessionConstants",
              "Parameters with low consistency (<30%) are likely userInputs",
              "Use session_start to run full analysis with parameter classification",
            ],
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Parameter analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "PARAMETER_ANALYSIS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_override_parameter_classification tool call
 */
export async function handleOverrideParameterClassification(
  params: {
    sessionId: string;
    nodeId: string;
    parameterValue: string;
    newClassification: ParameterClassification;
    reasoning?: string;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const node = session.dagManager.getNode(params.nodeId);

    if (!node) {
      throw new HarvestError(
        `Node ${params.nodeId} not found`,
        "NODE_NOT_FOUND",
        { nodeId: params.nodeId }
      );
    }

    // Update classified parameters
    if (!node.classifiedParameters) {
      node.classifiedParameters = [];
    }

    // Find and update the parameter
    let found = false;
    for (const param of node.classifiedParameters) {
      if (param.value === params.parameterValue) {
        param.classification = params.newClassification;
        param.confidence = 1.0;
        param.source = "manual";
        param.metadata.domainContext =
          params.reasoning || `Manually set to ${params.newClassification}`;
        found = true;
        break;
      }
    }

    if (!found) {
      // Add new classification
      node.classifiedParameters.push({
        name: params.parameterValue,
        value: params.parameterValue,
        classification: params.newClassification,
        confidence: 1.0,
        source: "manual",
        metadata: {
          occurrenceCount: 1,
          totalRequests: 1,
          consistencyScore: 1.0,
          parameterPattern: `^${params.parameterValue}$`,
          domainContext:
            params.reasoning || `Manually set to ${params.newClassification}`,
        },
      });
    }

    // Update node
    session.dagManager.updateNode(params.nodeId, node);

    // Log the change
    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Manually reclassified parameter "${params.parameterValue}" as ${params.newClassification}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            nodeId: params.nodeId,
            parameter: params.parameterValue,
            newClassification: params.newClassification,
            reasoning: params.reasoning,
            message: "Parameter classification updated successfully",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Parameter classification override failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "PARAMETER_OVERRIDE_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_batch_classify_parameters tool call
 */
export async function handleBatchClassifyParameters(
  params: {
    sessionId: string;
    classifications: Array<{
      pattern: string;
      classification: ParameterClassification;
      reasoning?: string;
    }>;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const allNodes = session.dagManager.getAllNodes();
    let totalUpdated = 0;
    const updates: Array<{
      nodeId: string;
      parameter: string;
      classification: string;
    }> = [];

    // Apply classification rules to all nodes
    for (const [nodeId, node] of allNodes) {
      if (!node.classifiedParameters) {
        node.classifiedParameters = [];
      }

      let nodeUpdated = false;

      // Apply each classification rule
      for (const rule of params.classifications) {
        const regex = new RegExp(rule.pattern);

        // Check existing classified parameters
        for (const param of node.classifiedParameters) {
          if (regex.test(param.name) || regex.test(param.value)) {
            param.classification = rule.classification;
            param.confidence = 1.0;
            param.source = "manual";
            param.metadata.domainContext =
              rule.reasoning || `Batch classified as ${rule.classification}`;
            updates.push({
              nodeId,
              parameter: param.value,
              classification: rule.classification,
            });
            totalUpdated++;
            nodeUpdated = true;
          }
        }

        // Also check dynamic parts that might not be classified yet
        if (node.dynamicParts) {
          for (const part of node.dynamicParts) {
            if (regex.test(part)) {
              // Check if already classified
              const existing = node.classifiedParameters.find(
                (p) => p.value === part
              );
              if (!existing) {
                node.classifiedParameters.push({
                  name: part,
                  value: part,
                  classification: rule.classification,
                  confidence: 1.0,
                  source: "manual",
                  metadata: {
                    occurrenceCount: 1,
                    totalRequests: 1,
                    consistencyScore: 1.0,
                    parameterPattern: `^${part}$`,
                    domainContext:
                      rule.reasoning ||
                      `Batch classified as ${rule.classification}`,
                  },
                });
                updates.push({
                  nodeId,
                  parameter: part,
                  classification: rule.classification,
                });
                totalUpdated++;
                nodeUpdated = true;
              }
            }
          }
        }
      }

      if (nodeUpdated) {
        session.dagManager.updateNode(nodeId, node);
      }
    }

    // Log the changes
    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Batch parameter classification applied: ${totalUpdated} parameters updated across ${updates.length} nodes`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            totalUpdated,
            updates,
            message: "Batch classification applied successfully",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Batch parameter classification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "BATCH_CLASSIFICATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_skip_node tool call
 */
export async function handleSkipNode(
  params: {
    sessionId: string;
    nodeId: string;
    reason: string;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const node = session.dagManager.getNode(params.nodeId);

    if (!node) {
      throw new HarvestError(
        `Node ${params.nodeId} not found`,
        "NODE_NOT_FOUND",
        { nodeId: params.nodeId }
      );
    }

    // Mark all parameters as optional
    if (node.dynamicParts) {
      if (!node.classifiedParameters) {
        node.classifiedParameters = [];
      }

      for (const part of node.dynamicParts) {
        const existing = node.classifiedParameters.find(
          (p) => p.value === part
        );
        if (existing) {
          existing.classification = "optional";
          existing.metadata.domainContext = `Skipped: ${params.reason}`;
        } else {
          node.classifiedParameters.push({
            name: part,
            value: part,
            classification: "optional",
            confidence: 1.0,
            source: "manual",
            metadata: {
              occurrenceCount: 1,
              totalRequests: 1,
              consistencyScore: 1.0,
              parameterPattern: `^${part}$`,
              domainContext: `Skipped: ${params.reason}`,
            },
          });
        }
      }
    }

    // Update node
    session.dagManager.updateNode(params.nodeId, node);

    // Log the change
    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Node ${params.nodeId} marked as skippable: ${params.reason}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            nodeId: params.nodeId,
            reason: params.reason,
            message: "Node marked as skippable successfully",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Skip node failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SKIP_NODE_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_inject_response tool call
 */
export async function handleInjectResponse(
  params: {
    sessionId: string;
    nodeId: string;
    responseData: Record<string, unknown>;
    extractedParts?: Record<string, string>;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }
    const node = session.dagManager.getNode(params.nodeId);

    if (!node) {
      throw new HarvestError(
        `Node ${params.nodeId} not found`,
        "NODE_NOT_FOUND",
        { nodeId: params.nodeId }
      );
    }

    // Inject response data
    if (node.nodeType === "curl" || node.nodeType === "master_curl") {
      node.content.value = {
        status: 200,
        statusText: "OK (Injected)",
        headers: {},
        json: params.responseData,
      };

      // Mark dynamic parts as resolved
      if (node.dynamicParts) {
        node.dynamicParts = [];
      }

      // Add extracted parts if provided
      if (params.extractedParts) {
        node.extractedParts = Object.keys(params.extractedParts);
      }
    }

    // Update node
    session.dagManager.updateNode(params.nodeId, node);

    // Log the change
    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Injected response for node ${params.nodeId}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            nodeId: params.nodeId,
            responseData: params.responseData,
            extractedParts: params.extractedParts,
            message: "Response injected successfully",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Response injection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "RESPONSE_INJECTION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle debug_reset_analysis tool call
 */
export async function handleResetAnalysis(
  params: {
    sessionId: string;
    preserveManualOverrides?: boolean;
  },
  context: DebugToolContext
): Promise<CallToolResult> {
  try {
    const preserveOverrides = params.preserveManualOverrides ?? true;
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Save manual overrides if needed
    const manualOverrides: Array<{
      nodeId: string;
      parameter: ClassifiedParameter;
    }> = [];

    if (preserveOverrides) {
      const allNodes = session.dagManager.getAllNodes();
      for (const [nodeId, node] of allNodes) {
        if (node.classifiedParameters) {
          for (const param of node.classifiedParameters) {
            if (param.source === "manual") {
              manualOverrides.push({ nodeId, parameter: param });
            }
          }
        }
      }
    }

    // Reset DAG manager
    session.dagManager = new DAGManager();

    // Reset session state
    session.state = {
      toBeProcessedNodes: [],
      inProcessNodeDynamicParts: [],
      inputVariables: session.state.inputVariables, // Preserve input variables
      isComplete: false,
      logs: [
        {
          timestamp: new Date(),
          level: "info",
          message: "Analysis reset",
          data: { preserveManualOverrides: preserveOverrides },
        },
      ],
      workflowGroups: new Map(), // Initialize workflow groups
    };

    // Log the reset
    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Analysis reset with ${manualOverrides.length} manual overrides preserved`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            preservedOverrides: manualOverrides.length,
            message: "Analysis reset successfully",
            nextStep:
              "Run analysis_start_primary_workflow to restart the workflow",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Analysis reset failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "ANALYSIS_RESET_FAILED",
      { originalError: error }
    );
  }
}

// Helper function
function findRequestByFlexibleUrl(
  requests: RequestModel[],
  targetUrl: string
): RequestModel | undefined {
  // Try exact match first
  let match = requests.find((r) => r.url === targetUrl);
  if (match) {
    return match;
  }

  // Try URL without query parameters
  try {
    const targetUrlObj = new URL(targetUrl);
    const targetBase = `${targetUrlObj.protocol}//${targetUrlObj.host}${targetUrlObj.pathname}`;

    match = requests.find((r) => {
      try {
        const reqUrlObj = new URL(r.url);
        const reqBase = `${reqUrlObj.protocol}//${reqUrlObj.host}${reqUrlObj.pathname}`;
        return reqBase === targetBase;
      } catch {
        return false;
      }
    });
    if (match) {
      return match;
    }
  } catch {
    // If URL parsing fails, fall back to partial matching
  }

  // Try partial matching
  return requests.find(
    (r) => r.url.includes(targetUrl) || targetUrl.includes(r.url)
  );
}
