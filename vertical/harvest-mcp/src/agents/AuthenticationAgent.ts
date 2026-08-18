import { getLLMClient, type LLMClient } from "../core/LLMClient.js";
import type { FunctionDefinition } from "../core/providers/types.js";
import type {
  AuthenticationAnalysis,
  AuthenticationEndpoint,
  AuthenticationRequirement,
  AuthenticationType,
  HarvestSession,
  RequestAuthenticationInfo,
  RequestModel,
  TokenInfo,
  TokenLifecycle,
} from "../types/index.js";
import { HarvestError } from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";

const logger = createComponentLogger("authentication-agent");

/**
 * LLM response schema for authentication analysis
 */
interface AuthenticationAnalysisResponse {
  primary_auth_type: AuthenticationType;
  has_authentication: boolean;
  auth_endpoints: Array<{
    url: string;
    method: string;
    purpose: "login" | "refresh" | "logout" | "validate";
    response_contains_token: boolean;
  }>;
  security_issues: string[];
  recommendations: string[];
  token_lifecycle: {
    is_static: boolean;
    expires_in?: number;
    refresh_endpoint?: string;
    generation_endpoint?: string;
  };
}

/**
 * Analyze authentication patterns across all requests in a session
 */
export async function analyzeAuthentication(
  session: HarvestSession,
  llmClient?: LLMClient
): Promise<AuthenticationAnalysis> {
  try {
    const client = llmClient || getLLMClient();

    // Extract all requests from the session
    const allRequests = extractRequestsFromSession(session);

    if (allRequests.length === 0) {
      logger.debug("No requests found in session for authentication analysis");
      return createEmptyAuthAnalysis();
    }

    // Phase 1: Heuristic analysis of each request
    const requestAnalyses = analyzeRequestsHeuristically(allRequests);

    // Phase 2: Pattern detection across requests
    const patterns = detectAuthenticationPatterns(requestAnalyses);

    // Phase 3: LLM refinement for complex cases
    const llmAnalysis = await refineWithLLM(
      allRequests,
      patterns,
      session,
      client
    );

    // Phase 4: Combine results into comprehensive analysis
    const finalAnalysis = combineAuthenticationAnalysis(
      requestAnalyses,
      patterns,
      llmAnalysis
    );

    logger.info("Authentication analysis complete", {
      sessionId: session.id,
      primaryAuthType: finalAnalysis.primaryAuthType,
      hasAuthentication: finalAnalysis.hasAuthentication,
      requestCount: allRequests.length,
      authenticatedRequestCount: finalAnalysis.authenticatedRequests.length,
    });

    return finalAnalysis;
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Authentication analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "AUTHENTICATION_ANALYSIS_FAILED",
      { originalError: error, sessionId: session.id }
    );
  }
}

/**
 * Extract all requests from the session DAG
 */
function extractRequestsFromSession(session: HarvestSession): RequestModel[] {
  const requests: RequestModel[] = [];

  // Get all nodes from the DAG
  const allNodes = session.dagManager.getAllNodes();

  for (const [, node] of allNodes) {
    if (
      node &&
      (node.nodeType === "curl" || node.nodeType === "master_curl") &&
      node.content.key
    ) {
      requests.push(node.content.key as RequestModel);
    }
  }

  return requests;
}

/**
 * Analyze each request for authentication patterns
 */
function analyzeRequestsHeuristically(
  requests: RequestModel[]
): RequestAuthenticationInfo[] {
  return requests.map((request, index) => {
    const analysis = analyzeRequestAuthentication(request, `req_${index}`);
    return analysis;
  });
}

/**
 * Analyze a single request for authentication information
 */
function analyzeRequestAuthentication(
  request: RequestModel,
  requestId: string
): RequestAuthenticationInfo {
  const tokens: TokenInfo[] = [];
  const authHeaders: Record<string, string> = {};
  const authCookies: Record<string, string> = {};
  const authParams: Record<string, string> = {};

  let authenticationType: AuthenticationType = "none";
  let requirement: AuthenticationRequirement = "none";
  let isAuthFailure = false;

  // Store URL patterns for later use (moved from early return to avoid premature classification)
  const urlLower = request.url.toLowerCase();
  const hasPublicEndpointPattern =
    urlLower.includes("/no-auth/") ||
    urlLower.includes("/public/") ||
    urlLower.includes("/anonymous/") ||
    urlLower.includes("/guest/");

  // Analyze headers for authentication first (prioritize actual artifacts over URL patterns)
  for (const [headerName, headerValue] of Object.entries(request.headers)) {
    const lowerName = headerName.toLowerCase();

    if (lowerName === "authorization") {
      authHeaders[headerName] = headerValue;
      requirement = "required";

      if (headerValue.toLowerCase().startsWith("bearer")) {
        authenticationType = "bearer_token";
        tokens.push({
          type: "bearer",
          location: "header",
          name: headerName,
          value: headerValue.substring(7).trim(),
        });
      } else if (headerValue.toLowerCase().startsWith("basic")) {
        authenticationType = "basic_auth";
      }
    } else if (lowerName === "cookie") {
      authCookies[headerName] = headerValue;
      if (authenticationType === "none") {
        authenticationType = "session_cookie";
        requirement = "required";
      }

      // Parse session cookies
      const sessionCookies = parseSessionCookies(headerValue);
      tokens.push(...sessionCookies);
    } else if (
      lowerName.includes("api-key") ||
      lowerName.includes("x-api-key") ||
      lowerName.includes("auth-token")
    ) {
      authHeaders[headerName] = headerValue;
      authenticationType = "api_key";
      requirement = "required";

      tokens.push({
        type: "api_key",
        location: "header",
        name: headerName,
        value: headerValue,
      });
    } else if (lowerName.includes("auth") || lowerName.includes("token")) {
      authHeaders[headerName] = headerValue;
      if (authenticationType === "none") {
        authenticationType = "custom_header";
        requirement = "required";
      }

      tokens.push({
        type: "custom",
        location: "header",
        name: headerName,
        value: headerValue,
      });
    }
  }

  // Analyze URL parameters for authentication
  if (request.queryParams) {
    for (const [paramName, paramValue] of Object.entries(request.queryParams)) {
      const lowerName = paramName.toLowerCase();

      if (
        lowerName.includes("token") ||
        lowerName.includes("api") ||
        lowerName.includes("auth") ||
        lowerName.includes("key")
      ) {
        authParams[paramName] = paramValue;
        if (authenticationType === "none") {
          authenticationType = "url_parameter";
          requirement = "required";
        }

        tokens.push({
          type: "custom",
          location: "url_param",
          name: paramName,
          value: paramValue,
        });
      }
    }
  }

  // Check for authentication failure indicators
  // This would need response data to be complete, but we can check URL patterns
  if (
    urlLower.includes("error") ||
    urlLower.includes("unauthorized") ||
    urlLower.includes("forbidden")
  ) {
    isAuthFailure = true;
  }

  // Only use URL patterns as fallback if no authentication artifacts were found
  // This fixes the issue where "/no-auth/" URLs with session parameters were misclassified
  const hasAuthArtifacts =
    Object.keys(authHeaders).length > 0 ||
    Object.keys(authCookies).length > 0 ||
    Object.keys(authParams).length > 0 ||
    tokens.length > 0;

  // If no auth artifacts found and URL suggests public endpoint, classify as none
  if (!hasAuthArtifacts && hasPublicEndpointPattern) {
    authenticationType = "none";
    requirement = "none";
  }

  return {
    requestId,
    url: request.url,
    method: request.method,
    authenticationType,
    requirement,
    tokens,
    authHeaders,
    authCookies,
    authParams,
    isAuthFailure,
  };
}

/**
 * Parse session cookies from Cookie header
 */
function parseSessionCookies(cookieHeader: string): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  const cookies = cookieHeader.split(";").map((c) => c.trim());

  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name && value) {
      const nameTrimmed = name.trim();
      const valueTrimmed = value.trim();

      // Identify session-like cookies
      if (
        nameTrimmed.toLowerCase().includes("session") ||
        nameTrimmed.toLowerCase().includes("auth") ||
        nameTrimmed.toLowerCase().includes("token") ||
        valueTrimmed.length > 16 // Long values are likely session tokens
      ) {
        tokens.push({
          type: "session",
          location: "cookie",
          name: nameTrimmed,
          value: valueTrimmed,
        });
      }
    }
  }

  return tokens;
}

/**
 * Detect authentication patterns across multiple requests
 */
function detectAuthenticationPatterns(
  requestAnalyses: RequestAuthenticationInfo[]
): {
  primaryAuthType: AuthenticationType;
  authTypes: AuthenticationType[];
  hasConsistentAuth: boolean;
  authEndpoints: AuthenticationEndpoint[];
  publicEndpoints: string[];
  protectedEndpoints: string[];
} {
  const authTypes = new Set<AuthenticationType>();
  const authEndpoints: AuthenticationEndpoint[] = [];
  const publicEndpoints: string[] = [];
  const protectedEndpoints: string[] = [];

  // Analyze each request
  for (const analysis of requestAnalyses) {
    authTypes.add(analysis.authenticationType);

    if (analysis.authenticationType === "none") {
      publicEndpoints.push(analysis.url);
    } else {
      protectedEndpoints.push(analysis.url);
    }

    // Detect authentication endpoints
    const urlLower = analysis.url.toLowerCase();
    if (
      urlLower.includes("login") ||
      urlLower.includes("auth") ||
      urlLower.includes("signin")
    ) {
      authEndpoints.push({
        url: analysis.url,
        method: analysis.method,
        purpose: "login",
        responseContainsToken: analysis.tokens.length > 0,
      });
    }

    if (urlLower.includes("logout") || urlLower.includes("signout")) {
      authEndpoints.push({
        url: analysis.url,
        method: analysis.method,
        purpose: "logout",
        responseContainsToken: false,
      });
    }

    if (urlLower.includes("refresh") && urlLower.includes("token")) {
      authEndpoints.push({
        url: analysis.url,
        method: analysis.method,
        purpose: "refresh",
        responseContainsToken: true,
      });
    }
  }

  // Determine primary auth type
  const authTypeArray = Array.from(authTypes).filter((type) => type !== "none");
  const primaryAuthType: AuthenticationType =
    authTypeArray.length > 0 ? (authTypeArray[0] ?? "none") : "none";

  // Check for consistent authentication
  const hasConsistentAuth = authTypeArray.length <= 1;

  return {
    primaryAuthType,
    authTypes: Array.from(authTypes),
    hasConsistentAuth,
    authEndpoints,
    publicEndpoints,
    protectedEndpoints,
  };
}

/**
 * Refine authentication analysis using LLM
 */
async function refineWithLLM(
  requests: RequestModel[],
  patterns: ReturnType<typeof detectAuthenticationPatterns>,
  session: HarvestSession,
  client: LLMClient
): Promise<AuthenticationAnalysisResponse> {
  // Only use LLM for complex cases
  if (
    patterns.primaryAuthType === "none" &&
    patterns.publicEndpoints.length === requests.length
  ) {
    return {
      primary_auth_type: "none",
      has_authentication: false,
      auth_endpoints: [],
      security_issues: [],
      recommendations: [],
      token_lifecycle: {
        is_static: true,
      },
    };
  }

  const functionDef = createLLMFunctionDefinition();
  const prompt = createLLMPrompt(requests, patterns, session);

  const response = await client.callFunction<AuthenticationAnalysisResponse>(
    prompt,
    functionDef,
    "analyze_authentication"
  );

  return response;
}

/**
 * Create LLM function definition for authentication analysis
 */
function createLLMFunctionDefinition(): FunctionDefinition {
  return {
    name: "analyze_authentication",
    description: "Analyze authentication patterns in HTTP requests",
    parameters: {
      type: "object",
      properties: {
        primary_auth_type: {
          type: "string",
          enum: [
            "bearer_token",
            "api_key",
            "basic_auth",
            "session_cookie",
            "oauth",
            "custom_header",
            "url_parameter",
            "none",
          ],
          description: "Primary authentication method used",
        },
        has_authentication: {
          type: "boolean",
          description: "Whether the API requires authentication",
        },
        auth_endpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              method: { type: "string" },
              purpose: {
                type: "string",
                enum: ["login", "refresh", "logout", "validate"],
              },
              response_contains_token: { type: "boolean" },
            },
          },
        },
        security_issues: {
          type: "array",
          items: { type: "string" },
          description: "Identified security concerns",
        },
        recommendations: {
          type: "array",
          items: { type: "string" },
          description: "Recommendations for secure implementation",
        },
        token_lifecycle: {
          type: "object",
          properties: {
            is_static: { type: "boolean" },
            expires_in: { type: "number" },
            refresh_endpoint: { type: "string" },
            generation_endpoint: { type: "string" },
          },
        },
      },
      required: [
        "primary_auth_type",
        "has_authentication",
        "auth_endpoints",
        "security_issues",
        "recommendations",
        "token_lifecycle",
      ],
    },
  };
}

/**
 * Create LLM prompt for authentication analysis
 */
function createLLMPrompt(
  requests: RequestModel[],
  patterns: ReturnType<typeof detectAuthenticationPatterns>,
  session: HarvestSession
): string {
  const requestSummary = requests
    .slice(0, 10)
    .map((req, index) => `${index + 1}. ${req.method} ${req.url}`)
    .join("\n");

  const authSummary = `
Primary Auth Type: ${patterns.primaryAuthType}
Auth Types Found: ${patterns.authTypes.join(", ")}
Protected Endpoints: ${patterns.protectedEndpoints.length}
Public Endpoints: ${patterns.publicEndpoints.length}
Auth Endpoints: ${patterns.authEndpoints.length}
`;

  return `User Prompt: ${session.prompt}

Requests Sample:
${requestSummary}

Heuristic Analysis:
${authSummary}

Task: Analyze the authentication patterns in these HTTP requests and provide detailed insights.

Focus on:
1. Identifying the primary authentication method
2. Detecting public vs protected endpoints  
3. Finding authentication flows (login, refresh, logout)
4. Security concerns and recommendations
5. Token lifecycle management

Special Considerations:
- URLs containing "/no-auth/" are typically public endpoints
- Look for patterns like Bearer tokens, API keys, session cookies
- Consider token refresh and generation patterns
- Identify security issues like hardcoded tokens or insecure transport`;
}

/**
 * Combine all analysis results into final authentication analysis
 */
function combineAuthenticationAnalysis(
  requestAnalyses: RequestAuthenticationInfo[],
  patterns: ReturnType<typeof detectAuthenticationPatterns>,
  llmAnalysis: AuthenticationAnalysisResponse
): AuthenticationAnalysis {
  // Extract all tokens
  const allTokens: TokenInfo[] = [];
  for (const analysis of requestAnalyses) {
    allTokens.push(...analysis.tokens);
  }

  // Categorize requests
  const authenticatedRequests = requestAnalyses.filter(
    (r) => r.authenticationType !== "none"
  );
  const unauthenticatedRequests = requestAnalyses.filter(
    (r) => r.authenticationType === "none"
  );
  const failedAuthRequests = requestAnalyses.filter((r) => r.isAuthFailure);

  // Create token lifecycle
  const tokenLifecycle: TokenLifecycle = {
    isStatic: llmAnalysis.token_lifecycle.is_static,
    ...(llmAnalysis.token_lifecycle.expires_in !== undefined && {
      expiresIn: llmAnalysis.token_lifecycle.expires_in,
    }),
    ...(llmAnalysis.token_lifecycle.refresh_endpoint !== undefined && {
      refreshEndpoint: llmAnalysis.token_lifecycle.refresh_endpoint,
    }),
    ...(llmAnalysis.token_lifecycle.generation_endpoint !== undefined && {
      generationEndpoint: llmAnalysis.token_lifecycle.generation_endpoint,
    }),
  };

  // Convert LLM auth endpoints
  const authEndpoints: AuthenticationEndpoint[] =
    llmAnalysis.auth_endpoints.map((endpoint) => ({
      url: endpoint.url,
      method: endpoint.method,
      purpose: endpoint.purpose,
      responseContainsToken: endpoint.response_contains_token,
    }));

  // Analyze auth flow complexity
  const hasLoginFlow = authEndpoints.some((e) => e.purpose === "login");
  const hasRefreshFlow = authEndpoints.some((e) => e.purpose === "refresh");
  const hasLogoutFlow = authEndpoints.some((e) => e.purpose === "logout");

  let flowComplexity: "simple" | "moderate" | "complex" = "simple";
  if (hasLoginFlow && hasRefreshFlow) {
    flowComplexity = "complex";
  } else if (hasLoginFlow || patterns.authTypes.length > 1) {
    flowComplexity = "moderate";
  }

  // Identify hardcoded vs dynamic tokens
  const hardcodedTokens: string[] = [];
  const dynamicTokens: string[] = [];

  for (const token of allTokens) {
    if (token.value.length > 20 && /^[a-zA-Z0-9+/=]+$/.test(token.value)) {
      hardcodedTokens.push(token.value);
    } else {
      dynamicTokens.push(token.value);
    }
  }

  return {
    hasAuthentication: llmAnalysis.has_authentication,
    primaryAuthType: llmAnalysis.primary_auth_type,
    authTypes: patterns.authTypes,
    authenticatedRequests,
    unauthenticatedRequests,
    failedAuthRequests,
    tokens: allTokens,
    tokenLifecycle,
    authEndpoints,
    authFlow: {
      hasLoginFlow,
      hasRefreshFlow,
      hasLogoutFlow,
      flowComplexity,
    },
    securityIssues: llmAnalysis.security_issues,
    recommendations: llmAnalysis.recommendations,
    codeGeneration: {
      isReady: llmAnalysis.has_authentication
        ? hardcodedTokens.length === 0
        : true,
      requiredSetup: llmAnalysis.has_authentication
        ? [
            "Configure authentication credentials",
            "Implement token refresh logic if needed",
            "Set up secure credential storage",
          ]
        : [],
      supportedPatterns: [llmAnalysis.primary_auth_type],
      hardcodedTokens,
      dynamicTokens,
    },
  };
}

/**
 * Create empty authentication analysis for sessions with no authentication
 */
function createEmptyAuthAnalysis(): AuthenticationAnalysis {
  return {
    hasAuthentication: false,
    primaryAuthType: "none",
    authTypes: ["none"],
    authenticatedRequests: [],
    unauthenticatedRequests: [],
    failedAuthRequests: [],
    tokens: [],
    tokenLifecycle: {
      isStatic: true,
    },
    authEndpoints: [],
    authFlow: {
      hasLoginFlow: false,
      hasRefreshFlow: false,
      hasLogoutFlow: false,
      flowComplexity: "simple",
    },
    securityIssues: [],
    recommendations: ["No authentication detected - API appears to be public"],
    codeGeneration: {
      isReady: true,
      requiredSetup: [],
      supportedPatterns: ["none"],
      hardcodedTokens: [],
      dynamicTokens: [],
    },
  };
}
