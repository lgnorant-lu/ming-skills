import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createComponentLogger } from "./logger.js";

const logger = createComponentLogger("path-translator");

/**
 * Interface for client context information
 */
export interface ClientContext {
  allowedPaths?: string[];
  workingDirectory?: string;
  sharedDirectory?: string;
}

/**
 * Service for translating server paths to client-accessible paths
 */
export class PathTranslator {
  private serverToClientMap = new Map<string, string>();
  private sharedDirectory: string;

  constructor(sharedDirectory?: string) {
    // Default shared directory in user's home
    this.sharedDirectory =
      sharedDirectory || join(homedir(), ".harvest", "shared");
    logger.info(
      { sharedDirectory: this.sharedDirectory },
      "PathTranslator initialized"
    );
  }

  /**
   * Register a mapping from server path to client path
   */
  registerPath(serverPath: string, clientPath: string): void {
    this.serverToClientMap.set(serverPath, clientPath);
    logger.debug({ serverPath, clientPath }, "Registered path mapping");
  }

  /**
   * Translate a server path to a client-accessible path
   */
  translateForClient(serverPath: string): string {
    // Check if direct mapping exists
    if (this.serverToClientMap.has(serverPath)) {
      const clientPath = this.serverToClientMap.get(serverPath);
      if (clientPath) {
        logger.debug({ serverPath, clientPath }, "Found direct path mapping");
        return clientPath;
      }
    }

    // Check if path is within shared directory
    const resolvedServerPath = resolve(serverPath);
    const resolvedSharedDir = resolve(this.sharedDirectory);

    if (resolvedServerPath.startsWith(resolvedSharedDir)) {
      // Convert to relative path from shared directory
      const relativePath = relative(resolvedSharedDir, resolvedServerPath);
      const clientPath = join("~/.harvest/shared", relativePath);
      logger.debug(
        { serverPath, clientPath, sharedDir: resolvedSharedDir },
        "Translated path relative to shared directory"
      );
      return clientPath;
    }

    // Return original path if no translation available
    logger.debug(
      { serverPath },
      "No translation available, returning original path"
    );
    return serverPath;
  }

  /**
   * Get the shared directory path
   */
  getSharedDirectory(): string {
    return this.sharedDirectory;
  }

  /**
   * Update the shared directory
   */
  setSharedDirectory(directory: string): void {
    this.sharedDirectory = resolve(directory);
    logger.info(
      { sharedDirectory: this.sharedDirectory },
      "Updated shared directory"
    );
  }

  /**
   * Verify if a path is accessible from client context
   */
  async verifyClientAccess(
    path: string,
    clientContext: ClientContext
  ): Promise<boolean> {
    try {
      const allowedPaths = clientContext.allowedPaths || [
        this.sharedDirectory,
        join(homedir(), ".harvest"),
        clientContext.workingDirectory || process.cwd(),
      ];

      const normalizedPath = resolve(path.replace(/^~/, homedir()));

      const isAllowed = allowedPaths.some((allowed) => {
        const resolvedAllowed = resolve(allowed.replace(/^~/, homedir()));
        return normalizedPath.startsWith(resolvedAllowed);
      });

      logger.debug(
        {
          path: normalizedPath,
          allowedPaths,
          isAllowed,
        },
        "Verified client access"
      );

      return isAllowed;
    } catch (error) {
      logger.error(
        {
          path,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Error verifying client access"
      );
      return false;
    }
  }

  /**
   * Clear all registered mappings
   */
  clearMappings(): void {
    this.serverToClientMap.clear();
    logger.debug("Cleared all path mappings");
  }

  /**
   * Get all registered mappings for debugging
   */
  getMappings(): Record<string, string> {
    return Object.fromEntries(this.serverToClientMap.entries());
  }
}

// Singleton instance for global usage
export const pathTranslator = new PathTranslator();
