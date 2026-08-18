#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type CLIArgs, initializeConfig } from "./config/index.js";
import { CompletedSessionManager } from "./core/CompletedSessionManager.js";
import { manualSessionManager } from "./core/ManualSessionManager.js";
// validateConfiguration no longer needed - centralized config handles validation
import { SessionManager } from "./core/SessionManager.js";
import {
  handleIsComplete,
  handleProcessNextNode,
  handleStartPrimaryWorkflow,
  registerAnalysisTools,
} from "./tools/analysisTools.js";
import { registerAuthTools } from "./tools/authTools.js";
import {
  handleGenerateWrapperScript,
  registerCodegenTools,
} from "./tools/codegenTools.js";
import { registerDebugTools } from "./tools/debugToolRegistry.js";
import { handleGetUnresolvedNodes } from "./tools/debugTools.js";
// Debug tools now handled by the type-safe ToolRegistry system
import { registerManualSessionTools } from "./tools/manualSessionTools.js";
import {
  handleSessionStart,
  registerSessionTools,
} from "./tools/sessionTools.js";
import { registerSystemTools } from "./tools/systemTools.js";
import { registerWorkflowTools } from "./tools/workflowTools.js";
import {
  createAnalysisToolContext,
  createAuthToolContext,
  createCodegenToolContext,
  createDebugToolContext,
  createManualSessionToolContext,
  createSessionToolContext,
  createSystemToolContext,
  createWorkflowToolContext,
  HarvestError,
} from "./types/index.js";
import { serverLogger } from "./utils/logger.js";

// CLIArgs interface is now imported from config module

/**
 * Parse command-line arguments
 */
function parseArgs(args: string[]): CLIArgs {
  const result: CLIArgs = {};

  for (const arg of args) {
    parseArgument(arg, result);
  }

  return result;
}

/**
 * Parse a single command-line argument
 */
function parseArgument(arg: string, result: CLIArgs): void {
  if (arg === "--help" || arg === "-h") {
    result.help = true;
    return;
  }

  const argPairs = [
    { prefix: "--provider=", key: "provider" as const },
    { prefix: "--api-key=", key: "apiKey" as const },
    { prefix: "--openai-api-key=", key: "openaiApiKey" as const },
    { prefix: "--google-api-key=", key: "googleApiKey" as const },
    { prefix: "--model=", key: "model" as const },
  ];

  for (const { prefix, key } of argPairs) {
    if (arg.startsWith(prefix)) {
      const value = arg.split("=")[1];
      if (value) {
        result[key as keyof CLIArgs] = value as never;
      }
      return;
    }
  }
}

/**
 * Show help information
 */
function showHelp(): void {
  console.log(`
Harvest MCP Server - API Analysis and Integration Code Generation

Usage:
  bun run src/server.ts [options]

Options:
  --provider=<name>           LLM provider (openai, gemini/google)
  --api-key=<key>            API key (auto-detects provider)
  --openai-api-key=<key>     OpenAI API key
  --google-api-key=<key>     Google API key
  --model=<name>             Model name (gpt-4o, gemini-2.0-flash, etc.)
  --help, -h                 Show this help

Examples:
  bun run src/server.ts --provider=openai --api-key=sk-...
  bun run src/server.ts --google-api-key=AIza... --model=gemini-2.0-flash

MCP Client Configuration:
  {
    "mcpServers": {
      "harvest-mcp": {
        "command": "bun",
        "args": [
          "run", "/path/to/src/server.ts",
          "--provider=google",
          "--api-key=AIzaSy..."
        ]
      }
    }
  }
`);
}

// Global CLI configuration functions removed - use centralized config instead

/**
 * Harvest MCP Server
 *
 * A Model Context Protocol server that provides granular access to Harvest's
 * API Analysis capabilities through stateful sessions.
 */

export class HarvestMCPServer {
  public server: McpServer;
  public sessionManager: SessionManager;
  public completedSessionManager: CompletedSessionManager;
  private readonly sessionToolContext: ReturnType<
    typeof createSessionToolContext
  >;
  private readonly analysisToolContext: ReturnType<
    typeof createAnalysisToolContext
  >;
  private readonly codegenToolContext: ReturnType<
    typeof createCodegenToolContext
  >;
  private readonly systemToolContext: ReturnType<
    typeof createSystemToolContext
  >;
  private readonly manualSessionToolContext: ReturnType<
    typeof createManualSessionToolContext
  >;
  private readonly debugToolContext: ReturnType<typeof createDebugToolContext>;
  private readonly workflowToolContext: ReturnType<
    typeof createWorkflowToolContext
  >;
  private readonly authToolContext: ReturnType<typeof createAuthToolContext>;

  /**
   * Get the session tool context for direct tool access in tests
   */
  public getSessionToolContext(): ReturnType<typeof createSessionToolContext> {
    return this.sessionToolContext;
  }

  /**
   * Get the analysis tool context for direct tool access in tests
   */
  public getAnalysisToolContext(): ReturnType<
    typeof createAnalysisToolContext
  > {
    return this.analysisToolContext;
  }

  /**
   * Get the codegen tool context for direct tool access in tests
   */
  public getCodegenToolContext(): ReturnType<typeof createCodegenToolContext> {
    return this.codegenToolContext;
  }

  /**
   * Get the system tool context for direct tool access in tests
   */
  public getSystemToolContext(): ReturnType<typeof createSystemToolContext> {
    return this.systemToolContext;
  }

  /**
   * Get the manual session tool context for direct tool access in tests
   */
  public getManualSessionToolContext(): ReturnType<
    typeof createManualSessionToolContext
  > {
    return this.manualSessionToolContext;
  }

  /**
   * Get the debug tool context for direct tool access in tests
   */
  public getDebugToolContext(): ReturnType<typeof createDebugToolContext> {
    return this.debugToolContext;
  }

  /**
   * Get the workflow tool context for direct tool access in tests
   */
  public getWorkflowToolContext(): ReturnType<
    typeof createWorkflowToolContext
  > {
    return this.workflowToolContext;
  }

  /**
   * Get the auth tool context for direct tool access in tests
   */
  public getAuthToolContext(): ReturnType<typeof createAuthToolContext> {
    return this.authToolContext;
  }

  constructor() {
    this.sessionManager = new SessionManager();
    this.completedSessionManager = CompletedSessionManager.getInstance();

    // Create focused contexts
    this.sessionToolContext = createSessionToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.analysisToolContext = createAnalysisToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.codegenToolContext = createCodegenToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.systemToolContext = createSystemToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.manualSessionToolContext = createManualSessionToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.debugToolContext = createDebugToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.workflowToolContext = createWorkflowToolContext(
      this.sessionManager,
      this.completedSessionManager
    );
    this.authToolContext = createAuthToolContext(
      this.sessionManager,
      this.completedSessionManager
    );

    // Configuration is now centrally managed and already validated
    // No need for global state pollution or manual validation

    this.server = new McpServer(
      {
        name: "harvest-mcp-server",
        version: "1.0.0",
        description:
          "Set of tools to analyzse web interactions and generate integration code with granular control and debugging capabilities for agentic engineering",
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
          resources: {
            subscribe: true,
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
        },
      }
    );

    this.setupTools();
    this.setupResources();
    this.setupPrompts();
    this.setupErrorHandling();
  }

  // validateEnvironmentOnStartup removed - centralized config handles validation

  /**
   * Set up MCP tools
   */
  private setupTools(): void {
    // Session Management Tools
    registerSessionTools(this.server, this.sessionToolContext);

    // Analysis Tools
    registerAnalysisTools(this.server, this.analysisToolContext);

    // Debug Tools - Type-safe without any types
    registerDebugTools(this.server, this.debugToolContext);

    // Code Generation Tools
    registerCodegenTools(this.server, this.codegenToolContext);

    // Manual Session Tools
    registerManualSessionTools(this.server, this.manualSessionToolContext);

    // Workflow Tools
    registerWorkflowTools(this.server, this.workflowToolContext);

    // System Tools
    registerSystemTools(this.server, this.systemToolContext);

    // Authentication Tools
    registerAuthTools(this.server, this.authToolContext);
  }

  /**
   * Set up MCP resources for session state inspection
   */
  private setupResources(): void {
    // Session DAG resource
    this.server.resource(
      "harvest://{sessionId}/dag.json",
      "Real-time JSON representation of the dependency graph for a session",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const session = this.sessionManager.getSession(sessionId);
        const dagData = session.dagManager.toJSON();

        return {
          contents: [
            {
              uri: `harvest://${sessionId}/dag.json`,
              text: JSON.stringify(dagData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // Session logs resource
    this.server.resource(
      "harvest://{sessionId}/log.txt",
      "Plain-text log of analysis steps performed for a session",
      async (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const session = this.sessionManager.getSession(sessionId);
        const logText = session.state.logs
          .map(
            (log) =>
              `[${log.timestamp.toISOString()}] ${log.level.toUpperCase()}: ${log.message}`
          )
          .join("\n");

        return {
          contents: [
            {
              uri: `harvest://${sessionId}/log.txt`,
              text: logText || "No logs available for this session",
              mimeType: "text/plain",
            },
          ],
        };
      }
    );

    // Session status resource
    this.server.resource(
      "harvest://{sessionId}/status.json",
      "Current analysis status and progress for a session",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const session = this.sessionManager.getSession(sessionId);
        const isComplete = session.dagManager.isComplete();
        const unresolvedNodes = session.dagManager.getUnresolvedNodes();

        const statusData = {
          sessionId,
          isComplete,
          nodesRemaining: session.state.toBeProcessedNodes.length,
          totalNodes: session.dagManager.getNodeCount(),
          unresolvedNodes: unresolvedNodes.length,
          createdAt: session.createdAt.toISOString(),
          lastActivity: session.lastActivity.toISOString(),
          prompt: session.prompt,
          hasHARData: session.harData.requests.length > 0,
          hasCookieData: Object.keys(session.cookieData || {}).length > 0,
          inputVariables: session.state.inputVariables,
          logs: session.state.logs.length,
        };

        return {
          contents: [
            {
              uri: `harvest://${sessionId}/status.json`,
              text: JSON.stringify(statusData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // Generated code resource
    this.server.resource(
      "harvest://{sessionId}/generated_code.ts",
      "Generated TypeScript wrapper script for the completed analysis",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const session = this.sessionManager.getSession(sessionId);

        // Check if code has been generated
        if (!session.state.generatedCode) {
          throw new HarvestError(
            "Generated code not available. Run codegen.generate_wrapper_script first.",
            "CODE_NOT_GENERATED",
            { sessionId }
          );
        }

        return {
          contents: [
            {
              uri: `harvest://${sessionId}/generated_code.ts`,
              text: session.state.generatedCode,
              mimeType: "text/typescript",
            },
          ],
        };
      }
    );

    // Manual session artifacts resource
    this.server.resource(
      "harvest://manual/{sessionId}/artifacts.json",
      "Real-time artifact collection status and metadata for a manual browser session",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const sessionInfo = manualSessionManager.getSessionInfo(sessionId);
        if (!sessionInfo) {
          throw new HarvestError(
            `Manual session not found: ${sessionId}`,
            "MANUAL_SESSION_NOT_FOUND",
            { sessionId }
          );
        }

        const artifactsData = {
          sessionId,
          status: "active",
          startTime: sessionInfo.startTime,
          duration: sessionInfo.duration,
          currentUrl: sessionInfo.currentUrl,
          pageTitle: sessionInfo.pageTitle,
          outputDir: sessionInfo.outputDir,
          artifactConfig: {
            enabled: sessionInfo.artifactConfig?.enabled ?? true,
            saveHar: sessionInfo.artifactConfig?.saveHar ?? true,
            saveCookies: sessionInfo.artifactConfig?.saveCookies ?? true,
            saveScreenshots:
              sessionInfo.artifactConfig?.saveScreenshots ?? true,
            autoScreenshotInterval:
              sessionInfo.artifactConfig?.autoScreenshotInterval,
          },
          expectedArtifacts: {
            har: sessionInfo.artifactConfig?.saveHar !== false ? 1 : 0,
            cookies: sessionInfo.artifactConfig?.saveCookies !== false ? 1 : 0,
            screenshots:
              sessionInfo.artifactConfig?.saveScreenshots !== false
                ? "multiple"
                : 0,
          },
          metadata: {
            lastUpdated: new Date().toISOString(),
            sessionActive: true,
            browserType: "chromium",
            viewport: {
              width: 1280,
              height: 720,
            },
          },
        };

        return {
          contents: [
            {
              uri: `harvest://manual/${sessionId}/artifacts.json`,
              text: JSON.stringify(artifactsData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // Manual session activity log resource
    this.server.resource(
      "harvest://manual/{sessionId}/session-log.txt",
      "Real-time activity log for a manual browser session",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        const sessionInfo = manualSessionManager.getSessionInfo(sessionId);
        if (!sessionInfo) {
          throw new HarvestError(
            `Manual session not found: ${sessionId}`,
            "MANUAL_SESSION_NOT_FOUND",
            { sessionId }
          );
        }

        // Generate activity log based on session state
        const logEntries = [
          `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Manual browser session started`,
          `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Session ID: ${sessionId}`,
          `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Initial URL: ${sessionInfo.currentUrl || "about:blank"}`,
          `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Output directory: ${sessionInfo.outputDir}`,
          `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Artifact collection enabled: ${sessionInfo.artifactConfig?.enabled !== false}`,
        ];

        if (sessionInfo.artifactConfig?.enabled !== false) {
          if (sessionInfo.artifactConfig?.saveHar !== false) {
            logEntries.push(
              `[${new Date(sessionInfo.startTime).toISOString()}] INFO: HAR file collection: enabled`
            );
          }
          if (sessionInfo.artifactConfig?.saveCookies !== false) {
            logEntries.push(
              `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Cookie collection: enabled`
            );
          }
          if (sessionInfo.artifactConfig?.saveScreenshots !== false) {
            logEntries.push(
              `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Screenshot collection: enabled`
            );
          }
          if (sessionInfo.artifactConfig?.autoScreenshotInterval) {
            logEntries.push(
              `[${new Date(sessionInfo.startTime).toISOString()}] INFO: Auto-screenshot interval: ${sessionInfo.artifactConfig.autoScreenshotInterval}s`
            );
          }
        }

        logEntries.push(
          `[${new Date().toISOString()}] INFO: Session duration: ${Math.floor(sessionInfo.duration / 60000)}m ${Math.floor((sessionInfo.duration % 60000) / 1000)}s`
        );
        logEntries.push(
          `[${new Date().toISOString()}] INFO: Current page: ${sessionInfo.pageTitle || "Unknown"}`
        );
        logEntries.push(
          `[${new Date().toISOString()}] INFO: Current URL: ${sessionInfo.currentUrl || "Unknown"}`
        );
        logEntries.push(
          `[${new Date().toISOString()}] STATUS: Session is active and ready for manual interaction`
        );

        const logText = logEntries.join("\n");

        return {
          contents: [
            {
              uri: `harvest://manual/${sessionId}/session-log.txt`,
              text: logText,
              mimeType: "text/plain",
            },
          ],
        };
      }
    );

    // Manual sessions list resource
    this.server.resource(
      "harvest://manual/sessions.json",
      "List of all active manual browser sessions",
      () => {
        const activeSessions = manualSessionManager.listActiveSessions();

        const sessionsData = {
          totalSessions: activeSessions.length,
          lastUpdated: new Date().toISOString(),
          sessions: activeSessions.map((session) => ({
            id: session.id,
            startTime: session.startTime,
            duration: session.duration,
            currentUrl: session.currentUrl,
            pageTitle: session.pageTitle,
            outputDir: session.outputDir,
            artifactConfig: session.artifactConfig,
            status: "active",
          })),
          summary: {
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
        };

        return {
          contents: [
            {
              uri: "harvest://manual/sessions.json",
              text: JSON.stringify(sessionsData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // ====== COMPLETED SESSION ARTIFACTS RESOURCES ======

    // Completed session artifacts metadata
    this.server.resource(
      "harvest://completed/{sessionId}/artifacts.json",
      "Metadata and file list for artifacts from a completed analysis session",
      (_uri, args) => {
        const sessionId = args?.sessionId as string;
        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }

        // Check if session is cached first (faster access)
        const cachedMetadata =
          this.completedSessionManager.getCachedSessionMetadata(sessionId);

        if (cachedMetadata) {
          // Use cached metadata for faster response
          const artifactsData = {
            sessionId,
            completedAt: cachedMetadata.completedAt,
            prompt: cachedMetadata.prompt,
            analysisResult: cachedMetadata.analysisResult,
            availableArtifacts: {
              // Core analysis artifacts
              dag: {
                uri: `harvest://${sessionId}/dag.json`,
                type: "application/json",
                description: "Dependency graph structure",
              },
              logs: {
                uri: `harvest://${sessionId}/log.txt`,
                type: "text/plain",
                description: "Analysis step logs",
              },
              status: {
                uri: `harvest://${sessionId}/status.json`,
                type: "application/json",
                description: "Session status and progress",
              },
              // Generated code artifact (if available)
              ...(cachedMetadata.artifactsAvailable.includes(
                "generatedCode"
              ) && {
                generatedCode: {
                  uri: `harvest://${sessionId}/generated_code.ts`,
                  type: "text/typescript",
                  description: "Generated TypeScript wrapper script",
                },
              }),
              // HAR file artifact (cached)
              harFile: {
                uri: `harvest://completed/${sessionId}/har/original.har`,
                type: "application/json",
                description: "Original HAR file used for analysis (cached)",
              },
              // Cookie file artifact (if available, cached)
              ...(cachedMetadata.artifactsAvailable.includes("cookies") && {
                cookies: {
                  uri: `harvest://completed/${sessionId}/cookies/original.json`,
                  type: "application/json",
                  description:
                    "Original cookie data used for analysis (cached)",
                },
              }),
            },
            metadata: {
              ...cachedMetadata.metadata,
              sessionCreatedAt: cachedMetadata.cachedAt,
              lastActivity: cachedMetadata.lastAccessed,
              isCached: true,
              cacheStatus: "available",
            },
          };

          return {
            contents: [
              {
                uri: `harvest://completed/${sessionId}/artifacts.json`,
                text: JSON.stringify(artifactsData, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }

        // Fallback to live session data if not cached
        const session = this.sessionManager.getSession(sessionId);
        const analysis = this.sessionManager.analyzeCompletionState(sessionId);

        if (!analysis.isComplete) {
          throw new HarvestError(
            `Session ${sessionId} is not completed. Complete the analysis first.`,
            "SESSION_NOT_COMPLETED",
            {
              sessionId,
              blockers: analysis.blockers,
              recommendations: analysis.recommendations,
            }
          );
        }

        // Gather artifact information
        const artifactsData = {
          sessionId,
          completedAt: session.lastActivity.toISOString(),
          prompt: session.prompt,
          analysisResult: {
            isComplete: analysis.isComplete,
            totalNodes: analysis.diagnostics.totalNodes,
            codeGenerated: !!session.state.generatedCode,
          },
          availableArtifacts: {
            // Core analysis artifacts
            dag: {
              uri: `harvest://${sessionId}/dag.json`,
              type: "application/json",
              description: "Dependency graph structure",
            },
            logs: {
              uri: `harvest://${sessionId}/log.txt`,
              type: "text/plain",
              description: "Analysis step logs",
            },
            status: {
              uri: `harvest://${sessionId}/status.json`,
              type: "application/json",
              description: "Session status and progress",
            },
            // Generated code artifact (if available)
            ...(session.state.generatedCode && {
              generatedCode: {
                uri: `harvest://${sessionId}/generated_code.ts`,
                type: "text/typescript",
                description: "Generated TypeScript wrapper script",
              },
            }),
            // HAR file artifact (always available)
            harFile: {
              uri: `harvest://completed/${sessionId}/har/original.har`,
              type: "application/json",
              description: "Original HAR file used for analysis",
            },
            // Cookie file artifact (if available)
            ...(session.cookieData && {
              cookies: {
                uri: `harvest://completed/${sessionId}/cookies/original.json`,
                type: "application/json",
                description: "Original cookie data used for analysis",
              },
            }),
          },
          metadata: {
            sessionCreatedAt: session.createdAt.toISOString(),
            lastActivity: session.lastActivity.toISOString(),
            harQuality: session.harData.validation?.quality || "unknown",
            totalRequests: session.harData.requests.length,
            hasAuthCookies: !!session.cookieData,
            generatedCodeSize: session.state.generatedCode?.length || 0,
          },
        };

        return {
          contents: [
            {
              uri: `harvest://completed/${sessionId}/artifacts.json`,
              text: JSON.stringify(artifactsData, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // Completed session HAR file content
    this.server.resource(
      "harvest://completed/{sessionId}/har/{filename}",
      "HAR file content from a completed analysis session",
      async (uri, args) => {
        const sessionId = args?.sessionId as string;
        // Extract filename from URI path
        const filename = uri.pathname.split("/").pop() || "";

        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }
        if (!filename) {
          throw new HarvestError("Filename is required", "MISSING_FILENAME");
        }

        // Check if session is cached first (faster access)
        const cachedMetadata =
          this.completedSessionManager.getCachedSessionMetadata(sessionId);

        if (cachedMetadata && filename === "original.har") {
          try {
            // Serve cached HAR file content
            const harContent =
              await this.completedSessionManager.getCachedArtifact(
                sessionId,
                "har"
              );

            return {
              contents: [
                {
                  uri: `harvest://completed/${sessionId}/har/${filename}`,
                  text: harContent,
                  mimeType: "application/json",
                },
              ],
            };
          } catch (cacheError) {
            // If cached content fails, fall back to live data
            this.sessionManager.addLog(
              sessionId,
              "warn",
              `Failed to load cached HAR file, falling back to live data: ${cacheError instanceof Error ? cacheError.message : "Unknown error"}`
            );
          }
        }

        // Fallback to live session data
        const session = this.sessionManager.getSession(sessionId);
        const analysis = this.sessionManager.analyzeCompletionState(sessionId);

        if (!analysis.isComplete) {
          throw new HarvestError(
            `Session ${sessionId} is not completed. Complete the analysis first.`,
            "SESSION_NOT_COMPLETED",
            { sessionId }
          );
        }

        // Generate HAR data from live session data
        if (filename === "original.har") {
          const harData = {
            log: {
              version: "1.2",
              creator: {
                name: "harvest-mcp",
                version: "1.0.0",
              },
              entries: session.harData.requests.map((req) => ({
                startedDateTime: new Date().toISOString(),
                time: 0,
                request: {
                  method: req.method,
                  url: req.url,
                  httpVersion: "HTTP/1.1",
                  headers: Object.entries(req.headers).map(([name, value]) => ({
                    name,
                    value,
                  })),
                  queryString: Object.entries(req.queryParams || {}).map(
                    ([name, value]) => ({ name, value })
                  ),
                  postData: req.body
                    ? {
                        mimeType:
                          req.headers["content-type"] ||
                          "application/octet-stream",
                        text:
                          typeof req.body === "string"
                            ? req.body
                            : JSON.stringify(req.body),
                      }
                    : undefined,
                },
                response: {
                  status: 200,
                  statusText: "OK",
                  httpVersion: "HTTP/1.1",
                  headers: [],
                  content: { size: 0, mimeType: "text/html" },
                },
                cache: {},
                timings: { send: 0, wait: 0, receive: 0 },
              })),
            },
          };

          return {
            contents: [
              {
                uri: `harvest://completed/${sessionId}/har/${filename}`,
                text: JSON.stringify(harData, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }

        throw new HarvestError(
          `HAR file not found: ${filename}`,
          "HAR_FILE_NOT_FOUND",
          { sessionId, filename }
        );
      }
    );

    // Completed session cookie file content
    this.server.resource(
      "harvest://completed/{sessionId}/cookies/{filename}",
      "Cookie file content from a completed analysis session",
      async (uri, args) => {
        const sessionId = args?.sessionId as string;
        // Extract filename from URI path
        const filename = uri.pathname.split("/").pop() || "";

        if (!sessionId) {
          throw new HarvestError(
            "Session ID is required",
            "MISSING_SESSION_ID"
          );
        }
        if (!filename) {
          throw new HarvestError("Filename is required", "MISSING_FILENAME");
        }

        // Check if session is cached first (faster access)
        const cachedMetadata =
          this.completedSessionManager.getCachedSessionMetadata(sessionId);

        if (cachedMetadata && filename === "original.json") {
          if (!cachedMetadata.artifactsAvailable.includes("cookies")) {
            throw new HarvestError(
              `No cookie data available for session ${sessionId}`,
              "NO_COOKIE_DATA",
              { sessionId }
            );
          }

          try {
            // Serve cached cookie file content
            const cookieContent =
              await this.completedSessionManager.getCachedArtifact(
                sessionId,
                "cookies"
              );

            return {
              contents: [
                {
                  uri: `harvest://completed/${sessionId}/cookies/${filename}`,
                  text: cookieContent,
                  mimeType: "application/json",
                },
              ],
            };
          } catch (cacheError) {
            // If cached content fails, fall back to live data
            this.sessionManager.addLog(
              sessionId,
              "warn",
              `Failed to load cached cookie file, falling back to live data: ${cacheError instanceof Error ? cacheError.message : "Unknown error"}`
            );
          }
        }

        // Fallback to live session data
        const session = this.sessionManager.getSession(sessionId);
        const analysis = this.sessionManager.analyzeCompletionState(sessionId);

        if (!analysis.isComplete) {
          throw new HarvestError(
            `Session ${sessionId} is not completed. Complete the analysis first.`,
            "SESSION_NOT_COMPLETED",
            { sessionId }
          );
        }

        if (!session.cookieData) {
          throw new HarvestError(
            `No cookie data available for session ${sessionId}`,
            "NO_COOKIE_DATA",
            { sessionId }
          );
        }

        if (filename === "original.json") {
          return {
            contents: [
              {
                uri: `harvest://completed/${sessionId}/cookies/${filename}`,
                text: JSON.stringify(session.cookieData, null, 2),
                mimeType: "application/json",
              },
            ],
          };
        }

        throw new HarvestError(
          `Cookie file not found: ${filename}`,
          "COOKIE_FILE_NOT_FOUND",
          { sessionId, filename }
        );
      }
    );

    // Global artifacts discovery
    this.server.resource(
      "harvest://artifacts/list.json",
      "List all completed sessions with available artifacts",
      () => {
        // Get both live and cached completed sessions
        const allSessions = this.sessionManager.listSessions();
        const liveCompletedSessions = allSessions.filter(
          (session) => session.isComplete
        );
        const cachedSessions =
          this.completedSessionManager.getAllCachedSessions();

        // Combine and deduplicate sessions (prefer cached metadata when available)
        interface CompletedSessionInfo {
          sessionId: string;
          prompt: string;
          completedAt: string;
          artifactsUri: string;
          hasGeneratedCode: boolean;
          harQuality: string;
          isCached: boolean;
          totalNodes: number;
          quickAccess: {
            dag: string;
            logs: string;
            status: string;
            har: string;
          };
        }
        const sessionsMap = new Map<string, CompletedSessionInfo>();

        // Add cached sessions first (more complete metadata)
        for (const cached of cachedSessions) {
          sessionsMap.set(cached.sessionId, {
            sessionId: cached.sessionId,
            prompt: cached.prompt,
            completedAt: cached.completedAt,
            artifactsUri: `harvest://completed/${cached.sessionId}/artifacts.json`,
            hasGeneratedCode: cached.analysisResult.codeGenerated,
            harQuality: cached.metadata.harQuality,
            isCached: true,
            totalNodes: cached.analysisResult.totalNodes,
            quickAccess: {
              dag: `harvest://${cached.sessionId}/dag.json`,
              logs: `harvest://${cached.sessionId}/log.txt`,
              status: `harvest://${cached.sessionId}/status.json`,
              har: `harvest://completed/${cached.sessionId}/har/original.har`,
            },
          });
        }

        // Add live sessions if not already cached
        for (const live of liveCompletedSessions) {
          if (!sessionsMap.has(live.id)) {
            sessionsMap.set(live.id, {
              sessionId: live.id,
              prompt: live.prompt,
              completedAt: live.lastActivity.toISOString(),
              artifactsUri: `harvest://completed/${live.id}/artifacts.json`,
              hasGeneratedCode: live.nodeCount > 0,
              harQuality: "unknown",
              isCached: false,
              totalNodes: live.nodeCount,
              quickAccess: {
                dag: `harvest://${live.id}/dag.json`,
                logs: `harvest://${live.id}/log.txt`,
                status: `harvest://${live.id}/status.json`,
                har: `harvest://completed/${live.id}/har/original.har`,
              },
            });
          }
        }

        const completedSessions = Array.from(sessionsMap.values());

        const artifactsList = {
          totalSessions: allSessions.length,
          completedSessions: completedSessions.length,
          lastUpdated: new Date().toISOString(),
          sessions: completedSessions,
          summary: {
            averageNodes:
              completedSessions.length > 0
                ? Math.round(
                    completedSessions.reduce(
                      (sum, s) => sum + s.totalNodes,
                      0
                    ) / completedSessions.length
                  )
                : 0,
            sessionsWithCode: completedSessions.filter(
              (s) => s.hasGeneratedCode
            ).length,
            cachedSessions: completedSessions.filter((s) => s.isCached).length,
            liveSessions: completedSessions.filter((s) => !s.isCached).length,
            oldestSession:
              completedSessions.length > 0
                ? completedSessions.reduce((oldest, s) =>
                    new Date(s.completedAt) < new Date(oldest.completedAt)
                      ? s
                      : oldest
                  ).completedAt
                : null,
          },
        };

        return {
          contents: [
            {
              uri: "harvest://artifacts/list.json",
              text: JSON.stringify(artifactsList, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );
  }

  /**
   * Set up MCP prompts for user convenience
   */
  private setupPrompts(): void {
    // One-shot automated analysis prompt
    this.server.prompt(
      "harvest_full_run",
      "Run a complete Harvest analysis and generate a wrapper script",
      {
        har_path: z
          .string()
          .describe("Path to the HAR file containing network traffic"),
        cookie_path: z
          .string()
          .optional()
          .describe("Path to the cookie file (optional)"),
        prompt: z
          .string()
          .describe(
            "Description of the action to analyze and generate code for"
          ),
        input_variables: z
          .string()
          .optional()
          .describe("Optional input variables as JSON string"),
      },
      async (request) => {
        return await this.executeFullAnalysisWorkflow(request);
      }
    );
  }

  /**
   * Set up error handling
   */
  private setupErrorHandling(): void {
    this.server.server.onerror = (error) => {
      serverLogger.error({ error }, "MCP Server Error");
    };

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      serverLogger.info("Shutting down Harvest MCP server...");
      this.sessionManager.clearAllSessions();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      serverLogger.info("Shutting down Harvest MCP server...");
      this.sessionManager.clearAllSessions();
      process.exit(0);
    });
  }

  /**
   * Execute full analysis workflow for the prompt
   */
  private async executeFullAnalysisWorkflow(request: {
    har_path: string;
    cookie_path?: string | undefined;
    prompt: string;
    input_variables?: string | undefined;
  }): Promise<{
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text";
        text: string;
      };
    }>;
  }> {
    const { har_path, cookie_path, prompt, input_variables } = request;

    try {
      // Step 1: Create session
      const sessionId = await this.createAnalysisSession({
        har_path,
        cookie_path,
        prompt,
        input_variables,
      });

      const analysisResults = [];
      analysisResults.push(`✅ Session created: ${sessionId}`);

      // Step 2: Run initial analysis
      await this.runInitialAnalysisStep(sessionId, analysisResults);

      // Step 3: Process nodes iteratively
      await this.runIterativeNodeProcessing(sessionId, analysisResults);

      // Step 4: Generate code or handle incomplete analysis
      return await this.generateFinalCodeOrHandleIncomplete(
        sessionId,
        analysisResults
      );
    } catch (error) {
      return this.handleWorkflowError(error);
    }
  }

  /**
   * Create analysis session from request parameters
   */
  private async createAnalysisSession(params: {
    har_path: string;
    cookie_path?: string | undefined;
    prompt: string;
    input_variables?: string | undefined;
  }): Promise<string> {
    const sessionResult = await handleSessionStart(
      {
        harPath: params.har_path,
        cookiePath: params.cookie_path,
        prompt: params.prompt,
        inputVariables: params.input_variables
          ? JSON.parse(params.input_variables as string)
          : undefined,
      },
      this.sessionToolContext
    );

    const sessionContent = sessionResult.content?.[0]?.text;
    if (typeof sessionContent !== "string") {
      throw new Error("Invalid session result format");
    }
    const sessionData = JSON.parse(sessionContent);
    return sessionData.sessionId;
  }

  /**
   * Run initial analysis step
   */
  private async runInitialAnalysisStep(
    sessionId: string,
    analysisResults: string[]
  ): Promise<boolean> {
    // Use modern workflow analysis
    try {
      const analysisToolContext = this.getAnalysisToolContext();

      const startPrimaryResult = await handleStartPrimaryWorkflow(
        { sessionId },
        analysisToolContext
      );

      if (startPrimaryResult.isError) {
        throw new Error("Primary workflow analysis failed");
      }

      const workflowContent = startPrimaryResult.content?.[0]?.text;
      if (typeof workflowContent !== "string") {
        throw new Error("Invalid workflow analysis result format");
      }

      const workflowData = JSON.parse(workflowContent);
      analysisResults.push(
        `✅ Modern workflow analysis complete - Master Node URL: ${workflowData.masterNode?.url || "Unknown"}`
      );
      return true;
    } catch (error) {
      analysisResults.push(
        `⚠️ Workflow analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      analysisResults.push(
        "📋 Consider using individual analysis tools for manual workflow..."
      );
      return false;
    }
  }

  /**
   * Run iterative node processing
   */
  private async runIterativeNodeProcessing(
    sessionId: string,
    analysisResults: string[]
  ): Promise<boolean> {
    let iterations = 0;
    const maxIterations = 20;
    let isComplete = false;

    while (!isComplete && iterations < maxIterations) {
      try {
        // Check completion status first
        isComplete = await this.checkAnalysisComplete(sessionId);

        if (isComplete) {
          analysisResults.push(
            `✅ Analysis completed after ${iterations} iterations`
          );
          break;
        }

        // Process next node
        const nodeProcessed = await this.processNextNodeInWorkflow(sessionId);
        if (!nodeProcessed) {
          analysisResults.push(
            "⚠️ No more nodes to process - analysis may be incomplete"
          );
          break;
        }

        analysisResults.push(
          `🔄 Iteration ${iterations + 1}: Processed node successfully`
        );
        iterations++;
      } catch (error) {
        analysisResults.push(
          `❌ Error in iteration ${iterations + 1}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        break;
      }
    }

    if (iterations >= maxIterations) {
      analysisResults.push(
        `⚠️ Analysis stopped after ${maxIterations} iterations - may need manual intervention`
      );
    }

    return isComplete;
  }

  /**
   * Check if analysis is complete
   */
  private async checkAnalysisComplete(sessionId: string): Promise<boolean> {
    const completeResult = handleIsComplete(
      { sessionId },
      this.analysisToolContext
    );
    const completeContent = completeResult.content?.[0]?.text;
    if (typeof completeContent !== "string") {
      throw new Error("Invalid completion result format");
    }
    const completeData = JSON.parse(completeContent);
    return completeData.isComplete;
  }

  /**
   * Process next node in workflow
   */
  private async processNextNodeInWorkflow(sessionId: string): Promise<boolean> {
    const processResult = await handleProcessNextNode(
      { sessionId },
      this.analysisToolContext
    );
    const processContent = processResult.content?.[0]?.text;
    if (typeof processContent !== "string") {
      throw new Error("Invalid process result format");
    }
    const processData = JSON.parse(processContent);

    return processData.status !== "no_nodes_to_process";
  }

  /**
   * Generate final code or handle incomplete analysis
   */
  private async generateFinalCodeOrHandleIncomplete(
    sessionId: string,
    analysisResults: string[]
  ): Promise<{
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text";
        text: string;
      };
    }>;
  }> {
    try {
      const codeResult = await handleGenerateWrapperScript(
        { sessionId },
        this.codegenToolContext
      );
      const codeContent = codeResult.content?.[0]?.text;
      if (typeof codeContent !== "string") {
        throw new Error("Invalid code generation result format");
      }
      const generatedCode = codeContent;

      analysisResults.push(
        `✅ Code generation successful - ${generatedCode.length} characters generated`
      );

      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
              text: `# Harvest Complete Analysis Results\n\n## Workflow Summary\n${analysisResults.join(
                "\n"
              )}\n\n## Generated TypeScript Code\n\n\`\`\`typescript\n${generatedCode}\n\`\`\``,
            },
          },
        ],
      };
    } catch (codeError) {
      return await this.handleIncompleteAnalysis(
        sessionId,
        analysisResults,
        codeError
      );
    }
  }

  /**
   * Handle incomplete analysis with debug information
   */
  private async handleIncompleteAnalysis(
    sessionId: string,
    analysisResults: string[],
    codeError: unknown
  ): Promise<{
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text";
        text: string;
      };
    }>;
  }> {
    analysisResults.push(
      `❌ Code generation failed: ${codeError instanceof Error ? codeError.message : "Unknown error"}`
    );

    // Attempt debug information
    try {
      const unresolvedResult = await handleGetUnresolvedNodes(
        { sessionId },
        this.debugToolContext
      );
      const unresolvedContent = unresolvedResult.content?.[0]?.text;
      if (typeof unresolvedContent !== "string") {
        throw new Error("Invalid unresolved result format");
      }
      const unresolvedData = JSON.parse(unresolvedContent);

      if (unresolvedData.totalUnresolved > 0) {
        analysisResults.push("\n## Debug Information");
        analysisResults.push(
          `🔍 ${unresolvedData.totalUnresolved} unresolved nodes found:`
        );
        unresolvedData.unresolvedNodes.forEach(
          (
            node: { nodeId: string; unresolvedParts: string[] },
            index: number
          ) => {
            analysisResults.push(
              `  ${index + 1}. Node ${node.nodeId}: ${node.unresolvedParts.join(", ")}`
            );
          }
        );
        analysisResults.push("\n💡 Use debug tools for manual intervention");
      }
    } catch (_debugError) {
      analysisResults.push("⚠️ Could not retrieve debug information");
    }

    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Harvest Analysis Results (Incomplete)\n\n## Workflow Summary\n${analysisResults.join(
              "\n"
            )}\n\n❌ **Analysis could not be completed automatically.**\n\nUse the session ID \`${sessionId}\` with debug tools for manual intervention.`,
          },
        },
      ],
    };
  }

  /**
   * Handle workflow error
   */
  private handleWorkflowError(error: unknown): {
    messages: Array<{
      role: "user" | "assistant";
      content: {
        type: "text";
        text: string;
      };
    }>;
  } {
    return {
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: `# Harvest Analysis Failed\n\n❌ **Error**: ${
              error instanceof Error ? error.message : "Unknown error"
            }\n\nPlease check your HAR file path and try again.`,
          },
        },
      ],
    };
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    serverLogger.info("Harvest MCP Server started and listening on stdio");
  }
}

// Parse command-line arguments and initialize configuration
const cliArgs = parseArgs(process.argv.slice(2));

// Show help if requested
if (cliArgs.help) {
  showHelp();
  process.exit(0);
}

// Initialize centralized configuration system
try {
  const config = initializeConfig({ cliArgs });

  // Log startup configuration summary
  const configSummary = {
    provider: config.llm.provider,
    hasApiKey: !!(
      config.llm.providers.openai.apiKey || config.llm.providers.gemini.apiKey
    ),
    model: config.llm.model,
    maxSessions: config.session.maxSessions,
    logLevel: config.logging.level,
  };

  serverLogger.info(
    { config: configSummary },
    "Starting Harvest MCP Server with validated configuration"
  );
} catch (error) {
  serverLogger.error({ error }, "Failed to initialize configuration");
  process.exit(1);
}

// Start the server
const server = new HarvestMCPServer();
server.start().catch((error) => {
  serverLogger.error({ error }, "Failed to start server");
  process.exit(1);
});
