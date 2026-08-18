import {
  type LLMClient,
  resetLLMClient,
  setLLMClient,
} from "../../src/core/LLMClient.js";
import type { SessionManager } from "../../src/core/SessionManager.js";
import { HarvestMCPServer } from "../../src/server.js";
import { handleStartPrimaryWorkflow } from "../../src/tools/analysisTools.js";
import { handleSessionStart } from "../../src/tools/sessionTools.js";
import { createMockLLMClient } from "../mocks/llm-client.mock.js";

/**
 * E2E Test Helpers
 *
 * Provides common utilities for end-to-end testing workflows
 */

export interface E2ETestContext {
  server: HarvestMCPServer;
  sessionManager: SessionManager;
}

export interface E2ESessionOptions {
  harPath?: string;
  cookiePath?: string;
  prompt?: string;
  mockLLMResponses?: {
    identify_end_url?: { url: "https://api.example.com/search" };
    identify_dynamic_parts?: { dynamic_parts: string[] };
    identify_input_variables?: {
      identified_variables: Array<{
        variable_name: string;
        variable_value: string;
      }>;
    };
  };
}

/**
 * Setup E2E test context with mock LLM client
 */
export function setupE2EContext(
  customMockResponses?: E2ESessionOptions["mockLLMResponses"]
): E2ETestContext {
  // Ensure clean state first
  resetLLMClient();

  // Set up mock LLM client for E2E tests to avoid real API calls
  const mockLLMClient = createMockLLMClient({
    identify_dynamic_parts: {
      dynamic_parts: ["auth_token", "session_id"],
    },
    identify_input_variables: {
      identified_variables: [
        { variable_name: "search_term", variable_value: "documents" },
      ],
    },
    ...customMockResponses,
  });
  setLLMClient(mockLLMClient as unknown as LLMClient);

  const server = new HarvestMCPServer();
  const sessionManager = server.sessionManager;

  return { server, sessionManager };
}

/**
 * Clean up E2E test context
 */
export function cleanupE2EContext(): void {
  resetLLMClient();
}

/**
 * Create a test session with default parameters
 */
export async function createTestSession(
  server: HarvestMCPServer,
  options: E2ESessionOptions = {}
): Promise<string> {
  const {
    harPath = "tests/fixtures/test-data/pangea_search.har",
    cookiePath = "tests/fixtures/test-data/pangea_cookies.json",
    prompt = "Test analysis workflow",
  } = options;

  const sessionResult = await handleSessionStart(
    {
      harPath,
      cookiePath,
      prompt,
    },
    server.getSessionToolContext()
  );

  const firstContent = sessionResult.content?.[0];
  if (!firstContent || typeof firstContent.text !== "string") {
    throw new Error(
      "createTestSession failed: expected valid response content"
    );
  }
  const sessionData = JSON.parse(firstContent.text);
  return sessionData.sessionId;
}

/**
 * Run initial analysis for a session
 */
export async function runInitialAnalysis(
  server: HarvestMCPServer,
  sessionId: string
): Promise<{ masterNodeId: string; actionUrl: string }> {
  // Use modern workflow analysis
  const analysisToolContext = server.getAnalysisToolContext();
  const initialAnalysisResult = await handleStartPrimaryWorkflow(
    { sessionId },
    analysisToolContext
  );
  const firstContent = initialAnalysisResult.content?.[0];
  if (!firstContent || typeof firstContent.text !== "string") {
    throw new Error(
      "runInitialAnalysis failed: expected valid response content"
    );
  }
  const initialData = JSON.parse(firstContent.text);

  return {
    masterNodeId:
      initialData.workflow?.id || initialData.masterNode?.url || "unknown",
    actionUrl:
      initialData.masterNode?.url || initialData.actionUrl || "unknown",
  };
}
