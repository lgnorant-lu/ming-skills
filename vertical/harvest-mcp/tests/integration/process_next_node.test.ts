import { beforeEach, describe, expect, it } from "vitest";
import { DAGManager } from "../../src/core/DAGManager.js";
import { SessionManager } from "../../src/core/SessionManager.js";
import { Request } from "../../src/models/Request.js";
import type { HarvestSession, RequestModel } from "../../src/types/index.js";

describe("Process Next Node Integration", () => {
  let sessionManager: SessionManager;
  let session: HarvestSession;

  beforeEach(() => {
    // Set API key for LLM client
    process.env.OPENAI_API_KEY = "test-api-key";

    sessionManager = new SessionManager();

    // Create a mock session with simplified data for unit testing
    const mockRequest1 = new Request(
      "POST",
      "https://api.example.com/auth/login",
      { "Content-Type": "application/json" },
      {},
      { username: "user@example.com", password: "secret" }
    );

    const mockRequest2 = new Request(
      "GET",
      "https://api.example.com/user/profile",
      { Authorization: "Bearer token123" },
      { user_id: "12345" }
    );

    // Add response data
    mockRequest1.response = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      text: '{"access_token": "token123", "user_id": "12345"}',
      json: { access_token: "token123", user_id: "12345" },
    };

    mockRequest2.response = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      text: '{"name": "John Doe", "email": "user@example.com"}',
      json: { name: "John Doe", email: "user@example.com" },
    };

    // Create session with minimal required data
    session = {
      id: "test-session-id",
      prompt: "Test analysis",
      harData: {
        requests: [mockRequest1, mockRequest2],
        urls: [
          {
            method: "POST",
            url: mockRequest1.url,
            requestType: "JSON",
            responseType: "JSON",
          },
          {
            method: "GET",
            url: mockRequest2.url,
            requestType: "Query",
            responseType: "JSON",
          },
        ],
      },
      cookieData: {
        session_cookie: {
          value: "sess456",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
        },
      },
      dagManager: new DAGManager(),
      state: {
        toBeProcessedNodes: [],
        inputVariables: { username: "user@example.com" },
        inProcessNodeDynamicParts: [],
        isComplete: false,
        logs: [],
        workflowGroups: new Map(),
      },
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    // Register session manually for testing
    // @ts-ignore - Accessing private 'sessions' property for test setup purposes.
    sessionManager.sessions.set(session.id, session);
  });

  describe("Node Processing Workflow", () => {
    it("should handle empty processing queue", () => {
      const mockServer = {
        handleProcessNextNode: (args: { sessionId: string }) => {
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }

          if (session.state.toBeProcessedNodes.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "no_nodes_to_process",
                    message: "No nodes available for processing",
                    isComplete: session.dagManager.isComplete(),
                    totalNodes: session.dagManager.getNodeCount(),
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  message: "Node processed successfully",
                }),
              },
            ],
          };
        },
      };

      const result = mockServer.handleProcessNextNode({
        sessionId: session.id,
      });
      const response = JSON.parse(result?.content?.[0]?.text || "{}");

      expect(response.status).toBe("no_nodes_to_process");
      expect(response.message).toBe("No nodes available for processing");
      expect(response.totalNodes).toBe(0);
    });

    it("should process master node and identify dependencies", async () => {
      // Add a master node to the DAG
      const masterNodeId = session.dagManager.addNode(
        "master_curl",
        {
          key: (() => {
            const request = session.harData.requests[1];
            if (!request) {
              throw new Error(
                "Test setup failed: expected at least two requests in HAR data."
              );
            }
            return request;
          })(), // Profile request with auth token
          value: session.harData.requests[1]?.response || null,
        },
        {
          dynamicParts: ["None"],
          extractedParts: ["None"],
        }
      );

      session.state.toBeProcessedNodes.push(masterNodeId);

      const mockServer = {
        handleProcessNextNode: async (args: { sessionId: string }) => {
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }
          const nodeId = session.state.toBeProcessedNodes.shift();
          if (nodeId === undefined) {
            throw new Error(
              "Test setup failed: processing queue is unexpectedly empty."
            );
          }
          const node = session.dagManager.getNode(nodeId);
          if (!node) {
            throw new Error(
              `Test setup failed: node with ID "${nodeId}" was not found.`
            );
          }

          // Simulate dynamic parts identification
          const mockDynamicParts = ["token123", "12345"]; // From Bearer token and user_id

          // Update node with identified dynamic parts
          session.dagManager.updateNode(nodeId, {
            dynamicParts: mockDynamicParts,
          });

          // Simulate dependency finding - token123 comes from login request
          const newDepNodeId = session.dagManager.addNode(
            "curl",
            {
              key: (() => {
                const request = session.harData.requests[0];
                if (!request) {
                  throw new Error(
                    "Test setup failed: expected at least one request in HAR data."
                  );
                }
                return request;
              })(), // Login request
              value: session.harData.requests[0]?.response || null,
            },
            {
              extractedParts: ["token123"],
            }
          );

          session.dagManager.addEdge(nodeId, newDepNodeId);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  nodeId,
                  status: "completed",
                  dynamicPartsFound: mockDynamicParts.length,
                  newNodesAdded: 1,
                  remainingNodes: session.state.toBeProcessedNodes.length,
                  totalNodes: session.dagManager.getNodeCount(),
                }),
              },
            ],
          };
        },
      };

      const result = await mockServer.handleProcessNextNode({
        sessionId: session.id,
      });
      const response = JSON.parse(result.content?.[0]?.text || "{}");

      expect(response.status).toBe("completed");
      expect(response.dynamicPartsFound).toBe(2);
      expect(response.newNodesAdded).toBe(1);
      expect(response.totalNodes).toBe(2);

      // Verify the dependency was created
      const edges = session.dagManager.toJSON().edges;
      expect(edges).toHaveLength(1);
    });

    it("should skip JavaScript files", () => {
      // Create a JavaScript request
      const jsRequest = new Request(
        "GET",
        "https://example.com/script.js",
        {},
        {}
      );
      const jsNodeId = session.dagManager.addNode(
        "curl",
        { key: jsRequest, value: null },
        { dynamicParts: [] }
      );

      session.state.toBeProcessedNodes.push(jsNodeId);

      const mockServer = {
        handleProcessNextNode: (args: { sessionId: string }) => {
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }
          const nodeId = session.state.toBeProcessedNodes.shift();
          if (nodeId === undefined) {
            throw new Error(
              "Test setup failed: processing queue is unexpectedly empty."
            );
          }
          const node = session.dagManager.getNode(nodeId);
          if (!node) {
            throw new Error(
              `Test setup failed: node with ID "${nodeId}" was not found.`
            );
          }
          const request = node.content.key as RequestModel;

          // Check if it's a JavaScript file
          if (request.toCurlCommand().endsWith(".js'")) {
            session.dagManager.updateNode(nodeId, { dynamicParts: [] });

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    nodeId,
                    status: "skipped_javascript",
                    message: "Skipped JavaScript file",
                    remainingNodes: session.state.toBeProcessedNodes.length,
                  }),
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  nodeId,
                  status: "processed",
                  message: "Node processed successfully",
                }),
              },
            ],
          };
        },
      };

      const result = mockServer.handleProcessNextNode({
        sessionId: session.id,
      });
      const response = JSON.parse(result?.content?.[0]?.text || "{}");

      expect(response.status).toBe("skipped_javascript");
      expect(response.message).toBe("Skipped JavaScript file");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing node gracefully", () => {
      session.state.toBeProcessedNodes.push("non-existent-node");

      const mockServer = {
        handleProcessNextNode: (args: { sessionId: string }) => {
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            throw new Error("Session not found");
          }
          const nodeId = session.state.toBeProcessedNodes.shift();
          if (nodeId === undefined) {
            throw new Error(
              "Test setup failed: processing queue is unexpectedly empty."
            );
          }
          const node = session.dagManager.getNode(nodeId);

          if (!node) {
            throw new Error(`Node ${nodeId} not found in DAG`);
          }
        },
      };

      expect(() => {
        mockServer.handleProcessNextNode({ sessionId: session.id });
      }).toThrow("Node non-existent-node not found in DAG");
    });

    it("should handle invalid session ID", () => {
      const mockServer = {
        handleProcessNextNode: (args: { sessionId: string }) => {
          const session = sessionManager.getSession(args.sessionId);
          if (!session) {
            throw new Error(`Session not found: ${args.sessionId}`);
          }
        },
      };

      expect(() => {
        mockServer.handleProcessNextNode({ sessionId: "invalid-session" });
      }).toThrow("Session invalid-session not found");
    });
  });
});
