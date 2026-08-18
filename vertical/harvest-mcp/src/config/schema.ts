import { z } from "zod";

/**
 * Comprehensive configuration schema for Harvest MCP Server
 * Defines all configurable options with defaults, validation, and type inference
 */

// LLM Provider Configuration
export const LLMProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
  timeout: z.number().min(1000).max(300000).optional(), // 1s to 5min
  maxRetries: z.number().min(0).max(10).default(3),
});

export const LLMConfigSchema = z.object({
  provider: z.enum(["openai", "gemini"]).optional(),
  model: z.string().optional(),
  providers: z
    .object({
      openai: LLMProviderConfigSchema.default({}),
      gemini: LLMProviderConfigSchema.default({}),
    })
    .default({}),
});

// Browser Configuration
export const BrowserViewportSchema = z.object({
  width: z.number().min(320).max(7680).default(1280),
  height: z.number().min(240).max(4320).default(720),
});

export const BrowserContextOptionsSchema = z.object({
  deviceScaleFactor: z.number().min(0.1).max(5).default(1),
  hasTouch: z.boolean().default(false),
  isMobile: z.boolean().default(false),
  locale: z.string().default("en-US"),
  timezone: z.string().default("UTC"),
});

export const BrowserOptionsSchema = z.object({
  headless: z.boolean().default(true),
  viewport: BrowserViewportSchema.default({}),
  contextOptions: BrowserContextOptionsSchema.default({}),
  timeout: z.number().min(5000).max(300000).default(30000), // 5s to 5min
  navigationTimeout: z.number().min(5000).max(180000).default(60000), // 5s to 3min
  slowMo: z.number().min(0).max(5000).default(0), // milliseconds
});

// Session Configuration
export const SessionConfigSchema = z.object({
  maxSessions: z.number().min(1).max(1000).default(100),
  timeoutMinutes: z.number().min(1).max(1440).default(30), // 1min to 24h
  cleanupIntervalMinutes: z.number().min(1).max(60).default(5),
  completedSessionCacheTTLMinutes: z.number().min(1).max(1440).default(60),
});

// Manual Session Configuration
export const ManualSessionConfigSchema = z.object({
  defaultTimeoutMinutes: z.number().min(0).max(1440).default(0), // 0 = no timeout
  maxConcurrentSessions: z.number().min(1).max(50).default(10),
  cleanupTimeoutMs: z.number().min(1000).max(60000).default(5000), // 1s to 1min
  autoScreenshotInterval: z.number().min(5).max(300).optional(), // 5s to 5min
  browser: BrowserOptionsSchema.default({}),
});

// Artifact Configuration
export const ArtifactConfigSchema = z.object({
  enabled: z.boolean().default(true),
  saveHar: z.boolean().default(true),
  saveCookies: z.boolean().default(true),
  saveScreenshots: z.boolean().default(true),
  autoScreenshotInterval: z.number().min(5).max(300).optional(), // seconds
});

// Path Configuration
export const PathConfigSchema = z.object({
  sharedDir: z.string().default("~/.harvest/shared"),
  outputDir: z.string().default("~/.harvest/output"),
  tempDir: z.string().optional(), // uses system temp if not specified
  cookiesDir: z.string().default("~/.harvest/cookies"),
  screenshotsDir: z.string().default("~/.harvest/screenshots"),
  harDir: z.string().default("~/.harvest/har"),
});

// Logging Configuration
export const LoggingConfigSchema = z.object({
  level: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  mcpStdio: z.boolean().default(false),
  enableBrowserLogs: z.boolean().default(false),
  enableMemoryLogs: z.boolean().default(false),
});

// Memory Configuration
export const MemoryConfigSchema = z.object({
  monitoringEnabled: z.boolean().default(true),
  maxHeapSizeMB: z.number().min(128).max(8192).default(1024), // 128MB to 8GB
  warningThresholdMB: z.number().min(64).max(4096).default(512),
  snapshotIntervalMs: z.number().min(5000).max(300000).default(30000), // 5s to 5min
});

// Development Configuration
export const DevelopmentConfigSchema = z.object({
  enableHotReload: z.boolean().default(false),
  debugMode: z.boolean().default(false),
  verboseLogging: z.boolean().default(false),
  enableTestMode: z.boolean().default(false),
});

// Main Configuration Schema
export const ConfigSchema = z.object({
  llm: LLMConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  manualSession: ManualSessionConfigSchema.default({}),
  artifacts: ArtifactConfigSchema.default({}),
  paths: PathConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  development: DevelopmentConfigSchema.default({}),
});

// Infer TypeScript type from schema
export type Config = z.infer<typeof ConfigSchema>;

// CLI Arguments Schema
export const CLIArgsSchema = z.object({
  provider: z.enum(["openai", "gemini", "google"]).optional(),
  apiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  googleApiKey: z.string().optional(),
  model: z.string().optional(),
  help: z.boolean().optional(),
});

export type CLIArgs = z.infer<typeof CLIArgsSchema>;

// Environment Variable Mapping
export const ENVIRONMENT_VARIABLE_MAP = {
  // LLM Configuration
  HARVEST_LLM_PROVIDER: "llm.provider",
  HARVEST_LLM_MODEL: "llm.model",
  HARVEST_OPENAI_API_KEY: "llm.providers.openai.apiKey",
  HARVEST_GOOGLE_API_KEY: "llm.providers.gemini.apiKey",
  HARVEST_LLM_TIMEOUT: "llm.providers.openai.timeout", // applies to active provider
  HARVEST_LLM_MAX_RETRIES: "llm.providers.openai.maxRetries",

  // Session Configuration
  HARVEST_MAX_SESSIONS: "session.maxSessions",
  HARVEST_SESSION_TIMEOUT_MINUTES: "session.timeoutMinutes",
  HARVEST_CLEANUP_INTERVAL_MINUTES: "session.cleanupIntervalMinutes",

  // Manual Session Configuration
  HARVEST_MANUAL_SESSION_TIMEOUT: "manualSession.defaultTimeoutMinutes",
  HARVEST_MAX_MANUAL_SESSIONS: "manualSession.maxConcurrentSessions",

  // Browser Configuration
  HARVEST_BROWSER_HEADLESS: "manualSession.browser.headless",
  HARVEST_BROWSER_WIDTH: "manualSession.browser.viewport.width",
  HARVEST_BROWSER_HEIGHT: "manualSession.browser.viewport.height",

  // Path Configuration
  HARVEST_SHARED_DIR: "paths.sharedDir",
  HARVEST_OUTPUT_DIR: "paths.outputDir",
  HARVEST_TEMP_DIR: "paths.tempDir",

  // Logging Configuration
  HARVEST_LOG_LEVEL: "logging.level",
  MCP_STDIO: "logging.mcpStdio",

  // Memory Configuration
  HARVEST_MAX_HEAP_SIZE_MB: "memory.maxHeapSizeMB",
  HARVEST_MEMORY_WARNING_MB: "memory.warningThresholdMB",

  // Development Configuration
  NODE_ENV: "development.enableTestMode", // maps test/development to boolean
} as const;

// Helper type for environment variable keys
export type EnvironmentVariableKey = keyof typeof ENVIRONMENT_VARIABLE_MAP;

// Default configuration values (applied by schema defaults)
