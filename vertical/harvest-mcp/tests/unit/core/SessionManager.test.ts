import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/SessionManager.js";
import type { SessionStartParams } from "../../../src/types/index.js";

describe("SessionManager", () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    sessionManager.clearAllSessions();
  });

  describe("createSession", () => {
    it("should create a new session with valid parameters", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
        prompt: "search for documents",
        inputVariables: { query: "test" },
      };

      const sessionId = await sessionManager.createSession(params);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionManager.hasSession(sessionId)).toBe(true);

      const session = sessionManager.getSession(sessionId);
      expect(session.prompt).toBe(params.prompt);
      expect(session.state.inputVariables).toEqual(params.inputVariables);
    });

    it("should create session without cookie file", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "search for documents",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      expect(session.cookieData).toBeUndefined();
    });

    it("should throw error for invalid HAR path", async () => {
      const params: SessionStartParams = {
        harPath: "nonexistent.har",
        prompt: "test",
      };

      await expect(sessionManager.createSession(params)).rejects.toThrow();
    });
  });

  describe("getSession", () => {
    it("should return session when it exists", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      expect(session.id).toBe(sessionId);
      expect(session.prompt).toBe(params.prompt);
    });

    it("should throw SessionNotFoundError when session does not exist", () => {
      expect(() => sessionManager.getSession("nonexistent")).toThrow(
        "Session nonexistent not found"
      );
    });
  });

  describe("deleteSession", () => {
    it("should delete existing session", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test",
      };

      const sessionId = await sessionManager.createSession(params);
      expect(sessionManager.hasSession(sessionId)).toBe(true);

      const deleted = sessionManager.deleteSession(sessionId);
      expect(deleted).toBe(true);
      expect(sessionManager.hasSession(sessionId)).toBe(false);
    });

    it("should return false for nonexistent session", () => {
      const deleted = sessionManager.deleteSession("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("listSessions", () => {
    it("should return empty array when no sessions exist", () => {
      const sessions = sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });

    it("should list all active sessions", async () => {
      const params1: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "first session",
      };

      const params2: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "second session",
      };

      const sessionId1 = await sessionManager.createSession(params1);
      const sessionId2 = await sessionManager.createSession(params2);

      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(2);

      const sessionIds = sessions.map((s) => s.id);
      expect(sessionIds).toContain(sessionId1);
      expect(sessionIds).toContain(sessionId2);
    });
  });

  describe("addLog", () => {
    it("should add log entry to session", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test",
      };

      const sessionId = await sessionManager.createSession(params);
      sessionManager.addLog(sessionId, "info", "Test log message", {
        data: "test",
      });

      const logs = sessionManager.getSessionLogs(sessionId);
      expect(logs).toHaveLength(2); // 1 for creation + 1 for our log

      const lastLog = logs[logs.length - 1];
      expect(lastLog?.level).toBe("info");
      expect(lastLog?.message).toBe("Test log message");
      expect(lastLog?.data).toEqual({ data: "test" });
    });

    it("should not add log to nonexistent session", () => {
      sessionManager.addLog("nonexistent", "info", "Test");
      // Should not throw, just silently ignore
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test",
      };

      await sessionManager.createSession(params);

      const stats = sessionManager.getStats();
      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
      expect(stats.completedSessions).toBe(0);
      expect(stats.averageNodeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("analyzeCompletionState", () => {
    it("should return incomplete analysis for new session", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.isComplete).toBe(false);
      expect(analysis.blockers).toContain(
        "Master node has not been identified"
      );
      expect(analysis.blockers).toContain(
        "Target action URL has not been identified"
      );
      expect(analysis.blockers).toContain(
        "2 nodes are still pending in the processing queue"
      );
      expect(analysis.diagnostics.hasMasterNode).toBe(false);
      expect(analysis.diagnostics.hasActionUrl).toBe(false);
      expect(analysis.diagnostics.dagComplete).toBe(true); // Empty DAG is considered "complete"
    });

    it("should provide specific blockers when master node exists but DAG incomplete", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Simulate having a master node but incomplete DAG
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://example.com/api/search";

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.isComplete).toBe(false);
      expect(analysis.blockers).toContain(
        "2 nodes are still pending in the processing queue"
      );
      expect(analysis.diagnostics.hasMasterNode).toBe(true);
      expect(analysis.diagnostics.hasActionUrl).toBe(true);
      expect(analysis.diagnostics.dagComplete).toBe(true); // Empty DAG is considered "complete"
    });

    it("should provide actionable recommendations", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.recommendations).toContain(
        "Run 'analysis_start_primary_workflow' to identify the target action URL"
      );
      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });

    it("should detect complete state when all requirements met", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Simulate complete session state
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://example.com/api/search";
      session.state.toBeProcessedNodes = []; // Clear processing queue for complete state

      // Mock DAG manager to return complete state with at least one node
      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
        getNode: (nodeId: string) => ({
          id: nodeId,
          content: { key: { url: session.state.actionUrl } },
        }),
        areAllNodesParameterClassified: () => true,
        getNodesNeedingClassification: () => [],
        getTrulyDynamicParts: () => [],
        getAllNodes: () =>
          new Map([
            [
              "test-master-node",
              {
                id: "test-master-node",
                content: { key: { url: session.state.actionUrl } },
              },
            ],
          ]),
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.isComplete).toBe(true);
      expect(analysis.blockers).toHaveLength(0);
      expect(analysis.diagnostics.hasMasterNode).toBe(true);
      expect(analysis.diagnostics.hasActionUrl).toBe(true);
      expect(analysis.diagnostics.dagComplete).toBe(true);
    });

    it("should track pending operations in queue", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Simulate pending operations
      session.state.toBeProcessedNodes = ["node1", "node2"];

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.diagnostics.pendingInQueue).toBe(2);
      expect(analysis.diagnostics.queueEmpty).toBe(false);
    });

    it("should provide detailed diagnostics", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.diagnostics).toHaveProperty("hasMasterNode");
      expect(analysis.diagnostics).toHaveProperty("dagComplete");
      expect(analysis.diagnostics).toHaveProperty("queueEmpty");
      expect(analysis.diagnostics).toHaveProperty("totalNodes");
      expect(analysis.diagnostics).toHaveProperty("unresolvedNodes");
      expect(analysis.diagnostics).toHaveProperty("pendingInQueue");
      expect(analysis.diagnostics).toHaveProperty("hasActionUrl");
    });

    it("should handle session with unresolved nodes", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Simulate unresolved nodes
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://example.com/api/search";
      // Add some mock unresolved nodes to the DAG manager (if accessible)

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      expect(analysis.diagnostics.totalNodes).toBeGreaterThanOrEqual(0);
      expect(analysis.diagnostics.unresolvedNodes).toBeGreaterThanOrEqual(0);
    });

    it("should handle nonexistent session gracefully", () => {
      const analysis = sessionManager.analyzeCompletionState("nonexistent");

      expect(analysis.isComplete).toBe(false);
      expect(analysis.blockers).toContain("Failed to analyze session state");
      expect(analysis.recommendations).toContain(
        "Check session exists and is properly initialized"
      );
    });

    it("should include specific guidance in recommendations based on state", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Test different states and their recommendations
      let analysis = sessionManager.analyzeCompletionState(sessionId);
      expect(analysis.recommendations).toContain(
        "Run 'analysis_start_primary_workflow' to identify the target action URL"
      );

      // After initial analysis - still has "No nodes found" blocker
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "https://example.com/api/search";

      analysis = sessionManager.analyzeCompletionState(sessionId);
      expect(analysis.recommendations).toContain(
        "Continue processing with 'analysis_process_next_node' until queue is empty"
      );
    });

    it("should correctly detect actionUrl state synchronization issue", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Simulate the bug scenario: actionUrl is set but hasActionUrl returns false
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl =
        "https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa?sessionId=_95b8n8u&latitude=0&longitude=0";
      session.state.toBeProcessedNodes = []; // Clear processing queue for complete state

      // Mock DAG manager to simulate having a master node
      const mockDAGManager = {
        isComplete: () => true,
        getUnresolvedNodes: () => [],
        getNodeCount: () => 1,
        getNode: (nodeId: string) => ({
          id: nodeId,
          url: session.state.actionUrl,
        }),
        getAllNodes: () =>
          new Map([
            [
              "test-master-node",
              { id: "test-master-node", url: session.state.actionUrl },
            ],
          ]),
        areAllNodesParameterClassified: () => true,
        getNodesNeedingClassification: () => [],
        getTrulyDynamicParts: () => [],
      };
      session.dagManager = mockDAGManager as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      // This test validates the fix: when actionUrl is set, hasActionUrl should be true
      expect(analysis.diagnostics.hasActionUrl).toBe(true);
      expect(analysis.diagnostics.hasMasterNode).toBe(true);

      // The critical check: should NOT have "Target action URL has not been identified" blocker
      expect(analysis.blockers).not.toContain(
        "Target action URL has not been identified"
      );

      // Since we have actionUrl, masterNode, and complete DAG, analysis should be complete
      expect(analysis.isComplete).toBe(true);
      expect(analysis.blockers).toHaveLength(0);
    });

    it("should handle edge case where actionUrl is empty string", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Test edge case: actionUrl is empty string
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = "";

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      // Empty string should be considered as no actionUrl
      expect(analysis.diagnostics.hasActionUrl).toBe(false);
      // Since masterNodeId is set but no actual node exists, expect different blocker
      expect(analysis.blockers).toContain(
        "Master node ID is set but node does not exist in DAG"
      );
    });

    it("should handle edge case where actionUrl is undefined", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Test edge case: actionUrl is undefined
      session.state.masterNodeId = "test-master-node";
      session.state.actionUrl = undefined as any;

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      // Undefined should be considered as no actionUrl
      expect(analysis.diagnostics.hasActionUrl).toBe(false);
      // Since masterNodeId is set but no actual node exists, expect different blocker
      expect(analysis.blockers).toContain(
        "Master node ID is set but node does not exist in DAG"
      );
    });

    it("should recover actionUrl from master node when state sync issue occurs", async () => {
      const params: SessionStartParams = {
        harPath: "tests/fixtures/test-data/pangea_search.har",
        prompt: "test session",
      };

      const sessionId = await sessionManager.createSession(params);
      const session = sessionManager.getSession(sessionId);

      // Create a master node with a URL
      const testUrl = "https://jurisprudencia.jt.jus.br/api/no-auth/pesquisa";
      const nodeContent = {
        key: {
          url: testUrl,
          method: "GET",
          headers: {},
          body: null,
        },
        value: null,
      };

      const masterNodeId = session.dagManager.addNode(
        "master",
        nodeContent as any,
        {
          dynamicParts: [],
        }
      );

      // Set the master node ID but deliberately leave actionUrl unset to simulate the bug
      session.state.masterNodeId = masterNodeId;
      session.state.actionUrl = undefined as any; // Simulate the state sync issue

      // Mock the extended DAG manager methods required for completion analysis
      const mockExtendedMethods = {
        areAllNodesParameterClassified: () => true,
        getNodesNeedingClassification: () => [],
        getTrulyDynamicParts: () => [],
        getAllNodes: () =>
          new Map([[masterNodeId, { id: masterNodeId, url: testUrl }]]),
      };

      // Add missing methods to the existing DAG manager
      Object.assign(session.dagManager, mockExtendedMethods);

      const analysis = sessionManager.analyzeCompletionState(sessionId);

      // The fix should recover the actionUrl from the master node
      expect(session.state.actionUrl).toBe(testUrl);
      expect(analysis.diagnostics.hasActionUrl).toBe(true);
      expect(analysis.diagnostics.hasMasterNode).toBe(true);

      // Should NOT have the blocker since state was recovered
      expect(analysis.blockers).not.toContain(
        "Target action URL has not been identified"
      );
    });
  });
});
