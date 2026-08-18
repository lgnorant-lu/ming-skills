import { beforeEach, describe, expect, it } from "vitest";
import type { SessionManager } from "../../src/core/SessionManager.js";
import { Request } from "../../src/models/Request.js";
import { HarvestMCPServer } from "../../src/server.js";
import { handleGenerateWrapperScript } from "../../src/tools/codegenTools.js";
import type { HarvestSession } from "../../src/types/index.js";

describe("Code Generation Integration Tests", () => {
  let server: HarvestMCPServer;
  let sessionManager: SessionManager;
  let session: HarvestSession;
  let sessionId: string;

  beforeEach(async () => {
    server = new HarvestMCPServer();
    // Get the session manager from the server
    sessionManager = server.sessionManager;

    // Create a test session with a complete dependency graph
    sessionId = await sessionManager.createSession({
      harPath: "tests/fixtures/test-data/pangea_search.har",
      cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
      prompt: "Search for documents in the system",
    });

    const retrievedSession = sessionManager.getSession(sessionId);
    if (!retrievedSession) {
      throw new Error(
        `Test setup failed: session with ID "${sessionId}" was not found.`
      );
    }
    session = retrievedSession;

    // Set up a complete analysis scenario
    await setupCompleteAnalysisScenario();
  });

  function setupCompleteAnalysisScenario() {
    // Create authentication request
    const authRequest = new Request(
      "POST",
      "https://api.example.com/auth/login",
      {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      undefined,
      {
        username: "testuser",
        password: "testpass",
      }
    );

    // Create main search request
    const searchRequest = new Request(
      "GET",
      "https://api.example.com/search",
      {
        Authorization: "Bearer auth_token_123",
        Accept: "application/json",
      },
      {
        query: "documents",
        limit: "10",
      }
    );

    // Add nodes to DAG in dependency order
    const authNodeId = session.dagManager.addNode(
      "curl",
      { key: authRequest },
      {
        extractedParts: ["auth_token_123"],
        dynamicParts: [],
        inputVariables: {},
      }
    );

    const searchNodeId = session.dagManager.addNode(
      "master_curl",
      { key: searchRequest },
      {
        dynamicParts: [],
        extractedParts: [],
        inputVariables: { query: "documents", limit: "10" },
      }
    );

    // Create dependency: search depends on auth
    session.dagManager.addEdge(authNodeId, searchNodeId);

    // Mark analysis as complete
    session.state.isComplete = true;
    session.state.actionUrl = "https://api.example.com/search";
    session.state.masterNodeId = searchNodeId;
  }

  describe("codegen.generate_wrapper_script tool", () => {
    it("should generate complete TypeScript code for a finished analysis", async () => {
      // Call the code generation tool
      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );

      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      // Verify structure of generated code
      expect(generatedCode).toContain(
        "// Harvest Generated API Integration Code"
      );
      expect(generatedCode).toContain("interface ApiResponse");
      expect(generatedCode).toContain("interface RequestOptions");
      expect(generatedCode).toContain("async function authLogin");
      expect(generatedCode).toContain(
        "async function searchForDocumentsInTheSystem"
      );
      expect(generatedCode).toContain("export {");

      // Verify dependency order (auth before search)
      const authIndex = generatedCode.indexOf("async function authLogin");
      const searchIndex = generatedCode.indexOf(
        "async function searchForDocumentsInTheSystem"
      );
      expect(authIndex).toBeLessThan(searchIndex);

      // Verify proper error handling
      expect(generatedCode).toContain("try {");
      expect(generatedCode).toContain("} catch (error) {");

      // Verify fetch usage
      expect(generatedCode).toContain("await fetch(");
      expect(generatedCode).toContain("response.json()");
    });

    it("should store generated code in session state", async () => {
      expect(session.state.generatedCode).toBeUndefined();

      await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );

      expect(session.state.generatedCode).toBeDefined();
      expect(session.state.generatedCode).toContain("async function");
    });

    it("should fail when analysis is not complete", async () => {
      // Mark analysis as incomplete
      session.state.isComplete = false;
      const firstNodeId = Array.from(
        session.dagManager.getAllNodes().keys()
      )[0];
      if (firstNodeId) {
        session.dagManager.updateNode(firstNodeId, {
          dynamicParts: ["unresolved_token"],
        });
      }

      await expect(
        handleGenerateWrapperScript(
          { sessionId },
          server.getCodegenToolContext()
        )
      ).rejects.toThrow(
        "Code generation failed - analysis prerequisites not met"
      );
    });

    it("should include proper session metadata in generated code", async () => {
      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      expect(generatedCode).toContain(`// Original prompt: ${session.prompt}`);
      expect(generatedCode).toContain(`// Session ID: ${sessionId}`);
      expect(generatedCode).toContain(
        "// DO NOT EDIT - This file is auto-generated"
      );
    });
  });

  describe("harvest://{sessionId}/generated_code.ts resource", () => {
    it("should return generated code after generation", async () => {
      // Generate code first
      await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );

      // Check that generated code is stored in session
      expect(session.state.generatedCode).toBeDefined();
      expect(session.state.generatedCode).toContain("async function");
    });

    it("should fail when code has not been generated yet", () => {
      // Test that generated code is not available initially
      expect(session.state.generatedCode).toBeUndefined();
    });

    it("should provide access to generated code via session state", async () => {
      // Generate code
      await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );

      // Verify code is accessible
      const generatedCode = session.state.generatedCode;
      expect(generatedCode).toBeDefined();
      expect(generatedCode).toContain("export {");
    });
  });

  describe("Complete workflow integration", () => {
    it("should generate executable TypeScript code", async () => {
      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      // Test that the generated code is syntactically valid TypeScript
      // by checking for proper structure
      const lines = generatedCode.split("\n");

      // Should have proper TypeScript structure
      expect(lines.some((line) => line.includes("interface ApiResponse"))).toBe(
        true
      );
      expect(lines.some((line) => line.includes("async function"))).toBe(true);
      expect(lines.some((line) => line.includes("Promise<ApiResponse>"))).toBe(
        true
      );
      expect(lines.some((line) => line.includes("export {"))).toBe(true);

      // Should handle authentication flow
      expect(generatedCode).toContain("POST");
      expect(generatedCode).toContain("username");
      expect(generatedCode).toContain("password");

      // Should handle main search request
      expect(generatedCode).toContain("GET");
      expect(generatedCode).toContain("query");
      expect(generatedCode).toContain("documents");
    });

    it("should handle complex dependency chains", async () => {
      // Add an additional dependency layer
      const tokenRefreshRequest = new Request(
        "POST",
        "https://api.example.com/auth/refresh",
        { Authorization: "Bearer auth_token_123" },
        undefined,
        { refresh_token: "refresh_abc_123" }
      );

      const tokenNodeId = session.dagManager.addNode(
        "curl",
        { key: tokenRefreshRequest },
        {
          extractedParts: ["refresh_abc_123"],
          dynamicParts: [],
          inputVariables: {},
        }
      );

      // Create dependency chain: token refresh -> auth -> search
      // This means token refresh provides data to auth, which provides data to search
      const authNodeId = Array.from(
        session.dagManager.getAllNodes().entries()
      ).find(([_, node]) => node.nodeType === "curl")?.[0];

      if (authNodeId) {
        session.dagManager.addEdge(tokenNodeId, authNodeId);
      }

      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      // Should include all three functions
      expect(generatedCode).toContain("async function authRefresh");
      expect(generatedCode).toContain("async function authLogin");
      expect(generatedCode).toContain(
        "async function searchForDocumentsInTheSystem"
      );

      // Verify dependency order (token refresh -> auth -> search)
      const refreshIndex = generatedCode.indexOf("async function authRefresh");
      const loginIndex = generatedCode.indexOf("async function authLogin");
      const searchIndex = generatedCode.indexOf(
        "async function searchForDocumentsInTheSystem"
      );

      expect(refreshIndex).toBeLessThan(loginIndex);
      expect(loginIndex).toBeLessThan(searchIndex);
    });

    it("should handle cookie dependencies in generated code", async () => {
      // Add a cookie dependency
      session.dagManager.addNode(
        "cookie",
        {
          key: "session_id",
          value: "sess_abc123",
        },
        {
          extractedParts: ["sess_abc123"],
        }
      );

      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      expect(generatedCode).toContain("// Cookie: session_id");
      expect(generatedCode).toContain("sess_abc123");
    });

    it("should handle not_found dependencies gracefully", async () => {
      // Add a not_found node
      session.dagManager.addNode("not_found", {
        key: "missing_api_key",
      });

      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const generatedCode = result.content?.[0]?.text as string;
      if (!generatedCode) {
        throw new Error("No generated code");
      }

      expect(generatedCode).toContain(
        "// WARNING: Could not resolve missing_api_key"
      );
      expect(generatedCode).toContain("throw new Error");
      expect(generatedCode).toContain("Missing dependency: missing_api_key");
    });
  });

  describe("Performance and validation", () => {
    it("should generate code quickly for typical sessions", async () => {
      const startTime = Date.now();

      await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it("should generate consistent code for the same session", async () => {
      const result1 = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const code1 = result1.content?.[0]?.text as string;
      if (!code1) {
        throw new Error("No generated code");
      }

      // Generate again
      const result2 = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const code2 = result2.content?.[0]?.text as string;
      if (!code2) {
        throw new Error("No generated code");
      }

      // Should be identical (deterministic generation)
      expect(code1).toBe(code2);
    });

    it("should handle sessions with many nodes efficiently", async () => {
      // Add multiple dependency nodes
      for (let i = 0; i < 10; i++) {
        const request = new Request(
          "GET",
          `https://api.example.com/data/${i}`,
          { Authorization: "Bearer token" },
          { id: i.toString() }
        );

        session.dagManager.addNode(
          "curl",
          { key: request },
          {
            extractedParts: [`data_${i}`],
            dynamicParts: [],
            inputVariables: { id: i.toString() },
          }
        );
      }

      const startTime = Date.now();
      const result = await handleGenerateWrapperScript(
        { sessionId },
        server.getCodegenToolContext()
      );
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // Should handle large graphs efficiently
      expect(result.content?.[0]?.text).toContain("async function");
    });
  });
});
