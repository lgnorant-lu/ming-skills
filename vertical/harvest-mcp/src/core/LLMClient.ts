import type { z } from "zod";
import { getConfig } from "../config/index.js";
import { HarvestError } from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";
import {
  createProvider,
  type FunctionDefinition,
  getDefaultProvider,
  type ILLMProvider,
  type Message,
  type ProviderConfig,
} from "./providers/index.js";

const logger = createComponentLogger("llm-client");

/**
 * Client for LLM API integration with function calling support
 * Supports multiple providers (OpenAI, Gemini, etc.)
 * Used for intelligent analysis of HAR data and dependency resolution
 */
export class LLMClient {
  protected provider: ILLMProvider | null = null;
  protected providerPromise: Promise<ILLMProvider> | null = null;
  protected model: string;

  constructor(model?: string) {
    // Use centralized configuration if available, fallback to environment variable
    this.model = model || this.getConfiguredModel();
  }

  /**
   * Get configured model from centralized config or fallback to environment
   */
  private getConfiguredModel(): string {
    try {
      const config = getConfig();
      return config.llm.model || "";
    } catch {
      // Fallback to environment variable if config not available
      return process.env.LLM_MODEL || "";
    }
  }

  /**
   * Get or initialize the provider
   */
  protected async getProvider(): Promise<ILLMProvider> {
    if (this.provider) {
      return this.provider;
    }

    if (this.providerPromise) {
      return this.providerPromise;
    }

    // Use centralized configuration system
    this.providerPromise = getDefaultProvider({
      ...(this.model ? { model: this.model } : {}),
    }).then((provider) => {
      this.provider = provider;
      // Update model if not explicitly set
      if (!this.model) {
        this.model = provider.getDefaultModel();
      }
      return provider;
    });

    return this.providerPromise;
  }

  /**
   * Call LLM with function calling to extract structured data
   */
  async callFunction<T>(
    prompt: string,
    functionDef: FunctionDefinition,
    functionName: string,
    messages?: Message[]
  ): Promise<T> {
    const provider = await this.getProvider();
    logger.info(
      { functionName, provider: provider.name },
      "Starting function call"
    );

    // Convert messages or create from prompt
    const allMessages: Message[] = messages || [
      { role: "user", content: prompt },
    ];

    // Create a simple Zod schema that accepts any object
    // The actual validation happens in the agents
    const schema = {
      parse: (data: unknown) => data as T,
      _def: { typeName: "ZodAny" },
    } as unknown as z.ZodType<T>;

    return provider.callFunction(allMessages, functionDef, schema);
  }

  /**
   * Generate a text response without function calling
   */
  async generateResponse(
    prompt: string,
    messages?: Message[],
    temperature = 0.7
  ): Promise<string> {
    const provider = await this.getProvider();
    const startTime = Date.now();
    logger.info({ provider: provider.name }, "Starting text generation");

    // Convert messages or create from prompt
    const allMessages: Message[] = messages || [
      { role: "user", content: prompt },
    ];

    const response = await provider.generateCompletion(allMessages, {
      temperature,
      ...(this.model ? { model: this.model } : {}),
    });

    const duration = Date.now() - startTime;
    logger.info({ duration }, "Text generation completed");

    if (!response.content) {
      throw new HarvestError(
        "No content found in LLM response",
        "NO_RESPONSE_CONTENT"
      );
    }

    return response.content;
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Set a new model
   */
  setModel(model: string): void {
    this.model = model;
    // Reset provider to force reinitialization with new model
    this.provider = null;
    this.providerPromise = null;
  }

  /**
   * Get the current provider name
   */
  async getProviderName(): Promise<string> {
    const provider = await this.getProvider();
    return provider.name;
  }

  /**
   * Set a specific provider
   */
  async setProvider(
    providerName: string,
    config?: Partial<{ apiKey?: string; model?: string }>
  ): Promise<void> {
    const providerConfig: Partial<ProviderConfig> = {};

    if (config?.apiKey) {
      providerConfig.apiKey = config.apiKey;
    }

    if (config?.model || this.model) {
      providerConfig.model = config?.model || this.model;
    }

    this.provider = await createProvider(providerName, providerConfig);
    this.providerPromise = Promise.resolve(this.provider);
    if (!this.model && this.provider) {
      this.model = this.provider.getDefaultModel();
    }
  }
}

/**
 * Singleton instance for global access
 */
let instance: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!instance) {
    instance = new LLMClient();
  }
  return instance;
}

export function setLLMClient(client: LLMClient): void {
  instance = client;
}

export function resetLLMClient(): void {
  instance = null;
}
