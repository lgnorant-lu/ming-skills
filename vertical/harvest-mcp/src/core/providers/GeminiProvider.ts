import {
  type GenerativeModel,
  GoogleGenerativeAI,
} from "@google/generative-ai";
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

const logger = createComponentLogger("gemini-provider");

/**
 * Gemini API type definitions
 */
interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
}

interface GeminiProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: GeminiProperty;
  properties?: Record<string, GeminiProperty>;
}

interface GeminiParameters {
  type: "OBJECT";
  properties: Record<string, GeminiProperty>;
  required: string[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiParameters;
}

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
}

interface GeminiCandidate {
  content: {
    parts: GeminiPart[];
  };
  finishReason?: string;
  index?: number;
}

interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface GeminiResponse {
  text(): string;
  functionCalls(): GeminiFunctionCall[] | undefined;
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiApiResult {
  response: GeminiResponse;
}

/**
 * Google Gemini provider implementation
 */
export class GeminiProvider implements ILLMProvider {
  readonly name = "gemini";
  private client?: GoogleGenerativeAI;
  private model?: GenerativeModel;
  private config?: ProviderConfig;

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);

    const modelName = config.model ?? this.getDefaultModel();
    this.model = this.client.getGenerativeModel({ model: modelName });

    logger.info({ model: modelName }, "Gemini provider initialized");
  }

  isConfigured(): boolean {
    return !!this.client && !!this.model && !!this.config?.apiKey;
  }

  getDefaultModel(): string {
    return "gemini-1.5-flash";
  }

  getSupportedModels(): string[] {
    return [
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.5-pro-latest",
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.0-pro",
    ];
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex LLM integration requires multiple conditional paths
  async generateCompletion(
    messages: Message[],
    options?: CompletionOptions
  ): Promise<CompletionResponse> {
    if (!this.client || !this.model) {
      throw new HarvestError(
        "Gemini provider not initialized",
        "PROVIDER_NOT_INITIALIZED"
      );
    }

    const startTime = Date.now();
    const modelName =
      options?.model ?? this.config?.model ?? this.getDefaultModel();
    logger.info({ model: modelName }, "Starting completion");

    try {
      // Use a different model if specified in options
      const model =
        options?.model && options.model !== modelName
          ? this.client.getGenerativeModel({ model: options.model })
          : this.model;

      // Configure generation settings
      const generationConfig: GeminiGenerationConfig = {
        temperature: options?.temperature ?? 0.7,
        ...(options?.maxTokens !== undefined && {
          maxOutputTokens: options.maxTokens,
        }),
        ...(options?.topP !== undefined && { topP: options.topP }),
      };

      // Handle function calling
      if (options?.functions && options.functions.length > 0) {
        // Convert function definitions to Gemini format with proper typing
        const geminiDeclarations = options.functions.map((func) =>
          this.convertToGeminiFunctionDeclaration(func)
        );

        const modelWithFunctions = this.client.getGenerativeModel({
          model: modelName,
          tools: [
            {
              // biome-ignore lint/suspicious/noExplicitAny: Required for Google AI SDK compatibility
              functionDeclarations: geminiDeclarations as any,
            },
          ],
        });

        const chat = modelWithFunctions.startChat({
          history: this.convertMessagesToGeminiHistory(messages.slice(0, -1)),
          generationConfig,
        });

        // Get the last message as the current prompt
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) {
          throw new HarvestError("No messages provided", "NO_MESSAGES");
        }

        // Enhance the prompt for Gemini to encourage function calling
        const enhancedPrompt = `${lastMessage.content || ""}\n\nIMPORTANT: You must respond by calling one of the available functions. Do not provide a text response - use the function calling capability to structure your response.`;

        const result = await chat.sendMessage(enhancedPrompt);

        const duration = Date.now() - startTime;
        logger.info({ duration }, "Completion successful");

        return this.parseGeminiResponse(result as unknown as GeminiApiResult);
      }
      // Regular text generation without functions
      const chat = model.startChat({
        history: this.convertMessagesToGeminiHistory(messages.slice(0, -1)),
        generationConfig,
      });

      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        throw new HarvestError("No messages provided", "NO_MESSAGES");
      }
      const result = await chat.sendMessage(lastMessage.content || "");

      const duration = Date.now() - startTime;
      logger.info({ duration }, "Completion successful");

      return {
        content: result.response.text(),
        usage: result.response.usageMetadata
          ? {
              promptTokens: result.response.usageMetadata.promptTokenCount || 0,
              completionTokens:
                result.response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: result.response.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof HarvestError) {
        throw error;
      }

      // Enhanced error categorization for Gemini-specific issues
      let errorCode = "GEMINI_COMPLETION_FAILED";
      let errorMessage = `Gemini completion failed: ${error instanceof Error ? error.message : "Unknown error"}`;

      if (error instanceof Error) {
        const message = error.message.toLowerCase();

        if (message.includes("api key") || message.includes("authentication")) {
          errorCode = "GEMINI_AUTH_ERROR";
          errorMessage =
            "Gemini API authentication failed. Check your API key.";
        } else if (message.includes("quota") || message.includes("limit")) {
          errorCode = "GEMINI_QUOTA_EXCEEDED";
          errorMessage = "Gemini API quota exceeded. Check your usage limits.";
        } else if (message.includes("rate limit")) {
          errorCode = "GEMINI_RATE_LIMITED";
          errorMessage =
            "Gemini API rate limit exceeded. Please retry after a delay.";
        } else if (message.includes("model") || message.includes("not found")) {
          errorCode = "GEMINI_MODEL_ERROR";
          errorMessage = `Gemini model error: ${error.message}`;
        } else if (message.includes("timeout") || message.includes("network")) {
          errorCode = "GEMINI_NETWORK_ERROR";
          errorMessage = `Gemini network error: ${error.message}`;
        }
      }

      throw new HarvestError(errorMessage, errorCode, {
        originalError: error,
        model: options?.model ?? this.config?.model ?? this.getDefaultModel(),
        provider: "gemini",
      });
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
          temperature: 0.1, // Low temperature for consistent results
        };

        const response = await this.generateCompletion(
          messages,
          completionOptions
        );

        if (!response.functionCall) {
          logger.error(
            {
              responseContent: response.content?.substring(0, 200),
              hasContent: !!response.content,
              functionName: functionDef.name,
              attempt,
              model:
                options?.model ?? this.config?.model ?? this.getDefaultModel(),
            },
            "No function call found in Gemini response"
          );

          throw new HarvestError(
            `No function call found in response. Model: ${options?.model ?? this.config?.model ?? this.getDefaultModel()}, ` +
              `Function: ${functionDef.name}, Attempt: ${attempt}. ` +
              `Response contained: ${response.content?.substring(0, 100) || "no content"}...`,
            "NO_FUNCTION_CALL",
            {
              functionName: functionDef.name,
              model:
                options?.model ?? this.config?.model ?? this.getDefaultModel(),
              attempt,
              responseContent: response.content,
            }
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
          error.code !== "GEMINI_COMPLETION_FAILED" &&
          error.code !== "NO_FUNCTION_CALL"
        ) {
          logger.error(
            { attempt, error: error.message },
            "HarvestError on attempt"
          );
          throw error; // Don't retry validation errors, but allow retry for missing function calls
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

  private convertMessagesToGeminiHistory(
    messages: Message[]
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages.map((msg) => {
      // Gemini uses 'model' instead of 'assistant'
      const role =
        msg.role === "assistant"
          ? "model"
          : msg.role === "system"
            ? "user"
            : msg.role;

      // System messages need to be prefixed in Gemini
      let content = msg.content || "";
      if (msg.role === "system") {
        content = `System: ${content}`;
      }

      return {
        role,
        parts: [{ text: content }],
      };
    });
  }

  private convertToGeminiFunctionDeclaration(
    func: FunctionDefinition
  ): GeminiFunctionDeclaration {
    const declaration: GeminiFunctionDeclaration = {
      name: func.name,
      description: func.description || "",
    };

    if (func.parameters) {
      declaration.parameters = {
        type: "OBJECT",
        properties: {},
        required: func.parameters.required || [],
      };

      if (func.parameters.properties) {
        for (const [key, param] of Object.entries(func.parameters.properties)) {
          declaration.parameters.properties[key] =
            this.convertParameterToGemini(param);
        }
      }
    }

    return declaration;
  }

  private convertParameterToGemini(param: FunctionParameter): GeminiProperty {
    const geminiParam: GeminiProperty = {
      type: this.mapTypeToGemini(param.type),
    };

    if (param.description) {
      geminiParam.description = param.description;
    }

    if (param.enum) {
      geminiParam.enum = param.enum;
    }

    if (param.type === "object" && param.properties) {
      geminiParam.properties = {};
      for (const [key, subParam] of Object.entries(param.properties)) {
        geminiParam.properties[key] = this.convertParameterToGemini(subParam);
      }
    }

    if (param.type === "array" && param.items) {
      geminiParam.items = this.convertParameterToGemini(param.items);
    }

    return geminiParam;
  }

  private mapTypeToGemini(type: string): string {
    switch (type) {
      case "string":
        return "STRING";
      case "number":
      case "integer":
        return "NUMBER";
      case "boolean":
        return "BOOLEAN";
      case "object":
        return "OBJECT";
      case "array":
        return "ARRAY";
      default:
        return "STRING";
    }
  }

  private parseGeminiResponse(result: GeminiApiResult): CompletionResponse {
    const response = result.response;

    logger.debug(
      {
        hasFunctionCallsMethod: typeof response.functionCalls === "function",
        hasCandidates: !!response.candidates,
        candidatesLength: response.candidates?.length,
        responseStructure: Object.keys(response),
      },
      "Parsing Gemini response structure"
    );

    // Check for function calls using the direct method
    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      if (functionCall) {
        logger.debug(
          { functionName: functionCall.name },
          "Found function call via functionCalls() method"
        );
        return {
          content: null,
          functionCall: {
            name: functionCall.name,
            arguments: JSON.stringify(functionCall.args),
          },
          usage: response.usageMetadata
            ? {
                promptTokens: response.usageMetadata.promptTokenCount || 0,
                completionTokens:
                  response.usageMetadata.candidatesTokenCount || 0,
                totalTokens: response.usageMetadata.totalTokenCount || 0,
              }
            : undefined,
        };
      }
    }

    // Also check candidates array (alternative response format)
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.functionCall) {
            logger.debug(
              { functionName: part.functionCall.name },
              "Found function call via candidates array"
            );
            return {
              content: null,
              functionCall: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args),
              },
              usage: response.usageMetadata
                ? {
                    promptTokens: response.usageMetadata.promptTokenCount || 0,
                    completionTokens:
                      response.usageMetadata.candidatesTokenCount || 0,
                    totalTokens: response.usageMetadata.totalTokenCount || 0,
                  }
                : undefined,
            };
          }
        }
      }
    }

    // Regular text response
    const textContent = response.text();
    logger.debug(
      {
        contentLength: textContent?.length,
        hasContent: !!textContent,
      },
      "Returning text response"
    );

    return {
      content: textContent,
      usage: response.usageMetadata
        ? {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
    };
  }
}
