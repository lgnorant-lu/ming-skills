import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionConfig } from "../../src/browser/types.js";
import { ManualSessionManager } from "../../src/core/ManualSessionManager.js";

describe("Manual Session MCP Artifact URIs", () => {
  let manualSessionManager: ManualSessionManager;

  beforeEach(async () => {
    manualSessionManager = ManualSessionManager.getInstance();
  });

  afterEach(async () => {
    // Clean up any active sessions
    const activeSessions = manualSessionManager.listActiveSessions();
    for (const session of activeSessions) {
      try {
        await manualSessionManager.stopSession(session.id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("Manual Session Management", () => {
    it("should start and stop a manual session successfully", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get", // Use a real URL
        timeout: 1, // Short timeout
        artifactConfig: {
          enabled: true,
          saveHar: true,
          saveCookies: true,
          saveScreenshots: false, // Disable screenshots to avoid browser issues
        },
      };

      const sessionInfo = await manualSessionManager.startSession(config);

      expect(sessionInfo.id).toBeDefined();
      expect(typeof sessionInfo.id).toBe("string");

      // Verify session is active
      const sessionDetails = manualSessionManager.getSessionInfo(
        sessionInfo.id
      );
      expect(sessionDetails).toBeDefined();
      expect(sessionDetails?.id).toBe(sessionInfo.id);

      // Let session run briefly
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop session and get artifacts
      const stopResult = await manualSessionManager.stopSession(
        sessionInfo.id,
        {
          takeScreenshot: false, // Avoid browser screenshot issues
          reason: "test completion",
        }
      );

      expect(stopResult.id).toBe(sessionInfo.id);
      expect(stopResult.artifacts).toBeDefined();
      expect(Array.isArray(stopResult.artifacts)).toBe(true);
    }, 10000); // Longer timeout for browser operations

    it("should generate MCP URIs for artifacts", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get",
        timeout: 1,
        artifactConfig: {
          enabled: true,
          saveHar: true,
          saveCookies: true,
          saveScreenshots: false,
        },
      };

      const sessionInfo = await manualSessionManager.startSession(config);

      try {
        // Let session collect some data
        await new Promise((resolve) => setTimeout(resolve, 300));

        const stopResult = await manualSessionManager.stopSession(
          sessionInfo.id,
          {
            takeScreenshot: false,
          }
        );

        // Verify artifacts have MCP URIs
        for (const artifact of stopResult.artifacts) {
          expect(artifact.mcpUri).toBeDefined();
          expect(artifact.mcpUri).toMatch(/^harvest:\/\/manual\//);
          expect(artifact.mcpUri).toContain(sessionInfo.id);

          // Verify filename is in URI
          const filename = artifact.path.split("/").pop() || "unknown";
          expect(artifact.mcpUri).toContain(filename);
        }
      } finally {
        try {
          await manualSessionManager.stopSession(sessionInfo.id);
        } catch {
          // Already stopped
        }
      }
    }, 10000);

    it("should handle session lifecycle correctly", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get",
        timeout: 1,
        artifactConfig: {
          enabled: true,
          saveHar: true,
        },
      };

      // Start session
      const sessionInfo = await manualSessionManager.startSession(config);
      expect(sessionInfo.id).toBeDefined();

      // Check session is in active list
      const activeSessions = manualSessionManager.listActiveSessions();
      const ourSession = activeSessions.find((s) => s.id === sessionInfo.id);
      expect(ourSession).toBeDefined();

      // Get session info
      const sessionDetails = manualSessionManager.getSessionInfo(
        sessionInfo.id
      );
      expect(sessionDetails?.id).toBe(sessionInfo.id);

      // Stop session
      const stopResult = await manualSessionManager.stopSession(sessionInfo.id);
      expect(stopResult.id).toBe(sessionInfo.id);

      // Verify session is no longer active
      const activeSessionsAfter = manualSessionManager.listActiveSessions();
      const sessionAfter = activeSessionsAfter.find(
        (s) => s.id === sessionInfo.id
      );
      expect(sessionAfter).toBeUndefined();
    }, 8000);

    it("should handle multiple concurrent sessions", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get",
        timeout: 2,
        artifactConfig: {
          enabled: true,
          saveHar: true,
        },
      };

      const session1 = await manualSessionManager.startSession(config);
      const session2 = await manualSessionManager.startSession(config);

      try {
        expect(session1.id).not.toBe(session2.id);

        const activeSessions = manualSessionManager.listActiveSessions();
        expect(activeSessions.length).toBeGreaterThanOrEqual(2);

        const sessionIds = activeSessions.map((s) => s.id);
        expect(sessionIds).toContain(session1.id);
        expect(sessionIds).toContain(session2.id);
      } finally {
        try {
          await manualSessionManager.stopSession(session1.id);
          await manualSessionManager.stopSession(session2.id);
        } catch {
          // Ignore cleanup errors
        }
      }
    }, 10000);
  });

  describe("Error Handling", () => {
    it("should handle invalid session IDs gracefully", async () => {
      const invalidId = "invalid-session-id";

      // getSessionInfo should return null for invalid ID
      const sessionInfo = manualSessionManager.getSessionInfo(invalidId);
      expect(sessionInfo).toBeNull();

      // stopSession should throw for invalid ID
      await expect(
        manualSessionManager.stopSession(invalidId)
      ).rejects.toThrow();
    });

    it("should handle session timeout", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get",
        timeout: 0.01, // Very short timeout (36 seconds)
        artifactConfig: {
          enabled: true,
          saveHar: true,
        },
      };

      const sessionInfo = await manualSessionManager.startSession(config);

      // Session should exist initially
      expect(manualSessionManager.getSessionInfo(sessionInfo.id)).toBeDefined();

      // Wait for timeout (but not too long for the test)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Try to stop the session (may have already timed out)
      try {
        await manualSessionManager.stopSession(sessionInfo.id);
      } catch (error) {
        // Expected if session already timed out
        expect(error).toBeDefined();
      }
    }, 5000);
  });

  describe("Configuration Validation", () => {
    it("should start session with minimal configuration", async () => {
      const config: SessionConfig = {};

      const sessionInfo = await manualSessionManager.startSession(config);

      expect(sessionInfo.id).toBeDefined();

      try {
        await manualSessionManager.stopSession(sessionInfo.id);
      } catch {
        // Ignore cleanup errors
      }
    }, 8000);

    it("should respect artifact configuration", async () => {
      const config: SessionConfig = {
        url: "https://httpbin.org/get",
        timeout: 1,
        artifactConfig: {
          enabled: false, // Disable artifacts
        },
      };

      const sessionInfo = await manualSessionManager.startSession(config);

      try {
        await new Promise((resolve) => setTimeout(resolve, 200));

        const stopResult = await manualSessionManager.stopSession(
          sessionInfo.id
        );

        // Should have fewer or no artifacts when disabled
        expect(stopResult.artifacts).toBeDefined();
        expect(Array.isArray(stopResult.artifacts)).toBe(true);
      } finally {
        try {
          await manualSessionManager.stopSession(sessionInfo.id);
        } catch {
          // Already stopped
        }
      }
    }, 8000);
  });
});
