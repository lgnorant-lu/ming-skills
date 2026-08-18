/**
 * AST Project Manager
 *
 * Central orchestrator for all AST-based code generation operations.
 * Manages the ts-morph Project instance, source files, and provides
 * a clean interface for builders to interact with the AST.
 */

import { type CompilerOptions, Project, type SourceFile } from "ts-morph";

/**
 * Configuration for AST project creation
 */
export interface ASTProjectConfig {
  /**
   * Whether to use in-memory file system (recommended for code generation)
   */
  useInMemoryFileSystem?: boolean;

  /**
   * TypeScript compiler options
   */
  compilerOptions?: CompilerOptions;

  /**
   * Whether to enable automatic import organization
   */
  organizeImports?: boolean;

  /**
   * Whether to format generated code
   */
  formatCode?: boolean;
}

/**
 * Default configuration for code generation projects
 */
const DEFAULT_CONFIG: Required<ASTProjectConfig> = {
  useInMemoryFileSystem: true,
  compilerOptions: {
    target: 99, // Latest ESNext
    module: 99, // ESNext modules
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    declaration: false,
    removeComments: false,
  },
  organizeImports: true,
  formatCode: true,
};

/**
 * AST Project Manager
 *
 * Provides a high-level interface for creating and managing TypeScript AST
 * projects for code generation. Encapsulates ts-morph complexity and provides
 * builder-friendly methods.
 */
export class ASTProject {
  private project: Project;
  private config: Required<ASTProjectConfig>;
  private sourceFiles = new Map<string, SourceFile>();

  constructor(config: ASTProjectConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.project = new Project({
      useInMemoryFileSystem: this.config.useInMemoryFileSystem,
      compilerOptions: this.config.compilerOptions,
    });
  }

  /**
   * Create or get a source file for code generation
   */
  createSourceFile(fileName: string, initialContent = ""): SourceFile {
    // Check if source file already exists
    let sourceFile = this.sourceFiles.get(fileName);

    if (sourceFile) {
      return sourceFile;
    }

    // Create new source file
    sourceFile = this.project.createSourceFile(fileName, initialContent);
    this.sourceFiles.set(fileName, sourceFile);

    return sourceFile;
  }

  /**
   * Get an existing source file
   */
  getSourceFile(fileName: string): SourceFile | undefined {
    return this.sourceFiles.get(fileName);
  }

  /**
   * Get all created source files
   */
  getSourceFiles(): SourceFile[] {
    return Array.from(this.sourceFiles.values());
  }

  /**
   * Generate the final TypeScript code for a source file
   */
  generateCode(fileName: string): string {
    const sourceFile = this.sourceFiles.get(fileName);
    if (!sourceFile) {
      throw new Error(`Source file '${fileName}' not found`);
    }

    // Apply formatting if enabled (but skip organize imports for now as it can remove unused imports)
    if (this.config.formatCode) {
      sourceFile.formatText();
    }

    return sourceFile.getFullText();
  }

  /**
   * Generate code for all source files
   */
  generateAllCode(): Map<string, string> {
    const result = new Map<string, string>();

    for (const [fileName, sourceFile] of this.sourceFiles) {
      // Apply formatting if enabled (but skip organize imports for now as it can remove unused imports)
      if (this.config.formatCode) {
        sourceFile.formatText();
      }

      result.set(fileName, sourceFile.getFullText());
    }

    return result;
  }

  /**
   * Validate that all source files are syntactically correct
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      // Run TypeScript diagnostics on all source files
      const diagnostics = this.project.getPreEmitDiagnostics();

      for (const diagnostic of diagnostics) {
        const message = diagnostic.getMessageText();
        const sourceFile = diagnostic.getSourceFile();
        const lineAndColumn = sourceFile
          ? sourceFile.getLineAndColumnAtPos(diagnostic.getStart() || 0)
          : null;

        const location = lineAndColumn
          ? `${sourceFile?.getBaseName()}:${lineAndColumn.line}:${lineAndColumn.column}`
          : "unknown";

        errors.push(`${location}: ${message}`);
      }

      return {
        valid: errors.length === 0,
        errors,
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : "Validation failed"],
      };
    }
  }

  /**
   * Clear all source files and reset the project
   */
  reset(): void {
    this.sourceFiles.clear();
    // Create a new project instance to ensure clean state
    this.project = new Project({
      useInMemoryFileSystem: this.config.useInMemoryFileSystem,
      compilerOptions: this.config.compilerOptions,
    });
  }

  /**
   * Get the underlying ts-morph Project instance
   * (Use with caution - prefer using the high-level methods)
   */
  getProject(): Project {
    return this.project;
  }

  /**
   * Add a dependency import to a source file
   * This method helps manage imports across builders
   */
  addImport(
    sourceFileName: string,
    moduleSpecifier: string,
    namedImports?: string[],
    defaultImport?: string
  ): void {
    const sourceFile = this.getSourceFile(sourceFileName);
    if (!sourceFile) {
      throw new Error(`Source file '${sourceFileName}' not found`);
    }

    // Build import structure with proper typing
    const importStructure: {
      moduleSpecifier: string;
      defaultImport?: string;
      namedImports?: string[];
    } = { moduleSpecifier };

    if (defaultImport) {
      importStructure.defaultImport = defaultImport;
    }

    if (namedImports && namedImports.length > 0) {
      importStructure.namedImports = namedImports;
    }

    // Only add if we have something to import
    if (defaultImport || (namedImports && namedImports.length > 0)) {
      sourceFile.addImportDeclaration(importStructure);
    }
  }

  /**
   * Add a comment at the top of a source file
   */
  addFileHeader(sourceFileName: string, comment: string): void {
    const sourceFile = this.getSourceFile(sourceFileName);
    if (!sourceFile) {
      throw new Error(`Source file '${sourceFileName}' not found`);
    }

    // Add as leading trivia to the first statement, or create a comment statement
    if (sourceFile.getStatements().length > 0) {
      const firstStatement = sourceFile.getStatements()[0];
      if (firstStatement) {
        // Add a comment at the top of the file using insertText instead
        sourceFile.insertText(0, `${comment}\n\n`);
      }
    } else {
      // Add a comment statement
      sourceFile.insertText(0, `${comment}\n\n`);
    }
  }

  /**
   * Statistics about the current project state
   */
  getStats(): {
    sourceFileCount: number;
    totalLines: number;
    totalCharacters: number;
    hasErrors: boolean;
  } {
    let totalLines = 0;
    let totalCharacters = 0;

    for (const sourceFile of this.sourceFiles.values()) {
      const text = sourceFile.getFullText();
      totalCharacters += text.length;
      totalLines += text.split("\n").length;
    }

    const validation = this.validate();

    return {
      sourceFileCount: this.sourceFiles.size,
      totalLines,
      totalCharacters,
      hasErrors: !validation.valid,
    };
  }
}
