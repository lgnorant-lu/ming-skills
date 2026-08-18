import { Graph } from "@dagrejs/graphlib";
import { v4 as uuidv4 } from "uuid";
import { createComponentLogger } from "../utils/logger.js";

const logger = createComponentLogger("dag-manager");

import type {
  BootstrapParameterSource,
  CookieDAGNode,
  CookieNodeContent,
  CurlDAGNode,
  DAGExport,
  DAGNode,
  MasterCurlDAGNode,
  MasterDAGNode,
  NodeType,
  NotFoundDAGNode,
  NotFoundNodeContent,
  RequestModel,
  RequestNodeContent,
} from "../types/index.js";

export class DAGManager {
  private graph: Graph;

  constructor() {
    this.graph = new Graph({ directed: true });
  }

  /**
   * Add a new node to the DAG
   */
  addNode(
    nodeType: NodeType,
    content: RequestNodeContent | CookieNodeContent | NotFoundNodeContent,
    attributes?: Partial<DAGNode>,
    groupId?: string
  ): string {
    const nodeId = uuidv4();

    // Create the node with proper typing based on nodeType
    let nodeData: DAGNode;

    switch (nodeType) {
      case "curl":
        nodeData = {
          id: nodeId,
          nodeType: "curl" as const,
          content: content as RequestNodeContent,
          dynamicParts: attributes?.dynamicParts || [],
          extractedParts: attributes?.extractedParts || [],
          inputVariables: attributes?.inputVariables || {},
          groupId,
          ...attributes,
        } as CurlDAGNode;
        break;
      case "cookie":
        nodeData = {
          id: nodeId,
          nodeType: "cookie" as const,
          content: content as CookieNodeContent,
          dynamicParts: attributes?.dynamicParts || [],
          extractedParts: attributes?.extractedParts || [],
          inputVariables: attributes?.inputVariables || {},
          groupId,
          ...attributes,
        } as CookieDAGNode;
        break;
      case "not_found":
        nodeData = {
          id: nodeId,
          nodeType: "not_found" as const,
          content: content as NotFoundNodeContent,
          dynamicParts: attributes?.dynamicParts || [],
          extractedParts: attributes?.extractedParts || [],
          inputVariables: attributes?.inputVariables || {},
          groupId,
          ...attributes,
        } as NotFoundDAGNode;
        break;
      case "master":
        nodeData = {
          id: nodeId,
          nodeType: "master" as const,
          content: content as RequestNodeContent,
          dynamicParts: attributes?.dynamicParts || [],
          extractedParts: attributes?.extractedParts || [],
          inputVariables: attributes?.inputVariables || {},
          groupId,
          ...attributes,
        } as MasterDAGNode;
        break;
      case "master_curl":
        nodeData = {
          id: nodeId,
          nodeType: "master_curl" as const,
          content: content as RequestNodeContent,
          dynamicParts: attributes?.dynamicParts || [],
          extractedParts: attributes?.extractedParts || [],
          inputVariables: attributes?.inputVariables || {},
          groupId,
          ...attributes,
        } as MasterCurlDAGNode;
        break;
      default:
        throw new Error(`Unknown node type: ${nodeType}`);
    }

    this.graph.setNode(nodeId, nodeData);
    return nodeId;
  }

  /**
   * Update an existing node's attributes
   */
  updateNode(nodeId: string, attributes: Partial<DAGNode>): void {
    const existingNode = this.graph.node(nodeId);
    if (!existingNode) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const updatedNode = { ...existingNode, ...attributes };
    this.graph.setNode(nodeId, updatedNode);
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): DAGNode | undefined {
    return this.graph.node(nodeId);
  }

  /**
   * Add an edge between two nodes
   */
  addEdge(fromId: string, toId: string): void {
    this.graph.setEdge(fromId, toId);
  }

  /**
   * Detect cycles in the graph
   */
  detectCycles(): string[][] | null {
    try {
      // @dagrejs/graphlib doesn't have built-in cycle detection,
      // so we implement a simple DFS-based approach
      const visited = new Set<string>();
      const recursionStack = new Set<string>();
      const cycles: string[][] = [];

      const hasCycle = (node: string, path: string[]): boolean => {
        if (recursionStack.has(node)) {
          // Found a cycle - extract the cycle path
          const cycleStart = path.indexOf(node);
          cycles.push(path.slice(cycleStart));
          return true;
        }

        if (visited.has(node)) {
          return false;
        }

        visited.add(node);
        recursionStack.add(node);

        const successors = this.graph.successors(node) || [];
        for (const successor of successors) {
          if (hasCycle(successor, [...path, node])) {
            return true;
          }
        }

        recursionStack.delete(node);
        return false;
      };

      // Check all nodes
      for (const node of this.graph.nodes()) {
        if (!visited.has(node)) {
          hasCycle(node, []);
        }
      }

      return cycles.length > 0 ? cycles : null;
    } catch (error) {
      logger.error({ error }, "Error detecting cycles");
      return null;
    }
  }

  /**
   * Get the total number of nodes
   */
  getNodeCount(): number {
    return this.graph.nodeCount();
  }

  /**
   * Get all nodes as a Map
   */
  getAllNodes(): Map<string, DAGNode> {
    const nodes = new Map<string, DAGNode>();
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node) {
        nodes.set(nodeId, node);
      }
    }
    return nodes;
  }

  /**
   * Check if all nodes have been properly classified for parameter analysis
   * This ensures completion state only reports true when parameter classification is complete
   */
  areAllNodesParameterClassified(): boolean {
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node?.dynamicParts && node.dynamicParts.length > 0) {
        // If node has dynamic parts but no classification, it's not ready
        if (
          !node.classifiedParameters ||
          node.classifiedParameters.length === 0
        ) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Get nodes that still need parameter classification
   */
  getNodesNeedingClassification(): string[] {
    const needsClassification: string[] = [];
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node?.dynamicParts && node.dynamicParts.length > 0) {
        if (
          !node.classifiedParameters ||
          node.classifiedParameters.length === 0
        ) {
          needsClassification.push(nodeId);
        }
      }
    }
    return needsClassification;
  }

  /**
   * Perform topological sort of the graph
   * Throws error if cycles are detected
   */
  topologicalSort(): string[] {
    // Simple topological sort using Kahn's algorithm
    const inDegree = new Map<string, number>();
    const nodes = this.graph.nodes();

    // Initialize in-degree count
    for (const node of nodes) {
      inDegree.set(node, 0);
    }

    // Calculate in-degrees
    for (const node of nodes) {
      const successors = this.graph.successors(node) || [];
      for (const successor of successors) {
        inDegree.set(successor, (inDegree.get(successor) || 0) + 1);
      }
    }

    // Queue nodes with no incoming edges
    const queue: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    const result: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node) {
        break;
      }
      result.push(node);

      const successors = this.graph.successors(node) || [];
      for (const successor of successors) {
        const newDegree = (inDegree.get(successor) || 0) - 1;
        inDegree.set(successor, newDegree);

        if (newDegree === 0) {
          queue.push(successor);
        }
      }
    }

    // Check if there are remaining nodes (indicates a cycle)
    if (result.length !== nodes.length) {
      const cyclicNodes = nodes.filter((node) => !result.includes(node));
      throw new Error(
        `Graph contains cycles - topological sort impossible. Cyclic nodes: ${cyclicNodes.join(", ")}`
      );
    }

    return result;
  }

  /**
   * Export the graph as JSON
   */
  toJSON(): DAGExport {
    const nodes: Array<DAGNode & { id: string }> = [];
    const edges: Array<{ from: string; to: string }> = [];

    // Export nodes
    for (const nodeId of this.graph.nodes()) {
      const nodeData = this.graph.node(nodeId);
      nodes.push({
        id: nodeId,
        ...nodeData,
      });
    }

    // Export edges
    for (const edge of this.graph.edges()) {
      edges.push({
        from: edge.v,
        to: edge.w,
      });
    }

    return {
      nodes,
      edges,
      nodeCount: this.graph.nodeCount(),
      edgeCount: this.graph.edgeCount(),
    };
  }

  /**
   * Get predecessors of a node
   */
  getPredecessors(nodeId: string): string[] {
    return this.graph.predecessors(nodeId) || [];
  }

  /**
   * Get successors of a node
   */
  getSuccessors(nodeId: string): string[] {
    return this.graph.successors(nodeId) || [];
  }

  /**
   * Check if the graph has no unresolved nodes (all dynamic parts resolved)
   * Enhanced to consider parameter classification - only truly "dynamic" parameters block completion
   */
  isComplete(): boolean {
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node?.dynamicParts && node.dynamicParts.length > 0) {
        // If we have parameter classifications, filter out non-dynamic parameters
        if (node.classifiedParameters && node.classifiedParameters.length > 0) {
          const trulyDynamicParts = this.getTrulyDynamicParts(node);
          if (trulyDynamicParts.length > 0) {
            return false;
          }
        } else {
          // Fallback to old behavior if no classification is available
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Get all unresolved nodes (nodes with remaining dynamic parts)
   * Enhanced to consider parameter classification - only truly "dynamic" parameters are considered unresolved
   */
  getUnresolvedNodes(): Array<{ nodeId: string; unresolvedParts: string[] }> {
    const unresolvedNodes: Array<{
      nodeId: string;
      unresolvedParts: string[];
    }> = [];

    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node?.dynamicParts && node.dynamicParts.length > 0) {
        // If we have parameter classifications, filter out non-dynamic parameters
        if (node.classifiedParameters && node.classifiedParameters.length > 0) {
          const trulyDynamicParts = this.getTrulyDynamicParts(node);
          if (trulyDynamicParts.length > 0) {
            unresolvedNodes.push({
              nodeId,
              unresolvedParts: trulyDynamicParts,
            });
          }
        } else {
          // Fallback to old behavior if no classification is available
          unresolvedNodes.push({
            nodeId,
            unresolvedParts: [...node.dynamicParts],
          });
        }
      }
    }

    return unresolvedNodes;
  }

  /**
   * Get parameters that are truly dynamic (need resolution from previous responses)
   * Filters out sessionConstants, userInputs, staticConstants, and optional parameters
   * For sessionConstants, they are only resolved if they have a bootstrap source
   */
  getTrulyDynamicParts(node: DAGNode): string[] {
    if (!node.dynamicParts || !node.classifiedParameters) {
      return node.dynamicParts || [];
    }

    return node.dynamicParts.filter((part) => {
      const classification = node.classifiedParameters?.find(
        (cp) => cp.value === part || cp.name === part
      );

      if (!classification) {
        // If no classification, consider it unresolved
        return true;
      }

      // Dynamic parameters always need resolution
      if (classification.classification === "dynamic") {
        return true;
      }

      // Session constants need bootstrap source to be considered resolved
      if (classification.classification === "sessionConstant") {
        return !classification.metadata.bootstrapSource;
      }

      // User inputs, static constants, and optional parameters don't block completion
      return false;
    });
  }

  /**
   * Get session constants and user inputs for a node (for code generation)
   */
  getNodeConstants(nodeId: string): {
    sessionConstants: Record<string, string>;
    userInputs: Record<string, string>;
    staticConstants: Record<string, string>;
  } {
    const node = this.getNode(nodeId);
    const result = {
      sessionConstants: {} as Record<string, string>,
      userInputs: {} as Record<string, string>,
      staticConstants: {} as Record<string, string>,
    };

    if (!node?.classifiedParameters) {
      return result;
    }

    for (const param of node.classifiedParameters) {
      switch (param.classification) {
        case "sessionConstant":
          result.sessionConstants[param.name] = param.value;
          break;
        case "userInput":
          result.userInputs[param.name] = param.value;
          break;
        case "staticConstant":
          result.staticConstants[param.name] = param.value;
          break;
        // "dynamic" and "optional" parameters are handled elsewhere
      }
    }

    return result;
  }

  /**
   * Get bootstrap parameters for a node (for session initialization)
   */
  getNodeBootstrapParameters(nodeId: string): Array<{
    name: string;
    value: string;
    bootstrapSource: BootstrapParameterSource;
    requiresBootstrap: boolean;
  }> {
    const node = this.getNode(nodeId);
    const result: Array<{
      name: string;
      value: string;
      bootstrapSource: BootstrapParameterSource;
      requiresBootstrap: boolean;
    }> = [];

    if (!node?.classifiedParameters) {
      return result;
    }

    for (const param of node.classifiedParameters) {
      if (
        param.classification === "sessionConstant" &&
        param.metadata.bootstrapSource
      ) {
        result.push({
          name: param.name,
          value: param.value,
          bootstrapSource: param.metadata.bootstrapSource,
          requiresBootstrap: param.metadata.requiresBootstrap || false,
        });
      }
    }

    return result;
  }

  /**
   * Check if all session constants have bootstrap sources resolved
   */
  hasAllBootstrapSourcesResolved(nodeId: string): boolean {
    const node = this.getNode(nodeId);

    if (!node?.classifiedParameters) {
      return true; // No parameters means nothing to resolve
    }

    const sessionConstants = node.classifiedParameters.filter(
      (param) => param.classification === "sessionConstant"
    );

    if (sessionConstants.length === 0) {
      return true; // No session constants means nothing to resolve
    }

    return sessionConstants.every((param) => param.metadata.bootstrapSource);
  }

  /**
   * Find a node that contains a specific request
   */
  findNodeByRequest(request: RequestModel): string | null {
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (
        node &&
        (node.nodeType === "curl" ||
          node.nodeType === "master" ||
          node.nodeType === "master_curl")
      ) {
        if (node.content.key === request) {
          return nodeId;
        }
      }
    }
    return null;
  }

  /**
   * Get all nodes belonging to a specific workflow group
   */
  getNodesByGroup(groupId: string): Map<string, DAGNode> {
    const nodes = new Map<string, DAGNode>();
    for (const nodeId of this.graph.nodes()) {
      const node = this.graph.node(nodeId);
      if (node && node.groupId === groupId) {
        nodes.set(nodeId, node);
      }
    }
    return nodes;
  }

  /**
   * Get the workflow group ID for a given node
   */
  getNodeGroup(nodeId: string): string | undefined {
    const node = this.graph.node(nodeId);
    return node?.groupId;
  }
}
