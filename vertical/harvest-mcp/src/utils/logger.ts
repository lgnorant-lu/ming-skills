/**
 * General purpose logging utility for Harvest MCP
 * Configured to work with MCP stdio transport without interference
 */

import pino from "pino";

// Determine if we're running in MCP mode (stdio transport)
// MCP mode should only be enabled when explicitly requested or when stdout is not a TTY
// but NOT during tests, which should use minimal logging
const isTestMode = process.env.NODE_ENV === "test";
const isMcpMode =
  !isTestMode &&
  (process.env.MCP_STDIO === "true" ||
    process.argv.includes("--stdio") ||
    (process.env.NODE_ENV !== "development" && !process.stdout.isTTY));

// Create the base logger with harvest-mcp specific configuration
const loggerOptions: Record<string, unknown> = {
  level:
    process.env.HARVEST_LOG_LEVEL ||
    process.env.LOG_LEVEL ||
    (isTestMode ? "warn" : "info"),
  name: "harvest-mcp",
};

// Create logger with proper stream routing for MCP compliance
let logger: pino.Logger;

if (isMcpMode) {
  // MCP mode: Use direct stderr destination to ensure no stdout contamination
  // This is critical for MCP protocol compliance - stdout must be pure JSON-RPC
  logger = pino(loggerOptions, pino.destination(2)); // stderr (file descriptor 2)

  // Add startup verification log to stderr
  logger.info("Logger configured for MCP mode - all logs routed to stderr");

  // Debug: Log environment info to help identify external log sources
  logger.debug(
    {
      mcpEnvVar: process.env.MCP_STDIO,
      stdoutTTY: process.stdout.isTTY,
      stdinTTY: process.stdin.isTTY,
      nodeEnv: process.env.NODE_ENV,
      argv: process.argv.slice(2),
    },
    "MCP mode detection details"
  );
} else if (isTestMode) {
  // Test mode: Minimal logging to avoid cluttering test output
  // Use stderr to avoid interfering with test framework output
  logger = pino(loggerOptions, pino.destination(2));
} else if (process.env.NODE_ENV === "development") {
  // Development mode: use pino-pretty for readable output
  const prettyTransport = pino.transport({
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname",
    },
  });
  logger = pino(loggerOptions, prettyTransport);
} else {
  // Production mode (non-MCP): standard JSON logging to stdout
  logger = pino(loggerOptions);
}

export { logger };

// Validate logger configuration at startup
if (isMcpMode) {
  // In MCP mode, verify that stdout is reserved for JSON-RPC only
  // Any application logs should go to stderr to prevent interference
  const originalConsoleError = console.error;

  // Override console methods to ensure no accidental stdout pollution
  console.log = (...args: unknown[]) => {
    logger.warn(
      "Intercepted console.log call in MCP mode - redirecting to stderr"
    );
    originalConsoleError("[MCP-SAFE]", ...args);
  };

  // Log successful configuration
  logger.info(
    {
      mode: "MCP",
      stdoutReserved: "JSON-RPC only",
      stderrUsage: "Application logs",
      mcpCompliant: true,
    },
    "Logger successfully configured for MCP stdio transport compliance"
  );
}

// Create specialized loggers for different components
export const serverLogger = logger.child({ component: "server" });
export const browserLogger = logger.child({ component: "browser" });
export const sessionLogger = logger.child({ component: "session" });
export const artifactLogger = logger.child({ component: "artifacts" });
export const providerLogger = logger.child({ component: "provider" });

/**
 * Create a component-specific logger
 */
export function createComponentLogger(component: string) {
  return logger.child({ component });
}

/**
 * Create a session-specific logger
 */
export function createSessionLogger(sessionId: string) {
  return sessionLogger.child({ sessionId });
}

/**
 * Log browser operation with context
 */
export function logBrowserOperation(
  operation: string,
  context?: Record<string, unknown>
) {
  browserLogger.info(
    { operation, ...context },
    `Browser operation: ${operation}`
  );
}

/**
 * Log artifact collection event
 */
export function logArtifactEvent(
  event: string,
  artifactType: string,
  context?: Record<string, unknown>
) {
  artifactLogger.info(
    { event, artifactType, ...context },
    `Artifact ${event}: ${artifactType}`
  );
}

/**
 * Log session lifecycle event
 */
export function logSessionEvent(
  sessionId: string,
  event: string,
  context?: Record<string, unknown>
) {
  const sessionLog = createSessionLogger(sessionId);
  sessionLog.info({ event, ...context }, `Session ${event}`);
}

/**
 * Log error with browser context
 */
export function logBrowserError(
  error: Error | string,
  context?: Record<string, unknown>
) {
  const errorMessage = error instanceof Error ? error.message : error;
  const errorStack = error instanceof Error ? error.stack : undefined;

  browserLogger.error(
    { error: errorMessage, stack: errorStack, ...context },
    `Browser error: ${errorMessage}`
  );
}
