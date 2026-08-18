import OpenAI from "openai";
import type {
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { FunctionDefinition as OpenAIFunctionDef } from "openai/resources/shared";
import type { z } from "zod";
import { HarvestError } from "../../types/index.js";
import { createComponentLogger } from "../../utils/logger.js";
import type {
  CompletionOptions,
  CompletionResponse,
  FunctionDefinition,
  FunctionParameter,
  ILLMProvider,
  Message,
  ProviderConfig,
} from "./types.js";

const logger = createComponentLogger("openai-provider");

/**
 * OpenAI provider implementation
 */
export class OpenAIProvider implements ILLMProvider {
  readonly name = "openai";
  private client?: OpenAI;
  private config?: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
      maxRetries: config.maxRetries ?? 3,
    });
    logger.info(
      { model: config.model ?? this.getDefaultModel() },
      "OpenAI provider initialized"
    );
  }

  isConfigured(): boolean {
    return !!this.client && !!this.config?.apiKey;
  }

  getDefaultModel(): string {
    return "gpt-4o";
  }

  getSupportedModels(): string[] {
    return ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"];
  }

  async generateCompletion(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    if (!this.client) {
      throw new HarvestError(
        "OpenAI provider not initialized",
        "PROVIDER_NOT_INITIALIZED"
      );
    }

    const startTime = Date.now();
    logger.info(
      { model: options?.model ?? this.config?.model ?? this.getDefaultModel() },
      "Starting completion"
    );

    try {
      const openAIMessages = this.convertMessages(messages);
      const params: ChatCompletionCreateParams = {
        model: options?.model ?? this.config?.model ?? this.getDefaultModel(),
        messages: openAIMessages,
        temperature: options?.temperature ?? 0.7,
        ...(options?.maxTokens !== undefined && {
          max_tokens: options.maxTokens,
        }),
        ...(options?.topP !== undefined && { top_p: options.topP }),
      };

      if (options?.functions) {
        params.functions = options.functions.map(
          this.convertFunctionDefinition
        );
        if (options.functionCall) {
          if (typeof options.functionCall === "string") {
            params.function_call = options.functionCall;
          } else {
            params.function_call = { name: options.functionCall.name };
          }
        }
      }

      const response = await this.client.chat.completions.create(params);

      const duration = Date.now() - startTime;
      logger.info({ duration }, "Completion successful");

      // Check if response is a stream or completion
      if ("choices" in response) {
        const choice = response.choices[0];
        if (!choice?.message) {
          throw new HarvestError(
            "No message in OpenAI response",
            "NO_RESPONSE_MESSAGE"
          );
        }

        return {
          content: choice.message.content,
          functionCall: choice.message.function_call
            ? {
                name: choice.message.function_call.name,
                arguments: choice.message.function_call.arguments,
              }
            : undefined,
          usage: response.usage
            ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens,
                totalTokens: response.usage.total_tokens,
              }
            : undefined,
        };
      }
      throw new HarvestError(
        "Streaming responses not supported",
        "STREAMING_NOT_SUPPORTED"
      );
    } catch (error) {
      if (error instanceof HarvestError) {
        throw error;
      }

      throw new HarvestError(
        `OpenAI completion failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "OPENAI_COMPLETION_FAILED",
        { originalError: error }
      );
    }
  }

  async callFunction<T extends z.ZodType>(
    messages: Message[],
    functionDef: FunctionDefinition,
    schema: T,
    options?: CompletionOptions
  ): Promise<z.infer<T>> {
    const startTime = Date.now();
    const maxRetries = this.config?.maxRetries ?? 3;
    let lastError: Error | null = null;

    logger.info({ functionName: functionDef.name }, "Starting function call");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const completionOptions: CompletionOptions = {
          ...options,
          functions: [functionDef],
          functionCall: { name: functionDef.name },
          temperature: 0.1, // Low temperature for consistent results
        };

        const response = await this.generateCompletion(
          messages,
          completionOptions
        );

        if (!response.functionCall) {
          throw new HarvestError(
            "No function call found in response",
            "NO_FUNCTION_CALL"
          );
        }

        if (response.functionCall.name !== functionDef.name) {
          throw new HarvestError(
            `Expected function ${functionDef.name}, got ${response.functionCall.name}`,
            "WRONG_FUNCTION_CALL"
          );
        }

        try {
          const parsedArgs = JSON.parse(
            response.functionCall.arguments || "{}"
          );
          const validatedResult = schema.parse(parsedArgs);

          const duration = Date.now() - startTime;
          logger.info({ duration, attempt }, "Function call successful");

          return validatedResult;
        } catch (error) {
          throw new HarvestError(
            "Failed to parse or validate function arguments",
            "INVALID_FUNCTION_ARGS",
            { arguments: response.functionCall.arguments, error }
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          error instanceof HarvestError &&
          error.code !== "OPENAI_COMPLETION_FAILED"
        ) {
          logger.error(
            { attempt, error: error.message },
            "HarvestError on attempt"
          );
          throw error; // Don't retry validation errors
        }

        logger.error(
          { attempt, maxRetries, error: lastError.message },
          "Attempt failed"
        );

        if (attempt === maxRetries) {
          break;
        }

        // Exponential backoff
        const waitTime = 2 ** (attempt - 1) * 1000;
        logger.info({ waitTime, attempt }, "Waiting before retry");
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    throw new HarvestError(
      `Function call failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`,
      "FUNCTION_CALL_FAILED",
      { originalError: lastError, attempts: maxRetries }
    );
  }

  private convertMessages(messages: Message[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === "function") {
        if (!msg.name) {
          throw new Error("Function message must have a name");
        }
        return {
          role: "function" as const,
          name: msg.name,
          content: msg.content || "",
        };
      }

      if (msg.functionCall) {
        return {
          role: "assistant" as const,
          content: msg.content,
          function_call: {
            name: msg.functionCall.name,
            arguments: msg.functionCall.arguments,
          },
        };
      }

      if (msg.role === "system") {
        return {
          role: "system" as const,
          content: msg.content || "",
        };
      }

      if (msg.role === "user") {
        return {
          role: "user" as const,
          content: msg.content || "",
        };
      }

      return {
        role: "assistant" as const,
        content: msg.content || "",
      };
    });
  }

  private convertFunctionDefinition(
    func: FunctionDefinition
  ): OpenAIFunctionDef {
    const result: OpenAIFunctionDef = {
      name: func.name,
    };

    if (func.description) {
      result.description = func.description;
    }

    if (func.parameters) {
      result.parameters = {
        type: "object",
        properties: func.parameters.properties
          ? Object.fromEntries(
              Object.entries(func.parameters.properties).map(([key, param]) => [
                key,
                convertParameter(param),
              ])
            )
          : {},
        required: func.parameters.required,
      };
    }

    return result;
  }
}

/**
 * Convert a FunctionParameter to OpenAI's parameter format
 */
function convertParameter(param: FunctionParameter): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: param.type === "integer" ? "number" : param.type,
  };

  if (param.description) {
    result.description = param.description;
  }

  if (param.enum) {
    result.enum = param.enum;
  }

  if (param.type === "object" && param.properties) {
    result.properties = Object.fromEntries(
      Object.entries(param.properties).map(([key, subParam]) => [
        key,
        convertParameter(subParam),
      ])
    );
  }

  if (param.type === "array" && param.items) {
    result.items = convertParameter(param.items);
  }

  return result;
}
