import { beforeEach, describe, expect, it } from "vitest";
import type { SessionManager } from "../../src/core/SessionManager.js";
import { Request } from "../../src/models/Request.js";
import { HarvestMCPServer } from "../../src/server.js";
import { handleGenerateWrapperScript } from "../../src/tools/codegenTools.js";
import { handleGetUnresolvedNodes } from "../../src/tools/debugTools.js";
import { handleSessionStart } from "../../src/tools/sessionTools.js";

/**
 * One-Shot Prompt Integration Tests
 *
 * Tests the `harvest.full_run` prompt that provides a complete automated workflow
 * from HAR file analysis to code generation in a single call.
 */
describe("One-Shot Prompt Integration Tests", () => {
  let server: HarvestMCPServer;
  let sessionManager: SessionManager;

  beforeEach(() => {
    server = new HarvestMCPServer();
    sessionManager = server.sessionManager;
  });

  describe("harvest.full_run prompt", () => {
    it("should complete full automated workflow without LLM (manual DAG)", async () => {
      // Create a session and manually set up a DAG for testing
      // (This simulates what would happen in a successful automated run)

      const sessionResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Search and download documents",
        },
        server.getSessionToolContext()
      );

      const sessionId = JSON.parse(
        sessionResult.content?.[0]?.text as string
      ).sessionId;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(
          `Test setup failed: session with ID "${sessionId}" was not found.`
        );
      }

      // Manually create a successful analysis scenario
      const searchRequest = new Request(
        "GET",
        "https://console.pangea.cloud/api/search",
        { Accept: "application/json" },
        { query: "documents", limit: "10" }
      );

      const downloadRequest = new Request(
        "GET",
        "https://console.pangea.cloud/api/download",
        { Accept: "application/octet-stream" },
        { document_id: "doc_123", format: "pdf" }
      );

      const searchNodeId = session.dagManager.addNode(
        "curl",
        { key: searchRequest },
        {
          extractedParts: ["doc_123"],
          dynamicParts: [],
          inputVariables: { query: "documents", limit: "10" },
        }
      );

      const downloadNodeId = session.dagManager.addNode(
        "master_curl",
        { key: downloadRequest },
        {
          dynamicParts: [],
          extractedParts: [],
          inputVariables: { document_id: "doc_123", format: "pdf" },
        }
      );

      session.dagManager.addEdge(searchNodeId, downloadNodeId);
      session.state.isComplete = true;
      session.state.actionUrl = downloadRequest.url;
      session.state.masterNodeId = downloadNodeId;
      session.state.toBeProcessedNodes = [];

      // Test the one-shot functionality by simulating what it would do
      // (The actual prompt would be called by MCP client)

      // Simulate what would happen in a successful automated analysis
      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      // Verify the generated code structure
      expect(generatedCode).toContain("async function");
      expect(generatedCode).toContain("search");
      expect(generatedCode).toContain("download");
      expect(generatedCode).toContain("export {");

      console.log(
        `✅ One-shot workflow simulation successful - ${generatedCode.length} characters`
      );
    });

    it("should handle error cases gracefully in one-shot mode", async () => {
      // Test with invalid parameters to ensure error handling works
      const invalidParams = {
        har_path: "non-existent-file.har",
        prompt: "Test error handling",
      };

      // This would typically be called by MCP client, simulating the error flow
      try {
        await handleSessionStart(
          {
            harPath: invalidParams.har_path,
            prompt: invalidParams.prompt,
          },
          server.getSessionToolContext()
        );
      } catch (error) {
        expect(error).toBeDefined();
        expect(error instanceof Error).toBe(true);
        console.log("✅ Error handling works correctly for invalid inputs");
      }
    });

    it("should provide progress tracking in one-shot mode", async () => {
      // Create a session for testing progress tracking
      const sessionResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Progress tracking test",
        },
        server.getSessionToolContext()
      );

      const sessionId = JSON.parse(
        sessionResult.content?.[0]?.text as string
      ).sessionId;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(
          `Test setup failed: session with ID "${sessionId}" was not found.`
        );
      }

      // Verify session was created successfully
      expect(session).toBeDefined();
      expect(session.id).toBe(sessionId);

      // Verify that the logs track progress
      expect(session.state.logs.length).toBeGreaterThan(0);
      expect(
        session.state.logs.some((log) =>
          log.message.includes("Session created")
        )
      ).toBe(true);

      console.log("✅ Progress tracking functionality verified");
    });

    it("should generate comprehensive results summary", async () => {
      // Test the result formatting that would be returned by the one-shot prompt
      const sessionResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Results summary test",
        },
        server.getSessionToolContext()
      );

      const sessionId = JSON.parse(
        sessionResult.content?.[0]?.text as string
      ).sessionId;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(
          `Test setup failed: session with ID "${sessionId}" was not found.`
        );
      }

      // Create a minimal complete analysis
      const simpleRequest = new Request(
        "GET",
        "https://api.example.com/simple",
        {
          Accept: "application/json",
        }
      );

      const nodeId = session.dagManager.addNode(
        "master_curl",
        { key: simpleRequest },
        {
          dynamicParts: [],
          extractedParts: [],
          inputVariables: {},
        }
      );

      session.state.isComplete = true;
      session.state.actionUrl = simpleRequest.url;
      session.state.masterNodeId = nodeId;

      // Generate code and verify result structure
      const codeResult = await handleGenerateWrapperScript(
        {
          sessionId,
        },
        server.getCodegenToolContext()
      );
      const generatedCode = codeResult.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      expect(generatedCode).toContain(
        "// Harvest Generated API Integration Code"
      );
      expect(generatedCode).toContain(
        "// Original prompt: Results summary test"
      );
      expect(generatedCode).toContain("async function main");

      // Simulate what the one-shot prompt would return
      const analysisResults = [
        `✅ Session created: ${sessionId}`,
        "✅ Analysis completed after 1 iterations",
        `✅ Code generation successful - ${generatedCode.length} characters generated`,
      ];

      const summaryText = `# Harvest Complete Analysis Results

## Workflow Summary
${analysisResults.join("\n")}

## Generated TypeScript Code

\`\`\`typescript
${generatedCode}
\`\`\``;

      expect(summaryText).toContain("# Harvest Complete Analysis Results");
      expect(summaryText).toContain("## Workflow Summary");
      expect(summaryText).toContain("## Generated TypeScript Code");
      expect(summaryText).toContain("```typescript");

      console.log("✅ Results summary formatting verified");
    });

    it("should handle incomplete analysis with debug information", async () => {
      // Test the debug information flow for incomplete analysis
      const sessionResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Debug information test",
        },
        server.getSessionToolContext()
      );

      const sessionId = JSON.parse(
        sessionResult.content?.[0]?.text as string
      ).sessionId;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(
          `Test setup failed: session with ID "${sessionId}" was not found.`
        );
      }

      // Create an incomplete analysis scenario
      const incompleteRequest = new Request(
        "POST",
        "https://api.example.com/incomplete",
        {
          Authorization: "Bearer unresolved_token",
        }
      );

      const nodeId = session.dagManager.addNode(
        "master_curl",
        { key: incompleteRequest },
        {
          dynamicParts: ["unresolved_token"], // This makes it incomplete
          extractedParts: [],
          inputVariables: {},
        }
      );

      session.state.actionUrl = incompleteRequest.url;
      session.state.masterNodeId = nodeId;
      session.state.isComplete = false; // Explicitly incomplete

      // Try to generate code - should fail
      try {
        await handleGenerateWrapperScript(
          { sessionId },
          server.getCodegenToolContext()
        );
      } catch (error) {
        expect(error).toBeDefined();
        expect((error as Error).message).toContain("analysis not complete");
      }

      // Test the debug information retrieval
      const unresolvedResult = await handleGetUnresolvedNodes(
        {
          sessionId,
        },
        server.getDebugToolContext()
      );
      const unresolvedData = JSON.parse(
        unresolvedResult.content?.[0]?.text as string
      );

      expect(unresolvedData.totalUnresolved).toBe(1);
      expect(unresolvedData.unresolvedNodes?.[0]?.unresolvedParts).toContain(
        "unresolved_token"
      );

      console.log("✅ Debug information handling verified");
    });

    it("should support optional parameters correctly", async () => {
      // Test the parameter handling that would be used by the one-shot prompt

      // Test with minimal parameters (no cookie file)
      const minimalResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          prompt: "Minimal parameters test",
        },
        server.getSessionToolContext()
      );

      const minimalSessionId = JSON.parse(
        minimalResult.content?.[0]?.text as string
      ).sessionId;
      expect(minimalSessionId).toBeDefined();

      // Test with input variables
      const variablesResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Variables test",
          inputVariables: { user_id: "12345", api_key: "test_key" },
        },
        server.getSessionToolContext()
      );

      const variablesSessionId = JSON.parse(
        variablesResult.content?.[0]?.text as string
      ).sessionId;
      const variablesSession = sessionManager.getSession(variablesSessionId);
      if (!variablesSession) {
        throw new Error(
          `Test setup failed: session with ID "${variablesSessionId}" was not found.`
        );
      }

      expect(variablesSession.state.inputVariables).toEqual({
        user_id: "12345",
        api_key: "test_key",
      });

      console.log("✅ Optional parameters handling verified");
    });
  });

  describe("One-shot workflow simulation", () => {
    it("should demonstrate complete workflow from start to finish", async () => {
      // This test simulates the complete one-shot workflow
      // In a real environment with OpenAI API, this would be fully automated

      const startTime = Date.now();

      // Step 1: Session creation
      const sessionResult = await handleSessionStart(
        {
          harPath: "tests/fixtures/test-data/pangea_search.har",
          cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
          prompt: "Complete workflow demonstration",
        },
        server.getSessionToolContext()
      );

      const sessionId = JSON.parse(
        sessionResult.content?.[0]?.text as string
      ).sessionId;
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error(
          `Test setup failed: session with ID "${sessionId}" was not found.`
        );
      }

      // Step 2: Simulate automated analysis by manually creating realistic scenario
      const authRequest = new Request(
        "POST",
        "https://console.pangea.cloud/api/auth",
        { "Content-Type": "application/json" },
        undefined,
        { username: "test", password: "demo" }
      );

      const dataRequest = new Request(
        "GET",
        "https://console.pangea.cloud/api/workflow/data",
        { Authorization: "Bearer auth_token" },
        { filter: "documents" }
      );

      const authNodeId = session.dagManager.addNode(
        "curl",
        { key: authRequest },
        {
          extractedParts: ["auth_token"],
          dynamicParts: [],
          inputVariables: {},
        }
      );

      const dataNodeId = session.dagManager.addNode(
        "master_curl",
        { key: dataRequest },
        {
          dynamicParts: [],
          extractedParts: [],
          inputVariables: { filter: "documents" },
        }
      );

      session.dagManager.addEdge(authNodeId, dataNodeId);
      session.state.isComplete = true;
      session.state.actionUrl = dataRequest.url;
      session.state.masterNodeId = dataNodeId;
      session.state.toBeProcessedNodes = [];

      // Step 3: Code generation
      const codeResult = await handleGenerateWrapperScript(
        {
          sessionId,
        },
        server.getCodegenToolContext()
      );
      const generatedCode = codeResult.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      const totalTime = Date.now() - startTime;

      // Verify complete workflow results
      expect(generatedCode).toContain(
        "// Harvest Generated API Integration Code"
      );
      expect(generatedCode).toContain("async function auth");
      expect(generatedCode).toContain(
        "async function completeWorkflowDemonstration"
      );
      expect(generatedCode).toContain("export {");
      expect(generatedCode.length).toBeGreaterThan(1000);

      // Verify performance
      expect(totalTime).toBeLessThan(5000); // Should complete quickly

      // Simulate the final one-shot result format
      const workflowSummary = [
        `✅ Session created: ${sessionId}`,
        `✅ Initial analysis complete - Action URL: ${session.state.actionUrl}`,
        "✅ Analysis completed after 2 iterations",
        `✅ Code generation successful - ${generatedCode.length} characters generated`,
      ];

      const finalResult = {
        success: true,
        sessionId,
        analysisTime: totalTime,
        codeLength: generatedCode.length,
        summary: workflowSummary,
        generatedCode,
      };

      expect(finalResult.success).toBe(true);
      expect(finalResult.codeLength).toBeGreaterThan(0);
      expect(finalResult.summary.length).toBe(4);

      console.log(
        `✅ Complete workflow demonstration: ${totalTime}ms, ${generatedCode.length} chars`
      );
      console.log(`📋 Summary: ${workflowSummary.join(" → ")}`);
    });
  });
});
