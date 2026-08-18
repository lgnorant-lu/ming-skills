/**
 * TypeScript Type Builder
 *
 * Provides fluent APIs for building TypeScript type definitions using AST.
 * This provides AST-based type definition generation
 * with a flexible and type-safe approach.
 */

import {
  type InterfaceDeclaration,
  type PropertySignatureStructure,
  StructureKind,
  type TypeAliasDeclaration,
} from "ts-morph";
import { BaseBuilder, type JSDocOptions } from "./BaseBuilder.js";

/**
 * Structure for defining interface properties
 */
export interface PropertyDefinition {
  name: string;
  type: string;
  optional?: boolean;
  readonly?: boolean;
  description?: string;
}

/**
 * Structure for defining type parameters
 */
export interface TypeParameter {
  name: string;
  constraint?: string;
  default?: string;
}

/**
 * Builder for creating TypeScript interfaces
 */
export class InterfaceBuilder extends BaseBuilder {
  private declaration?: InterfaceDeclaration;

  /**
   * Create a new interface
   */
  create(name: string): this {
    this.ensureValidIdentifier(name, "interface name");

    this.declaration = this.sourceFile.addInterface({
      name,
      isExported: false, // Will be set by export() method
    });

    return this;
  }

  /**
   * Make the interface exported
   */
  export(): this {
    if (!this.declaration) {
      throw new Error("Interface must be created before it can be exported");
    }

    this.declaration.setIsExported(true);
    return this;
  }

  /**
   * Add JSDoc documentation to the interface
   */
  withDocumentation(options: JSDocOptions): this {
    if (!this.declaration) {
      throw new Error(
        "Interface must be created before documentation can be added"
      );
    }

    const jsDoc = this.createJSDocStructure(options);
    this.declaration.addJsDoc(jsDoc);
    return this;
  }

  /**
   * Add type parameters to the interface
   */
  withTypeParameters(typeParams: TypeParameter[]): this {
    if (!this.declaration) {
      throw new Error(
        "Interface must be created before type parameters can be added"
      );
    }

    const structures = typeParams.map((param) => ({
      name: param.name,
      ...(param.constraint && { constraint: param.constraint }),
      ...(param.default && { default: param.default }),
    }));

    this.declaration.addTypeParameters(structures);
    return this;
  }

  /**
   * Add a single property to the interface
   */
  addProperty(property: PropertyDefinition): this {
    if (!this.declaration) {
      throw new Error(
        "Interface must be created before properties can be added"
      );
    }

    const propertyStructure: PropertySignatureStructure = {
      kind: StructureKind.PropertySignature,
      name: property.name,
      type: property.type,
      hasQuestionToken: property.optional || false,
      isReadonly: property.readonly || false,
    };

    if (property.description) {
      propertyStructure.docs = [
        {
          description: property.description,
        },
      ];
    }

    this.declaration.addProperty(propertyStructure);
    return this;
  }

  /**
   * Add multiple properties to the interface
   */
  addProperties(properties: PropertyDefinition[]): this {
    for (const property of properties) {
      this.addProperty(property);
    }
    return this;
  }

  /**
   * Add properties from an object definition (utility method)
   */
  addPropertiesFromObject(
    obj: Record<
      string,
      | string
      | {
          type: string;
          optional?: boolean;
          readonly?: boolean;
          description?: string;
        }
    >
  ): this {
    for (const [name, definition] of Object.entries(obj)) {
      if (typeof definition === "string") {
        this.addProperty({ name, type: definition });
      } else {
        this.addProperty({
          name,
          type: definition.type,
          optional: definition.optional ?? false,
          readonly: definition.readonly ?? false,
          ...(definition.description && {
            description: definition.description,
          }),
        });
      }
    }
    return this;
  }

  /**
   * Extend another interface
   */
  extends(interfaceName: string): this {
    if (!this.declaration) {
      throw new Error(
        "Interface must be created before it can extend another interface"
      );
    }

    this.declaration.addExtends(interfaceName);
    return this;
  }

  /**
   * Get the generated interface declaration
   */
  build(): InterfaceDeclaration {
    if (!this.declaration) {
      throw new Error("Interface must be created before it can be built");
    }
    return this.declaration;
  }

  /**
   * Get the interface name
   */
  getName(): string {
    if (!this.declaration) {
      throw new Error("Interface must be created before getting its name");
    }
    return this.declaration.getName();
  }
}

/**
 * Builder for creating TypeScript type aliases
 */
export class TypeAliasBuilder extends BaseBuilder {
  private declaration?: TypeAliasDeclaration;

  /**
   * Create a new type alias
   */
  create(name: string, type: string): this {
    this.ensureValidIdentifier(name, "type alias name");

    this.declaration = this.sourceFile.addTypeAlias({
      name,
      type,
      isExported: false, // Will be set by export() method
    });

    return this;
  }

  /**
   * Make the type alias exported
   */
  export(): this {
    if (!this.declaration) {
      throw new Error("Type alias must be created before it can be exported");
    }

    this.declaration.setIsExported(true);
    return this;
  }

  /**
   * Add JSDoc documentation to the type alias
   */
  withDocumentation(options: JSDocOptions): this {
    if (!this.declaration) {
      throw new Error(
        "Type alias must be created before documentation can be added"
      );
    }

    const jsDoc = this.createJSDocStructure(options);
    this.declaration.addJsDoc(jsDoc);
    return this;
  }

  /**
   * Add type parameters to the type alias
   */
  withTypeParameters(typeParams: TypeParameter[]): this {
    if (!this.declaration) {
      throw new Error(
        "Type alias must be created before type parameters can be added"
      );
    }

    const structures = typeParams.map((param) => ({
      name: param.name,
      ...(param.constraint && { constraint: param.constraint }),
      ...(param.default && { default: param.default }),
    }));

    this.declaration.addTypeParameters(structures);
    return this;
  }

  /**
   * Get the generated type alias declaration
   */
  build(): TypeAliasDeclaration {
    if (!this.declaration) {
      throw new Error("Type alias must be created before it can be built");
    }
    return this.declaration;
  }

  /**
   * Get the type alias name
   */
  getName(): string {
    if (!this.declaration) {
      throw new Error("Type alias must be created before getting its name");
    }
    return this.declaration.getName();
  }
}

/**
 * High-level TypeBuilder that provides convenient methods for common type patterns
 * This provides convenient methods for common type patterns
 */
export class TypeBuilder extends BaseBuilder {
  /**
   * Create a new interface builder
   */
  interface(name: string): InterfaceBuilder {
    return new InterfaceBuilder(this.astProject, this.sourceFile).create(name);
  }

  /**
   * Create a new type alias builder
   */
  typeAlias(name: string, type: string): TypeAliasBuilder {
    return new TypeAliasBuilder(this.astProject, this.sourceFile).create(
      name,
      type
    );
  }

  /**
   * Create the standard ApiResponse interface used in generated code
   */
  createApiResponseInterface(): InterfaceBuilder {
    return this.interface("ApiResponse")
      .withTypeParameters([{ name: "T", default: "unknown" }])
      .withDocumentation({
        description: "Standard API response structure",
        additionalLines: [
          "Generic response wrapper that provides consistent structure",
          "for all API responses including success status, data, and metadata.",
        ],
      })
      .addProperties([
        {
          name: "success",
          type: "boolean",
          description: "Whether the API call was successful",
        },
        {
          name: "data",
          type: "T",
          description: "The response data",
        },
        {
          name: "status",
          type: "number",
          description: "HTTP status code",
        },
        {
          name: "headers",
          type: "Record<string, string>",
          description: "Response headers",
        },
      ])
      .export();
  }

  /**
   * Create the RequestOptions interface used in generated code
   */
  createRequestOptionsInterface(): InterfaceBuilder {
    return this.interface("RequestOptions")
      .withDocumentation({
        description: "HTTP request configuration options",
      })
      .addProperties([
        {
          name: "method",
          type: "string",
          description: "HTTP method",
        },
        {
          name: "headers",
          type: "Record<string, string>",
          description: "Request headers",
        },
        {
          name: "body",
          type: "string",
          optional: true,
          description: "Request body",
        },
      ])
      .export();
  }

  /**
   * Create the AuthConfig interface used in generated code
   */
  createAuthConfigInterface(): InterfaceBuilder {
    return this.interface("AuthConfig")
      .withDocumentation({
        description: "Authentication configuration interface",
        additionalLines: [
          "Supports multiple authentication methods including Bearer tokens,",
          "API keys, basic auth, session cookies, and custom headers.",
        ],
      })
      .addProperties([
        {
          name: "type",
          type: "'bearer' | 'api_key' | 'basic' | 'session' | 'custom'",
          description: "Authentication type",
        },
        {
          name: "token",
          type: "string",
          optional: true,
          description: "Bearer token",
        },
        {
          name: "apiKey",
          type: "string",
          optional: true,
          description: "API key",
        },
        {
          name: "username",
          type: "string",
          optional: true,
          description: "Username for basic auth",
        },
        {
          name: "password",
          type: "string",
          optional: true,
          description: "Password for basic auth",
        },
        {
          name: "sessionCookies",
          type: "Record<string, string>",
          optional: true,
          description: "Session cookies",
        },
        {
          name: "customHeaders",
          type: "Record<string, string>",
          optional: true,
          description: "Custom authentication headers",
        },
        {
          name: "tokenRefreshUrl",
          type: "string",
          optional: true,
          description: "URL for refreshing tokens",
        },
        {
          name: "onTokenExpired",
          type: "() => Promise<string>",
          optional: true,
          description: "Callback for handling token expiration",
        },
      ])
      .export();
  }

  /**
   * Create a response interface from inferred structure
   */
  createResponseInterface(
    name: string,
    fields: Array<{ name: string; type: string; optional: boolean }>
  ): InterfaceBuilder {
    // Keep the original name format, just capitalize first letter
    const interfaceName = name.charAt(0).toUpperCase() + name.slice(1);

    const builder = this.interface(interfaceName).withDocumentation({
      description: `Response interface for ${name}`,
      additionalLines: ["Auto-generated from API response analysis"],
    });

    const properties: PropertyDefinition[] = fields.map((field) => ({
      name: field.name,
      type: field.type,
      optional: field.optional,
      description: `Field: ${field.name}`,
    }));

    return builder.addProperties(properties).export();
  }

  /**
   * Generate all standard type definitions used by the generated code
   * This generates all standard type definitions used by the generated code
   * Uses shared imports from SharedTypes.js for reduced boilerplate
   */
  generateStandardTypes(): void {
    // Import from shared types module
    this.sourceFile.addImportDeclaration({
      moduleSpecifier: "./SharedTypes.js",
      namedImports: [
        "ApiResponse",
        "RequestOptions",
        "AuthConfig",
        "AuthenticationError",
        "NetworkRequestError",
        "WorkflowExecutionError",
        "CookieError",
      ],
    });

    // Add a comment explaining the import
    const importComment =
      "// Standard types imported from SharedTypes.js for reduced boilerplate\n";
    this.sourceFile.insertText(0, importComment);
  }
}
