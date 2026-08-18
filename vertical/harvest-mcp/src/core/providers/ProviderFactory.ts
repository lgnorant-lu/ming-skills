import { getConfig } from "../../config/index.js";
import { HarvestError } from "../../types/index.js";
import { createComponentLogger } from "../../utils/logger.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { OpenAIProvider } from "./OpenAIProvider.js";
import type {
  ILLMProvider,
  ProviderConfig,
  ProviderRegistryEntry,
} from "./types.js";

const logger = createComponentLogger("provider-factory");

/**
 * Registry of available LLM providers
 */
const PROVIDER_REGISTRY: Record<string, ProviderRegistryEntry> = {
  openai: {
    name: "openai",
    factory: async (config) => {
      const provider = new OpenAIProvider();
      await provider.initialize(config);
      return provider;
    },
    requiredEnvVar: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
  },
  gemini: {
    name: "gemini",
    factory: async (config) => {
      const provider = new GeminiProvider();
      await provider.initialize(config);
      return provider;
    },
    requiredEnvVar: "GOOGLE_API_KEY",
    defaultModel: "gemini-1.5-flash",
  },
};

/**
 * Create a provider instance based on the specified provider name
 */
export async function createProvider(
  providerName: string,
  config?: Partial<ProviderConfig>
): Promise<ILLMProvider> {
  const entry = PROVIDER_REGISTRY[providerName.toLowerCase()];

  if (!entry) {
    const availableProviders = Object.keys(PROVIDER_REGISTRY).join(", ");
    throw new HarvestError(
      `Unknown provider: ${providerName}. Available providers: ${availableProviders}`,
      "UNKNOWN_PROVIDER"
    );
  }

  // Get API key from config or environment
  const apiKey = config?.apiKey || process.env[entry.requiredEnvVar];

  if (!apiKey) {
    throw new HarvestError(
      `${entry.requiredEnvVar} is required for ${providerName} provider`,
      "MISSING_API_KEY",
      {
        provider: providerName,
        requiredEnvVar: entry.requiredEnvVar,
        setupInstructions: {
          cliArguments: [
            "Pass API key via CLI arguments:",
            `• --provider=${providerName} --api-key=your-key`,
          ],
          environmentVariable: [
            "Set environment variable:",
            `• export ${entry.requiredEnvVar}=your-${providerName}-key`,
          ],
          getApiKey: [
            "Get API key from:",
            `• ${
              providerName === "openai"
                ? "https://platform.openai.com/account/api-keys"
                : "https://makersuite.google.com/app/apikey"
            }`,
          ],
        },
        nextActions: [
          `1. Get ${providerName.toUpperCase()} API key from the URL above`,
          `2. Configure via CLI arguments: --provider=${providerName} --api-key=your-key`,
          `3. Or set ${entry.requiredEnvVar} environment variable`,
          "4. Run system_config_validate to verify setup",
        ],
      }
    );
  }

  // Merge config with defaults
  const fullConfig: ProviderConfig = {
    apiKey,
    model: config?.model || entry.defaultModel,
    ...(config?.baseUrl !== undefined && { baseUrl: config.baseUrl }),
    ...(config?.timeout !== undefined && { timeout: config.timeout }),
    ...(config?.maxRetries !== undefined && {
      maxRetries: config.maxRetries,
    }),
  };

  logger.info(
    { provider: providerName, model: fullConfig.model },
    "Creating provider instance"
  );

  try {
    return await entry.factory(fullConfig);
  } catch (error) {
    throw new HarvestError(
      `Failed to create ${providerName} provider: ${error instanceof Error ? error.message : "Unknown error"}`,
      "PROVIDER_CREATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Get the default provider based on configuration
 * Priority: CLI args > tool parameters > environment variables
 */
export async function getDefaultProvider(
  config?: Partial<ProviderConfig> & {
    openaiApiKey?: string;
    googleApiKey?: string;
    provider?: string;
    cliConfig?: {
      provider?: string;
      apiKey?: string;
      openaiApiKey?: string;
      googleApiKey?: string;
      model?: string;
    };
  }
): Promise<ILLMProvider> {
  // Priority 1: CLI configuration
  const cliConfig = config?.cliConfig;
  if (cliConfig?.provider) {
    logger.info(
      { provider: cliConfig.provider },
      "Using provider from CLI arguments"
    );
    const apiKey =
      cliConfig.apiKey || cliConfig.openaiApiKey || cliConfig.googleApiKey;
    const cliProviderConfig: Partial<ProviderConfig> = {
      ...config,
      model: cliConfig.model || config?.model,
    };
    if (apiKey) {
      cliProviderConfig.apiKey = apiKey;
    }
    return createProvider(cliConfig.provider, cliProviderConfig);
  }

  // Priority 2: Tool call parameters
  const paramProvider = config?.provider;
  if (paramProvider) {
    logger.info(
      { provider: paramProvider },
      "Using provider from tool parameter"
    );
    return createProvider(paramProvider, config);
  }

  // Priority 3: Environment variables
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider) {
    logger.info(
      { provider: envProvider },
      "Using provider from LLM_PROVIDER env var"
    );
    return createProvider(envProvider, config);
  }

  // Check for API keys: CLI > tool params > environment
  let openaiKey = process.env.OPENAI_API_KEY;
  let googleKey = process.env.GOOGLE_API_KEY;

  // Override with tool parameters
  if (config?.openaiApiKey) {
    openaiKey = config.openaiApiKey;
  }
  if (config?.googleApiKey) {
    googleKey = config.googleApiKey;
  }

  // Override with CLI arguments (highest priority)
  if (cliConfig?.apiKey || cliConfig?.openaiApiKey || cliConfig?.googleApiKey) {
    if (cliConfig.openaiApiKey) {
      openaiKey = cliConfig.openaiApiKey;
    }
    if (cliConfig.googleApiKey) {
      googleKey = cliConfig.googleApiKey;
    }
    // Auto-detect provider for generic --api-key
    if (
      cliConfig.apiKey &&
      !cliConfig.openaiApiKey &&
      !cliConfig.googleApiKey
    ) {
      if (cliConfig.apiKey.startsWith("sk-")) {
        openaiKey = cliConfig.apiKey;
      } else if (cliConfig.apiKey.startsWith("AIza")) {
        googleKey = cliConfig.apiKey;
      }
    }
  }

  if (openaiKey) {
    logger.info("Using OpenAI provider (API key available)");
    return createProvider("openai", { ...config, apiKey: openaiKey });
  }

  if (googleKey) {
    logger.info("Using Gemini provider (API key available)");
    return createProvider("gemini", { ...config, apiKey: googleKey });
  }

  throw new HarvestError(
    "No LLM provider configured. AI-powered analysis features require API key configuration.",
    "NO_PROVIDER_CONFIGURED",
    {
      setupInstructions: {
        cliArguments: [
          "Pass API keys via CLI arguments:",
          "• --provider=openai --api-key=your-openai-key",
          "• --provider=google --api-key=your-google-key",
        ],
        environmentVariables: [
          "Set environment variables:",
          "• export OPENAI_API_KEY=your-openai-key",
          "• export GOOGLE_API_KEY=your-google-key",
          "• export LLM_PROVIDER=openai",
        ],
        mcpClientConfig: [
          "Add to MCP client configuration:",
          '{\n  "mcpServers": {\n    "harvest-mcp": {\n      "env": {\n        "OPENAI_API_KEY": "your-key"\n      }\n    }\n  }\n}',
        ],
      },
      apiKeyUrls: {
        openai: "https://platform.openai.com/account/api-keys",
        google: "https://makersuite.google.com/app/apikey",
      },
      nextActions: [
        "1. Run system_config_validate tool to diagnose configuration issues",
        "2. Get API key from OpenAI or Google AI Studio",
        "3. Configure using CLI arguments or environment variables",
        "4. Test with workflow_analyze_har tool",
      ],
    }
  );
}

/**
 * List available providers
 */
export function getAvailableProviders(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}

/**
 * Validate configuration status and provide setup guidance
 * Checks CLI arguments, environment variables, and provides detailed configuration status
 */
export function validateConfiguration(): {
  isConfigured: boolean;
  availableProviders: string[];
  configuredProviders: string[];
  recommendations: string[];
  warnings: string[];
  configurationSource: string;
} {
  const centralConfig = getConfig();

  // Check configuration from all sources via ConfigManager
  const hasOpenAI = !!centralConfig.llm.providers.openai.apiKey;
  const hasGemini = !!centralConfig.llm.providers.gemini.apiKey;

  // Determine configuration source based on what was loaded
  let configurationSource = "config";
  if (
    process.env.HARVEST_OPENAI_API_KEY ||
    process.env.HARVEST_GOOGLE_API_KEY
  ) {
    configurationSource = "environment";
  }
  // CLI arguments would have been processed during ConfigManager initialization

  const availableProviders = getAvailableProviders();
  const configuredProviders: string[] = [];
  const recommendations: string[] = [];
  const warnings: string[] = [];

  // Check which providers are configured
  if (hasOpenAI) {
    configuredProviders.push("openai");
  }
  if (hasGemini) {
    configuredProviders.push("gemini");
  }

  // Check if any provider is configured
  const isConfigured = configuredProviders.length > 0;

  // Generate recommendations
  if (isConfigured) {
    // Check if explicit provider is set but unavailable
    if (centralConfig?.llm.provider) {
      const configuredProvider = centralConfig.llm.provider;
      if (!configuredProviders.includes(configuredProvider)) {
        warnings.push(
          `Provider is set to '${configuredProvider}' but corresponding API key is not configured`
        );
      }
    }

    // Provide info about configured providers
    if (configuredProviders.length > 1) {
      recommendations.push(
        `Multiple providers configured: ${configuredProviders.join(", ")}. ` +
          "Specify 'provider' in configuration or CLI arguments to explicitly choose one."
      );
    }
  } else {
    recommendations.push(
      "No LLM provider is configured. To enable AI-powered analysis features:"
    );
    recommendations.push(
      "1. PREFERRED: Add CLI arguments when starting the server:"
    );
    recommendations.push("   --provider=openai --api-key=sk-your-openai-key");
    recommendations.push("   --provider=gemini --api-key=AIza-your-google-key");
    recommendations.push("2. Alternative: Set environment variables:");
    recommendations.push(
      "   HARVEST_OPENAI_API_KEY (get from https://platform.openai.com/account/api-keys)"
    );
    recommendations.push(
      "   HARVEST_GOOGLE_API_KEY (get from https://makersuite.google.com/app/apikey)"
    );
    recommendations.push(
      "3. Or create a harvest.config.json file with your configuration"
    );
  }

  return {
    isConfigured,
    availableProviders,
    configuredProviders,
    recommendations,
    warnings,
    configurationSource,
  };
}
