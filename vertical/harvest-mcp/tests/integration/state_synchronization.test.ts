import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionManager } from "../../src/core/SessionManager.js";
import { Request } from "../../src/models/Request.js";
import { HarvestMCPServer } from "../../src/server.js";
import { handleGenerateWrapperScript } from "../../src/tools/codegenTools.js";
import { handleGetCompletionBlockers } from "../../src/tools/debugTools.js";
import { handleSessionStart } from "../../src/tools/sessionTools.js";

describe("State Synchronization", () => {
  let sessionManager: SessionManager;
  let server: HarvestMCPServer;
  let testSessionId: string;

  beforeEach(async () => {
    server = new HarvestMCPServer();
    sessionManager = server.sessionManager; // Use the server's session manager

    // Create a test session through the server to ensure consistency
    const testHarPath = join(
      process.cwd(),
      "tests/fixtures/test-data/pangea_search.har"
    );
    const sessionResponse = await handleSessionStart(
      {
        harPath: testHarPath,
        prompt: "Test session for state synchronization",
      },
      server.getSessionToolContext()
    );

    // Extract session ID from server response
    const sessionData = JSON.parse(sessionResponse.content[0]?.text as string);
    testSessionId = sessionData.sessionId;
  });

  afterEach(() => {
    sessionManager.clearAllSessions();
  });

  describe("SessionManager.analyzeCompletionState", () => {
    it("should synchronize session state with DAG completion when DAG is complete", async () => {
      const session = sessionManager.getSession(testSessionId);

      // Add a test node with dynamic parts to ensure DAG is initially incomplete
      const testRequest = new Request(
        "GET",
        "https://example.com/api/{id}",
        {}
      );
      const testNodeId = session.dagManager.addNode(
        "curl",
        {
          key: testRequest,
        },
        {
          dynamicParts: ["auth_token", "user_id"],
        }
      );

      // Set up session state conditions required for completion
      session.state.masterNodeId = testNodeId;
      session.state.actionUrl = "https://example.com/api/action";

      // Initially both should be false
      expect(session.state.isComplete).toBe(false);
      expect(session.dagManager.isComplete()).toBe(false);

      // Manually resolve dynamic parts to make DAG complete
      session.dagManager.updateNode(testNodeId, { dynamicParts: [] });

      // Empty the processing queue since we've resolved all nodes manually
      session.state.toBeProcessedNodes = [];

      // DAG should now be complete, but session state should still be false
      expect(session.dagManager.isComplete()).toBe(true);
      expect(session.state.isComplete).toBe(false);

      // Sync completion state
      sessionManager.analyzeCompletionState(testSessionId);

      // Both should now be true
      expect(session.dagManager.isComplete()).toBe(true);
      expect(session.state.isComplete).toBe(true);
    });

    it("should not change session state when DAG is incomplete", () => {
      const session = sessionManager.getSession(testSessionId);

      // Add a test node with dynamic parts to ensure DAG is incomplete
      const testRequest = new Request(
        "POST",
        "https://example.com/api/{token}",
        {}
      );
      const testNodeId = session.dagManager.addNode(
        "curl",
        {
          key: testRequest,
        },
        {
          dynamicParts: ["auth_token"],
        }
      );

      // Set up session state conditions (master node and action URL)
      session.state.masterNodeId = testNodeId;
      session.state.actionUrl = "https://example.com/api/action";

      // Initially both should be false
      expect(session.state.isComplete).toBe(false);
      expect(session.dagManager.isComplete()).toBe(false);

      // Sync completion state
      sessionManager.analyzeCompletionState(testSessionId);

      // Both should still be false
      expect(session.dagManager.isComplete()).toBe(false);
      expect(session.state.isComplete).toBe(false);
    });

    it("should handle invalid session ID gracefully", () => {
      // Should not throw for invalid session ID
      expect(() => {
        sessionManager.analyzeCompletionState("invalid-session-id");
      }).not.toThrow();
    });
  });

  describe("Workflow Integration", () => {
    it("should sync completion state during analysis workflow", async () => {
      const session = sessionManager.getSession(testSessionId);

      // Add a test node with dynamic parts
      const testRequest = new Request(
        "GET",
        "https://example.com/api/test",
        {}
      );
      const testNodeId = session.dagManager.addNode(
        "curl",
        {
          key: testRequest,
        },
        {
          dynamicParts: ["auth_token"],
        }
      );

      // Set up required session state
      session.state.masterNodeId = testNodeId;
      session.state.actionUrl = "https://example.com/api/test";

      // Initially should be incomplete
      expect(session.dagManager.isComplete()).toBe(false);
      expect(session.state.isComplete).toBe(false);

      // Manually resolve dynamic parts
      session.dagManager.updateNode(testNodeId, { dynamicParts: [] });

      // Empty the processing queue since we've resolved all nodes manually
      session.state.toBeProcessedNodes = [];

      // Sync completion state
      sessionManager.analyzeCompletionState(testSessionId);

      // Should now be complete
      expect(session.dagManager.isComplete()).toBe(true);
      expect(session.state.isComplete).toBe(true);
    });

    it("should provide completion blocker analysis", async () => {
      const result = await handleGetCompletionBlockers(
        {
          sessionId: testSessionId,
        },
        server.getCodegenToolContext()
      );

      expect(result).toHaveProperty("content");
      expect(result.content).toBeInstanceOf(Array);
      expect(result.content.length).toBeGreaterThan(0);

      const analysis = JSON.parse(result.content[0]?.text as string);
      expect(analysis).toHaveProperty("status");
      expect(analysis).toHaveProperty("canGenerateCode");
      expect(analysis).toHaveProperty("blockers");
      expect(analysis).toHaveProperty("recommendations");
      expect(analysis).toHaveProperty("diagnostics");

      // Should provide meaningful diagnostics
      expect(analysis.diagnostics).toHaveProperty("dagComplete");
      expect(analysis.diagnostics).toHaveProperty("hasActionUrl");
    });
  });

  describe("Code Generation Prerequisites", () => {
    it("should use DAG completion as primary check for code generation", async () => {
      const session = sessionManager.getSession(testSessionId);

      // Manually create a state where DAG is complete but session state is not
      // (This simulates the bug we're fixing)
      if (session.dagManager.getNodeCount() > 0) {
        // Mark all nodes as resolved
        const dagJson = session.dagManager.toJSON();
        for (const nodeWithId of dagJson.nodes) {
          const node = session.dagManager.getNode(nodeWithId.id);
          if (node) {
            session.dagManager.updateNode(nodeWithId.id, { dynamicParts: [] });
          }
        }
      }

      // DAG is complete but session state is not
      expect(session.dagManager.isComplete()).toBe(true);
      expect(session.state.isComplete).toBe(false);

      // Code generation should now work (using DAG as primary check)
      try {
        const result = await handleGenerateWrapperScript(
          {
            sessionId: testSessionId,
          },
          server.getCodegenToolContext()
        );

        // Should not throw and return valid code
        expect(result).toHaveProperty("content");
        expect(result.content).toBeInstanceOf(Array);
        expect(result.content.length).toBeGreaterThan(0);

        const codeResult = JSON.parse(result.content[0]?.text as string);
        expect(codeResult).toHaveProperty("code");
        expect(typeof codeResult.code).toBe("string");

        // Session state should now be synced
        expect(session.state.isComplete).toBe(true);
      } catch (error) {
        // If it still fails, the error message should be more actionable
        expect((error as Error).message).toContain("Code generation failed");
        expect((error as Error).message).toContain("Recommended actions");
      }
    });
  });

  describe("Error Message Improvements", () => {
    it("should provide actionable error messages when code generation fails", async () => {
      const session = sessionManager.getSession(testSessionId);

      // Add a test node with dynamic parts to ensure analysis is not complete
      const testRequest = new Request(
        "GET",
        "https://example.com/api/{id}",
        {}
      );
      session.dagManager.addNode(
        "curl",
        {
          key: testRequest,
        },
        {
          dynamicParts: ["auth_token"],
        }
      );

      // Ensure analysis is not complete
      expect(session.dagManager.isComplete()).toBe(false);

      try {
        await handleGenerateWrapperScript(
          { sessionId: testSessionId },
          server.getCodegenToolContext()
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Error should be more helpful than before
        expect((error as Error).message).toContain("Code generation failed");
        expect((error as Error).message).toContain(
          "analysis prerequisites not met"
        );

        // Should provide actionable recommendations
        if ((error as any).data?.recommendedActions) {
          expect((error as any).data.recommendedActions).toBeInstanceOf(Array);
          expect((error as any).data.recommendedActions.length).toBeGreaterThan(
            0
          );
        }
      }
    });
  });
});
