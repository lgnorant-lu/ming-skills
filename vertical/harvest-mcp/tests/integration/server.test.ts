import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/SessionManager.js";
import { SessionIdSchema, SessionStartSchema } from "../../src/types/index.js";

// Mock integration test for the MCP server
describe("MCP Server Integration", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    sessionManager.clearAllSessions();
  });

  describe("Server initialization", () => {
    it("should create MCP server instance", () => {
      const server = new McpServer(
        {
          name: "test-harvest-server",
          version: "1.0.0",
        },
        { capabilities: { logging: {} } }
      );

      expect(server).toBeDefined();
    });

    it("should register tools successfully", () => {
      const server = new McpServer(
        {
          name: "test-harvest-server",
          version: "1.0.0",
        },
        { capabilities: { logging: {} } }
      );

      // Test that we can register tools without errors
      expect(() => {
        server.tool(
          "test.tool",
          "A test tool",
          { message: SessionStartSchema.shape.prompt },
          (params) => {
            return {
              content: [
                {
                  type: "text",
                  text: `Received: ${params.message}`,
                },
              ],
            };
          }
        );
      }).not.toThrow();
    });
  });

  describe("Schema validation", () => {
    it("should validate SessionStartSchema correctly", () => {
      const validData = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test prompt",
        cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
        inputVariables: { key: "value" },
      };

      expect(() => SessionStartSchema.parse(validData)).not.toThrow();
    });

    it("should reject invalid SessionStartSchema", () => {
      const invalidData = {
        prompt: "test prompt",
        // Missing required harPath
      };

      expect(() => SessionStartSchema.parse(invalidData)).toThrow();
    });

    it("should validate SessionIdSchema correctly", () => {
      // Generate a valid UUID for testing
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      const validData = { sessionId: validUuid };

      expect(() => SessionIdSchema.parse(validData)).not.toThrow();
    });

    it("should reject invalid SessionIdSchema", () => {
      const invalidData = { sessionId: "not-a-uuid" };

      expect(() => SessionIdSchema.parse(invalidData)).toThrow();
    });
  });

  describe("End-to-end workflow simulation", () => {
    it("should simulate complete session lifecycle", async () => {
      // Step 1: Create session
      const sessionParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "search for documents",
        inputVariables: { query: "test" },
      };

      const sessionId = await sessionManager.createSession(sessionParams);
      expect(sessionId).toBeDefined();

      // Step 2: Verify session exists
      const session = sessionManager.getSession(sessionId);
      expect(session.prompt).toBe(sessionParams.prompt);
      expect(session.state.inputVariables).toEqual(
        sessionParams.inputVariables
      );

      // Step 3: Add some logs (simulating analysis)
      sessionManager.addLog(sessionId, "info", "Starting analysis");
      sessionManager.addLog(sessionId, "debug", "Processing HAR file");
      sessionManager.addLog(sessionId, "info", "Analysis completed");

      // Step 4: Verify logs
      const logs = sessionManager.getSessionLogs(sessionId);
      expect(logs.length).toBeGreaterThan(3); // Initial log + our 3 logs

      // Step 5: List sessions
      const sessionList = sessionManager.listSessions();
      expect(sessionList).toHaveLength(1);
      const firstSession = sessionList[0];
      expect(firstSession?.id).toBe(sessionId);

      // Step 6: Delete session
      const deleted = sessionManager.deleteSession(sessionId);
      expect(deleted).toBe(true);

      // Step 7: Verify session is gone
      expect(sessionManager.hasSession(sessionId)).toBe(false);
    });

    it("should handle multiple concurrent sessions", async () => {
      const sessions = [];

      // Create multiple sessions
      for (let i = 0; i < 5; i++) {
        const sessionParams = {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          prompt: `session ${i}`,
        };

        const sessionId = await sessionManager.createSession(sessionParams);
        sessions.push(sessionId);
      }

      // Verify all sessions exist
      expect(sessions).toHaveLength(5);
      for (const sessionId of sessions) {
        expect(sessionManager.hasSession(sessionId)).toBe(true);
      }

      // List sessions and verify count
      const sessionList = sessionManager.listSessions();
      expect(sessionList).toHaveLength(5);

      // Clean up
      for (const sessionId of sessions) {
        sessionManager.deleteSession(sessionId);
      }
    });
  });

  describe("Error handling", () => {
    it("should handle file not found errors gracefully", async () => {
      const sessionParams = {
        harPath: "nonexistent.har",
        prompt: "test",
      };

      await expect(
        sessionManager.createSession(sessionParams)
      ).rejects.toThrow();
    });

    it("should handle session not found errors", () => {
      expect(() => sessionManager.getSession("nonexistent")).toThrow(
        "Session nonexistent not found"
      );
    });
  });
});
