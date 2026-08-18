import type { SourceFile } from "ts-morph";
import { beforeEach, describe, expect, it } from "vitest";
import { ASTProject } from "../../../src/core/ast/ASTProject.js";
import {
  ASTFunctionEngine,
  FunctionBuilder,
  FunctionPatterns,
  type ParameterDefinition,
} from "../../../src/core/ast/FunctionBuilder.js";

/**
 * Test suite for AST Function Builder
 */
describe("AST FunctionBuilder", () => {
  let astProject: ASTProject;
  let sourceFile: SourceFile;
  let functionBuilder: FunctionBuilder;

  beforeEach(() => {
    astProject = new ASTProject({
      useInMemoryFileSystem: true,
      formatCode: true,
    });
    sourceFile = astProject.createSourceFile("test-functions.ts");
    functionBuilder = new FunctionBuilder(astProject, sourceFile);
  });

  describe("FunctionBuilder - Basic Functionality", () => {
    it("should create a synchronous function", () => {
      const declaration = functionBuilder
        .create("testFunction")
        .setReturnType("string")
        .setBody((writer) => {
          writer.writeLine("return 'hello world';");
        })
        .build();

      expect(declaration.getName()).toBe("testFunction");
      expect(declaration.isAsync()).toBe(false);
      expect(declaration.getReturnType().getText()).toBe("string");

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("function testFunction(): string");
      expect(code).toContain("return 'hello world';");
    });

    it("should create an async function", () => {
      const declaration = functionBuilder
        .createAsync("asyncFunction")
        .setReturnType("ApiResponse")
        .build();

      expect(declaration.getName()).toBe("asyncFunction");
      expect(declaration.isAsync()).toBe(true);
      expect(declaration.getReturnType().getText()).toBe(
        "Promise<ApiResponse>"
      );

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain(
        "async function asyncFunction(): Promise<ApiResponse>"
      );
    });

    it("should add parameters", () => {
      functionBuilder
        .create("withParams")
        .addParameter({ name: "required", type: "string" })
        .addParameter({ name: "optional", type: "number", optional: true })
        .addParameter({
          name: "withDefault",
          type: "boolean",
          defaultValue: "false",
        });

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain(
        "function withParams(required: string, optional?: number, withDefault: boolean = false)"
      );
    });

    it("should add multiple parameters at once", () => {
      const parameters: ParameterDefinition[] = [
        { name: "param1", type: "string" },
        { name: "param2", type: "number", optional: true },
        { name: "param3", type: "boolean", defaultValue: "true" },
      ];

      functionBuilder.create("multipleParams").addParameters(parameters);

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("param1: string");
      expect(code).toContain("param2?: number");
      expect(code).toContain("param3: boolean = true");
    });

    it("should add JSDoc documentation", () => {
      functionBuilder
        .create("documentedFunction")
        .withDocumentation({
          description: "This function does something important",
          additionalLines: ["Additional context here"],
          params: [
            {
              name: "input",
              description: "The input parameter",
              type: "string",
            },
          ],
          returns: "The processed result",
        })
        .addParameter({ name: "input", type: "string" });

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("/**");
      expect(code).toContain("This function does something important");
      expect(code).toContain("@param input");
      expect(code).toContain("@returns");
    });

    it("should export functions", () => {
      functionBuilder.create("exportedFunction").export();

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("export function exportedFunction()");
    });

    it("should set body text (hybrid approach)", () => {
      const bodyText = `const result = await fetch('/api/test');
const data = await result.json();
return { success: true, data };`;

      functionBuilder
        .createAsync("hybridFunction")
        .setReturnType("ApiResponse")
        .setBody((writer) => {
          const lines = bodyText.split("\n");
          for (const line of lines) {
            writer.writeLine(line);
          }
        });

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("const result = await fetch('/api/test')");
      expect(code).toContain("return { success: true, data }");
    });

    it("should wrap function body in try-catch", () => {
      functionBuilder
        .createAsync("errorHandlingFunction")
        .setBody((writer) => {
          writer.writeLine("const result = await riskyOperation();");
        })
        .wrapInTryCatch("Custom error message");

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("try {");
      expect(code).toContain("const result = await riskyOperation()");
      expect(code).toContain("} catch (error) {");
      expect(code).toContain("Custom error message");
    });

    it("should add standard API response return", () => {
      functionBuilder
        .createAsync("apiFunction")
        .setBody((writer) => {
          writer.writeLine("const response = await fetch('/api');");
        })
        .addApiResponseReturn();

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("return {");
      expect(code).toContain("success: true");
      expect(code).toContain("data,");
      expect(code).toContain("status: response.status");
      expect(code).toContain(
        "headers: Object.fromEntries(response.headers.entries())"
      );
    });
  });

  describe("FunctionPatterns - High-Level Patterns", () => {
    let patterns: FunctionPatterns;

    beforeEach(() => {
      patterns = new FunctionPatterns(astProject, sourceFile);
    });

    it("should create functions using fluent API", () => {
      patterns
        .function("syncFunc")
        .setReturnType("void")
        .setBody((writer) => {
          writer.writeLine("console.log('hello');");
        });

      patterns
        .asyncFunction("asyncFunc")
        .setReturnType("string")
        .setBody((writer) => {
          writer.writeLine("return 'async result';");
        });

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("function syncFunc(): void");
      expect(code).toContain("async function asyncFunc(): Promise<string>");
    });

    it("should create API request functions", () => {
      const parameters: ParameterDefinition[] = [
        { name: "query", type: "string", description: "Search query" },
        {
          name: "limit",
          type: "number",
          optional: true,
          description: "Result limit",
        },
      ];

      patterns.createApiRequestFunction("searchUsers", parameters, "User[]");

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("async function searchUsers");
      expect(code).toContain("Promise<ApiResponse<User[]>>");
      expect(code).toContain("query: string");
      expect(code).toContain("limit?: number");
      expect(code).toContain("/**");
      expect(code).toContain("API request: searchUsers");
    });

    it("should create main orchestration function", () => {
      patterns.createMainFunction(
        "const result = await performActions(); return result;"
      );

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("async function main(): Promise<ApiResponse>");
      expect(code).toContain(
        "Main function that executes the complete API workflow"
      );
      expect(code).toContain("const result = await performActions()");
    });

    it("should add variable declarations", () => {
      patterns.addVariable("baseUrl", "string", "'https://api.example.com'");
      patterns.addVariable("config", "Config");

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain(
        "const baseUrl: string = 'https://api.example.com'"
      );
      expect(code).toContain("const config: Config");
    });
  });

  describe("ASTFunctionEngine - High-Level Engine", () => {
    let engine: ASTFunctionEngine;

    beforeEach(() => {
      engine = new ASTFunctionEngine(astProject);
    });

    it("should create standard API functions", () => {
      const parameters: ParameterDefinition[] = [
        { name: "userId", type: "string" },
        { name: "includeDetails", type: "boolean", optional: true },
      ];

      engine.createStandardApiFunction(
        "getUser",
        "GET",
        "/api/users/:id",
        parameters,
        "User"
      );

      const code = engine.generateCode();
      expect(code).toContain("async function getUser");
      expect(code).toContain("Promise<ApiResponse<User>>");
      expect(code).toContain("GET request to /api/users/:id");
      expect(code).toContain("userId: string");
      expect(code).toContain("includeDetails?: boolean");
    });

    it("should manage multiple source files", () => {
      engine.setSourceFile("functions1.ts");
      engine
        .getFunctionPatterns()
        .function("func1")
        .setBody((writer) => {
          writer.writeLine("return 1;");
        });

      engine.setSourceFile("functions2.ts");
      engine
        .getFunctionPatterns()
        .function("func2")
        .setBody((writer) => {
          writer.writeLine("return 2;");
        });

      engine.setSourceFile("functions1.ts");
      const code1 = engine.generateCode();

      engine.setSourceFile("functions2.ts");
      const code2 = engine.generateCode();

      expect(code1).toContain("function func1");
      expect(code1).not.toContain("function func2");
      expect(code2).toContain("function func2");
      expect(code2).not.toContain("function func1");
    });
  });

  describe("Generated Code Structure", () => {
    it("should produce well-structured function code", () => {
      // Create a function with comprehensive structure
      const parameters: ParameterDefinition[] = [
        { name: "authConfig", type: "AuthConfig", optional: true },
        { name: "searchQuery", type: "string", defaultValue: "''" },
      ];

      functionBuilder
        .createAsync("searchDocuments")
        .setReturnType("ApiResponse<SearchResult[]>")
        .withDocumentation({
          description: "Main API call: GET https://api.example.com/search",
          additionalLines: ["Extracts: results, total, page"],
          params: [
            { name: "authConfig", description: "Authentication configuration" },
            { name: "searchQuery", description: "Search query string" },
          ],
        })
        .addParameters(parameters)
        .setBody((writer) => {
          writer.writeLine("try {");
          writer.indent(() => {
            writer.writeLine(
              "const url = new URL('https://api.example.com/search');"
            );
            writer.writeLine("url.searchParams.set('q', searchQuery);");
            writer.newLine();
            writer.writeLine("const headers: Record<string, string> = {");
            writer.indent(() => {
              writer.writeLine("'Content-Type': 'application/json',");
            });
            writer.writeLine("};");
            writer.newLine();
            writer.writeLine("const options: RequestOptions = {");
            writer.indent(() => {
              writer.writeLine("method: 'GET',");
              writer.writeLine("headers,");
            });
            writer.writeLine("};");
            writer.newLine();
            writer.writeLine(
              "const response = await fetch(url.toString(), options);"
            );
            writer.newLine();
            writer.writeLine("if (!response.ok) {");
            writer.indent(() => {
              writer.writeLine(
                'throw new Error("Request failed: " + response.status + " " + response.statusText);'
              );
            });
            writer.writeLine("}");
            writer.newLine();
            writer.writeLine("const data = await response.json();");
            writer.newLine();
            writer.writeLine("return {");
            writer.indent(() => {
              writer.writeLine("success: true,");
              writer.writeLine("data,");
              writer.writeLine("status: response.status,");
              writer.writeLine(
                "headers: Object.fromEntries(response.headers.entries()),"
              );
            });
            writer.writeLine("};");
          });
          writer.writeLine("} catch (error) {");
          writer.indent(() => {
            writer.writeLine(
              `throw new Error(\`searchDocuments failed: \${error instanceof Error ? error.message : 'Unknown error'}\`);`
            );
          });
          writer.writeLine("}");
        })
        .export();

      const code = astProject.generateCode("test-functions.ts");

      // Verify structure matches expected patterns
      expect(code).toContain("/**");
      expect(code).toContain(
        "Main API call: GET https://api.example.com/search"
      );
      expect(code).toContain("export async function searchDocuments");
      expect(code).toContain("authConfig?: AuthConfig");
      expect(code).toContain("searchQuery: string = ''");
      expect(code).toContain("Promise<ApiResponse<SearchResult[]>>");
      expect(code).toContain("try {");
      expect(code).toContain("const url = new URL(");
      expect(code).toContain("const response = await fetch(");
      expect(code).toContain("if (!response.ok)");
      expect(code).toContain("return {");
      expect(code).toContain("success: true,");
      expect(code).toContain("} catch (error) {");

      console.log("✅ AST function output has proper structure");
    });
  });

  describe("Error Handling", () => {
    it("should validate function names", () => {
      expect(() => {
        functionBuilder.create("123Invalid");
      }).toThrow("Invalid TypeScript identifier");
    });

    it("should require function to be created before operations", () => {
      const builder = new FunctionBuilder(astProject, sourceFile);

      expect(() => {
        builder.setReturnType("string");
      }).toThrow("Function must be created");

      expect(() => {
        builder.addParameter({ name: "test", type: "string" });
      }).toThrow("Function must be created");

      expect(() => {
        builder.export();
      }).toThrow("Function must be created");
    });

    it("should handle complex parameter types", () => {
      const complexParams: ParameterDefinition[] = [
        { name: "callback", type: "(data: any) => void" },
        { name: "options", type: "{ timeout?: number; retries?: number }" },
        { name: "data", type: "Record<string, unknown>" },
      ];

      functionBuilder.create("complexFunction").addParameters(complexParams);

      const code = astProject.generateCode("test-functions.ts");
      expect(code).toContain("callback: (data: any) => void");
      expect(code).toContain("options: { timeout?: number; retries?: number }");
      expect(code).toContain("data: Record<string, unknown>");
    });
  });

  describe("Integration with Existing System", () => {
    it("should generate clean, formatted code", () => {
      functionBuilder
        .createAsync("formattedFunction")
        .setReturnType("string")
        .withDocumentation({
          description: "A well-formatted function",
        })
        .addParameter({ name: "input", type: "string" })
        .setBody((writer) => {
          writer.writeLine("return input.toUpperCase();");
        })
        .export();

      const code = astProject.generateCode("test-functions.ts");

      // Basic formatting checks
      expect(code).not.toContain("  \n"); // No trailing spaces
      expect(code).toMatch(/^\s*\/\*\*/m); // Proper JSDoc formatting
      expect(code).toMatch(/^\s*export async function/m); // Proper function formatting

      console.log("✅ Generated function code is clean and well-formatted");
    });
  });
});
