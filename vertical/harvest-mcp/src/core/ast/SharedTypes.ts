/**
 * Shared Type Definitions for Generated API Clients
 *
 * This module contains common type definitions that are shared across
 * all generated API client files to reduce boilerplate and maintain consistency.
 */

/**
 * Standard API response structure
 * Generic response wrapper that provides consistent structure
 * for all API responses including success status, data, and metadata.
 */
export interface ApiResponse<T = unknown> {
  /** Whether the API call was successful */
  success: boolean;
  /** The response data */
  data: T;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
}

/** HTTP request configuration options */
export interface RequestOptions {
  /** HTTP method */
  method: string;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body */
  body?: string;
}

/**
 * Authentication configuration interface
 * Supports multiple authentication methods including Bearer tokens,
 * API keys, basic auth, session cookies, and custom headers.
 */
export interface AuthConfig {
  /** Authentication type */
  type: "bearer" | "api_key" | "basic" | "session" | "custom";
  /** Bearer token */
  token?: string;
  /** API key */
  apiKey?: string;
  /** Username for basic auth */
  username?: string;
  /** Password for basic auth */
  password?: string;
  /** Session cookies */
  sessionCookies?: Record<string, string>;
  /** Custom authentication headers */
  customHeaders?: Record<string, string>;
  /** URL for refreshing tokens */
  tokenRefreshUrl?: string;
  /** Callback for handling token expiration */
  onTokenExpired?: () => Promise<string>;
}

/** Authentication error for retry logic */
export class AuthenticationError extends Error {
  public readonly status: number;
  public readonly response?: unknown;

  constructor(message: string, status: number, response?: unknown) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
    this.response = response;
  }
}

/** Network request error with contextual information */
export class NetworkRequestError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly method: string;
  public readonly headers?: Record<string, string> | undefined;
  public readonly body?: string | undefined;
  public readonly response?: unknown;

  constructor(
    message: string,
    status: number,
    url: string,
    method: string,
    headers?: Record<string, string>,
    body?: string,
    response?: unknown
  ) {
    super(message);
    this.name = "NetworkRequestError";
    this.status = status;
    this.url = url;
    this.method = method;
    this.headers = headers;
    this.body = body;
    this.response = response;
  }

  /** Get a detailed error summary for debugging */
  getDebugInfo(): string {
    return `${this.name}: ${this.message}
URL: ${this.method} ${this.url}
Status: ${this.status}
Headers: ${JSON.stringify(this.headers, null, 2)}
${this.body ? `Body: ${this.body}` : ""}
${this.response ? `Response: ${JSON.stringify(this.response, null, 2)}` : ""}`.trim();
  }
}

/** Workflow execution error with step context */
export class WorkflowExecutionError extends Error {
  public readonly stepName: string;
  public readonly stepType: "cookie" | "auth" | "api_call";
  public readonly status?: number | undefined;
  public readonly originalError?: Error | undefined;

  constructor(
    message: string,
    stepName: string,
    stepType: "cookie" | "auth" | "api_call",
    status?: number,
    originalError?: Error
  ) {
    super(message);
    this.name = "WorkflowExecutionError";
    this.stepName = stepName;
    this.stepType = stepType;
    this.status = status;
    this.originalError = originalError;
  }

  /** Get a detailed error summary for debugging */
  getDebugInfo(): string {
    return `${this.name}: ${this.message}
Step: ${this.stepName} (${this.stepType})
${this.status ? `Status: ${this.status}` : ""}
${this.originalError ? `Original Error: ${this.originalError.message}` : ""}`.trim();
  }
}

/** Cookie management error */
export class CookieError extends Error {
  public readonly cookieName: string;
  public readonly operation: "set" | "get" | "delete";
  public readonly originalError?: Error | undefined;

  constructor(
    message: string,
    cookieName: string,
    operation: "set" | "get" | "delete",
    originalError?: Error
  ) {
    super(message);
    this.name = "CookieError";
    this.cookieName = cookieName;
    this.operation = operation;
    this.originalError = originalError;
  }
}

// Note: ApiResponse, RequestOptions, and AuthConfig are already exported as interfaces above
