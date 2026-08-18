/**
 * Base Builder Pattern Infrastructure
 *
 * Provides common functionality and patterns for all AST builders.
 * Implements the fluent interface pattern and provides utilities for
 * working with ts-morph AST nodes.
 */

import type { JSDocStructure, SourceFile, WriterFunction } from "ts-morph";
import type { ASTProject } from "./ASTProject.js";

/**
 * Common options for JSDoc generation
 */
export interface JSDocOptions {
  description?: string;
  additionalLines?: string[];
  params?: Array<{ name: string; description: string; type?: string }>;
  returns?: string;
  example?: string;
  since?: string;
  author?: string;
}

/**
 * Base builder class that provides common functionality for all AST builders
 */
export abstract class BaseBuilder {
  protected sourceFile: SourceFile;
  protected astProject: ASTProject;

  constructor(astProject: ASTProject, sourceFile: SourceFile) {
    this.astProject = astProject;
    this.sourceFile = sourceFile;
  }

  /**
   * Generate JSDoc structure from options
   */
  protected createJSDocStructure(options: JSDocOptions): JSDocStructure {
    const tags: Array<{ tagName: string; text?: string }> = [];

    // Add parameter documentation
    if (options.params) {
      for (const param of options.params) {
        tags.push({
          tagName: "param",
          text: `${param.name}${param.type ? ` {${param.type}}` : ""} - ${param.description}`,
        });
      }
    }

    // Add return documentation
    if (options.returns) {
      tags.push({
        tagName: "returns",
        text: options.returns,
      });
    }

    // Add example if provided
    if (options.example) {
      tags.push({
        tagName: "example",
        text: `\n${options.example}`,
      });
    }

    // Add since tag if provided
    if (options.since) {
      tags.push({
        tagName: "since",
        text: options.since,
      });
    }

    // Add author tag if provided
    if (options.author) {
      tags.push({
        tagName: "author",
        text: options.author,
      });
    }

    // Build description
    let description = options.description || "";
    if (options.additionalLines && options.additionalLines.length > 0) {
      description += `\n${options.additionalLines.join("\n")}`;
    }

    return {
      description,
      tags,
    } as JSDocStructure;
  }

  /**
   * Utility method to convert strings to camelCase
   */
  protected toCamelCase(str: string): string {
    // Split on word boundaries (spaces, hyphens, underscores, but preserve numbers)
    const words = str.split(/[\s\-_]+/).filter((word) => word.length > 0);

    return words
      .map((word, index) => {
        if (index === 0) {
          return word.toLowerCase();
        }
        // Handle mixed case words like "mixed123Test"
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join("");
  }

  /**
   * Utility method to convert strings to PascalCase
   */
  protected toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]/g, " ")
      .split(" ")
      .filter((word) => word.length > 0)
      .map((word) => this.capitalize(word))
      .join("");
  }

  /**
   * Utility method to capitalize first letter
   */
  protected capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Utility method to create a writer function that generates indented code
   */
  protected createWriter(
    codeGenerator: (writer: {
      writeLine: (text: string) => void;
      indent: (fn: () => void) => void;
    }) => void
  ): WriterFunction {
    return (writer) => {
      codeGenerator(writer);
    };
  }

  /**
   * Validate that an identifier is a valid TypeScript identifier
   */
  protected validateIdentifier(identifier: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(identifier);
  }

  /**
   * Ensure an identifier is valid, throw error if not
   */
  protected ensureValidIdentifier(
    identifier: string,
    context?: string
  ): string {
    if (!this.validateIdentifier(identifier)) {
      const contextMsg = context ? ` for ${context}` : "";
      throw new Error(
        `Invalid TypeScript identifier${contextMsg}: '${identifier}'`
      );
    }
    return identifier;
  }

  /**
   * Generate a safe identifier from a potentially unsafe string
   */
  protected createSafeIdentifier(
    input: string,
    defaultPrefix = "item"
  ): string {
    // Clean the input but preserve alphanumeric boundaries
    const cleaned = input.replace(/[^a-zA-Z0-9\-_\s]/g, "");

    // Convert to camelCase
    let identifier = this.toCamelCase(cleaned);

    // Ensure it doesn't start with a number
    if (/^[0-9]/.test(identifier)) {
      identifier = `${defaultPrefix}${this.capitalize(identifier)}`;
    }

    // If empty, use default
    if (!identifier) {
      identifier = defaultPrefix;
    }

    return identifier;
  }

  /**
   * Create a TypeScript type annotation from a JavaScript value
   */
  protected inferTypeFromValue(value: unknown): string {
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
        return "unknown[]";
      }
      // Infer type from first element
      const elementType = this.inferTypeFromValue(value[0]);
      return `${elementType}[]`;
    }

    if (typeof value === "object") {
      return "object";
    }

    return "any";
  }

  /**
   * Get the source file being built
   */
  getSourceFile(): SourceFile {
    return this.sourceFile;
  }

  /**
   * Get the AST project
   */
  getASTProject(): ASTProject {
    return this.astProject;
  }
}

/**
 * Format a multi-line string with proper indentation
 */
export function formatMultilineString(text: string, indentLevel = 0): string {
  const indent = "  ".repeat(indentLevel);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : indent + line))
    .join("\n");
}

/**
 * Clean up whitespace in generated code
 */
export function cleanWhitespace(code: string): string {
  return code
    .replace(/\s+$/gm, "") // Remove trailing whitespace from lines first
    .replace(/^\s+$/gm, "") // Remove lines with only whitespace
    .replace(/\n\s*\n\s*\n/g, "\n\n") // Remove excessive blank lines
    .replace(/\n\s*\n/g, "\n\n") // Normalize double blank lines
    .trim();
}

/**
 * Validate that a string is valid TypeScript code (basic check)
 */
export function isValidTypeScriptCode(code: string): boolean {
  // Basic validation - check for balanced braces and parentheses
  const openBraces = (code.match(/{/g) || []).length;
  const closeBraces = (code.match(/}/g) || []).length;
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;

  return openBraces === closeBraces && openParens === closeParens;
}

/**
 * Extract unique import statements from code
 */
export function extractImports(code: string): string[] {
  const importRegex = /import\s+.*?from\s+['"][^'"]+['"];?/g;
  const imports = code.match(importRegex) || [];
  return Array.from(new Set(imports));
}
