import { beforeEach, describe, expect, it } from "vitest";
import { DAGManager } from "../../../src/core/DAGManager.js";
import { Request } from "../../../src/models/Request.js";

describe("DAGManager", () => {
  let dagManager: DAGManager;

  beforeEach(() => {
    dagManager = new DAGManager();
  });

  describe("addNode", () => {
    it("should add a node and return valid UUID", () => {
      const testRequest = new Request("GET", "https://test.com", {});
      const nodeId = dagManager.addNode("master", { key: testRequest });

      expect(nodeId).toBeDefined();
      expect(typeof nodeId).toBe("string");
      expect(nodeId.length).toBe(36); // UUID length

      const node = dagManager.getNode(nodeId);
      expect(node).toBeDefined();
      expect(node?.nodeType).toBe("master");
      expect(node?.content.key).toMatchObject({ url: "https://test.com" });
    });

    it("should add node with attributes", () => {
      const testRequest = new Request("POST", "https://api.test.com", {});
      const nodeId = dagManager.addNode(
        "curl",
        { key: testRequest },
        {
          dynamicParts: ["token", "user_id"],
          extractedParts: ["session_id"],
          inputVariables: { username: "test" },
        }
      );

      const node = dagManager.getNode(nodeId);
      expect(node?.dynamicParts).toEqual(["token", "user_id"]);
      expect(node?.extractedParts).toEqual(["session_id"]);
      expect(node?.inputVariables).toEqual({ username: "test" });
    });
  });

  describe("updateNode", () => {
    it("should update existing node attributes", () => {
      const testRequest = new Request("GET", "https://test.com", {});
      const nodeId = dagManager.addNode("curl", { key: testRequest });

      dagManager.updateNode(nodeId, {
        dynamicParts: ["new_token"],
        extractedParts: ["new_part"],
      });

      const node = dagManager.getNode(nodeId);
      expect(node?.dynamicParts).toEqual(["new_token"]);
      expect(node?.extractedParts).toEqual(["new_part"]);
      expect(node?.content.key).toMatchObject({ url: "https://test.com" }); // Should preserve existing content
    });

    it("should throw error for nonexistent node", () => {
      expect(() => dagManager.updateNode("nonexistent", {})).toThrow(
        "Node nonexistent not found"
      );
    });
  });

  describe("addEdge", () => {
    it("should add edge between nodes", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });

      dagManager.addEdge(nodeId1, nodeId2);

      const successors = dagManager.getSuccessors(nodeId1);
      const predecessors = dagManager.getPredecessors(nodeId2);

      expect(successors).toContain(nodeId2);
      expect(predecessors).toContain(nodeId1);
    });
  });

  describe("detectCycles", () => {
    it("should return null for acyclic graph", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const testRequest3 = new Request("GET", "https://test3.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });
      const nodeId3 = dagManager.addNode("curl", { key: testRequest3 });

      dagManager.addEdge(nodeId1, nodeId2);
      dagManager.addEdge(nodeId2, nodeId3);

      const cycles = dagManager.detectCycles();
      expect(cycles).toBeNull();
    });

    it("should detect cycle in graph", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });

      dagManager.addEdge(nodeId1, nodeId2);
      dagManager.addEdge(nodeId2, nodeId1); // Create cycle

      const cycles = dagManager.detectCycles();
      expect(cycles).not.toBeNull();
      expect(cycles?.length).toBeGreaterThan(0);
    });
  });

  describe("topologicalSort", () => {
    it("should return topologically sorted nodes", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const testRequest3 = new Request("GET", "https://test3.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });
      const nodeId3 = dagManager.addNode("curl", { key: testRequest3 });

      dagManager.addEdge(nodeId1, nodeId2);
      dagManager.addEdge(nodeId2, nodeId3);

      const sorted = dagManager.topologicalSort();

      expect(sorted).toHaveLength(3);
      expect(sorted.indexOf(nodeId1)).toBeLessThan(sorted.indexOf(nodeId2));
      expect(sorted.indexOf(nodeId2)).toBeLessThan(sorted.indexOf(nodeId3));
    });
  });

  describe("isComplete", () => {
    it("should return true when no nodes have dynamic parts", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      dagManager.addNode("master", { key: testRequest1 });
      dagManager.addNode("curl", { key: testRequest2 }, { dynamicParts: [] });

      expect(dagManager.isComplete()).toBe(true);
    });

    it("should return false when nodes have unresolved dynamic parts", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      dagManager.addNode("master", { key: testRequest1 });
      dagManager.addNode(
        "curl",
        { key: testRequest2 },
        { dynamicParts: ["token"] }
      );

      expect(dagManager.isComplete()).toBe(false);
    });
  });

  describe("getUnresolvedNodes", () => {
    it("should return nodes with unresolved dynamic parts", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const testRequest3 = new Request("GET", "https://test3.com", {});
      dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode(
        "curl",
        { key: testRequest2 },
        { dynamicParts: ["token", "user_id"] }
      );
      dagManager.addNode("curl", { key: testRequest3 }, { dynamicParts: [] });

      const unresolved = dagManager.getUnresolvedNodes();

      expect(unresolved).toHaveLength(1);
      expect(unresolved[0]?.nodeId).toBe(nodeId2);
      expect(unresolved[0]?.unresolvedParts).toEqual(["token", "user_id"]);
    });

    it("should return empty array when all nodes are resolved", () => {
      const testRequest1 = new Request("GET", "https://test1.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      dagManager.addNode("master", { key: testRequest1 });
      dagManager.addNode("curl", { key: testRequest2 }, { dynamicParts: [] });

      const unresolved = dagManager.getUnresolvedNodes();
      expect(unresolved).toHaveLength(0);
    });
  });

  describe("toJSON", () => {
    it("should export graph as JSON", () => {
      const testRequest1 = new Request("GET", "https://test.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });
      dagManager.addEdge(nodeId1, nodeId2);

      const json = dagManager.toJSON();

      expect(json).toHaveProperty("nodes");
      expect(json).toHaveProperty("edges");
      expect(json).toHaveProperty("nodeCount");
      expect(json).toHaveProperty("edgeCount");

      expect(json.nodes).toHaveLength(2);
      expect(json.edges).toHaveLength(1);
      expect(json.nodeCount).toBe(2);
      expect(json.edgeCount).toBe(1);

      expect(json.edges[0]).toEqual({ from: nodeId1, to: nodeId2 });
    });
  });

  describe("getNodeCount", () => {
    it("should return correct node count", () => {
      expect(dagManager.getNodeCount()).toBe(0);

      const testRequest1 = new Request("GET", "https://test.com", {});
      dagManager.addNode("master", { key: testRequest1 });
      expect(dagManager.getNodeCount()).toBe(1);

      const testRequest2 = new Request("GET", "https://test2.com", {});
      dagManager.addNode("curl", { key: testRequest2 });
      expect(dagManager.getNodeCount()).toBe(2);
    });
  });

  describe("getAllNodes", () => {
    it("should return all nodes as Map", () => {
      const testRequest1 = new Request("GET", "https://test.com", {});
      const testRequest2 = new Request("GET", "https://test2.com", {});
      const nodeId1 = dagManager.addNode("master", { key: testRequest1 });
      const nodeId2 = dagManager.addNode("curl", { key: testRequest2 });

      const allNodes = dagManager.getAllNodes();

      expect(allNodes.size).toBe(2);
      expect(allNodes.has(nodeId1)).toBe(true);
      expect(allNodes.has(nodeId2)).toBe(true);

      const node1 = allNodes.get(nodeId1);
      expect(node1?.nodeType).toBe("master");
      if (node1?.nodeType === "master") {
        expect((node1.content.key as { url: string }).url).toBe(
          "https://test.com"
        );
      }
    });
  });
});
