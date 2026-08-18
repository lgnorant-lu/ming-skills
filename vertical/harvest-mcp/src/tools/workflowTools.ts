import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { HarvestError, type WorkflowToolContext } from "../types/index.js";
import { handleIsComplete, handleProcessNextNode } from "./analysisTools.js";
import { handleGenerateWrapperScript } from "./codegenTools.js";
import { handleStartManualSession } from "./manualSessionTools.js";
import { handleSessionStart } from "./sessionTools.js";

/**
 * Handle workflow_complete_analysis tool call
 */
export async function handleCompleteAnalysis(
  params: { sessionId: string; maxIterations?: number },
  context: WorkflowToolContext
): Promise<CallToolResult> {
  try {
    const argsObj = parseCompleteAnalysisArgs(params);
    const startTime = Date.now();
    const steps: string[] = [];
    const warnings: string[] = [];

    steps.push("🚀 Starting complete analysis workflow");

    // Step 1: Run initial analysis
    const initialResult = await runInitialAnalysisForWorkflow(
      argsObj,
      steps,
      context
    );
    if (initialResult.isError) {
      return createErrorResult(
        initialResult,
        argsObj.sessionId,
        steps,
        startTime
      );
    }

    const initialData = JSON.parse(
      (initialResult.content?.[0]?.text as string) || '{"actionUrl": "unknown"}'
    );
    steps.push(
      `✅ Initial analysis complete - Target URL: ${initialData.actionUrl}`
    );

    // Step 2: Process all nodes iteratively
    const processingResult = await processNodesIteratively(
      argsObj,
      steps,
      warnings,
      context
    );
    const { isComplete, iterations } = processingResult;

    // Step 3: Generate code (if analysis is complete)
    const { generatedCode, codeGenerationSuccess } =
      await generateCodeIfComplete(
        isComplete,
        argsObj,
        steps,
        warnings,
        context
      );

    const elapsedTime = Date.now() - startTime;
    steps.push(`🎯 Workflow completed in ${elapsedTime}ms`);

    return createSuccessResult({
      sessionId: argsObj.sessionId,
      isComplete,
      iterations,
      ...(generatedCode !== undefined && { generatedCode }),
      codeGenerationSuccess,
      steps,
      warnings,
      elapsedTime,
    });
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Complete analysis workflow failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "WORKFLOW_ANALYSIS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle workflow_quick_capture tool call
 */
export async function handleQuickCaptureWorkflow(
  params: { url?: string | undefined; duration: number; description: string },
  context: WorkflowToolContext
): Promise<CallToolResult> {
  try {
    // Start a manual session with smart defaults
    const sessionConfig = {
      ...(params.url && { url: params.url }),
      config: {
        timeout: params.duration,
        browserOptions: {
          headless: false,
          viewport: { width: 1920, height: 1080 },
        },
        artifactConfig: {
          enabled: true,
          saveHar: true,
          saveCookies: true,
          saveScreenshots: true,
          // Use client-accessible shared directory instead of Desktop
          outputDir: process.env.HARVEST_SHARED_DIR || "~/.harvest/shared",
        },
      },
    };

    const sessionResult = await handleStartManualSession(
      sessionConfig,
      context
    );
    const sessionContent = sessionResult.content?.[0]?.text;
    if (typeof sessionContent !== "string") {
      throw new Error("Invalid session result format");
    }
    const sessionData = JSON.parse(sessionContent);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            workflow: "quick_capture",
            sessionId: sessionData.sessionId,
            duration: params.duration,
            description: params.description,
            message:
              "Manual browser session started - ready for user interaction",
            instructions: sessionData.instructions,
            nextSteps: [
              "1. Use the browser window to complete your workflow",
              `2. Session will auto-timeout after ${params.duration} minutes`,
              "3. Use session_stop_manual when finished to collect artifacts",
              "4. Use session_convert_manual_to_analysis to create analysis session",
              "5. Use workflow_analyze_har for automated processing",
            ],
            browserInfo: {
              sessionId: sessionData.sessionId,
              outputDir: sessionData.outputDir,
              artifactConfig: sessionData.artifactConfig,
            },
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Quick capture workflow failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "WORKFLOW_QUICK_CAPTURE_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle workflow_analyze_har tool call
 */
export async function handleAnalyzeHarWorkflow(
  params: {
    harPath: string;
    cookiePath?: string | undefined;
    description: string;
    autoFix?: boolean | undefined;
  },
  context: WorkflowToolContext
): Promise<CallToolResult> {
  try {
    const startTime = Date.now();
    const workflow: string[] = [];
    const warnings: string[] = [];

    workflow.push("🚀 Starting HAR analysis workflow");
    workflow.push(`📁 HAR file: ${params.harPath}`);
    if (params.cookiePath) {
      workflow.push(`🍪 Cookie file: ${params.cookiePath}`);
    }

    // Step 1: Create analysis session
    const sessionResult = await handleSessionStart(
      {
        harPath: params.harPath,
        cookiePath: params.cookiePath,
        prompt: params.description,
      },
      context
    );

    const sessionContent = sessionResult.content?.[0]?.text;
    if (typeof sessionContent !== "string") {
      throw new Error("Invalid session result format");
    }
    const sessionData = JSON.parse(sessionContent);
    const sessionId = sessionData.sessionId;

    workflow.push(`✅ Analysis session created: ${sessionId}`);

    // Step 2: Run complete analysis workflow
    const analysisResult = await handleCompleteAnalysis(
      {
        sessionId,
        maxIterations: 20,
      },
      context
    );

    const analysisContent = analysisResult.content?.[0]?.text;
    if (typeof analysisContent !== "string") {
      throw new Error("Invalid analysis result format");
    }
    const analysisData = JSON.parse(analysisContent);

    const elapsedTime = Date.now() - startTime;
    workflow.push(`🎯 Analysis completed in ${elapsedTime}ms`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: analysisData.success,
            workflow: "analyze_har",
            sessionId,
            harPath: params.harPath,
            cookiePath: params.cookiePath,
            description: params.description,
            elapsedTime,
            isComplete: analysisData.isComplete,
            iterations: analysisData.iterations,
            generatedCode: analysisData.generatedCode,
            codeGenerated: analysisData.codeGenerationSuccess,
            steps: [...workflow, ...analysisData.steps],
            warnings: [...warnings, ...analysisData.warnings],
            message: analysisData.isComplete
              ? "HAR analysis completed successfully with generated code"
              : "HAR analysis completed but requires manual intervention",
            nextSteps: analysisData.isComplete
              ? [
                  "1. Review the generated TypeScript code",
                  "2. Test the generated code in your environment",
                  "3. Customize parameters as needed",
                ]
              : [
                  "1. Use debug tools to investigate remaining issues",
                  "2. Consider manual intervention for unresolved dependencies",
                  `3. Check session ${sessionId} for detailed analysis state`,
                ],
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `HAR analysis workflow failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "WORKFLOW_HAR_ANALYSIS_FAILED",
      { originalError: error }
    );
  }
}

// Helper functions

/**
 * Parse complete analysis arguments
 */
function parseCompleteAnalysisArgs(args: unknown) {
  const argsObj = args as { sessionId: string; maxIterations?: number };
  if (!argsObj.sessionId) {
    throw new HarvestError("sessionId is required", "INVALID_ARGUMENTS");
  }
  return {
    sessionId: argsObj.sessionId,
    maxIterations: argsObj.maxIterations || 20,
  };
}

/**
 * Run initial analysis for workflow
 */
async function runInitialAnalysisForWorkflow(
  argsObj: ReturnType<typeof parseCompleteAnalysisArgs>,
  steps: string[],
  context: WorkflowToolContext
): Promise<CallToolResult & { isError?: boolean }> {
  try {
    // Import analysis tools dynamically to avoid circular imports
    const { handleStartPrimaryWorkflow } = await import("./analysisTools.js");

    steps.push("🔍 Running workflow discovery to identify primary workflow");
    const result = await handleStartPrimaryWorkflow(
      { sessionId: argsObj.sessionId },
      context
    );
    return { ...result, isError: false };
  } catch (error) {
    steps.push("❌ Initial analysis failed - attempting fallback strategies");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: `Initial analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            sessionId: argsObj.sessionId,
          }),
        },
      ],
      isError: true,
    };
  }
}

/**
 * Create error result
 */
function createErrorResult(
  initialResult: CallToolResult,
  sessionId: string,
  steps: string[],
  startTime: number
): CallToolResult {
  const elapsedTime = Date.now() - startTime;
  steps.push(`❌ Workflow failed after ${elapsedTime}ms`);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          sessionId,
          elapsedTime,
          error: "Workflow failed during initial analysis",
          steps,
          details: initialResult.content?.[0],
        }),
      },
    ],
  };
}

/**
 * Process nodes iteratively
 */
async function processNodesIteratively(
  argsObj: ReturnType<typeof parseCompleteAnalysisArgs>,
  steps: string[],
  warnings: string[],
  context: WorkflowToolContext
): Promise<{ isComplete: boolean; iterations: number }> {
  let iterations = 0;
  let isComplete = false;

  steps.push(
    `🔄 Starting iterative node processing (max ${argsObj.maxIterations} iterations)`
  );

  while (!isComplete && iterations < argsObj.maxIterations) {
    try {
      // Check completion first
      const completeResult = handleIsComplete(
        { sessionId: argsObj.sessionId },
        context
      );
      const completeContent = completeResult.content?.[0]?.text;
      if (typeof completeContent === "string") {
        const completeData = JSON.parse(completeContent);
        if (completeData.isComplete) {
          isComplete = true;
          break;
        }
      }

      // Process next node
      const processResult = await handleProcessNextNode(
        { sessionId: argsObj.sessionId },
        context
      );
      const processContent = processResult.content?.[0]?.text;
      if (typeof processContent === "string") {
        const processData = JSON.parse(processContent);

        if (processData.status === "no_nodes_to_process") {
          steps.push("⚠️ No more nodes to process - analysis may be incomplete");
          break;
        }
        if (processData.status === "skipped_javascript") {
          steps.push(
            `↩️ Iteration ${iterations + 1}: Skipped JavaScript/HTML node`
          );
        } else {
          steps.push(
            `✅ Iteration ${iterations + 1}: Processed node successfully`
          );
        }
      }

      iterations++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      warnings.push(`Iteration ${iterations + 1}: ${errorMsg}`);
      steps.push(
        `⚠️ Iteration ${iterations + 1}: Encountered error but continuing`
      );
      iterations++;
    }
  }

  if (iterations >= argsObj.maxIterations && !isComplete) {
    warnings.push(
      `Analysis stopped after ${argsObj.maxIterations} iterations - may need manual intervention`
    );
    steps.push(
      `⏹️ Stopped after ${argsObj.maxIterations} iterations (max reached)`
    );
  } else if (isComplete) {
    steps.push(`✅ Analysis completed after ${iterations} iterations`);
  }

  return { isComplete, iterations };
}

/**
 * Generate code if analysis is complete
 */
async function generateCodeIfComplete(
  isComplete: boolean,
  argsObj: ReturnType<typeof parseCompleteAnalysisArgs>,
  steps: string[],
  warnings: string[],
  context: WorkflowToolContext
): Promise<{ generatedCode?: string; codeGenerationSuccess: boolean }> {
  if (!isComplete) {
    steps.push("⚠️ Skipping code generation - analysis incomplete");
    return { codeGenerationSuccess: false };
  }

  try {
    steps.push("🛠️ Generating TypeScript wrapper script");
    const codeResult = await handleGenerateWrapperScript(
      { sessionId: argsObj.sessionId },
      context
    );
    const codeContent = codeResult.content?.[0]?.text;
    if (typeof codeContent === "string") {
      steps.push(
        `✅ Code generation successful - ${codeContent.length} characters generated`
      );
      return { generatedCode: codeContent, codeGenerationSuccess: true };
    }

    throw new Error("Invalid code generation result format");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    warnings.push(`Code generation failed: ${errorMsg}`);
    steps.push("❌ Code generation failed");
    return { codeGenerationSuccess: false };
  }
}

/**
 * Create success result
 */
function createSuccessResult(params: {
  sessionId: string;
  isComplete: boolean;
  iterations: number;
  generatedCode?: string;
  codeGenerationSuccess: boolean;
  steps: string[];
  warnings: string[];
  elapsedTime: number;
}): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          sessionId: params.sessionId,
          isComplete: params.isComplete,
          iterations: params.iterations,
          codeGenerationSuccess: params.codeGenerationSuccess,
          generatedCode: params.generatedCode,
          elapsedTime: params.elapsedTime,
          steps: params.steps,
          warnings: params.warnings,
          summary: {
            analysisCompleted: params.isComplete,
            codeGenerated: params.codeGenerationSuccess,
            totalIterations: params.iterations,
            processingTime: `${params.elapsedTime}ms`,
            warningsCount: params.warnings.length,
          },
          message:
            params.isComplete && params.codeGenerationSuccess
              ? "Complete analysis workflow finished successfully with generated code"
              : params.isComplete
                ? "Analysis completed but code generation failed"
                : "Analysis workflow completed but requires manual intervention",
        }),
      },
    ],
  };
}

/**
 * Register workflow tools with the MCP server
 */
export function registerWorkflowTools(
  server: McpServer,
  context: WorkflowToolContext
): void {
  server.tool(
    "workflow_complete_analysis",
    "Complete end-to-end analysis workflow: automatically runs initial analysis, processes all nodes, and generates code. Configure API keys using CLI arguments: --provider and --api-key.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session to analyze. Must be a session created with session_start that hasn't been analyzed yet."
        ),
      maxIterations: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe(
          "Maximum number of analysis iterations to prevent infinite loops."
        ),
    },
    async (params) => handleCompleteAnalysis(params, context)
  );

  server.tool(
    "workflow_quick_capture",
    "Simplified workflow: Start manual session, capture interactions, and prepare for analysis",
    {
      url: z.string().url("URL must be a valid HTTP/HTTPS URL").optional(),
      duration: z
        .number()
        .min(1)
        .max(30)
        .default(5)
        .describe("Session duration in minutes (1-30, default: 5)"),
      description: z
        .string()
        .min(1)
        .describe("Brief description of the workflow to capture"),
    },
    async (params) => handleQuickCaptureWorkflow(params, context)
  );

  server.tool(
    "workflow_analyze_har",
    "Simplified workflow: Analyze HAR file with automatic fallbacks and clear feedback. Configure API keys using CLI arguments: --provider and --api-key.",
    {
      harPath: z.string().min(1).describe("Path to the HAR file"),
      cookiePath: z
        .string()
        .optional()
        .describe("Path to cookie file (optional)"),
      description: z
        .string()
        .min(1)
        .describe("Description of what the workflow should accomplish"),
      autoFix: z
        .boolean()
        .default(true)
        .describe("Automatically attempt to fix common issues"),
    },
    async (params) => handleAnalyzeHarWorkflow(params, context)
  );
}
