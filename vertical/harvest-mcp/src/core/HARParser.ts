import { readFile } from "node:fs/promises";
import type {
  Har,
  Header as HarHeader,
  PostData as HarPostData,
  QueryString as HarQueryString,
  Request as HarRequest,
  Response as HarResponse,
} from "har-format";
import { analyzeAuthentication as analyzeAuthenticationAgent } from "../agents/AuthenticationAgent.js";
import { Request } from "../models/Request.js";
import type {
  AuthenticationAnalysis,
  HarvestSession,
  ParsedHARData,
  RequestModel,
  ResponseData,
  URLInfo,
} from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";
import { expandTilde } from "../utils/pathUtils.js";

const logger = createComponentLogger("har-parser");

/**
 * Create an empty AuthenticationAnalysis object
 */
function createEmptyAuthAnalysis(
  recommendations: string[] = []
): AuthenticationAnalysis {
  return {
    hasAuthentication: false,
    primaryAuthType: "none",
    authTypes: [],
    authenticatedRequests: [],
    unauthenticatedRequests: [],
    failedAuthRequests: [],
    tokens: [],
    tokenLifecycle: {
      isStatic: false,
    },
    authEndpoints: [],
    authFlow: {
      hasLoginFlow: false,
      hasRefreshFlow: false,
      hasLogoutFlow: false,
      flowComplexity: "simple",
    },
    securityIssues: [],
    recommendations,
    codeGeneration: {
      isReady: false,
      requiredSetup: [],
      supportedPatterns: [],
      hardcodedTokens: [],
      dynamicTokens: [],
    },
  };
}

// Default keywords to exclude from requests (analytics, tracking, etc.)
const DEFAULT_EXCLUDED_KEYWORDS = [
  "google",
  "taboola",
  "datadog",
  "sentry",
  "facebook",
  "twitter",
  "linkedin",
  "amplitude",
  "mixpanel",
  "segment",
  "heap",
  "hotjar",
  "fullstory",
  "pendo",
  "optimizely",
  "adobe",
  "analytics",
  "tracking",
  "telemetry",
  "clarity",
  "matomo",
  "plausible",
];

// Configuration interface for HAR parsing
export interface HARParsingOptions {
  excludeKeywords?: string[];
  includeAllApiRequests?: boolean;
  minQualityThreshold?: "excellent" | "good" | "poor";
  preserveAnalyticsRequests?: boolean;
  customFilters?: Array<(url: string) => boolean>;
}

// Headers to exclude from request processing
// NOTE: Authentication headers (Authorization, X-API-Key, etc.) and cookies are preserved
const EXCLUDED_HEADER_KEYWORDS = [
  "sec-",
  "accept",
  "user-agent",
  "referer",
  "relic",
  "sentry",
  "datadog",
  "amplitude",
  "mixpanel",
  "segment",
  "heap",
  "hotjar",
  "fullstory",
  "pendo",
  "optimizely",
  "adobe",
  "analytics",
  "tracking",
  "telemetry",
  "clarity",
  "matomo",
  "plausible",
];

// Authentication-related headers that should ALWAYS be preserved
const AUTHENTICATION_HEADERS = [
  "authorization",
  "cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-requested-with",
];

/**
 * Check if a request is an API request based on URL patterns and headers
 */
function isApiRequest(request: HarRequest, response: HarResponse): boolean {
  return (
    request.url.includes("/api/") ||
    request.url.includes("/v1/") ||
    request.url.includes("/v2/") ||
    response?.headers?.some(
      (h: HarHeader) =>
        h.name?.toLowerCase() === "content-type" &&
        h.value?.includes("application/json")
    )
  );
}

/**
 * Check if a request is a modifying operation (POST, PUT, DELETE, PATCH)
 */
function isModifyingRequest(request: HarRequest): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(
    request.method?.toUpperCase() || ""
  );
}

interface HARStats {
  totalEntries: number;
  relevantEntries: number;
  apiRequests: number;
  postRequests: number;
  responsesWithContent: number;
  authRequests: number;
  tokenRequests: number;
  authErrors: number;
}

/**
 * Assess quality based on captured statistics with authentication awareness
 */
function assessQuality(
  stats: HARStats,
  authErrors: number
): "excellent" | "good" | "poor" | "empty" {
  if (stats.relevantEntries === 0) {
    return "empty";
  }

  // Downgrade quality if there are authentication errors
  if (authErrors > 0) {
    return "poor";
  }

  // Maintain excellent if we have good API coverage
  if (stats.apiRequests >= 3 || stats.postRequests >= 2) {
    return "excellent";
  }

  if (stats.relevantEntries >= 5 || stats.apiRequests >= 1) {
    return "good";
  }

  return "poor";
}

/**
 * Add quality-specific recommendations
 */
function addQualityRecommendations(
  quality: string,
  _stats: HARStats,
  issues: string[],
  recommendations: string[]
): void {
  if (quality === "empty") {
    issues.push(
      "No relevant network requests found (only tracking/analytics requests)"
    );
    recommendations.push(
      "Try interacting more with the website's main functionality"
    );
    recommendations.push(
      "Look for forms to submit, buttons to click, or data to load"
    );
  } else if (quality === "poor") {
    issues.push("Very few meaningful requests captured");
    recommendations.push(
      "Try to capture more interactions like form submissions or data loading"
    );
    recommendations.push(
      "Ensure you complete the full workflow you want to automate"
    );
  }
}

/**
 * Add specific recommendations based on request analysis
 */
function addSpecificRecommendations(
  stats: HARStats,
  quality: string,
  recommendations: string[]
): void {
  if (stats.apiRequests === 0 && quality !== "empty") {
    recommendations.push(
      "No API requests detected - try looking for data loading or AJAX calls"
    );
  }

  if (stats.postRequests === 0 && quality !== "empty") {
    recommendations.push(
      "No POST requests found - try submitting forms or creating/updating data"
    );
  }

  if (stats.responsesWithContent === 0 && quality !== "empty") {
    recommendations.push(
      "No response content captured - check if responses contain meaningful data"
    );
  }
}

/**
 * Create a temporary session object for authentication analysis
 * This allows the AuthenticationAgent to work with raw HAR data
 */
function createTemporarySessionForAuth(
  entries: Array<{ request: unknown; response: unknown }>
): HarvestSession {
  // Convert HAR entries to RequestModel format for the agent
  const requests: RequestModel[] = [];

  for (const entry of entries) {
    try {
      const request = entry.request as {
        url?: string;
        method?: string;
        headers?: unknown;
        queryString?: unknown;
        postData?: { text?: string };
      };

      if (!request?.url || !request?.method) {
        continue;
      }

      // Create a simplified RequestModel for auth analysis
      const requestModel: RequestModel = {
        url: request.url,
        method: request.method.toUpperCase(),
        headers: parseRequestHeaders(request.headers as never),
        queryParams: parseQueryParams(
          request.queryString as never,
          request.url
        ),
        body: request.postData?.text || null,
        timestamp: new Date(),
        toCurlCommand: () =>
          `curl -X ${request.method?.toUpperCase() || "GET"} "${request.url}"`,
      };

      requests.push(requestModel);
    } catch (_error) {
      // Skip invalid entries - they're likely malformed HAR data
    }
  }

  // Create minimal session structure
  return {
    id: "temp-auth-session",
    prompt: "Authentication analysis",
    dagManager: {} as never, // Minimal DAG manager for auth analysis
    harData: {
      requests,
      urls: [],
      validation: {
        isValid: true,
        quality: "good" as const,
        issues: [],
        recommendations: [],
        stats: {
          totalEntries: entries.length,
          relevantEntries: requests.length,
          apiRequests: requests.length,
          postRequests: requests.filter((r) => r.method === "POST").length,
          responsesWithContent: 0,
          authRequests: 0,
          tokenRequests: 0,
          authErrors: 0,
        },
        authAnalysis: createEmptyAuthAnalysis(),
      },
    },
    state: {
      logs: [],
      toBeProcessedNodes: [],
      inputVariables: {},
      isComplete: false,
      inProcessNodeDynamicParts: [],
      workflowGroups: new Map(),
    },
    createdAt: new Date(),
    lastActivity: new Date(),
  };
}

/**
 * Validate HAR file content quality and provide actionable feedback
 */
export async function validateHARContent(
  harData: Har,
  options?: HARParsingOptions
): Promise<{
  isValid: boolean;
  quality: "excellent" | "good" | "poor" | "empty";
  issues: string[];
  recommendations: string[];
  stats: {
    totalEntries: number;
    relevantEntries: number;
    apiRequests: number;
    postRequests: number;
    responsesWithContent: number;
    authRequests: number;
    tokenRequests: number;
    authErrors: number;
  };
  authAnalysis: AuthenticationAnalysis;
}> {
  const issues: string[] = [];
  const recommendations: string[] = [];
  const entries = harData.log?.entries || [];

  const stats = {
    totalEntries: entries.length,
    relevantEntries: 0,
    apiRequests: 0,
    postRequests: 0,
    responsesWithContent: 0,
    authRequests: 0,
    tokenRequests: 0,
    authErrors: 0,
  };

  // Basic structure validation
  if (!harData.log) {
    issues.push("HAR file is missing 'log' property");
    const emptyAuthAnalysis = createEmptyAuthAnalysis([
      "Please ensure you're exporting a valid HAR file from browser dev tools",
    ]);
    return {
      isValid: false,
      quality: "empty",
      issues,
      recommendations: [
        "Please ensure you're exporting a valid HAR file from browser dev tools",
      ],
      stats,
      authAnalysis: emptyAuthAnalysis,
    };
  }

  if (entries.length === 0) {
    issues.push("HAR file contains no network requests");
    recommendations.push(
      "Ensure you interact with the website to generate network traffic before exporting HAR"
    );
    recommendations.push(
      "Check that network recording was enabled in browser dev tools"
    );
    const emptyAuthAnalysis = createEmptyAuthAnalysis();
    return {
      isValid: false,
      quality: "empty",
      issues,
      recommendations,
      stats,
      authAnalysis: emptyAuthAnalysis,
    };
  }

  // Analyze request quality
  for (const entry of entries) {
    const request = entry.request;
    const response = entry.response;

    if (!request?.url) {
      continue;
    }

    // Skip excluded requests for quality analysis
    if (shouldExcludeRequest(request.url, options)) {
      continue;
    }

    stats.relevantEntries++;

    // Check for API-like requests
    if (isApiRequest(request, response)) {
      stats.apiRequests++;
    }

    // Check for POST/PUT/DELETE requests (more likely to be meaningful)
    if (isModifyingRequest(request)) {
      stats.postRequests++;
    }

    // Check for responses with meaningful content
    if (response?.content?.text && response.content.text.length > 0) {
      stats.responsesWithContent++;
    }

    // Check for authentication-related requests
    if (
      request.headers?.some((h: unknown) => {
        if (!h || typeof h !== "object") {
          return false;
        }
        const headerObj = h as { name?: string };
        const name = headerObj.name?.toLowerCase();
        return (
          name === "authorization" ||
          name === "cookie" ||
          name?.includes("api-key")
        );
      })
    ) {
      stats.authRequests++;
    }

    // Check for token-like parameters in URL
    if (request.url?.match(/[?&](token|api[_-]?key|auth)=/)) {
      stats.tokenRequests++;
    }

    // Check for authentication errors
    if (response?.status === 401 || response?.status === 403) {
      stats.authErrors++;
    }
  }

  // Perform authentication analysis using AuthenticationAgent
  let authAnalysis: AuthenticationAnalysis;

  try {
    // Create a temporary session for authentication analysis
    const tempSession = createTemporarySessionForAuth(entries);
    authAnalysis = await analyzeAuthenticationAgent(tempSession);

    logger.debug("Authentication analysis completed", {
      hasAuthentication: authAnalysis.hasAuthentication,
      primaryAuthType: authAnalysis.primaryAuthType,
      authTypesCount: authAnalysis.authTypes.length,
      authenticatedRequestsCount: authAnalysis.authenticatedRequests.length,
      failedAuthRequestsCount: authAnalysis.failedAuthRequests.length,
    });
  } catch (error) {
    logger.warn("AuthenticationAgent failed, using default analysis", {
      error: error instanceof Error ? error.message : "Unknown error",
      entriesCount: entries.length,
    });

    // Provide default analysis if agent fails
    authAnalysis = createEmptyAuthAnalysis([
      "Authentication analysis failed - review HAR file manually",
    ]);
  }

  // Quality assessment with authentication awareness
  const quality = assessQuality(stats, authAnalysis.failedAuthRequests.length);

  // Add quality-specific recommendations
  addQualityRecommendations(quality, stats, issues, recommendations);

  // Add specific recommendations based on findings
  addSpecificRecommendations(stats, quality, recommendations);

  // Add authentication-specific recommendations
  recommendations.push(...authAnalysis.recommendations);

  // Add authentication summary to recommendations if auth detected
  if (authAnalysis.hasAuthentication && authAnalysis.authTypes.length > 0) {
    recommendations.push(
      `Authentication detected: ${authAnalysis.authTypes.join(", ")}`
    );
  }

  return {
    isValid: stats.relevantEntries > 0,
    quality,
    issues,
    recommendations,
    stats,
    authAnalysis,
  };
}

/**
 * Parse a HAR file and extract relevant request data with validation
 */
export async function parseHARFile(
  harPath: string,
  options?: HARParsingOptions
): Promise<
  ParsedHARData & {
    validation: Awaited<ReturnType<typeof validateHARContent>>;
  }
> {
  try {
    // Expand tilde paths to absolute paths
    const expandedPath = expandTilde(harPath);
    const harContent = await readFile(expandedPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    // Validate HAR content quality
    const validation = await validateHARContent(harData, options);

    if (!harData.log || !harData.log.entries) {
      throw new Error("Invalid HAR file format: missing log.entries");
    }

    const entries = harData.log.entries;
    const requests: RequestModel[] = [];
    const urls: URLInfo[] = [];

    for (const entry of entries) {
      const request = entry.request;
      const response = entry.response;

      if (!request || !request.url) {
        continue;
      }

      // Filter out excluded requests
      if (shouldExcludeRequest(request.url, options)) {
        continue;
      }

      // Parse request with timestamp from entry
      const requestModel = formatRequest(request);

      // Add timestamp from entry
      if (entry.startedDateTime) {
        requestModel.timestamp = new Date(entry.startedDateTime);
      }

      // Add response data if available
      if (response) {
        requestModel.response = formatResponse(response);
      }

      requests.push(requestModel);

      // Extract URL info
      urls.push({
        method: request.method || "GET",
        url: request.url,
        requestType: getRequestType(request),
        responseType: getResponseType(response),
      });
    }

    // Filter and sort requests
    const filteredRequests = filterRequests(requests);

    return {
      requests: filteredRequests,
      urls: extractURLs(urls),
      validation,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse HAR file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Parse and filter request headers with authentication preservation
 */
function parseRequestHeaders(
  harHeaders: HarHeader[] | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of harHeaders || []) {
    const headerName = header.name?.toLowerCase() || "";

    // Always preserve authentication-related headers
    const isAuthHeader = AUTHENTICATION_HEADERS.some((authHeader) =>
      headerName.includes(authHeader.toLowerCase())
    );

    const shouldExclude =
      !isAuthHeader &&
      EXCLUDED_HEADER_KEYWORDS.some((keyword) =>
        headerName.includes(keyword.toLowerCase())
      );

    if (!shouldExclude && header.name && header.value) {
      headers[header.name] = header.value;
    }
  }
  return headers;
}

/**
 * Parse query string parameters from HAR queryString array or URL fallback
 */
function parseQueryParams(
  queryString: HarQueryString[] | undefined,
  url?: string
): Record<string, string> {
  const queryParams: Record<string, string> = {};

  // First, try to use the queryString array from HAR
  for (const param of queryString || []) {
    if (param.name && param.value !== undefined) {
      queryParams[param.name] = param.value;
    }
  }

  // If no parameters found and we have a URL, extract from URL directly
  if (Object.keys(queryParams).length === 0 && url) {
    try {
      const urlObj = new URL(url);
      for (const [name, value] of urlObj.searchParams) {
        queryParams[name] = value;
      }
    } catch (_error) {
      // URL parsing failed, ignore and return empty object
    }
  }

  return queryParams;
}

/**
 * Parse request body from postData
 */
function parseRequestBody(postData: HarPostData | undefined): unknown {
  if (!postData) {
    return undefined;
  }

  if (postData.text) {
    try {
      return JSON.parse(postData.text);
    } catch {
      return postData.text;
    }
  }

  if (postData.params) {
    const formData: Record<string, string> = {};
    for (const param of postData.params) {
      if (param.name && param.value !== undefined) {
        formData[param.name] = param.value;
      }
    }
    return formData;
  }

  return undefined;
}

/**
 * Format a HAR request into our RequestModel
 */
export function formatRequest(harRequest: HarRequest): RequestModel {
  const method = harRequest.method || "GET";
  const url = harRequest.url || "";
  const headers = parseRequestHeaders(harRequest.headers);
  const queryParams = parseQueryParams(harRequest.queryString, url);
  const body = parseRequestBody(harRequest.postData);

  return new Request(
    method as string,
    url as string,
    headers,
    Object.keys(queryParams).length > 0 ? queryParams : undefined,
    body
  );
}

/**
 * Format a HAR response into our ResponseData
 */
export function formatResponse(harResponse: HarResponse): ResponseData {
  const status = harResponse.status || 0;
  const statusText = harResponse.statusText || "";

  // Parse response headers
  const headers: Record<string, string> = {};
  for (const header of harResponse.headers || []) {
    if (header.name && header.value) {
      headers[header.name] = header.value;
    }
  }

  // Parse response content
  let text: string | undefined;
  let json: unknown;

  if (harResponse.content?.text) {
    text = harResponse.content.text;

    // Try to parse as JSON if content type suggests it
    const contentType =
      headers["content-type"] || headers["Content-Type"] || "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("text/json")
    ) {
      try {
        json = JSON.parse(text);
      } catch {
        // If JSON parsing fails, keep as text
      }
    }
  }

  const result: ResponseData = {
    status,
    statusText,
    headers,
  };

  if (text !== undefined) {
    result.text = text;
  }

  if (json !== undefined) {
    result.json = json;
  }

  return result;
}

/**
 * Filter requests to remove irrelevant ones
 */
export function filterRequests(
  requests: RequestModel[],
  options?: HARParsingOptions
): RequestModel[] {
  return requests.filter((request) => {
    // Filter by URL
    if (shouldExcludeRequest(request.url, options)) {
      return false;
    }

    // Filter by method (keep most HTTP methods, exclude OPTIONS preflight)
    if (request.method === "OPTIONS") {
      return false;
    }

    // Filter by content type (exclude images, stylesheets, etc.)
    const contentType =
      request.headers["content-type"] || request.headers["Content-Type"] || "";
    if (
      contentType.includes("image/") ||
      contentType.includes("text/css") ||
      contentType.includes("application/javascript") ||
      contentType.includes("font/")
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Extract and clean URL information
 */
export function extractURLs(
  urlInfos: URLInfo[],
  options?: HARParsingOptions
): URLInfo[] {
  // Remove duplicates and sort by relevance
  const uniqueUrls = new Map<string, URLInfo>();

  for (const urlInfo of urlInfos) {
    const key = `${urlInfo.method}:${urlInfo.url}`;
    if (!uniqueUrls.has(key)) {
      uniqueUrls.set(key, urlInfo);
    }
  }

  return Array.from(uniqueUrls.values())
    .filter((urlInfo) => !shouldExcludeRequest(urlInfo.url, options))
    .sort((a, b) => {
      // Prioritize API endpoints
      const aIsApi = a.url.includes("/api/") || a.responseType.includes("json");
      const bIsApi = b.url.includes("/api/") || b.responseType.includes("json");

      if (aIsApi && !bIsApi) {
        return -1;
      }
      if (!aIsApi && bIsApi) {
        return 1;
      }

      // Then prioritize POST/PUT/DELETE over GET
      const methodPriority = { POST: 0, PUT: 1, DELETE: 2, GET: 3 };
      const aPriority =
        methodPriority[a.method as keyof typeof methodPriority] ?? 4;
      const bPriority =
        methodPriority[b.method as keyof typeof methodPriority] ?? 4;

      return aPriority - bPriority;
    });
}

/**
 * Check if a request should be excluded based on URL and options
 */
function shouldExcludeRequest(
  url: string,
  options?: HARParsingOptions
): boolean {
  const lowerUrl = url.toLowerCase();

  // If preserveAnalyticsRequests is true, don't exclude anything
  if (options?.preserveAnalyticsRequests) {
    return false;
  }

  // If includeAllApiRequests is true, only exclude non-API requests
  if (options?.includeAllApiRequests) {
    const isApiRequest =
      lowerUrl.includes("/api/") ||
      lowerUrl.includes("/v1/") ||
      lowerUrl.includes("/v2/") ||
      lowerUrl.includes("/rest/") ||
      lowerUrl.includes("/graphql");
    if (isApiRequest) {
      return false; // Don't exclude API requests
    }
  }

  // Use custom filters if provided
  if (options?.customFilters) {
    const shouldExcludeByCustomFilters = options.customFilters.some((filter) =>
      filter(url)
    );
    if (shouldExcludeByCustomFilters) {
      return true;
    }
  }

  // Use configured exclude keywords or default
  const excludeKeywords = options?.excludeKeywords ?? DEFAULT_EXCLUDED_KEYWORDS;

  return excludeKeywords.some((keyword) =>
    lowerUrl.includes(keyword.toLowerCase())
  );
}

/**
 * Determine request type from request data
 */
function getRequestType(request: HarRequest): string {
  if (request.postData) {
    const contentType =
      (request.headers as Array<{ name: string; value: string }>)?.find(
        (h) => h.name?.toLowerCase() === "content-type"
      )?.value || "";

    if (contentType.includes("application/json")) {
      return "JSON";
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return "Form";
    }
    return "Data";
  }

  return "Query";
}

/**
 * Determine response type from response data
 */
function getResponseType(response: HarResponse | null): string {
  if (!response) {
    return "Unknown";
  }

  const contentType =
    (response.headers as Array<{ name: string; value: string }>)?.find(
      (h) => h.name?.toLowerCase() === "content-type"
    )?.value || "";

  if (contentType.includes("application/json")) {
    return "JSON";
  }
  if (contentType.includes("text/html")) {
    return "HTML";
  }
  if (contentType.includes("text/")) {
    return "Text";
  }
  return "Binary";
}
