import { getLLMClient } from "../core/LLMClient.js";
import type { FunctionDefinition } from "../core/providers/types.js";
import {
  HarvestError,
  type InputVariableItem,
  type InputVariablesResponse,
  type InputVariablesResult,
} from "../types/index.js";

/**
 * Identify input variables present in a cURL command using LLM analysis
 */
export async function identifyInputVariables(
  curlCommand: string,
  inputVariables: Record<string, string>,
  currentDynamicParts: string[] = []
): Promise<InputVariablesResult> {
  // Return early if no input variables provided
  if (!inputVariables || Object.keys(inputVariables).length === 0) {
    return {
      identifiedVariables: {},
      removedDynamicParts: [],
    };
  }

  try {
    const llmClient = getLLMClient();
    const functionDef = createFunctionDefinition();
    const prompt = createPrompt(curlCommand, inputVariables);

    const response = await llmClient.callFunction<InputVariablesResponse>(
      prompt,
      functionDef,
      "identify_input_variables"
    );

    const identifiedVariables = convertLLMResponse(
      response.identified_variables || []
    );
    const removedDynamicParts = updateDynamicParts(
      currentDynamicParts,
      identifiedVariables
    );

    return {
      identifiedVariables,
      removedDynamicParts,
    };
  } catch (error) {
    if (error instanceof HarvestError) {
      throw error;
    }

    throw new HarvestError(
      `Input variables identification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "INPUT_VARIABLES_IDENTIFICATION_FAILED",
      { originalError: error }
    );
  }
}

/**
 * Create the OpenAI function definition for input variables identification
 */
export function createFunctionDefinition(): FunctionDefinition {
  return {
    name: "identify_input_variables",
    description: "Identify input variables present in the cURL command.",
    parameters: {
      type: "object",
      properties: {
        identified_variables: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variable_name: {
                type: "string",
                description: "The original key of the variable",
              },
              variable_value: {
                type: "string",
                description:
                  "The exact version of the variable that is present in the cURL command. This should closely match the value in the provided Input Variables.",
              },
            },
          },
          description: "A list of identified variables and their values.",
        },
      },
      required: ["identified_variables"],
    },
  };
}

/**
 * Create the prompt for LLM analysis
 */
export function createPrompt(
  curlCommand: string,
  inputVariables: Record<string, string>
): string {
  return `cURL: ${curlCommand}
Input Variables: ${JSON.stringify(inputVariables)}

Task:
Identify which input variables (the value in the key-value pair) from the Input Variables provided above are present in the cURL command.

Important:
- If an input variable is found in the cURL, include it in the output.
- Do not include variables that are not provided above.
- The key of the input variable is a description of the variable.
- The value is the value that should closely match the value in the cURL command. No substitutions.
- Only return variables whose values are actually present in the cURL command.`;
}

/**
 * Find variables that are present in the curl command (heuristic approach)
 */
export function findPresentVariables(
  inputVariables: Record<string, string>,
  curlCommand: string
): string[] {
  const presentVariables: string[] = [];

  for (const [, value] of Object.entries(inputVariables)) {
    if (value && curlCommand.includes(value)) {
      presentVariables.push(value);
    }
  }

  return presentVariables;
}

/**
 * Convert LLM response to the expected format
 */
export function convertLLMResponse(
  identifiedVariables: InputVariableItem[]
): Record<string, string> {
  const converted: Record<string, string> = {};

  for (const item of identifiedVariables) {
    // Validate the item has required properties
    if (
      item &&
      typeof item.variable_name === "string" &&
      typeof item.variable_value === "string" &&
      item.variable_name.trim() !== "" &&
      item.variable_value.trim() !== ""
    ) {
      converted[item.variable_name] = item.variable_value;
    }
  }

  return converted;
}

/**
 * Update dynamic parts by removing identified input variables
 */
export function updateDynamicParts(
  currentDynamicParts: string[],
  identifiedVariables: Record<string, string>
): string[] {
  const identifiedValues = Object.values(identifiedVariables);

  return currentDynamicParts.filter((part) => !identifiedValues.includes(part));
}
