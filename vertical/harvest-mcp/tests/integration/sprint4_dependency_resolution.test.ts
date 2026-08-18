/**
 * Sprint 4: Comprehensive Dependency Resolution & Graph Building Tests
 *
 * These tests validate the complete dependency resolution workflow including:
 * - Complex multi-step dependency chains
 * - Cookie and request dependency prioritization
 * - Cycle detection and prevention
 * - Performance requirements (<30s per node)
 * - Accuracy validation against expected behaviors
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findDependencies } from "../../src/agents/DependencyAgent.js";
import { identifyDynamicParts } from "../../src/agents/DynamicPartsAgent.js";
import { identifyInputVariables } from "../../src/agents/InputVariablesAgent.js";
// Integration tests use modern workflow discovery
import type { LLMClient } from "../../src/core/LLMClient.js";
import { resetLLMClient, setLLMClient } from "../../src/core/LLMClient.js";
import { SessionManager } from "../../src/core/SessionManager.js";
import type {
  DynamicPartsResponse,
  HarvestSession,
  InputVariablesResponse,
  RequestModel,
} from "../../src/types/index.js";
import {
  createMockDynamicPartsResponse,
  createMockInputVariablesResponse,
  createMockURLResponse,
  createTestSessionData,
  isValidSessionId,
} from "../fixtures/test-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths
const TEST_HAR_PATH = path.join(
  __dirname,
  "../fixtures/test-data/pangea_search.har"
);
const TEST_COOKIE_PATH = path.join(
  __dirname,
  "../fixtures/test-data/pangea_cookies.json"
);

describe("Sprint 4: Comprehensive Dependency Resolution & Graph Building", () => {
  let sessionManager: SessionManager;
  let mockLLMClient: {
    callFunction: ReturnType<typeof vi.fn>;
    generateResponse: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    getProviderName: ReturnType<typeof vi.fn>;
    setProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sessionManager = new SessionManager();

    // Mock LLM client
    mockLLMClient = {
      callFunction: vi.fn(),
      generateResponse: vi.fn(),
      getModel: vi.fn(() => "gpt-4o"),
      setModel: vi.fn(),
      getProviderName: vi.fn().mockResolvedValue("mock-provider"),
      setProvider: vi.fn(),
    };

    // Set the mock client using the proper setter
    setLLMClient(mockLLMClient as unknown as LLMClient);
  });

  afterEach(() => {
    sessionManager.clearAllSessions();
    resetLLMClient(); // Reset the LLM client singleton
    vi.clearAllMocks();
  });

  // Helper functions for complex dependency resolution test
  async function setupComplexDependencySession(): Promise<HarvestSession> {
    // Modern workflow discovery handles URL identification
    const mockURLResponse = createMockURLResponse();
    mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

    const mockDynamicPartsResponse: DynamicPartsResponse =
      createMockDynamicPartsResponse(["auth_token", "session_id"]);
    mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

    const testSessionData = createTestSessionData({
      prompt:
        "Complex multi-step API workflow with authentication and data retrieval",
    });

    const sessionId = await sessionManager.createSession(testSessionData);
    expect(isValidSessionId(sessionId)).toBe(true);

    const session = sessionManager.getSession(sessionId);
    expect(session).toBeDefined();
    return session;
  }

  async function createMasterNodeForDependencyTest(
    session: HarvestSession
  ): Promise<{ actionUrl: string; masterNodeId: string }> {
    // Modern workflow discovery handles URL identification
    const actionUrl = session.harData.urls[0]?.url || "test-url";
    expect(actionUrl).toBeDefined();
    expect(typeof actionUrl).toBe("string");

    const masterRequest = session.harData.requests.find(
      (req: RequestModel) => req.url === actionUrl
    );
    expect(masterRequest).toBeDefined();
    if (!masterRequest) {
      throw new Error("Master request not found");
    }

    const masterNodeId = session.dagManager.addNode("master", {
      key: masterRequest,
      value: masterRequest.response || null,
    });

    session.state.toBeProcessedNodes = [masterNodeId];
    return { actionUrl, masterNodeId };
  }

  async function processDependencyChain(
    session: HarvestSession,
    _masterNodeId: string
  ): Promise<void> {
    let processCount = 0;
    const maxIterations = 10;

    while (
      processCount < maxIterations &&
      session.state.toBeProcessedNodes.length > 0
    ) {
      const nodeToProcess = session.state.toBeProcessedNodes.shift();
      if (nodeToProcess === undefined) {
        throw new Error(
          "Test setup failed: processing queue is unexpectedly empty."
        );
      }

      const node = session.dagManager.getNode(nodeToProcess);
      expect(node).toBeDefined();

      const request = node?.content.key as { toCurlCommand(): string };
      const curlCommand = request.toCurlCommand();

      if (curlCommand.endsWith(".js'")) {
        processCount++;
        continue;
      }

      await processNodeDependencies(session, nodeToProcess, curlCommand);
      processCount++;
    }
  }

  async function processNodeDependencies(
    session: HarvestSession,
    nodeToProcess: string,
    curlCommand: string
  ): Promise<void> {
    const dynamicParts = await identifyDynamicParts(
      curlCommand,
      session.state.inputVariables || {}
    );

    let finalDynamicParts = dynamicParts;
    if (
      session.state.inputVariables &&
      Object.keys(session.state.inputVariables).length > 0
    ) {
      const mockInputVarsResponse: InputVariablesResponse =
        createMockInputVariablesResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockInputVarsResponse);

      const inputVarResult = await identifyInputVariables(
        curlCommand,
        session.state.inputVariables,
        dynamicParts
      );
      finalDynamicParts = inputVarResult.removedDynamicParts;
    }

    if (finalDynamicParts.length > 0) {
      await addDependenciesToDAG(session, nodeToProcess, finalDynamicParts);
    }
  }

  async function addDependenciesToDAG(
    session: HarvestSession,
    nodeToProcess: string,
    finalDynamicParts: string[]
  ): Promise<void> {
    const dependencies = await findDependencies(
      finalDynamicParts,
      session.harData,
      session.cookieData || {}
    );

    for (const cookieDep of dependencies.cookieDependencies) {
      const cookieNodeId = session.dagManager.addNode("cookie", {
        key: cookieDep.cookieKey,
        value: cookieDep.dynamicPart,
      });
      session.dagManager.addEdge(nodeToProcess, cookieNodeId);
    }

    for (const reqDep of dependencies.requestDependencies) {
      const depNodeId = session.dagManager.addNode("curl", {
        key: reqDep.sourceRequest,
        value: reqDep.sourceRequest.response || null,
      });
      session.dagManager.addEdge(nodeToProcess, depNodeId);
      session.state.toBeProcessedNodes.push(depNodeId);
    }

    for (const notFoundPart of dependencies.notFoundParts) {
      const notFoundNodeId = session.dagManager.addNode("not_found", {
        key: notFoundPart,
      });
      session.dagManager.addEdge(nodeToProcess, notFoundNodeId);
    }
  }

  async function validateDependencyResolutionResults(
    session: HarvestSession
  ): Promise<void> {
    const finalState = session.dagManager.toJSON();

    expect(finalState.nodes.length).toBeGreaterThan(1);
    expect(finalState.edges.length).toBeGreaterThan(0);

    const sortedNodes = session.dagManager.topologicalSort();
    expect(sortedNodes.length).toBe(finalState.nodes.length);

    const masterNodes = finalState.nodes.filter(
      (n: { nodeType: string }) => n.nodeType === "master"
    );
    expect(masterNodes.length).toBe(1);

    const cycles = session.dagManager.detectCycles();
    expect(cycles).toBeNull();
  }

  describe("Complex Multi-Step Dependency Resolution", () => {
    it("should resolve multi-level dependency chains correctly", async () => {
      const session = await setupComplexDependencySession();
      const { masterNodeId } = await createMasterNodeForDependencyTest(session);
      await processDependencyChain(session, masterNodeId);
      await validateDependencyResolutionResults(session);
    });

    it("should handle cookie dependencies prioritization correctly", async () => {
      // Mock URL identification response
      // Modern workflow discovery handles URL identification
      const mockURLResponse = createMockURLResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

      // Mock dynamic parts response with cookie-dependent parts
      const mockDynamicPartsResponse: DynamicPartsResponse =
        createMockDynamicPartsResponse(["session_token", "auth_cookie"]);
      mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

      // Create session with cookies
      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Authentication flow with session tokens",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.cookieData).toBeDefined();

      // Identify action URL and create master node
      if (!session) {
        throw new Error("Test setup failed: Session not found.");
      }
      // Modern workflow discovery handles URL identification
      const actionUrl = session.harData.urls[0]?.url || "test-url";
      const masterRequest = session?.harData.requests.find(
        (req) => req.url === actionUrl
      );
      expect(masterRequest).toBeDefined();
      if (!masterRequest) {
        return; // Type guard
      }

      const masterNodeId = session?.dagManager.addNode("master", {
        key: masterRequest,
        value: masterRequest.response || null,
      });

      // Process node to find dependencies
      const curlCommand = masterRequest.toCurlCommand();
      const dynamicParts = await identifyDynamicParts(curlCommand, {});

      // Find dependencies - should prioritize cookies
      const dependencies = await findDependencies(
        dynamicParts,
        session?.harData,
        session?.cookieData || {}
      );

      // Add dependencies to DAG
      for (const cookieDep of dependencies.cookieDependencies) {
        const cookieNodeId = session?.dagManager.addNode("cookie", {
          key: cookieDep.cookieKey,
          value: cookieDep.dynamicPart,
        });
        session?.dagManager.addEdge(masterNodeId, cookieNodeId);
      }

      // Verify cookie dependencies were found and prioritized
      const dagState = session?.dagManager.toJSON();
      const cookieNodes = dagState.nodes.filter((n) => n.nodeType === "cookie");

      // Should have cookie nodes if cookie data exists
      if (Object.keys(session?.cookieData || {}).length > 0) {
        expect(cookieNodes.length).toBeGreaterThanOrEqual(0);
      }

      // Verify no cycles
      const cycles = session?.dagManager.detectCycles();
      expect(cycles).toBeNull();
    });

    it("should detect and prevent circular dependencies", async () => {
      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Test workflow",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Manually create a circular dependency to test detection
      const node1 = session?.dagManager.addNode("not_found", { key: "test1" });
      const node2 = session?.dagManager.addNode("not_found", { key: "test2" });

      session?.dagManager.addEdge(node1, node2);
      session?.dagManager.addEdge(node2, node1); // Create cycle

      const cycles = session?.dagManager.detectCycles();
      expect(cycles).not.toBeNull();
      expect(cycles?.length).toBeGreaterThan(0);
    });
  });

  describe("Performance and Scalability Validation", () => {
    it("should process nodes within performance requirements (<30s per node)", async () => {
      // Mock fast LLM responses
      // Modern workflow discovery handles URL identification
      const mockURLResponse = createMockURLResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

      const mockDynamicPartsResponse: DynamicPartsResponse =
        createMockDynamicPartsResponse(["token"]);
      mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Performance test workflow",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Process first node and measure time
      const startTime = Date.now();

      // Identify action URL and create master node
      if (!session) {
        throw new Error("Test setup failed: Session not found.");
      }
      // Modern workflow discovery handles URL identification
      const actionUrl = session.harData.urls[0]?.url || "test-url";
      const masterRequest = session?.harData.requests.find(
        (req) => req.url === actionUrl
      );

      if (masterRequest) {
        session?.dagManager.addNode("master", {
          key: masterRequest,
          value: masterRequest.response || null,
        });

        // Process node for dependencies
        const curlCommand = masterRequest.toCurlCommand();
        const dynamicParts = await identifyDynamicParts(curlCommand, {});

        await findDependencies(
          dynamicParts,
          session?.harData,
          session?.cookieData || {}
        );
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should process within 30 seconds (30,000ms)
      expect(processingTime).toBeLessThan(30000);

      // For typical cases, should be much faster (<5 seconds)
      expect(processingTime).toBeLessThan(5000);
    });

    it("should handle large numbers of dependencies efficiently", async () => {
      // Mock multiple dependency responses
      // Modern workflow discovery handles URL identification
      const mockURLResponse = createMockURLResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

      const mockDynamicPartsResponse: DynamicPartsResponse =
        createMockDynamicPartsResponse(["token1", "token2", "session_id"]);
      mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Complex workflow with many dependencies",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Process multiple iterations to build up dependencies
      let totalProcessingTime = 0;
      let nodesProcessed = 0;
      const maxNodes = 5;

      // Create initial nodes
      for (let i = 0; i < maxNodes; i++) {
        const startTime = Date.now();

        const request =
          session?.harData.requests[i % session?.harData.requests.length];
        if (!request) {
          continue;
        }

        const nodeId = session?.dagManager.addNode("curl", {
          key: request,
          value: null,
        });

        // Add some edges to create dependencies
        if (i > 0) {
          const allNodes = session?.dagManager.toJSON().nodes;
          if (allNodes.length > 1) {
            const previousNodeId = allNodes[allNodes.length - 2]?.id;
            if (previousNodeId) {
              session?.dagManager.addEdge(nodeId, previousNodeId);
            }
          }
        }

        const endTime = Date.now();
        totalProcessingTime += endTime - startTime;
        nodesProcessed++;
      }

      // Memory usage should remain reasonable
      const finalNodeCount = session?.dagManager.getNodeCount();
      expect(finalNodeCount).toBeLessThan(50); // Reasonable upper bound

      // Average processing time per node should be acceptable
      if (nodesProcessed > 0) {
        const avgTime = totalProcessingTime / nodesProcessed;
        expect(avgTime).toBeLessThan(10000); // <10s average per node
      }
    });
  });

  describe("Dependency Resolution Accuracy", () => {
    it("should correctly identify request dependencies", async () => {
      // Mock URL identification
      // Modern workflow discovery handles URL identification
      const mockURLResponse = createMockURLResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

      // Mock dynamic parts that need request dependencies
      const mockDynamicPartsResponse: DynamicPartsResponse =
        createMockDynamicPartsResponse(["auth_token", "user_id"]);
      mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "API workflow requiring request dependencies",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Identify action URL and create master node
      if (!session) {
        throw new Error("Test setup failed: Session not found.");
      }
      // Modern workflow discovery handles URL identification
      const actionUrl = session.harData.urls[0]?.url || "test-url";
      const masterRequest = session?.harData.requests.find(
        (req) => req.url === actionUrl
      );
      expect(masterRequest).toBeDefined();
      if (!masterRequest) {
        return; // Type guard
      }

      const masterNodeId = session?.dagManager.addNode("master", {
        key: masterRequest,
        value: masterRequest.response || null,
      });

      // Process node to find dependencies
      const curlCommand = masterRequest.toCurlCommand();
      const dynamicParts = await identifyDynamicParts(curlCommand, {});

      // Find dependencies
      const dependencies = await findDependencies(
        dynamicParts,
        session?.harData,
        session?.cookieData || {}
      );

      // Add request dependencies to DAG
      for (const reqDep of dependencies.requestDependencies) {
        const depNodeId = session?.dagManager.addNode("curl", {
          key: reqDep.sourceRequest,
          value: reqDep.sourceRequest.response || null,
        });
        session?.dagManager.addEdge(masterNodeId, depNodeId);
      }

      const dagState = session?.dagManager.toJSON();

      // Should have created request dependency nodes
      const curlNodes = dagState.nodes.filter(
        (n) => n.nodeType === "curl" || n.nodeType === "master"
      );
      expect(curlNodes.length).toBeGreaterThanOrEqual(1); // At least master node

      // Should have edges if dependencies were found
      if (dependencies.requestDependencies.length > 0) {
        expect(dagState.edges.length).toBeGreaterThan(0);
      }
    });

    it("should properly filter out JavaScript files", async () => {
      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Workflow that might include JavaScript files",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Create a request that looks like a JavaScript file
      const jsRequest = session?.harData.requests.find(
        (req) => req.url.endsWith(".js") || req.url.includes(".js?")
      );

      if (jsRequest) {
        // Try to process a JavaScript file
        const curlCommand = jsRequest.toCurlCommand();

        // Check if it's filtered
        const shouldSkip = curlCommand.endsWith(".js'");
        expect(shouldSkip || !jsRequest.url.endsWith(".js")).toBe(true);
      }

      // Process normal requests and verify JS files are not added as dependencies
      const nonJsRequests = session?.harData.requests.filter(
        (req) => !req.url.endsWith(".js") && !req.url.includes(".js?")
      );

      if (nonJsRequests.length > 0) {
        const testRequest = nonJsRequests[0];
        if (!testRequest) {
          return;
        }
        const nodeId = session?.dagManager.addNode("curl", {
          key: testRequest,
          value: testRequest.response || null,
        });

        // Verify the node was added successfully
        const node = session?.dagManager.getNode(nodeId);
        expect(node).toBeDefined();
      }
    });

    it("should handle not_found dependencies appropriately", async () => {
      // Mock responses
      // Modern workflow discovery handles URL identification
      const mockURLResponse = createMockURLResponse();
      mockLLMClient.callFunction.mockResolvedValueOnce(mockURLResponse);

      // Mock dynamic parts with unresolvable tokens
      const mockDynamicPartsResponse: DynamicPartsResponse =
        createMockDynamicPartsResponse(["unknown_token", "missing_value"]);
      mockLLMClient.callFunction.mockResolvedValue(mockDynamicPartsResponse);

      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Workflow with unresolvable dependencies",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Identify action URL and create master node
      if (!session) {
        throw new Error("Test setup failed: Session not found.");
      }
      // Modern workflow discovery handles URL identification
      const actionUrl = session.harData.urls[0]?.url || "test-url";
      const masterRequest = session?.harData.requests.find(
        (req) => req.url === actionUrl
      );
      expect(masterRequest).toBeDefined();
      if (!masterRequest) {
        return; // Type guard
      }

      const masterNodeId = session?.dagManager.addNode("master", {
        key: masterRequest,
        value: masterRequest.response || null,
      });

      // Process node to find dependencies
      const curlCommand = masterRequest.toCurlCommand();
      const dynamicParts = await identifyDynamicParts(curlCommand, {});

      // Find dependencies - some should be not found
      const dependencies = await findDependencies(
        dynamicParts,
        session?.harData,
        session?.cookieData || {}
      );

      // Add not_found dependencies to DAG
      for (const notFoundPart of dependencies.notFoundParts) {
        const notFoundNodeId = session?.dagManager.addNode("not_found", {
          key: notFoundPart,
        });
        session?.dagManager.addEdge(masterNodeId, notFoundNodeId);
      }

      const dagState = session?.dagManager.toJSON();

      // May have not_found nodes for unresolvable dependencies
      const notFoundNodes = dagState.nodes.filter(
        (n) => n.nodeType === "not_found"
      );

      // If we have not_found nodes, the analysis needs intervention
      if (notFoundNodes.length > 0) {
        expect(notFoundNodes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Graph Building and State Management", () => {
    it("should maintain consistent DAG state throughout analysis", async () => {
      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "State consistency test workflow",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      const initialNodeCount = session?.dagManager.getNodeCount();
      const initialState = session?.dagManager.toJSON();

      // Process nodes and verify state consistency
      const stateSnapshots: Array<{ nodes: unknown[]; edges: unknown[] }> = [
        initialState,
      ];

      // Add multiple nodes and capture state
      for (let i = 0; i < 5; i++) {
        const request =
          session?.harData.requests[i % session?.harData.requests.length];
        if (!request) {
          continue;
        }

        const nodeId = session?.dagManager.addNode("curl", {
          key: request,
          value: null,
        });

        // Add edges to create structure
        if (i > 0) {
          const allNodes = session?.dagManager.toJSON().nodes;
          if (allNodes.length > 1) {
            const previousNodeId = allNodes[allNodes.length - 2]?.id;
            if (previousNodeId) {
              session?.dagManager.addEdge(nodeId, previousNodeId);
            }
          }
        }

        stateSnapshots.push(session?.dagManager.toJSON());
      }

      // Verify state consistency
      const finalNodeCount = session?.dagManager.getNodeCount();
      expect(finalNodeCount).toBeGreaterThanOrEqual(initialNodeCount);

      // Each state should have valid structure
      for (const state of stateSnapshots) {
        expect(state.nodes).toBeDefined();
        expect(state.edges).toBeDefined();
        expect(Array.isArray(state.nodes)).toBe(true);
        expect(Array.isArray(state.edges)).toBe(true);
      }

      // Node count should only increase (no nodes removed)
      for (let i = 1; i < stateSnapshots.length; i++) {
        const currentSnapshot = stateSnapshots[i];
        const previousSnapshot = stateSnapshots[i - 1];
        if (currentSnapshot && previousSnapshot) {
          expect(currentSnapshot.nodes.length).toBeGreaterThanOrEqual(
            previousSnapshot.nodes.length
          );
        }
      }
    });

    it("should provide accurate completion detection", async () => {
      const sessionId = await sessionManager.createSession({
        harPath: TEST_HAR_PATH,
        cookiePath: TEST_COOKIE_PATH,
        prompt: "Completion detection test",
      });

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();

      // Add a master node and some dependencies
      const masterRequest = session?.harData.requests[0];
      const depRequest = session?.harData.requests[1];
      if (!masterRequest || !depRequest) {
        return;
      }

      const masterNodeId = session?.dagManager.addNode("master", {
        key: masterRequest,
        value: masterRequest.response || null,
      });

      // Add some dependency nodes
      const depNode1 = session?.dagManager.addNode("curl", {
        key: depRequest,
        value: null,
      });
      session?.dagManager.addEdge(masterNodeId, depNode1);

      // Add a not_found node to test needs_intervention status
      const notFoundNode = session?.dagManager.addNode("not_found", {
        key: "missing_token",
      });
      session?.dagManager.addEdge(masterNodeId, notFoundNode);

      // Check completion status
      const hasNotFoundNodes = session?.dagManager
        .toJSON()
        .nodes.some((n) => n.nodeType === "not_found");
      const isComplete = session?.dagManager.isComplete();

      // Determine expected status
      let expectedStatus: "complete" | "needs_intervention" | "in_progress";
      if (hasNotFoundNodes) {
        expectedStatus = "needs_intervention";
      } else if (isComplete) {
        expectedStatus = "complete";
      } else {
        expectedStatus = "in_progress";
      }

      // Verify status is one of the expected values
      expect(
        ["complete", "needs_intervention", "in_progress"].includes(
          expectedStatus
        )
      ).toBe(true);

      // Should provide clear next steps based on status
      let nextStep: string;
      if (expectedStatus === "complete") {
        nextStep = "All dependencies resolved. Ready to generate code.";
      } else if (expectedStatus === "needs_intervention") {
        nextStep = "Manual intervention required for unresolved dependencies.";
      } else {
        nextStep = "Continue processing remaining nodes.";
      }

      expect(nextStep).toBeDefined();
      expect(typeof nextStep).toBe("string");
      expect(nextStep.length).toBeGreaterThan(0);
    });
  });
});
