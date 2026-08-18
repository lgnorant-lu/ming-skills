import type { z } from "zod";

/**
 * Provider-agnostic function parameter definition
 */
export interface FunctionParameter {
  name?: string; // Optional since it's not used in nested parameters
  type: "string" | "number" | "boolean" | "object" | "array" | "integer";
  description?: string;
  required?: boolean;
  enum?: string[];
  properties?: Record<string, FunctionParameter>;
  items?: FunctionParameter;
}

/**
 * Provider-agnostic function definition
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: {
    type: "object";
    properties?: Record<string, FunctionParameter>;
    required?: string[];
  };
}

/**
 * Provider-agnostic message format
 */
export interface Message {
  role: "system" | "user" | "assistant" | "function";
  content: string | null;
  name?: string; // Function name for function messages
  functionCall?: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Provider-agnostic completion options
 */
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  functions?: FunctionDefinition[];
  functionCall?: "auto" | "none" | { name: string };
}

/**
 * Provider-agnostic completion response
 */
export interface CompletionResponse {
  content: string | null;
  functionCall?:
    | {
        name: string;
        arguments: string;
      }
    | undefined;
  usage?:
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  timeout?: number | undefined;
  maxRetries?: number | undefined;
}

/**
 * LLM Provider interface that all providers must implement
 */
export interface ILLMProvider {
  /**
   * Provider name (e.g., 'openai', 'gemini')
   */
  readonly name: string;

  /**
   * Initialize the provider with configuration
   */
  initialize(config: ProviderConfig): Promise<void>;

  /**
   * Generate a completion with optional function calling
   */
  generateCompletion(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse>;

  /**
   * Call a specific function with validation
   */
  callFunction<T extends z.ZodType>(
    messages: Message[],
    functionDef: FunctionDefinition,
    schema: T,
    options?: CompletionOptions
  ): Promise<z.infer<T>>;

  /**
   * Check if the provider is properly configured
   */
  isConfigured(): boolean;

  /**
   * Get the default model for this provider
   */
  getDefaultModel(): string;

  /**
   * Get supported models for this provider
   */
  getSupportedModels(): string[];
}

/**
 * Provider factory function type
 */
export type ProviderFactory = (config: ProviderConfig) => Promise<ILLMProvider>;

/**
 * Provider registry entry
 */
export interface ProviderRegistryEntry {
  name: string;
  factory: ProviderFactory;
  requiredEnvVar: string;
  defaultModel: string;
}
