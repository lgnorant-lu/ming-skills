import type { SourceFile } from "ts-morph";
import { beforeEach, describe, expect, it } from "vitest";
import { ASTProject } from "../../../src/core/ast/ASTProject.js";
import {
  InterfaceBuilder,
  TypeAliasBuilder,
  TypeBuilder,
} from "../../../src/core/ast/TypeBuilder.js";

/**
 * Test suite for TypeScript Type Builders
 */
describe("AST TypeBuilder", () => {
  let astProject: ASTProject;
  let sourceFile: SourceFile;
  let typeBuilder: TypeBuilder;

  beforeEach(() => {
    astProject = new ASTProject({
      useInMemoryFileSystem: true,
      formatCode: true,
    });
    sourceFile = astProject.createSourceFile("test-types.ts");
    typeBuilder = new TypeBuilder(astProject, sourceFile);
  });

  describe("InterfaceBuilder", () => {
    let interfaceBuilder: InterfaceBuilder;

    beforeEach(() => {
      interfaceBuilder = new InterfaceBuilder(astProject, sourceFile);
    });

    it("should create a basic interface", () => {
      const declaration = interfaceBuilder
        .create("TestInterface")
        .addProperty({ name: "name", type: "string" })
        .addProperty({ name: "age", type: "number", optional: true })
        .build();

      expect(declaration.getName()).toBe("TestInterface");
      expect(declaration.getProperties()).toHaveLength(2);

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("interface TestInterface");
      expect(code).toContain("name: string");
      expect(code).toContain("age?: number");
    });

    it("should create an exported interface with documentation", () => {
      interfaceBuilder
        .create("ApiUser")
        .withDocumentation({
          description: "Represents a user in the API",
          additionalLines: ["Contains user information and metadata"],
        })
        .addProperty({
          name: "id",
          type: "string",
          description: "User identifier",
        })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface ApiUser");
      expect(code).toContain("/**");
      expect(code).toContain("Represents a user in the API");
      expect(code).toContain("id: string");
    });

    it("should create a generic interface with type parameters", () => {
      interfaceBuilder
        .create("Response")
        .withTypeParameters([
          { name: "T", default: "any" },
          { name: "E", constraint: "Error" },
        ])
        .addProperty({ name: "data", type: "T" })
        .addProperty({ name: "error", type: "E", optional: true })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain(
        "export interface Response<T = any, E extends Error>"
      );
      expect(code).toContain("data: T");
      expect(code).toContain("error?: E");
    });

    it("should support interface inheritance", () => {
      // First create a base interface
      typeBuilder
        .interface("BaseEntity")
        .addProperty({ name: "id", type: "string" })
        .export();

      // Then create an interface that extends it
      interfaceBuilder
        .create("User")
        .extends("BaseEntity")
        .addProperty({ name: "name", type: "string" })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("interface User extends BaseEntity");
    });

    it("should add properties from object definition", () => {
      interfaceBuilder
        .create("Config")
        .addPropertiesFromObject({
          host: "string",
          port: { type: "number", optional: true },
          ssl: { type: "boolean", description: "Enable SSL" },
        })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("host: string");
      expect(code).toContain("port?: number");
      expect(code).toContain("ssl: boolean");
    });
  });

  describe("TypeAliasBuilder", () => {
    let typeAliasBuilder: TypeAliasBuilder;

    beforeEach(() => {
      typeAliasBuilder = new TypeAliasBuilder(astProject, sourceFile);
    });

    it("should create a basic type alias", () => {
      const declaration = typeAliasBuilder.create("UserId", "string").build();

      expect(declaration.getName()).toBe("UserId");

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("type UserId = string");
    });

    it("should create an exported type alias with documentation", () => {
      typeAliasBuilder
        .create("EventHandler", "(event: Event) => void")
        .withDocumentation({
          description: "Function type for event handlers",
        })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain(
        "export type EventHandler = (event: Event) => void"
      );
      expect(code).toContain("/**");
      expect(code).toContain("Function type for event handlers");
    });

    it("should create a generic type alias", () => {
      typeAliasBuilder
        .create("Result", "T | Error")
        .withTypeParameters([{ name: "T" }])
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export type Result<T> = T | Error");
    });
  });

  describe("TypeBuilder High-Level API", () => {
    it("should create interfaces using the fluent API", () => {
      typeBuilder
        .interface("Product")
        .addProperty({ name: "id", type: "string" })
        .addProperty({ name: "name", type: "string" })
        .addProperty({ name: "price", type: "number" })
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface Product");
      expect(code).toContain("price: number");
    });

    it("should create type aliases using the fluent API", () => {
      typeBuilder
        .typeAlias("Status", "'pending' | 'complete' | 'error'")
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain(
        "export type Status = 'pending' | 'complete' | 'error'"
      );
    });
  });

  describe("Standard Type Generation", () => {
    it("should create ApiResponse interface", () => {
      typeBuilder.createApiResponseInterface();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface ApiResponse<T = any>");
      expect(code).toContain("success: boolean");
      expect(code).toContain("data: T");
      expect(code).toContain("status: number");
      expect(code).toContain("headers: Record<string, string>");
    });

    it("should create RequestOptions interface", () => {
      typeBuilder.createRequestOptionsInterface();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface RequestOptions");
      expect(code).toContain("method: string");
      expect(code).toContain("headers: Record<string, string>");
      expect(code).toContain("body?: string");
    });

    it("should create AuthConfig interface", () => {
      typeBuilder.createAuthConfigInterface();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface AuthConfig");
      expect(code).toContain(
        "type: 'bearer' | 'api_key' | 'basic' | 'session' | 'custom'"
      );
      expect(code).toContain("token?: string");
      expect(code).toContain("sessionCookies?: Record<string, string>");
    });

    it("should create response interface from inferred structure", () => {
      const fields = [
        { name: "id", type: "string", optional: false },
        { name: "title", type: "string", optional: false },
        { name: "description", type: "string", optional: true },
        { name: "count", type: "number", optional: false },
      ];

      typeBuilder.createResponseInterface("search-results", fields);

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface SearchResults");
      expect(code).toContain("id: string");
      expect(code).toContain("title: string");
      expect(code).toContain("description?: string");
      expect(code).toContain("count: number");
    });

    it("should generate all standard types", () => {
      typeBuilder.generateStandardTypes();

      const code = astProject.generateCode("test-types.ts");

      // Check all standard interfaces are present
      expect(code).toContain("export interface ApiResponse");
      expect(code).toContain("export interface RequestOptions");
      expect(code).toContain("export interface AuthConfig");
      expect(code).toContain("export class AuthenticationError");

      // Validate generated code is syntactically correct
      const validation = astProject.validate();
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.log("Validation errors:", validation.errors);
      }
    });
  });

  describe("Generated Type Structure", () => {
    it("should generate well-structured type definitions", () => {
      // Generate standard types
      typeBuilder.generateStandardTypes();

      const code = astProject.generateCode("test-types.ts");

      // Verify the structure matches expected patterns
      expect(code).toContain("interface ApiResponse<T = any>");
      expect(code).toContain("success: boolean");
      expect(code).toContain("data: T");
      expect(code).toContain("interface RequestOptions");
      expect(code).toContain("method: string");
      expect(code).toContain("headers: Record<string, string>");
      expect(code).toContain("body?: string");

      // Check authentication types
      expect(code).toContain("interface AuthConfig");
      expect(code).toContain("class AuthenticationError extends Error");

      console.log("✅ Generated types have proper structure");
    });

    it("should support comprehensive type patterns", () => {
      // Create types with various patterns
      typeBuilder
        .interface("SearchParams")
        .addProperty({ name: "query", type: "string" })
        .addProperty({ name: "page", type: "number", optional: true })
        .addProperty({ name: "filters", type: "string[]", optional: true })
        .export();

      typeBuilder
        .typeAlias("HttpMethod", "'GET' | 'POST' | 'PUT' | 'DELETE'")
        .export();

      const code = astProject.generateCode("test-types.ts");
      expect(code).toContain("export interface SearchParams");
      expect(code).toContain("query: string");
      expect(code).toContain("page?: number");
      expect(code).toContain("filters?: string[]");
      expect(code).toContain(
        "export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'"
      );

      console.log("✅ All type patterns supported");
    });
  });

  describe("Error Handling", () => {
    it("should validate interface names", () => {
      expect(() => {
        typeBuilder.interface("123Invalid").build();
      }).toThrow("Invalid TypeScript identifier");
    });

    it("should require interface to be created before operations", () => {
      const builder = new InterfaceBuilder(astProject, sourceFile);

      expect(() => {
        builder.addProperty({ name: "test", type: "string" });
      }).toThrow("Interface must be created");

      expect(() => {
        builder.export();
      }).toThrow("Interface must be created");
    });

    it("should require type alias to be created before operations", () => {
      const builder = new TypeAliasBuilder(astProject, sourceFile);

      expect(() => {
        builder.export();
      }).toThrow("Type alias must be created");

      expect(() => {
        builder.withDocumentation({ description: "test" });
      }).toThrow("Type alias must be created");
    });
  });
});
