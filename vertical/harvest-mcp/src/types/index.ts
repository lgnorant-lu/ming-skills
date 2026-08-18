import { z } from "zod";
import type { CompletedSessionManager } from "../core/CompletedSessionManager.js";
import type { SessionManager } from "../core/SessionManager.js";

// ========== Authentication Types ==========

/**
 * Supported authentication types
 */
export type AuthenticationType =
  | "bearer_token"
  | "api_key"
  | "basic_auth"
  | "session_cookie"
  | "oauth"
  | "custom_header"
  | "url_parameter"
  | "none";

/**
 * Authentication requirement levels
 */
export type AuthenticationRequirement = "required" | "optional" | "none";

/**
 * Token lifecycle information
 */
export interface TokenLifecycle {
  isStatic: boolean;
  expiresIn?: number;
  refreshEndpoint?: string;
  refreshMethod?: string;
  generationEndpoint?: string;
  generationMethod?: string;
  expirationPattern?: string;
}

/**
 * Authentication endpoint information
 */
export interface AuthenticationEndpoint {
  url: string;
  method: string;
  purpose: "login" | "refresh" | "logout" | "validate";
  request?: RequestModel;
  responseContainsToken?: boolean;
}

/**
 * Individual request authentication analysis
 */
export interface RequestAuthenticationInfo {
  requestId: string;
  url: string;
  method: string;
  authenticationType: AuthenticationType;
  requirement: AuthenticationRequirement;
  tokens: TokenInfo[];
  authHeaders: Record<string, string>;
  authCookies: Record<string, string>;
  authParams: Record<string, string>;
  isAuthFailure: boolean;
  authErrorDetails?: {
    status: number;
    statusText: string;
    wwwAuthenticate?: string;
    errorMessage?: string;
  };
}

/**
 * Token information extracted from requests
 */
export interface TokenInfo {
  type: "bearer" | "api_key" | "session" | "csrf" | "custom";
  location: "header" | "cookie" | "url_param" | "body";
  name: string;
  value: string;
  isExpired?: boolean;
  expiresAt?: Date;
  scope?: string[];
}

/**
 * Comprehensive authentication analysis result
 */
export interface AuthenticationAnalysis {
  // Overall authentication summary
  hasAuthentication: boolean;
  primaryAuthType: AuthenticationType;
  authTypes: AuthenticationType[];

  // Request-level analysis
  authenticatedRequests: RequestAuthenticationInfo[];
  unauthenticatedRequests: RequestAuthenticationInfo[];
  failedAuthRequests: RequestAuthenticationInfo[];

  // Token analysis
  tokens: TokenInfo[];
  tokenLifecycle: TokenLifecycle;

  // Authentication flow
  authEndpoints: AuthenticationEndpoint[];
  authFlow: {
    hasLoginFlow: boolean;
    hasRefreshFlow: boolean;
    hasLogoutFlow: boolean;
    flowComplexity: "simple" | "moderate" | "complex";
  };

  // Security concerns
  securityIssues: string[];
  recommendations: string[];

  // Code generation readiness
  codeGeneration: {
    isReady: boolean;
    requiredSetup: string[];
    supportedPatterns: string[];
    hardcodedTokens: string[];
    dynamicTokens: string[];
  };
}

// ========== Authentication Dependency Types ==========

/**
 * Enhanced authentication dependency information
 */
export interface AuthenticationDependency {
  type:
    | "session-token"
    | "api-key"
    | "bearer-token"
    | "csrf-token"
    | "cookie-auth";
  parameter: string;
  value: string;
  source?: "bootstrap" | "request" | "cookie" | "header";
  required: boolean;
  confidence: number;
}

/**
 * Session bootstrap analysis result
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

// ========== Parameter Classification Types ==========

/**
 * Parameter classification types for enhanced analysis
 */
export type ParameterClassification =
  | "dynamic" // Resolved from previous API response
  | "sessionConstant" // Session-scoped constant that must be dynamically fetched during bootstrap
  | "staticConstant" // Hardcoded application constant that remains the same across all sessions
  | "userInput" // User-provided parameter (search terms, IDs)
  | "optional"; // Can be omitted without breaking functionality

// ========== Bootstrap Parameter Types ==========

/**
 * Types of sources where bootstrap parameters can be found
 */
export type BootstrapSourceType =
  | "initial-page-html"
  | "initial-page-cookie"
  | "dedicated-auth-request";

/**
 * Source information for session bootstrap parameters
 */
export interface BootstrapParameterSource {
  type: BootstrapSourceType;
  // The URL of the request that provides the bootstrap parameter.
  sourceUrl: string;
  // Details on how to extract the value.
  extractionDetails: {
    // e.g., for 'initial-page-html', this could be a regex or CSS selector.
    pattern: string;
    // e.g., for 'initial-page-cookie', this is the cookie name.
    cookieName?: string;
    // e.g., for 'dedicated-auth-request', this is the JSON path.
    jsonPath?: string;
    // Indicates this is a synthetic source for testing/mid-session HAR captures
    syntheticSource?: boolean;
  };
}

/**
 * Classified parameter with metadata for analysis
 */
export interface ClassifiedParameter {
  name: string;
  value: string;
  classification: ParameterClassification;
  confidence: number;
  source: "heuristic" | "llm" | "manual" | "consistency_analysis";
  metadata: {
    occurrenceCount: number;
    totalRequests: number;
    consistencyScore: number; // 0-1, how consistent across requests
    parameterPattern: string; // regex pattern if detected
    domainContext?: string; // session, auth, pagination, etc.
    bootstrapSource?: BootstrapParameterSource; // Source for session bootstrap parameters
    requiresBootstrap?: boolean; // Whether this parameter requires bootstrap initialization
  };
}

// ========== Workflow Group Types ==========

/**
 * Represents a grouped set of related API operations forming a logical workflow
 */
export interface WorkflowGroup {
  /** Unique identifier (e.g., 'search-workflow', 'document-operations') */
  id: string;
  /** Human-readable name generated by LLM (e.g., 'Search Legal Decisions') */
  name: string;
  /** ID of the primary action node for this workflow */
  masterNodeId: string;
  /** Set of all node IDs belonging to this group */
  nodeIds: Set<string>;
  /** Brief summary of the workflow's purpose */
  description: string;
  /** Priority/importance of this workflow (higher = more important) */
  priority: number;
  /** Estimated complexity score based on parameter count and dependencies */
  complexity: number;
  /** Whether this workflow requires user input to execute */
  requiresUserInput: boolean;
  /** Functional category (e.g., 'search', 'crud', 'document_operations') */
  category: string;
}

// ========== Core Session Types ==========

export interface HarvestSession {
  id: string;
  prompt: string;
  harData: ParsedHARData;
  cookieData?: CookieData;
  dagManager: DAGManager;
  state: SessionState;
  createdAt: Date;
  lastActivity: Date;
  workflowGroups?: Map<string, WorkflowGroup>;
  selectedWorkflowId?: string;
}

export interface SessionState {
  actionUrl?: string;
  masterNodeId?: string;
  inProcessNodeId?: string;
  toBeProcessedNodes: string[];
  inProcessNodeDynamicParts: string[];
  inputVariables: Record<string, string>;
  isComplete: boolean;
  logs: LogEntry[];
  generatedCode?: string;
  authAnalysis?: AuthenticationAnalysis;
  authReadiness?: {
    isAuthComplete: boolean;
    authBlockers: string[];
    authRecommendations: string[];
  };
  bootstrapAnalysis?: {
    isNeeded: boolean;
    bootstrapUrl?: string; // The main page URL that starts the session
    parameters: Array<{ name: string; source: BootstrapParameterSource }>;
  };
  /** Map of discovered workflow groups, supporting multi-workflow analysis */
  workflowGroups: Map<string, WorkflowGroup>;
  /** Currently selected workflow group for processing */
  activeWorkflowId?: string;
}

export interface LogEntry {
  timestamp: Date;
  level: "info" | "debug" | "error" | "warn";
  message: string;
  data?: unknown;
}

export interface SessionInfo {
  id: string;
  prompt: string;
  createdAt: Date;
  lastActivity: Date;
  isComplete: boolean;
  nodeCount: number;
  hasAuthentication?: boolean;
  authTypes?: AuthenticationType[];
  authReadiness?: boolean;
}

// ========== DAG Types ==========

export type NodeType =
  | "cookie"
  | "master"
  | "master_curl"
  | "curl"
  | "not_found";

// Base content interfaces
export interface RequestNodeContent {
  key: RequestModel;
  value?: ResponseData | null;
}

export interface CookieNodeContent {
  key: string;
  value: string;
}

export interface NotFoundNodeContent {
  key: string;
}

// Discriminated union for DAG nodes
export interface CurlDAGNode {
  id: string;
  nodeType: "curl";
  content: RequestNodeContent;
  dynamicParts?: string[];
  extractedParts?: string[];
  inputVariables?: Record<string, string>;
  authInfo?: RequestAuthenticationInfo;
  classifiedParameters?: ClassifiedParameter[];
  bootstrapSource?: BootstrapParameterSource;
  groupId?: string;
}

export interface CookieDAGNode {
  id: string;
  nodeType: "cookie";
  content: CookieNodeContent;
  dynamicParts?: string[];
  extractedParts?: string[];
  inputVariables?: Record<string, string>;
  classifiedParameters?: ClassifiedParameter[];
  bootstrapSource?: BootstrapParameterSource;
  groupId?: string;
}

export interface NotFoundDAGNode {
  id: string;
  nodeType: "not_found";
  content: NotFoundNodeContent;
  dynamicParts?: string[];
  extractedParts?: string[];
  inputVariables?: Record<string, string>;
  classifiedParameters?: ClassifiedParameter[];
  bootstrapSource?: BootstrapParameterSource;
  groupId?: string;
}

export interface MasterDAGNode {
  id: string;
  nodeType: "master";
  content: RequestNodeContent;
  dynamicParts?: string[];
  extractedParts?: string[];
  inputVariables?: Record<string, string>;
  authInfo?: RequestAuthenticationInfo;
  classifiedParameters?: ClassifiedParameter[];
  bootstrapSource?: BootstrapParameterSource;
  groupId?: string;
}

export interface MasterCurlDAGNode {
  id: string;
  nodeType: "master_curl";
  content: RequestNodeContent;
  dynamicParts?: string[];
  extractedParts?: string[];
  inputVariables?: Record<string, string>;
  authInfo?: RequestAuthenticationInfo;
  classifiedParameters?: ClassifiedParameter[];
  bootstrapSource?: BootstrapParameterSource;
  groupId?: string;
}

export type DAGNode =
  | CurlDAGNode
  | CookieDAGNode
  | NotFoundDAGNode
  | MasterDAGNode
  | MasterCurlDAGNode;

export interface DAGManager {
  addNode(
    nodeType: NodeType,
    content: RequestNodeContent | CookieNodeContent | NotFoundNodeContent,
    attributes?: Partial<DAGNode>,
    groupId?: string
  ): string;
  updateNode(nodeId: string, attributes: Partial<DAGNode>): void;
  getNode(nodeId: string): DAGNode | undefined;
  addEdge(fromId: string, toId: string): void;
  detectCycles(): string[][] | null;
  getNodeCount(): number;
  getAllNodes(): Map<string, DAGNode>;
  toJSON(): DAGExport;
  topologicalSort(): string[];
  getPredecessors(nodeId: string): string[];
  getSuccessors(nodeId: string): string[];
  isComplete(): boolean;
  getUnresolvedNodes(): Array<{ nodeId: string; unresolvedParts: string[] }>;
  findNodeByRequest(request: RequestModel): string | null;
  /** Get all nodes belonging to a specific workflow group */
  getNodesByGroup(groupId: string): Map<string, DAGNode>;
  /** Get the workflow group ID for a given node */
  getNodeGroup(nodeId: string): string | undefined;
}

export interface DAGExport {
  nodes: Array<DAGNode & { id: string }>;
  edges: Array<{ from: string; to: string }>;
  nodeCount: number;
  edgeCount: number;
}

// ========== LLM Response Types ==========

// Modern workflow discovery handles URL identification

/**
 * Response from dynamic parts identification function call
 */
export interface DynamicPartsResponse {
  dynamic_parts: string[];
}

/**
 * Input variable item in LLM response
 */
export interface InputVariableItem {
  variable_name: string;
  variable_value: string;
}

/**
 * Response from input variables identification function call
 */
export interface InputVariablesResponse {
  identified_variables: InputVariableItem[];
}

/**
 * Result of input variable identification process
 */
export interface InputVariablesResult {
  identifiedVariables: Record<string, string>;
  removedDynamicParts: string[];
}

/**
 * LLM response for simplest request selection
 */
export interface SimplestRequestResponse {
  index: number;
}

/**
 * Cookie dependency found for a dynamic part
 */
export interface CookieDependency {
  type: "cookie";
  cookieKey: string;
  dynamicPart: string;
}

/**
 * Request dependency found for a dynamic part
 */
export interface RequestDependency {
  type: "request";
  sourceRequest: RequestModel;
  dynamicPart: string;
}

/**
 * Result of dependency finding process
 */
export interface DependencyResult {
  cookieDependencies: CookieDependency[];
  requestDependencies: RequestDependency[];
  notFoundParts: string[];
}

/**
 * Result of cookie dependency search
 */
export interface CookieSearchResult {
  found: CookieDependency[];
  remaining: string[];
}

/**
 * Session start response with optional warnings and recommendations
 */
export interface SessionStartResponse {
  sessionId: string;
  message: string;
  harPath: string;
  prompt: string;
  harValidation?: HarValidationResult | undefined;
  warning?: string;
  recommendations?: string[];
}

/**
 * Standard cleanup result from ManualSessionManager
 */
export interface StandardCleanupResult {
  gcForced: boolean;
  memoryBefore: number;
  memoryAfter: number;
  memoryReclaimed: number;
  activeSessions: number;
  cleanupActions: string[];
}

/**
 * Aggressive cleanup result from ManualSessionManager
 */
export interface AggressiveCleanupResult {
  sessionsClosed: number;
  memoryReclaimed: number;
  errors: string[];
}

/**
 * Union type for cleanup results
 */
export type CleanupResult = StandardCleanupResult | AggressiveCleanupResult;

/**
 * HAR validation result
 */
export interface HarValidationResult {
  quality: "excellent" | "good" | "poor" | "empty";
  stats: {
    totalEntries: number;
    relevantEntries: number;
    apiRequests: number;
    postRequests: number;
    responsesWithContent: number;
  };
  isValid: boolean;
  issues?: string[];
  recommendations?: string[];
}

// ========== HAR Data Types ==========

export interface ParsedHARData {
  requests: RequestModel[];
  urls: URLInfo[];
  validation?: {
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
  };
  authAnalysis?: AuthenticationAnalysis;
}

export interface URLInfo {
  method: string;
  url: string;
  requestType: string;
  responseType: string;
}

export interface RequestModel {
  method: string;
  url: string;
  headers: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: unknown;
  response?: ResponseData;
  timestamp?: Date;
  toCurlCommand(): string;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text?: string;
  json?: unknown;
}

// ========== Cookie Data Types ==========

export interface CookieData {
  [cookieName: string]: {
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
  };
}

// ========== Dependency Analysis Types ==========

// ========== Zod Schemas for Validation ==========

export const SessionStartSchema = z.object({
  harPath: z.string().min(1, "HAR file path is required"),
  cookiePath: z.string().optional(),
  prompt: z.string().min(1, "Prompt is required"),
  inputVariables: z.record(z.string()).optional(),
  harParsingOptions: z
    .object({
      excludeKeywords: z.array(z.string()).optional(),
      includeAllApiRequests: z.boolean().optional(),
      minQualityThreshold: z.enum(["excellent", "good", "poor"]).optional(),
      preserveAnalyticsRequests: z.boolean().optional(),
      customFilters: z.array(z.function()).optional(),
    })
    .optional(),
});

export const SessionIdSchema = z.object({
  sessionId: z.string().uuid("Invalid session ID format"),
});

// ========== Manual Session Schemas ==========

/**
 * Browser viewport configuration schema
 */
export const ViewportConfigSchema = z
  .object({
    width: z
      .number()
      .min(320, "Viewport width must be at least 320px")
      .max(7680, "Viewport width cannot exceed 7680px")
      .optional()
      .describe("Browser viewport width (320-7680px)"),
    height: z
      .number()
      .min(240, "Viewport height must be at least 240px")
      .max(4320, "Viewport height cannot exceed 4320px")
      .optional()
      .describe("Browser viewport height (240-4320px)"),
  })
  .describe("Browser viewport configuration");

/**
 * Browser context options schema
 */
export const ContextOptionsSchema = z
  .object({
    deviceScaleFactor: z
      .number()
      .min(0.25, "Device scale factor must be at least 0.25")
      .max(4, "Device scale factor cannot exceed 4")
      .optional()
      .describe("Device scale factor for coordinate accuracy (0.25-4)"),
  })
  .describe("Browser context options");

/**
 * Manual session browser configuration options schema
 */
export const ManualBrowserOptionsSchema = z
  .object({
    headless: z
      .boolean()
      .optional()
      .describe(
        "Run browser in headless mode (default: false for manual interaction)"
      ),
    viewport: ViewportConfigSchema.optional().describe(
      "Browser viewport configuration"
    ),
    contextOptions: ContextOptionsSchema.optional().describe(
      "Browser context options"
    ),
  })
  .describe("Browser configuration options for manual sessions");

/**
 * Artifact collection configuration schema
 */
export const ArtifactConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe("Enable artifact collection (default: true)"),
    outputDir: z
      .string()
      .min(1, "Output directory path cannot be empty")
      .refine(
        (path) => !path.includes(".."),
        "Output directory path cannot contain '..' for security"
      )
      .optional()
      .describe(
        "Custom output directory for artifacts (relative or absolute path)"
      ),
    saveHar: z.boolean().optional().describe("Save HAR files (default: true)"),
    saveCookies: z
      .boolean()
      .optional()
      .describe("Save cookies (default: true)"),
    saveScreenshots: z
      .boolean()
      .optional()
      .describe("Save screenshots (default: true)"),
    autoScreenshotInterval: z
      .number()
      .min(1, "Auto-screenshot interval must be at least 1 second")
      .max(3600, "Auto-screenshot interval cannot exceed 1 hour (3600 seconds)")
      .optional()
      .describe(
        "Take screenshots automatically every N seconds (1-3600, 0 = disabled)"
      ),
  })
  .describe("Configuration for artifact collection during the session");

/**
 * Manual session configuration schema
 */
export const ManualSessionConfigSchema = z
  .object({
    timeout: z
      .number()
      .min(1, "Timeout must be at least 1 minute")
      .max(1440, "Timeout cannot exceed 24 hours (1440 minutes)")
      .optional()
      .describe("Auto-cleanup timeout in minutes (1-1440, 0 = no timeout)"),
    browserOptions: ManualBrowserOptionsSchema.optional().describe(
      "Browser configuration options"
    ),
    artifactConfig: ArtifactConfigSchema.optional().describe(
      "Configuration for artifact collection during the session"
    ),
  })
  .describe("Session configuration options");

/**
 * Manual session start parameters schema
 */
export const ManualSessionStartSchema = z.object({
  sessionId: z
    .string()
    .uuid("Session ID must be a valid UUID if provided")
    .optional()
    .describe("Custom session identifier (auto-generated if not provided)"),
  url: z
    .string()
    .url("URL must be a valid HTTP/HTTPS URL")
    .optional()
    .transform((val) => {
      // Sanitize URL by ensuring it has a protocol
      if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
        return `https://${val}`;
      }
      return val;
    })
    .describe("Starting URL for the browser session"),
  config: ManualSessionConfigSchema.optional().describe(
    "Session configuration options"
  ),
});

export const ManualSessionStopSchema = z.object({
  sessionId: z
    .string()
    .uuid("Session ID must be a valid UUID")
    .describe("ID of the session to stop"),
  artifactTypes: z
    .array(z.enum(["har", "cookies", "screenshot"]))
    .min(1, "At least one artifact type must be specified if provided")
    .optional()
    .describe(
      "Specific types of artifacts to collect (default: all enabled types)"
    ),
  takeScreenshot: z
    .boolean()
    .optional()
    .describe(
      "Take a final screenshot before stopping (default: true if screenshots enabled)"
    ),
  reason: z
    .string()
    .min(1, "Reason cannot be empty if provided")
    .max(200, "Reason cannot exceed 200 characters")
    .optional()
    .describe("Reason for stopping the session (for logging purposes)"),
});

// ========== Type Exports ==========

export type SessionStartParams = z.infer<typeof SessionStartSchema>;

// Manual Session Component Types

// ========== Error Types ==========

export class HarvestError extends Error {
  public code: string;
  public data?: unknown;

  constructor(message: string, code = "HARVEST_ERROR", data?: unknown) {
    super(message);
    this.name = "HarvestError";
    this.code = code;
    this.data = data;
  }
}

export class SessionNotFoundError extends HarvestError {
  constructor(sessionId: string) {
    super(`Session ${sessionId} not found`, "SESSION_NOT_FOUND", { sessionId });
  }
}

export class HARQualityError extends HarvestError {
  constructor(
    quality: string,
    issues: string[],
    recommendations: string[],
    context?: { harPath?: string; sessionId?: string; stats?: unknown }
  ) {
    const message = [
      `HAR file quality is insufficient for analysis (${quality}).`,
      `Issues: ${issues.join(", ")}.`,
      `Recommendations: ${recommendations.join(", ")}.`,
    ].join(" ");

    super(message, "HAR_QUALITY_INSUFFICIENT", {
      quality,
      issues,
      recommendations,
      ...context,
    });
  }
}

export class HARGenerationError extends HarvestError {
  constructor(
    reason: string,
    context?: {
      sessionId?: string;
      entryCount?: number;
      apiCount?: number;
      pendingCount?: number;
      quality?: string;
    }
  ) {
    const message = `HAR file generation failed: ${reason}`;
    super(message, "HAR_GENERATION_FAILED", context);
  }
}

// ========== Browser Types Export ==========

export type {
  ActiveBrowser,
  Artifact,
  ArtifactCollection,
  BrowserAgentConfig,
  BrowserEngine,
  BrowserOptions,
  BrowserSessionData,
  BrowserSessionInfo,
  ManualSession,
  SessionConfig,
  SessionStopResult,
} from "../browser/types.js";

// ========== Tool Handler Context Types ==========

// Forward declarations to avoid circular dependencies

/**
 * Shared context for MCP tool handlers to access server dependencies
 * without tight coupling to the HarvestMCPServer class
 */
// ========== Session Analysis Types ==========

/**
 * Comprehensive analysis completion interface
 */
export interface CompletionAnalysis {
  isComplete: boolean;
  blockers: string[];
  recommendations: string[];
  diagnostics: {
    hasMasterNode: boolean;
    dagComplete: boolean;
    queueEmpty: boolean;
    totalNodes: number;
    unresolvedNodes: number;
    pendingInQueue: number;
    hasActionUrl: boolean;
    authAnalysisComplete: boolean;
    authReadiness: boolean;
    authErrors: number;
    allNodesClassified: boolean;
    nodesNeedingClassification: number;
    bootstrapAnalysisComplete: boolean;
    sessionConstantsCount: number;
    unresolvedSessionConstants: number;
  };
}

export interface CompletedSessionArtifacts {
  sessionId: string;
  completedAt: string;
  prompt: string;
  artifacts: {
    har?: {
      filename: string;
      path: string;
      size: number;
    };
    cookies?: {
      filename: string;
      path: string;
      size: number;
    };
    generatedCode?: {
      filename: string;
      path: string;
      size: number;
    };
    metadata: {
      filename: string;
      path: string;
      size: number;
    };
  };
  metadata: {
    totalNodes: number;
    harQuality: string;
    totalRequests: number;
    hasAuthCookies: boolean;
    generatedCodeSize: number;
    cachePath: string;
  };
}

// ========== Focused Tool Handler Interfaces (ISP Compliance) ==========

/**
 * Minimal interface for session querying operations
 * Used by tools that need to retrieve session data
 */
export interface SessionQuery {
  getSession(sessionId: string): HarvestSession;
}

/**
 * Minimal interface for session logging operations
 * Used by tools that need to add log entries
 */
export interface SessionLogging {
  addLog(
    sessionId: string,
    level: LogEntry["level"],
    message: string,
    data?: unknown
  ): void;
}

/**
 * Minimal interface for session analysis operations
 * Used by tools that need completion analysis and state management
 */
export interface SessionAnalysis {
  analyzeCompletionState(sessionId: string): CompletionAnalysis;
  setMasterNodeId(sessionId: string, nodeId: string): void;
}

/**
 * Minimal interface for session management operations
 * Used by tools that need to create/manage sessions
 */
export interface SessionManagement extends SessionQuery {
  createSession(params: SessionStartParams): Promise<string>;
  listSessions(): SessionInfo[];
  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    oldestActiveSession?: string;
    newestActiveSession?: string;
  };
  deleteSession(sessionId: string): boolean;
}

/**
 * Minimal interface for completed session operations
 * Used by tools that need to cache completed sessions
 */
export interface CompletedSessionOperations {
  cacheCompletedSession(
    session: HarvestSession,
    analysis: CompletionAnalysis
  ): Promise<CompletedSessionArtifacts>;
}

/**
 * Tool handler context interfaces for different tool types
 * These compose the minimal interfaces based on actual needs
 */
export interface DebugToolContext
  extends SessionQuery,
    SessionLogging,
    SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface AnalysisToolContext
  extends SessionQuery,
    SessionLogging,
    SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface SessionToolContext extends SessionManagement, SessionLogging {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface CodegenToolContext
  extends SessionQuery,
    SessionLogging,
    SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface SystemToolContext extends SessionQuery, SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface ManualSessionToolContext
  extends SessionManagement,
    SessionLogging {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface WorkflowToolContext
  extends SessionManagement,
    SessionLogging,
    SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

export interface AuthToolContext
  extends SessionQuery,
    SessionLogging,
    SessionAnalysis {
  sessionManager: SessionManagerAdapter;
  completedSessionManager: CompletedSessionManagerAdapter;
}

// ========== Adapter Pattern Implementation ==========

/**
 * Adapter class that implements all session-related interfaces
 * Bridges between concrete SessionManager and focused interfaces
 */
export class SessionManagerAdapter
  implements SessionQuery, SessionLogging, SessionAnalysis, SessionManagement
{
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  // SessionQuery implementation
  getSession(sessionId: string): HarvestSession {
    return this.sessionManager.getSession(sessionId);
  }

  // SessionLogging implementation
  addLog(
    sessionId: string,
    level: LogEntry["level"],
    message: string,
    data?: unknown
  ): void {
    this.sessionManager.addLog(sessionId, level, message, data);
  }

  // SessionAnalysis implementation
  analyzeCompletionState(sessionId: string): CompletionAnalysis {
    return this.sessionManager.analyzeCompletionState(sessionId);
  }

  setMasterNodeId(sessionId: string, nodeId: string): void {
    const session = this.getSession(sessionId);
    session.state.masterNodeId = nodeId;
  }

  // ISessionManager compatibility methods
  isComplete(sessionId: string): boolean {
    return this.analyzeCompletionState(sessionId).isComplete;
  }

  setActionUrl(sessionId: string, url: string): void {
    const session = this.getSession(sessionId);
    session.state.actionUrl = url;
  }

  updateSessionState(sessionId: string, updates: Partial<SessionState>): void {
    const session = this.getSession(sessionId);
    Object.assign(session.state, updates);
  }

  // SessionManagement implementation
  async createSession(params: SessionStartParams): Promise<string> {
    return this.sessionManager.createSession(params);
  }

  listSessions(): SessionInfo[] {
    return this.sessionManager.listSessions();
  }

  getStats(): {
    total: number;
    active: number;
    completed: number;
    failed: number;
    oldestActiveSession?: string;
    newestActiveSession?: string;
  } {
    const actualStats = this.sessionManager.getStats();
    // Map the actual implementation to the expected interface format
    return {
      total: actualStats.totalSessions,
      active: actualStats.activeSessions,
      completed: actualStats.completedSessions,
      failed: 0, // No failed status in actual implementation, defaulting to 0
      // Optional properties are omitted instead of being set to undefined
    };
  }

  deleteSession(sessionId: string): boolean {
    return this.sessionManager.deleteSession(sessionId);
  }
}

/**
 * Adapter class for CompletedSessionManager
 * Implements the minimal CompletedSessionOperations interface
 */
export class CompletedSessionManagerAdapter
  implements CompletedSessionOperations
{
  private completedSessionManager: CompletedSessionManager;

  constructor(completedSessionManager: CompletedSessionManager) {
    this.completedSessionManager = completedSessionManager;
  }

  async cacheCompletedSession(
    session: HarvestSession,
    analysis: CompletionAnalysis
  ): Promise<CompletedSessionArtifacts> {
    return this.completedSessionManager.cacheCompletedSession(
      session,
      analysis
    );
  }
}

/**
 * Factory functions for creating properly typed tool contexts
 */
export function createDebugToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): DebugToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createAnalysisToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): AnalysisToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createSessionToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): SessionToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    createSession: sessionAdapter.createSession.bind(sessionAdapter),
    listSessions: sessionAdapter.listSessions.bind(sessionAdapter),
    getStats: sessionAdapter.getStats.bind(sessionAdapter),
    deleteSession: sessionAdapter.deleteSession.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createCodegenToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): CodegenToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createSystemToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): SystemToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createManualSessionToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): ManualSessionToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    createSession: sessionAdapter.createSession.bind(sessionAdapter),
    listSessions: sessionAdapter.listSessions.bind(sessionAdapter),
    getStats: sessionAdapter.getStats.bind(sessionAdapter),
    deleteSession: sessionAdapter.deleteSession.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createWorkflowToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): WorkflowToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    createSession: sessionAdapter.createSession.bind(sessionAdapter),
    listSessions: sessionAdapter.listSessions.bind(sessionAdapter),
    getStats: sessionAdapter.getStats.bind(sessionAdapter),
    deleteSession: sessionAdapter.deleteSession.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

export function createAuthToolContext(
  sessionManager: SessionManager,
  completedSessionManager: CompletedSessionManager
): AuthToolContext {
  const sessionAdapter = new SessionManagerAdapter(sessionManager);
  const completedSessionAdapter = new CompletedSessionManagerAdapter(
    completedSessionManager
  );

  return {
    getSession: sessionAdapter.getSession.bind(sessionAdapter),
    addLog: sessionAdapter.addLog.bind(sessionAdapter),
    analyzeCompletionState:
      sessionAdapter.analyzeCompletionState.bind(sessionAdapter),
    setMasterNodeId: sessionAdapter.setMasterNodeId.bind(sessionAdapter),
    sessionManager: sessionAdapter,
    completedSessionManager: completedSessionAdapter,
  };
}

// ========== Internal Tool Communication Types ==========

/**
 * Strongly-typed result format for internal tool communication
 * to prevent data format mismatches between components
 */
export interface InternalToolResult<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code: string;
  };
  warnings?: string[];
}

/**
 * Specific interface for code generation results
 */
export interface CodeGenerationData {
  code: string;
  language: "typescript";
  characterCount: number;
}
