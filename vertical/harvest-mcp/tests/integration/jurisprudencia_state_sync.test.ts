/**
 * Integration Test: Jurisprudencia Target URL State Synchronization
 *
 * This test reproduces the exact issue reported where the SessionManager
 * incorrectly reports "Target action URL has not been identified" even
 * though the URL was successfully identified and set in session state.
 */

import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// Integration tests use modern workflow discovery
import { validateConfiguration } from "../../src/core/providers/ProviderFactory.js";
import { SessionManager } from "../../src/core/SessionManager.js";
import type { SessionStartParams } from "../../src/types/index.js";

describe("Jurisprudencia State Synchronization Integration Test", () => {
  let sessionManager: SessionManager;

  // The actual HAR file from the failure report
  const harFilePath = path.resolve(
    __dirname,
    "../fixtures/test-data/5e1eb521-0288-4098-ba7e-f5b6bdba3973/network-2025-07-20T20-01-47-813Z.har"
  );

  // The exact prompt that triggered the failure
  const userPrompt =
    "Generate a TypeScript fetcher that can search jurisprudencia.jt.jus.br for legal decisions";

  beforeEach(async () => {
    sessionManager = new SessionManager();
    // Validate LLM configuration before test
    validateConfiguration();
  });

  it("should maintain consistent state between URL identification and completion analysis", async () => {
    // Create session with the actual jurisprudencia HAR file
    const params: SessionStartParams = {
      harPath: harFilePath,
      prompt: userPrompt,
    };

    const sessionId = await sessionManager.createSession(params);
    const session = sessionManager.getSession(sessionId);

    // Step 1: Simulate successful URL identification (like in server.ts)
    // Modern workflow discovery handles URL identification
    const targetUrl = session.harData.urls[0]?.url || "test-url";
    expect(targetUrl).toBeDefined();
    expect(targetUrl).toContain("jurisprudencia.jt.jus.br");
    expect(targetUrl).toContain("/api/no-auth/pesquisa");

    // Step 2: Set the action URL in session state (like in server.ts line 2284)
    session.state.actionUrl = targetUrl;

    // Step 3: Simulate master node creation
    session.state.masterNodeId = "master-node-id";

    // Add mock master node to DAG to simulate successful initial analysis
    const mockRequest = session.harData.requests.find(
      (req) => req.url === targetUrl
    );
    if (mockRequest) {
      const nodeContent = {
        url: targetUrl,
        method: mockRequest.method,
        headers: mockRequest.headers,
        body: mockRequest.body,
      };

      const masterNodeId = session.dagManager.addNode(
        "master",
        nodeContent as any,
        {
          dynamicParts: [],
        }
      );

      // Update the session state to use the actual node ID
      session.state.masterNodeId = masterNodeId;
    }

    // Step 4: Analyze completion state immediately after URL identification
    const analysis = sessionManager.analyzeCompletionState(sessionId);

    // Step 5: Validate the critical fix - state synchronization should work
    expect(analysis.diagnostics.hasActionUrl).toBe(true);
    expect(analysis.diagnostics.hasMasterNode).toBe(true);

    // Most importantly: should NOT have the false blocker
    expect(analysis.blockers).not.toContain(
      "Target action URL has not been identified"
    );

    // Log detailed diagnostics for debugging
    console.log("State Synchronization Test Results:");
    console.log(`- Target URL identified: ${targetUrl}`);
    console.log(`- session.state.actionUrl: ${session.state.actionUrl}`);
    console.log(
      `- hasActionUrl diagnostic: ${analysis.diagnostics.hasActionUrl}`
    );
    console.log(
      `- hasMasterNode diagnostic: ${analysis.diagnostics.hasMasterNode}`
    );
    console.log(`- Blockers: ${analysis.blockers.join(", ")}`);
    console.log(`- Analysis complete: ${analysis.isComplete}`);
  });

  it("should handle edge cases in state synchronization robustly", async () => {
    const params: SessionStartParams = {
      harPath: harFilePath,
      prompt: userPrompt,
    };

    const sessionId = await sessionManager.createSession(params);
    const session = sessionManager.getSession(sessionId);

    // Test Case 1: URL set but empty
    session.state.actionUrl = "";
    session.state.masterNodeId = "test-master";

    let analysis = sessionManager.analyzeCompletionState(sessionId);
    expect(analysis.diagnostics.hasActionUrl).toBe(false);
    // Since masterNodeId is set but no actual node exists, expect different blocker
    expect(analysis.blockers).toContain(
      "Master node ID is set but node does not exist in DAG"
    );

    // Test Case 2: URL set to whitespace only
    session.state.actionUrl = "   ";

    analysis = sessionManager.analyzeCompletionState(sessionId);
    expect(analysis.diagnostics.hasActionUrl).toBe(true); // !!("   ") === true in JavaScript
    expect(analysis.blockers).not.toContain(
      "Target action URL has not been identified"
    );

    // Test Case 3: URL set to null/undefined
    session.state.actionUrl = undefined as any;

    analysis = sessionManager.analyzeCompletionState(sessionId);
    expect(analysis.diagnostics.hasActionUrl).toBe(false);
    // Since masterNodeId is set but no actual node exists, expect different blocker
    expect(analysis.blockers).toContain(
      "Master node ID is set but node does not exist in DAG"
    );

    // Test Case 4: Valid URL properly set
    session.state.actionUrl =
      "https://jurisprudencia.jt.jus.br/api/no-auth/pesquisa";

    analysis = sessionManager.analyzeCompletionState(sessionId);
    expect(analysis.diagnostics.hasActionUrl).toBe(true);
    expect(analysis.blockers).not.toContain(
      "Target action URL has not been identified"
    );
  });

  afterEach(() => {
    sessionManager.clearAllSessions();
  });
});
