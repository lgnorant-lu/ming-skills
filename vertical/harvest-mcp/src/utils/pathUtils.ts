import { access, mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createComponentLogger } from "./logger.js";

const logger = createComponentLogger("path-utils");

/**
 * Expand tilde (~) in file paths to user home directory
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace(/^~/, homedir());
  }
  return filePath;
}

/**
 * Check if a directory is writable
 */
export async function isDirectoryWritable(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, 2); // F_OK | W_OK (exists and writable)
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a directory with proper error handling and fallback
 */
export async function createSafeDirectory(
  requestedPath: string,
  fallbackPrefix = "harvest-session"
): Promise<string> {
  // Expand tilde if present
  const expandedPath = expandTilde(requestedPath);
  const resolvedPath = resolve(expandedPath);

  try {
    // Try to create the requested directory
    await mkdir(resolvedPath, { recursive: true });

    // Verify it's writable
    const isWritable = await isDirectoryWritable(resolvedPath);
    if (isWritable) {
      logger.info(`Created directory: ${resolvedPath}`);
      return resolvedPath;
    }

    logger.warn(`Directory created but not writable: ${resolvedPath}`);
  } catch (error) {
    logger.warn(`Failed to create requested directory: ${resolvedPath}`, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // Fallback to temporary directory
  const fallbackPath = join(tmpdir(), fallbackPrefix, `session-${Date.now()}`);

  try {
    await mkdir(fallbackPath, { recursive: true });

    // Verify fallback is writable
    const isWritable = await isDirectoryWritable(fallbackPath);
    if (isWritable) {
      logger.info(`Using fallback directory: ${fallbackPath}`, {
        requestedPath: resolvedPath,
      });
      return fallbackPath;
    }
  } catch (error) {
    logger.error(`Failed to create fallback directory: ${fallbackPath}`, {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  // Final fallback - use temp dir directly
  const finalFallback = tmpdir();
  logger.warn(
    `Using system temp directory as final fallback: ${finalFallback}`,
    { requestedPath: resolvedPath, fallbackPath }
  );

  return finalFallback;
}

/**
 * Get a safe output directory with proper fallbacks
 */
export async function getSafeOutputDirectory(
  requestedDir?: string,
  defaultDir?: string,
  sessionId?: string,
  clientAccessible = false
): Promise<string> {
  if (clientAccessible) {
    return handleClientAccessibleDirectory(sessionId);
  }

  // Try in order: requested dir, default dir, temp dir
  const candidates = buildDirectoryCandidates(
    requestedDir,
    defaultDir,
    sessionId
  );

  for (const { path, label } of candidates) {
    try {
      return await createSafeDirectory(path, "harvest-manual");
    } catch (error) {
      if (label !== "temp") {
        // Don't log for final fallback
        logger.warn(`${label} directory creation failed: ${path}`, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  // Final fallback should always work
  const tempPath = buildTempPath(sessionId);
  return createSafeDirectory(tempPath, "harvest-manual");
}

/**
 * Handle client-accessible directory creation with fallbacks
 */
async function handleClientAccessibleDirectory(
  sessionId?: string
): Promise<string> {
  let sharedBaseDir: string;
  try {
    const { getConfig } = await import("../config/index.js");
    const config = getConfig();
    sharedBaseDir = config.paths.sharedDir;
  } catch {
    // Fallback to environment variable or default
    sharedBaseDir =
      process.env.HARVEST_SHARED_DIR || join(homedir(), ".harvest", "shared");
  }
  const sessionPart = sessionId ? `/${sessionId}` : `/session-${Date.now()}`;
  const primaryPath = `${sharedBaseDir}${sessionPart}`;

  // Try primary path
  try {
    const result = await tryCreateClientAccessibleDirectory(
      primaryPath,
      sessionId
    );
    if (result) {
      return result;
    }
  } catch (error) {
    logger.error(
      `Failed to create client-accessible directory: ${primaryPath}`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
  }

  // Try fallback paths
  const fallbackPaths = buildClientAccessibleFallbacks(sessionId);
  const result = await tryFallbackPaths(fallbackPaths, primaryPath);

  if (result) {
    return result;
  }

  // All attempts failed
  throw new Error(
    `Cannot create client-accessible directory. All attempts failed: ${primaryPath}, ${fallbackPaths.map((p) => p.path).join(", ")}`
  );
}

/**
 * Try to create a client-accessible directory and verify it
 */
async function tryCreateClientAccessibleDirectory(
  path: string,
  sessionId?: string
): Promise<string | null> {
  const result = await createSafeDirectory(path, "harvest-shared");

  if (result.includes(".harvest") || result.includes("harvest-shared")) {
    logger.info(
      { sharedPath: result, sessionId },
      "Created client-accessible directory"
    );
    return result;
  }

  throw new Error("Created directory is not client-accessible");
}

/**
 * Build list of client-accessible fallback paths
 */
function buildClientAccessibleFallbacks(
  sessionId?: string
): Array<{ path: string; label: string }> {
  const sessionPart = sessionId || `session-${Date.now()}`;
  return [
    { path: join(homedir(), ".harvest", "temp", sessionPart), label: "temp" },
    {
      path: join(homedir(), ".harvest", "artifacts", sessionPart),
      label: "artifacts",
    },
  ];
}

/**
 * Try fallback paths for client-accessible directories
 */
async function tryFallbackPaths(
  fallbacks: Array<{ path: string; label: string }>,
  originalPath: string
): Promise<string | null> {
  for (const { path, label } of fallbacks) {
    try {
      const result = await createSafeDirectory(path, "harvest-shared");
      logger.warn(
        { fallbackPath: result, originalPath },
        `Using client-accessible ${label} fallback`
      );
      return result;
    } catch (error) {
      logger.warn(`Client-accessible ${label} fallback failed: ${path}`, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return null;
}

/**
 * Build list of directory candidates to try
 */
function buildDirectoryCandidates(
  requestedDir?: string,
  defaultDir?: string,
  sessionId?: string
): Array<{ path: string; label: string }> {
  const candidates: Array<{ path: string; label: string }> = [];

  if (requestedDir) {
    candidates.push({ path: requestedDir, label: "requested" });
  }

  if (defaultDir) {
    const datePart = new Date().toISOString().split("T")[0];
    const sessionPart = sessionId ? `/${sessionId}` : "";
    candidates.push({
      path: `${defaultDir}/${datePart}${sessionPart}`,
      label: "default",
    });
  }

  return candidates;
}

/**
 * Build temp directory path
 */
function buildTempPath(sessionId?: string): string {
  const tempDir = join(tmpdir(), "harvest-manual-sessions");
  const datePart = new Date().toISOString().split("T")[0];
  const sessionPart = sessionId ? `/${sessionId}` : `/session-${Date.now()}`;
  return `${tempDir}/${datePart}${sessionPart}`;
}
