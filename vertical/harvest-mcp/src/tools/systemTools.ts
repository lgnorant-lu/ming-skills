import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { parseHARFile } from "../core/HARParser.js";
import { getLLMClient } from "../core/LLMClient.js";
import { manualSessionManager } from "../core/ManualSessionManager.js";
import { validateConfiguration } from "../core/providers/ProviderFactory.js";
import {
  type CleanupResult,
  HarvestError,
  type ParsedHARData,
  type SystemToolContext,
} from "../types/index.js";

/**
 * Handle session_status tool call
 */
export async function handleSessionStatus(
  params: { sessionId: string },
  context: SystemToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Use comprehensive completion analysis for accurate status and recommendations
    const analysis = context.sessionManager.analyzeCompletionState(
      params.sessionId
    );

    // Calculate progress metrics
    const totalNodes = analysis.diagnostics.totalNodes;
    const unresolvedNodes = analysis.diagnostics.unresolvedNodes;
    const resolvedNodes = totalNodes - unresolvedNodes;
    const progressPercent =
      totalNodes > 0 ? Math.round((resolvedNodes / totalNodes) * 100) : 0;

    // Use analysis recommendations as next actions (more comprehensive and accurate)
    const nextActions: string[] = [...analysis.recommendations];
    const warnings: string[] = [];

    // Add specific progress indicators if analysis is in progress
    if (!analysis.isComplete && unresolvedNodes > 0) {
      nextActions.push(
        `📊 Progress: ${resolvedNodes}/${totalNodes} nodes resolved (${progressPercent}%)`
      );
    }

    // Add blockers as warnings if they exist
    if (analysis.blockers.length > 0) {
      warnings.push(`🚫 Current blockers: ${analysis.blockers.join("; ")}`);
    }

    // Check for potential issues
    if (
      session.harData.validation &&
      session.harData.validation.quality === "poor"
    ) {
      warnings.push("HAR file quality is poor - consider capturing a new one");
    }

    if (totalNodes === 0) {
      warnings.push(
        "No nodes in dependency graph - may need to run initial analysis"
      );
    }

    const lastActivity = new Date(session.lastActivity);
    const minutesInactive = Math.floor(
      (Date.now() - lastActivity.getTime()) / (1000 * 60)
    );

    if (minutesInactive > 30) {
      warnings.push(
        `Session inactive for ${minutesInactive} minutes - may be stale`
      );
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            status: {
              isComplete: analysis.isComplete,
              hasActionUrl: analysis.diagnostics.hasActionUrl,
              hasMasterNode: analysis.diagnostics.hasMasterNode,
              progressPercent,
              phase: analysis.diagnostics.hasMasterNode
                ? analysis.isComplete
                  ? "complete"
                  : "processing"
                : "initialization",
              blockers: analysis.blockers,
              canGenerateCode: analysis.isComplete,
              queueStatus: analysis.diagnostics.queueEmpty ? "empty" : "active",
            },
            progress: {
              totalNodes,
              resolvedNodes,
              unresolvedNodes,
              currentlyProcessing: session.state.inProcessNodeId,
              toBeProcessed: analysis.diagnostics.pendingInQueue,
              dagComplete: analysis.diagnostics.dagComplete,
              queueEmpty: analysis.diagnostics.queueEmpty,
            },
            sessionInfo: {
              prompt: session.prompt,
              createdAt: session.createdAt,
              lastActivity: session.lastActivity,
              minutesInactive,
              actionUrl: session.state.actionUrl,
            },
            harInfo: {
              totalRequests: session.harData.requests.length,
              totalUrls: session.harData.urls.length,
              quality: session.harData.validation?.quality || "unknown",
              hasCookies: !!session.cookieData,
            },
            nextActions,
            warnings,
            logs: session.state.logs.slice(-5), // Last 5 log entries
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to get session status: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SESSION_STATUS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle system_memory_status tool call
 */
export async function handleMemoryStatus(
  context: SystemToolContext
): Promise<CallToolResult> {
  try {
    const memoryStats = manualSessionManager.getMemoryStats();
    const stats = context.sessionManager.getStats();
    const analysisSessionsCount = stats.total;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            timestamp: new Date().toISOString(),
            memory: {
              current: {
                heapUsed: formatFileSize(memoryStats.current.heapUsed),
                heapTotal: formatFileSize(memoryStats.current.heapTotal),
                external: formatFileSize(memoryStats.current.external),
              },
              peak: {
                heapUsed: formatFileSize(memoryStats.peak.heapUsed),
                heapTotal: formatFileSize(memoryStats.peak.heapTotal),
              },
              average: {
                heapUsed: formatFileSize(memoryStats.average.heapUsed),
              },
              snapshotCount: memoryStats.snapshotCount,
            },
            sessions: {
              manualSessions: memoryStats.activeSessions,
              analysisSessions: analysisSessionsCount,
              totalSessions: memoryStats.activeSessions + analysisSessionsCount,
            },
            leakDetection: memoryStats.leakDetection,
            recommendations: generateMemoryRecommendations(memoryStats),
            status: getMemoryStatus(memoryStats.current.heapUsed),
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to get memory status: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MEMORY_STATUS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Build detailed analysis if requested
 */
function buildDetailedAnalysis(harData: ParsedHARData) {
  const requestsByMethod = harData.requests.reduce(
    (acc: Record<string, number>, req) => {
      acc[req.method] = (acc[req.method] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const domainBreakdown = harData.requests.reduce(
    (acc: Record<string, number>, req) => {
      const domain = new URL(req.url).hostname;
      acc[domain] = (acc[domain] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    requestsByMethod,
    domainBreakdown,
    sampleUrls: harData.urls.slice(0, 10).map((u: { url: string }) => u.url),
    fileSize: JSON.stringify(harData).length,
    timespan:
      harData.requests.length > 0
        ? {
            start: harData.requests[0]?.timestamp || new Date(),
            end:
              harData.requests[harData.requests.length - 1]?.timestamp ||
              new Date(),
          }
        : null,
  };
}

/**
 * Handle har_validate tool call - Uses centralized validation from HARParser
 */
export async function handleHarValidation(
  params: { harPath: string; detailed?: boolean },
  _context: SystemToolContext
): Promise<CallToolResult> {
  try {
    // Parse HAR file to get comprehensive validation results from HARParser
    const harData = await parseHARFile(params.harPath);
    const validation = harData.validation;

    if (!validation) {
      throw new HarvestError(
        "HAR validation data not available",
        "VALIDATION_MISSING"
      );
    }

    // Build detailed analysis if requested
    const detailedAnalysis = params.detailed
      ? buildDetailedAnalysis(harData)
      : {};

    // Calculate final score from validation stats
    const finalScore = validation.stats
      ? Math.round(
          (validation.stats.relevantEntries /
            Math.max(validation.stats.totalEntries, 1)) *
            100
        )
      : 0;
    const authAnalysis = validation.authAnalysis;

    // Build response using centralized validation results
    const response = {
      success: true,
      harPath: params.harPath,
      validation: {
        quality: validation.quality,
        score: finalScore,
        isReady:
          validation.quality !== "empty" &&
          (authAnalysis?.failedAuthRequests?.length || 0) === 0,
        issues: validation.issues,
        suggestions: validation.recommendations,
        authAnalysis: authAnalysis
          ? {
              hasAuthentication: authAnalysis.hasAuthentication,
              authTypes: authAnalysis.authTypes,
              authErrors: authAnalysis.failedAuthRequests?.length || 0,
              tokenCount: authAnalysis.tokens?.length || 0,
              securityConcerns: authAnalysis.securityIssues?.length || 0,
            }
          : undefined,
      },
      metrics: {
        totalRequests: validation.stats?.totalEntries || 0,
        meaningfulRequests: validation.stats?.relevantEntries || 0,
        totalUrls: harData.urls?.length || 0,
        requestScore: finalScore,
      },
      ...(params.detailed && { detailed: detailedAnalysis }),
      recommendations: [
        validation.quality === "excellent"
          ? "✅ HAR file is excellent for analysis"
          : validation.quality === "good"
            ? "✅ HAR file looks good for analysis"
            : validation.quality === "poor"
              ? "⚠️ HAR file has issues that may affect code generation"
              : "❌ HAR file needs significant improvements",
        ...validation.recommendations,
        ...((authAnalysis?.failedAuthRequests?.length || 0) > 0
          ? [
              "🔐 Authentication issues detected - generated code may fail at runtime",
              "🔧 Fix authentication problems before proceeding with code generation",
            ]
          : []),
      ],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `HAR validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "HAR_VALIDATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle system_config_validate tool call
 */
export async function handleConfigValidation(
  params: {
    testApiKey?: string | undefined;
    testProvider?: string | undefined;
  },
  _context: SystemToolContext
): Promise<CallToolResult> {
  try {
    // Get configuration status from centralized ConfigManager
    const config = validateConfiguration();

    // Test API key if provided
    let testResults:
      | {
          testPassed: boolean;
          testError?: string;
          testProvider?: string;
        }
      | undefined;

    if (params.testApiKey && params.testProvider) {
      try {
        // Use the default LLM client with CLI configuration
        const testClient = getLLMClient();

        // Test with a simple function call
        await testClient.callFunction(
          "Test configuration",
          {
            name: "test_config",
            description: "Test function for configuration validation",
            parameters: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  description: "Configuration test status",
                },
              },
              required: ["status"],
            },
          },
          "test_config"
        );

        testResults = {
          testPassed: true,
          testProvider: params.testProvider,
        };
      } catch (error) {
        testResults = {
          testPassed: false,
          testError: error instanceof Error ? error.message : "Unknown error",
          testProvider: params.testProvider,
        };
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            timestamp: new Date().toISOString(),
            configuration: {
              isConfigured: config.isConfigured,
              configurationSource: config.configurationSource,
              availableProviders: config.availableProviders,
              configuredProviders: config.configuredProviders,
              cliArguments: {
                // CLI arguments are now handled by ConfigManager during initialization
                note: "CLI configuration is processed by ConfigManager during server startup",
              },
              environmentVariables: {
                LLM_PROVIDER: !!process.env.LLM_PROVIDER,
                OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
                GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
                LLM_MODEL: !!process.env.LLM_MODEL,
              },
              recommendations: config.recommendations,
              warnings: config.warnings,
              ...(testResults && { testResults }),
            },
            setupInstructions: {
              preferredMethod: [
                "RECOMMENDED: Use CLI arguments in MCP client configuration:",
                "{",
                '  "mcpServers": {',
                '    "harvest-mcp": {',
                '      "command": "bun",',
                '      "args": [',
                '        "run", "src/server.ts",',
                '        "--provider=openai",',
                '        "--api-key=sk-your-openai-key"',
                "      ]",
                "    }",
                "  }",
                "}",
                "",
                "Or for Google Gemini:",
                '        "--provider=google",',
                '        "--api-key=AIza-your-google-key"',
              ],
              alternativeMethod: [
                "Alternative: Use environment variables:",
                "{",
                '  "mcpServers": {',
                '    "harvest-mcp": {',
                '      "command": "bun",',
                '      "args": ["run", "src/server.ts"],',
                '      "env": {',
                '        "OPENAI_API_KEY": "your-openai-key",',
                '        "GOOGLE_API_KEY": "your-google-key",',
                '        "LLM_PROVIDER": "openai"',
                "      }",
                "    }",
                "  }",
                "}",
              ],
              forEnvironment: [
                "Set environment variables in your shell:",
                "export OPENAI_API_KEY=your-openai-key",
                "export GOOGLE_API_KEY=your-google-key",
                "export LLM_PROVIDER=openai",
              ],
              cliArguments: [
                "Pass API keys via CLI arguments:",
                "--provider=openai --api-key=your-openai-key",
                "--provider=google --api-key=your-google-key",
              ],
            },
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Configuration validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "CONFIG_VALIDATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle system_cleanup tool call
 */
export async function handleSystemCleanup(
  params: { aggressive?: boolean },
  _context: SystemToolContext
): Promise<CallToolResult> {
  try {
    const aggressive = params.aggressive || false;

    const beforeStats = manualSessionManager.getMemoryStats();
    const beforeMemory = beforeStats.current.heapUsed;

    let cleanupResult: CleanupResult;

    if (aggressive) {
      cleanupResult = manualSessionManager.performAggressiveCleanup();
    } else {
      cleanupResult = manualSessionManager.performCleanup();
    }

    const afterStats = manualSessionManager.getMemoryStats();
    const afterMemory = afterStats.current.heapUsed;
    const totalReclaimed = beforeMemory - afterMemory;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            cleanupType: aggressive ? "aggressive" : "standard",
            timestamp: new Date().toISOString(),
            results: {
              ...cleanupResult,
              totalMemoryReclaimed: formatFileSize(totalReclaimed),
              memoryBefore: formatFileSize(beforeMemory),
              memoryAfter: formatFileSize(afterMemory),
            },
            newMemoryStatus: getMemoryStatus(afterMemory),
            message: aggressive
              ? "Aggressive cleanup completed"
              : "Standard cleanup completed",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to perform system cleanup: ${error instanceof Error ? error.message : "Unknown error"}`,
      "SYSTEM_CLEANUP_FAILED",
      { originalError: error }
    );
  }
}

// Helper functions

/**
 * Generate memory usage recommendations
 */
function generateMemoryRecommendations(
  memoryStats: ReturnType<typeof manualSessionManager.getMemoryStats>
): string[] {
  const recommendations: string[] = [];
  const currentMemoryMB = memoryStats.current.heapUsed / (1024 * 1024);

  if (currentMemoryMB > 500) {
    recommendations.push(
      "🔴 High memory usage detected - consider using system_cleanup"
    );
  } else if (currentMemoryMB > 300) {
    recommendations.push(
      "🟡 Moderate memory usage - monitor for continued growth"
    );
  } else {
    recommendations.push("🟢 Memory usage is within normal range");
  }

  if (memoryStats.activeSessions > 5) {
    recommendations.push(
      "📊 Many active sessions - consider closing unused sessions"
    );
  }

  if (memoryStats.leakDetection.isLeaking) {
    recommendations.push(
      `⚠️ Memory leak detected: ${memoryStats.leakDetection.recommendation}`
    );
  }

  if (memoryStats.snapshotCount > 100) {
    recommendations.push("🗑️ Many memory snapshots - cleanup may help");
  }

  return recommendations;
}

/**
 * Get memory status classification
 */
function getMemoryStatus(
  heapUsed: number
): "healthy" | "moderate" | "high" | "critical" {
  const memoryMB = heapUsed / (1024 * 1024);

  if (memoryMB > 800) {
    return "critical";
  }
  if (memoryMB > 500) {
    return "high";
  }
  if (memoryMB > 300) {
    return "moderate";
  }
  return "healthy";
}

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes === 0) {
    return "0 B";
  }

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

/**
 * Register system tools with the MCP server
 */
export function registerSystemTools(
  server: McpServer,
  context: SystemToolContext
): void {
  server.tool(
    "session_status",
    "Get detailed status of a specific session including progress, completion, and next recommended actions",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session to check. Provides comprehensive status information and next steps."
        ),
    },
    async (params) => handleSessionStatus(params, context)
  );

  server.tool(
    "system_memory_status",
    "Get current memory usage and session statistics",
    {},
    async () => handleMemoryStatus(context)
  );

  server.tool(
    "har_validate",
    "Validate a HAR file before analysis to check quality and identify potential issues",
    {
      harPath: z.string().min(1).describe("Path to the HAR file to validate"),
      detailed: z
        .boolean()
        .default(false)
        .describe(
          "Include detailed analysis with request breakdowns, domain statistics, and file metrics"
        ),
    },
    async (params) => handleHarValidation(params, context)
  );

  server.tool(
    "system_config_validate",
    "Validate the current system configuration including LLM provider settings and API keys",
    {
      testApiKey: z
        .string()
        .optional()
        .describe("Optional API key to test (will not be stored)"),
      testProvider: z
        .string()
        .optional()
        .describe("Provider to test with the API key (openai, google, gemini)"),
    },
    async (params) => handleConfigValidation(params, context)
  );

  server.tool(
    "system_cleanup",
    "Perform system cleanup to free memory and clean up stale sessions",
    {
      aggressive: z
        .boolean()
        .default(false)
        .describe(
          "Perform aggressive cleanup (may close active sessions). Use with caution."
        ),
    },
    async (params) => handleSystemCleanup(params, context)
  );
}
