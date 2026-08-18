import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  manualSessionManager,
  SessionStillActiveError,
} from "../core/ManualSessionManager.js";
import {
  type BrowserSessionInfo,
  HarvestError,
  ManualSessionStartSchema,
  ManualSessionStopSchema,
  type ManualSessionToolContext,
  type SessionConfig,
} from "../types/index.js";

/**
 * Handle session_start_manual tool call
 */
export async function handleStartManualSession(
  params: z.infer<typeof ManualSessionStartSchema>,
  _context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    const validationResult = ManualSessionStartSchema.safeParse(params);
    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

      throw new HarvestError(
        `Invalid parameters for manual session start: ${errorDetails}`,
        "MANUAL_SESSION_INVALID_PARAMS",
        {
          validationErrors: validationResult.error.issues,
          receivedArgs: params,
        }
      );
    }

    const argsObj = validationResult.data;
    const sessionConfig = buildSessionConfig(argsObj);
    const sessionInfo = await manualSessionManager.startSession(sessionConfig);

    return buildManualSessionStartResponse(sessionInfo, argsObj, params);
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to start manual session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_SESSION_START_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle session_stop_manual tool call
 */
export async function handleStopManualSession(
  params: z.infer<typeof ManualSessionStopSchema>,
  _context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    const validationResult = ManualSessionStopSchema.safeParse(params);
    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

      throw new HarvestError(
        `Invalid parameters for manual session stop: ${errorDetails}`,
        "MANUAL_SESSION_STOP_INVALID_PARAMS",
        {
          validationErrors: validationResult.error.issues,
          receivedArgs: params,
        }
      );
    }

    const argsObj = validationResult.data;

    // Check if session exists before attempting to stop
    const sessionInfo = manualSessionManager.getSessionInfo(argsObj.sessionId);
    if (!sessionInfo) {
      throw new HarvestError(
        `Manual session not found: ${argsObj.sessionId}`,
        "MANUAL_SESSION_NOT_FOUND",
        { sessionId: argsObj.sessionId }
      );
    }

    // Stop the manual session and collect artifacts
    const result = await manualSessionManager.stopSession(argsObj.sessionId, {
      ...(argsObj.artifactTypes && { artifactTypes: argsObj.artifactTypes }),
      ...(argsObj.takeScreenshot !== undefined && {
        takeScreenshot: argsObj.takeScreenshot,
      }),
      reason: argsObj.reason ?? "manual_stop",
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: result.id,
            duration: result.duration,
            durationFormatted: `${Math.floor(result.duration / 60000)}m ${Math.floor((result.duration % 60000) / 1000)}s`,
            finalUrl: result.finalUrl,
            finalPageTitle: result.finalPageTitle,
            artifactsCollected: result.artifacts.length,
            artifacts: result.artifacts.map((artifact) => ({
              type: artifact.type,
              path: artifact.path,
              size: artifact.size,
              sizeFormatted: formatFileSize(artifact.size),
              timestamp: artifact.timestamp,
            })),
            summary: result.summary,
            metadata: {
              ...result.metadata,
              parametersValidated: true,
              requestedArtifactTypes: argsObj.artifactTypes,
            },
            message: "Manual browser session stopped and artifacts collected",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    // Check if this is a SessionStillActiveError from activity detection
    if (error instanceof SessionStillActiveError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              type: "SESSION_STILL_ACTIVE",
              sessionId: error.sessionId,
              message: error.message,
              activity: error.activity,
              recommendations: error.recommendations,
              guidance: {
                instruction:
                  "DO NOT attempt to stop this session while user is actively using it",
                reasoning:
                  "User is currently interacting with the browser - stopping now would interrupt their work",
                action:
                  "Wait for the user to finish their current activity before trying again",
              },
            }),
          },
        ],
      };
    }

    throw new HarvestError(
      `Failed to stop manual session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_SESSION_STOP_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle session_list_manual tool call
 */
export async function handleListManualSessions(
  _context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    const activeSessions = manualSessionManager.listActiveSessions();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            totalSessions: activeSessions.length,
            sessions: activeSessions.map((session) => ({
              id: session.id,
              startTime: session.startTime,
              startTimeFormatted: new Date(session.startTime).toISOString(),
              currentUrl: session.currentUrl,
              pageTitle: session.pageTitle,
              duration: session.duration,
              durationFormatted: `${Math.floor(session.duration / 60000)}m ${Math.floor((session.duration % 60000) / 1000)}s`,
              outputDir: session.outputDir,
              artifactConfig: {
                enabled: session.artifactConfig?.enabled ?? true,
                saveHar: session.artifactConfig?.saveHar ?? true,
                saveCookies: session.artifactConfig?.saveCookies ?? true,
                saveScreenshots:
                  session.artifactConfig?.saveScreenshots ?? true,
                autoScreenshotInterval:
                  session.artifactConfig?.autoScreenshotInterval,
              },
              status: "active",
            })),
            summary: {
              totalActiveSessions: activeSessions.length,
              longestRunningSession:
                activeSessions.length > 0
                  ? Math.max(...activeSessions.map((s) => s.duration))
                  : 0,
              averageDuration:
                activeSessions.length > 0
                  ? Math.round(
                      activeSessions.reduce((sum, s) => sum + s.duration, 0) /
                        activeSessions.length
                    )
                  : 0,
            },
            message:
              activeSessions.length > 0
                ? `Found ${activeSessions.length} active manual session(s)`
                : "No active manual sessions",
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to list manual sessions: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_SESSION_LIST_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle session_health_check_manual tool call
 */
export async function handleCheckManualSessionHealth(
  params: { sessionId: string },
  _context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    const healthCheck = await manualSessionManager.checkSessionHealth(
      params.sessionId
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            health: healthCheck,
            message: healthCheck.isHealthy
              ? "Session is healthy - user may still be working"
              : `Session has ${healthCheck.issues.length} issue(s)`,
            recommendations: healthCheck.recommendations,
            guidance: {
              important:
                "Do NOT stop this session unless user explicitly indicates completion",
              wait: "Browser health status does not indicate user completion",
              action: "Continue monitoring until user says they are finished",
            },
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to check session health: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_SESSION_HEALTH_CHECK_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle session_recover_manual tool call
 */
export async function handleRecoverManualSession(
  params: { sessionId: string },
  _context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    const recoveryResult = await manualSessionManager.recoverSession(
      params.sessionId
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: recoveryResult.success,
            sessionId: params.sessionId,
            recovery: recoveryResult,
            message: recoveryResult.success
              ? "Session recovery successful"
              : "Session recovery failed",
            actionsPerformed: recoveryResult.actions,
            remainingIssues: recoveryResult.newIssues,
          }),
        },
      ],
    };
  } catch (error) {
    throw new HarvestError(
      `Failed to recover session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_SESSION_RECOVERY_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle session_convert_manual_to_analysis tool call
 */
export async function handleConvertManualToAnalysisSession(
  params: {
    manualSessionId: string;
    prompt: string;
    cookiePath?: string | undefined;
  },
  context: ManualSessionToolContext
): Promise<CallToolResult> {
  try {
    // First, try to get the session status to check if it's active
    const sessionStatus = await manualSessionManager.getSessionInfo(
      params.manualSessionId
    );

    // If session is still active, it needs to be stopped first
    if (sessionStatus) {
      throw new HarvestError(
        "Manual session is still active. Wait for user to explicitly indicate completion before stopping the session.",
        "MANUAL_SESSION_STILL_ACTIVE"
      );
    }

    // Since session is not in active sessions, we need to construct the artifact paths
    const { readdir, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const sharedDir =
      process.env.HARVEST_SHARED_DIR || join(homedir(), ".harvest", "shared");
    const sessionDir = join(sharedDir, params.manualSessionId);

    let harPath: string;
    let cookiePath: string | undefined = params.cookiePath;

    try {
      const files = await readdir(sessionDir);
      const harFile = files.find((file: string) => file.endsWith(".har"));
      const cookieFile = files.find(
        (file: string) => file.endsWith(".json") && file.includes("cookies")
      );

      if (!harFile) {
        throw new HarvestError(
          `No HAR file found in manual session directory: ${sessionDir}. Found files: ${files.join(", ")}`,
          "NO_HAR_FILE_FOUND"
        );
      }

      harPath = join(sessionDir, harFile);
      if (!cookiePath && cookieFile) {
        cookiePath = join(sessionDir, cookieFile);
      }

      // Verify HAR file exists
      await access(harPath);
      if (cookiePath) {
        try {
          await access(cookiePath);
        } catch {
          // Cookie file doesn't exist, continue without it
          cookiePath = undefined;
        }
      }
    } catch (error) {
      if (error instanceof HarvestError) {
        throw error;
      }

      throw new HarvestError(
        `Failed to access manual session directory ${sessionDir}: ${error instanceof Error ? error.message : "Unknown error"}`,
        "SESSION_DIRECTORY_ACCESS_FAILED"
      );
    }

    // Create the analysis session
    const sessionStartResponse = await context.sessionManager.createSession({
      harPath,
      prompt: params.prompt,
      cookiePath,
    });

    // Add metadata to session logs for tracking
    context.sessionManager.addLog(
      sessionStartResponse,
      "info",
      `Converted from manual session ${params.manualSessionId}`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            manualSessionId: params.manualSessionId,
            analysisSessionId: sessionStartResponse,
            message:
              "Manual session successfully converted to analysis session",
            harPath,
            cookiePath,
            nextSteps: [
              "Use analysis_start_primary_workflow to start analyzing the workflow",
              "Use analysis_process_next_node to process dependencies",
              "Use analysis_is_complete to check if analysis is finished",
              "Use codegen_generate_wrapper_script to generate executable code",
            ],
            workflowRecommendation:
              "Use workflow_complete_analysis for automatic end-to-end processing",
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Failed to convert manual session to analysis session: ${error instanceof Error ? error.message : "Unknown error"}`,
      "MANUAL_TO_ANALYSIS_CONVERSION_FAILED",
      { originalError: error }
    );
  }
}

// Helper functions

/**
 * Build session configuration from validated arguments
 */
function buildSessionConfig(
  argsObj: z.infer<typeof ManualSessionStartSchema>
): SessionConfig {
  const sessionConfig: SessionConfig = {};

  if (argsObj.url) {
    sessionConfig.url = argsObj.url;
  }

  if (argsObj.config) {
    applyConfigOptions(sessionConfig, argsObj.config);
  }

  return sessionConfig;
}

/**
 * Apply configuration options to session config
 */
function applyConfigOptions(
  sessionConfig: SessionConfig,
  config: NonNullable<z.infer<typeof ManualSessionStartSchema>["config"]>
): void {
  if (config.timeout !== undefined) {
    sessionConfig.timeout = config.timeout;
  }

  if (config.browserOptions) {
    sessionConfig.browserOptions = buildBrowserOptions(config.browserOptions);
  }

  if (config.artifactConfig) {
    sessionConfig.artifactConfig = buildArtifactConfig(config.artifactConfig);
  }
}

/**
 * Build browser options configuration
 */
function buildBrowserOptions(
  browserOptions: NonNullable<
    NonNullable<
      z.infer<typeof ManualSessionStartSchema>["config"]
    >["browserOptions"]
  >
): NonNullable<SessionConfig["browserOptions"]> {
  const options: NonNullable<SessionConfig["browserOptions"]> = {};

  if (browserOptions.headless !== undefined) {
    options.headless = browserOptions.headless;
  }
  if (browserOptions.viewport) {
    options.viewport = browserOptions.viewport;
  }
  if (browserOptions.contextOptions) {
    options.contextOptions = browserOptions.contextOptions;
  }

  return options;
}

/**
 * Build artifact configuration
 */
function buildArtifactConfig(
  artifactConfig: NonNullable<
    NonNullable<
      z.infer<typeof ManualSessionStartSchema>["config"]
    >["artifactConfig"]
  >
): NonNullable<SessionConfig["artifactConfig"]> {
  const config: NonNullable<SessionConfig["artifactConfig"]> = {};

  if (artifactConfig.enabled !== undefined) {
    config.enabled = artifactConfig.enabled;
  }
  if (artifactConfig.outputDir !== undefined) {
    config.outputDir = artifactConfig.outputDir;
  }
  if (artifactConfig.saveHar !== undefined) {
    config.saveHar = artifactConfig.saveHar;
  }
  if (artifactConfig.saveCookies !== undefined) {
    config.saveCookies = artifactConfig.saveCookies;
  }
  if (artifactConfig.saveScreenshots !== undefined) {
    config.saveScreenshots = artifactConfig.saveScreenshots;
  }
  if (artifactConfig.autoScreenshotInterval !== undefined) {
    config.autoScreenshotInterval = artifactConfig.autoScreenshotInterval;
  }

  return config;
}

/**
 * Build response for manual session start
 */
function buildManualSessionStartResponse(
  sessionInfo: BrowserSessionInfo,
  argsObj: z.infer<typeof ManualSessionStartSchema>,
  originalArgs: unknown
): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          sessionId: sessionInfo.id,
          startTime: sessionInfo.startTime,
          currentUrl: sessionInfo.currentUrl,
          pageTitle: sessionInfo.pageTitle,
          outputDir: sessionInfo.outputDir,
          message: "Manual browser session started successfully",
          instructions: sessionInfo.instructions,
          artifactConfig: sessionInfo.artifactConfig,
          validation: {
            parametersValidated: true,
            urlSanitized:
              argsObj.url !== (originalArgs as Record<string, unknown>)?.url,
          },
        }),
      },
    ],
  };
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
 * Register manual session tools with the MCP server
 */
export function registerManualSessionTools(
  server: McpServer,
  context: ManualSessionToolContext
): void {
  server.tool(
    "session_start_manual",
    "Start a manual browser session for USER-CONTROLLED interactive exploration. The USER decides when the session is complete - agents must wait for explicit user indication before stopping.",
    ManualSessionStartSchema.shape,
    async (params) => handleStartManualSession(params, context)
  );

  server.tool(
    "session_stop_manual",
    "Stop a manual browser session ONLY when the user explicitly indicates they have finished their work. Do NOT call this automatically or based on assumptions - wait for clear user completion signal.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the manual session to stop. Use session_list_manual to see active sessions."
        ),
      artifactTypes: z
        .array(z.enum(["har", "cookies", "screenshot"]))
        .min(1, "At least one artifact type must be specified if provided")
        .optional()
        .describe(
          "Specific types of artifacts to collect (default: all enabled types)"
        ),
      takeScreenshot: z
        .boolean()
        .default(true)
        .describe(
          "Whether to take a final screenshot before stopping the session."
        ),
      reason: z
        .string()
        .optional()
        .describe(
          "Optional reason for stopping the session (for logging purposes)."
        ),
    },
    async (params) => handleStopManualSession(params, context)
  );

  server.tool(
    "session_list_manual",
    "List all active manual browser sessions with their current status",
    {},
    async () => handleListManualSessions(context)
  );

  server.tool(
    "session_health_check_manual",
    "Check the health status of a manual browser session. Wait for user to explicitly indicate completion before considering stopping the session. Browser health does NOT mean the user is finished.",
    {
      sessionId: z
        .string()
        .uuid("Session ID must be a valid UUID")
        .describe(
          "UUID of the manual session to check. Reports browser connectivity and responsiveness."
        ),
    },
    async (params) => handleCheckManualSessionHealth(params, context)
  );

  server.tool(
    "session_recover_manual",
    "Attempt to recover an unhealthy manual browser session. Tries to restore browser functionality.",
    {
      sessionId: z
        .string()
        .uuid("Session ID must be a valid UUID")
        .describe(
          "UUID of the manual session to recover. Use after session_health_check_manual reports an unhealthy session."
        ),
    },
    async (params) => handleRecoverManualSession(params, context)
  );

  server.tool(
    "session_convert_manual_to_analysis",
    "Convert a completed manual session to an analysis session for automated API analysis and code generation.",
    {
      manualSessionId: z
        .string()
        .uuid("Manual session ID must be a valid UUID")
        .describe(
          "UUID of the completed manual session to convert. Ensure user has explicitly finished their work and ended the session."
        ),
      prompt: z
        .string()
        .min(1)
        .describe(
          "Description of what the analysis should accomplish. This guides the AI analysis and code generation process."
        ),
      cookiePath: z
        .string()
        .optional()
        .describe(
          "Optional path to cookie file in Netscape format. Will use cookies from manual session if not provided."
        ),
    },
    async (params) => handleConvertManualToAnalysisSession(params, context)
  );
}
