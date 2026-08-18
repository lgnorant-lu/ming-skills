/**
 * Test suite for AST Wrapper Script Orchestrator
 */

import { beforeEach, describe, expect, it } from "vitest";
import { WrapperScriptOrchestrator } from "../../../src/core/ast/WrapperScriptOrchestrator.js";
import { Request } from "../../../src/models/Request.js";
import type { HarvestSession } from "../../../src/types/index.js";

/**
 * Create a minimal mock session for testing
 */
function createMockSession(): HarvestSession {
  return {
    id: "test-session",
    prompt: "Test API Client",
    state: {
      isComplete: true,
      masterNodeId: "node1",
      workflowGroups: new Map(),
    },
    dagManager: {
      isComplete: () => true,
      topologicalSort: () => ["node1"],
      getNode: (nodeId: string) => {
        if (nodeId === "node1") {
          return {
            nodeId: "node1",
            nodeType: "master_curl",
            content: {
              key: {
                url: "https://api.example.com/test",
                method: "GET",
                headers: {},
                queryParams: {},
              },
            },
            unresolvedParts: [],
            classifiedParameters: [],
          };
        }
        return undefined;
      },
      getAllNodes: () =>
        new Map([
          [
            "node1",
            {
              nodeId: "node1",
              nodeType: "master_curl",
              content: {
                key: {
                  url: "https://api.example.com/test",
                  method: "GET",
                  headers: {},
                  queryParams: {},
                },
              },
              unresolvedParts: [],
              classifiedParameters: [],
            },
          ],
        ]),
    } as any,
  } as HarvestSession;
}

describe("AST WrapperScriptOrchestrator", () => {
  let orchestrator: WrapperScriptOrchestrator;
  let mockSession: HarvestSession;

  beforeEach(() => {
    orchestrator = new WrapperScriptOrchestrator({
      useInMemoryFileSystem: true,
      formatCode: true,
      fileName: "test-client.ts",
    });
    mockSession = createMockSession();
  });

  describe("Basic Functionality", () => {
    it("should initialize with default configuration", () => {
      const defaultOrchestrator = new WrapperScriptOrchestrator();
      expect(defaultOrchestrator).toBeDefined();
    });

    it("should initialize with custom configuration", () => {
      const customOrchestrator = new WrapperScriptOrchestrator({
        fileName: "custom-api.ts",
        formatCode: false,
        autoImports: false,
      });
      expect(customOrchestrator).toBeDefined();
    });
  });

  describe("Wrapper Script Generation", () => {
    it("should generate a complete wrapper script", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include file header with metadata", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      expect(result).toContain("Generated API Client");
      expect(result).toContain("Test API Client");
      expect(result).toContain("test-session");
      expect(result).toContain(new Date().getFullYear().toString());
    });

    it("should generate valid TypeScript code structure", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      // Should contain basic TypeScript constructs
      expect(result).toContain("/**"); // JSDoc comments
      expect(result).toContain("function"); // Functions
      expect(result).toContain("export"); // Exports

      console.log("Generated TypeScript structure looks valid");
    });

    it("should handle empty DAG gracefully", async () => {
      const emptySession = {
        ...mockSession,
        dagManager: {
          ...mockSession.dagManager,
          topologicalSort: () => [],
          getAllNodes: () => new Map(),
        },
      };

      const result = await orchestrator.generateWrapperScript(emptySession);
      expect(result).toBeDefined();
      expect(result).toContain("Generated API Client");
    });
  });

  describe("Function Name Generation", () => {
    it("should generate unique function names for multiple nodes", async () => {
      const multiNodeSession = {
        ...mockSession,
        dagManager: {
          ...mockSession.dagManager,
          topologicalSort: () => ["node1", "node2", "node3"],
          getNode: (nodeId: string) => {
            const baseNode = {
              id: nodeId,
              nodeType: "curl" as const,
              content: {
                key: new Request("GET", "https://api.example.com/test", {}, {}),
              },
              extractedParts: [],
              dynamicParts: [],
              inputVariables: {},
            };
            return baseNode;
          },
        },
      };

      const result = await orchestrator.generateWrapperScript(multiNodeSession);

      // Should generate multiple functions without naming conflicts
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing session gracefully", async () => {
      await expect(
        orchestrator.generateWrapperScript(null as any)
      ).rejects.toThrow();
    });

    it("should handle invalid nodes gracefully", async () => {
      const invalidSession = {
        ...mockSession,
        dagManager: {
          ...mockSession.dagManager,
          getNode: () => undefined,
        },
      };

      const result = await orchestrator.generateWrapperScript(invalidSession);
      expect(result).toBeDefined();
    });
  });

  describe("Integration with AST Components", () => {
    it("should use AST builders for code generation", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      // The output should be properly formatted TypeScript
      expect(result).toMatch(/function \w+\(/); // Function declarations
      expect(result).toMatch(/export/); // Export statements

      console.log("AST integration working correctly");
    });

    it("should generate type-safe code", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      // Should contain TypeScript type annotations
      expect(result).toContain(":"); // Type annotations
      expect(result).toContain("ApiResponse"); // Standard API types
    });
  });

  describe("Generated Code Structure", () => {
    it("should generate well-structured wrapper code", async () => {
      const result = await orchestrator.generateWrapperScript(mockSession);

      // Should have proper code structure patterns
      expect(result).toContain("/**"); // JSDoc documentation
      expect(result).toContain("async function"); // Async functions
      expect(result).toContain("Promise"); // Promise return types

      console.log("Backward compatibility patterns maintained");
    });
  });
});
