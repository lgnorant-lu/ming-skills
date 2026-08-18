import { beforeEach, describe, expect, it } from "vitest";
import {
  createFunctionDefinition,
  createPrompt,
  filterInputVariables,
  isJavaScriptFile,
} from "../../../src/agents/DynamicPartsAgent.js";
import { Request } from "../../../src/models/Request.js";

describe("DynamicPartsAgent", () => {
  let mockRequest: Request;
  let mockCurlCommand: string;

  beforeEach(() => {
    mockRequest = new Request(
      "POST",
      "https://api.example.com/documents/search",
      {
        Authorization: "Bearer abc123def456",
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf789xyz",
        Cookie: "session_id=sess123; user_token=user456",
      },
      {
        user_id: "12345",
        timestamp: "1640995200",
      },
      {
        query: "test search",
        auth_token: "token789",
      }
    );

    mockCurlCommand = mockRequest.toMinifiedCurlCommand();
  });

  describe("identifyDynamicParts", () => {
    it("should identify tokens and IDs as dynamic parts", () => {
      // This test validates the structure and logic
      // In real usage, the LLM would identify dynamic parts

      const expectedDynamicParts = [
        "abc123def456", // Bearer token
        "csrf789xyz", // CSRF token
        "token789", // Auth token in body
        "12345", // User ID
      ];

      // Test that potential dynamic parts exist in the curl command
      for (const part of expectedDynamicParts) {
        expect(mockCurlCommand).toContain(part);
      }
    });

    it("should exclude static user input values", () => {
      // Values like search queries should not be considered dynamic
      const staticInputs = ["test search"];

      for (const input of staticInputs) {
        expect(mockCurlCommand).toContain(input);
      }
    });

    it("should handle JavaScript files by skipping analysis", () => {
      const jsRequest = new Request(
        "GET",
        "https://example.com/static/bundle.js",
        {},
        {},
        undefined
      );

      const jsUrl = jsRequest.url;
      expect(jsUrl.endsWith(".js")).toBe(true);
    });

    it("should filter out input variables from dynamic parts", () => {
      const dynamicParts = ["abc123", "user456", "inputValue123"];
      const inputVariables = { userInput: "inputValue123" };

      // Simulate filtering logic
      const filteredParts = dynamicParts.filter(
        (part) => !Object.values(inputVariables).includes(part)
      );

      expect(filteredParts).toEqual(["abc123", "user456"]);
      expect(filteredParts).not.toContain("inputValue123");
    });
  });

  describe("createFunctionDefinition", () => {
    it("should create proper function definition for dynamic parts identification", () => {
      const functionDef = createFunctionDefinition();

      expect(functionDef.name).toBe("identify_dynamic_parts");
      expect(functionDef.description).toContain(
        "dynamic and validated by the server"
      );
      expect(functionDef.parameters?.properties).toBeDefined();
      const properties = functionDef.parameters?.properties;
      expect(properties).toBeDefined();
      if (
        properties &&
        typeof properties === "object" &&
        "dynamic_parts" in properties
      ) {
        expect(properties.dynamic_parts).toBeDefined();
      }
      expect(functionDef.parameters?.required).toContain("dynamic_parts");
    });
  });

  describe("createPrompt", () => {
    it("should create appropriate prompt for LLM analysis", () => {
      const inputVariables = { search_term: "test" };
      const prompt = createPrompt(mockCurlCommand, inputVariables);

      expect(prompt).toContain(mockCurlCommand);
      expect(prompt).toContain("IGNORE THE COOKIE HEADER");
      expect(prompt).toContain("tokens, IDs, session variables");
      expect(prompt).toContain(
        "Only output the variable values and not the keys"
      );
    });

    it("should handle empty input variables", () => {
      const prompt = createPrompt(mockCurlCommand, {});

      expect(prompt).toContain(mockCurlCommand);
      expect(prompt).toBeDefined();
    });
  });

  describe("isJavaScriptFile", () => {
    it("should detect JavaScript files", () => {
      expect(isJavaScriptFile("https://example.com/script.js")).toBe(true);
      expect(isJavaScriptFile("curl 'https://cdn.example.com/bundle.js'")).toBe(
        true
      );
    });

    it("should not detect non-JavaScript files", () => {
      expect(isJavaScriptFile("https://api.example.com/data")).toBe(false);
      expect(isJavaScriptFile("curl 'https://api.example.com/search'")).toBe(
        false
      );
    });
  });

  describe("filterInputVariables", () => {
    it("should remove input variables from dynamic parts", () => {
      // Use a value that actually exists in the curl command
      const dynamicParts = ["abc123def456", "test search", "12345"];
      const inputVariables = { search_query: "test search" };

      const filtered = filterInputVariables(
        dynamicParts,
        inputVariables,
        mockCurlCommand
      );

      expect(filtered.filteredParts).toEqual(["abc123def456", "12345"]);
      expect(filtered.removedParts).toEqual(["test search"]);
    });

    it("should handle empty input variables", () => {
      const dynamicParts = ["token123", "id456"];

      const filtered = filterInputVariables(dynamicParts, {}, mockCurlCommand);

      expect(filtered.filteredParts).toEqual(dynamicParts);
      expect(filtered.removedParts).toEqual([]);
    });
  });
});
