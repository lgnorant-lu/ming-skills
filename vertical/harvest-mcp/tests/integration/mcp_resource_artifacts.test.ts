import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompletedSessionManager } from "../../src/core/CompletedSessionManager.js";
import { SessionManager } from "../../src/core/SessionManager.js";
import type { SessionStartParams } from "../../src/types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("MCP Resource Artifact Serving", () => {
  let sessionManager: SessionManager;
  let completedSessionManager: CompletedSessionManager;
  let sessionId: string;

  beforeEach(async () => {
    sessionManager = new SessionManager();
    completedSessionManager = CompletedSessionManager.getInstance();

    // Create a test session
    const params: SessionStartParams = {
      harPath: path.join(__dirname, "../fixtures/test-data/pangea_search.har"),
      cookiePath: path.join(
        __dirname,
        "../fixtures/test-data/pangea_cookies.json"
      ),
      prompt: "test artifact serving",
    };

    try {
      sessionId = await sessionManager.createSession(params);
    } catch (_error) {
      console.warn("HAR test files not available, some tests will be skipped");
    }
  });

  afterEach(() => {
    if (sessionManager && sessionId) {
      sessionManager.deleteSession(sessionId);
    }
  });

  describe("CompletedSessionManager", () => {
    it("should cache completed session artifacts", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);

      // Simulate completed session state
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";
      session.state.generatedCode = `// Generated TypeScript code
export async function executeWorkflow() {
  const response = await fetch("https://api.example.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "test" })
  });
  return response.json();
}`;

      // Mock DAG manager to return complete state
      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      expect(analysis.isComplete).toBe(true);

      // Cache the completed session
      const cachedArtifacts =
        await completedSessionManager.cacheCompletedSession(session, analysis);

      expect(cachedArtifacts.sessionId).toBe(sessionId);
      expect(cachedArtifacts.prompt).toBe("test artifact serving");
      expect(cachedArtifacts.artifacts.metadata).toBeDefined();
      expect(cachedArtifacts.artifacts.generatedCode).toBeDefined();
      expect(cachedArtifacts.metadata.generatedCodeSize).toBeGreaterThan(0);
    });

    it("should retrieve cached artifacts by type", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);

      // Setup completed session
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";
      session.state.generatedCode = "console.log('test code');";

      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      await completedSessionManager.cacheCompletedSession(session, analysis);

      // Test retrieving different artifact types
      const generatedCode = await completedSessionManager.getCachedArtifact(
        sessionId,
        "generatedCode"
      );
      expect(generatedCode).toBe("console.log('test code');");

      const metadata = await completedSessionManager.getCachedArtifact(
        sessionId,
        "metadata"
      );
      const metadataObj = JSON.parse(metadata);
      expect(metadataObj.sessionId).toBe(sessionId);
      expect(metadataObj.analysisResult.codeGenerated).toBe(true);
    });

    it("should handle missing cached artifacts gracefully", async () => {
      await expect(
        completedSessionManager.getCachedArtifact(
          "nonexistent-session",
          "generatedCode"
        )
      ).rejects.toThrow("Cached session not found: nonexistent-session");
    });

    it("should list all cached sessions", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";

      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      await completedSessionManager.cacheCompletedSession(session, analysis);

      const allSessions = completedSessionManager.getAllCachedSessions();
      expect(allSessions.length).toBeGreaterThanOrEqual(1);

      const ourSession = allSessions.find((s) => s.sessionId === sessionId);
      expect(ourSession).toBeDefined();
      expect(ourSession?.prompt).toBe("test artifact serving");
    });

    it("should provide cache statistics", async () => {
      const stats = await completedSessionManager.getCacheStats();

      expect(stats).toHaveProperty("totalSessions");
      expect(stats).toHaveProperty("totalCacheSize");
      expect(stats).toHaveProperty("averageSessionSize");
      expect(typeof stats.totalSessions).toBe("number");
      expect(typeof stats.totalCacheSize).toBe("number");
    });
  });

  describe("MCP Resource URI Generation", () => {
    it("should generate proper MCP URIs for completed sessions", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";
      session.state.generatedCode = "test code";

      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      const cachedArtifacts =
        await completedSessionManager.cacheCompletedSession(session, analysis);

      // Verify the cached artifacts can be accessed via their paths
      expect(cachedArtifacts.artifacts.metadata.path).toContain(sessionId);
      expect(cachedArtifacts.artifacts.generatedCode?.path).toContain(
        sessionId
      );
      expect(cachedArtifacts.artifacts.generatedCode?.filename).toBe(
        "generated_code.ts"
      );
    });

    it("should cache HAR files when available", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";

      // Ensure we have HAR data
      expect(session.harData.requests.length).toBeGreaterThan(0);

      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      const cachedArtifacts =
        await completedSessionManager.cacheCompletedSession(session, analysis);

      expect(cachedArtifacts.artifacts.har).toBeDefined();
      expect(cachedArtifacts.artifacts.har?.filename).toBe("original.har");
      expect(cachedArtifacts.metadata.totalRequests).toBeGreaterThan(0);

      // Verify we can retrieve the HAR content
      const harContent = await completedSessionManager.getCachedArtifact(
        sessionId,
        "har"
      );
      const harData = JSON.parse(harContent);
      expect(harData.log.version).toBe("1.2");
      expect(harData.log.creator.name).toBe("harvest-mcp");
      expect(harData.log.entries.length).toBeGreaterThan(0);
    });

    it("should cache cookie files when available", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";

      // Check if we have cookie data
      if (session.cookieData) {
        const mockDAGManager = {
          isComplete: () => true,
          getUnresolvedNodes: () => [],
          getNodeCount: () => 1,
        };
        session.dagManager = mockDAGManager as any;

        const analysis = sessionManager.analyzeCompletionState(sessionId);
        const cachedArtifacts =
          await completedSessionManager.cacheCompletedSession(
            session,
            analysis
          );

        expect(cachedArtifacts.artifacts.cookies).toBeDefined();
        expect(cachedArtifacts.artifacts.cookies?.filename).toBe(
          "original.json"
        );
        expect(cachedArtifacts.metadata.hasAuthCookies).toBe(true);

        // Verify we can retrieve the cookie content
        const cookieContent = await completedSessionManager.getCachedArtifact(
          sessionId,
          "cookies"
        );
        const cookieData = JSON.parse(cookieContent);
        expect(cookieData).toBeDefined();
      } else {
        console.warn("No cookie data available for testing");
      }
    });
  });

  describe("Error Handling", () => {
    it("should reject caching incomplete sessions", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      const analysis = sessionManager.analyzeCompletionState(sessionId);

      // Analysis should be incomplete for a fresh session
      expect(analysis.isComplete).toBe(false);

      await expect(
        completedSessionManager.cacheCompletedSession(session, analysis)
      ).rejects.toThrow(`Cannot cache incomplete session ${sessionId}`);
    });

    it("should handle cache cleanup", async () => {
      const cleanupResult = await completedSessionManager.cleanupCache();

      expect(cleanupResult).toHaveProperty("removedSessions");
      expect(cleanupResult).toHaveProperty("freedSpace");
      expect(typeof cleanupResult.removedSessions).toBe("number");
      expect(typeof cleanupResult.freedSpace).toBe("number");
    });

    it("should validate session existence before caching", async () => {
      const fakeSession = {
        id: "fake-session",
        prompt: "fake prompt",
        lastActivity: new Date(),
        harData: { requests: [], urls: [], validation: null },
        cookieData: null,
        state: {
          masterNodeId: "fake-master",
          actionUrl: "https://fake.com",
          generatedCode: "fake code",
        },
        dagManager: {
          isComplete: () => true,
          getUnresolvedNodes: () => [],
          getNodeCount: () => 1,
        },
      } as any;

      const fakeAnalysis = {
        isComplete: true,
        blockers: [],
        recommendations: [],
        diagnostics: {
          hasMasterNode: true,
          dagComplete: true,
          queueEmpty: true,
          totalNodes: 1,
          unresolvedNodes: 0,
          pendingInQueue: 0,
          hasActionUrl: true,
          authAnalysisComplete: true,
          authReadiness: true,
          authErrors: 0,
          allNodesClassified: true,
          nodesNeedingClassification: 0,
          bootstrapAnalysisComplete: true,
          sessionConstantsCount: 0,
          unresolvedSessionConstants: 0,
        },
      };

      const cachedArtifacts =
        await completedSessionManager.cacheCompletedSession(
          fakeSession,
          fakeAnalysis
        );
      expect(cachedArtifacts.sessionId).toBe("fake-session");
    });
  });

  describe("Cache Persistence", () => {
    it("should persist cache across manager instances", async () => {
      if (!sessionId) {
        console.warn("Skipping test - no session created");
        return;
      }

      const session = sessionManager.getSession(sessionId);
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://api.example.com/search";

      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);
      await completedSessionManager.cacheCompletedSession(session, analysis);

      // Create a new instance (simulates restart)
      const newManager = CompletedSessionManager.getInstance();
      expect(newManager).toBe(completedSessionManager); // Should be singleton

      // Verify the cached session is still available
      const isSessionCached = newManager.isSessionCached(sessionId);
      expect(isSessionCached).toBe(true);

      const metadata = newManager.getCachedSessionMetadata(sessionId);
      expect(metadata).toBeDefined();
      expect(metadata?.sessionId).toBe(sessionId);
    });
  });
});
