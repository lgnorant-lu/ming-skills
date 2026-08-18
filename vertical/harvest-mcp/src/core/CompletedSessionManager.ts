/**
 * CompletedSessionManager - Manages completed analysis sessions and their artifacts
 *
 * This manager handles the lifecycle of completed analysis sessions, including:
 * - Caching session artifacts to disk for persistent access
 * - Managing artifact cleanup policies
 * - Providing efficient artifact retrieval for MCP resources
 * - Maintaining metadata about completed sessions
 */

import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../config/index.js";
import type {
  CompletedSessionArtifacts,
  CompletionAnalysis,
  HarvestSession,
} from "../types/index.js";
import { createComponentLogger } from "../utils/logger.js";

const logger = createComponentLogger("completed-session-manager");

export interface CompletedSessionMetadata {
  sessionId: string;
  prompt: string;
  completedAt: string;
  cachedAt: string;
  lastAccessed: string;
  analysisResult: {
    isComplete: boolean;
    totalNodes: number;
    codeGenerated: boolean;
  };
  artifactsAvailable: string[];
  metadata: {
    harQuality: string;
    totalRequests: number;
    hasAuthCookies: boolean;
    generatedCodeSize: number;
  };
}

export class CompletedSessionManager {
  private static instance: CompletedSessionManager;
  private readonly cacheDir: string;
  private readonly maxCacheAgeMs: number;
  // TODO: Implement cache size-based cleanup
  // private readonly maxCacheSize = 1024 * 1024 * 1024; // 1GB
  private completedSessions = new Map<string, CompletedSessionMetadata>();

  private constructor() {
    // Get cache TTL from configuration or use default
    try {
      const config = getConfig();
      this.maxCacheAgeMs =
        config.session.completedSessionCacheTTLMinutes * 60 * 1000; // Convert to milliseconds
    } catch {
      // Fallback to default (60 minutes = 1 hour)
      this.maxCacheAgeMs = 60 * 60 * 1000;
    }

    // Use a dedicated cache directory for completed sessions
    this.cacheDir = join(homedir(), ".harvest", "completed-sessions");
    this.initializeCache();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): CompletedSessionManager {
    if (!CompletedSessionManager.instance) {
      CompletedSessionManager.instance = new CompletedSessionManager();
    }
    return CompletedSessionManager.instance;
  }

  /**
   * Initialize cache directory and load existing completed sessions
   */
  private async initializeCache(): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true, mode: 0o755 });
      await this.loadCompletedSessions();
      logger.info(`Completed session cache initialized at ${this.cacheDir}`);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to initialize completed session cache"
      );
    }
  }

  /**
   * Load existing completed sessions from cache directory
   */
  private async loadCompletedSessions(): Promise<void> {
    try {
      const entries = await readdir(this.cacheDir);
      let loadedCount = 0;

      for (const entry of entries) {
        const sessionDir = join(this.cacheDir, entry);
        const metadataPath = join(sessionDir, "metadata.json");

        try {
          await access(metadataPath);
          const metadataContent = await readFile(metadataPath, "utf-8");
          const metadata: CompletedSessionMetadata =
            JSON.parse(metadataContent);

          this.completedSessions.set(entry, metadata);
          loadedCount++;
        } catch {
          // Skip invalid session directories
          logger.warn(`Skipping invalid session directory: ${entry}`);
        }
      }

      logger.info(`Loaded ${loadedCount} completed sessions from cache`);
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to load existing completed sessions"
      );
    }
  }

  /**
   * Cache a completed session and its artifacts
   */
  public async cacheCompletedSession(
    session: HarvestSession,
    analysis: CompletionAnalysis
  ): Promise<CompletedSessionArtifacts> {
    if (!analysis.isComplete) {
      throw new Error(`Cannot cache incomplete session ${session.id}`);
    }

    const sessionDir = join(this.cacheDir, session.id);
    await mkdir(sessionDir, { recursive: true, mode: 0o755 });

    const artifacts: CompletedSessionArtifacts["artifacts"] = {
      metadata: {
        filename: "metadata.json",
        path: join(sessionDir, "metadata.json"),
        size: 0, // Will be set after writing
      },
    };

    // Cache HAR file
    if (session.harData.requests.length > 0) {
      const harFilename = "original.har";
      const harPath = join(sessionDir, harFilename);

      const harData = {
        log: {
          version: "1.2",
          creator: {
            name: "harvest-mcp",
            version: "1.0.0",
          },
          entries: session.harData.requests.map((req) => ({
            startedDateTime: new Date().toISOString(),
            time: 0,
            request: {
              method: req.method,
              url: req.url,
              httpVersion: "HTTP/1.1",
              headers: Object.entries(req.headers).map(([name, value]) => ({
                name,
                value,
              })),
              queryString: Object.entries(req.queryParams || {}).map(
                ([name, value]) => ({ name, value })
              ),
              postData: req.body
                ? {
                    mimeType:
                      req.headers["content-type"] || "application/octet-stream",
                    text:
                      typeof req.body === "string"
                        ? req.body
                        : JSON.stringify(req.body),
                  }
                : undefined,
            },
            response: {
              status: 200,
              statusText: "OK",
              httpVersion: "HTTP/1.1",
              headers: [],
              content: { size: 0, mimeType: "text/html" },
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          })),
        },
      };

      await writeFile(harPath, JSON.stringify(harData, null, 2), {
        mode: 0o644,
      });
      const harStats = await stat(harPath);

      artifacts.har = {
        filename: harFilename,
        path: harPath,
        size: harStats.size,
      };
    }

    // Cache cookie file
    if (session.cookieData) {
      const cookieFilename = "original.json";
      const cookiePath = join(sessionDir, cookieFilename);

      await writeFile(cookiePath, JSON.stringify(session.cookieData, null, 2), {
        mode: 0o644,
      });
      const cookieStats = await stat(cookiePath);

      artifacts.cookies = {
        filename: cookieFilename,
        path: cookiePath,
        size: cookieStats.size,
      };
    }

    // Cache generated code
    if (session.state.generatedCode) {
      const codeFilename = "generated_code.ts";
      const codePath = join(sessionDir, codeFilename);

      await writeFile(codePath, session.state.generatedCode, { mode: 0o644 });
      const codeStats = await stat(codePath);

      artifacts.generatedCode = {
        filename: codeFilename,
        path: codePath,
        size: codeStats.size,
      };
    }

    // Create session metadata
    const metadata: CompletedSessionMetadata = {
      sessionId: session.id,
      prompt: session.prompt,
      completedAt: session.lastActivity.toISOString(),
      cachedAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      analysisResult: {
        isComplete: analysis.isComplete,
        totalNodes: analysis.diagnostics.totalNodes,
        codeGenerated: !!session.state.generatedCode,
      },
      artifactsAvailable: [
        "metadata",
        ...(artifacts.har ? ["har"] : []),
        ...(artifacts.cookies ? ["cookies"] : []),
        ...(artifacts.generatedCode ? ["generatedCode"] : []),
      ],
      metadata: {
        harQuality: session.harData.validation?.quality || "unknown",
        totalRequests: session.harData.requests.length,
        hasAuthCookies: !!session.cookieData,
        generatedCodeSize: session.state.generatedCode?.length || 0,
      },
    };

    // Write metadata file
    const metadataContent = JSON.stringify(metadata, null, 2);
    await writeFile(artifacts.metadata.path, metadataContent, { mode: 0o644 });
    const metadataStats = await stat(artifacts.metadata.path);
    artifacts.metadata.size = metadataStats.size;

    // Store in memory cache
    this.completedSessions.set(session.id, metadata);

    const completedArtifacts: CompletedSessionArtifacts = {
      sessionId: session.id,
      completedAt: session.lastActivity.toISOString(),
      prompt: session.prompt,
      artifacts,
      metadata: {
        totalNodes: analysis.diagnostics.totalNodes,
        harQuality: session.harData.validation?.quality || "unknown",
        totalRequests: session.harData.requests.length,
        hasAuthCookies: !!session.cookieData,
        generatedCodeSize: session.state.generatedCode?.length || 0,
        cachePath: sessionDir,
      },
    };

    logger.info(
      {
        sessionId: session.id,
        artifactCount: metadata.artifactsAvailable.length,
        cachePath: sessionDir,
      },
      "Cached completed session artifacts"
    );

    return completedArtifacts;
  }

  /**
   * Check if a session is cached
   */
  public isSessionCached(sessionId: string): boolean {
    return this.completedSessions.has(sessionId);
  }

  /**
   * Get metadata for a cached session
   */
  public getCachedSessionMetadata(
    sessionId: string
  ): CompletedSessionMetadata | undefined {
    const metadata = this.completedSessions.get(sessionId);
    if (metadata) {
      // Update last accessed time
      metadata.lastAccessed = new Date().toISOString();
    }
    return metadata;
  }

  /**
   * Get all cached session metadata
   */
  public getAllCachedSessions(): CompletedSessionMetadata[] {
    return Array.from(this.completedSessions.values()).sort(
      (a, b) =>
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
    );
  }

  /**
   * Read cached artifact file content
   */
  public async getCachedArtifact(
    sessionId: string,
    artifactType: "har" | "cookies" | "generatedCode" | "metadata"
  ): Promise<string> {
    const metadata = this.completedSessions.get(sessionId);
    if (!metadata) {
      throw new Error(`Cached session not found: ${sessionId}`);
    }

    const sessionDir = join(this.cacheDir, sessionId);
    let filename: string;

    switch (artifactType) {
      case "har":
        filename = "original.har";
        break;
      case "cookies":
        filename = "original.json";
        break;
      case "generatedCode":
        filename = "generated_code.ts";
        break;
      case "metadata":
        filename = "metadata.json";
        break;
      default:
        throw new Error(`Unknown artifact type: ${artifactType}`);
    }

    const filePath = join(sessionDir, filename);

    try {
      await access(filePath);
      const content = await readFile(filePath, "utf-8");

      // Update last accessed time
      metadata.lastAccessed = new Date().toISOString();

      return content;
    } catch (error) {
      throw new Error(
        `Artifact not found: ${artifactType} for session ${sessionId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Remove cached session and all its artifacts
   */
  public async removeCachedSession(sessionId: string): Promise<void> {
    const sessionDir = join(this.cacheDir, sessionId);

    try {
      // Remove all files in session directory
      const files = await readdir(sessionDir);
      for (const file of files) {
        await unlink(join(sessionDir, file));
      }

      // Remove directory
      await unlink(sessionDir);

      // Remove from memory cache
      this.completedSessions.delete(sessionId);

      logger.info({ sessionId }, "Removed cached session");
    } catch (error) {
      logger.error(
        {
          sessionId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to remove cached session"
      );
      throw error;
    }
  }

  /**
   * Clean up old cached sessions based on age and cache size
   */
  public async cleanupCache(): Promise<{
    removedSessions: number;
    freedSpace: number;
  }> {
    const now = Date.now();
    let removedSessions = 0;
    let freedSpace = 0;

    // Get all sessions sorted by last accessed (oldest first)
    const sessions = Array.from(this.completedSessions.entries()).sort(
      ([, a], [, b]) =>
        new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime()
    );

    // Remove sessions older than maxCacheAge
    for (const [sessionId, metadata] of sessions) {
      const lastAccessed = new Date(metadata.lastAccessed).getTime();
      const age = now - lastAccessed;

      if (age > this.maxCacheAgeMs) {
        try {
          const sessionDir = join(this.cacheDir, sessionId);
          const dirStats = await stat(sessionDir);

          await this.removeCachedSession(sessionId);
          removedSessions++;
          freedSpace += dirStats.size;

          logger.info(
            { sessionId, ageHours: Math.round(age / (1000 * 60 * 60)) },
            "Removed old cached session"
          );
        } catch (error) {
          logger.error(
            {
              sessionId,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            "Failed to remove old cached session"
          );
        }
      }
    }

    // TODO: Implement cache size-based cleanup if needed
    // This could remove oldest sessions when total cache size exceeds maxCacheSize

    logger.info(
      {
        removedSessions,
        freedSpaceMB: Math.round(freedSpace / (1024 * 1024)),
      },
      "Cache cleanup completed"
    );

    return { removedSessions, freedSpace };
  }

  /**
   * Get cache statistics
   */
  public async getCacheStats(): Promise<{
    totalSessions: number;
    oldestSession: string | null;
    newestSession: string | null;
    totalCacheSize: number;
    averageSessionSize: number;
  }> {
    const sessions = Array.from(this.completedSessions.values());
    let totalCacheSize = 0;

    // Calculate total cache size
    try {
      for (const sessionId of this.completedSessions.keys()) {
        const sessionDir = join(this.cacheDir, sessionId);
        const dirStats = await stat(sessionDir);
        totalCacheSize += dirStats.size;
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to calculate cache size"
      );
    }

    const sortedByCached = sessions.sort(
      (a, b) => new Date(a.cachedAt).getTime() - new Date(b.cachedAt).getTime()
    );

    return {
      totalSessions: sessions.length,
      oldestSession: sortedByCached[0]?.sessionId || null,
      newestSession:
        sortedByCached[sortedByCached.length - 1]?.sessionId || null,
      totalCacheSize,
      averageSessionSize:
        sessions.length > 0 ? Math.round(totalCacheSize / sessions.length) : 0,
    };
  }
}
