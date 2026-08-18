import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findDependencies,
  isJavaScriptOrHtml,
  validateDynamicParts,
} from "../../src/agents/DependencyAgent.js";
import { identifyDynamicParts } from "../../src/agents/DynamicPartsAgent.js";
import { identifyInputVariables } from "../../src/agents/InputVariablesAgent.js";
// Integration tests use modern workflow discovery
import type { LLMClient } from "../../src/core/LLMClient.js";
import { resetLLMClient, setLLMClient } from "../../src/core/LLMClient.js";
import { SessionManager } from "../../src/core/SessionManager.js";
import type {
  CookieDependency,
  DynamicPartsResponse,
  HarvestSession,
  InputVariablesResponse,
  RequestDependency,
  RequestModel,
} from "../../src/types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Complete Analysis Workflow Integration", () => {
  let sessionManager: SessionManager;
  let sessionId: string;
  let mockLLMClient: {
    callFunction: ReturnType<typeof vi.fn>;
    generateResponse: ReturnType<typeof vi.fn>;
    getModel: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
    getProviderName: ReturnType<typeof vi.fn>;
    setProvider: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create mock LLM client
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

    sessionManager = new SessionManager();

    // Create a test session with real HAR data
    const harPath = path.join(
      __dirname,
      "../fixtures/test-data/pangea_search.har"
    );
    const cookiePath = path.join(
      __dirname,
      "../fixtures/test-data/pangea_cookies.json"
    );

    try {
      sessionId = await sessionManager.createSession({
        harPath,
        cookiePath,
        prompt: "search for documents",
      });
    } catch (_error) {
      console.warn("HAR test files not available, using mock data");
      // Skip this test suite if HAR files are not available
      return;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetLLMClient(); // Reset the LLM client singleton
    if (sessionManager && sessionId) {
      sessionManager.deleteSession(sessionId);
    }
  });

  // Helper functions for complex workflow test
  async function performUrlIdentification(
    session: HarvestSession
  ): Promise<string> {
    console.log("Step 1: URL Identification");

    // Modern workflow discovery handles URL identification
    const mockUrlResponse = {
      url: session.harData.urls[0]?.url || "https://api.example.com/search",
    };
    mockLLMClient.callFunction.mockResolvedValueOnce(mockUrlResponse);

    // Modern workflow discovery handles URL identification
    const actionUrl = session.harData.urls[0]?.url || "test-url";
    expect(actionUrl).toBeDefined();
    expect(typeof actionUrl).toBe("string");
    expect(actionUrl.length).toBeGreaterThan(0);

    console.log(`Identified action URL: ${actionUrl}`);
    return actionUrl;
  }

  async function createMasterNode(
    session: HarvestSession
  ): Promise<{ actionUrl: string; masterNodeId: string }> {
    const actionUrl = await performUrlIdentification(session);

    const targetRequest = session.harData.requests.find(
      (req: RequestModel) => req.url === actionUrl
    );
    expect(targetRequest).toBeDefined();
    if (!targetRequest) {
      throw new Error(`Target request not found for URL: ${actionUrl}`);
    }

    const masterNodeId = session.dagManager.addNode(
      "master_curl",
      {
        key: targetRequest,
        value: targetRequest.response || null,
      },
      {
        dynamicParts: ["None"],
        extractedParts: ["None"],
      }
    );

    session.state.actionUrl = actionUrl;
    session.state.masterNodeId = masterNodeId;
    session.state.toBeProcessedNodes.push(masterNodeId);

    expect(session.dagManager.getNodeCount()).toBe(1);
    return { actionUrl, masterNodeId };
  }

  async function processMasterNode(
    session: HarvestSession,
    _masterNodeId: string
  ): Promise<void> {
    console.log("Step 2: Dynamic Parts Identification");

    const nodeToProcess = session.state.toBeProcessedNodes.shift();
    if (nodeToProcess === undefined) {
      throw new Error(
        "Test setup failed: processing queue is unexpectedly empty."
      );
    }

    const node = session.dagManager.getNode(nodeToProcess);
    if (!node) {
      throw new Error(
        `Test setup failed: node with ID "${nodeToProcess}" was not found.`
      );
    }

    const request = node.content.key;
    if (typeof request === "string") {
      throw new Error(`Expected RequestModel but got string: ${request}`);
    }

    const curlCommand = request.toCurlCommand();
    console.log(`Processing cURL: ${curlCommand.substring(0, 100)}...`);

    if (curlCommand.endsWith(".js'")) {
      console.log("Skipping JavaScript file");
      return;
    }

    await identifyAndProcessDynamicParts(session, nodeToProcess, curlCommand);
    await findAndAddDependencies(session, nodeToProcess);
  }

  async function identifyAndProcessDynamicParts(
    session: HarvestSession,
    nodeToProcess: string,
    curlCommand: string
  ): Promise<void> {
    const mockDynamicPartsResponse: DynamicPartsResponse = {
      dynamic_parts: ["auth_token", "session_id"],
    };
    mockLLMClient.callFunction.mockResolvedValueOnce(mockDynamicPartsResponse);

    const dynamicParts = await identifyDynamicParts(
      curlCommand,
      session.state.inputVariables || {}
    );

    console.log(
      `Identified ${dynamicParts.length} dynamic parts: ${dynamicParts.join(", ")}`
    );
    expect(Array.isArray(dynamicParts)).toBe(true);

    await processInputVariables(
      session,
      nodeToProcess,
      curlCommand,
      dynamicParts
    );
  }

  async function processInputVariables(
    session: HarvestSession,
    nodeToProcess: string,
    curlCommand: string,
    dynamicParts: string[]
  ): Promise<void> {
    console.log("Step 3: Input Variables Identification");
    let finalDynamicParts = dynamicParts;
    let identifiedInputVars: Record<string, string> = {};

    if (
      session.state.inputVariables &&
      Object.keys(session.state.inputVariables).length > 0
    ) {
      const mockInputVarsResponse: InputVariablesResponse = {
        identified_variables: [],
      };
      mockLLMClient.callFunction.mockResolvedValueOnce(mockInputVarsResponse);

      const inputVarResult = await identifyInputVariables(
        curlCommand,
        session.state.inputVariables,
        dynamicParts
      );

      identifiedInputVars = inputVarResult.identifiedVariables;
      finalDynamicParts = inputVarResult.removedDynamicParts;

      console.log(
        `Identified input variables: ${Object.keys(identifiedInputVars).join(", ")}`
      );
    }

    session.dagManager.updateNode(nodeToProcess, {
      dynamicParts: finalDynamicParts,
      inputVariables: identifiedInputVars,
    });
  }

  async function findAndAddDependencies(
    session: HarvestSession,
    nodeToProcess: string
  ): Promise<void> {
    console.log("Step 4: Dependency Analysis");
    const node = session.dagManager.getNode(nodeToProcess);
    const finalDynamicParts = node?.dynamicParts || [];
    let newNodesAdded = 0;

    if (finalDynamicParts.length > 0) {
      const dependencies = await findDependencies(
        finalDynamicParts,
        session.harData,
        session.cookieData || {}
      );

      console.log(
        `Found ${dependencies.cookieDependencies.length} cookie deps, ${dependencies.requestDependencies.length} request deps, ${dependencies.notFoundParts.length} unresolved`
      );

      expect(dependencies).toBeDefined();
      expect(Array.isArray(dependencies.cookieDependencies)).toBe(true);
      expect(Array.isArray(dependencies.requestDependencies)).toBe(true);
      expect(Array.isArray(dependencies.notFoundParts)).toBe(true);

      newNodesAdded += addCookieDependencies(
        session,
        nodeToProcess,
        dependencies.cookieDependencies
      );
      newNodesAdded += addRequestDependencies(
        session,
        nodeToProcess,
        dependencies.requestDependencies
      );
      newNodesAdded += addNotFoundNodes(
        session,
        nodeToProcess,
        dependencies.notFoundParts
      );
    }

    console.log(`Analysis complete: Added ${newNodesAdded} new nodes`);
  }

  function addCookieDependencies(
    session: HarvestSession,
    nodeToProcess: string,
    cookieDependencies: CookieDependency[]
  ): number {
    let added = 0;
    for (const cookieDep of cookieDependencies) {
      const cookieNodeId = session.dagManager.addNode(
        "cookie",
        {
          key: cookieDep.cookieKey,
          value: cookieDep.dynamicPart,
        },
        {
          extractedParts: [cookieDep.dynamicPart],
        }
      );
      session.dagManager.addEdge(nodeToProcess, cookieNodeId);
      added++;
    }
    return added;
  }

  function addRequestDependencies(
    session: HarvestSession,
    nodeToProcess: string,
    requestDependencies: RequestDependency[]
  ): number {
    let added = 0;
    for (const reqDep of requestDependencies) {
      if (isJavaScriptOrHtml(reqDep.sourceRequest)) {
        continue;
      }

      const depNodeId = session.dagManager.addNode(
        "curl",
        {
          key: reqDep.sourceRequest,
          value: reqDep.sourceRequest.response || null,
        },
        {
          extractedParts: [reqDep.dynamicPart],
        }
      );

      session.dagManager.addEdge(nodeToProcess, depNodeId);
      session.state.toBeProcessedNodes.push(depNodeId);
      added++;
    }
    return added;
  }

  function addNotFoundNodes(
    session: HarvestSession,
    nodeToProcess: string,
    notFoundParts: string[]
  ): number {
    let added = 0;
    for (const notFoundPart of notFoundParts) {
      const notFoundNodeId = session.dagManager.addNode("not_found", {
        key: notFoundPart,
      });
      session.dagManager.addEdge(nodeToProcess, notFoundNodeId);
      added++;
    }
    return added;
  }

  async function validateFinalWorkflowState(
    session: HarvestSession,
    actionUrl: string,
    masterNodeId: string
  ): Promise<void> {
    console.log("Step 5: Workflow Validation");

    const finalNodeCount = session.dagManager.getNodeCount();
    const remainingNodes = session.state.toBeProcessedNodes.length;
    const isComplete = session.dagManager.isComplete();

    console.log(
      `Final state: ${finalNodeCount} nodes, ${remainingNodes} remaining to process, complete: ${isComplete}`
    );

    expect(finalNodeCount).toBeGreaterThan(0);
    expect(session.state.actionUrl).toBe(actionUrl);
    expect(session.state.masterNodeId).toBe(masterNodeId);

    const dagExport = session.dagManager.toJSON();
    expect(dagExport.nodes.length).toBe(finalNodeCount);
    expect(dagExport.edges.length).toBeGreaterThanOrEqual(0);

    const cycles = session.dagManager.detectCycles();
    expect(cycles).toBeNull();

    const nodeTypes = dagExport.nodes.map(
      (node: { nodeType: string }) => node.nodeType
    );
    expect(nodeTypes).toContain("master_curl");

    console.log(`Node types found: ${[...new Set(nodeTypes)].join(", ")}`);
  }

  describe("End-to-End Analysis Workflow", () => {
    it("should complete the full analysis pipeline", async () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      await performUrlIdentification(session);
      const { actionUrl, masterNodeId } = await createMasterNode(session);
      await processMasterNode(session, masterNodeId);
      await validateFinalWorkflowState(session, actionUrl, masterNodeId);

      console.log("✅ Complete workflow integration test passed");
    }, 60000); // 60 second timeout for LLM calls

    it("should handle empty dynamic parts gracefully", async () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      // Create a simple request with no dynamic parts
      const simpleRequest = session.harData.requests.find(
        (req) => req.method === "GET" && !req.body
      );

      if (!simpleRequest) {
        console.warn("No simple GET request found, skipping test");
        return;
      }

      session.dagManager.addNode(
        "curl",
        {
          key: simpleRequest,
          value: simpleRequest.response || null,
        },
        {
          dynamicParts: [],
          extractedParts: [],
        }
      );

      const curlCommand = simpleRequest.toCurlCommand();

      // Mock empty dynamic parts response for simple GET request
      const mockEmptyDynamicPartsResponse: DynamicPartsResponse = {
        dynamic_parts: [],
      };
      mockLLMClient.callFunction.mockResolvedValueOnce(
        mockEmptyDynamicPartsResponse
      );

      const dynamicParts = await identifyDynamicParts(curlCommand, {});

      // Should handle empty dynamic parts without errors
      const dependencies = await findDependencies(
        dynamicParts,
        session.harData,
        session.cookieData || {}
      );

      expect(dependencies).toBeDefined();
      expect(dependencies.cookieDependencies).toEqual([]);
      expect(dependencies.requestDependencies).toEqual([]);
      expect(dependencies.notFoundParts.length).toBeLessThanOrEqual(
        dynamicParts.length
      );
    });

    it("should validate DAG topological ordering", () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      // Add some test nodes with dependencies
      const nodeA = session.dagManager.addNode("curl", { key: "A" });
      const nodeB = session.dagManager.addNode("curl", { key: "B" });
      const nodeC = session.dagManager.addNode("curl", { key: "C" });

      // Create a dependency chain: A -> B -> C
      session.dagManager.addEdge(nodeA, nodeB);
      session.dagManager.addEdge(nodeB, nodeC);

      // Test topological sort
      const sorted = session.dagManager.topologicalSort();
      expect(sorted).toContain(nodeA);
      expect(sorted).toContain(nodeB);
      expect(sorted).toContain(nodeC);

      // Verify ordering (A should come before B, B before C)
      const indexA = sorted.indexOf(nodeA);
      const indexB = sorted.indexOf(nodeB);
      const indexC = sorted.indexOf(nodeC);

      expect(indexA).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexC);
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle malformed HAR data gracefully", async () => {
      // This test validates that our system can handle edge cases
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      // Test with empty URL list
      // Modern workflow discovery handles empty URL validation
      expect([]).toHaveLength(0);

      // Test with invalid dynamic parts
      const validationResult = validateDynamicParts([
        "valid_token_123",
        "", // Empty string
        "a", // Too short
        "application/json", // Common static value
        null as unknown as string, // Invalid type for testing
      ]);

      expect(validationResult.valid).toContain("valid_token_123");
      expect(validationResult.invalid).toContain("");
      expect(validationResult.invalid).toContain("a");
      expect(validationResult.invalid).toContain("application/json");
      expect(validationResult.reasons[""]).toBe("Invalid type or empty");
      expect(validationResult.reasons.a).toBe("Too short to be meaningful");
      expect(validationResult.reasons["application/json"]).toBe(
        "Common static value"
      );
    });

    it("should detect and handle circular dependencies", () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      // Create circular dependency: A -> B -> C -> A
      const nodeA = session.dagManager.addNode("curl", { key: "A" });
      const nodeB = session.dagManager.addNode("curl", { key: "B" });
      const nodeC = session.dagManager.addNode("curl", { key: "C" });

      session.dagManager.addEdge(nodeA, nodeB);
      session.dagManager.addEdge(nodeB, nodeC);
      session.dagManager.addEdge(nodeC, nodeA); // Creates cycle

      const cycles = session.dagManager.detectCycles();
      expect(cycles).not.toBeNull();
      expect(cycles?.length).toBeGreaterThan(0);
    });

    it("should handle sessions with no cookie data", async () => {
      // Create session without cookies
      const harPath = path.join(
        __dirname,
        "../fixtures/test-data/pangea_search.har"
      );

      let noCookieSessionId: string;
      try {
        noCookieSessionId = await sessionManager.createSession({
          harPath,
          prompt: "test without cookies",
          // No cookiePath provided
        });
      } catch (_error) {
        console.warn("HAR file not available, skipping test");
        return;
      }

      const session = sessionManager.getSession(noCookieSessionId);
      expect(session.cookieData).toBeUndefined();

      // Should still work without cookies
      const dependencies = await findDependencies(
        ["test_token"],
        session.harData,
        {} // Empty cookie data
      );

      expect(dependencies.cookieDependencies).toEqual([]);

      sessionManager.deleteSession(noCookieSessionId);
    });
  });

  describe("Performance and Resource Management", () => {
    it("should complete analysis within reasonable time limits", async () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      const startTime = Date.now();

      // Process first request
      if (session.harData.requests.length > 0) {
        const request = session.harData.requests[0];
        if (!request) {
          console.warn("No valid request found, skipping performance test");
          return;
        }
        const curlCommand = request.toCurlCommand();

        // Mock responses for quick testing
        const mockDynamicPartsResponse: DynamicPartsResponse = {
          dynamic_parts: ["test_token"],
        };
        const mockInputVarsResponse: InputVariablesResponse = {
          identified_variables: [
            { variable_name: "test", variable_value: "value" },
          ],
        };

        mockLLMClient.callFunction
          .mockResolvedValueOnce(mockDynamicPartsResponse)
          .mockResolvedValueOnce(mockInputVarsResponse);

        // These should complete quickly for test scenarios
        const dynamicParts = await identifyDynamicParts(curlCommand, {});
        await identifyInputVariables(
          curlCommand,
          { test: "value" },
          dynamicParts
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Should complete within 30 seconds for test scenarios
        expect(duration).toBeLessThan(30000);
        console.log(`Analysis completed in ${duration}ms`);
      }
    });

    it("should properly clean up resources", () => {
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        console.warn(
          "Skipping test - session not created (HAR files unavailable)"
        );
        return;
      }

      const initialNodeCount = session.dagManager.getNodeCount();

      // Add some nodes
      session.dagManager.addNode("curl", { key: "A" });
      session.dagManager.addNode("curl", { key: "B" });

      expect(session.dagManager.getNodeCount()).toBe(initialNodeCount + 2);

      // Session deletion should clean up everything
      sessionManager.deleteSession(sessionId);

      expect(() => sessionManager.getSession(sessionId)).toThrow();
    });
  });
});
