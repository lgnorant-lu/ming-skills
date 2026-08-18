import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { analyzeAuthentication } from "../agents/AuthenticationAgent.js";
import {
  type AuthToolContext,
  HarvestError,
  type HarvestSession,
} from "../types/index.js";
import { serverLogger } from "../utils/logger.js";

/**
 * Handle auth_analyze_session tool call
 */
export async function handleAuthAnalyzeSession(
  params: { sessionId: string; forceReanalysis?: boolean },
  context: AuthToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Check if analysis already exists and we're not forcing re-analysis
    if (session.state.authAnalysis && !params.forceReanalysis) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              sessionId: params.sessionId,
              cached: true,
              authAnalysis: session.state.authAnalysis,
              message:
                "Authentication analysis retrieved from cache. Use forceReanalysis=true to re-run the analysis.",
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      };
    }

    serverLogger.info(
      `Running authentication analysis for session ${params.sessionId}`
    );

    // Run comprehensive authentication analysis using new AuthenticationAgent
    const authAnalysis = await analyzeAuthentication(session);

    // Store the analysis in the session
    session.state.authAnalysis = authAnalysis;

    // Note: Authentication readiness check would be run here if available
    // await context.sessionManager.runAuthenticationAnalysis(params.sessionId);

    // Get the authentication readiness from session state
    const authReadiness = session.state.authReadiness || {
      isAuthComplete: false,
      authBlockers: ["Authentication analysis not available"],
      authRecommendations: ["Run authentication analysis first"],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            cached: false,
            authAnalysis: {
              hasAuthentication: authAnalysis.hasAuthentication,
              primaryAuthType: authAnalysis.primaryAuthType,
              authTypes: authAnalysis.authTypes,
              tokenCount: authAnalysis.tokens.length,
              authenticatedRequests: authAnalysis.authenticatedRequests.length,
              failedAuthRequests: authAnalysis.failedAuthRequests.length,
              authEndpoints: authAnalysis.authEndpoints.length,
              flowComplexity: authAnalysis.authFlow.flowComplexity,
              securityIssues: authAnalysis.securityIssues,
              recommendations: authAnalysis.recommendations,
              codeGeneration: authAnalysis.codeGeneration,
            },
            authReadiness: {
              isAuthComplete: authReadiness.isAuthComplete,
              authBlockers: authReadiness.authBlockers,
              authRecommendations: authReadiness.authRecommendations,
            },
            summary: {
              analysisLevel: authAnalysis.hasAuthentication
                ? "authenticated"
                : "public",
              readinessStatus: authReadiness.isAuthComplete
                ? "ready"
                : "needs_attention",
              nextSteps: authReadiness.isAuthComplete
                ? ["Proceed with code generation"]
                : authReadiness.authBlockers,
            },
            message: authAnalysis.hasAuthentication
              ? `Authentication analysis complete: ${authAnalysis.primaryAuthType} detected with ${authAnalysis.tokens.length} tokens`
              : "No authentication patterns detected - API appears to be public",
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Authentication analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "AUTH_ANALYSIS_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Handle auth_test_endpoint tool call
 */
export async function handleAuthTestEndpoint(
  params: {
    sessionId: string;
    requestUrl: string;
    requestMethod: string;
  },
  context: AuthToolContext
): Promise<CallToolResult> {
  try {
    const session = context.sessionManager.getSession(params.sessionId);
    if (!session) {
      throw new HarvestError(
        `Session ${params.sessionId} not found`,
        "SESSION_NOT_FOUND"
      );
    }

    // Find the specific request in the HAR data
    const targetRequest = session.harData.requests.find(
      (req) =>
        req.url === params.requestUrl &&
        req.method.toUpperCase() === params.requestMethod.toUpperCase()
    );

    if (!targetRequest) {
      throw new HarvestError(
        `Request not found: ${params.requestMethod} ${params.requestUrl}`,
        "REQUEST_NOT_FOUND",
        {
          requestUrl: params.requestUrl,
          requestMethod: params.requestMethod,
        }
      );
    }

    serverLogger.info(
      `Testing authentication for endpoint: ${params.requestMethod} ${params.requestUrl}`
    );

    // Analyze individual request authentication (using the new AuthenticationAgent)
    const mockSession = {
      id: `test-${Date.now()}`,
      prompt: "Test authentication analysis",
      harData: { requests: [targetRequest] },
      dagManager: { getAllNodes: () => new Map() },
    } as HarvestSession;

    const authAnalysis = await analyzeAuthentication(mockSession);
    const requestAuthInfo = authAnalysis.authenticatedRequests[0] || {
      requestId: `test-${Date.now()}`,
      url: targetRequest.url,
      method: targetRequest.method,
      authenticationType: authAnalysis.primaryAuthType,
      requirement: authAnalysis.hasAuthentication
        ? ("required" as const)
        : ("none" as const),
      tokens: authAnalysis.tokens,
      authHeaders: {},
      authCookies: {},
      authParams: {},
      isAuthFailure: false,
    };

    // Check if request has authentication failures
    const hasAuthFailure = requestAuthInfo.isAuthFailure;
    const responseStatus = targetRequest.response?.status;

    // Generate recommendations based on analysis
    const recommendations: string[] = [];
    if (hasAuthFailure) {
      recommendations.push("This endpoint requires authentication to succeed");
      recommendations.push(
        "Verify authentication tokens are valid and not expired"
      );
      if (requestAuthInfo.authErrorDetails?.wwwAuthenticate) {
        recommendations.push(
          `Authentication challenge: ${requestAuthInfo.authErrorDetails.wwwAuthenticate}`
        );
      }
    }

    if (requestAuthInfo.tokens.length > 0) {
      recommendations.push(
        `Found ${requestAuthInfo.tokens.length} authentication tokens in request`
      );
      recommendations.push(
        "Ensure these tokens are dynamically obtained in generated code"
      );
    }

    if (requestAuthInfo.authenticationType === "none" && !hasAuthFailure) {
      recommendations.push("This endpoint appears to be publicly accessible");
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId: params.sessionId,
            endpoint: {
              url: params.requestUrl,
              method: params.requestMethod,
              responseStatus: responseStatus,
            },
            authAnalysis: {
              authenticationType: requestAuthInfo.authenticationType,
              requirement: requestAuthInfo.requirement,
              hasAuthFailure: requestAuthInfo.isAuthFailure,
              tokensFound: requestAuthInfo.tokens.length,
              tokens: requestAuthInfo.tokens.map((token) => ({
                type: token.type,
                location: token.location,
                name: token.name,
                valuePreview: `${token.value.substring(0, 20)}...`,
              })),
              authHeaders: Object.keys(requestAuthInfo.authHeaders),
              authCookies: Object.keys(requestAuthInfo.authCookies),
              authParams: Object.keys(requestAuthInfo.authParams),
            },
            errorDetails: requestAuthInfo.authErrorDetails,
            recommendations,
            summary: {
              status: hasAuthFailure
                ? "authentication_required"
                : requestAuthInfo.authenticationType !== "none"
                  ? "authenticated"
                  : "public",
              severity: hasAuthFailure
                ? "error"
                : requestAuthInfo.tokens.length > 0
                  ? "warning"
                  : "info",
              message: hasAuthFailure
                ? `Authentication failure (${responseStatus}) - endpoint requires valid authentication`
                : requestAuthInfo.authenticationType !== "none"
                  ? `Endpoint uses ${requestAuthInfo.authenticationType} authentication`
                  : "Endpoint appears to be publicly accessible",
            },
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error; // Re-throw HarvestError with original context
    }
    throw new HarvestError(
      `Endpoint authentication test failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "AUTH_TEST_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Register auth tools with the MCP server
 */
export function registerAuthTools(
  server: McpServer,
  context: AuthToolContext
): void {
  server.tool(
    "auth_analyze_session",
    "Comprehensive authentication analysis for all requests in a session. Identifies authentication patterns, tokens, and security issues.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session to analyze. Must be a session created with session_start that contains HAR data."
        ),
      forceReanalysis: z
        .boolean()
        .default(false)
        .describe(
          "Force re-analysis even if cached results exist. Use when session data has changed."
        ),
    },
    async (params) => handleAuthAnalyzeSession(params, context)
  );

  server.tool(
    "auth_test_endpoint",
    "Test authentication requirements for a specific endpoint by analyzing its request/response patterns and identifying auth failures.",
    {
      sessionId: z
        .string()
        .uuid()
        .describe(
          "UUID of the session containing the request to test. Use session_start first."
        ),
      requestUrl: z
        .string()
        .url()
        .describe(
          "Exact URL of the request to test (must match a request in the session's HAR data)."
        ),
      requestMethod: z
        .string()
        .describe(
          "HTTP method of the request to test (GET, POST, PUT, DELETE, etc.)."
        ),
    },
    async (params) => handleAuthTestEndpoint(params, context)
  );
}
