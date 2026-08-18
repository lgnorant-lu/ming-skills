/**
 * Debug tool registry
 *
 * Registers all debug-specific MCP tools with type safety.
 * These tools provide debugging capabilities for the analysis workflow.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  DebugToolContext,
  ParameterClassification,
} from "../types/index.js";
// Import debug tool handlers with their actual types
import {
  handleAnalyzeParameters,
  handleBatchClassifyParameters,
  handleForceDependency,
  handleGetCompletionBlockers,
  handleGetNodeDetails,
  handleGetUnresolvedNodes,
  handleInjectResponse,
  handleListAllRequests,
  handleOverrideParameterClassification,
  handlePreviewHar,
  handleResetAnalysis,
  handleSetMasterNode,
  handleSkipNode,
} from "./debugTools.js";

/**
 * Register all debug tools for the MCP server
 */
export function registerDebugTools(
  server: McpServer,
  context: DebugToolContext
): void {
  // sessionId-only tools
  server.tool(
    "debug_get_unresolved_nodes",
    "Get a list of all nodes in the dependency graph that still have unresolved dynamic parts. Useful for debugging analysis issues.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session to inspect. Shows which nodes still need processing and why analysis isn't complete."
        ),
    },
    async (params) => handleGetUnresolvedNodes(params, context)
  );

  server.tool(
    "debug_list_all_requests",
    "Get a complete list of all HTTP requests in the session with their current analysis status and identified issues.",
    {
      sessionId: z.string().uuid().describe("UUID of the session to analyze"),
    },
    async (params) => handleListAllRequests(params, context)
  );

  server.tool(
    "debug_get_completion_blockers",
    "Get a detailed analysis of what is preventing the session analysis from completing, with specific actionable recommendations.",
    {
      sessionId: z.string().uuid().describe("UUID of the session to analyze"),
    },
    async (params) => handleGetCompletionBlockers(params, context)
  );

  server.tool(
    "debug_reset_analysis",
    "Reset the analysis state for a session, clearing all processed data and starting fresh. Use when analysis gets into a corrupted state.",
    {
      sessionId: z.string().uuid().describe("UUID of the session to reset"),
    },
    async (params) => handleResetAnalysis(params, context)
  );

  server.tool(
    "debug_analyze_parameters",
    "Run parameter analysis on all nodes and show classification results. Helps debug parameter classification issues.",
    {
      harPath: z.string().describe("Path to HAR file to analyze"),
      url: z.string().optional().describe("Optional specific URL to analyze"),
    },
    async (params) => {
      const cleanParams = {
        harPath: params.harPath,
        ...(params.url !== undefined && { url: params.url }),
      };
      return handleAnalyzeParameters(cleanParams);
    }
  );

  server.tool(
    "debug_preview_har",
    "Preview the HAR file structure and content for debugging purposes. Shows request headers, timing, and validation status.",
    {
      harPath: z.string().describe("Path to HAR file to preview"),
      showUrls: z.boolean().optional().describe("Whether to show URL details"),
      showAuth: z
        .boolean()
        .optional()
        .describe("Whether to show authentication details"),
    },
    async (params) => {
      const cleanParams = {
        harPath: params.harPath,
        ...(params.showUrls !== undefined && { showUrls: params.showUrls }),
        ...(params.showAuth !== undefined && { showAuth: params.showAuth }),
      };
      return handlePreviewHar(cleanParams);
    }
  );

  // sessionId + nodeId tools
  server.tool(
    "debug_get_node_details",
    "Get detailed information about a specific node in the dependency graph, including its analysis state, dependencies, and parameters.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe("UUID of the session containing the node"),
      nodeId: z.string().describe("ID of the DAG node to inspect"),
    },
    async (params) => handleGetNodeDetails(params, context)
  );

  server.tool(
    "debug_set_master_node",
    "Manually set which node should be considered the master/action node for the workflow. This is the primary request that represents the main action.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      url: z.string().describe("URL of the request to set as master node"),
    },
    async (params) => handleSetMasterNode(params, context)
  );

  server.tool(
    "debug_skip_node",
    "Mark a node as skipped in the analysis process. Use when a node is problematic or not needed for the workflow.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      nodeId: z.string().describe("ID of the node to skip"),
      reason: z
        .string()
        .optional()
        .default("No reason provided")
        .describe("Reason for skipping the node"),
    },
    async (params) => handleSkipNode(params, context)
  );

  // Complex parameter tools
  server.tool(
    "debug_force_dependency",
    "Manually force a dependency relationship between two nodes in the dependency graph. Use when automatic dependency detection fails.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      consumerNodeId: z.string().describe("ID of the consumer node"),
      providerNodeId: z.string().describe("ID of the provider node"),
      providedPart: z.string().describe("Name of the dynamic part provided"),
    },
    async (params) => handleForceDependency(params, context)
  );

  server.tool(
    "debug_override_parameter_classification",
    "Override the automatic classification of a specific parameter. Use when the AI incorrectly classifies a parameter type.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      nodeId: z.string().describe("ID of the node containing the parameter"),
      parameterValue: z.string().describe("The parameter value to classify"),
      newClassification: z
        .enum([
          "dynamic",
          "sessionConstant",
          "staticConstant",
          "userInput",
          "optional",
        ])
        .describe("New classification for the parameter"),
      reasoning: z
        .string()
        .optional()
        .describe("Optional explanation for the override"),
    },
    async (params) => {
      const cleanParams = {
        sessionId: params.sessionId,
        nodeId: params.nodeId,
        parameterValue: params.parameterValue,
        newClassification: params.newClassification as ParameterClassification,
        ...(params.reasoning !== undefined && { reasoning: params.reasoning }),
      };
      return handleOverrideParameterClassification(cleanParams, context);
    }
  );

  server.tool(
    "debug_batch_classify_parameters",
    "Apply multiple parameter classification overrides in a single operation. Efficient for correcting multiple misclassifications.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      classifications: z
        .array(
          z.object({
            pattern: z.string(),
            classification: z.enum([
              "dynamic",
              "sessionConstant",
              "staticConstant",
              "userInput",
              "optional",
            ]),
            reasoning: z.string().optional(),
          })
        )
        .describe("Array of classification rules to apply"),
    },
    async (params) => {
      const cleanParams = {
        sessionId: params.sessionId,
        classifications: params.classifications.map((c) => ({
          pattern: c.pattern,
          classification: c.classification as ParameterClassification,
          ...(c.reasoning !== undefined && { reasoning: c.reasoning }),
        })),
      };
      return handleBatchClassifyParameters(cleanParams, context);
    }
  );

  server.tool(
    "debug_inject_response",
    "Inject a mock response for a node to unblock analysis. Useful when a request fails or returns unexpected data.",
    {
      sessionId: z.string().uuid().describe("UUID of the session"),
      nodeId: z.string().describe("ID of the node to inject response for"),
      responseData: z.record(z.unknown()).describe("Response data to inject"),
      extractedParts: z
        .record(z.string())
        .optional()
        .describe("Optional extracted dynamic parts"),
    },
    async (params) => {
      const cleanParams = {
        sessionId: params.sessionId,
        nodeId: params.nodeId,
        responseData: params.responseData,
        ...(params.extractedParts !== undefined && {
          extractedParts: params.extractedParts,
        }),
      };
      return handleInjectResponse(cleanParams, context);
    }
  );
}
