import type { SourceFile } from "ts-morph";
import { beforeEach, describe, expect, it } from "vitest";
import { ASTProject } from "../../../src/core/ast/ASTProject.js";
import {
  BaseBuilder,
  cleanWhitespace,
  extractImports,
  formatMultilineString,
  isValidTypeScriptCode,
} from "../../../src/core/ast/BaseBuilder.js";

/**
 * Test implementation of BaseBuilder for testing purposes
 */
class TestBuilder extends BaseBuilder {
  testToCamelCase(str: string) {
    return this.toCamelCase(str);
  }
  testToPascalCase(str: string) {
    return this.toPascalCase(str);
  }
  testCapitalize(str: string) {
    return this.capitalize(str);
  }
  testValidateIdentifier(str: string) {
    return this.validateIdentifier(str);
  }
  testCreateSafeIdentifier(str: string) {
    return this.createSafeIdentifier(str);
  }
  testInferTypeFromValue(value: unknown) {
    return this.inferTypeFromValue(value);
  }
  testCreateJSDocStructure(options: any) {
    return this.createJSDocStructure(options);
  }
}

/**
 * Test suite for AST infrastructure
 */
describe("AST Infrastructure", () => {
  let astProject: ASTProject;
  let sourceFile: SourceFile;
  let testBuilder: TestBuilder;

  beforeEach(() => {
    astProject = new ASTProject({
      useInMemoryFileSystem: true,
      formatCode: true,
    });
    sourceFile = astProject.createSourceFile("test.ts");
    testBuilder = new TestBuilder(astProject, sourceFile);
  });

  describe("ASTProject", () => {
    it("should create and manage source files", () => {
      const file1 = astProject.createSourceFile("file1.ts");
      const file2 = astProject.createSourceFile(
        "file2.ts",
        "// Initial content"
      );

      expect(file1).toBeDefined();
      expect(file2).toBeDefined();
      expect(astProject.getSourceFile("file1.ts")).toBe(file1);
      expect(astProject.getSourceFile("file2.ts")).toBe(file2);
      expect(astProject.getSourceFiles()).toHaveLength(3); // Including test.ts from beforeEach
    });

    it("should generate code for source files", () => {
      const testFile = astProject.createSourceFile("test-gen.ts");
      testFile.addInterface({
        name: "TestInterface",
        properties: [{ name: "test", type: "string" }],
      });

      const code = astProject.generateCode("test-gen.ts");
      expect(code).toContain("interface TestInterface");
      expect(code).toContain("test: string");
    });

    it("should validate TypeScript code", () => {
      const validFile = astProject.createSourceFile("valid.ts");
      validFile.addInterface({
        name: "ValidInterface",
        properties: [{ name: "prop", type: "string" }],
      });

      const validation = astProject.validate();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should manage imports", () => {
      astProject.createSourceFile("import-test.ts");

      astProject.addImport("import-test.ts", "fs", ["readFile", "writeFile"]);
      astProject.addImport(
        "import-test.ts",
        "./types",
        undefined,
        "DefaultExport"
      );

      const code = astProject.generateCode("import-test.ts");
      expect(code).toContain('import { readFile, writeFile } from "fs"');
      expect(code).toContain('import DefaultExport from "./types"');
    });

    it("should provide project statistics", () => {
      astProject.createSourceFile("stats1.ts", "const x = 1;");
      astProject.createSourceFile("stats2.ts", "const y = 2;\nconst z = 3;");

      const stats = astProject.getStats();
      expect(stats.sourceFileCount).toBeGreaterThan(0);
      expect(stats.totalCharacters).toBeGreaterThan(0);
      expect(stats.totalLines).toBeGreaterThan(0);
    });

    it("should reset project state", () => {
      astProject.createSourceFile("temp1.ts");
      astProject.createSourceFile("temp2.ts");

      expect(astProject.getSourceFiles().length).toBeGreaterThan(2);

      astProject.reset();
      expect(astProject.getSourceFiles()).toHaveLength(0);
    });
  });

  describe("BaseBuilder", () => {
    it("should convert strings to camelCase", () => {
      expect(testBuilder.testToCamelCase("hello world")).toBe("helloWorld");
      expect(testBuilder.testToCamelCase("test-case")).toBe("testCase");
      expect(testBuilder.testToCamelCase("UPPER_CASE")).toBe("upperCase");
      expect(testBuilder.testToCamelCase("mixed123Test")).toBe("mixed123test");
    });

    it("should convert strings to PascalCase", () => {
      expect(testBuilder.testToPascalCase("hello world")).toBe("HelloWorld");
      expect(testBuilder.testToPascalCase("test-case")).toBe("TestCase");
      expect(testBuilder.testToPascalCase("UPPER_CASE")).toBe("UpperCase");
    });

    it("should capitalize strings", () => {
      expect(testBuilder.testCapitalize("hello")).toBe("Hello");
      expect(testBuilder.testCapitalize("WORLD")).toBe("World");
      expect(testBuilder.testCapitalize("mIxEd")).toBe("Mixed");
    });

    it("should validate TypeScript identifiers", () => {
      expect(testBuilder.testValidateIdentifier("validName")).toBe(true);
      expect(testBuilder.testValidateIdentifier("_valid")).toBe(true);
      expect(testBuilder.testValidateIdentifier("$valid")).toBe(true);
      expect(testBuilder.testValidateIdentifier("valid123")).toBe(true);

      expect(testBuilder.testValidateIdentifier("123invalid")).toBe(false);
      expect(testBuilder.testValidateIdentifier("invalid-name")).toBe(false);
      expect(testBuilder.testValidateIdentifier("invalid.name")).toBe(false);
      expect(testBuilder.testValidateIdentifier("")).toBe(false);
    });

    it("should create safe identifiers", () => {
      expect(testBuilder.testCreateSafeIdentifier("valid-name")).toBe(
        "validName"
      );
      expect(testBuilder.testCreateSafeIdentifier("123invalid")).toBe(
        "item123invalid"
      );
      expect(testBuilder.testCreateSafeIdentifier("")).toBe("item");
      expect(testBuilder.testCreateSafeIdentifier("special@#$characters")).toBe(
        "specialcharacters"
      );
    });

    it("should infer types from values", () => {
      expect(testBuilder.testInferTypeFromValue("hello")).toBe("string");
      expect(testBuilder.testInferTypeFromValue(42)).toBe("number");
      expect(testBuilder.testInferTypeFromValue(true)).toBe("boolean");
      expect(testBuilder.testInferTypeFromValue([])).toBe("any[]");
      expect(testBuilder.testInferTypeFromValue(["hello"])).toBe("string[]");
      expect(testBuilder.testInferTypeFromValue({})).toBe("object");
      expect(testBuilder.testInferTypeFromValue(null)).toBe("any");
    });

    it("should create JSDoc structures", () => {
      const jsDoc = testBuilder.testCreateJSDocStructure({
        description: "Test function",
        params: [
          { name: "param1", description: "First parameter", type: "string" },
          { name: "param2", description: "Second parameter" },
        ],
        returns: "Promise<void>",
        example: "testFunction('hello', 123);",
      });

      expect(jsDoc.description).toBe("Test function");
      expect(jsDoc.tags).toHaveLength(4); // 2 params + returns + example
      expect(jsDoc.tags?.[0]?.tagName).toBe("param");
      expect(jsDoc.tags?.[2]?.tagName).toBe("returns");
    });
  });

  describe("ASTUtils", () => {
    it("should format multi-line strings with indentation", () => {
      const input = "line1\nline2\nline3";
      const formatted = formatMultilineString(input, 2);

      expect(formatted).toContain("line1");
      expect(formatted).toContain("    line2"); // 2 levels * 2 spaces
      expect(formatted).toContain("    line3");
    });

    it("should clean whitespace in code", () => {
      const messyCode = "  line1  \n\n\n  \n  line2  \n  ";
      const cleaned = cleanWhitespace(messyCode);

      expect(cleaned).not.toContain("\n\n\n");
      // The function removes trailing whitespace but preserves leading content indentation
      expect(cleaned).toBe("line1\n  line2");
    });

    it("should validate basic TypeScript code structure", () => {
      const validCode = "function test() { return true; }";
      const invalidCode = "function test() { return true;";

      expect(isValidTypeScriptCode(validCode)).toBe(true);
      expect(isValidTypeScriptCode(invalidCode)).toBe(false);
    });

    it("should extract import statements", () => {
      const code = `
        import fs from 'fs';
        import { readFile } from 'fs/promises';
        const x = 1;
        import path from 'path';
      `;

      const imports = extractImports(code);
      expect(imports).toHaveLength(3);
      expect(imports).toContain("import fs from 'fs';");
      expect(imports).toContain("import { readFile } from 'fs/promises';");
      expect(imports).toContain("import path from 'path';");
    });
  });

  describe("Integration", () => {
    it("should work together to create complex structures", () => {
      // Create an interface using the infrastructure
      const interfaceFile = astProject.createSourceFile("integration-test.ts");

      interfaceFile.addInterface({
        name: testBuilder.testToPascalCase("api-response"),
        isExported: true,
        properties: [
          {
            name: testBuilder.testCreateSafeIdentifier("success-flag"),
            type: "boolean",
          },
          {
            name: "data",
            type: "T",
          },
        ],
        typeParameters: [{ name: "T", default: "any" }],
      });

      const code = astProject.generateCode("integration-test.ts");

      expect(code).toContain("export interface ApiResponse<T = any>");
      expect(code).toContain("successFlag: boolean");
      expect(code).toContain("data: T");

      // Validate the generated code
      const validation = astProject.validate();
      expect(validation.valid).toBe(true);
    });
  });
});
