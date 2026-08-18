/**
 * Wrapper Script Orchestrator
 *
 * Main orchestrator class that replaces string-based assembly in generateWrapperScript
 * with AST-based code generation. This handles the complete TypeScript source file
 * generation using ts-morph for type safety and automatic import management.
 */

import { findDependenciesWithAuthentication } from "../../agents/DependencyAgent.js";
import { analyzeSessionBootstrap } from "../../agents/SessionBootstrapAgent.js";
import type {
  AuthenticationDependency,
  DAGNode,
  HarvestSession,
  RequestModel,
  SessionBootstrapAnalysis,
} from "../../types/index.js";
import { createComponentLogger } from "../../utils/logger.js";
import { ASTProject } from "./ASTProject.js";
import { ASTTypeDefinitionEngine } from "./ASTTypeDefinitionEngine.js";
import { DependencyFlowGenerator } from "./DependencyFlowGenerator.js";
import { ASTFunctionEngine } from "./FunctionBuilder.js";

const logger = createComponentLogger("wrapper-script-orchestrator");

/**
 * Configuration for wrapper script generation
 */
export interface WrapperScriptConfig {
  /** Use in-memory file system (default: true) */
  useInMemoryFileSystem?: boolean;
  /** Enable code formatting (default: true) */
  formatCode?: boolean;
  /** Output file name (default: "api-client.ts") */
  fileName?: string;
  /** Enable automatic import management (default: true) */
  autoImports?: boolean;
  /** Use shared type imports to reduce boilerplate (default: true) */
  useSharedTypes?: boolean;
}

/**
 * Statistics about the generated script
 */
export interface GenerationStats {
  totalNodes: number;
  functionsGenerated: number;
  interfacesGenerated: number;
  typeAliasesGenerated: number;
  linesOfCode: number;
  importStatements: number;
}

/**
 * Main orchestrator for AST-based wrapper script generation
 */
export class WrapperScriptOrchestrator {
  private astProject: ASTProject;
  private typeEngine: ASTTypeDefinitionEngine;
  private functionEngine: ASTFunctionEngine;
  private config: Required<WrapperScriptConfig>;
  private nodeFunctionNameMap = new Map<string, string>();
  private generatedFunctionNames = new Set<string>();
  private authenticationAnalysis: {
    dependencies: AuthenticationDependency[];
    bootstrapAnalysis: SessionBootstrapAnalysis;
    requiresAuthentication: boolean;
  } | null = null;

  constructor(config: WrapperScriptConfig = {}) {
    this.config = {
      useInMemoryFileSystem: config.useInMemoryFileSystem ?? true,
      formatCode: config.formatCode ?? true,
      fileName: config.fileName ?? "api-client.ts",
      autoImports: config.autoImports ?? true,
      useSharedTypes: config.useSharedTypes ?? true,
    };

    // Initialize AST project
    this.astProject = new ASTProject({
      useInMemoryFileSystem: this.config.useInMemoryFileSystem,
      formatCode: this.config.formatCode,
    });

    // Initialize engines with the AST project
    this.typeEngine = new ASTTypeDefinitionEngine(this.astProject);
    this.functionEngine = new ASTFunctionEngine(this.astProject);

    logger.info("WrapperScriptOrchestrator initialized", {
      config: this.config,
    });
  }

  /**
   * Generate complete wrapper script from session
   */
  async generateWrapperScript(session: HarvestSession): Promise<string> {
    logger.info("Starting wrapper script generation", {
      sessionId: session.id,
      fileName: this.config.fileName,
    });

    try {
      // Create main source file and set it in function engine
      this.astProject.createSourceFile(this.config.fileName);
      this.functionEngine.setSourceFile(this.config.fileName);

      // Step 0: Analyze authentication requirements
      await this.analyzeAuthentication(session);

      // Step 1: Add file header comment
      await this.addFileHeader(session);

      // Step 2: Generate type definitions and interfaces
      await this.generateTypeDefinitions(session);

      // Step 3: Generate authentication setup functions if needed
      if (this.authenticationAnalysis?.requiresAuthentication) {
        await this.generateAuthenticationFunctions(session);
      }

      // Step 4: Generate functions for each node in dependency order
      await this.generateNodeFunctions(session);

      // Step 5: Generate main orchestration function and exports
      await this.generateMainFunction(session);

      // Step 5: Handle automatic imports if enabled
      if (this.config.autoImports) {
        await this.manageImports();
      }

      // Generate final code
      const generatedCode = this.astProject.generateCode(this.config.fileName);

      const stats = this.calculateStats(generatedCode);
      logger.info("Wrapper script generation completed", {
        sessionId: session.id,
        stats,
      });

      return generatedCode;
    } catch (error) {
      logger.error("Failed to generate wrapper script", {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add file header comment with metadata
   */
  private async addFileHeader(session: HarvestSession): Promise<void> {
    const headerComment = `/**
 * Generated API Client
 * Source: ${session.prompt}
 * Generated: ${new Date().toISOString()}
 * Session ID: ${session.id}
 * 
 * This file contains automatically generated TypeScript code for API interactions.
 * It includes type definitions, request functions, and orchestration logic.
 */`;

    this.astProject.addFileHeader(this.config.fileName, headerComment);
  }

  /**
   * Analyze authentication requirements for the session
   */
  private async analyzeAuthentication(session: HarvestSession): Promise<void> {
    try {
      logger.debug("Analyzing authentication requirements", {
        sessionId: session.id,
      });

      // Get all requests from the session
      const allRequests = this.getAllRequestsFromSession(session);

      // Perform enhanced dependency analysis with authentication
      const dependencyResult = await findDependenciesWithAuthentication(
        { requests: allRequests, urls: [] },
        session.cookieData || {},
        {}
      );

      // Analyze session bootstrap requirements
      const bootstrapAnalysis = await analyzeSessionBootstrap(
        allRequests,
        dependencyResult.sessionTokens,
        dependencyResult.authenticationDependencies.map((dep) => dep.parameter)
      );

      this.authenticationAnalysis = {
        dependencies: dependencyResult.authenticationDependencies,
        bootstrapAnalysis,
        requiresAuthentication:
          dependencyResult.requiresAuthentication ||
          bootstrapAnalysis.requiresBootstrap,
      };

      logger.debug("Authentication analysis completed", {
        sessionId: session.id,
        requiresAuthentication:
          this.authenticationAnalysis.requiresAuthentication,
        dependenciesCount: this.authenticationAnalysis.dependencies.length,
        bootstrapPattern:
          this.authenticationAnalysis.bootstrapAnalysis.establishmentPattern,
      });
    } catch (error) {
      logger.error("Authentication analysis failed", {
        sessionId: session.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Fallback to no authentication
      this.authenticationAnalysis = {
        dependencies: [],
        bootstrapAnalysis: {
          requiresBootstrap: false,
          bootstrapRequests: [],
          sessionTokens: [],
          establishmentPattern: "none",
          confidence: 0,
          analysis: "Authentication analysis failed",
        },
        requiresAuthentication: false,
      };
    }
  }

  /**
   * Generate authentication setup functions
   */
  private async generateAuthenticationFunctions(
    session: HarvestSession
  ): Promise<void> {
    if (!this.authenticationAnalysis) {
      return;
    }

    logger.debug("Generating authentication functions", {
      sessionId: session.id,
      pattern:
        this.authenticationAnalysis.bootstrapAnalysis.establishmentPattern,
    });

    // Generate session state management
    await this.generateSessionStateManager();

    // Generate bootstrap function if needed
    if (this.authenticationAnalysis.bootstrapAnalysis.requiresBootstrap) {
      await this.generateBootstrapFunction(session);
    }

    // Generate authentication token getter functions
    await this.generateTokenGetterFunctions();
  }

  /**
   * Generate session state manager for authentication tokens
   */
  private async generateSessionStateManager(): Promise<void> {
    const patterns = this.functionEngine.getFunctionPatterns();

    // Note: Interface generation would need to be implemented in ASTProject
    // For now, we'll generate the interface manually in the code

    // Generate session state singleton
    patterns
      .function("getSessionState")
      .setReturnType("SessionState")
      .withDocumentation({
        description: "Get current session state with authentication tokens",
        returns: "Session state object containing authentication tokens",
      })
      .setBody((writer) => {
        writer.writeLine("// Session state singleton");
        writer.writeLine("let sessionState: SessionState = {};");
        writer.writeLine("");
        writer.writeLine("return sessionState;");
      })
      .export();

    patterns
      .function("updateSessionState")
      .addParameter({
        name: "updates",
        type: "Partial<SessionState>",
        description: "Partial session state updates",
      })
      .setReturnType("void")
      .withDocumentation({
        description: "Update session state with new authentication tokens",
        params: [
          { name: "updates", description: "Partial session state updates" },
        ],
      })
      .setBody((writer) => {
        writer.writeLine("const currentState = getSessionState();");
        writer.writeLine("Object.assign(currentState, updates);");
      })
      .export();
  }

  /**
   * Generate bootstrap function for session establishment
   */
  private async generateBootstrapFunction(
    session: HarvestSession
  ): Promise<void> {
    const patterns = this.functionEngine.getFunctionPatterns();
    const bootstrap = this.authenticationAnalysis?.bootstrapAnalysis;

    let functionBody = "";

    if (bootstrap) {
      switch (bootstrap.establishmentPattern) {
        case "spa-initialization":
          functionBody = this.generateSpaBootstrapBody(bootstrap, session);
          break;
        case "initial-page":
          functionBody = this.generateInitialPageBootstrapBody(bootstrap);
          break;
        case "login-endpoint":
          functionBody = this.generateLoginEndpointBootstrapBody(bootstrap);
          break;
        case "cookie-based":
          functionBody = this.generateCookieBootstrapBody(bootstrap);
          break;
        default:
          functionBody = this.generateGenericBootstrapBody(bootstrap);
      }
    } else {
      functionBody = this.generateGenericBootstrapBody({
        requiresBootstrap: false,
        bootstrapRequests: [],
        sessionTokens: [],
        establishmentPattern: "none",
        confidence: 0,
        analysis: "No bootstrap analysis available",
      });
    }

    patterns
      .function("establishSession")
      .setReturnType("Promise<void>")
      .withDocumentation({
        description:
          "Establish authentication session and obtain required tokens",
        additionalLines: [
          `Pattern: ${bootstrap?.establishmentPattern || "unknown"}`,
          `Confidence: ${Math.round((bootstrap?.confidence || 0) * 100)}%`,
          bootstrap?.analysis || "No bootstrap analysis available",
        ],
      })
      .setBody((writer) => writer.write(functionBody))
      .export();
  }

  /**
   * Generate token getter functions for authentication dependencies
   */
  private async generateTokenGetterFunctions(): Promise<void> {
    const patterns = this.functionEngine.getFunctionPatterns();

    for (const dependency of this.authenticationAnalysis?.dependencies || []) {
      const functionName = `get${this.capitalize(this.convertToCamelCase(dependency.parameter))}`;

      patterns
        .function(functionName)
        .setReturnType("string | null")
        .withDocumentation({
          description: `Get ${dependency.type} token: ${dependency.parameter}`,
          returns: `${dependency.parameter} token value or null if not available`,
        })
        .setBody((writer) => {
          writer.writeLine(
            `// Get ${dependency.type} token from session state`
          );
          writer.writeLine("const sessionState = getSessionState();");
          writer.writeLine(
            `return sessionState.${dependency.parameter} || null;`
          );
        })
        .export();
    }
  }

  /**
   * Get all requests from session DAG nodes
   */
  private getAllRequestsFromSession(session: HarvestSession): RequestModel[] {
    const requests: RequestModel[] = [];

    // Get all nodes from the DAG
    for (const nodeId of session.dagManager.topologicalSort()) {
      const node = session.dagManager.getNode(nodeId);
      if (
        node &&
        (node.nodeType === "curl" || node.nodeType === "master_curl")
      ) {
        const request = node.content.key as RequestModel;
        if (request) {
          requests.push(request);
        }
      }
    }

    return requests;
  }

  /**
   * Generate SPA bootstrap body for session establishment
   */
  private generateSpaBootstrapBody(
    bootstrap: SessionBootstrapAnalysis,
    session: HarvestSession
  ): string {
    const baseUrl = this.getBaseUrlFromSession(session);

    return `  try {
    // SPA session establishment - load initial page to establish session tokens
    console.log('Establishing SPA session...');
    
    const initialResponse = await fetch('${baseUrl}', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; API Client)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!initialResponse.ok) {
      throw new Error(\`Failed to load initial page: \${initialResponse.status} \${initialResponse.statusText}\`);
    }
    
    // Parse response for embedded session tokens
    const htmlContent = await initialResponse.text();
    const sessionTokens: Partial<SessionState> = {};
    
    ${this.generateTokenExtractionCode(bootstrap.sessionTokens)}
    
    // Update session state with extracted tokens
    updateSessionState(sessionTokens);
    
    console.log('SPA session established successfully');
  } catch (error) {
    throw new Error(\`Session establishment failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
  }

  /**
   * Generate initial page bootstrap body
   */
  private generateInitialPageBootstrapBody(
    bootstrap: SessionBootstrapAnalysis
  ): string {
    return `  try {
    // Initial page session establishment
    console.log('Establishing session via initial page load...');
    
    // This implementation should be customized based on the specific session establishment pattern
    // For now, we'll use a generic approach
    ${this.generateGenericBootstrapBody(bootstrap)}
    
  } catch (error) {
    throw new Error(\`Initial page session establishment failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
  }

  /**
   * Generate login endpoint bootstrap body
   */
  private generateLoginEndpointBootstrapBody(
    bootstrap: SessionBootstrapAnalysis
  ): string {
    const loginRequest = bootstrap.bootstrapRequests.find(
      (req) => req.method === "authentication"
    );

    if (loginRequest) {
      const request = loginRequest.request;
      return `  try {
    // Login endpoint session establishment
    console.log('Establishing session via login endpoint...');
    
    const loginResponse = await fetch('${request.url}', {
      method: '${request.method}',
      headers: ${JSON.stringify(request.headers || {}, null, 6)},
      ${request.body ? `body: ${typeof request.body === "string" ? `'${request.body}'` : JSON.stringify(request.body)},` : ""}
    });
    
    if (!loginResponse.ok) {
      throw new Error(\`Login failed: \${loginResponse.status} \${loginResponse.statusText}\`);
    }
    
    ${this.generateTokenExtractionCode(bootstrap.sessionTokens)}
    
    console.log('Login session established successfully');
  } catch (error) {
    throw new Error(\`Login session establishment failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
    }

    return this.generateGenericBootstrapBody(bootstrap);
  }

  /**
   * Generate cookie-based bootstrap body
   */
  private generateCookieBootstrapBody(
    bootstrap: SessionBootstrapAnalysis
  ): string {
    return `  try {
    // Cookie-based session establishment
    console.log('Establishing session via cookies...');
    
    // Check for existing session cookies
    const sessionTokens: Partial<SessionState> = {};
    
    ${bootstrap.sessionTokens
      .filter((token) => token.source === "cookie")
      .map(
        (token) => `
    // Extract ${token.parameter} from cookies
    const ${token.parameter}Cookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('${token.parameter}='))
      ?.split('=')[1];
    
    if (${token.parameter}Cookie) {
      sessionTokens.${token.parameter} = ${token.parameter}Cookie;
    }`
      )
      .join("")}
    
    updateSessionState(sessionTokens);
    
    console.log('Cookie-based session established successfully');
  } catch (error) {
    throw new Error(\`Cookie session establishment failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
  }

  /**
   * Generate generic bootstrap body
   */
  private generateGenericBootstrapBody(
    bootstrap: SessionBootstrapAnalysis
  ): string {
    return `  try {
    // Generic session establishment
    console.log('Establishing session...');
    
    // This is a generic implementation - customize based on your specific requirements
    const sessionTokens: Partial<SessionState> = {
      ${bootstrap.sessionTokens.map((token) => `${token.parameter}: '${token.value}' // TODO: Replace with dynamic token acquisition`).join(",\n      ")}
    };
    
    updateSessionState(sessionTokens);
    
    console.log('Session established successfully');
  } catch (error) {
    throw new Error(\`Session establishment failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
  }

  /**
   * Generate token extraction code from various sources
   */
  private generateTokenExtractionCode(
    sessionTokens: import("../../types").SessionToken[]
  ): string {
    if (sessionTokens.length === 0) {
      return "// No session tokens to extract";
    }

    const extractionCode = sessionTokens
      .map((token) => {
        switch (token.source) {
          case "response-body":
            return `
    // Extract ${token.parameter} from response body
    try {
      const responseData = JSON.parse(htmlContent);
      if (responseData.${token.parameter}) {
        sessionTokens.${token.parameter} = responseData.${token.parameter};
      }
    } catch {
      // Try regex extraction for ${token.parameter}
      const ${token.parameter}Match = htmlContent.match(/${token.parameter}["']?\\s*[=:]\\s*["']?([^"'\\s;,}]+)/);
      if (${token.parameter}Match) {
        sessionTokens.${token.parameter} = ${token.parameter}Match[1];
      }
    }`;

          case "cookie":
            return `
    // Extract ${token.parameter} from Set-Cookie headers
    const ${token.parameter}Cookie = initialResponse.headers.get('set-cookie')
      ?.split(';')
      .find(cookie => cookie.trim().startsWith('${token.parameter}='))
      ?.split('=')[1];
    if (${token.parameter}Cookie) {
      sessionTokens.${token.parameter} = ${token.parameter}Cookie;
    }`;

          case "header":
            return `
    // Extract ${token.parameter} from response headers
    const ${token.parameter}Header = initialResponse.headers.get('${token.parameter.toLowerCase()}');
    if (${token.parameter}Header) {
      sessionTokens.${token.parameter} = ${token.parameter}Header;
    }`;

          default:
            return `
    // Extract ${token.parameter} (generic approach)
    // TODO: Implement specific extraction logic for ${token.parameter}
    sessionTokens.${token.parameter} = '${token.value}'; // Placeholder - replace with dynamic extraction`;
        }
      })
      .join("\n");

    return extractionCode;
  }

  /**
   * Get base URL from session requests
   */
  private getBaseUrlFromSession(session: HarvestSession): string {
    const requests = this.getAllRequestsFromSession(session);
    if (requests.length > 0 && requests[0]) {
      try {
        const url = new URL(requests[0].url);
        return url.origin;
      } catch {
        return "https://example.com"; // Fallback
      }
    }
    return "https://example.com";
  }

  /**
   * Generate authentication setup code for main function
   */
  private generateAuthenticationSetupCode(): string {
    if (!this.authenticationAnalysis) {
      return "";
    }

    const { bootstrapAnalysis } = this.authenticationAnalysis;

    if (bootstrapAnalysis.requiresBootstrap) {
      return `  // Establish authentication session before making API calls
  try {
    console.log('Establishing authentication session...');
    await establishSession();
    console.log('Authentication session established successfully');
  } catch (error) {
    console.error('Failed to establish authentication session:', error);
    throw new Error('Authentication setup failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
  }`;
    }
    // Just check that authentication tokens are available
    const tokenChecks = this.authenticationAnalysis.dependencies
      .filter((dep) => dep.required)
      .map((dep) => {
        const tokenGetter = `get${this.capitalize(this.convertToCamelCase(dep.parameter))}()`;
        return `
  // Check required authentication token: ${dep.parameter}
  const ${dep.parameter}Token = ${tokenGetter};
  if (!${dep.parameter}Token) {
    throw new Error('Required authentication token ${dep.parameter} is not available');
  }`;
      })
      .join("");

    if (tokenChecks) {
      return `  // Verify authentication tokens are available${tokenChecks}`;
    }

    return "";
  }

  /**
   * Generate type definitions and interfaces
   */
  private async generateTypeDefinitions(
    session: HarvestSession
  ): Promise<void> {
    logger.debug("Generating type definitions", {
      sessionId: session.id,
      useSharedTypes: this.config.useSharedTypes,
    });

    // Set the type engine to use our source file
    this.typeEngine.setSourceFile(this.config.fileName);

    // Analyze nodes to infer response types
    const inferredTypes = this.inferResponseTypes(session);

    // Generate standard API types (ApiResponse, RequestOptions, etc.)
    // Uses shared imports from SharedTypes.js to reduce boilerplate
    this.typeEngine.addStandardTypeDefinitions(inferredTypes);

    // Generate parameter interfaces for functions with complex parameters
    this.generateParameterInterfaces(session);
  }

  /**
   * Generate functions for each DAG node in dependency order
   */
  private async generateNodeFunctions(session: HarvestSession): Promise<void> {
    logger.debug("Generating node functions", { sessionId: session.id });

    // Get nodes in topological order
    const sortedNodeIds = session.dagManager.topologicalSort();

    for (const nodeId of sortedNodeIds) {
      const node = session.dagManager.getNode(nodeId);
      if (node) {
        await this.generateSingleNodeFunction(node, session);
      }
    }
  }

  /**
   * Generate function for a single DAG node
   */
  private async generateSingleNodeFunction(
    node: DAGNode,
    session: HarvestSession
  ): Promise<void> {
    // Generate base function name
    const functionName = this.generateNodeFunctionName(node, session);

    // Ensure function name is unique
    let counter = 1;
    let uniqueFunctionName = functionName;
    while (this.generatedFunctionNames.has(uniqueFunctionName)) {
      uniqueFunctionName = `${functionName}${counter}`;
      counter++;
    }

    // Track the unique function name
    this.generatedFunctionNames.add(uniqueFunctionName);
    this.nodeFunctionNameMap.set(node.id, uniqueFunctionName);

    // Generate the function based on node type
    switch (node.nodeType) {
      case "master_curl":
      case "curl":
        await this.generateRequestFunction(node, uniqueFunctionName, session);
        break;
      case "cookie":
        await this.generateCookieFunction(node, uniqueFunctionName);
        break;
      case "not_found":
        await this.generateNotFoundFunction(node, uniqueFunctionName);
        break;
      default:
        logger.warn("Unsupported node type", {
          nodeId: node.id,
          nodeType: node.nodeType,
        });
    }
  }

  /**
   * Generate request function using AST
   */
  private async generateRequestFunction(
    node: DAGNode,
    functionName: string,
    session: HarvestSession
  ): Promise<void> {
    const request = node.content.key;
    if (!request) {
      throw new Error(`No request data found for node ${node.id}`);
    }

    // Determine response type
    const inferredTypes = this.inferResponseTypes(session);
    const responseType = this.getResponseTypeForNode(node, inferredTypes);

    // Generate function documentation
    const documentation = this.generateFunctionDocumentation(node, request);

    // Parse parameters
    const parameters = this.parseNodeParameters(node, session);

    // Generate function body using pure AST approach
    const functionBody = this.generateRequestFunctionBody(
      node,
      request,
      session
    );

    // Create function using pure AST approach
    this.functionEngine
      .getFunctionPatterns()
      .createApiRequestFunction(functionName, parameters, responseType)
      .withDocumentation({
        description: documentation.description,
        additionalLines: documentation.additionalLines,
        params: documentation.params,
        returns: `Promise resolving to API response with ${responseType} data`,
      })
      .setBody((writer) => writer.write(functionBody))
      .export();

    logger.debug("Generated request function", {
      nodeId: node.id,
      functionName,
      responseType,
    });
  }

  /**
   * Generate cookie function using AST
   */
  private async generateCookieFunction(
    node: DAGNode,
    functionName: string
  ): Promise<void> {
    // Type guard to ensure this is a cookie node
    if (node.nodeType !== "cookie") {
      throw new Error(`Expected cookie node, got ${node.nodeType}`);
    }

    const cookieKey = node.content.key;
    const cookieValue = (node.content as { key: string; value: string }).value;

    // Import will be handled by generateMainFunction() if workflow uses cookies

    const patterns = this.functionEngine.getFunctionPatterns();
    patterns
      .function(functionName)
      .setReturnType("void")
      .withDocumentation({
        description: `Cookie handling: ${cookieKey}`,
        additionalLines: [
          `Value: ${cookieValue}`,
          "This function handles cookie-based authentication or session management",
        ],
      })
      .setBody((writer) =>
        writer.write(this.generateCookieFunctionBody(cookieKey, cookieValue))
      )
      .export();

    // Also generate a getter function for reading the cookie
    const camelCaseKey = this.convertToCamelCase(cookieKey);
    const capitalizedKey = this.capitalize(camelCaseKey);
    const getterFunctionName = `get${capitalizedKey}Cookie`;
    patterns
      .function(getterFunctionName)
      .setReturnType("string | null")
      .withDocumentation({
        description: `Get cookie value: ${cookieKey}`,
        returns: "Cookie value or null if not found",
      })
      .setBody((writer) => {
        writer.writeLine(`// Get cookie: ${cookieKey}`);
        writer.writeLine("try {");
        writer.writeLine(`  return cookieManager.get('${cookieKey}');`);
        writer.writeLine("} catch (error) {");
        writer.writeLine(
          `  console.error('Failed to get cookie ${cookieKey}:', error);`
        );
        writer.writeLine("");
        writer.writeLine(
          "  // Fallback: try reading cookie directly in browser environment"
        );
        writer.writeLine("  if (typeof document !== 'undefined') {");
        writer.writeLine("    const value = `; ` + document.cookie;");
        writer.writeLine(`    const parts = value.split(\`; ${cookieKey}=\`);`);
        writer.writeLine("    if (parts.length === 2) {");
        writer.writeLine(
          "      const cookieValue = parts.pop()?.split(';').shift();"
        );
        writer.writeLine("      return cookieValue || null;");
        writer.writeLine("    }");
        writer.writeLine("  }");
        writer.writeLine("");
        writer.writeLine("  return null;");
        writer.writeLine("}");
      })
      .export();

    logger.debug("Generated cookie function", {
      nodeId: node.id,
      functionName,
      getterFunctionName,
    });
  }

  /**
   * Generate cookie function body with actual implementation
   */
  private generateCookieFunctionBody(
    cookieKey: string,
    cookieValue: string
  ): string {
    return `  // Set cookie: ${cookieKey}=${cookieValue}
  try {
    // Use the cookie manager to set the session cookie
    cookieManager.set('${cookieKey}', '${cookieValue}', {
      path: '/',
      secure: typeof window !== 'undefined' ? window.location.protocol === 'https:' : false,
      httpOnly: false, // Allow JavaScript access for client-side usage
      sameSite: 'Lax'
    });
    
    console.log('Cookie set successfully:', '${cookieKey}=${cookieValue}');
  } catch (error) {
    console.error('Failed to set cookie ${cookieKey}:', error);
    // Fallback: try setting cookie directly in browser environment
    if (typeof document !== 'undefined') {
      document.cookie = \`${cookieKey}=\${encodeURIComponent('${cookieValue}')}; path=/; SameSite=Lax\`;
    }
  }`;
  }

  /**
   * Generate not-found function using AST
   */
  private async generateNotFoundFunction(
    node: DAGNode,
    functionName: string
  ): Promise<void> {
    const missingPart = node.content.key;

    const patterns = this.functionEngine.getFunctionPatterns();
    patterns
      .asyncFunction(functionName)
      .setReturnType("never")
      .withDocumentation({
        description: `Handler for missing parameter: ${missingPart}`,
        additionalLines: [
          "This function throws an error for unresolved dependencies",
          "Consider providing the missing parameter or updating the analysis",
        ],
      })
      .setBody((writer) => {
        writer.writeLine(
          `throw new Error(\`Missing required parameter: ${missingPart}\`);`
        );
        writer.writeLine(
          "// This parameter could not be resolved from previous API responses"
        );
        writer.writeLine("// Consider adding it as a user input parameter");
      })
      .export();

    logger.debug("Generated not-found function", {
      nodeId: node.id,
      functionName,
      missingPart,
    });
  }

  /**
   * Generate main orchestration function with intelligent workflow automation
   */
  private async generateMainFunction(session: HarvestSession): Promise<void> {
    logger.debug("Generating intelligent workflow main function", {
      sessionId: session.id,
    });

    // Use DependencyFlowGenerator to analyze the complete workflow
    const flowGenerator = new DependencyFlowGenerator(
      session,
      this.nodeFunctionNameMap
    );
    const workflow = flowGenerator.analyzeWorkflow();

    logger.debug("Workflow analysis complete", {
      sessionId: session.id,
      stepCount: workflow.steps.length,
      inputParameters: workflow.inputParameters.length,
      usesCookies: workflow.usesCookies,
      hasAuthentication: workflow.hasAuthentication,
    });

    // Convert workflow input parameters to main function parameters
    const mainParameters: Array<{
      name: string;
      type: string;
      optional?: boolean;
      description?: string;
    }> = workflow.inputParameters.map((input) => ({
      name: input.name,
      type: input.type,
      optional: input.optional,
      description: input.description,
    }));

    // Generate the orchestration body using DependencyFlowGenerator
    let mainFunctionBody: string;

    if (workflow.steps.length === 0) {
      mainFunctionBody = `  // No workflow steps available
  return { success: false, data: null, status: 500, headers: {} };`;
    } else {
      // Generate sophisticated workflow orchestration with authentication
      let orchestrationCode = flowGenerator.generateOrchestrationCode(workflow);

      // Prepend authentication setup if required
      if (this.authenticationAnalysis?.requiresAuthentication) {
        const authSetup = this.generateAuthenticationSetupCode();
        orchestrationCode = `${authSetup}\n\n${orchestrationCode}`;
      }

      mainFunctionBody = orchestrationCode;

      // Add cookie manager import if the workflow uses cookies
      if (workflow.usesCookies) {
        this.astProject.addImport(this.config.fileName, "./CookieManager.js", [
          "cookieManager",
        ]);
      }
    }

    // Generate main function with proper parameters
    const patterns = this.functionEngine.getFunctionPatterns();

    if (mainParameters.length > 0) {
      // Create main function with parameters using the API client pattern
      const parameterDefinitions = mainParameters.map((p) => ({
        name: p.name,
        type: p.type,
        optional: p.optional ?? false,
        description: p.description ?? `Parameter: ${p.name}`,
      }));

      patterns
        .asyncFunction("main")
        .addParameters(parameterDefinitions)
        .setReturnType("ApiResponse")
        .withDocumentation({
          description: workflow.description,
          additionalLines: [
            `Workflow: ${workflow.steps.map((s) => s.type).join(" → ")}`,
            `Authentication: ${workflow.hasAuthentication ? "Yes" : "No"}`,
            `Cookie Support: ${workflow.usesCookies ? "Yes" : "No"}`,
          ],
          returns: "Promise resolving to API response",
          params: parameterDefinitions.map((p) => ({
            name: p.name,
            description: p.description || `Parameter: ${p.name}`,
          })),
        })
        .setBody((writer) => writer.write(mainFunctionBody))
        .export();
    } else {
      // Create main function without parameters (use default)
      patterns.createMainFunction(mainFunctionBody).export();
    }

    logger.debug("Generated main function", {
      sessionId: session.id,
      workflowDescription: workflow.description,
      stepCount: workflow.steps.length,
    });
  }

  /**
   * Manage automatic imports
   */
  private async manageImports(): Promise<void> {
    if (this.config.autoImports) {
      logger.debug("Managing automatic imports");
      // ts-morph handles imports automatically when we use types
      // Additional import management can be added here if needed
    }
  }

  /**
   * Calculate generation statistics
   */
  private calculateStats(generatedCode: string): GenerationStats {
    const lines = generatedCode.split("\n");
    const importLines = lines.filter((line) =>
      line.trim().startsWith("import")
    ).length;

    return {
      totalNodes: this.nodeFunctionNameMap.size,
      functionsGenerated: this.generatedFunctionNames.size,
      interfacesGenerated: 0, // TODO: Track interface count
      typeAliasesGenerated: 0, // TODO: Track type alias count
      linesOfCode: lines.length,
      importStatements: importLines,
    };
  }

  // Helper methods (simplified versions of existing functions)

  private generateNodeFunctionName(
    node: DAGNode,
    session: HarvestSession
  ): string {
    // Enhanced function name generation with better endpoint-based naming
    const request = node.content.key;
    if (request && typeof request === "object" && "url" in request) {
      const url = String(request.url);
      const method = String(request.method || "GET").toUpperCase();

      // Generate name from URL path and HTTP method
      const functionName = this.generateNameFromUrlAndMethod(url, method);
      if (functionName && functionName !== "request") {
        return this.createSafeIdentifier(functionName);
      }
    }

    // For master_curl nodes, use a shortened version of the prompt
    if (node.nodeType === "master_curl" && session.prompt) {
      const shortPromptName = this.generateShortPromptName(session.prompt);
      if (shortPromptName) {
        return this.createSafeIdentifier(shortPromptName);
      }
    }

    // Cookie nodes get descriptive names
    if (node.nodeType === "cookie") {
      const cookieKey = (node.content as { key?: string })?.key;
      if (cookieKey) {
        // Convert cookieKey to camelCase first, then capitalize
        const camelCaseKey = this.convertToCamelCase(cookieKey);
        const capitalizedKey = this.capitalize(camelCaseKey);
        return `set${capitalizedKey}Cookie`;
      }
      return "setCookie";
    }

    // Fallback: use node type with counter
    return this.createSafeIdentifier(`${node.nodeType}Request`);
  }

  /**
   * Generate function name from URL path and HTTP method
   */
  private generateNameFromUrlAndMethod(url: string, method: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);

      if (pathParts.length === 0) {
        return `${method.toLowerCase()}Root`;
      }

      const lastPart = pathParts[pathParts.length - 1];
      const secondLastPart =
        pathParts.length > 1 ? pathParts[pathParts.length - 2] : null;

      return this.generateNameFromPathParts(
        lastPart || "",
        secondLastPart || null,
        method
      );
    } catch (_error) {
      return this.generateNameFromInvalidUrl(url, method);
    }
  }

  /**
   * Generate name from path parts
   */
  private generateNameFromPathParts(
    lastPart: string,
    secondLastPart: string | null,
    method: string
  ): string {
    // Handle authentication patterns
    const authName = this.generateAuthFunctionName(lastPart, method);
    if (authName) {
      return authName;
    }

    // Handle data/search patterns
    const dataName = this.generateDataFunctionName(
      lastPart,
      secondLastPart,
      method
    );
    if (dataName) {
      return dataName;
    }

    // Handle resource patterns
    const resourceName = this.generateResourceFunctionName(
      lastPart,
      secondLastPart,
      method
    );
    if (resourceName) {
      return resourceName;
    }

    // Fallback
    return this.generateFallbackName(lastPart, method);
  }

  /**
   * Generate authentication function names
   */
  private generateAuthFunctionName(
    lastPart: string,
    method: string
  ): string | null {
    if (lastPart === "auth" || lastPart === "login") {
      return method === "POST" ? "authLogin" : "checkAuth";
    }
    if (lastPart === "logout") {
      return "authLogout";
    }
    return null;
  }

  /**
   * Generate data/search function names
   */
  private generateDataFunctionName(
    lastPart: string,
    secondLastPart: string | null,
    method: string
  ): string | null {
    if (lastPart === "data" || lastPart === "search") {
      if (method === "GET") {
        if (secondLastPart && secondLastPart !== "data") {
          return `get${this.capitalize(secondLastPart)}Data`;
        }
        return lastPart === "search" ? "search" : "getData";
      }
      if (method === "POST") {
        return lastPart === "search" ? "search" : "searchData";
      }
    }
    return null;
  }

  /**
   * Generate resource-based function names
   */
  private generateResourceFunctionName(
    lastPart: string,
    secondLastPart: string | null,
    method: string
  ): string | null {
    // Handle resource patterns: /users, /products, etc.
    if (lastPart && !lastPart.match(/^\d+$/)) {
      return this.generateCrudFunctionName(lastPart, method);
    }

    // Handle ID-based endpoints: /users/123
    if (lastPart?.match(/^\d+$/) && secondLastPart) {
      return this.generateIdBasedFunctionName(secondLastPart, method);
    }

    return null;
  }

  /**
   * Generate CRUD function names for resources
   */
  private generateCrudFunctionName(resource: string, method: string): string {
    switch (method) {
      case "GET":
        return `get${this.capitalize(resource)}`;
      case "POST":
        return `create${this.capitalize(resource)}`;
      case "PUT":
        return `update${this.capitalize(resource)}`;
      case "DELETE":
        return `delete${this.capitalize(resource)}`;
      default:
        return `${method.toLowerCase()}${this.capitalize(resource)}`;
    }
  }

  /**
   * Generate function names for ID-based endpoints
   */
  private generateIdBasedFunctionName(
    resource: string,
    method: string
  ): string {
    switch (method) {
      case "GET":
        return `get${this.capitalize(resource)}ById`;
      case "PUT":
        return `update${this.capitalize(resource)}`;
      case "DELETE":
        return `delete${this.capitalize(resource)}`;
      default:
        return `${method.toLowerCase()}${this.capitalize(resource)}`;
    }
  }

  /**
   * Generate fallback name from last path part
   */
  private generateFallbackName(lastPart: string, method: string): string {
    if (lastPart) {
      const cleanPart = lastPart.replace(/[^a-zA-Z0-9]/g, "");
      if (cleanPart) {
        return method.toLowerCase() + this.capitalize(cleanPart);
      }
    }
    return "request";
  }

  /**
   * Generate name from invalid URL
   */
  private generateNameFromInvalidUrl(url: string, method: string): string {
    const pathParts = url.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1];
      return this.generateFallbackName(lastPart || "", method);
    }
    return "request";
  }

  /**
   * Generate short function name from session prompt
   */
  private generateShortPromptName(prompt: string): string {
    // Extract key terms from the prompt
    const keyWords = prompt
      .toLowerCase()
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          ![
            "with",
            "for",
            "and",
            "the",
            "that",
            "this",
            "generate",
            "api",
            "client",
          ].includes(word)
      )
      .slice(0, 2); // Take first 2 meaningful words

    if (keyWords.length > 0) {
      return keyWords.map((word) => this.capitalize(word)).join("");
    }

    return "mainWorkflow";
  }

  // Removed unused toCamelCase method - functionality replaced by more specific naming functions

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  private inferResponseTypes(session: HarvestSession): Array<{
    interfaceName: string;
    fields: Array<{ name: string; type: string; optional: boolean }>;
    sourceUrl: string;
  }> {
    const inferredTypes: Array<{
      interfaceName: string;
      fields: Array<{ name: string; type: string; optional: boolean }>;
      sourceUrl: string;
    }> = [];

    // Get all nodes from the DAG
    const allNodes = session.dagManager.getAllNodes();

    for (const [nodeId, node] of allNodes) {
      // Only process curl and master_curl nodes
      if (node.nodeType !== "curl" && node.nodeType !== "master_curl") {
        continue;
      }

      try {
        // Check if the node has response data
        if (node.content.value && typeof node.content.value === "object") {
          const responseData = node.content.value as {
            content?: { text?: string };
          };

          // Try to extract JSON response if available
          let jsonData: unknown = null;

          // Check if there's a text field with JSON content
          if (responseData.content?.text) {
            try {
              jsonData = JSON.parse(responseData.content.text);
            } catch (_error) {
              // Not valid JSON, skip
              continue;
            }
          }

          if (jsonData && typeof jsonData === "object") {
            // Generate interface name from URL or node ID
            const request = node.content.key as RequestModel;
            const interfaceName = this.generateInterfaceNameFromUrl(
              request.url || `Node${nodeId}`
            );

            // Infer field types from JSON structure
            const fields = this.inferFieldsFromJson(jsonData);

            if (fields.length > 0) {
              inferredTypes.push({
                interfaceName,
                fields,
                sourceUrl: request.url || `node-${nodeId}`,
              });
            }
          }
        }
      } catch (error) {
        // Skip nodes with errors
        logger.debug(`Failed to infer types for node ${nodeId}:`, error);
      }
    }

    return inferredTypes;
  }

  /**
   * Generate interface name from URL path
   */
  private generateInterfaceNameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);

      if (pathParts.length > 0) {
        // Use the last part of the path
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart) {
          const cleanName = lastPart.replace(/[^a-zA-Z0-9]/g, "");
          return `${this.capitalize(cleanName)}Response`;
        }
      }
    } catch (_error) {
      // Invalid URL, fallback to generic name
    }

    return "ApiResponse";
  }

  /**
   * Infer TypeScript field types from JSON data structure
   */
  private inferFieldsFromJson(
    jsonData: unknown
  ): Array<{ name: string; type: string; optional: boolean }> {
    const fields: Array<{ name: string; type: string; optional: boolean }> = [];

    if (!jsonData || typeof jsonData !== "object") {
      return fields;
    }

    for (const [key, value] of Object.entries(jsonData)) {
      const field = {
        name: key,
        type: this.inferTypeFromValue(value),
        optional: false, // For now, assume all fields are required
      };

      fields.push(field);
    }

    return fields;
  }

  /**
   * Infer TypeScript type from a JSON value
   */
  private inferTypeFromValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "unknown";
    }

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
      if (value.length === 0) {
        return "any[]";
      }

      // Infer type from first element
      const elementType = this.inferTypeFromValue(value[0]);

      // Handle array of objects specially
      if (
        elementType === "Record<string, unknown>" &&
        typeof value[0] === "object"
      ) {
        // Generate inline interface for array elements
        const elementFields = this.inferFieldsFromJson(value[0]);
        if (elementFields.length > 0) {
          const fieldTypes = elementFields
            .map((f) => `${f.name}: ${f.type}`)
            .join("; ");
          return `Array<{ ${fieldTypes} }>`;
        }
      }

      return `${elementType}[]`;
    }

    if (typeof value === "object") {
      // For simple objects, generate inline type
      const fields = this.inferFieldsFromJson(value);
      if (fields.length > 0 && fields.length <= 3) {
        // For small objects, use inline type
        const fieldTypes = fields.map((f) => `${f.name}: ${f.type}`).join("; ");
        return `{ ${fieldTypes} }`;
      }
      // For complex objects, use generic type
      return "Record<string, unknown>";
    }

    return "unknown";
  }

  private getResponseTypeForNode(
    node: DAGNode,
    inferredTypes: Array<{
      interfaceName: string;
      fields: Array<{ name: string; type: string; optional: boolean }>;
      sourceUrl: string;
    }>
  ): string {
    // Try to find a matching interface for this node
    if (node.content.key && typeof node.content.key === "object") {
      const request = node.content.key as RequestModel;

      // Find interface by matching URL
      for (const inferredType of inferredTypes) {
        if (inferredType.sourceUrl === request.url) {
          return inferredType.interfaceName;
        }
      }

      // Fallback: try to generate interface name from URL
      if (request.url) {
        const generatedName = this.generateInterfaceNameFromUrl(request.url);
        // Check if this generated name exists in inferred types
        const matchingType = inferredTypes.find(
          (t) => t.interfaceName === generatedName
        );
        if (matchingType) {
          return matchingType.interfaceName;
        }
      }
    }

    // No matching interface found, use generic type
    return "unknown";
  }

  private generateFunctionDocumentation(
    node: DAGNode,
    _request: unknown
  ): {
    description: string;
    additionalLines: string[];
    params: Array<{ name: string; description: string }>;
  } {
    return {
      description: `API request for node ${node.id}`,
      additionalLines: [],
      params: [],
    };
  }

  private parseNodeParameters(
    node: DAGNode,
    session?: HarvestSession
  ): Array<{
    name: string;
    type: string;
    optional?: boolean;
    description?: string;
  }> {
    const parameters: Array<{
      name: string;
      type: string;
      optional?: boolean;
      description?: string;
    }> = [];

    const request = node.content.key;
    if (!request || typeof request !== "object") {
      return parameters;
    }

    // Cast to RequestModel to access properties
    const requestModel = request as {
      method: string;
      url: string;
      headers: Record<string, string>;
      queryParams?: Record<string, string>;
      body?: unknown;
    };

    // Extract parameters from request body
    if (requestModel.body && typeof requestModel.body === "object") {
      const bodyParams = this.extractParametersFromObject(
        requestModel.body as Record<string, unknown>,
        "body"
      );
      parameters.push(...bodyParams);
    }

    // Extract parameters from query parameters
    if (
      requestModel.queryParams &&
      Object.keys(requestModel.queryParams).length > 0
    ) {
      const queryParams = this.extractParametersFromObject(
        requestModel.queryParams,
        "query"
      );
      parameters.push(...queryParams);
    }

    // Check for authentication headers that need tokens
    const authHeaders = Object.entries(requestModel.headers || {}).filter(
      ([key, value]) =>
        key.toLowerCase() === "authorization" &&
        String(value).includes("Bearer")
    );

    if (authHeaders.length > 0) {
      parameters.push({
        name: "authToken",
        type: "string",
        optional: false,
        description: "Authentication token from previous request",
      });
    }

    // Check for cookie dependencies
    if (session) {
      const cookieParams = this.extractCookieParameters(node, session);
      if (cookieParams.length > 0) {
        parameters.push(...cookieParams);
      }
    }

    // Generate parameter interface for complex cases
    if (parameters.length > 3) {
      return [
        {
          name: "params",
          type: this.generateParameterInterfaceName(node),
          optional: false,
          description: `Parameters for ${requestModel.method} ${requestModel.url}`,
        },
      ];
    }

    return parameters;
  }

  private generateRequestFunctionBody(
    node: DAGNode,
    request: unknown,
    session: HarvestSession
  ): string {
    // Type guard to ensure we have a valid request
    if (!request || typeof request !== "object") {
      return `  // No request data available for node ${node.id}
  throw new Error("No request data available");`;
    }

    // Cast to RequestModel - we know this is the correct type from DAGNode.content.key
    const requestModel = request as {
      method: string;
      url: string;
      headers: Record<string, string>;
      queryParams?: Record<string, string>;
      body?: unknown;
    };

    try {
      // Extract parameters for this node
      const parameters = this.parseNodeParameters(node, session);

      // Generate the parameterized fetch code
      const fetchCode = this.generateFetchCode(requestModel, parameters);
      const responseHandling = this.generateEnhancedResponseHandling(node);
      const errorHandling = this.generateErrorHandling(
        requestModel.url,
        requestModel.method
      );

      return `  try {
    ${fetchCode}
    
    ${errorHandling}
    
    ${responseHandling}
    
    return {
      success: true,
      data,
      status: response.status,
      headers: (() => {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return headers;
      })()
    };
  } catch (error) {
    throw new Error(\`Request failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);
  }`;
    } catch (error) {
      // Fallback if generation fails
      return `  // Error generating request body for node ${node.id}: ${error}
  throw new Error("Request generation failed");`;
    }
  }

  /**
   * Generate fetch code with parameterization instead of hard-coded values
   */
  private generateFetchCode(
    requestModel: {
      method: string;
      url: string;
      headers: Record<string, string>;
      queryParams?: Record<string, string>;
      body?: unknown;
    },
    parameters: Array<{
      name: string;
      type: string;
      optional?: boolean;
      description?: string;
    }> = []
  ): string {
    const lines: string[] = [];

    // Build URL - parameterized version
    let urlCode = `'${requestModel.url}'`;
    if (
      requestModel.queryParams &&
      Object.keys(requestModel.queryParams).length > 0
    ) {
      // Generate URL construction with proper parameter handling
      lines.push(`    const url = new URL('${requestModel.url}');`);
      lines.push("");

      // Add static parameters first
      const staticParams = Object.entries(requestModel.queryParams).filter(
        ([k, _v]) => {
          return !parameters.find((p) => p.name === k);
        }
      );

      for (const [key, value] of staticParams) {
        lines.push(`    url.searchParams.set('${key}', '${value}');`);
      }

      // Add configurable parameters with proper undefined checks
      const configurableParams = Object.entries(
        requestModel.queryParams
      ).filter(([k, _v]) => {
        return parameters.find((p) => p.name === k);
      });

      if (configurableParams.length > 0) {
        lines.push("");
        lines.push("    // Configurable parameters");
        for (const [key, _value] of configurableParams) {
          const paramName = parameters.length > 3 ? `params.${key}` : key;
          lines.push(
            `    if (${paramName} !== undefined && ${paramName} !== null) {`
          );
          lines.push(
            `      url.searchParams.set('${key}', String(${paramName}));`
          );
          lines.push("    }");
        }
      }

      // Add authentication parameters if required
      if (this.authenticationAnalysis?.requiresAuthentication) {
        lines.push("");
        lines.push("    // Authentication parameters");
        for (const dependency of this.authenticationAnalysis.dependencies) {
          if (dependency.source === "request" && dependency.parameter) {
            const tokenGetter = `get${this.capitalize(this.convertToCamelCase(dependency.parameter))}()`;
            lines.push(
              `    const ${dependency.parameter}Token = ${tokenGetter};`
            );
            lines.push(`    if (${dependency.parameter}Token) {`);
            lines.push(
              `      url.searchParams.set('${dependency.parameter}', ${dependency.parameter}Token);`
            );
            lines.push(`    } else if (${dependency.required}) {`);
            lines.push(
              `      throw new Error('Required authentication token ${dependency.parameter} is not available. Call establishSession() first.');`
            );
            lines.push("    }");
          }
        }
      }

      urlCode = "url.toString()";
    }

    // Build options object
    const options: string[] = [`      method: '${requestModel.method}'`];

    // Add headers - check for auth token parameterization and authentication
    const baseHeaders = Object.entries(requestModel.headers);
    const authHeaders: string[] = [];

    // Add authentication headers if required
    if (this.authenticationAnalysis?.requiresAuthentication) {
      for (const dependency of this.authenticationAnalysis.dependencies) {
        if (dependency.source === "header") {
          const tokenGetter = `get${this.capitalize(this.convertToCamelCase(dependency.parameter))}()`;
          authHeaders.push(
            `        '${dependency.parameter}': ${tokenGetter} || ''`
          );
        }
      }
    }

    if (baseHeaders.length > 0 || authHeaders.length > 0) {
      const headerLines = baseHeaders
        .map(([k, v]) => {
          // Handle Authorization header with auth token parameter
          if (k.toLowerCase() === "authorization" && v.includes("Bearer")) {
            const authParam = parameters.find((p) => p.name === "authToken");
            if (authParam) {
              return `        '${k}': \`Bearer \${authToken}\``;
            }
          }
          return `        '${k}': '${String(v).replace(/'/g, "\\'")}'`;
        })
        .concat(authHeaders)
        .join(",\n");

      options.push(`      headers: {\n${headerLines}\n      }`);
    }

    // Add body - parameterize if needed
    if (requestModel.body) {
      if (typeof requestModel.body === "object") {
        const bodyObj = requestModel.body as Record<string, unknown>;
        const hasParameters = parameters.some((p) =>
          Object.keys(bodyObj).includes(p.name)
        );

        if (hasParameters) {
          // Generate parameterized body
          const bodyEntries = Object.entries(bodyObj)
            .map(([k, v]) => {
              const param = parameters.find((p) => p.name === k);
              if (param) {
                return parameters.length > 3
                  ? `        "${k}": params.${k}`
                  : `        "${k}": ${k}`;
              }
              return `        "${k}": ${JSON.stringify(v)}`;
            })
            .join(",\n");

          options.push(
            `      body: JSON.stringify({\n${bodyEntries}\n      })`
          );
        } else {
          // Use original static body
          options.push(
            `      body: JSON.stringify(${JSON.stringify(requestModel.body, null, 2).replace(/^/gm, "        ")})`
          );
        }
      } else if (typeof requestModel.body === "string") {
        options.push(
          `      body: '${String(requestModel.body).replace(/'/g, "\\'")}'`
        );
      } else {
        options.push(`      body: '${String(requestModel.body)}'`);
      }
    }

    // Generate fetch call
    lines.push(`    const response = await fetch(${urlCode}, {`);
    lines.push(options.join(",\n"));
    lines.push("    });");

    return lines.join("\n");
  }

  /**
   * Generate response handling code for different content types
   */
  private generateResponseHandling(): string {
    return `    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }`;
  }

  /**
   * Generate enhanced response handling with improved type inference
   */
  private generateEnhancedResponseHandling(node: DAGNode): string {
    // Check if we have response data to analyze for better type inference
    const hasResponseData =
      node.content &&
      "value" in node.content &&
      node.content.value &&
      typeof node.content.value === "object" &&
      "content" in node.content.value &&
      typeof node.content.value.content === "object" &&
      node.content.value.content !== null &&
      "text" in node.content.value.content;

    if (hasResponseData) {
      return `    const contentType = response.headers.get('content-type') || '';
    let data: unknown;
    
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else if (contentType.includes('text/')) {
      data = await response.text();
    } else {
      // Handle other content types
      data = await response.text();
    }`;
    }
    // Fallback to standard response handling
    return this.generateResponseHandling();
  }

  /**
   * Generate enhanced error handling code with contextual error information
   */
  private generateErrorHandling(url?: string, method?: string): string {
    if (this.config.useSharedTypes && url && method) {
      // Enhanced error handling with NetworkRequestError
      return `    if (!response.ok) {
      throw new NetworkRequestError(
        \`HTTP \${response.status}: \${response.statusText}\`,
        response.status,
        '${url}',
        '${method}',
        (() => {
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return headers;
        })(),
        undefined,
        await response.text()
      );
    }`;
    }
    // Fallback to basic error handling
    return `    if (!response.ok) {
        throw new Error(\`Request failed: \${response.status} \${response.statusText}\`);
      }`;
  }

  private createSafeIdentifier(str: string): string {
    // Only convert snake_case/kebab-case to camelCase if string contains underscores or hyphens
    let cleaned = str;
    if (str.includes("_") || str.includes("-")) {
      cleaned = this.convertToCamelCase(str);
    }

    // Remove or replace invalid characters (keeping only alphanumeric, underscore, dollar)
    cleaned = cleaned.replace(/[^a-zA-Z0-9_$]/g, "");

    // Ensure it starts with a letter, underscore, or dollar sign
    if (!/^[a-zA-Z_$]/.test(cleaned)) {
      cleaned = `item${cleaned}`;
    }

    // Fallback if empty
    return cleaned || "item";
  }

  /**
   * Convert snake_case or kebab-case to camelCase
   */
  private convertToCamelCase(str: string): string {
    return str
      .split(/[-_]/)
      .map((word, index) => {
        if (index === 0) {
          // First word stays lowercase
          return word.toLowerCase();
        }
        // Capitalize first letter of subsequent words
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join("");
  }

  /**
   * Extract parameters from an object structure
   */
  private extractParametersFromObject(
    obj: Record<string, unknown>,
    context: "body" | "query"
  ): Array<{
    name: string;
    type: string;
    optional?: boolean;
    description?: string;
  }> {
    const parameters: Array<{
      name: string;
      type: string;
      optional?: boolean;
      description?: string;
    }> = [];

    for (const [key, value] of Object.entries(obj)) {
      parameters.push({
        name: key,
        type: this.inferParameterType(value),
        optional: this.isOptionalParameter(key, value),
        description: `${context === "body" ? "Request body" : "Query"} parameter: ${key}`,
      });
    }

    return parameters;
  }

  /**
   * Infer TypeScript type from parameter value
   */
  private inferParameterType(value: unknown): string {
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
      if (value.length === 0) {
        return "any[]";
      }
      return `${this.inferParameterType(value[0])}[]`;
    }
    if (typeof value === "object" && value !== null) {
      return "Record<string, unknown>";
    }
    return "unknown";
  }

  /**
   * Determine if a parameter should be optional
   */
  private isOptionalParameter(key: string, value: unknown): boolean {
    // Common optional parameter patterns
    const optionalPatterns = [
      "remember",
      "persist",
      "optional",
      "extra",
      "additional",
      "page",
      "limit",
      "offset",
      "sort",
    ];

    return (
      optionalPatterns.some((pattern) => key.toLowerCase().includes(pattern)) ||
      typeof value === "boolean"
    );
  }

  /**
   * Extract cookie parameters from node dependencies
   */
  private extractCookieParameters(
    node: DAGNode,
    session: HarvestSession
  ): Array<{
    name: string;
    type: string;
    optional?: boolean;
    description?: string;
  }> {
    const parameters: Array<{
      name: string;
      type: string;
      optional?: boolean;
      description?: string;
    }> = [];

    try {
      // Get predecessors (dependencies) of the current node
      const predecessors = session.dagManager.getPredecessors(node.id);

      for (const predecessorId of predecessors) {
        const predecessorNode = session.dagManager.getNode(predecessorId);

        // Check if predecessor is a cookie node
        if (predecessorNode && predecessorNode.nodeType === "cookie") {
          const cookieKey = predecessorNode.content.key;

          if (cookieKey) {
            parameters.push({
              name: `${cookieKey}Cookie`,
              type: "string",
              optional: true, // Cookie values might not be set initially
              description: `Cookie value for ${cookieKey} from dependency chain`,
            });
          }
        }
      }
    } catch (error) {
      logger.warn("Failed to extract cookie parameters", {
        nodeId: node.id,
        error: String(error),
      });
    }

    return parameters;
  }

  /**
   * Generate parameter interface name for complex parameter objects
   */
  private generateParameterInterfaceName(node: DAGNode): string {
    const request = node.content.key as RequestModel;
    if (request?.url) {
      const urlParts = request.url.split("/").filter(Boolean);
      const lastPart = urlParts[urlParts.length - 1];
      if (lastPart) {
        const cleanName = lastPart.replace(/[^a-zA-Z0-9]/g, "");
        return `${this.capitalize(cleanName)}Params`;
      }
    }
    return `${this.capitalize(node.nodeType)}Params`;
  }

  /**
   * Generate parameter interfaces for functions that need complex parameter objects
   */
  private generateParameterInterfaces(session: HarvestSession): void {
    const sortedNodeIds = session.dagManager.topologicalSort();
    const processedInterfaces = new Set<string>();

    for (const nodeId of sortedNodeIds) {
      const node = session.dagManager.getNode(nodeId);
      if (
        !node ||
        node.nodeType === "cookie" ||
        node.nodeType === "not_found"
      ) {
        continue;
      }

      const parameters = this.parseNodeParameters(node, session);

      // Only generate interface for complex parameter sets (more than 3 params)
      if (parameters.length > 3) {
        const interfaceName = this.generateParameterInterfaceName(node);

        // Avoid duplicate interfaces
        if (!processedInterfaces.has(interfaceName)) {
          // Extract the actual parameter fields for the interface
          const request = node.content.key as RequestModel;
          const interfaceFields: Array<{
            name: string;
            type: string;
            optional: boolean;
          }> = [];

          // Add body parameters
          if (request?.body && typeof request.body === "object") {
            const bodyFields = this.extractParametersFromObject(
              request.body as Record<string, unknown>,
              "body"
            );
            interfaceFields.push(
              ...bodyFields.map((field) => ({
                name: field.name,
                type: field.type,
                optional: field.optional || false,
              }))
            );
          }

          // Add query parameters
          if (request?.queryParams) {
            const queryFields = this.extractParametersFromObject(
              request.queryParams as Record<string, unknown>,
              "query"
            );
            interfaceFields.push(
              ...queryFields.map((field) => ({
                name: field.name,
                type: field.type,
                optional: field.optional || false,
              }))
            );
          }

          // Add auth token if needed
          if (node.extractedParts && node.extractedParts.length > 0) {
            interfaceFields.push({
              name: "authToken",
              type: "string",
              optional: false,
            });
          }

          // Generate the interface
          if (interfaceFields.length > 0) {
            this.typeEngine.addInterface(interfaceName, interfaceFields);
            processedInterfaces.add(interfaceName);
          }
        }
      }
    }
  }
}
