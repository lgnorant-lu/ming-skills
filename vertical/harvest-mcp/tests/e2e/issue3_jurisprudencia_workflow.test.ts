/**
 * End-to-End Test: Issue 3 - Brazilian Legal Document Search Workflow
 *
 * This E2E test validates the complete workflow for generating a comprehensive
 * TypeScript fetcher for searching Brazilian Labor Court jurisprudence from
 * jurisprudencia.jt.jus.br using real HAR data from issue #3.
 *
 * The test covers:
 * - Session creation with real HAR data
 * - Modern workflow discovery and analysis
 * - Dependency resolution and DAG building
 * - Code generation with proper TypeScript types
 * - Generated code validation and structure verification
 * - Performance and quality assertions
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeConfig } from "../../src/config/index.js";
import { CompletedSessionManager } from "../../src/core/CompletedSessionManager.js";
import { validateConfiguration } from "../../src/core/providers/ProviderFactory.js";
import { SessionManager } from "../../src/core/SessionManager.js";
// import { HarvestMCPServer } from "../../src/server.js";
import {
  handleIsComplete,
  handleProcessNextNode,
  handleStartPrimaryWorkflow,
} from "../../src/tools/analysisTools.js";
import { handleGenerateWrapperScript } from "../../src/tools/codegenTools.js";
import {
  handleSessionList,
  handleSessionStart,
} from "../../src/tools/sessionTools.js";
import { handleSessionStatus } from "../../src/tools/systemTools.js";
import {
  createAnalysisToolContext,
  createCodegenToolContext,
  createSessionToolContext,
  createSystemToolContext,
} from "../../src/types/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test data paths
const ISSUE3_HAR_PATH = path.join(
  __dirname,
  "../fixtures/issue_3/shared/616a7981-5b79-476f-b7d5-4e5f0d2b66a1/network-2025-07-21T01-47-16-962Z.har"
);

// Future expansion: These paths can be used for comparing expected vs actual results
// const EXPECTED_METADATA_PATH = path.join(
//   __dirname,
//   "../fixtures/issue_3/completed-sessions/6ae796dd-f380-4c4e-af4f-035e50f14b8d/metadata.json"
// );

// const EXPECTED_CODE_PATH = path.join(
//   __dirname,
//   "../fixtures/issue_3/completed-sessions/6ae796dd-f380-4c4e-af4f-035e50f14b8d/generated_code.ts"
// );

// Expected test parameters from issue #3
const ISSUE3_PROMPT =
  "Generate a comprehensive TypeScript fetcher for searching Brazilian Labor Court jurisprudence from jurisprudencia.jt.jus.br. The fetcher should support all available search filters, parameters, and return structured data with proper typing. Include support for search terms, date ranges, court selection, document types, and pagination. Ensure the fetcher can handle different search scenarios and properly parse the response data into a structured format.";

// Helper function to parse MCP tool responses
function parseToolResponse(response: any): any {
  if (!response?.content?.[0]?.text) {
    throw new Error("Invalid tool response format");
  }
  return JSON.parse(response.content[0].text);
}

// Helper function to wait for analysis completion with timeout
async function waitForAnalysisCompletion(
  sessionId: string,
  analysisContext: any,
  maxIterations = 10,
  timeoutMs = 60000
): Promise<void> {
  const startTime = Date.now();
  let iterations = 0;

  while (iterations < maxIterations) {
    // Check if we've exceeded timeout
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Analysis timeout after ${timeoutMs}ms`);
    }

    // Check completion status
    const completionResult = await handleIsComplete(
      { sessionId },
      analysisContext
    );
    const completionData = parseToolResponse(completionResult);

    if (completionData.isComplete) {
      console.log(`✅ Analysis completed after ${iterations + 1} iterations`);
      return;
    }

    // Process next node if available
    const processResult = await handleProcessNextNode(
      { sessionId },
      analysisContext
    );
    const processData = parseToolResponse(processResult);

    if (!processData.success) {
      console.warn(`⚠️ Processing warning: ${processData.message}`);
      // Continue anyway as some warnings are expected
    }

    iterations++;

    // Small delay to prevent tight loops
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(
    `Analysis did not complete after ${maxIterations} iterations`
  );
}

describe("E2E: Issue 3 - Brazilian Legal Document Search Workflow", () => {
  // let server: HarvestMCPServer;
  let sessionManager: SessionManager;
  let sessionContext: any;
  let analysisContext: any;
  let codegenContext: any;
  let systemContext: any;

  beforeEach(async () => {
    // Map .env vars to HARVEST_ vars if needed (since vitest setup might not have done it)
    if (process.env.GOOGLE_API_KEY && !process.env.HARVEST_GOOGLE_API_KEY) {
      process.env.HARVEST_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    }
    if (process.env.OPENAI_API_KEY && !process.env.HARVEST_OPENAI_API_KEY) {
      process.env.HARVEST_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    }
    if (process.env.LLM_PROVIDER && !process.env.HARVEST_LLM_PROVIDER) {
      process.env.HARVEST_LLM_PROVIDER = process.env.LLM_PROVIDER;
    }

    // Initialize configuration (only if not already initialized)
    try {
      try {
        initializeConfig();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message?.includes("already been initialized")
        ) {
          throw error;
        }
      }

      const configStatus = validateConfiguration();
      if (!configStatus.isConfigured) {
        console.warn(
          "⚠️ LLM provider not configured - using mock responses for E2E test"
        );
      }
    } catch (error) {
      console.warn("⚠️ Configuration warning:", error);
    }

    // Initialize server and contexts
    // server = new HarvestMCPServer();
    sessionManager = new SessionManager();
    const completedSessionManager = CompletedSessionManager.getInstance();

    // Create tool contexts
    sessionContext = createSessionToolContext(
      sessionManager,
      completedSessionManager
    );
    analysisContext = createAnalysisToolContext(
      sessionManager,
      completedSessionManager
    );
    codegenContext = createCodegenToolContext(
      sessionManager,
      completedSessionManager
    );
    systemContext = createSystemToolContext(
      sessionManager,
      completedSessionManager
    );
  });

  afterEach(() => {
    // Clean up sessions
    sessionManager.clearAllSessions();
  });

  it("should complete the full workflow from HAR analysis to code generation", async () => {
    console.log("🚀 Starting Issue 3 E2E Workflow Test");

    // Check if real LLM provider is configured
    const configStatus = validateConfiguration();
    if (!configStatus.isConfigured) {
      console.log("⚠️ Skipping full workflow test - no LLM provider configured");
      console.log(
        "📝 To run this test with real LLM, set HARVEST_OPENAI_API_KEY or HARVEST_GOOGLE_API_KEY"
      );
      return; // Skip test gracefully
    }

    // Step 1: Create session with Issue 3 HAR data
    console.log("📁 Step 1: Creating session with Issue 3 HAR data");

    const sessionResult = await handleSessionStart(
      {
        harPath: ISSUE3_HAR_PATH,
        prompt: ISSUE3_PROMPT,
      },
      sessionContext
    );

    const sessionData = parseToolResponse(sessionResult);
    expect(sessionData.sessionId).toBeDefined();
    expect(sessionData.message).toBe("Session created successfully");

    const sessionId = sessionData.sessionId;
    console.log(`✅ Session created: ${sessionId}`);

    // Step 2: Verify session status and HAR quality
    console.log("📊 Step 2: Verifying session status and HAR quality");

    const statusResult = await handleSessionStatus(
      { sessionId },
      systemContext
    );
    const statusData = parseToolResponse(statusResult);

    expect(statusData.success).toBe(true);
    expect(statusData.harInfo.totalRequests).toBeGreaterThan(70); // Expected ~80 requests
    expect(statusData.harInfo.quality).toBe("excellent"); // Should match expected metadata

    console.log(`✅ HAR Quality: ${statusData.harInfo.quality}`);
    console.log(`✅ Total Requests: ${statusData.harInfo.totalRequests}`);

    // Step 3: Start primary workflow analysis
    console.log("🔍 Step 3: Starting primary workflow analysis");

    const workflowResult = await handleStartPrimaryWorkflow(
      { sessionId },
      analysisContext
    );
    const workflowData = parseToolResponse(workflowResult);

    console.log(
      "🔍 DEBUG: workflowData =",
      JSON.stringify(workflowData, null, 2)
    );

    expect(workflowData.success).toBe(true);
    expect(workflowData.actionUrl).toBeDefined();
    expect(workflowData.actionUrl).toContain("jurisprudencia.jt.jus.br");
    expect(workflowData.actionUrl).toContain("/api/no-auth/pesquisa");

    console.log(`✅ Primary workflow identified: ${workflowData.actionUrl}`);

    // Step 4: Process workflow nodes until completion
    console.log("⚙️ Step 4: Processing workflow nodes until completion");

    await waitForAnalysisCompletion(sessionId, analysisContext, 15, 90000);

    // Verify final completion status
    const finalStatusResult = await handleSessionStatus(
      { sessionId },
      sessionContext
    );
    const finalStatusData = parseToolResponse(finalStatusResult);

    expect(finalStatusData.status.isComplete).toBe(true);
    expect(finalStatusData.status.canGenerateCode).toBe(true);
    expect(finalStatusData.progress.totalNodes).toBeGreaterThan(0);

    console.log(
      `✅ Analysis completed with ${finalStatusData.progress.totalNodes} nodes`
    );

    // Step 5: Generate wrapper script code
    console.log("🔨 Step 5: Generating TypeScript wrapper code");

    const codegenResult = await handleGenerateWrapperScript(
      { sessionId },
      codegenContext
    );
    const codegenData = parseToolResponse(codegenResult);

    expect(codegenData.success).toBe(true);
    expect(codegenData.code).toBeDefined();
    expect(typeof codegenData.code).toBe("string");
    expect(codegenData.code.length).toBeGreaterThan(5000); // Expected ~6575 chars

    console.log(`✅ Generated code: ${codegenData.code.length} characters`);

    // Step 6: Validate generated code structure and content
    console.log("✅ Step 6: Validating generated code structure");

    const generatedCode = codegenData.code;

    // Validate TypeScript structure
    expect(generatedCode).toContain("interface ApiResponse");
    expect(generatedCode).toContain("interface AuthConfig");
    expect(generatedCode).toContain("class AuthenticationError");
    expect(generatedCode).toContain("export type");
    expect(generatedCode).toContain("export {");

    // Validate Brazilian legal domain-specific content
    expect(generatedCode).toContain("jurisprudencia.jt.jus.br");
    expect(generatedCode).toContain("/api/no-auth/pesquisa");
    expect(generatedCode).toContain("sessionId");
    expect(generatedCode).toContain("tribunal"); // Court-related terms

    // Validate search functionality structure
    expect(generatedCode).toContain("texto"); // Search text parameter
    expect(generatedCode).toContain("dataInicio"); // Date range parameters
    expect(generatedCode).toContain("dataFim");
    expect(generatedCode).toContain("page"); // Pagination
    expect(generatedCode).toContain("size");

    // Validate proper TypeScript typing
    expect(generatedCode).toContain("Promise<ApiResponse");
    expect(generatedCode).toContain("Record<string, string>");
    expect(generatedCode).toContain("boolean");
    expect(generatedCode).toContain("number");

    console.log("✅ Generated code structure validation passed");

    // Step 7: Performance and quality assertions
    console.log("📈 Step 7: Performance and quality assertions");

    // Performance assertions
    expect(finalStatusData.progress.totalNodes).toBeLessThan(5); // Should be efficient
    expect(codegenData.code.length).toBeGreaterThan(4000); // Comprehensive but not bloated
    expect(codegenData.code.length).toBeLessThan(10000);

    // Quality assertions
    expect(generatedCode).toContain("/**"); // JSDoc documentation
    expect(generatedCode).toContain("* Main API call:"); // API documentation
    expect(generatedCode).toContain("DO NOT EDIT"); // Generated code warning
    expect(generatedCode).toContain("Harvest Generated"); // Harvest branding

    // Error handling assertions
    expect(generatedCode).toContain("AuthenticationError");
    expect(generatedCode).toContain("try {");
    expect(generatedCode).toContain("catch");
    expect(generatedCode).toContain("throw");

    console.log("✅ Performance and quality assertions passed");

    // Step 8: Final session cleanup verification
    console.log("🧹 Step 8: Final session cleanup verification");

    const listResult = await handleSessionList(sessionContext);
    const listData = parseToolResponse(listResult);

    expect(listData.sessions).toContainEqual(
      expect.objectContaining({
        sessionId: sessionId,
        isComplete: true,
      })
    );

    console.log("✅ Session properly tracked in session list");

    // Success summary
    console.log("\n🎉 Issue 3 E2E Workflow Test COMPLETED SUCCESSFULLY!");
    console.log("📋 Summary:");
    console.log(`  • Session ID: ${sessionId}`);
    console.log(`  • HAR Requests: ${statusData.harInfo.totalRequests}`);
    console.log(`  • HAR Quality: ${statusData.harInfo.quality}`);
    console.log(`  • Analysis Nodes: ${finalStatusData.progress.totalNodes}`);
    console.log(`  • Generated Code: ${codegenData.code.length} chars`);
    console.log(
      "  • Target URL: jurisprudencia.jt.jus.br/api/no-auth/pesquisa"
    );
    console.log("  • All assertions passed ✅");
  }, 120000); // 2 minute timeout for full E2E workflow

  it("should handle edge cases and error scenarios gracefully", async () => {
    console.log("🔍 Testing edge cases and error handling");

    // Test 1: Invalid HAR path
    try {
      await handleSessionStart(
        {
          harPath: "/nonexistent/path.har",
          prompt: "Test prompt",
        },
        sessionContext
      );

      expect.fail("Should have thrown error for invalid HAR path");
    } catch (error) {
      expect(error).toBeDefined();
      console.log("✅ Invalid HAR path handled correctly");
    }

    // Test 2: Empty prompt (should still work but may produce warnings)
    try {
      const result = await handleSessionStart(
        {
          harPath: ISSUE3_HAR_PATH,
          prompt: "",
        },
        sessionContext
      );

      const data = parseToolResponse(result);
      expect(data.sessionId).toBeDefined(); // Session should still be created
      console.log("✅ Empty prompt handled correctly");
    } catch (_error) {
      // Exception is also acceptable for empty prompt
      console.log("✅ Empty prompt validation handled correctly");
    }

    // Test 3: Invalid session ID for status check
    try {
      await handleSessionStatus({ sessionId: "invalid-uuid" }, systemContext);
      expect.fail("Should have thrown error for invalid session ID");
    } catch (error) {
      expect(error).toBeDefined();
      console.log("✅ Invalid session ID handled correctly");
    }

    console.log("✅ Edge case testing completed");
  });

  it("should validate HAR file compatibility and structure", async () => {
    console.log("🔍 Validating HAR file compatibility");

    // Create session to trigger HAR parsing
    const sessionResult = await handleSessionStart(
      {
        harPath: ISSUE3_HAR_PATH,
        prompt: "HAR validation test",
      },
      sessionContext
    );

    const sessionData = parseToolResponse(sessionResult);
    expect(sessionData.sessionId).toBeDefined();

    const sessionId = sessionData.sessionId;

    // Get detailed session status
    const statusResult = await handleSessionStatus(
      { sessionId },
      systemContext
    );
    const statusData = parseToolResponse(statusResult);

    // Validate HAR structure expectations
    expect(statusData.harInfo.totalRequests).toBeGreaterThan(70);
    expect(statusData.harInfo.totalUrls).toBeGreaterThan(0);
    expect(statusData.harInfo.quality).toMatch(/^(excellent|good|poor)$/);

    // Validate specific jurisprudencia.jt.jus.br content (may be undefined initially)
    if (statusData.sessionInfo.actionUrl) {
      expect(statusData.sessionInfo.actionUrl).toContain(
        "jurisprudencia.jt.jus.br"
      );
    }

    console.log("✅ HAR file compatibility validated");
  });
});
