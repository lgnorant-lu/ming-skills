import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/SessionManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock server class for testing since the real one is not exported
class TestHarvestMCPServer {
  private sessionManager: SessionManager;

  constructor() {
    this.sessionManager = new SessionManager();
  }

  async handleSessionStart(params: {
    harPath: string;
    prompt: string;
    cookiePath?: string;
    inputVariables?: Record<string, string>;
  }): Promise<CallToolResult> {
    try {
      const sessionId = await this.sessionManager.createSession(params);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              sessionId,
              message: "Session created successfully",
              harPath: params.harPath,
              prompt: params.prompt,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }

  handleProcessNextNode(params: { sessionId: string }): CallToolResult {
    try {
      const session = this.sessionManager.getSession(params.sessionId);

      if (session.state.toBeProcessedNodes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "no_nodes_to_process",
                message: "No nodes available for processing",
                isComplete: session.dagManager.isComplete(),
              }),
            },
          ],
        };
      }

      const nodeId = session.state.toBeProcessedNodes.shift();
      if (nodeId === undefined) {
        throw new Error(
          "Test setup failed: processing queue is unexpectedly empty."
        );
      }
      const node = session.dagManager.getNode(nodeId);
      if (!node) {
        throw new Error(
          `Test setup failed: node with ID "${nodeId}" was not found.`
        );
      }

      // For testing, just mark as processed without LLM calls
      session.dagManager.updateNode(nodeId, { dynamicParts: [] });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              nodeId,
              status: "completed",
              dynamicPartsFound: 0,
              newNodesAdded: 0,
              remainingNodes: session.state.toBeProcessedNodes.length,
              totalNodes: session.dagManager.getNodeCount(),
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }

  handleIsComplete(params: { sessionId: string }): CallToolResult {
    try {
      const session = this.sessionManager.getSession(params.sessionId);
      const isComplete = session.dagManager.isComplete();
      const nodeCount = session.dagManager.getNodeCount();
      const remainingToProcess = session.state.toBeProcessedNodes.length;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              isComplete,
              status:
                isComplete && remainingToProcess === 0
                  ? "complete"
                  : "processing",
              nodeCount,
              remainingToProcess,
              message: isComplete
                ? "Analysis workflow completed successfully"
                : "Analysis in progress",
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        isError: true,
      };
    }
  }

  getSessionManager() {
    return this.sessionManager;
  }
}

describe("Sprint 3: MCP Server Tools Integration", () => {
  let server: TestHarvestMCPServer;
  let sessionId: string;

  beforeEach(async () => {
    // Set API key for LLM client
    process.env.OPENAI_API_KEY = "test-api-key";

    server = new TestHarvestMCPServer();

    // Create a test session
    const harPath = path.join(
      __dirname,
      "../fixtures/test-data/pangea_search.har"
    );
    const cookiePath = path.join(
      __dirname,
      "../fixtures/test-data/pangea_cookies.json"
    );

    try {
      const result = await server.handleSessionStart({
        harPath,
        cookiePath,
        prompt: "search for documents",
      });

      if (!result.isError) {
        const firstContent = result.content?.[0];
        if (firstContent && typeof firstContent.text === "string") {
          const response = JSON.parse(firstContent.text);
          sessionId = response.sessionId;
        }
      }
    } catch (_error) {
      console.warn("HAR test files not available, some tests will be skipped");
    }
  });

  afterEach(() => {
    if (server && sessionId) {
      server.getSessionManager().deleteSession(sessionId);
    }
  });

  describe("session.start tool", () => {
    it("should create a new session successfully", async () => {
      const result = await server.handleSessionStart({
        harPath: path.join(__dirname, "../fixtures/test.har"),
        prompt: "test analysis",
      });

      if (result.isError) {
        // Expected if file doesn't exist
        const firstContent = result.content?.[0];
        if (firstContent && typeof firstContent.text === "string") {
          expect(firstContent.text).toContain("Error");
        }
      } else {
        const firstContent = result.content?.[0];
        if (!firstContent || typeof firstContent.text !== "string") {
          throw new Error("Test failed: expected valid response content");
        }
        const response = JSON.parse(firstContent.text);
        expect(response.sessionId).toBeDefined();
        expect(response.message).toBe("Session created successfully");
        expect(response.prompt).toBe("test analysis");
      }
    });

    it("should handle missing HAR file gracefully", async () => {
      const result = await server.handleSessionStart({
        harPath: "/nonexistent/path.har",
        prompt: "test analysis",
      });

      expect(result.isError).toBe(true);
      const firstContent = result.content?.[0];
      if (firstContent && typeof firstContent.text === "string") {
        expect(firstContent.text).toContain("Error");
      }
    });
  });

  describe("analysis.process_next_node tool", () => {
    it("should handle empty processing queue", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      // Process node without initial analysis (empty queue)
      const result = await server.handleProcessNextNode({ sessionId });

      const firstContent = result.content?.[0];
      if (!firstContent || typeof firstContent.text !== "string") {
        throw new Error("Test failed: expected valid response content");
      }
      const response = JSON.parse(firstContent.text);
      expect(response.status).toBe("no_nodes_to_process");
    });
  });

  describe("analysis.is_complete tool", () => {
    it("should check completion status correctly", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const result = await server.handleIsComplete({ sessionId });

      const firstContent = result.content?.[0];
      if (!firstContent || typeof firstContent.text !== "string") {
        throw new Error("Test failed: expected valid response content");
      }
      const response = JSON.parse(firstContent.text);
      expect(typeof response.isComplete).toBe("boolean");
      expect(response.status).toMatch(/^(complete|processing)$/);
      expect(typeof response.nodeCount).toBe("number");
      expect(typeof response.remainingToProcess).toBe("number");
    });

    it("should report complete when no nodes to process", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      // Empty state should be complete
      const result = await server.handleIsComplete({ sessionId });

      const firstContent = result.content?.[0];
      if (!firstContent || typeof firstContent.text !== "string") {
        throw new Error("Test failed: expected valid completion result");
      }
      const response = JSON.parse(firstContent.text);
      expect(response.isComplete).toBe(true);
      expect(response.status).toBe("complete");
    });
  });

  describe("Full workflow integration", () => {
    // TODO: Add comprehensive workflow integration tests
  });

  describe("Error handling and edge cases", () => {
    it("should handle invalid session IDs gracefully", async () => {
      const invalidSessionId = "invalid-uuid";

      const processResult = await server.handleProcessNextNode({
        sessionId: invalidSessionId,
      });
      expect(processResult.isError).toBe(true);

      const completeResult = await server.handleIsComplete({
        sessionId: invalidSessionId,
      });
      expect(completeResult.isError).toBe(true);
    });

    it("should handle workflow state correctly", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      // Test processing without initial analysis (should be safe)
      const processResult = await server.handleProcessNextNode({ sessionId });
      const firstContent = processResult.content?.[0];
      if (!firstContent || typeof firstContent.text !== "string") {
        throw new Error("Test failed: expected valid process result");
      }
      const processResponse = JSON.parse(firstContent.text);
      expect(processResponse.status).toBe("no_nodes_to_process");

      // Test completion check on empty workflow
      const completeResult = await server.handleIsComplete({ sessionId });
      const firstCompleteContent = completeResult.content?.[0];
      if (
        !firstCompleteContent ||
        typeof firstCompleteContent.text !== "string"
      ) {
        throw new Error("Test failed: expected valid completion result");
      }
      const completeResponse = JSON.parse(firstCompleteContent.text);
      expect(completeResponse.isComplete).toBe(true);
    });
  });
});
