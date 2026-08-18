/**
 * Dependency Flow Generator for Authentication Workflows
 *
 * This class analyzes DAG (Directed Acyclic Graph) dependencies and generates
 * intelligent workflow orchestration code that automatically handles:
 * - Authentication token extraction and passing
 * - Cookie setting and reading integration
 * - Dependency-aware function execution order
 * - Smart parameter passing between functions
 *
 * The generated workflows transform manual API integration into seamless,
 * production-ready authentication flows.
 */

import type {
  DAGNode,
  HarvestSession,
  RequestModel,
} from "../../types/index.js";
import { createComponentLogger } from "../../utils/logger.js";

const logger = createComponentLogger("dependency-flow-generator");

/**
 * Represents a step in the authentication workflow
 */
export interface WorkflowStep {
  /** Unique identifier for this step */
  id: string;
  /** Type of step (cookie, auth, api_call) */
  type: "cookie" | "auth" | "api_call";
  /** The DAG node this step represents */
  node: DAGNode;
  /** Function name that will be generated/called */
  functionName: string;
  /** Dependencies this step requires (previous step IDs) */
  dependencies: string[];
  /** Parameters this step requires */
  requiredParameters: WorkflowParameter[];
  /** Values this step extracts for use by other steps */
  extractedValues: WorkflowExtraction[];
  /** Variables this step accepts from user input */
  inputVariables: WorkflowInputVariable[];
}

/**
 * Represents a parameter required by a workflow step
 */
export interface WorkflowParameter {
  /** Parameter name in function signature */
  name: string;
  /** TypeScript type */
  type: string;
  /** Whether parameter is optional */
  optional: boolean;
  /** Source of this parameter (user_input, extracted_value, cookie) */
  source: "user_input" | "extracted_value" | "cookie";
  /** If source is extracted_value, which step extracts it */
  sourceStepId?: string | undefined;
  /** If source is extracted_value, what field to extract */
  sourceField?: string;
  /** If source is cookie, the cookie name */
  cookieName?: string;
  /** Human-readable description */
  description: string;
}

/**
 * Represents a value extracted by a workflow step for use by other steps
 */
export interface WorkflowExtraction {
  /** Name of the extracted value */
  name: string;
  /** TypeScript type of the extracted value */
  type: string;
  /** JSONPath or field path to extract from response */
  extractPath: string;
  /** Description of what this value represents */
  description: string;
  /** Whether this extraction is required for the workflow to continue */
  required: boolean;
}

/**
 * Represents a user input variable required by the workflow
 */
export interface WorkflowInputVariable {
  /** Parameter name */
  name: string;
  /** TypeScript type */
  type: string;
  /** Whether this input is optional */
  optional: boolean;
  /** User-friendly description for documentation */
  description: string;
  /** Default value if any */
  defaultValue?: string;
}

/**
 * Complete authentication workflow representation
 */
export interface AuthenticationWorkflow {
  /** All steps in execution order */
  steps: WorkflowStep[];
  /** All user input parameters required by the workflow */
  inputParameters: WorkflowInputVariable[];
  /** Final return type of the workflow */
  returnType: string;
  /** Human-readable description of what this workflow does */
  description: string;
  /** Whether this workflow requires cookie support */
  usesCookies: boolean;
  /** Whether this workflow includes authentication */
  hasAuthentication: boolean;
}

/**
 * Generates dependency flow analysis and orchestration code
 */
export class DependencyFlowGenerator {
  private session: HarvestSession;
  private nodeFunctionNameMap: Map<string, string>;

  constructor(
    session: HarvestSession,
    nodeFunctionNameMap: Map<string, string>
  ) {
    this.session = session;
    this.nodeFunctionNameMap = nodeFunctionNameMap;
  }

  /**
   * Analyze the DAG and generate a complete authentication workflow
   */
  analyzeWorkflow(): AuthenticationWorkflow {
    logger.debug("Analyzing workflow dependencies", {
      sessionId: this.session.id,
      totalNodes: Array.from(this.session.dagManager.getAllNodes().values())
        .length,
    });

    // Get topologically sorted node IDs for proper execution order
    const sortedNodeIds = this.session.dagManager.topologicalSort();

    // Create workflow steps for each node
    const steps: WorkflowStep[] = [];
    const allInputParameters = new Set<string>();
    let usesCookies = false;
    let hasAuthentication = false;

    for (const nodeId of sortedNodeIds) {
      const node = this.session.dagManager.getNode(nodeId);
      if (!node) {
        continue;
      }

      const step = this.createWorkflowStep(node);
      if (step) {
        steps.push(step);

        // Track workflow characteristics
        if (step.type === "cookie") {
          usesCookies = true;
        }
        if (step.type === "auth") {
          hasAuthentication = true;
        }

        // Collect input variables from step.inputVariables
        for (const input of step.inputVariables) {
          allInputParameters.add(
            `${input.name}:${input.type}:${input.optional}`
          );
        }

        // Also collect user input parameters from step.requiredParameters
        for (const param of step.requiredParameters.filter(
          (param) => param.source === "user_input"
        )) {
          allInputParameters.add(
            `${param.name}:${param.type}:${param.optional}`
          );
        }
      }
    }

    // Convert input parameters set to array and deduplicate
    const inputParameters: WorkflowInputVariable[] = [];
    const seenParams = new Set<string>();

    for (const paramStr of Array.from(allInputParameters)) {
      const [name, type, optional] = paramStr.split(":");
      if (name && type && !seenParams.has(name)) {
        seenParams.add(name);
        inputParameters.push({
          name,
          type,
          optional: optional === "true",
          description: `User input parameter: ${name}`,
        });
      }
    }

    // Determine final return type (last step's function return type)
    const masterNodeId = this.session.state.masterNodeId;
    let returnType = "ApiResponse";

    if (masterNodeId) {
      const masterStep = steps.find((s) => s.node.id === masterNodeId);
      if (masterStep && masterStep.type === "api_call") {
        returnType = "ApiResponse";
      }
    }

    const workflow: AuthenticationWorkflow = {
      steps,
      inputParameters,
      returnType,
      description: this.generateWorkflowDescription(steps),
      usesCookies,
      hasAuthentication,
    };

    logger.debug("Workflow analysis complete", {
      sessionId: this.session.id,
      stepCount: steps.length,
      inputParameterCount: inputParameters.length,
      usesCookies,
      hasAuthentication,
    });

    return workflow;
  }

  /**
   * Create a workflow step from a DAG node
   */
  private createWorkflowStep(node: DAGNode): WorkflowStep | null {
    const functionName = this.nodeFunctionNameMap.get(node.id);
    if (!functionName) {
      logger.warn("No function name found for node", { nodeId: node.id });
      return null;
    }

    // Determine step type
    let stepType: "cookie" | "auth" | "api_call";
    if (node.nodeType === "cookie") {
      stepType = "cookie";
    } else if (this.isAuthenticationNode(node)) {
      stepType = "auth";
    } else {
      stepType = "api_call";
    }

    // Get dependencies
    const dependencies = this.session.dagManager.getPredecessors(node.id);

    // Analyze required parameters
    const requiredParameters = this.analyzeRequiredParameters(node);

    // Analyze extracted values
    const extractedValues = this.analyzeExtractedValues(node);

    // Analyze input variables
    const inputVariables = this.analyzeInputVariables(node);

    const step: WorkflowStep = {
      id: node.id,
      type: stepType,
      node,
      functionName,
      dependencies,
      requiredParameters,
      extractedValues,
      inputVariables,
    };

    logger.debug("Created workflow step", {
      stepId: step.id,
      type: step.type,
      functionName: step.functionName,
      dependencyCount: dependencies.length,
      parameterCount: requiredParameters.length,
      extractionCount: extractedValues.length,
    });

    return step;
  }

  /**
   * Determine if a node represents an authentication endpoint
   */
  private isAuthenticationNode(node: DAGNode): boolean {
    if (node.nodeType === "cookie") {
      return false;
    }

    const request = node.content.key as RequestModel;
    if (!request?.url) {
      return false;
    }

    const url = String(request.url).toLowerCase();
    const authPatterns = [
      "/auth",
      "/login",
      "/signin",
      "/authenticate",
      "/token",
      "/oauth",
      "/session",
    ];

    return authPatterns.some((pattern) => url.includes(pattern));
  }

  /**
   * Analyze what parameters this node requires
   */
  private analyzeRequiredParameters(node: DAGNode): WorkflowParameter[] {
    const parameters: WorkflowParameter[] = [];

    // Check for cookie dependencies
    const predecessors = this.session.dagManager.getPredecessors(node.id);
    for (const predId of predecessors) {
      const predNode = this.session.dagManager.getNode(predId);
      if (predNode && predNode.nodeType === "cookie") {
        const cookieKey = predNode.content.key as string;
        parameters.push({
          name: `${cookieKey}Cookie`,
          type: "string",
          optional: true,
          source: "cookie",
          cookieName: cookieKey,
          description: `Cookie value for ${cookieKey}`,
        });
      }
    }

    // Check for auth token dependencies
    if (node.nodeType !== "cookie" && this.hasAuthTokenDependency(node)) {
      parameters.push({
        name: "authToken",
        type: "string",
        optional: false,
        source: "extracted_value",
        sourceStepId: this.findAuthTokenSource(node) || undefined,
        sourceField: "data.token",
        description: "Authentication token from login response",
      });
    }

    // Check for user input parameters from Request object
    const request = node.content.key;
    if (request && typeof request === "object") {
      // Check if it's a Request object with body
      if (
        "body" in request &&
        request.body &&
        typeof request.body === "object"
      ) {
        const bodyParams = this.extractUserInputFromObject(
          request.body as Record<string, unknown>,
          "body"
        );
        parameters.push(...bodyParams);
      }

      // Check if it's a Request object with query params
      if (
        "queryParams" in request &&
        request.queryParams &&
        typeof request.queryParams === "object"
      ) {
        const queryParams = this.extractUserInputFromObject(
          request.queryParams as Record<string, unknown>,
          "query"
        );
        parameters.push(...queryParams);
      }

      // Legacy format check only if modern format didn't find params
      if (
        !("body" in request) &&
        !("queryParams" in request) &&
        request.queryParams &&
        typeof request.queryParams === "object"
      ) {
        const queryParams = this.extractUserInputFromObject(
          request.queryParams,
          "query"
        );
        parameters.push(...queryParams);
      }

      if (
        !("body" in request) &&
        !("queryParams" in request) &&
        request.body &&
        typeof request.body === "object"
      ) {
        const bodyParams = this.extractUserInputFromObject(
          request.body as Record<string, unknown>,
          "body"
        );
        parameters.push(...bodyParams);
      }
    }

    return parameters;
  }

  /**
   * Analyze what values this node extracts for other nodes
   */
  private analyzeExtractedValues(node: DAGNode): WorkflowExtraction[] {
    const extractions: WorkflowExtraction[] = [];

    // Check if this node has extractedParts metadata
    if (node.extractedParts && node.extractedParts.length > 0) {
      for (const part of node.extractedParts) {
        // Common authentication token patterns
        if (part.includes("token") || part.includes("auth")) {
          extractions.push({
            name: "authToken",
            type: "string",
            extractPath: "data.token",
            description: "Authentication token for subsequent requests",
            required: true,
          });
        }

        // Session ID patterns
        if (part.includes("session") || part.includes("sessionId")) {
          extractions.push({
            name: "sessionId",
            type: "string",
            extractPath: "data.sessionId",
            description: "Session identifier",
            required: false,
          });
        }

        // User ID patterns
        if (part.includes("user") && part.includes("id")) {
          extractions.push({
            name: "userId",
            type: "string",
            extractPath: "data.user.id",
            description: "User identifier",
            required: false,
          });
        }
      }
    }

    return extractions;
  }

  /**
   * Analyze what input variables this node requires from users
   */
  private analyzeInputVariables(node: DAGNode): WorkflowInputVariable[] {
    const inputVariables: WorkflowInputVariable[] = [];

    if (node.inputVariables) {
      for (const [key, value] of Object.entries(node.inputVariables)) {
        inputVariables.push({
          name: key,
          type: this.inferTypeFromValue(value),
          optional: this.isOptionalInput(key, value),
          description: `User input: ${key}`,
        });
      }
    }

    return inputVariables;
  }

  /**
   * Check if node has authentication token dependency
   */
  private hasAuthTokenDependency(node: DAGNode): boolean {
    const request = node.content.key as RequestModel;
    if (!request?.headers) {
      return false;
    }

    return Object.entries(request.headers).some(
      ([key, value]) =>
        key.toLowerCase() === "authorization" &&
        String(value).includes("Bearer")
    );
  }

  /**
   * Find the source node that provides the auth token
   */
  private findAuthTokenSource(node: DAGNode): string | undefined {
    const predecessors = this.session.dagManager.getPredecessors(node.id);

    for (const predId of predecessors) {
      const predNode = this.session.dagManager.getNode(predId);
      if (predNode && this.isAuthenticationNode(predNode)) {
        return predId;
      }
    }

    return undefined;
  }

  /**
   * Extract user input parameters from an object
   */
  private extractUserInputFromObject(
    obj: Record<string, unknown>,
    context: "body" | "query"
  ): WorkflowParameter[] {
    const parameters: WorkflowParameter[] = [];

    for (const [key, value] of Object.entries(obj)) {
      parameters.push({
        name: key,
        type: this.inferTypeFromValue(value),
        optional: this.isOptionalInput(key, value),
        source: "user_input",
        description: `${context === "body" ? "Request body" : "Query"} parameter: ${key}`,
      });
    }

    return parameters;
  }

  /**
   * Infer TypeScript type from a value
   */
  private inferTypeFromValue(value: unknown): string {
    if (typeof value === "string") {
      return "string";
    }
    if (typeof value === "number") {
      return "number";
    }
    if (typeof value === "boolean") {
      return "boolean";
    }
    if (Array.isArray(value)) {
      return "any[]";
    }
    if (value && typeof value === "object") {
      return "Record<string, unknown>";
    }
    return "unknown";
  }

  /**
   * Determine if an input should be optional
   */
  private isOptionalInput(key: string, value: unknown): boolean {
    const optionalPatterns = [
      "optional",
      "extra",
      "additional",
      "page",
      "limit",
      "offset",
      "sort",
      "remember",
      "persist",
    ];

    return (
      optionalPatterns.some((pattern) => key.toLowerCase().includes(pattern)) ||
      typeof value === "boolean"
    );
  }

  /**
   * Generate a human-readable description of the workflow
   */
  private generateWorkflowDescription(steps: WorkflowStep[]): string {
    const stepTypes = steps.map((s) => s.type);
    const hasCookies = stepTypes.includes("cookie");
    const hasAuth = stepTypes.includes("auth");
    const hasApiCalls = stepTypes.includes("api_call");

    let description = "API workflow";

    if (hasCookies && hasAuth && hasApiCalls) {
      description =
        "Complete authentication workflow with cookie management and API integration";
    } else if (hasAuth && hasApiCalls) {
      description = "Authentication workflow with API integration";
    } else if (hasCookies && hasApiCalls) {
      description = "Cookie-based API workflow";
    } else if (hasAuth) {
      description = "Authentication-only workflow";
    } else if (hasApiCalls) {
      description = "API integration workflow";
    }

    return description;
  }

  /**
   * Generate the orchestration code for the complete workflow
   */
  generateOrchestrationCode(workflow: AuthenticationWorkflow): string {
    logger.debug("Generating orchestration code", {
      sessionId: this.session.id,
      stepCount: workflow.steps.length,
    });

    const lines: string[] = [];

    // Generate step-by-step execution
    const previousResults: string[] = [];

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      if (!step) {
        continue;
      }
      const stepVar = `step${i + 1}Result`;

      // Generate function call with proper parameters
      const functionCall = this.generateStepFunctionCall(
        step,
        workflow,
        previousResults
      );

      if (step.type === "cookie") {
        // Cookie functions don't return values, just execute
        lines.push(`    // ${step.type.toUpperCase()}: ${step.functionName}`);
        lines.push(`    ${functionCall};`);
      } else {
        // API functions return results
        lines.push(`    // ${step.type.toUpperCase()}: ${step.functionName}`);
        lines.push(`    const ${stepVar} = await ${functionCall};`);
        lines.push(`    if (!${stepVar}.success) {`);
        lines.push("      throw new WorkflowExecutionError(");
        lines.push(
          `        \`${step.functionName} failed: \${${stepVar}.status}\`,`
        );
        lines.push(`        '${step.functionName}',`);
        lines.push(`        '${step.type}',`);
        lines.push(`        ${stepVar}.status`);
        lines.push("      );");
        lines.push("    }");
        lines.push("");

        previousResults.push(stepVar);
      }
    }

    // Return the final result
    const finalResult = previousResults[previousResults.length - 1];
    if (finalResult) {
      lines.push("    // Return the final result");
      lines.push(`    return ${finalResult};`);
    } else {
      lines.push("    // No API results to return");
      lines.push(
        "    return { success: true, data: null, status: 200, headers: {} };"
      );
    }

    return lines.join("\n");
  }

  /**
   * Generate the function call for a specific workflow step
   */
  private generateStepFunctionCall(
    step: WorkflowStep,
    workflow: AuthenticationWorkflow,
    previousResults: string[]
  ): string {
    const args: string[] = [];
    const seenArgs = new Set<string>();

    for (const param of step.requiredParameters) {
      let argValue: string | null = null;

      if (param.source === "user_input") {
        // User input parameters come directly from function parameters
        argValue = param.name;
      } else if (param.source === "extracted_value" && param.sourceStepId) {
        // Find the result variable for the source step
        const sourceStepIndex = workflow.steps.findIndex(
          (s) => s.id === param.sourceStepId
        );
        if (sourceStepIndex >= 0) {
          // Calculate the result index by counting non-cookie steps before this one
          let resultIndex = 0;
          for (let i = 0; i < sourceStepIndex; i++) {
            if (workflow.steps[i]?.type !== "cookie") {
              resultIndex++;
            }
          }
          if (resultIndex < previousResults.length) {
            const sourceResult = previousResults[resultIndex];
            argValue = `${sourceResult}.${param.sourceField || "data"}`;
          }
        }
      } else if (param.source === "cookie" && param.cookieName) {
        // Cookie parameters come from cookie manager calls
        argValue = `cookieManager.get('${param.cookieName}')`;
      }

      // Only add if we haven't seen this exact argument before
      if (argValue && !seenArgs.has(argValue)) {
        seenArgs.add(argValue);
        args.push(argValue);
      }
    }

    return `${step.functionName}(${args.join(", ")})`;
  }
}
