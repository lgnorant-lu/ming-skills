/**
 * AST-Based Function Builder
 *
 * Provides fluent APIs for building TypeScript function declarations using AST.
 * This provides a flexible and type-safe approach for generating TypeScript
 * functions through programmatic AST manipulation.
 */

import type {
  FunctionDeclaration,
  VariableStatement,
  WriterFunction,
} from "ts-morph";
import { VariableDeclarationKind } from "ts-morph";
import type { ASTProject } from "./ASTProject.js";
import { BaseBuilder, type JSDocOptions } from "./BaseBuilder.js";

/**
 * Structure for defining function parameters
 */
export interface ParameterDefinition {
  name: string;
  type: string;
  optional?: boolean;
  defaultValue?: string;
  description?: string;
}

/**
 * Builder for creating TypeScript function declarations
 */
export class FunctionBuilder extends BaseBuilder {
  private declaration?: FunctionDeclaration;

  /**
   * Create a new async function
   */
  createAsync(name: string): this {
    this.ensureValidIdentifier(name, "function name");

    this.declaration = this.sourceFile.addFunction({
      name,
      isAsync: true,
      isExported: false, // Will be set by export() method
    });

    return this;
  }

  /**
   * Create a new synchronous function
   */
  create(name: string): this {
    this.ensureValidIdentifier(name, "function name");

    this.declaration = this.sourceFile.addFunction({
      name,
      isAsync: false,
      isExported: false, // Will be set by export() method
    });

    return this;
  }

  /**
   * Make the function exported
   */
  export(): this {
    if (!this.declaration) {
      throw new Error("Function must be created before it can be exported");
    }

    this.declaration.setIsExported(true);
    return this;
  }

  /**
   * Set the return type
   */
  setReturnType(type: string): this {
    if (!this.declaration) {
      throw new Error("Function must be created before setting return type");
    }

    // For async functions, wrap in Promise automatically
    const returnType = this.declaration.isAsync() ? `Promise<${type}>` : type;
    this.declaration.setReturnType(returnType);
    return this;
  }

  /**
   * Add a single parameter to the function
   */
  addParameter(param: ParameterDefinition): this {
    if (!this.declaration) {
      throw new Error("Function must be created before adding parameters");
    }

    const paramStructure: {
      name: string;
      type: string;
      hasQuestionToken: boolean;
      initializer?: string;
    } = {
      name: param.name,
      type: param.type,
      hasQuestionToken: param.optional || false,
    };

    if (param.defaultValue) {
      paramStructure.initializer = param.defaultValue;
    }

    this.declaration.addParameter(paramStructure);
    return this;
  }

  /**
   * Add multiple parameters to the function
   */
  addParameters(params: ParameterDefinition[]): this {
    for (const param of params) {
      this.addParameter(param);
    }
    return this;
  }

  /**
   * Add JSDoc documentation to the function
   */
  withDocumentation(options: JSDocOptions): this {
    if (!this.declaration) {
      throw new Error("Function must be created before adding documentation");
    }

    const jsDoc = this.createJSDocStructure(options);
    this.declaration.addJsDoc(jsDoc);
    return this;
  }

  /**
   * Set the function body using a writer function (pure AST approach)
   */
  setBody(bodyWriter: WriterFunction): this {
    if (!this.declaration) {
      throw new Error("Function must be created before setting body");
    }

    this.declaration.setBodyText(bodyWriter);
    return this;
  }

  /**
   * Add statements to the function body
   */
  addStatements(statements: string[]): this {
    if (!this.declaration) {
      throw new Error("Function must be created before adding statements");
    }

    this.declaration.addStatements(statements);
    return this;
  }

  /**
   * Wrap the function body in a try-catch block
   */
  wrapInTryCatch(errorMessage?: string): this {
    if (!this.declaration) {
      throw new Error("Function must be created before wrapping in try-catch");
    }

    const functionName = this.declaration.getName();
    const currentBody = this.declaration.getBodyText();

    const wrappedBody = this.createWriter((writer) => {
      writer.writeLine("try {");
      writer.indent(() => {
        // Add the current body with proper indentation
        if (currentBody?.trim()) {
          const bodyLines = currentBody
            .split("\n")
            .filter((line) => line.trim());
          for (const line of bodyLines) {
            writer.writeLine(line.trim());
          }
        }
      });
      writer.writeLine("} catch (error) {");
      writer.indent(() => {
        const message = errorMessage || `${functionName} failed`;
        writer.writeLine(
          `throw new Error(\`${message}: \${error instanceof Error ? error.message : 'Unknown error'}\`);`
        );
      });
      writer.writeLine("}");
    });

    this.declaration.setBodyText(wrappedBody);
    return this;
  }

  /**
   * Add a standard API response return statement
   */
  addApiResponseReturn(): this {
    if (!this.declaration) {
      throw new Error(
        "Function must be created before adding return statement"
      );
    }

    const returnStatement = `
    return {
      success: true,
      data,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries())
    };`;

    this.declaration.addStatements([returnStatement]);
    return this;
  }

  /**
   * Get the generated function declaration
   */
  build(): FunctionDeclaration {
    if (!this.declaration) {
      throw new Error("Function must be created before it can be built");
    }
    return this.declaration;
  }

  /**
   * Get the function name
   */
  getName(): string {
    if (!this.declaration) {
      throw new Error("Function must be created before getting its name");
    }
    const name = this.declaration.getName();
    if (!name) {
      throw new Error("Function declaration does not have a name");
    }
    return name;
  }

  /**
   * Get parameter names for reference
   */
  getParameterNames(): string[] {
    if (!this.declaration) {
      throw new Error(
        "Function must be created before getting parameter names"
      );
    }
    return this.declaration.getParameters().map((p) => p.getName());
  }
}

/**
 * Utility class for common function patterns
 */
export class FunctionPatterns extends BaseBuilder {
  /**
   * Create a new function builder
   */
  function(name: string): FunctionBuilder {
    return new FunctionBuilder(this.astProject, this.sourceFile).create(name);
  }

  /**
   * Create a new async function builder
   */
  asyncFunction(name: string): FunctionBuilder {
    return new FunctionBuilder(this.astProject, this.sourceFile).createAsync(
      name
    );
  }

  /**
   * Create an API request function with standard structure
   */
  createApiRequestFunction(
    name: string,
    parameters: ParameterDefinition[] = [],
    responseType = "unknown"
  ): FunctionBuilder {
    const params: JSDocOptions["params"] = parameters.map((p) => ({
      name: p.name,
      description: p.description || `Parameter: ${p.name}`,
      type: p.type,
    }));

    return this.asyncFunction(name)
      .setReturnType(`ApiResponse<${responseType}>`)
      .withDocumentation({
        description: `API request: ${name}`,
        params,
        returns: `Promise resolving to API response with ${responseType} data`,
      })
      .addParameters(parameters);
  }

  /**
   * Create a main orchestration function
   */
  createMainFunction(bodyText?: string): FunctionBuilder {
    const builder = this.asyncFunction("main")
      .setReturnType("ApiResponse")
      .withDocumentation({
        description: "Main function that executes the complete API workflow",
        returns: "Promise resolving to API response",
      });

    if (bodyText) {
      builder.setBody((writer) => {
        const lines = bodyText.split("\n");
        for (const line of lines) {
          writer.writeLine(line);
        }
      });
    }

    return builder;
  }

  /**
   * Create a variable declaration statement
   */
  addVariable(name: string, type: string, value?: string): VariableStatement {
    const declaration: {
      name: string;
      type: string;
      initializer?: string;
    } = {
      name,
      type,
    };

    if (value !== undefined) {
      declaration.initializer = value;
    }

    const structure = {
      declarationKind: VariableDeclarationKind.Const,
      declarations: [declaration],
    };

    return this.sourceFile.addVariableStatement(structure);
  }
}

/**
 * Higher-level function builder that provides convenient methods for common patterns
 * This provides a fluent API for generating TypeScript functions using AST manipulation
 */
export class ASTFunctionEngine {
  private astProject: ASTProject;
  private currentSourceFile = "functions.ts";

  constructor(astProject: ASTProject) {
    this.astProject = astProject;
  }

  /**
   * Set the current source file for generation
   */
  setSourceFile(fileName: string): void {
    this.currentSourceFile = fileName;
  }

  /**
   * Get the current FunctionPatterns instance
   */
  getFunctionPatterns(): FunctionPatterns {
    const sourceFile = this.astProject.createSourceFile(this.currentSourceFile);
    return new FunctionPatterns(this.astProject, sourceFile);
  }

  /**
   * Generate the final code
   */
  generateCode(): string {
    return this.astProject.generateCode(this.currentSourceFile);
  }

  /**
   * Create a standard API function (common pattern)
   */
  createStandardApiFunction(
    name: string,
    method: string,
    url: string,
    parameters: ParameterDefinition[] = [],
    responseType = "unknown"
  ): FunctionBuilder {
    const patterns = this.getFunctionPatterns();
    return patterns
      .createApiRequestFunction(name, parameters, responseType)
      .withDocumentation({
        description: `${method} request to ${url}`,
        additionalLines: [`HTTP Method: ${method}`, `Endpoint: ${url}`],
      });
  }
}
