import { ZodError } from "zod";
import { ConfigLoader, type ConfigLoaderOptions } from "./loader.js";
import { type Config, ConfigSchema } from "./schema.js";

/**
 * Configuration Manager
 * Handles loading, validation, and providing access to application configuration
 */
export class ConfigManager {
  private static instance: ConfigManager | null = null;
  private _config: Config | null = null;
  private _isInitialized = false;

  private constructor() {}

  /**
   * Get singleton instance of ConfigManager
   */
  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Initialize configuration from all sources
   * This must be called once at application startup
   */
  public initialize(options: ConfigLoaderOptions = {}): Config {
    if (this._isInitialized) {
      throw new Error("Configuration has already been initialized");
    }

    try {
      // Load raw configuration from all sources
      const loader = new ConfigLoader();
      const rawConfig = loader.load(options);

      // Handle generic API key auto-detection
      this.handleGenericApiKey(rawConfig);

      // Expand paths with tilde notation
      this.expandPaths(rawConfig);

      // Parse and validate configuration with schema
      this._config = ConfigSchema.parse(rawConfig);

      // Mark as initialized
      this._isInitialized = true;

      return this._config;
    } catch (error) {
      this.handleInitializationError(error, options);
      throw error; // Re-throw after logging
    }
  }

  /**
   * Get the configuration object
   * Throws error if not initialized
   */
  public getConfig(): Config {
    if (!this._isInitialized || !this._config) {
      throw new Error(
        "Configuration not initialized. Call ConfigManager.initialize() first."
      );
    }
    return this._config;
  }

  /**
   * Check if configuration is initialized
   */
  public isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Reset configuration (useful for testing)
   */
  public reset(): void {
    this._config = null;
    this._isInitialized = false;
  }

  /**
   * Handle generic API key from CLI arguments
   * Auto-detect provider based on key format
   */
  private handleGenericApiKey(rawConfig: Record<string, unknown>): void {
    const genericApiKey = rawConfig._genericApiKey;
    if (!genericApiKey) {
      return;
    }

    // Remove the temporary key
    rawConfig._genericApiKey = undefined;

    // Helper function to ensure nested object structure
    const ensureLLMStructure = (providerName: string) => {
      if (!rawConfig.llm) {
        rawConfig.llm = {};
      }
      const llmConfig = rawConfig.llm as Record<string, unknown>;
      if (!llmConfig.providers) {
        llmConfig.providers = {};
      }
      const providersConfig = llmConfig.providers as Record<string, unknown>;
      if (!providersConfig[providerName]) {
        providersConfig[providerName] = {};
      }
      return providersConfig[providerName] as Record<string, unknown>;
    };

    // Auto-detect provider based on API key format
    if (typeof genericApiKey === "string" && genericApiKey.startsWith("sk-")) {
      // OpenAI API key format
      const openaiConfig = ensureLLMStructure("openai");
      openaiConfig.apiKey = genericApiKey;

      // Set provider if not explicitly set
      const llmConfig = rawConfig.llm as Record<string, unknown>;
      if (!llmConfig.provider) {
        llmConfig.provider = "openai";
      }
    } else if (
      typeof genericApiKey === "string" &&
      genericApiKey.startsWith("AIza")
    ) {
      // Google API key format
      const geminiConfig = ensureLLMStructure("gemini");
      geminiConfig.apiKey = genericApiKey;

      // Set provider if not explicitly set
      const llmConfig = rawConfig.llm as Record<string, unknown>;
      if (!llmConfig.provider) {
        llmConfig.provider = "gemini";
      }
    } else {
      // Unknown format, default to OpenAI
      const openaiConfig = ensureLLMStructure("openai");
      openaiConfig.apiKey = genericApiKey;

      const llmConfig = rawConfig.llm as Record<string, unknown>;
      if (!llmConfig.provider) {
        llmConfig.provider = "openai";
      }
    }
  }

  /**
   * Expand tilde paths in configuration
   */
  private expandPaths(rawConfig: Record<string, unknown>): void {
    if (!rawConfig.paths) {
      return;
    }

    const pathKeys = [
      "sharedDir",
      "outputDir",
      "tempDir",
      "cookiesDir",
      "screenshotsDir",
      "harDir",
    ];

    const pathsConfig = rawConfig.paths as Record<string, unknown>;
    for (const key of pathKeys) {
      const path = pathsConfig[key];
      if (path && typeof path === "string") {
        pathsConfig[key] = ConfigLoader.expandPath(path);
      }
    }
  }

  /**
   * Handle initialization errors with helpful messages
   */
  private handleInitializationError(
    error: unknown,
    options: ConfigLoaderOptions
  ): void {
    if (error instanceof ZodError) {
      const formattedError = this.formatValidationError(error);
      console.error("❌ Configuration validation failed:");
      console.error(formattedError);
      console.error(
        "\n💡 Check your configuration file, environment variables, or CLI arguments."
      );

      // Show configuration sources being used
      if (options.cliArgs && Object.keys(options.cliArgs).length > 0) {
        console.error(
          "\n📝 CLI Arguments:",
          JSON.stringify(options.cliArgs, null, 2)
        );
      }

      console.error(
        "\n📋 For valid configuration options, see the schema in src/config/schema.ts"
      );
    } else if (error instanceof Error) {
      console.error("❌ Configuration loading failed:", error.message);

      if (error.message.includes("configuration file")) {
        console.error(
          "\n💡 Make sure your harvest.config.json file is valid JSON."
        );
      }
    } else {
      console.error("❌ Unknown configuration error:", error);
    }
  }

  /**
   * Format Zod validation errors into human-readable messages
   */
  private formatValidationError(error: ZodError): string {
    const errors = error.errors.map((err) => {
      const path = err.path.length > 0 ? err.path.join(".") : "root";

      // Provide context about which source likely caused the error
      let source = "";
      if (path.startsWith("llm")) {
        source =
          " (check HARVEST_LLM_PROVIDER, HARVEST_OPENAI_API_KEY, or --provider CLI arguments)";
      } else if (path.startsWith("session")) {
        source = " (check HARVEST_MAX_SESSIONS or session configuration)";
      } else if (path.startsWith("paths")) {
        source = " (check HARVEST_SHARED_DIR or path configuration)";
      } else if (path.startsWith("logging")) {
        source = " (check HARVEST_LOG_LEVEL)";
      }

      return `  • ${path}: ${err.message}${source}`;
    });

    return errors.join("\n");
  }
}

// Convenience functions for easy access
let configManager: ConfigManager | null = null;

/**
 * Initialize configuration (must be called once at startup)
 */
export function initializeConfig(options: ConfigLoaderOptions = {}): Config {
  configManager = ConfigManager.getInstance();
  return configManager.initialize(options);
}

/**
 * Get the current configuration
 * Throws error if not initialized
 */
export function getConfig(): Config {
  if (!configManager) {
    configManager = ConfigManager.getInstance();
  }
  return configManager.getConfig();
}

export type { ConfigLoaderOptions } from "./loader.js";
// Re-export essential types for consumers
// ConfigSchema is kept internal - consumers should use getConfig() function
export type { CLIArgs, Config } from "./schema.js";
