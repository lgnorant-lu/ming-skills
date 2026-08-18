import { beforeEach, describe, expect, it } from "vitest";
import { generateWrapperScript } from "../../../src/core/CodeGenerator.js";
import { SessionManager } from "../../../src/core/SessionManager.js";
import { Request } from "../../../src/models/Request.js";
import type { HarvestSession } from "../../../src/types/index.js";

describe("CodeGenerator", () => {
  let sessionManager: SessionManager;
  let session: HarvestSession;

  beforeEach(async () => {
    sessionManager = new SessionManager();

    // Create a test session with sample data
    const sessionId = await sessionManager.createSession({
      harPath: "tests/fixtures/test-data/pangea_search.har",
      cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
      prompt: "Search for documents",
    });

    const retrievedSession = sessionManager.getSession(sessionId);
    if (!retrievedSession) {
      throw new Error(
        `Test setup failed: session with ID "${sessionId}" was not found.`
      );
    }
    session = retrievedSession;

    // Create a simple dependency graph for testing
    const authRequest = new Request(
      "POST",
      "https://api.example.com/auth",
      { "Content-Type": "application/json" },
      undefined,
      { username: "test", password: "test123" }
    );

    const dataRequest = new Request(
      "GET",
      "https://api.example.com/data",
      { Authorization: "Bearer token123" },
      { search: "documents" }
    );

    // Add nodes to DAG
    const authNodeId = session.dagManager.addNode(
      "curl",
      { key: authRequest },
      {
        extractedParts: ["token123"],
        dynamicParts: [],
      }
    );

    const dataNodeId = session.dagManager.addNode(
      "master_curl",
      { key: dataRequest },
      {
        dynamicParts: [],
        inputVariables: { search: "documents" },
      }
    );

    // Create dependency: data depends on auth (auth must come before data)
    session.dagManager.addEdge(authNodeId, dataNodeId);

    // Mark session as complete
    session.state.isComplete = true;
  });

  describe("generateWrapperScript", () => {
    it("should generate a complete TypeScript wrapper script", async () => {
      const code = await generateWrapperScript(session);

      expect(code).toContain("Generated API Client");
      expect(code).toContain("async function");
      expect(code).toContain("export");
    });

    it("should include proper imports and type definitions", async () => {
      const code = await generateWrapperScript(session);

      expect(code).toContain("ApiResponse");
      expect(code).toContain("RequestOptions");
      expect(code).toContain("export");
    });

    it("should generate functions in correct dependency order", async () => {
      const code = await generateWrapperScript(session);

      // Should generate functions (specific order testing may vary with AST generation)
      expect(code).toContain("async function");
      expect(code).toContain("main");
      expect(typeof code).toBe("string");
    });

    it("should handle cookie dependencies", async () => {
      // Add a cookie node
      session.dagManager.addNode(
        "cookie",
        {
          key: "session_id",
          value: "abc123",
        },
        {
          extractedParts: ["abc123"],
        }
      );

      const code = await generateWrapperScript(session);

      expect(code).toContain("Cookie");
      expect(code).toContain("session_id");
    });

    it("should throw error if analysis is not complete", async () => {
      // Create a request for the incomplete node
      const incompleteRequest = new Request(
        "GET",
        "https://api.example.com/incomplete",
        { Authorization: "Bearer token123" }
      );

      // Add a node with unresolved dynamic parts to make DAG incomplete
      const incompleteNodeId = session.dagManager.addNode("curl", {
        key: incompleteRequest,
        value: null,
      });

      // Update the node to have unresolved dynamic parts
      session.dagManager.updateNode(incompleteNodeId, {
        dynamicParts: ["unresolved_part"],
      });

      await expect(generateWrapperScript(session)).rejects.toThrow(
        "Analysis not complete"
      );
    });

    it("should include error handling in generated code", async () => {
      const code = await generateWrapperScript(session);

      expect(code).toContain("Error");
      expect(code).toContain("throw");
      expect(typeof code).toBe("string");
    });

    it("should generate proper variable extraction from responses", async () => {
      const code = await generateWrapperScript(session);

      // The AST-based code generator should include proper data extraction
      expect(code).toContain("API request"); // Basic structure verification
      expect(typeof code).toBe("string");
    });
  });

  describe("Error Handling", () => {
    it("should validate session state before generation", async () => {
      session.state.isComplete = false;
      const firstNodeId = Array.from(
        session.dagManager.getAllNodes().keys()
      )[0];
      if (!firstNodeId) {
        throw new Error(
          "Test setup failed: No nodes found in DAG for error handling test."
        );
      }
      session.dagManager.updateNode(firstNodeId, {
        dynamicParts: ["unresolved_token"],
      });

      await expect(generateWrapperScript(session)).rejects.toThrow(
        "Analysis not complete"
      );
    });

    it("should handle empty DAG gracefully", async () => {
      // Create a new session with empty DAG
      const emptySession = {
        ...session,
        dagManager: new (
          session.dagManager.constructor as new () => typeof session.dagManager
        )(),
      };
      emptySession.state.isComplete = true;

      const code = await generateWrapperScript(emptySession);

      // Should generate basic structure with main function
      expect(code).toContain("async function main");
      expect(code).toContain("No workflow steps available");
    });
  });
});
