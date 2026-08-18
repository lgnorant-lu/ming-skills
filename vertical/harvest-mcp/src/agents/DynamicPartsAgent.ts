import { getLLMClient } from "../core/LLMClient.js";
import type { FunctionDefinition } from "../core/providers/types.js";
import {
  type DynamicPartsResponse,
  HarvestError,
  type RequestModel,
} from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";

const logger = createComponentLogger("dynamic-parts-agent");

/**
 * Result of filtering input variables from dynamic parts
 */
interface FilterResult {
  filteredParts: string[];
  removedParts: string[];
}

/**
 * Result of session token analysis
 */
interface SessionTokenAnalysis {
  potentialSessionTokens: string[];
  authenticationParameters: string[];
  confidence: number;
  analysis: string;
}

/**
 * Session pattern detection for parameters that appear consistently
 */
interface SessionPattern {
  parameter: string;
  value: string;
  occurrences: number;
  consistency: number; // 0-1 representing how consistent the value is
  isAuthenticationRelated: boolean;
}

/**
 * Identify dynamic parts present in a cURL command using LLM analysis
 */
export async function identifyDynamicParts(
  curlCommand: string,
  inputVariables: Record<string, string> = {}
): Promise<string[]> {
  // Skip analysis for JavaScript files
  if (isJavaScriptFile(curlCommand)) {
    return [];
  }

  try {
    const llmClient = getLLMClient();
    const functionDef = createFunctionDefinition();
    const prompt = createPrompt(curlCommand, inputVariables);

    const response = await llmClient.callFunction<DynamicPartsResponse>(
      prompt,
      functionDef,
      "identify_dynamic_parts"
    );

    let dynamicParts = response.dynamic_parts || [];

    // Filter out input variables that are present in the request
    const filterResult = filterInputVariables(
      dynamicParts,
      inputVariables,
      curlCommand
    );
    dynamicParts = filterResult.filteredParts;

    return dynamicParts;
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Dynamic parts identification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "DYNAMIC_PARTS_IDENTIFICATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Enhanced dynamic parts identification for SPA-aware session token detection
 * Analyzes request patterns across multiple requests to identify consistent session tokens
 */
export async function identifyDynamicPartsWithSessionAwareness(
  requests: RequestModel[],
  inputVariables: Record<string, string> = {}
): Promise<{
  dynamicParts: string[];
  sessionTokens: string[];
  authenticationParameters: string[];
}> {
  if (!requests || requests.length === 0) {
    return {
      dynamicParts: [],
      sessionTokens: [],
      authenticationParameters: [],
    };
  }

  try {
    // First, get traditional dynamic parts for all requests
    const allDynamicParts: string[] = [];
    const requestCurls = requests.map((req) => req.toString());

    for (const curlCommand of requestCurls) {
      const parts = await identifyDynamicParts(curlCommand, inputVariables);
      allDynamicParts.push(...parts);
    }

    // Remove duplicates
    const uniqueDynamicParts = [...new Set(allDynamicParts)];

    // Analyze session patterns to identify authentication tokens
    const sessionPatterns = analyzeSessionPatterns(
      requests,
      uniqueDynamicParts
    );

    // Use LLM to analyze potential session tokens
    const sessionAnalysis = await analyzeSessionTokens(
      requests,
      sessionPatterns
    );

    // Combine traditional dynamic parts with session-aware analysis
    const enhancedDynamicParts = [
      ...uniqueDynamicParts,
      ...sessionAnalysis.potentialSessionTokens,
    ];

    // Remove duplicates again
    const finalDynamicParts = [...new Set(enhancedDynamicParts)];

    logger.debug("Enhanced dynamic parts identification completed", {
      totalRequests: requests.length,
      traditionalDynamicParts: uniqueDynamicParts.length,
      sessionTokens: sessionAnalysis.potentialSessionTokens.length,
      authParameters: sessionAnalysis.authenticationParameters.length,
      finalCount: finalDynamicParts.length,
    });

    return {
      dynamicParts: finalDynamicParts,
      sessionTokens: sessionAnalysis.potentialSessionTokens,
      authenticationParameters: sessionAnalysis.authenticationParameters,
    };
  } catch (error) {
    logger.error("Enhanced dynamic parts identification failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      requestCount: requests.length,
    });

    // Fallback to traditional approach if enhanced analysis fails
    const fallbackResults = await Promise.all(
      requests.map((req) =>
        identifyDynamicParts(req.toString(), inputVariables)
      )
    );

    const fallbackParts = [...new Set(fallbackResults.flat())];

    return {
      dynamicParts: fallbackParts,
      sessionTokens: [],
      authenticationParameters: [],
    };
  }
}

/**
 * Create the OpenAI function definition for dynamic parts identification
 */
export function createFunctionDefinition(): FunctionDefinition {
  return {
    name: "identify_dynamic_parts",
    description:
      "Given the above cURL command, identify which parts are dynamic and validated by the server " +
      "for correctness (e.g., authentication tokens, session IDs, CSRF tokens, API keys). Include all " +
      "authentication-related values but exclude arbitrary user input or general data that can be hardcoded.",
    parameters: {
      type: "object",
      properties: {
        dynamic_parts: {
          type: "array",
          items: { type: "string" },
          description:
            "List of dynamic parts identified in the cURL command, with special focus on authentication tokens. " +
            "Include: Bearer tokens, API keys, session cookies, CSRF tokens, authentication parameters. " +
            "Only include the dynamic values (not the keys) of parts that are unique to a user or session " +
            "and, if incorrect, will cause the request to fail due to authentication or authorization errors. " +
            "Do not include duplicates. Do not include the keys, only the values.",
        },
      },
      required: ["dynamic_parts"],
    },
  };
}

/**
 * Create the prompt for LLM analysis
 */
export function createPrompt(
  curlCommand: string,
  inputVariables: Record<string, string>
): string {
  return `URL: ${curlCommand}

Task:

Use your best judgment to identify which parts of the cURL command are dynamic, specific to a user or session, and are checked by the server for validity. These include tokens, IDs, session variables, or any other values that are unique to a user or session and, if incorrect, will cause the request to fail.

Important:
    - INCLUDE authentication tokens from Authorization headers, API key headers, and authentication cookies
    - INCLUDE session identifiers, CSRF tokens, and authentication parameters
    - Ignore common non-authentication headers like user-agent, sec-ch-ua, accept-encoding, referer, etc.
    - Exclude parameters that represent arbitrary user input or general data that can be hardcoded, such as amounts, notes, messages, actions, etc.
    - Only output the variable values and not the keys.
    - Focus on unique identifiers, authentication tokens, session variables, and security tokens.
    - Pay special attention to Bearer tokens, API keys, session cookies, and URL-based authentication parameters.

${Object.keys(inputVariables).length > 0 ? `Input Variables Available: ${JSON.stringify(inputVariables)}` : ""}`;
}

/**
 * Check if the request is for a JavaScript file (should skip analysis)
 */
export function isJavaScriptFile(curlCommand: string): boolean {
  return (
    curlCommand.includes(".js'") ||
    curlCommand.endsWith(".js") ||
    curlCommand.includes(".js ")
  );
}

/**
 * Filter input variables from dynamic parts
 * Removes any dynamic parts that match input variable values
 */
export function filterInputVariables(
  dynamicParts: string[],
  inputVariables: Record<string, string>,
  curlCommand: string
): FilterResult {
  const inputValues = Object.values(inputVariables);
  const removedParts: string[] = [];

  // Find which input variables are present in the curl command
  const presentVariables = inputValues.filter((value) =>
    curlCommand.includes(value)
  );

  // Remove any dynamic parts that match present input variables
  const filteredParts = dynamicParts.filter((part) => {
    if (presentVariables.includes(part)) {
      removedParts.push(part);
      return false;
    }
    return true;
  });

  return {
    filteredParts,
    removedParts,
  };
}

/**
 * Analyze session patterns across multiple requests to identify consistent authentication tokens
 */
function analyzeSessionPatterns(
  requests: RequestModel[],
  _dynamicParts: string[]
): SessionPattern[] {
  const patterns: Map<string, { values: Set<string>; occurrences: number }> =
    new Map();

  // Extract all parameters and their values from requests
  for (const request of requests) {
    extractUrlParameters(request, patterns);
    extractHeaderParameters(request, patterns);
    extractCookieParameters(request, patterns);
  }

  return convertPatternsToSessionPatterns(patterns, requests.length);
}

/**
 * Extract URL parameters from a request
 */
function extractUrlParameters(
  request: RequestModel,
  patterns: Map<string, { values: Set<string>; occurrences: number }>
): void {
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  for (const [key, value] of searchParams.entries()) {
    addToPatterns(patterns, key, value);
  }
}

/**
 * Extract authentication headers from a request
 */
function extractHeaderParameters(
  request: RequestModel,
  patterns: Map<string, { values: Set<string>; occurrences: number }>
): void {
  if (!request.headers) {
    return;
  }

  for (const [headerName, headerValue] of Object.entries(request.headers)) {
    if (isAuthenticationHeader(headerName)) {
      const key = `header_${headerName}`;
      addToPatterns(patterns, key, headerValue);
    }
  }
}

/**
 * Extract authentication cookies from a request
 */
function extractCookieParameters(
  request: RequestModel,
  patterns: Map<string, { values: Set<string>; occurrences: number }>
): void {
  const cookieHeader = request.headers?.cookie || request.headers?.Cookie;
  if (!cookieHeader) {
    return;
  }

  const cookies = parseCookieHeader(cookieHeader);
  for (const [cookieName, cookieValue] of Object.entries(cookies)) {
    if (isAuthenticationCookie(cookieName)) {
      const key = `cookie_${cookieName}`;
      addToPatterns(patterns, key, cookieValue);
    }
  }
}

/**
 * Add a parameter to the patterns map
 */
function addToPatterns(
  patterns: Map<string, { values: Set<string>; occurrences: number }>,
  key: string,
  value: string
): void {
  if (!patterns.has(key)) {
    patterns.set(key, { values: new Set(), occurrences: 0 });
  }
  const pattern = patterns.get(key);
  if (!pattern) {
    return;
  }
  pattern.values.add(value);
  pattern.occurrences++;
}

/**
 * Convert patterns map to SessionPattern objects
 */
function convertPatternsToSessionPatterns(
  patterns: Map<string, { values: Set<string>; occurrences: number }>,
  totalRequests: number
): SessionPattern[] {
  const sessionPatterns: SessionPattern[] = [];

  for (const [parameter, data] of patterns.entries()) {
    const mostCommonValue = findMostCommonValue(data.values);
    const consistency = data.occurrences / totalRequests;
    const isAuthenticationRelated = isLikelyAuthenticationParameter(parameter);

    if (
      shouldIncludePattern(
        consistency,
        isAuthenticationRelated,
        data.values.size
      )
    ) {
      sessionPatterns.push({
        parameter,
        value: mostCommonValue,
        occurrences: data.occurrences,
        consistency,
        isAuthenticationRelated,
      });
    }
  }

  return sessionPatterns.sort((a, b) => b.consistency - a.consistency);
}

/**
 * Find the most common value in a set
 */
function findMostCommonValue(values: Set<string>): string {
  const valueArray = [...values];
  return valueArray.reduce((a, b) =>
    valueArray.filter((v) => v === a).length >=
    valueArray.filter((v) => v === b).length
      ? a
      : b
  );
}

/**
 * Determine if a pattern should be included based on consistency and characteristics
 */
function shouldIncludePattern(
  consistency: number,
  isAuthenticationRelated: boolean,
  uniqueValuesCount: number
): boolean {
  return (
    consistency >= 0.3 && (isAuthenticationRelated || uniqueValuesCount === 1)
  );
}

/**
 * Use LLM to analyze potential session tokens from detected patterns
 */
async function analyzeSessionTokens(
  requests: RequestModel[],
  sessionPatterns: SessionPattern[]
): Promise<SessionTokenAnalysis> {
  if (sessionPatterns.length === 0) {
    return {
      potentialSessionTokens: [],
      authenticationParameters: [],
      confidence: 0,
      analysis: "No session patterns detected",
    };
  }

  try {
    const llmClient = getLLMClient();
    const functionDef = createSessionTokenAnalysisFunction();
    const prompt = createSessionTokenAnalysisPrompt(requests, sessionPatterns);

    const response = await llmClient.callFunction<SessionTokenAnalysis>(
      prompt,
      functionDef,
      "analyze_session_tokens"
    );

    logger.debug("Session token analysis completed", {
      patternsAnalyzed: sessionPatterns.length,
      tokensIdentified: response.potentialSessionTokens?.length || 0,
      confidence: response.confidence,
    });

    return {
      potentialSessionTokens: response.potentialSessionTokens || [],
      authenticationParameters: response.authenticationParameters || [],
      confidence: response.confidence || 0,
      analysis: response.analysis || "Analysis completed",
    };
  } catch (error) {
    logger.error("Session token analysis failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      patternsCount: sessionPatterns.length,
    });

    // Fallback: identify likely session tokens based on heuristics
    const fallbackTokens = sessionPatterns
      .filter((p) => p.isAuthenticationRelated && p.consistency > 0.5)
      .map((p) => p.value);

    return {
      potentialSessionTokens: fallbackTokens,
      authenticationParameters: sessionPatterns
        .filter((p) => p.isAuthenticationRelated)
        .map((p) => p.parameter),
      confidence: 0.3,
      analysis: "Fallback heuristic analysis used due to LLM failure",
    };
  }
}

/**
 * Create function definition for session token analysis
 */
function createSessionTokenAnalysisFunction(): FunctionDefinition {
  return {
    name: "analyze_session_tokens",
    description:
      "Analyze request patterns to identify session tokens and authentication parameters that appear " +
      "consistently across multiple requests, especially in SPA applications where tokens are established " +
      "during application bootstrap.",
    parameters: {
      type: "object",
      properties: {
        potentialSessionTokens: {
          type: "array",
          items: { type: "string" },
          description:
            "Values that appear to be session tokens, authentication tokens, or other session-specific " +
            "identifiers that are required for API access. Include token values, not parameter names.",
        },
        authenticationParameters: {
          type: "array",
          items: { type: "string" },
          description:
            "Parameter names (keys) that appear to carry authentication information such as sessionId, " +
            "juristkn, authToken, csrf_token, etc.",
        },
        confidence: {
          type: "number",
          description:
            "Confidence level (0-1) in the session token identification",
        },
        analysis: {
          type: "string",
          description:
            "Brief explanation of the authentication pattern detected",
        },
      },
      required: [
        "potentialSessionTokens",
        "authenticationParameters",
        "confidence",
        "analysis",
      ],
    },
  };
}

/**
 * Create prompt for session token analysis
 */
function createSessionTokenAnalysisPrompt(
  requests: RequestModel[],
  sessionPatterns: SessionPattern[]
): string {
  const sampleRequests = requests.slice(0, 5).map((req) => ({
    url: req.url,
    method: req.method,
    headers: req.headers ? Object.keys(req.headers).slice(0, 5) : [],
  }));

  const patternSummary = sessionPatterns.slice(0, 10).map((p) => ({
    parameter: p.parameter,
    value: p.value.length > 50 ? `${p.value.substring(0, 50)}...` : p.value,
    occurrences: p.occurrences,
    consistency: `${Math.round(p.consistency * 100)}%`,
    isAuth: p.isAuthenticationRelated,
  }));

  return `Analyze the following request patterns to identify session tokens and authentication parameters:

Request Summary (${requests.length} total requests):
${JSON.stringify(sampleRequests, null, 2)}

Detected Patterns:
${JSON.stringify(patternSummary, null, 2)}

Task: Identify which parameter values are likely session tokens or authentication tokens that:
1. Appear consistently across multiple requests (not user input)
2. Are required for API access (would cause 401/403 if missing/invalid)
3. Are established during application bootstrap or initial authentication
4. Include parameters like sessionId, tokens, csrf values, API keys, etc.

Focus on values that appear to be session-specific identifiers rather than user-controllable input data.
Pay special attention to parameters with names containing: session, token, auth, csrf, key, id, tkn.`;
}

/**
 * Check if a header name indicates authentication
 */
function isAuthenticationHeader(headerName: string): boolean {
  const authHeaders = [
    "authorization",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "x-xsrf-token",
    "x-session-token",
    "bearer",
    "api-key",
    "auth-token",
  ];

  return authHeaders.some((auth) => headerName.toLowerCase().includes(auth));
}

/**
 * Check if a cookie name indicates authentication
 */
function isAuthenticationCookie(cookieName: string): boolean {
  const authCookies = [
    "session",
    "sess",
    "auth",
    "token",
    "csrf",
    "xsrf",
    "jwt",
    "bearer",
  ];

  return authCookies.some((auth) => cookieName.toLowerCase().includes(auth));
}

/**
 * Check if a parameter name is likely authentication-related
 */
function isLikelyAuthenticationParameter(parameter: string): boolean {
  const authPatterns = [
    "session",
    "token",
    "auth",
    "csrf",
    "xsrf",
    "jwt",
    "key",
    "tkn",
    "bearer",
    "juris", // specific to the jurisprudencia case
    "api_key",
    "apikey",
  ];

  const lowerParam = parameter.toLowerCase();
  return authPatterns.some((pattern) => lowerParam.includes(pattern));
}

/**
 * Parse cookie header into key-value pairs
 */
function parseCookieHeader(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name && valueParts.length > 0) {
      cookies[name.trim()] = valueParts.join("=").trim();
    }
  }

  return cookies;
}
