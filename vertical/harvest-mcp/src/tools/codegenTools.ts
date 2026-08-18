import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { generateWrapperScript } from "../core/CodeGenerator.js";
import {
  type CodeGenerationData,
  type CodegenToolContext,
  HarvestError,
  type InternalToolResult,
} from "../types/index.js";

/**
 * Handle codegen.generate_wrapper_script tool call (public MCP interface)
 */
export async function handleGenerateWrapperScript(
  params: { sessionId: string },
  context: CodegenToolContext
): Promise<CallToolResult> {
  const result = await _internalHandleGenerateWrapperScript(params, context);

  if (!result.success) {
    throw new HarvestError(
      result.error?.message || "Code generation failed",
      result.error?.code || "CODE_GENERATION_FAILED"
    );
  }

  return {
    content: [
      {
        type: "text",
        text: result.data.code,
      },
    ],
  };
}

/**
 * Internal strongly-typed code generation method
 */
async function _internalHandleGenerateWrapperScript(
  params: { sessionId: string },
  context: CodegenToolContext
): Promise<InternalToolResult<CodeGenerationData>> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      return {
        success: false,
        data: { code: "", language: "typescript", characterCount: 0 },
        error: {
          message: `Session ${params.sessionId} not found`,
          code: "SESSION_NOT_FOUND",
        },
      };
    }

    // Use comprehensive completion analysis for detailed validation and error reporting
    const analysis = context.sessionManager.analyzeCompletionState(
      params.sessionId
    );

    if (!analysis.isComplete) {
      // Create comprehensive error message with specific blockers and recommendations
      const blockersList = analysis.blockers
        .map((blocker, index) => `  ${index + 1}. ${blocker}`)
        .join("\n");
      const recommendationsList = analysis.recommendations
        .map((rec, index) => `  ${index + 1}. ${rec}`)
        .join("\n");

      const detailedMessage = `Code generation failed - analysis prerequisites not met.

🚫 Blockers preventing completion:
${blockersList}

💡 Recommended actions:
${recommendationsList}

📊 Analysis diagnostics:
  - Master node identified: ${analysis.diagnostics.hasMasterNode ? "✅" : "❌"}
  - Target action URL found: ${analysis.diagnostics.hasActionUrl ? "✅" : "❌"}
  - DAG completion: ${analysis.diagnostics.dagComplete ? "✅" : "❌"}
  - Processing queue: ${analysis.diagnostics.pendingInQueue} pending, ${analysis.diagnostics.queueEmpty ? "empty" : "active"}
  - Node resolution: ${analysis.diagnostics.totalNodes - analysis.diagnostics.unresolvedNodes}/${analysis.diagnostics.totalNodes} resolved`;

      return {
        success: false,
        data: { code: "", language: "typescript", characterCount: 0 },
        error: {
          message: detailedMessage,
          code: "ANALYSIS_INCOMPLETE",
        },
      };
    }

    // Analyze completion state if needed (should already be analyzed by workflow)
    context.sessionManager.analyzeCompletionState(params.sessionId);

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      "Starting code generation for completed analysis"
    );

    // Generate the wrapper script
    const generatedCode = await generateWrapperScript(session);

    // Store the generated code in session state for resource access
    session.state.generatedCode = generatedCode;

    context.sessionManager.addLog(
      params.sessionId,
      "info",
      `Code generation completed successfully - ${generatedCode.length} characters generated`
    );

    // Cache the completed session artifacts for future access
    try {
      const analysis = context.sessionManager.analyzeCompletionState(
        params.sessionId
      );
      await context.completedSessionManager.cacheCompletedSession(
        session,
        analysis
      );

      context.sessionManager.addLog(
        params.sessionId,
        "info",
        "Session artifacts cached successfully for future access"
      );
    } catch (cacheError) {
      // Log cache error but don't fail the code generation
      context.sessionManager.addLog(
        params.sessionId,
        "warn",
        `Failed to cache session artifacts: ${cacheError instanceof Error ? cacheError.message : "Unknown error"}`
      );
    }

    return {
      success: true,
      data: {
        code: generatedCode,
        language: "typescript",
        characterCount: generatedCode.length,
      },
    };
  } catch (error) {
    // Handle cycle detection errors specifically
    if (
      error instanceof Error &&
      error.message.includes("Graph contains cycles")
    ) {
      return {
        success: false,
        data: { code: "", language: "typescript", characterCount: 0 },
        error: {
          message: error.message,
          code: "GRAPH_CONTAINS_CYCLES",
        },
      };
    }

    return {
      success: false,
      data: { code: "", language: "typescript", characterCount: 0 },
      error: {
        message: `Code generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        code: "CODE_GENERATION_FAILED",
      },
    };
  }
}

/**
 * Register code generation tools with the MCP server
 */
export function registerCodegenTools(
  server: McpServer,
  context: CodegenToolContext
): void {
  server.tool(
    "codegen_generate_wrapper_script",
    "Generate a complete TypeScript wrapper script from the completed dependency analysis. Only works when analysis is complete (all nodes resolved).",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session with completed analysis. Use analysis_is_complete to verify the session is ready for code generation."
        ),
    },
    async (params) => handleGenerateWrapperScript(params, context)
  );
}
