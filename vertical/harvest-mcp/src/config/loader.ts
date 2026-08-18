import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import {
  type CLIArgs,
  ENVIRONMENT_VARIABLE_MAP,
  type EnvironmentVariableKey,
} from "./schema.js";

/**
 * Raw configuration object before validation
 * Supports nested object structure with dot notation
 */
export type RawConfig = Record<string, unknown>;

/**
 * Configuration loading options
 */
export interface ConfigLoaderOptions {
  configFilePath?: string;
  cliArgs?: CLIArgs;
  ignoreConfigFile?: boolean;
  ignoreEnvironment?: boolean;
}

/**
 * Configuration file formats
 */
export type ConfigFileFormat = "json";

/**
 * Load configuration from multiple sources with priority:
 * 1. CLI Arguments (highest priority)
 * 2. Environment Variables
 * 3. Configuration File
 * 4. Defaults (lowest priority, handled by schema)
 */
export class ConfigLoader {
  private readonly projectRoot: string;

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Load complete configuration from all sources
   */
  public load(options: ConfigLoaderOptions = {}): RawConfig {
    const config: RawConfig = {};

    // Step 1: Load configuration file (if exists and not ignored)
    if (!options.ignoreConfigFile) {
      const fileConfig = this.loadConfigFile(options.configFilePath);
      this.mergeConfig(config, fileConfig);
    }

    // Step 2: Load environment variables (if not ignored)
    if (!options.ignoreEnvironment) {
      const envConfig = this.loadEnvironmentVariables();
      this.mergeConfig(config, envConfig);
    }

    // Step 3: Load CLI arguments (highest priority)
    if (options.cliArgs) {
      const cliConfig = this.loadCLIArguments(options.cliArgs);
      this.mergeConfig(config, cliConfig);
    }

    return config;
  }

  /**
   * Load configuration from file (JSON only)
   * Searches for harvest.config.json in project root
   */
  private loadConfigFile(configFilePath?: string): RawConfig {
    const filePaths = configFilePath
      ? [resolve(configFilePath)]
      : this.getDefaultConfigFilePaths();

    for (const filePath of filePaths) {
      if (existsSync(filePath)) {
        try {
          const format = this.detectConfigFileFormat(filePath);
          return this.parseConfigFile(filePath, format);
        } catch (error) {
          throw new Error(
            `Failed to load configuration file ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }
    }

    return {};
  }

  /**
   * Get default configuration file paths to search
   */
  private getDefaultConfigFilePaths(): string[] {
    const basePath = join(this.projectRoot, "harvest.config");
    return [`${basePath}.json`];
  }

  /**
   * Detect configuration file format from extension
   */
  private detectConfigFileFormat(filePath: string): ConfigFileFormat {
    const ext = filePath.split(".").pop()?.toLowerCase();

    switch (ext) {
      case "json":
        return "json";
      default:
        throw new Error(
          `Unsupported configuration file format: ${ext}. Only JSON configuration files are supported.`
        );
    }
  }

  /**
   * Parse configuration file based on format
   */
  private parseConfigFile(
    filePath: string,
    format: ConfigFileFormat
  ): RawConfig {
    const content = readFileSync(filePath, "utf-8");

    switch (format) {
      case "json":
        return JSON.parse(content);

      default:
        throw new Error(`Unsupported configuration file format: ${format}`);
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvironmentVariables(): RawConfig {
    const config: RawConfig = {};

    for (const [envKey, configPath] of Object.entries(
      ENVIRONMENT_VARIABLE_MAP
    )) {
      const envValue = process.env[envKey as EnvironmentVariableKey];

      if (envValue !== undefined) {
        // Special handling for NODE_ENV -> development.enableTestMode
        if (envKey === "NODE_ENV") {
          const isTestOrDev = envValue === "test" || envValue === "development";
          this.setNestedValue(config, configPath, isTestOrDev);
        }
        // Special handling for boolean values
        else if (this.isBooleanEnvVar(configPath)) {
          this.setNestedValue(config, configPath, this.parseBoolean(envValue));
        }
        // Special handling for numeric values
        else if (this.isNumericEnvVar(configPath)) {
          const numValue = this.parseNumber(envValue);
          if (numValue !== null) {
            this.setNestedValue(config, configPath, numValue);
          }
        }
        // String values
        else {
          this.setNestedValue(config, configPath, envValue);
        }
      }
    }

    return config;
  }

  /**
   * Check if a config path should be treated as boolean
   */
  private isBooleanEnvVar(configPath: string): boolean {
    const booleanPaths = [
      "logging.mcpStdio",
      "logging.enableBrowserLogs",
      "logging.enableMemoryLogs",
      "manualSession.browser.headless",
      "artifacts.enabled",
      "artifacts.saveHar",
      "artifacts.saveCookies",
      "artifacts.saveScreenshots",
      "memory.monitoringEnabled",
      "development.enableHotReload",
      "development.debugMode",
      "development.verboseLogging",
      "development.enableTestMode",
    ];

    return booleanPaths.includes(configPath);
  }

  /**
   * Check if a config path should be treated as numeric
   */
  private isNumericEnvVar(configPath: string): boolean {
    const numericPaths = [
      "session.maxSessions",
      "session.timeoutMinutes",
      "session.cleanupIntervalMinutes",
      "manualSession.defaultTimeoutMinutes",
      "manualSession.maxConcurrentSessions",
      "manualSession.browser.viewport.width",
      "manualSession.browser.viewport.height",
      "memory.maxHeapSizeMB",
      "memory.warningThresholdMB",
    ];

    return numericPaths.some((path) => configPath.includes(path));
  }

  /**
   * Parse boolean value from string
   */
  private parseBoolean(value: string): boolean {
    const lowercaseValue = value.toLowerCase();
    return (
      lowercaseValue === "true" ||
      lowercaseValue === "1" ||
      lowercaseValue === "yes"
    );
  }

  /**
   * Parse numeric value from string
   */
  private parseNumber(value: string): number | null {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Load configuration from CLI arguments
   */
  private loadCLIArguments(cliArgs: CLIArgs): RawConfig {
    const config: RawConfig = {};

    // Map CLI arguments to configuration paths
    if (cliArgs.provider) {
      // Handle "google" alias for "gemini"
      const provider =
        cliArgs.provider === "google" ? "gemini" : cliArgs.provider;
      this.setNestedValue(config, "llm.provider", provider);
    }

    if (cliArgs.model) {
      this.setNestedValue(config, "llm.model", cliArgs.model);
    }

    // Handle API keys with priority
    if (cliArgs.openaiApiKey) {
      this.setNestedValue(
        config,
        "llm.providers.openai.apiKey",
        cliArgs.openaiApiKey
      );
    }

    if (cliArgs.googleApiKey) {
      this.setNestedValue(
        config,
        "llm.providers.gemini.apiKey",
        cliArgs.googleApiKey
      );
    }

    // Generic API key (auto-detect provider later)
    if (cliArgs.apiKey && !cliArgs.openaiApiKey && !cliArgs.googleApiKey) {
      // Store generic API key for provider auto-detection
      this.setNestedValue(config, "_genericApiKey", cliArgs.apiKey);
    }

    return config;
  }

  /**
   * Set nested value in configuration object using dot notation
   * Example: setNestedValue(config, "llm.provider", "openai")
   */
  private setNestedValue(obj: RawConfig, path: string, value: unknown): void {
    const keys = path.split(".");
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!key) {
        continue; // Skip empty keys
      }

      if (!(key in current) || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key] as RawConfig;
    }

    const lastKey = keys[keys.length - 1];
    if (lastKey) {
      current[lastKey] = value;
    }
  }

  /**
   * Merge source configuration into target configuration
   * Source takes priority over target
   */
  private mergeConfig(target: RawConfig, source: RawConfig): void {
    for (const [key, value] of Object.entries(source)) {
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        if (!(key in target) || typeof target[key] !== "object") {
          target[key] = {};
        }
        this.mergeConfig(target[key] as RawConfig, value as RawConfig);
      } else {
        target[key] = value;
      }
    }
  }

  /**
   * Expand tilde (~) in paths to home directory
   */
  public static expandPath(path: string): string {
    if (path.startsWith("~/")) {
      return join(homedir(), path.slice(2));
    }
    return path;
  }
}
