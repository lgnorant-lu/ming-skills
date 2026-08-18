import { getLLMClient } from "../core/LLMClient.js";
import type { FunctionDefinition } from "../core/providers/types.js";
import type { RequestModel } from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";

const logger = createComponentLogger("session-bootstrap-agent");

/**
 * Result of session bootstrap analysis
 */
export interface SessionBootstrapAnalysis {
  requiresBootstrap: boolean;
  bootstrapRequests: BootstrapRequest[];
  sessionTokens: SessionToken[];
  establishmentPattern:
    | "initial-page"
    | "login-endpoint"
    | "spa-initialization"
    | "cookie-based"
    | "none";
  confidence: number;
  analysis: string;
}

/**
 * Bootstrap request that establishes session state
 */
export interface BootstrapRequest {
  request: RequestModel;
  establishesTokens: string[];
  priority: number;
  method: "page-load" | "api-call" | "authentication";
}

/**
 * Session token information
 */
export interface SessionToken {
  parameter: string;
  value: string;
  source: "url-param" | "header" | "cookie" | "response-body";
  establishedBy?: RequestModel;
  required: boolean;
}

/**
 * Analyze session establishment patterns from HAR data
 */
export async function analyzeSessionBootstrap(
  requests: RequestModel[],
  sessionTokens: string[],
  authenticationParameters: string[]
): Promise<SessionBootstrapAnalysis> {
  if (!requests || requests.length === 0) {
    return createEmptyBootstrapAnalysis();
  }

  try {
    logger.debug("Starting session bootstrap analysis", {
      requestCount: requests.length,
      sessionTokensCount: sessionTokens.length,
      authParametersCount: authenticationParameters.length,
    });

    // Identify potential bootstrap requests
    const potentialBootstrapRequests = identifyBootstrapRequests(requests);

    // Map session tokens to their sources
    const tokenMapping = mapTokensToRequests(
      requests,
      sessionTokens,
      authenticationParameters
    );

    // Use LLM to analyze the bootstrap pattern
    const llmAnalysis = await analyzewithLLM(
      requests,
      potentialBootstrapRequests,
      tokenMapping
    );

    // Determine the establishment pattern
    const establishmentPattern = determineEstablishmentPattern(
      potentialBootstrapRequests,
      tokenMapping,
      llmAnalysis
    );

    const result: SessionBootstrapAnalysis = {
      requiresBootstrap:
        tokenMapping.length > 0 || llmAnalysis.requiresBootstrap,
      bootstrapRequests: createBootstrapRequests(
        potentialBootstrapRequests,
        tokenMapping
      ),
      sessionTokens: tokenMapping,
      establishmentPattern,
      confidence: llmAnalysis.confidence,
      analysis: llmAnalysis.analysis,
    };

    logger.debug("Session bootstrap analysis completed", {
      requiresBootstrap: result.requiresBootstrap,
      bootstrapRequestCount: result.bootstrapRequests.length,
      sessionTokenCount: result.sessionTokens.length,
      pattern: result.establishmentPattern,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    logger.error("Session bootstrap analysis failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      requestCount: requests.length,
    });

    // Fallback analysis using heuristics
    return performFallbackAnalysis(
      requests,
      sessionTokens,
      authenticationParameters
    );
  }
}

/**
 * Identify requests that could potentially establish session state
 */
function identifyBootstrapRequests(requests: RequestModel[]): RequestModel[] {
  const potentialBootstraps: RequestModel[] = [];

  // Sort requests by timestamp to identify initial requests
  const sortedRequests = requests
    .filter((req) => req.timestamp)
    .sort(
      (a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0)
    );

  // Look for initial page loads (HTML responses)
  const htmlRequests = sortedRequests.filter((req) => {
    const contentType =
      req.response?.headers?.["content-type"] ||
      req.response?.headers?.["Content-Type"] ||
      "";
    return (
      contentType.includes("text/html") && req.method.toUpperCase() === "GET"
    );
  });

  // Add HTML requests that could establish session
  potentialBootstraps.push(...htmlRequests.slice(0, 3));

  // Look for authentication endpoints
  const authRequests = sortedRequests.filter((req) => {
    const url = req.url.toLowerCase();
    return (
      url.includes("login") ||
      url.includes("auth") ||
      url.includes("session") ||
      url.includes("token") ||
      (req.method.toUpperCase() === "POST" && req.body)
    );
  });

  potentialBootstraps.push(...authRequests.slice(0, 5));

  // Look for requests that set cookies
  const cookieSettingRequests = sortedRequests.filter((req) => {
    const headers = req.response?.headers || {};
    return Object.keys(headers).some(
      (key) => key.toLowerCase() === "set-cookie"
    );
  });

  potentialBootstraps.push(...cookieSettingRequests.slice(0, 3));

  // Remove duplicates
  const uniqueBootstraps = Array.from(new Set(potentialBootstraps));

  return uniqueBootstraps.slice(0, 10); // Limit to 10 potential bootstrap requests
}

/**
 * Map session tokens to the requests that likely established them
 */
function mapTokensToRequests(
  requests: RequestModel[],
  sessionTokens: string[],
  authParameters: string[]
): SessionToken[] {
  const tokenMapping: SessionToken[] = [];

  // Create a comprehensive list of tokens to analyze
  const allTokensToAnalyze = new Set([...sessionTokens]);

  // Extract token values from authentication parameters
  for (const param of authParameters) {
    for (const request of requests) {
      const url = new URL(request.url);
      const value = url.searchParams.get(
        param.replace(/^(header_|cookie_)/, "")
      );
      if (value) {
        allTokensToAnalyze.add(value);
      }
    }
  }

  // Analyze each token
  for (const token of allTokensToAnalyze) {
    const tokenInfo = analyzeTokenSource(requests, token);
    if (tokenInfo) {
      tokenMapping.push(tokenInfo);
    }
  }

  return tokenMapping.sort(
    (a, b) => (a.required ? 1 : 0) - (b.required ? 1 : 0)
  );
}

/**
 * Analyze where a specific token comes from
 */
function analyzeTokenSource(
  requests: RequestModel[],
  token: string
): SessionToken | null {
  let parameter = "";
  let source: SessionToken["source"] = "url-param";
  let establishedBy: RequestModel | undefined;

  // Find the parameter name and source
  for (const request of requests) {
    const url = new URL(request.url);

    // Check URL parameters
    for (const [key, value] of url.searchParams.entries()) {
      if (value === token) {
        parameter = key;
        source = "url-param";
        break;
      }
    }

    // Check headers
    if (request.headers) {
      for (const [headerName, headerValue] of Object.entries(request.headers)) {
        if (headerValue === token || headerValue.includes(token)) {
          parameter = headerName;
          source = "header";
          break;
        }
      }
    }

    // Check cookies
    const cookieHeader = request.headers?.cookie || request.headers?.Cookie;
    if (cookieHeader?.includes(token)) {
      const cookies = parseCookies(cookieHeader);
      for (const [cookieName, cookieValue] of Object.entries(cookies)) {
        if (cookieValue === token) {
          parameter = cookieName;
          source = "cookie";
          break;
        }
      }
    }

    // Check response body for token establishment
    if (request.response?.text?.includes(token)) {
      source = "response-body";
      establishedBy = request;
    }

    if (parameter) {
      break;
    }
  }

  if (!parameter) {
    // Infer parameter name from token characteristics
    parameter = inferTokenParameterName(token);
  }

  return {
    parameter,
    value: token,
    source,
    ...(establishedBy && { establishedBy }),
    required: isRequiredToken(parameter, token),
  };
}

/**
 * Use LLM to analyze bootstrap patterns
 */
async function analyzewithLLM(
  requests: RequestModel[],
  potentialBootstraps: RequestModel[],
  tokenMapping: SessionToken[]
): Promise<{
  requiresBootstrap: boolean;
  confidence: number;
  analysis: string;
}> {
  try {
    const llmClient = getLLMClient();
    const functionDef = createBootstrapAnalysisFunction();
    const prompt = createBootstrapAnalysisPrompt(
      requests,
      potentialBootstraps,
      tokenMapping
    );

    const response = await llmClient.callFunction<{
      requiresBootstrap: boolean;
      confidence: number;
      analysis: string;
    }>(prompt, functionDef, "analyze_session_bootstrap");

    return {
      requiresBootstrap: response.requiresBootstrap || false,
      confidence: response.confidence || 0.5,
      analysis: response.analysis || "Bootstrap analysis completed",
    };
  } catch (error) {
    logger.error("LLM bootstrap analysis failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Fallback heuristic analysis
    const requiresBootstrap =
      tokenMapping.length > 0 || potentialBootstraps.length > 0;
    return {
      requiresBootstrap,
      confidence: 0.3,
      analysis: "Fallback heuristic analysis used due to LLM failure",
    };
  }
}

/**
 * Create function definition for bootstrap analysis
 */
function createBootstrapAnalysisFunction(): FunctionDefinition {
  return {
    name: "analyze_session_bootstrap",
    description:
      "Analyze HTTP request patterns to determine if session bootstrap/establishment is required " +
      "and identify the pattern used for session initialization.",
    parameters: {
      type: "object",
      properties: {
        requiresBootstrap: {
          type: "boolean",
          description:
            "Whether session bootstrap/establishment is required before making API calls",
        },
        confidence: {
          type: "number",
          description:
            "Confidence level (0-1) in the bootstrap requirement analysis",
        },
        analysis: {
          type: "string",
          description:
            "Explanation of the session establishment pattern detected",
        },
      },
      required: ["requiresBootstrap", "confidence", "analysis"],
    },
  };
}

/**
 * Create prompt for bootstrap analysis
 */
function createBootstrapAnalysisPrompt(
  requests: RequestModel[],
  potentialBootstraps: RequestModel[],
  tokenMapping: SessionToken[]
): string {
  const requestSummary = requests.slice(0, 5).map((req) => ({
    url: req.url,
    method: req.method,
    hasBody: !!req.body,
    responseStatus: req.response?.status,
    contentType:
      req.response?.headers?.["content-type"] ||
      req.response?.headers?.["Content-Type"],
  }));

  const bootstrapSummary = potentialBootstraps.slice(0, 5).map((req) => ({
    url: req.url,
    method: req.method,
    isHtml:
      req.response?.headers?.["content-type"]?.includes("text/html") || false,
    setCookies: Object.keys(req.response?.headers || {}).some(
      (k) => k.toLowerCase() === "set-cookie"
    ),
  }));

  const tokenSummary = tokenMapping.slice(0, 5).map((token) => ({
    parameter: token.parameter,
    source: token.source,
    hasEstablisher: !!token.establishedBy,
    required: token.required,
  }));

  return `Analyze the following HTTP request patterns to determine session establishment requirements:

Total Requests: ${requests.length}

Sample Requests:
${JSON.stringify(requestSummary, null, 2)}

Potential Bootstrap Requests:
${JSON.stringify(bootstrapSummary, null, 2)}

Session Tokens Detected:
${JSON.stringify(tokenSummary, null, 2)}

Task: Determine if this API workflow requires session establishment/bootstrap before making API calls.

Consider:
1. Are there session tokens/parameters that appear consistently across API calls?
2. Are there initial requests (HTML pages, login endpoints) that likely establish these tokens?
3. Would the API calls fail without proper session establishment?
4. Is this a Single Page Application (SPA) that establishes session during initialization?

Focus on whether the workflow needs an initial setup step to establish authentication/session state.`;
}

/**
 * Determine the session establishment pattern
 */
function determineEstablishmentPattern(
  potentialBootstraps: RequestModel[],
  tokenMapping: SessionToken[],
  llmAnalysis: {
    requiresBootstrap: boolean;
    confidence: number;
    analysis: string;
  }
): SessionBootstrapAnalysis["establishmentPattern"] {
  if (!llmAnalysis.requiresBootstrap || tokenMapping.length === 0) {
    return "none";
  }

  // Check for HTML page loads
  const hasHtmlRequests = potentialBootstraps.some((req) => {
    const contentType =
      req.response?.headers?.["content-type"] ||
      req.response?.headers?.["Content-Type"] ||
      "";
    return contentType.includes("text/html");
  });

  // Check for authentication endpoints
  const hasAuthEndpoints = potentialBootstraps.some((req) => {
    const url = req.url.toLowerCase();
    return (
      url.includes("login") || url.includes("auth") || url.includes("session")
    );
  });

  // Check for cookie-based establishment
  const hasCookieEstablishment = tokenMapping.some(
    (token) => token.source === "cookie"
  );

  // Check for SPA pattern (HTML + many tokens)
  const isSpaPattern = hasHtmlRequests && tokenMapping.length > 1;

  if (hasAuthEndpoints) {
    return "login-endpoint";
  }
  if (isSpaPattern) {
    return "spa-initialization";
  }
  if (hasCookieEstablishment) {
    return "cookie-based";
  }
  if (hasHtmlRequests) {
    return "initial-page";
  }

  return "none";
}

/**
 * Create bootstrap requests from analysis
 */
function createBootstrapRequests(
  potentialBootstraps: RequestModel[],
  tokenMapping: SessionToken[]
): BootstrapRequest[] {
  const bootstrapRequests: BootstrapRequest[] = [];

  for (const request of potentialBootstraps) {
    // Find tokens established by this request
    const establishedTokens = tokenMapping
      .filter((token) => token.establishedBy === request)
      .map((token) => token.value);

    // Calculate priority based on request characteristics
    const priority = calculateBootstrapPriority(request, establishedTokens);

    // Determine method
    let method: BootstrapRequest["method"] = "page-load";
    const url = request.url.toLowerCase();
    if (url.includes("login") || url.includes("auth")) {
      method = "authentication";
    } else if (request.method.toUpperCase() !== "GET" || request.body) {
      method = "api-call";
    }

    bootstrapRequests.push({
      request,
      establishesTokens: establishedTokens,
      priority,
      method,
    });
  }

  return bootstrapRequests.sort((a, b) => b.priority - a.priority);
}

/**
 * Calculate bootstrap priority for a request
 */
function calculateBootstrapPriority(
  request: RequestModel,
  establishedTokens: string[]
): number {
  let priority = 0;

  // Base priority for different request types
  const contentType =
    request.response?.headers?.["content-type"] ||
    request.response?.headers?.["Content-Type"] ||
    "";

  if (contentType.includes("text/html")) {
    priority += 10; // HTML pages are likely bootstrap requests
  }

  // Authentication-related URLs get higher priority
  const url = request.url.toLowerCase();
  if (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("session")
  ) {
    priority += 15;
  }

  // Requests that establish tokens get higher priority
  priority += establishedTokens.length * 5;

  // Earlier requests get higher priority (timestamp-based)
  if (request.timestamp) {
    const hoursSinceEpoch = request.timestamp.getTime() / (1000 * 60 * 60);
    priority += Math.max(0, 100 - hoursSinceEpoch); // Arbitrary scaling
  }

  // Requests that set cookies get higher priority
  const headers = request.response?.headers || {};
  if (Object.keys(headers).some((key) => key.toLowerCase() === "set-cookie")) {
    priority += 8;
  }

  return priority;
}

/**
 * Create empty bootstrap analysis for early returns
 */
function createEmptyBootstrapAnalysis(): SessionBootstrapAnalysis {
  return {
    requiresBootstrap: false,
    bootstrapRequests: [],
    sessionTokens: [],
    establishmentPattern: "none",
    confidence: 0,
    analysis: "No requests provided for analysis",
  };
}

/**
 * Perform fallback analysis using heuristics when LLM fails
 */
function performFallbackAnalysis(
  requests: RequestModel[],
  sessionTokens: string[],
  authenticationParameters: string[]
): SessionBootstrapAnalysis {
  const potentialBootstraps = identifyBootstrapRequests(requests);
  const tokenMapping = mapTokensToRequests(
    requests,
    sessionTokens,
    authenticationParameters
  );

  const requiresBootstrap = tokenMapping.length > 0;
  const establishmentPattern = determineEstablishmentPattern(
    potentialBootstraps,
    tokenMapping,
    { requiresBootstrap, confidence: 0.3, analysis: "Fallback analysis" }
  );

  return {
    requiresBootstrap,
    bootstrapRequests: createBootstrapRequests(
      potentialBootstraps,
      tokenMapping
    ),
    sessionTokens: tokenMapping,
    establishmentPattern,
    confidence: 0.3,
    analysis: "Fallback heuristic analysis used",
  };
}

/**
 * Helper functions
 */

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name && valueParts.length > 0) {
      cookies[name.trim()] = valueParts.join("=").trim();
    }
  }

  return cookies;
}

function inferTokenParameterName(token: string): string {
  if (token.length > 20 && /^[a-f0-9]+$/i.test(token)) {
    return "sessionId";
  }
  if (token.includes("tkn") || token.includes("token")) {
    return "authToken";
  }
  if (token.length === 8 && /^[a-zA-Z0-9_-]+$/.test(token)) {
    return "sessionId";
  }
  return "token";
}

function isRequiredToken(parameter: string, token: string): boolean {
  const authKeywords = ["session", "token", "auth", "csrf", "key", "juris"];
  const lowerParam = parameter.toLowerCase();

  return (
    authKeywords.some((keyword) => lowerParam.includes(keyword)) ||
    token.length >= 8
  );
}
