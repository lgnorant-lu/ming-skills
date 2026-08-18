import { getLLMClient, type LLMClient } from "../core/LLMClient.js";
import type { FunctionDefinition } from "../core/providers/types.js";
import type {
  ClassifiedParameter,
  HarvestSession,
  ParameterClassification,
  RequestModel,
} from "../types/index.js";
import { HarvestError } from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";
import { findBootstrapDependencies } from "./DependencyAgent.js";

const logger = createComponentLogger("parameter-classification-agent");

/**
 * Domain-specific parameter patterns for enhanced classification
 */
const DOMAIN_PATTERN_LIBRARY = {
  // Session and authentication patterns
  session: {
    patterns: [
      /^(session|sess|sid)[-_]?id$/i,
      /^[a-f0-9]{8,32}$/i, // Hex session IDs
      /^session[-_]?[a-z0-9]+$/i,
      /^[a-z0-9]{16,}$/i, // Long alphanumeric sessions
    ],
    keywords: ["session", "sess", "sid", "sessionid"],
    weight: 15,
  },

  // API tokens and keys
  apiKey: {
    patterns: [
      /^(api[-_]?key|token|auth[-_]?token)$/i,
      /^[A-Z0-9]{20,}$/i, // Uppercase alphanumeric tokens
      /^[a-zA-Z0-9+/]{20,}={0,2}$/i, // Base64-like tokens
      /^pk_[a-zA-Z0-9]+$/i, // Stripe-style public keys
      /^sk_[a-zA-Z0-9]+$/i, // Stripe-style secret keys
    ],
    keywords: ["token", "key", "auth", "bearer", "juristkn"],
    weight: 20,
  },

  // CSRF and security tokens
  csrf: {
    patterns: [
      /^(csrf|xsrf)[-_]?token$/i,
      /^[a-f0-9]{16,}$/i, // Hex CSRF tokens
    ],
    keywords: ["csrf", "xsrf", "security"],
    weight: 18,
  },

  // Search and query parameters
  search: {
    patterns: [
      /^(text|query|search|term|keyword|q)$/i,
      /^(texto|consulta|pesquisa|buscar)$/i, // Portuguese
      /^.*[Ss]earch.*$/,
    ],
    keywords: [
      "search",
      "query",
      "text",
      "term",
      "texto",
      "pesquisa",
      "consulta",
    ],
    weight: 12,
  },

  // Pagination parameters
  pagination: {
    patterns: [
      /^(page|offset|limit|size|per[-_]?page)$/i,
      /^\d+$/i, // Pure numeric values
    ],
    keywords: ["page", "size", "limit", "offset", "per_page"],
    weight: 10,
  },

  // Date and time parameters
  dateTime: {
    patterns: [
      /^(date|time|start|end|from|to)[-_]?(inicio|fim|final)?$/i,
      /^\d{4}-\d{2}-\d{2}$/i, // ISO date format
      /^\d{10,13}$/i, // Unix timestamps
    ],
    keywords: [
      "date",
      "time",
      "start",
      "end",
      "from",
      "to",
      "inicio",
      "fim",
      "final",
    ],
    weight: 8,
  },

  // Geographic coordinates
  location: {
    patterns: [
      /^(lat|lng|latitude|longitude)$/i,
      /^[+-]?\d+\.?\d*$/i, // Decimal coordinates
    ],
    keywords: ["lat", "lng", "latitude", "longitude"],
    weight: 15,
  },

  // Legal domain specific (for jurisprudence systems)
  legal: {
    patterns: [
      /^(tribunal|acordao|decisao|processo|relator)[-_]?.*$/i,
      /^(case|court|judge|decision)[-_]?.*$/i,
    ],
    keywords: [
      "tribunal",
      "acordao",
      "decisao",
      "processo",
      "relator",
      "legal",
      "jurisprudencia",
    ],
    weight: 12,
  },

  // Filter parameters
  filter: {
    patterns: [/^(filter|filtro)[-_]?.*$/i, /^.*[-_]?(filter|filtro)$/i],
    keywords: ["filter", "filtro", "category", "type"],
    weight: 8,
  },
};

/**
 * LLM response schema for parameter classification
 */
interface ParameterClassificationResponse {
  classified_parameters: Array<{
    parameter_name: string;
    parameter_value: string;
    classification: ParameterClassification;
    confidence: number;
    reasoning: string;
    domain_context?: string;
  }>;
}

/**
 * Classify parameters in a request using hybrid approach
 */
export async function classifyParameters(
  request: RequestModel,
  session: HarvestSession,
  llmClient?: LLMClient
): Promise<ClassifiedParameter[]> {
  try {
    const client = llmClient || getLLMClient();

    // Extract all parameters from the request
    const allParameters = extractAllParameters(request);

    if (allParameters.length === 0) {
      logger.debug("No parameters found in request", { url: request.url });
      return [];
    }

    // Phase 1: Enhanced workflow-aware consistency analysis
    const consistencyResults = analyzeParameterConsistencyWithWorkflows(
      allParameters,
      session,
      request
    );

    // Phase 2: Heuristic analysis with consistency metrics
    const heuristicResults = analyzeParametersHeuristically(
      allParameters,
      request,
      session,
      consistencyResults
    );

    // Merge heuristic and consistency results
    const preliminaryResults = mergeAnalysisResults(
      heuristicResults,
      consistencyResults
    );

    // Phase 3: LLM refinement for uncertain cases
    const uncertainParameters = preliminaryResults.filter(
      (p) => p.confidence < 0.8
    );

    let llmResults: ClassifiedParameter[] = [];
    if (uncertainParameters.length > 0) {
      llmResults = await refineClassificationWithLLM(
        uncertainParameters,
        request,
        session,
        client
      );
    }

    // Phase 4: Bootstrap source detection for session constants
    const intermediateResults = combineClassificationResults(
      preliminaryResults,
      llmResults
    );

    const finalResults = await enrichWithBootstrapSources(
      intermediateResults,
      session
    );

    logger.info("Parameter classification complete", {
      totalParameters: allParameters.length,
      heuristicClassified: heuristicResults.length,
      llmRefined: llmResults.length,
      bootstrapEnriched: finalResults.filter((p) => p.metadata.bootstrapSource)
        .length,
      finalClassified: finalResults.length,
    });

    return finalResults;
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Parameter classification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "PARAMETER_CLASSIFICATION_FAILED",
      { originalError: error, requestUrl: request.url }
    );
  }
}

/**
 * Extract all parameters from a request (URL params, body params, headers)
 */
function extractAllParameters(request: RequestModel): Array<{
  name: string;
  value: string;
  location: "url" | "body" | "header";
}> {
  const parameters: Array<{
    name: string;
    value: string;
    location: "url" | "body" | "header";
  }> = [];

  // Extract URL parameters
  if (request.queryParams) {
    for (const [name, value] of Object.entries(request.queryParams)) {
      parameters.push({ name, value, location: "url" });
    }
  }

  // Extract body parameters (if JSON)
  if (request.body && typeof request.body === "object") {
    for (const [name, value] of Object.entries(request.body)) {
      if (typeof value === "string" || typeof value === "number") {
        parameters.push({ name, value: String(value), location: "body" });
      }
    }
  }

  // Extract relevant headers (skip standard browser headers)
  const relevantHeaders = [
    "authorization",
    "x-api-key",
    "x-auth-token",
    "cookie",
  ];
  for (const [name, value] of Object.entries(request.headers)) {
    if (relevantHeaders.some((header) => name.toLowerCase().includes(header))) {
      parameters.push({ name, value, location: "header" });
    }
  }

  return parameters;
}

/**
 * Analyze parameters using heuristic patterns
 */
function analyzeParametersHeuristically(
  parameters: Array<{ name: string; value: string; location: string }>,
  _request: RequestModel,
  _session: HarvestSession,
  consistencyResults?: Map<
    string,
    { occurrenceCount: number; totalRequests: number; consistencyScore: number }
  >
): ClassifiedParameter[] {
  const results: ClassifiedParameter[] = [];

  for (const param of parameters) {
    const consistency = consistencyResults?.get(param.name);
    const consistencyMetrics = consistency
      ? {
          consistencyScore: consistency.consistencyScore,
          occurrenceRate:
            consistency.occurrenceCount /
            Math.max(consistency.totalRequests, 1),
        }
      : undefined;

    const analysis = classifyParameterHeuristically(
      param.name,
      param.value,
      param.location,
      consistencyMetrics
    );

    results.push({
      name: param.name,
      value: param.value,
      classification: analysis.classification,
      confidence: analysis.confidence,
      source: "heuristic",
      metadata: {
        occurrenceCount: consistency?.occurrenceCount || 1,
        totalRequests: consistency?.totalRequests || 1,
        consistencyScore: consistency?.consistencyScore || 1.0,
        parameterPattern: analysis.pattern,
        domainContext: analysis.domainContext || "unknown",
      },
    });
  }

  return results;
}

/**
 * Classify a single parameter using heuristic patterns
 */
function classifyParameterHeuristically(
  name: string,
  value: string,
  location: string,
  consistencyMetrics?: { consistencyScore: number; occurrenceRate: number }
): {
  classification: ParameterClassification;
  confidence: number;
  pattern: string;
  domainContext?: string;
} {
  const nameLower = name.toLowerCase();
  const valueStr = String(value);

  // HIGH-PRIORITY RULE: Check consistency metrics first
  if (
    consistencyMetrics &&
    consistencyMetrics.consistencyScore > 0.9 &&
    consistencyMetrics.occurrenceRate > 0.5
  ) {
    // High confidence that this is a static or session constant
    if (
      nameLower.includes("session") ||
      nameLower.includes("token") ||
      nameLower.includes("juristkn")
    ) {
      return {
        classification: "sessionConstant",
        confidence: 0.95,
        pattern: "high_consistency_session",
        domainContext: "session",
      };
    }

    if (
      (nameLower === "latitude" && valueStr === "0") ||
      (nameLower === "longitude" && valueStr === "0") ||
      nameLower.includes("version") ||
      nameLower.includes("format")
    ) {
      return {
        classification: "staticConstant",
        confidence: 0.95,
        pattern: "high_consistency_static",
        domainContext: "configuration",
      };
    }

    // For other highly consistent parameters, prefer static or session constant over dynamic
    return {
      classification: "staticConstant",
      confidence: 0.9,
      pattern: "high_consistency_generic",
      domainContext: "static",
    };
  }

  // Check against domain patterns
  for (const [domain, config] of Object.entries(DOMAIN_PATTERN_LIBRARY)) {
    // Check name patterns
    for (const pattern of config.patterns) {
      if (pattern.test(nameLower) || pattern.test(valueStr)) {
        return classifyByDomain(domain, config.weight);
      }
    }

    // Check keywords
    for (const keyword of config.keywords) {
      if (nameLower.includes(keyword)) {
        return classifyByDomain(domain, config.weight);
      }
    }
  }

  // Static analysis based on location and common patterns
  if (location === "header") {
    if (
      nameLower.includes("auth") ||
      nameLower.includes("token") ||
      nameLower.includes("key")
    ) {
      return {
        classification: "sessionConstant",
        confidence: 0.8,
        pattern: "auth_header",
        domainContext: "authentication",
      };
    }
  }

  if (location === "url") {
    // Common pagination parameters
    if (["page", "size", "limit", "offset"].includes(nameLower)) {
      return {
        classification: "userInput",
        confidence: 0.9,
        pattern: "pagination",
        domainContext: "pagination",
      };
    }

    // Search-like parameters
    if (["q", "query", "search", "text", "texto", "term"].includes(nameLower)) {
      return {
        classification: "userInput",
        confidence: 0.95,
        pattern: "search_query",
        domainContext: "search",
      };
    }

    // Static coordinates or configuration
    if (
      (nameLower === "latitude" && valueStr === "0") ||
      (nameLower === "longitude" && valueStr === "0")
    ) {
      return {
        classification: "staticConstant",
        confidence: 0.9,
        pattern: "static_coordinate",
        domainContext: "location",
      };
    }
  }

  // Value-based analysis for unknown parameter names
  if (isSessionLikeValue(valueStr)) {
    return {
      classification: "sessionConstant",
      confidence: 0.7,
      pattern: "session_value",
      domainContext: "session",
    };
  }

  if (isDateLikeValue(valueStr)) {
    return {
      classification: "userInput",
      confidence: 0.8,
      pattern: "date_value",
      domainContext: "datetime",
    };
  }

  // Default classification for unknown parameters
  return {
    classification: "userInput",
    confidence: 0.4,
    pattern: "unknown",
    domainContext: "unknown",
  };
}

/**
 * Map domain to classification
 */
function classifyByDomain(
  domain: string,
  weight: number
): {
  classification: ParameterClassification;
  confidence: number;
  pattern: string;
  domainContext: string;
} {
  const confidence = Math.min(weight / 20, 0.95); // Convert weight to confidence

  switch (domain) {
    case "session":
    case "apiKey":
    case "csrf":
      return {
        classification: "sessionConstant",
        confidence,
        pattern: domain,
        domainContext: domain,
      };

    case "search":
    case "pagination":
    case "dateTime":
    case "legal":
    case "filter":
      return {
        classification: "userInput",
        confidence,
        pattern: domain,
        domainContext: domain,
      };

    case "location":
      // Special case: static coordinates are often constants
      return {
        classification: "staticConstant",
        confidence,
        pattern: domain,
        domainContext: domain,
      };

    default:
      return {
        classification: "userInput",
        confidence: 0.5,
        pattern: domain,
        domainContext: domain,
      };
  }
}

/**
 * Check if a value looks like a session identifier
 */
function isSessionLikeValue(value: string): boolean {
  const sessionPatterns = [
    /^[a-f0-9]{8,32}$/i, // Hex values
    /^[a-zA-Z0-9]{16,}$/i, // Long alphanumeric
    /^sess_[a-zA-Z0-9]+$/i, // Session prefixed
  ];

  return sessionPatterns.some((pattern) => pattern.test(value));
}

/**
 * Check if a value looks like a date/time
 */
function isDateLikeValue(value: string): boolean {
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/i, // ISO date
    /^\d{10,13}$/i, // Unix timestamp
    /^\d{2}\/\d{2}\/\d{4}$/i, // US date format
  ];

  return datePatterns.some((pattern) => pattern.test(value));
}

/**
 * Analyze parameter consistency across all requests in the session
 */
function analyzeParameterConsistency(
  parameters: Array<{ name: string; value: string; location: string }>,
  session: HarvestSession
): Map<
  string,
  { occurrenceCount: number; totalRequests: number; consistencyScore: number }
> {
  const consistencyMap = new Map<
    string,
    { occurrenceCount: number; totalRequests: number; consistencyScore: number }
  >();

  // Extract all parameters from all requests in the session
  const allSessionParameters = new Map<string, Map<string, number>>();
  const totalRequests = session.harData?.requests?.length || 0;

  if (totalRequests === 0 || !session.harData?.requests) {
    // Fallback to basic data if no session data available
    for (const param of parameters) {
      consistencyMap.set(param.name, {
        occurrenceCount: 1,
        totalRequests: 1,
        consistencyScore: 1.0,
      });
    }
    return consistencyMap;
  }

  // Analyze all requests in the session to build parameter frequency maps
  for (const request of session.harData.requests) {
    const requestParams = extractAllParameters(request);

    for (const param of requestParams) {
      if (!allSessionParameters.has(param.name)) {
        allSessionParameters.set(param.name, new Map<string, number>());
      }

      const valueMap = allSessionParameters.get(param.name);
      if (!valueMap) {
        continue;
      }
      const currentCount = valueMap.get(param.value) || 0;
      valueMap.set(param.value, currentCount + 1);
    }
  }

  // Calculate consistency metrics for each parameter
  for (const param of parameters) {
    const valueMap = allSessionParameters.get(param.name);

    if (!valueMap) {
      // Parameter not found in session analysis, assume single occurrence
      consistencyMap.set(param.name, {
        occurrenceCount: 1,
        totalRequests: 1,
        consistencyScore: 1.0,
      });
      continue;
    }

    // Calculate metrics based on value frequency
    const paramValueCount = valueMap.get(param.value) || 0;
    const totalOccurrences = Array.from(valueMap.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const uniqueValues = valueMap.size;

    // Consistency score: 1.0 means always the same value, 0.0 means always different
    const consistencyScore =
      uniqueValues === 1 ? 1.0 : paramValueCount / totalOccurrences;

    consistencyMap.set(param.name, {
      occurrenceCount: paramValueCount,
      totalRequests: totalOccurrences,
      consistencyScore: consistencyScore,
    });

    logger.debug("Parameter consistency analysis", {
      parameterName: param.name,
      parameterValue: param.value,
      occurrenceCount: paramValueCount,
      totalOccurrences: totalOccurrences,
      uniqueValues: uniqueValues,
      consistencyScore: consistencyScore,
    });
  }

  return consistencyMap;
}

/**
 * Enhanced workflow-aware parameter consistency analysis
 * This considers workflow context to improve classification accuracy
 */
function analyzeParameterConsistencyWithWorkflows(
  parameters: Array<{ name: string; value: string; location: string }>,
  session: HarvestSession,
  currentRequest: RequestModel
): Map<
  string,
  {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number;
    workflowContext?: {
      workflowId?: string;
      workflowRequests: number;
      crossWorkflowConsistency: number;
      workflowSpecific: boolean;
    };
  }
> {
  // First, get basic consistency results
  const basicConsistency = analyzeParameterConsistency(parameters, session);

  // If no workflow groups available, return basic results with empty workflow context
  if (
    !session.state.workflowGroups ||
    session.state.workflowGroups.size === 0
  ) {
    const enhancedResults = new Map();
    for (const [key, value] of basicConsistency) {
      enhancedResults.set(key, {
        ...value,
        workflowContext: {
          workflowRequests: 0,
          crossWorkflowConsistency: 0,
          workflowSpecific: false,
        },
      });
    }
    return enhancedResults;
  }

  // Find which workflow this request belongs to
  const currentRequestKey = `${currentRequest.method.toUpperCase()}:${currentRequest.url}`;
  let currentWorkflowId: string | undefined;

  for (const [workflowId, workflow] of session.state.workflowGroups) {
    if (workflow.nodeIds.has(currentRequestKey)) {
      currentWorkflowId = workflowId;
      break;
    }
  }

  const enhancedResults = new Map();

  for (const param of parameters) {
    const basicResult = basicConsistency.get(param.name);
    if (!basicResult) {
      continue;
    }

    let workflowContext = {
      workflowId: currentWorkflowId,
      workflowRequests: 0,
      crossWorkflowConsistency: 0,
      workflowSpecific: false,
    };

    if (currentWorkflowId) {
      const currentWorkflow =
        session.state.workflowGroups.get(currentWorkflowId);
      if (currentWorkflow) {
        // Analyze parameter usage within this specific workflow
        const workflowAnalysis = analyzeParameterInWorkflow(
          param,
          currentWorkflow,
          session
        );

        workflowContext = {
          workflowId: currentWorkflowId,
          workflowRequests: workflowAnalysis.workflowRequests,
          crossWorkflowConsistency: workflowAnalysis.crossWorkflowConsistency,
          workflowSpecific: workflowAnalysis.isWorkflowSpecific,
        };
      }
    }

    enhancedResults.set(param.name, {
      ...basicResult,
      workflowContext,
    });

    logger.debug("Workflow-aware parameter analysis", {
      parameterName: param.name,
      workflowId: currentWorkflowId,
      workflowSpecific: workflowContext.workflowSpecific,
      crossWorkflowConsistency: workflowContext.crossWorkflowConsistency,
    });
  }

  return enhancedResults;
}

/**
 * Analyze how a parameter behaves within a specific workflow
 */
function analyzeParameterInWorkflow(
  parameter: { name: string; value: string; location: string },
  workflow: import("../types/index.js").WorkflowGroup,
  session: HarvestSession
): {
  workflowRequests: number;
  crossWorkflowConsistency: number;
  isWorkflowSpecific: boolean;
} {
  let workflowRequests = 0;
  let totalWorkflowOccurrences = 0;
  let crossWorkflowOccurrences = 0;
  let totalSessionOccurrences = 0;

  // Count parameter usage within this workflow
  for (const nodeId of workflow.nodeIds) {
    // Find requests matching this workflow node
    const matchingRequests = session.harData.requests.filter(
      (req) => `${req.method.toUpperCase()}:${req.url}` === nodeId
    );

    for (const request of matchingRequests) {
      workflowRequests++;
      const requestParams = extractAllParameters(request);

      const hasParameter = requestParams.some(
        (p) => p.name === parameter.name && p.value === parameter.value
      );

      if (hasParameter) {
        totalWorkflowOccurrences++;
      }
    }
  }

  // Count parameter usage across all workflows
  for (const request of session.harData.requests) {
    const requestParams = extractAllParameters(request);
    const hasParameter = requestParams.some(
      (p) => p.name === parameter.name && p.value === parameter.value
    );

    if (hasParameter) {
      totalSessionOccurrences++;

      // Check if this request belongs to a different workflow
      const requestKey = `${request.method.toUpperCase()}:${request.url}`;
      const belongsToCurrentWorkflow = workflow.nodeIds.has(requestKey);

      if (!belongsToCurrentWorkflow) {
        crossWorkflowOccurrences++;
      }
    }
  }

  // Calculate cross-workflow consistency
  const crossWorkflowConsistency =
    totalSessionOccurrences > 0
      ? (totalSessionOccurrences - crossWorkflowOccurrences) /
        totalSessionOccurrences
      : 0;

  // Determine if parameter is workflow-specific
  const isWorkflowSpecific =
    crossWorkflowOccurrences === 0 && totalWorkflowOccurrences > 0;

  return {
    workflowRequests,
    crossWorkflowConsistency,
    isWorkflowSpecific,
  };
}

/**
 * Update parameter metadata with consistency information
 */
function updateMetadataWithConsistency(
  result: ClassifiedParameter,
  consistency: {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number;
    workflowContext?: {
      workflowId?: string;
      workflowRequests: number;
      crossWorkflowConsistency: number;
      workflowSpecific: boolean;
    };
  }
): void {
  result.metadata.occurrenceCount = consistency.occurrenceCount;
  result.metadata.totalRequests = consistency.totalRequests;
  result.metadata.consistencyScore = consistency.consistencyScore;
}

/**
 * Apply workflow-aware classification logic
 */
function applyWorkflowAwareClassification(
  result: ClassifiedParameter,
  consistency: {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number;
    workflowContext?: {
      workflowId?: string;
      workflowRequests: number;
      crossWorkflowConsistency: number;
      workflowSpecific: boolean;
    };
  }
): void {
  const workflowContext = consistency.workflowContext;

  if (consistency.consistencyScore > 0.9 && consistency.totalRequests > 2) {
    const nameLower = result.name.toLowerCase();

    if (isWorkflowSpecificParameter(workflowContext)) {
      classifyAsWorkflowSpecificUserInput(result, workflowContext);
    } else if (isCrossWorkflowParameter(workflowContext)) {
      classifyAsCrossWorkflowParameter(result, workflowContext, nameLower);
    } else {
      applyLegacyClassification(result, consistency, nameLower);
    }

    applyStaticParameterClassification(result, consistency, nameLower);
    boostExistingClassificationConfidence(result);
  }
}

/**
 * Check if parameter is workflow-specific
 */
function isWorkflowSpecificParameter(workflowContext?: {
  workflowId?: string;
  workflowRequests: number;
  crossWorkflowConsistency: number;
  workflowSpecific: boolean;
}): boolean {
  return Boolean(
    workflowContext?.workflowSpecific &&
      workflowContext.crossWorkflowConsistency < 0.3
  );
}

/**
 * Check if parameter is consistent across workflows
 */
function isCrossWorkflowParameter(workflowContext?: {
  workflowId?: string;
  workflowRequests: number;
  crossWorkflowConsistency: number;
  workflowSpecific: boolean;
}): boolean {
  return Boolean(
    workflowContext && workflowContext.crossWorkflowConsistency > 0.8
  );
}

/**
 * Classify parameter as workflow-specific user input
 */
function classifyAsWorkflowSpecificUserInput(
  result: ClassifiedParameter,
  workflowContext:
    | {
        workflowId?: string;
        workflowRequests: number;
        crossWorkflowConsistency: number;
        workflowSpecific: boolean;
      }
    | undefined
): void {
  if (!workflowContext) {
    return;
  }
  result.classification = "userInput";
  result.confidence = Math.min(result.confidence + 0.2, 1.0);
  result.metadata.domainContext = `workflow-specific:${workflowContext.workflowId}`;

  logger.debug("Workflow-specific parameter classified as userInput", {
    parameterName: result.name,
    workflowId: workflowContext.workflowId,
    confidence: result.confidence,
  });
}

/**
 * Classify parameter as cross-workflow session parameter
 */
function classifyAsCrossWorkflowParameter(
  result: ClassifiedParameter,
  workflowContext:
    | {
        workflowId?: string;
        workflowRequests: number;
        crossWorkflowConsistency: number;
        workflowSpecific: boolean;
      }
    | undefined,
  nameLower: string
): void {
  if (!workflowContext) {
    return;
  }
  if (isSessionRelatedParameter(nameLower)) {
    result.classification = "sessionConstant";
    result.confidence = Math.min(result.confidence + 0.3, 1.0);
    result.metadata.domainContext = "cross-workflow-session";

    logger.debug("Cross-workflow parameter classified as sessionConstant", {
      parameterName: result.name,
      crossWorkflowConsistency: workflowContext.crossWorkflowConsistency,
      confidence: result.confidence,
    });
  }
}

/**
 * Apply legacy classification logic
 */
function applyLegacyClassification(
  result: ClassifiedParameter,
  consistency: {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number;
  },
  nameLower: string
): void {
  if (isSessionRelatedParameter(nameLower)) {
    result.classification = "sessionConstant";
    result.confidence = 0.95;
    result.source = "consistency_analysis";
    result.metadata.domainContext = "legacy-session";

    logger.info(
      "Parameter reclassified as sessionConstant due to high consistency",
      {
        parameterName: result.name,
        consistencyScore: consistency.consistencyScore,
        totalRequests: consistency.totalRequests,
      }
    );
  }
}

/**
 * Apply static parameter classification
 */
function applyStaticParameterClassification(
  result: ClassifiedParameter,
  consistency: {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number;
  },
  nameLower: string
): void {
  if (isStaticParameter(result, nameLower)) {
    result.classification = "staticConstant";
    result.confidence = 0.95;
    result.source = "consistency_analysis";

    logger.info(
      "Parameter reclassified as staticConstant due to high consistency",
      {
        parameterName: result.name,
        parameterValue: result.value,
        consistencyScore: consistency.consistencyScore,
      }
    );
  }
}

/**
 * Check if parameter is session-related
 */
function isSessionRelatedParameter(nameLower: string): boolean {
  return (
    nameLower.includes("session") ||
    nameLower.includes("token") ||
    nameLower.includes("juristkn") ||
    nameLower.includes("csrf")
  );
}

/**
 * Check if parameter is static
 */
function isStaticParameter(
  result: ClassifiedParameter,
  nameLower: string
): boolean {
  return (
    (nameLower === "latitude" && result.value === "0") ||
    (nameLower === "longitude" && result.value === "0") ||
    nameLower.includes("version") ||
    nameLower.includes("format")
  );
}

/**
 * Boost confidence for existing classifications
 */
function boostExistingClassificationConfidence(
  result: ClassifiedParameter
): void {
  if (
    result.classification === "sessionConstant" ||
    result.classification === "staticConstant"
  ) {
    result.confidence = Math.min(result.confidence + 0.2, 0.98);
  }
}

/**
 * Adjust confidence based on consistency scores
 */
function adjustConfidenceBasedOnConsistency(
  result: ClassifiedParameter,
  consistency: {
    consistencyScore: number;
  }
): void {
  if (consistency.consistencyScore < 0.5) {
    result.confidence *= 0.8; // Reduce confidence for inconsistent parameters
  } else if (consistency.consistencyScore > 0.8) {
    result.confidence = Math.min(result.confidence * 1.1, 0.95); // Boost confidence for consistent parameters
  }
}

/**
 * Merge heuristic and consistency analysis results with workflow awareness
 */
function mergeAnalysisResults(
  heuristicResults: ClassifiedParameter[],
  consistencyResults: Map<
    string,
    {
      occurrenceCount: number;
      totalRequests: number;
      consistencyScore: number;
      workflowContext?: {
        workflowId?: string;
        workflowRequests: number;
        crossWorkflowConsistency: number;
        workflowSpecific: boolean;
      };
    }
  >
): ClassifiedParameter[] {
  return heuristicResults.map((result) => {
    const consistency = consistencyResults.get(result.name);
    if (consistency) {
      updateMetadataWithConsistency(result, consistency);
      applyWorkflowAwareClassification(result, consistency);
      adjustConfidenceBasedOnConsistency(result, consistency);
    }
    return result;
  });
}

/**
 * Refine classification using LLM for uncertain parameters
 */
async function refineClassificationWithLLM(
  uncertainParameters: ClassifiedParameter[],
  request: RequestModel,
  session: HarvestSession,
  client: LLMClient
): Promise<ClassifiedParameter[]> {
  if (uncertainParameters.length === 0) {
    return [];
  }

  const functionDef = createLLMFunctionDefinition();
  const prompt = createLLMPrompt(uncertainParameters, request, session);

  const response = await client.callFunction<ParameterClassificationResponse>(
    prompt,
    functionDef,
    "classify_parameters"
  );

  return (response.classified_parameters || []).map((param) => ({
    name: param.parameter_name,
    value: param.parameter_value,
    classification: param.classification,
    confidence: Math.min(param.confidence, 0.95),
    source: "llm" as const,
    metadata: {
      occurrenceCount: 1,
      totalRequests: 1,
      consistencyScore: 1.0,
      parameterPattern: `llm_${param.classification}`,
      domainContext: param.domain_context || "llm_analysis",
    },
  }));
}

/**
 * Create LLM function definition for parameter classification
 */
function createLLMFunctionDefinition(): FunctionDefinition {
  return {
    name: "classify_parameters",
    description:
      "Classify HTTP request parameters into appropriate categories for code generation",
    parameters: {
      type: "object",
      properties: {
        classified_parameters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              parameter_name: {
                type: "string",
                description: "The parameter name",
              },
              parameter_value: {
                type: "string",
                description: "The parameter value",
              },
              classification: {
                type: "string",
                enum: [
                  "dynamic",
                  "sessionConstant",
                  "userInput",
                  "staticConstant",
                  "optional",
                ],
                description: "Classification type",
              },
              confidence: {
                type: "number",
                description: "Confidence in classification (0-1)",
              },
              reasoning: {
                type: "string",
                description: "Brief explanation of classification reasoning",
              },
              domain_context: {
                type: "string",
                description: "Domain context (auth, pagination, search, etc.)",
              },
            },
            // Note: required field is removed as it's not supported in this schema format
          },
        },
      },
      required: ["classified_parameters"],
    },
  };
}

/**
 * Create LLM prompt for parameter classification
 */
function createLLMPrompt(
  uncertainParameters: ClassifiedParameter[],
  request: RequestModel,
  session: HarvestSession
): string {
  const parameterList = uncertainParameters
    .map(
      (p) =>
        `- ${p.name}: "${p.value}" (current: ${p.classification}, confidence: ${p.confidence})`
    )
    .join("\n");

  return `Request: ${request.method} ${request.url}
User Prompt: ${session.prompt}

Parameters to classify:
${parameterList}

Classification Guidelines:
- dynamic: Value must be resolved from a previous API response (e.g., extracted IDs, tokens from login)
- sessionConstant: Session-scoped constant that doesn't change during the session (e.g., sessionId, CSRF tokens, API keys)
- userInput: User-provided parameter that should be configurable (e.g., search terms, page numbers, dates)
- staticConstant: Hardcoded application constant (e.g., latitude=0, longitude=0, fixed API versions)
- optional: Parameter can be omitted without breaking functionality

Context:
- This is a ${getDomainContext(request.url)} application
- Focus on generating practical, usable API client code
- Session constants should be handled automatically
- User inputs should be exposed as function parameters
- Static constants can be hardcoded

Classify each parameter with high confidence and provide clear reasoning.`;
}

/**
 * Get domain context from URL for better classification
 */
function getDomainContext(url: string): string {
  const urlLower = url.toLowerCase();

  if (
    urlLower.includes("jurisprudencia") ||
    urlLower.includes("legal") ||
    urlLower.includes("tribunal")
  ) {
    return "legal/jurisprudence";
  }
  if (
    urlLower.includes("ecommerce") ||
    urlLower.includes("shop") ||
    urlLower.includes("cart")
  ) {
    return "e-commerce";
  }
  if (urlLower.includes("api")) {
    return "REST API";
  }

  return "web application";
}

/**
 * Combine heuristic and LLM classification results
 */
function combineClassificationResults(
  preliminaryResults: ClassifiedParameter[],
  llmResults: ClassifiedParameter[]
): ClassifiedParameter[] {
  const combined = [...preliminaryResults];

  // Replace preliminary results with LLM results where available
  for (const llmResult of llmResults) {
    const index = combined.findIndex((p) => p.name === llmResult.name);
    if (index >= 0) {
      combined[index] = llmResult;
    }
  }

  return combined;
}

/**
 * Enrich session constant parameters with bootstrap source information
 */
async function enrichWithBootstrapSources(
  classifiedParameters: ClassifiedParameter[],
  session: HarvestSession
): Promise<ClassifiedParameter[]> {
  try {
    // Find parameters classified as sessionConstant
    const sessionConstants = classifiedParameters.filter(
      (p) => p.classification === "sessionConstant"
    );

    if (sessionConstants.length === 0) {
      logger.debug(
        "No session constants found, skipping bootstrap source detection"
      );
      return classifiedParameters;
    }

    // Extract parameter values for bootstrap dependency analysis
    const sessionConstantValues = sessionConstants.map((p) => p.value);

    logger.debug("Analyzing bootstrap sources for session constants", {
      parameterCount: sessionConstants.length,
      values: sessionConstantValues,
    });

    // Find bootstrap sources using DependencyAgent
    const bootstrapSources = await findBootstrapDependencies(
      sessionConstantValues,
      session.harData
    );

    // Enrich parameters with bootstrap source information
    const enrichedParameters = classifiedParameters.map((param) => {
      if (param.classification === "sessionConstant") {
        const bootstrapSource = bootstrapSources.get(param.value);

        if (bootstrapSource) {
          logger.debug("Found bootstrap source for parameter", {
            parameter: param.name,
            value: param.value,
            sourceType: bootstrapSource.type,
            sourceUrl: bootstrapSource.sourceUrl,
          });

          return {
            ...param,
            confidence: Math.min(param.confidence + 0.1, 1.0), // Boost confidence
            metadata: {
              ...param.metadata,
              bootstrapSource,
              requiresBootstrap: true,
              domainContext:
                param.metadata.domainContext || "session_bootstrap",
            },
          };
        }
        logger.warn("No bootstrap source found for session constant", {
          parameter: param.name,
          value: param.value,
        });

        return {
          ...param,
          metadata: {
            ...param.metadata,
            requiresBootstrap: true,
            domainContext: param.metadata.domainContext || "session_unresolved",
          },
        };
      }

      return param;
    });

    const enrichedCount = enrichedParameters.filter(
      (p) => p.metadata.bootstrapSource
    ).length;

    logger.info("Bootstrap source enrichment complete", {
      sessionConstants: sessionConstants.length,
      bootstrapSourcesFound: bootstrapSources.size,
      parametersEnriched: enrichedCount,
    });

    return enrichedParameters;
  } catch (error) {
    logger.error("Bootstrap source enrichment failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Return original parameters if bootstrap enrichment fails
    return classifiedParameters;
  }
}
