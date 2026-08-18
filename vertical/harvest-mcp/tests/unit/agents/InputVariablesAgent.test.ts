import { beforeEach, describe, expect, it } from "vitest";
import {
  convertLLMResponse,
  createFunctionDefinition,
  createPrompt,
  findPresentVariables,
  identifyInputVariables,
  updateDynamicParts,
} from "../../../src/agents/InputVariablesAgent.js";
import { Request } from "../../../src/models/Request.js";

describe("InputVariablesAgent", () => {
  let mockRequest: Request;
  let mockCurlCommand: string;
  let mockInputVariables: Record<string, string>;

  beforeEach(() => {
    mockRequest = new Request(
      "POST",
      "https://api.example.com/transfer",
      {
        Authorization: "Bearer token123",
        "Content-Type": "application/json",
      },
      {
        account_id: "acc123",
      },
      {
        amount: "100.50",
        recipient: "john@example.com",
        description: "Monthly payment",
        category: "utilities",
      }
    );

    mockCurlCommand = mockRequest.toCurlCommand();

    mockInputVariables = {
      transfer_amount: "100.50",
      recipient_email: "john@example.com",
      payment_description: "Monthly payment",
      expense_category: "utilities",
      non_present_variable: "not_in_curl",
    };
  });

  describe("identifyInputVariables", () => {
    it("should return empty result when no input variables provided", async () => {
      const result = await identifyInputVariables(mockCurlCommand, {});

      expect(result.identifiedVariables).toEqual({});
      expect(result.removedDynamicParts).toEqual([]);
    });

    it("should identify variables present in curl command", () => {
      // Test the matching logic without LLM
      const presentVariables = findPresentVariables(
        mockInputVariables,
        mockCurlCommand
      );

      expect(presentVariables).toContain("100.50");
      expect(presentVariables).toContain("john@example.com");
      expect(presentVariables).toContain("Monthly payment");
      expect(presentVariables).toContain("utilities");
      expect(presentVariables).not.toContain("not_in_curl");
    });

    it("should convert LLM response to proper format", () => {
      const llmResponse = [
        { variable_name: "transfer_amount", variable_value: "100.50" },
        {
          variable_name: "recipient_email",
          variable_value: "john@example.com",
        },
      ];

      const converted = convertLLMResponse(llmResponse);

      expect(converted).toEqual({
        transfer_amount: "100.50",
        recipient_email: "john@example.com",
      });
    });

    it("should update dynamic parts by removing identified variables", () => {
      const dynamicParts = [
        "token123",
        "100.50",
        "john@example.com",
        "unknown_token",
      ];
      const identifiedVariables = {
        transfer_amount: "100.50",
        recipient_email: "john@example.com",
      };

      const result = updateDynamicParts(dynamicParts, identifiedVariables);

      expect(result).toEqual(["token123", "unknown_token"]);
    });
  });

  describe("createFunctionDefinition", () => {
    it("should create proper function definition", () => {
      const functionDef = createFunctionDefinition();

      expect(functionDef.name).toBe("identify_input_variables");
      expect(functionDef.description).toBe(
        "Identify input variables present in the cURL command."
      );
      expect(functionDef.parameters?.properties).toBeDefined();
      const properties = functionDef.parameters?.properties;
      expect(properties).toBeDefined();
      if (
        properties &&
        typeof properties === "object" &&
        "identified_variables" in properties
      ) {
        expect(properties.identified_variables).toBeDefined();
      }
      expect(functionDef.parameters?.required).toContain(
        "identified_variables"
      );
    });
  });

  describe("createPrompt", () => {
    it("should create appropriate prompt for LLM analysis", () => {
      const prompt = createPrompt(mockCurlCommand, mockInputVariables);

      expect(prompt).toContain(mockCurlCommand);
      expect(prompt).toContain("Input Variables:");
      expect(prompt).toContain("transfer_amount");
      expect(prompt).toContain("100.50");
      expect(prompt).toContain("No substitutions");
    });

    it("should handle empty input variables gracefully", () => {
      const prompt = createPrompt(mockCurlCommand, {});

      expect(prompt).toContain(mockCurlCommand);
      expect(prompt).toContain("Input Variables: {}");
    });
  });

  describe("findPresentVariables", () => {
    it("should find variables that exist in curl command", () => {
      const present = findPresentVariables(mockInputVariables, mockCurlCommand);

      // Should find all variables that are actually in the curl command
      expect(present.length).toBeGreaterThan(0);
      for (const variable of present) {
        expect(mockCurlCommand).toContain(variable);
      }
    });

    it("should not find variables that do not exist in curl command", () => {
      const inputVars = { non_existent: "not_present_value" };
      const present = findPresentVariables(inputVars, mockCurlCommand);

      expect(present).toEqual([]);
    });
  });

  describe("convertLLMResponse", () => {
    it("should handle empty response", () => {
      const converted = convertLLMResponse([]);
      expect(converted).toEqual({});
    });

    it("should handle malformed response items", () => {
      const malformedResponse = [
        { variable_name: "valid", variable_value: "value" },
        { variable_name: "missing_value", variable_value: "" }, // Provide empty value
        { variable_name: "", variable_value: "missing_name" }, // Provide empty name
        { variable_name: "", variable_value: "empty_name" }, // Empty name
      ];

      const converted = convertLLMResponse(malformedResponse);

      expect(converted).toEqual({
        valid: "value",
      });
    });
  });

  describe("updateDynamicParts", () => {
    it("should preserve parts not in identified variables", () => {
      const dynamicParts = ["token1", "token2", "token3"];
      const identifiedVariables = { var1: "token2" };

      const updated = updateDynamicParts(dynamicParts, identifiedVariables);

      expect(updated).toEqual(["token1", "token3"]);
    });

    it("should handle empty inputs", () => {
      expect(updateDynamicParts([], {})).toEqual([]);
      expect(updateDynamicParts(["token"], {})).toEqual(["token"]);
      expect(updateDynamicParts([], { var: "val" })).toEqual([]);
    });
  });
});
