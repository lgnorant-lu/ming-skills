/**
 * AST-Based Type Definition Engine
 *
 * AST-based type definition engine that uses AST builders for generating
 * TypeScript type definitions. Provides a clean interface for type generation
 * with type-safe AST manipulation.
 */

import { ASTProject } from "./ASTProject.js";
import { TypeBuilder } from "./TypeBuilder.js";

/**
 * AST-based type definition engine for generating TypeScript type definitions
 */
export class ASTTypeDefinitionEngine {
  public astProject: ASTProject;
  private currentSourceFile = "generated.ts";

  constructor(astProject?: ASTProject) {
    this.astProject =
      astProject ||
      new ASTProject({
        useInMemoryFileSystem: true,
        formatCode: true,
        organizeImports: false, // Avoid removing unused imports during generation
      });
  }

  /**
   * Set the current source file for generation
   */
  setSourceFile(fileName: string): void {
    this.currentSourceFile = fileName;
  }

  /**
   * Get the current TypeBuilder instance
   */
  public getTypeBuilder(): TypeBuilder {
    const sourceFile = this.astProject.createSourceFile(this.currentSourceFile);
    return new TypeBuilder(this.astProject, sourceFile);
  }

  /**
   * Generate the final code
   */
  generateCode(): string {
    return this.astProject.generateCode(this.currentSourceFile);
  }

  /**
   * Clear all generated content
   */
  clear(): void {
    this.astProject.reset();
  }

  /**
   * Add file header with metadata - generates comment block
   */
  addFileHeader(prompt: string, sessionId: string, date?: string): void {
    const sourceFile = this.astProject.createSourceFile(this.currentSourceFile);
    const headerDate = date || new Date().toISOString().split("T")[0];

    const header = `// Harvest Generated API Integration Code
// ==========================================
//
// Original prompt: ${prompt}
// Generated: ${headerDate}
// Session ID: ${sessionId}
//
// DO NOT EDIT - This file is auto-generated
// To modify the API integration, re-run the Harvest analysis`;

    // Insert at the beginning of the file
    sourceFile.insertText(0, `${header}\n\n`);
  }

  /**
   * Generate standard type definitions
   * Uses shared imports from SharedTypes.js for all standard types
   * @param inferredTypes - Custom response type interfaces to generate
   */
  addStandardTypeDefinitions(
    inferredTypes?: Array<{
      interfaceName: string;
      fields: Array<{ name: string; type: string; optional: boolean }>;
    }>
  ): void {
    const typeBuilder = this.getTypeBuilder();

    // Add comment for type definitions section
    const sourceFile = this.astProject.getSourceFile(this.currentSourceFile);
    if (sourceFile) {
      const comment = "// Type definitions\n\n";
      sourceFile.insertText(sourceFile.getFullText().length, comment);
    }

    // Add inferred response types if provided (these are always generated inline)
    if (inferredTypes && inferredTypes.length > 0) {
      for (const responseType of inferredTypes) {
        typeBuilder.createResponseInterface(
          responseType.interfaceName,
          responseType.fields
        );
      }
    }

    // Generate standard types using shared imports
    typeBuilder.generateStandardTypes();
  }

  /**
   * Add export statement for functions
   */
  addExportStatement(exports: string[]): void {
    const sourceFile = this.astProject.getSourceFile(this.currentSourceFile);
    if (!sourceFile) {
      return;
    }

    const exportText = `export {\n  ${exports.join(",\n  ")}\n};`;
    sourceFile.insertText(sourceFile.getFullText().length, `\n${exportText}\n`);
  }

  /**
   * Add export type statement
   */
  addExportTypeStatement(types: string[]): void {
    const sourceFile = this.astProject.getSourceFile(this.currentSourceFile);
    if (!sourceFile) {
      return;
    }

    const exportText = `export type { ${types.join(", ")} };`;
    sourceFile.insertText(sourceFile.getFullText().length, `${exportText}\n`);
  }

  /**
   * Add usage example comment
   */
  addUsageExample(importPath = "./generated-api-integration.ts"): void {
    const sourceFile = this.astProject.getSourceFile(this.currentSourceFile);
    if (!sourceFile) {
      return;
    }

    const example = `\n// Usage example:
// import { main } from "${importPath}";
// const result = await main();
// console.log(result.data);\n`;

    sourceFile.insertText(sourceFile.getFullText().length, example);
  }

  /**
   * Add main function
   */
  addMainFunction(body: string): void {
    const sourceFile = this.astProject.getSourceFile(this.currentSourceFile);
    if (!sourceFile) {
      return;
    }

    sourceFile.addFunction({
      name: "main",
      isAsync: true,
      isExported: false, // Will be exported in export block
      returnType: "Promise<ApiResponse>",
      docs: [
        {
          description: "Main function that executes the complete API workflow",
        },
      ],
      statements: body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line),
    });
  }

  /**
   * Add custom interface
   */
  addInterface(
    interfaceName: string,
    properties: Array<{ name: string; type: string; optional?: boolean }>
  ): void {
    const typeBuilder = this.getTypeBuilder();

    typeBuilder
      .interface(interfaceName)
      .addProperties(
        properties.map((prop) => ({
          name: prop.name,
          type: prop.type,
          optional: prop.optional ?? false,
        }))
      )
      .export();
  }

  /**
   * Add generic interface
   */
  addGenericInterface(
    interfaceName: string,
    genericParams: string,
    properties: Array<{ name: string; type: string; optional?: boolean }>
  ): void {
    const typeBuilder = this.getTypeBuilder();

    // Parse generic parameters (simple parsing for now)
    const typeParams = genericParams.split(",").map((param) => ({
      name: param.trim(),
    }));

    typeBuilder
      .interface(interfaceName)
      .withTypeParameters(typeParams)
      .addProperties(
        properties.map((prop) => ({
          name: prop.name,
          type: prop.type,
          optional: prop.optional ?? false,
        }))
      )
      .export();
  }
}
