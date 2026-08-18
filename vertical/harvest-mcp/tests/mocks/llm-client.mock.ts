import { vi } from "vitest";
import type {
  FunctionDefinition,
  Message,
} from "../../src/core/providers/types.js";
import type {
  DynamicPartsResponse,
  InputVariablesResponse,
  SimplestRequestResponse,
} from "../../src/types/index.js";

/**
 * LLM Client mocks specifically for unit testing
 * These mocks should ONLY be used in unit tests where we need to isolate LLM calls
 */

export const DEFAULT_MOCK_RESPONSES = {
  // Modern workflow discovery handles URL identification
  identify_end_url: {
    url: "https://api.example.com/search" as const,
  },

  identify_dynamic_parts: {
    dynamic_parts: ["auth_token", "user_id", "session_key"],
  } as DynamicPartsResponse,

  identify_input_variables: {
    identified_variables: [
      { variable_name: "search_term", variable_value: "documents" },
      { variable_name: "user_input", variable_value: "test_value" },
    ],
  } as InputVariablesResponse,

  get_simplest_curl_index: {
    index: 0,
  } as SimplestRequestResponse,
};

/**
 * Creates a fully mocked LLM client for unit tests
 * Use this ONLY when you need to isolate the component being tested from LLM calls
 */
export const createMockLLMClient = (
  customResponses: Partial<typeof DEFAULT_MOCK_RESPONSES> = {}
) => {
  const responses = { ...DEFAULT_MOCK_RESPONSES, ...customResponses };

  return {
    callFunction: vi.fn(
      async (
        _prompt: string,
        _functionDef: FunctionDefinition,
        functionName: string,
        _messages?: Message[]
      ) => {
        // Simulate realistic API delay
        await new Promise((resolve) => setTimeout(resolve, 10));

        switch (functionName) {
          case "identify_end_url":
            return responses.identify_end_url;
          case "identify_dynamic_parts":
            return responses.identify_dynamic_parts;
          case "identify_input_variables":
            return responses.identify_input_variables;
          case "get_simplest_curl_index":
            return responses.get_simplest_curl_index;
          default:
            throw new Error(`Unknown function: ${functionName}`);
        }
      }
    ),

    generateResponse: vi.fn(async (prompt: string, _messages?: Message[]) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return `Mock LLM response for prompt: ${prompt.slice(0, 50)}...`;
    }),

    getModel: vi.fn(() => "gpt-4o"),
    setModel: vi.fn(),
    getProviderName: vi.fn(async () => "openai"),
    setProvider: vi.fn(),
  };
};
