import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { AgentFactory } from "../browser/AgentFactory.js";
import { ArtifactCollector } from "../browser/ArtifactCollector.js";
import type { BrowserAgentConfig } from "../browser/types.js";
import { getConfig } from "../config/index.js";
import type {
  Artifact,
  ManualSession,
  SessionConfig,
  BrowserSessionInfo as SessionInfo,
  SessionStopResult,
} from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Custom error for when a session is still active and should not be stopped
 * This error preserves the session state and provides activity information
 */
export class SessionStillActiveError extends Error {
  public readonly sessionId: string;
  public readonly activity: {
    isActive: boolean;
    lastRequestTime: number;
    timeSinceLastRequest: number;
    formattedTimeSince: string;
    totalRequests: number;
    apiRequests: number;
    pendingRequests: number;
  };
  public readonly recommendations: string[];

  constructor(
    message: string,
    sessionId: string,
    activity: SessionStillActiveError["activity"],
    recommendations: string[]
  ) {
    super(message);
    this.name = "SessionStillActiveError";
    this.sessionId = sessionId;
    this.activity = activity;
    this.recommendations = recommendations;
  }
}

import {
  MemoryMonitor,
  type MemorySnapshot,
  type MemoryUsage,
  memoryMonitor,
} from "../utils/memoryMonitor.js";
import { getSafeOutputDirectory } from "../utils/pathUtils.js";

/**
 * Service for managing manual browser sessions with artifact collection
 * Adapted from magnitude-mcp for harvest-mcp integration
 */
export class ManualSessionManager {
  private static instance: ManualSessionManager;
  private activeSessions: Map<string, ManualSession> = new Map();
  private cleanupIntervals: Map<string, NodeJS.Timeout> = new Map();
  private defaultOutputDir: string;
  private agentFactory: AgentFactory;

  private constructor() {
    // Use temp directory as safer default for manual sessions
    this.defaultOutputDir = join(tmpdir(), "harvest-manual-sessions");

    // Initialize agent factory
    this.agentFactory = new AgentFactory();

    // Global cleanup handler for process termination
    process.on("SIGINT", () => this.cleanupAllSessions());
    process.on("SIGTERM", () => this.cleanupAllSessions());

    // Set up periodic health monitoring and cleanup
    setInterval(() => this.performPeriodicMaintenance(), 2 * 60 * 1000); // Every 2 minutes
  }

  static getInstance(): ManualSessionManager {
    if (!ManualSessionManager.instance) {
      ManualSessionManager.instance = new ManualSessionManager();
    }
    return ManualSessionManager.instance;
  }

  /**
   * Get browser options with centralized configuration fallback
   */
  private getBrowserOptions(config: SessionConfig) {
    try {
      const centralConfig = getConfig();
      return {
        headless:
          config.browserOptions?.headless ??
          centralConfig.manualSession.browser.headless,
        viewport: {
          width:
            config.browserOptions?.viewport?.width ??
            centralConfig.manualSession.browser.viewport.width,
          height:
            config.browserOptions?.viewport?.height ??
            centralConfig.manualSession.browser.viewport.height,
        },
        contextOptions: {
          deviceScaleFactor:
            config.browserOptions?.contextOptions?.deviceScaleFactor ??
            centralConfig.manualSession.browser.contextOptions
              .deviceScaleFactor,
          hasTouch:
            config.browserOptions?.contextOptions?.hasTouch ??
            centralConfig.manualSession.browser.contextOptions.hasTouch,
          isMobile:
            config.browserOptions?.contextOptions?.isMobile ??
            centralConfig.manualSession.browser.contextOptions.isMobile,
          locale:
            config.browserOptions?.contextOptions?.locale ??
            centralConfig.manualSession.browser.contextOptions.locale,
          timezone:
            config.browserOptions?.contextOptions?.timezone ??
            centralConfig.manualSession.browser.contextOptions.timezone,
        },
        timeout:
          config.browserOptions?.timeout ??
          centralConfig.manualSession.browser.timeout,
        navigationTimeout:
          config.browserOptions?.navigationTimeout ??
          centralConfig.manualSession.browser.navigationTimeout,
        slowMo:
          config.browserOptions?.slowMo ??
          centralConfig.manualSession.browser.slowMo,
      };
    } catch {
      // Fallback to hardcoded defaults if config not available
      return {
        headless: config.browserOptions?.headless ?? false,
        viewport: {
          width: config.browserOptions?.viewport?.width ?? 1280,
          height: config.browserOptions?.viewport?.height ?? 720,
        },
        contextOptions: {
          deviceScaleFactor:
            config.browserOptions?.contextOptions?.deviceScaleFactor ?? 1,
          hasTouch: config.browserOptions?.contextOptions?.hasTouch ?? false,
          isMobile: config.browserOptions?.contextOptions?.isMobile ?? false,
          locale: config.browserOptions?.contextOptions?.locale ?? "en-US",
          timezone: config.browserOptions?.contextOptions?.timezone ?? "UTC",
        },
        timeout: config.browserOptions?.timeout ?? 30000,
        navigationTimeout: config.browserOptions?.navigationTimeout ?? 60000,
        slowMo: config.browserOptions?.slowMo ?? 0,
      };
    }
  }

  /**
   * Start a new manual browser session
   */
  async startSession(config: SessionConfig = {}): Promise<SessionInfo> {
    const sessionId = randomUUID();
    const startTime = Date.now();

    logger.info(`[ManualSessionManager] Starting manual session: ${sessionId}`);

    // Take memory snapshot before session start
    const preStartSnapshot = memoryMonitor.takeSnapshot(
      sessionId,
      "session_start_begin"
    );
    logger.info(
      `[ManualSessionManager] Memory before session start: ${MemoryMonitor.formatMemorySize(preStartSnapshot.usage.heapUsed)}`
    );

    try {
      // Create safe output directory with proper fallbacks and client accessibility
      const outputDir = await getSafeOutputDirectory(
        config.artifactConfig?.outputDir,
        this.defaultOutputDir,
        sessionId,
        true // Enable client accessibility
      );

      // Create browser agent with manual-friendly defaults (no URL navigation yet)
      const agentConfig: BrowserAgentConfig = {
        // Don't include URL here - we'll navigate after setting up network tracking
        browserOptions: this.getBrowserOptions(config),
      };

      const { page, context, browser } =
        await this.agentFactory.createBrowserSession(agentConfig);

      // Create artifact collector instance for this session with client accessibility
      const artifactCollector = new ArtifactCollector(true);

      // Start network tracking for HAR collection if enabled
      if (config.artifactConfig?.enabled !== false) {
        logger.info(
          `[ManualSessionManager] Starting network tracking for session: ${sessionId}`
        );

        // Set up callback to update session metadata with network request count
        artifactCollector.setNetworkRequestCallback((count: number) => {
          const session = this.activeSessions.get(sessionId);
          if (session) {
            session.metadata.networkRequestCount = count;
            logger.debug(
              `[ManualSessionManager] Updated network request count for session ${sessionId}: ${count}`
            );
          }
        });

        artifactCollector.startNetworkTracking(page);
      }

      // Set up navigation event monitoring
      this.setupNavigationEventMonitoring(page, sessionId);

      // Navigate to URL after network tracking is set up (if provided)
      let currentUrl: string;
      let pageTitle = "Unknown";

      if (config.url) {
        logger.info(
          `[ManualSessionManager] Navigating to URL after setting up tracking: ${config.url}`
        );
        await page.goto(config.url, { waitUntil: "networkidle" });
        currentUrl = this.safeGetPageUrl(page);
        pageTitle = await this.safeGetPageTitle(page);
      } else {
        // Get current page state if no navigation needed
        currentUrl = page.url();
        pageTitle = await this.safeGetPageTitle(page);
      }

      // Create session object
      const session: ManualSession = {
        id: sessionId,
        page,
        context,
        browser,
        startTime,
        config,
        outputDir,
        artifacts: [],
        artifactCollector, // Store collector instance with session
        metadata: {
          currentUrl,
          pageTitle,
          networkRequestCount: 0,
        },
      };

      this.activeSessions.set(sessionId, session);

      // Set up auto-cleanup timeout if specified
      if (config.timeout && config.timeout > 0) {
        const timeoutMs = config.timeout * 60 * 1000; // Convert minutes to milliseconds
        const timeoutId = setTimeout(() => {
          logger.warn(
            `[ManualSessionManager] Auto-cleanup timeout reached for session: ${sessionId}`
          );
          this.stopSession(sessionId, { reason: "timeout" });
        }, timeoutMs);
        this.cleanupIntervals.set(sessionId, timeoutId);
      }

      // Set up auto-screenshot interval if configured
      if (
        config.artifactConfig?.autoScreenshotInterval &&
        config.artifactConfig?.autoScreenshotInterval > 0
      ) {
        const screenshotInterval = setInterval(async () => {
          try {
            // Check if session and browser are still alive before screenshot
            const session = this.activeSessions.get(sessionId);
            if (!session) {
              logger.debug(
                `[ManualSessionManager] Session ${sessionId} no longer exists, clearing screenshot interval`
              );
              this.clearScreenshotInterval(sessionId);
              return;
            }

            const isHealthy = await this.checkPageHealth(session);
            if (!isHealthy) {
              logger.debug(
                `[ManualSessionManager] Browser not healthy for session ${sessionId}, skipping screenshot`
              );
              return;
            }

            await this.takeSessionScreenshot(sessionId);
          } catch (error) {
            // Check if this is a browser closure error
            if (
              error instanceof Error &&
              (error.message.includes(
                "Target page, context or browser has been closed"
              ) ||
                error.message.includes("Execution context was destroyed") ||
                error.message.includes("TargetClosedError"))
            ) {
              logger.info(
                `[ManualSessionManager] Browser closed for session ${sessionId}, stopping auto-screenshots`
              );
              this.clearScreenshotInterval(sessionId);
              return;
            }

            logger.error(
              `[ManualSessionManager] Auto-screenshot failed for session ${sessionId}:`,
              error
            );
          }
        }, config.artifactConfig.autoScreenshotInterval * 1000);

        // Store interval for cleanup (reuse cleanupIntervals map with a prefix)
        this.cleanupIntervals.set(
          `screenshot_${sessionId}`,
          screenshotInterval
        );
      }

      logger.info(
        `[ManualSessionManager] Manual session started successfully: ${sessionId}`
      );

      // Take memory snapshot after session creation
      const postStartSnapshot = memoryMonitor.takeSnapshot(
        sessionId,
        "session_start_complete"
      );
      const memoryGrowth =
        postStartSnapshot.usage.heapUsed - preStartSnapshot.usage.heapUsed;
      logger.info(
        `[ManualSessionManager] Memory after session start: ${MemoryMonitor.formatMemorySize(postStartSnapshot.usage.heapUsed)} (growth: ${MemoryMonitor.formatMemorySize(memoryGrowth)})`
      );

      return {
        id: sessionId,
        startTime,
        currentUrl,
        pageTitle,
        duration: 0,
        outputDir,
        artifactConfig: config.artifactConfig,
        instructions: this.generateSessionInstructions(sessionId, config),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[ManualSessionManager] Failed to start session: ${errorMessage}`
      );
      throw new Error(`Failed to start manual session: ${errorMessage}`);
    }
  }

  /**
   * Get final page state safely
   */
  private async getFinalPageState(
    session: ManualSession,
    sessionId: string
  ): Promise<{
    finalUrl: string;
    finalPageTitle: string;
  }> {
    let finalUrl = "Unknown";
    let finalPageTitle = "Unknown";

    try {
      finalUrl = this.safeGetPageUrl(session.page);
      finalPageTitle = await this.safeGetPageTitle(session.page);
    } catch (error) {
      logger.warn(
        `[ManualSessionManager] Could not get final page state for ${sessionId}: ${error}`
      );
    }

    return { finalUrl, finalPageTitle };
  }

  /**
   * Handle final screenshot if requested
   */
  private async handleFinalScreenshot(
    sessionId: string,
    session: ManualSession,
    options: { takeScreenshot?: boolean }
  ): Promise<void> {
    if (
      options.takeScreenshot !== false &&
      (options.takeScreenshot === true ||
        session.config.artifactConfig?.saveScreenshots !== false)
    ) {
      try {
        // Clear screenshot interval before taking final screenshot to prevent conflicts
        this.clearScreenshotInterval(sessionId);

        await this.takeSessionScreenshot(sessionId);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes(
            "Target page, context or browser has been closed"
          ) ||
            error.message.includes("Execution context was destroyed") ||
            error.message.includes("TargetClosedError") ||
            error.message.includes("Page is closed") ||
            error.message.includes("Browser is disconnected"))
        ) {
          logger.info(
            `[ManualSessionManager] Cannot take final screenshot for ${sessionId}: browser already closed`
          );
        } else {
          logger.warn(
            `[ManualSessionManager] Failed to take final screenshot for ${sessionId}: ${error}`
          );
        }
      }
    } else {
      // Still clear the interval even if not taking final screenshot
      this.clearScreenshotInterval(sessionId);
    }
  }

  /**
   * Collect artifacts for live session with retry logic
   */
  private async collectLiveSessionArtifacts(
    session: ManualSession,
    sessionId: string,
    options: { artifactTypes?: ("har" | "cookies" | "screenshot")[] }
  ): Promise<Artifact[]> {
    let artifacts: Artifact[] = [];

    if (session.config.artifactConfig?.enabled !== false) {
      logger.info(
        `[ManualSessionManager] Collecting artifacts for session: ${sessionId} (network requests: ${session.metadata.networkRequestCount || 0})`
      );

      const maxRetries = 2;
      let attempt = 0;

      while (attempt <= maxRetries) {
        try {
          // Check HAR quality before stopping tracking
          const harQuality = session.artifactCollector.getCurrentQuality();
          const harCount = session.artifactCollector.getHarEntryCount();
          const apiCount = session.artifactCollector.getApiRequestCount();
          const pendingCount =
            session.artifactCollector.getPendingRequestCount();

          logger.info(
            `[ManualSessionManager] Pre-stop HAR validation for session ${sessionId}: ` +
              `quality=${harQuality}, entries=${harCount}, api=${apiCount}, pending=${pendingCount}`
          );

          // Pre-stop validation to prevent empty HAR files
          if (harQuality === "empty" || harCount === 0) {
            logger.warn(
              `[ManualSessionManager] Session ${sessionId} has no meaningful network activity. ` +
                `HAR quality: ${harQuality}, entries: ${harCount}. ` +
                "Consider interacting more with the application before stopping."
            );

            // Still stop tracking but use permissive config for HAR generation
            if (session.artifactCollector.isTrackingNetwork()) {
              session.artifactCollector.stopNetworkTracking();
            }

            // Use permissive HAR config for minimal sessions
            const permissiveHarConfig = {
              minEntries: 0,
              minApiRequests: 0,
              waitForPendingMs: 1000,
              qualityThreshold: "poor" as const,
            };

            const artifactCollection =
              await session.artifactCollector.collectAllArtifacts(
                session.page,
                session.context,
                session.outputDir,
                permissiveHarConfig
              );
            artifacts = artifactCollection.artifacts;
          } else {
            // Stop network tracking before collection
            if (session.artifactCollector.isTrackingNetwork()) {
              session.artifactCollector.stopNetworkTracking();
              logger.debug(
                "[ManualSessionManager] Stopped network tracking for artifact collection"
              );
            }

            // Use quality-enforcing HAR config for sessions with good data
            const qualityHarConfig = {
              minEntries: Math.max(1, harCount),
              minApiRequests: Math.max(0, apiCount),
              waitForPendingMs: pendingCount > 0 ? 3000 : 1000,
              qualityThreshold: harQuality as "good" | "excellent",
            };

            const artifactCollection =
              await session.artifactCollector.collectAllArtifacts(
                session.page,
                session.context,
                session.outputDir,
                qualityHarConfig
              );
            artifacts = artifactCollection.artifacts;
          }

          // Add MCP URIs to artifacts for resource access
          artifacts = artifacts.map((artifact) => ({
            ...artifact,
            mcpUri: this.generateMcpUriForArtifact(sessionId, artifact),
          }));

          // Filter artifacts by type if specified
          if (options.artifactTypes && options.artifactTypes.length > 0) {
            artifacts = artifacts.filter((artifact) =>
              options.artifactTypes?.includes(
                artifact.type as "har" | "cookies" | "screenshot"
              )
            );
          }

          logger.info(
            `[ManualSessionManager] Successfully collected ${artifacts.length} artifacts for session: ${sessionId}`
          );
          break; // Success, exit retry loop
        } catch (error) {
          attempt++;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (attempt > maxRetries) {
            logger.error(
              `[ManualSessionManager] Failed to collect artifacts for ${sessionId} after ${maxRetries + 1} attempts: ${errorMessage}`
            );
          } else {
            logger.warn(
              `[ManualSessionManager] Artifact collection attempt ${attempt} failed for ${sessionId}: ${errorMessage}. Retrying...`
            );
            // Wait a bit before retrying
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
    }

    return artifacts;
  }

  /**
   * Collect artifacts for closed session
   */
  private async collectClosedSessionArtifacts(
    session: ManualSession,
    sessionId: string
  ): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];

    if (session.config.artifactConfig?.enabled !== false) {
      try {
        const harEntryCount = session.artifactCollector.getHarEntryCount();
        logger.info(
          `[ManualSessionManager] Session ${sessionId} had ${harEntryCount} HAR entries before closure, attempting to generate artifacts from captured data`
        );

        // Try to generate HAR file from captured entries even if browser is closed
        if (harEntryCount > 0) {
          try {
            const apiCount = session.artifactCollector.getApiRequestCount();
            const quality = session.artifactCollector.getCurrentQuality();

            logger.info(
              `[ManualSessionManager] Generating HAR for closed session ${sessionId}: ` +
                `entries=${harEntryCount}, api=${apiCount}, quality=${quality}`
            );

            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const harPath = join(session.outputDir, `network-${timestamp}.har`);

            // Use permissive config for closed sessions to maximize recovery
            const closedSessionConfig = {
              minEntries: 0,
              minApiRequests: 0,
              waitForPendingMs: 0, // No waiting for closed sessions
              qualityThreshold: "poor" as const,
            };

            const harArtifact = await session.artifactCollector.generateHarFile(
              harPath,
              closedSessionConfig
            );
            // Add MCP URI for the artifact
            harArtifact.mcpUri = this.generateMcpUriForArtifact(
              sessionId,
              harArtifact
            );
            artifacts.push(harArtifact);

            logger.info(
              `[ManualSessionManager] Successfully generated HAR file for closed session ${sessionId} with ${harEntryCount} entries`
            );
          } catch (harError) {
            logger.warn(
              `[ManualSessionManager] Failed to generate HAR file for closed session ${sessionId}: ${harError}`
            );
          }
        } else {
          logger.info(
            `[ManualSessionManager] No HAR entries captured for closed session ${sessionId}, skipping HAR generation`
          );
        }

        // Include any artifacts that were already collected during the session
        if (session.artifacts && session.artifacts.length > 0) {
          // Add MCP URIs to existing artifacts if they don't have them
          const artifactsWithUris = session.artifacts.map((artifact) => ({
            ...artifact,
            mcpUri:
              artifact.mcpUri ||
              this.generateMcpUriForArtifact(sessionId, artifact),
          }));
          artifacts.push(...artifactsWithUris);
        }
      } catch (error) {
        logger.warn(
          `[ManualSessionManager] Could not access session artifacts: ${error}`
        );
      }
    }

    return artifacts;
  }

  /**
   * Perform session cleanup and memory monitoring
   */
  private async performSessionCleanup(
    session: ManualSession,
    sessionId: string,
    duration: number,
    _artifacts: Artifact[],
    preStopSnapshot: MemorySnapshot
  ): Promise<void> {
    // Update session metadata
    session.metadata.sessionDuration = duration;

    // Clean up browser session gracefully
    await this.gracefulBrowserCleanup(
      session.page,
      session.context,
      session.browser,
      sessionId
    );

    // Clean up timers
    this.cleanupSessionTimers(sessionId);

    // Remove from active sessions
    this.activeSessions.delete(sessionId);

    // Take memory snapshot after cleanup
    const postStopSnapshot = memoryMonitor.takeSnapshot(
      sessionId,
      "session_stop_complete"
    );
    const memoryReclaimed =
      preStopSnapshot.usage.heapUsed - postStopSnapshot.usage.heapUsed;
    logger.info(
      `[ManualSessionManager] Memory after session stop: ${MemoryMonitor.formatMemorySize(postStopSnapshot.usage.heapUsed)} (reclaimed: ${MemoryMonitor.formatMemorySize(memoryReclaimed)})`
    );

    // Check for memory leaks
    const leakDetection = memoryMonitor.detectMemoryLeaks();
    if (leakDetection.isLeaking) {
      logger.warn(
        `[ManualSessionManager] Potential memory leak detected: ${leakDetection.recommendation}`
      );
    }
  }

  /**
   * Stop a manual browser session and collect artifacts
   */
  async stopSession(
    sessionId: string,
    options: {
      artifactTypes?: ("har" | "cookies" | "screenshot")[];
      takeScreenshot?: boolean;
      reason?: string;
    } = {}
  ): Promise<SessionStopResult> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const stopTime = Date.now();
    const duration = stopTime - session.startTime;

    logger.info(
      `[ManualSessionManager] Stopping session: ${sessionId} (duration: ${Math.round(duration / 1000)}s, reason: ${options.reason || "manual"})`
    );

    // Take memory snapshot before cleanup
    const preStopSnapshot = memoryMonitor.takeSnapshot(
      sessionId,
      "session_stop_begin"
    );
    logger.info(
      `[ManualSessionManager] Memory before session stop: ${MemoryMonitor.formatMemorySize(preStopSnapshot.usage.heapUsed)}`
    );

    try {
      // Check if browser/page is still alive before proceeding
      const isPageAlive = await this.checkPageHealth(session);

      // Check for recent user activity - protect ongoing user work
      if (isPageAlive && session.artifactCollector) {
        const activityStatus =
          session.artifactCollector.getNetworkActivityStatus();
        const timeSinceLastRequest = activityStatus.timeSinceLastRequest;

        // Define activity thresholds
        const ACTIVE_THRESHOLD = 30 * 1000; // 30 seconds
        const RECENT_ACTIVITY_THRESHOLD = 2 * 60 * 1000; // 2 minutes

        if (timeSinceLastRequest < ACTIVE_THRESHOLD) {
          // User is actively interacting - throw custom error that preserves session
          throw new SessionStillActiveError(
            "Session appears to be in active use",
            sessionId,
            {
              isActive: true,
              lastRequestTime: activityStatus.lastRequestTime,
              timeSinceLastRequest,
              formattedTimeSince: this.formatDuration(timeSinceLastRequest),
              totalRequests: activityStatus.harEntryCount,
              apiRequests: activityStatus.apiRequestCount,
              pendingRequests: activityStatus.pendingRequestCount,
            },
            [
              "DO NOT stop this session - user is actively using the browser",
              "Respect user's current work and wait for natural completion",
              "Check session activity status again after user finishes current task",
            ]
          );
        }
        if (timeSinceLastRequest < RECENT_ACTIVITY_THRESHOLD) {
          // Recent activity - provide warning but allow stop
          logger.warn(
            `[ManualSessionManager] Recent activity detected for session ${sessionId}. ` +
              `Last request: ${this.formatDuration(timeSinceLastRequest)} ago. Proceeding with stop.`
          );
        }
      }
      let finalUrl = "Unknown";
      let finalPageTitle = "Unknown";
      let artifacts: Artifact[] = [];

      if (isPageAlive) {
        // Get final page state safely
        const pageState = await this.getFinalPageState(session, sessionId);
        finalUrl = pageState.finalUrl;
        finalPageTitle = pageState.finalPageTitle;

        // Take final screenshot if requested
        await this.handleFinalScreenshot(sessionId, session, options);

        // Collect artifacts for live session
        artifacts = await this.collectLiveSessionArtifacts(
          session,
          sessionId,
          options
        );
      } else {
        logger.warn(
          `[ManualSessionManager] Browser/page already closed for session ${sessionId}, skipping state collection`
        );

        // Collect artifacts for closed session
        artifacts = await this.collectClosedSessionArtifacts(
          session,
          sessionId
        );
      }

      // Update session metadata with final state
      session.metadata.currentUrl = finalUrl;
      session.metadata.pageTitle = finalPageTitle;

      // Generate session summary
      const summary = this.generateSessionSummary(session, duration, artifacts);

      // Perform cleanup and memory monitoring
      await this.performSessionCleanup(
        session,
        sessionId,
        duration,
        artifacts,
        preStopSnapshot
      );

      logger.info(
        `[ManualSessionManager] Session stopped successfully: ${sessionId}`
      );

      return {
        id: sessionId,
        duration,
        finalUrl,
        finalPageTitle,
        artifacts,
        summary,
        metadata: {
          networkRequestCount: session.metadata.networkRequestCount || 0,
          totalArtifacts: artifacts.length,
          sessionDurationMs: duration,
        },
      };
    } catch (error) {
      // Check if this is a SessionStillActiveError - if so, don't clean up the session
      if (error instanceof SessionStillActiveError) {
        logger.info(
          `[ManualSessionManager] Session ${sessionId} is still active, preserving session state`
        );
        throw error; // Re-throw without cleanup to preserve session
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[ManualSessionManager] Error stopping session ${sessionId}: ${errorMessage}`
      );

      // Only perform emergency cleanup for actual failures, not activity detection
      await this.emergencySessionCleanup(session, sessionId);

      throw new Error(`Failed to stop session: ${errorMessage}`);
    }
  }

  /**
   * Get information about an active session with health check
   */
  getSessionInfo(sessionId: string): SessionInfo | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    const duration = Date.now() - session.startTime;

    return {
      id: sessionId,
      startTime: session.startTime,
      currentUrl: session.metadata.currentUrl || "",
      pageTitle: session.metadata.pageTitle || "",
      duration,
      outputDir: session.outputDir,
      artifactConfig: session.config.artifactConfig,
      instructions: this.generateSessionInstructions(sessionId, session.config),
    };
  }

  /**
   * Get real-time network activity status for a session
   */
  getSessionNetworkActivity(sessionId: string): {
    exists: boolean;
    activity?: ReturnType<
      typeof import("../browser/ArtifactCollector.js")["ArtifactCollector"]["prototype"]["getNetworkActivityStatus"]
    >;
    summary?: ReturnType<
      typeof import("../browser/ArtifactCollector.js")["ArtifactCollector"]["prototype"]["getNetworkActivitySummary"]
    >;
  } {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return { exists: false };
    }

    return {
      exists: true,
      activity: session.artifactCollector?.getNetworkActivityStatus(),
      summary: session.artifactCollector?.getNetworkActivitySummary(),
    };
  }

  /**
   * Perform health check on a session with enhanced network monitoring
   */
  async checkSessionHealth(sessionId: string): Promise<{
    isHealthy: boolean;
    issues: string[];
    recommendations: string[];
    metrics: {
      duration: number;
      memoryUsage?: number;
      pageResponsive: boolean;
      browserConnected: boolean;
      networkRequestCount: number;
      networkTrackingActive: boolean;
    };
    networkActivity?: ReturnType<
      typeof import("../browser/ArtifactCollector.js")["ArtifactCollector"]["prototype"]["getNetworkActivityStatus"]
    >;
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        isHealthy: false,
        issues: ["Session not found"],
        recommendations: [
          "Check if session ID is correct or if session was already stopped",
        ],
        metrics: {
          duration: 0,
          pageResponsive: false,
          browserConnected: false,
          networkRequestCount: 0,
          networkTrackingActive: false,
        },
      };
    }

    const issues: string[] = [];
    const recommendations: string[] = [];
    const duration = Date.now() - session.startTime;

    // Check if browser/page is responsive
    const pageResponsive = await this.checkPageHealth(session);
    if (!pageResponsive) {
      issues.push("Browser page is not responsive");
      recommendations.push(
        "Consider restarting the session if browser was closed manually"
      );
    }

    // Check browser connection
    let browserConnected = false;
    try {
      browserConnected = session.browser?.isConnected() ?? false;
    } catch (_error) {
      issues.push("Cannot determine browser connection status");
    }

    if (!browserConnected) {
      issues.push("Browser is disconnected");
      recommendations.push("Browser may have crashed or been closed manually");
    }

    // Check session duration
    const maxDuration = (session.config.timeout || 60) * 60 * 1000; // Convert to ms
    if (session.config.timeout && duration > maxDuration) {
      issues.push("Session has exceeded configured timeout");
      recommendations.push("Session will be auto-cleaned up soon");
    }

    // Check network tracking status
    const networkTrackingActive =
      session.artifactCollector?.isTrackingNetwork() || false;
    const networkRequestCount = session.metadata.networkRequestCount || 0;

    if (
      !networkTrackingActive &&
      session.config.artifactConfig?.enabled !== false
    ) {
      issues.push("Network tracking is not active despite being enabled");
      recommendations.push(
        "Network requests may not be captured for HAR generation"
      );
    }

    // Get real-time network activity status
    let networkActivity:
      | ReturnType<
          typeof import("../browser/ArtifactCollector.js")["ArtifactCollector"]["prototype"]["getNetworkActivityStatus"]
        >
      | undefined;
    if (session.artifactCollector) {
      networkActivity = session.artifactCollector.getNetworkActivityStatus();

      // Add network-specific recommendations
      recommendations.push(...networkActivity.recommendations);

      // Additional network-based health checks
      if (networkActivity.quality === "empty" && duration > 60000) {
        issues.push("No meaningful network activity after 1+ minutes");
        recommendations.push(
          "Try interacting more with the application to generate requests"
        );
      }

      if (networkActivity.pendingRequestCount > 10) {
        issues.push("Too many pending requests - possible network issues");
        recommendations.push(
          "Check network connectivity or wait for requests to complete"
        );
      }
    }

    if (networkRequestCount === 0 && duration > 30000) {
      // Session running for more than 30 seconds
      recommendations.push(
        "No network requests captured yet - ensure you're interacting with the page"
      );
    }

    // Check memory usage if available
    let memoryUsage: number | undefined;
    try {
      const memoryStats = this.getSessionMemoryUsage(sessionId);
      if (memoryStats && memoryStats.length > 0) {
        const lastSnapshot = memoryStats[memoryStats.length - 1];
        if (lastSnapshot) {
          memoryUsage = lastSnapshot.usage.heapUsed;
        }

        // Check for excessive memory usage (>500MB)
        if (memoryUsage && memoryUsage > 500 * 1024 * 1024) {
          issues.push("High memory usage detected");
          recommendations.push(
            "Consider stopping and restarting the session to free memory"
          );
        }
      }
    } catch (_error) {
      // Memory monitoring is optional
    }

    const isHealthy = issues.length === 0;

    return {
      isHealthy,
      issues,
      recommendations,
      metrics: {
        duration,
        ...(memoryUsage !== undefined && { memoryUsage }),
        pageResponsive,
        browserConnected,
        networkRequestCount: session.metadata.networkRequestCount || 0,
        networkTrackingActive:
          session.artifactCollector?.isTrackingNetwork() || false,
      },
      ...(networkActivity && { networkActivity }),
    };
  }

  /**
   * Attempt to recover an unhealthy session
   */
  async recoverSession(sessionId: string): Promise<{
    success: boolean;
    actions: string[];
    newIssues: string[];
  }> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        actions: [],
        newIssues: ["Session not found"],
      };
    }

    const actions: string[] = [];
    const newIssues: string[] = [];

    logger.info(
      `[ManualSessionManager] Attempting to recover session: ${sessionId}`
    );

    try {
      // Check current health
      const healthCheck = await this.checkSessionHealth(sessionId);

      if (healthCheck.isHealthy) {
        return {
          success: true,
          actions: ["Session is already healthy"],
          newIssues: [],
        };
      }

      // Try to refresh the page if it's unresponsive
      if (
        !healthCheck.metrics.pageResponsive &&
        healthCheck.metrics.browserConnected
      ) {
        try {
          await session.page.reload({
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
          actions.push("Refreshed unresponsive page");

          // Update metadata
          session.metadata.currentUrl = this.safeGetPageUrl(session.page);
          session.metadata.pageTitle = await this.safeGetPageTitle(
            session.page
          );
        } catch (error) {
          newIssues.push(`Failed to refresh page: ${error}`);
        }
      }

      // Force garbage collection if memory usage is high
      if (
        healthCheck.metrics.memoryUsage &&
        healthCheck.metrics.memoryUsage > 300 * 1024 * 1024
      ) {
        try {
          this.performCleanup();
          actions.push("Performed memory cleanup");
        } catch (error) {
          newIssues.push(`Memory cleanup failed: ${error}`);
        }
      }

      // If browser is disconnected, we can't recover - suggest restart
      if (!healthCheck.metrics.browserConnected) {
        newIssues.push("Browser disconnected - session needs to be restarted");
        return {
          success: false,
          actions,
          newIssues,
        };
      }

      // Verify recovery
      const postRecoveryHealth = await this.checkSessionHealth(sessionId);
      const success =
        postRecoveryHealth.issues.length < healthCheck.issues.length;

      if (!success) {
        newIssues.push(...postRecoveryHealth.issues);
      }

      logger.info(
        `[ManualSessionManager] Recovery attempt for ${sessionId}: ${success ? "successful" : "failed"}`
      );

      return {
        success,
        actions,
        newIssues,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        `[ManualSessionManager] Recovery failed for ${sessionId}: ${errorMessage}`
      );

      return {
        success: false,
        actions,
        newIssues: [`Recovery process failed: ${errorMessage}`],
      };
    }
  }

  /**
   * List all active sessions
   */
  listActiveSessions(): SessionInfo[] {
    return Array.from(this.activeSessions.values()).map((session) => {
      const duration = Date.now() - session.startTime;
      return {
        id: session.id,
        startTime: session.startTime,
        currentUrl: session.metadata.currentUrl || "",
        pageTitle: session.metadata.pageTitle || "",
        duration,
        outputDir: session.outputDir,
        artifactConfig: session.config.artifactConfig,
        instructions: [],
      };
    });
  }

  /**
   * Clear screenshot interval for a session
   */
  private clearScreenshotInterval(sessionId: string): void {
    const screenshotIntervalId = this.cleanupIntervals.get(
      `screenshot_${sessionId}`
    );
    if (screenshotIntervalId) {
      clearInterval(screenshotIntervalId);
      this.cleanupIntervals.delete(`screenshot_${sessionId}`);
      logger.debug(
        `[ManualSessionManager] Cleared screenshot interval for session ${sessionId}`
      );
    }
  }

  /**
   * Take a screenshot for an active session
   */
  private async takeSessionScreenshot(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Additional checks before attempting screenshot
    if (!session.page || session.page.isClosed()) {
      throw new Error(`Page is closed for session ${sessionId}`);
    }

    if (!session.browser?.isConnected()) {
      throw new Error(`Browser is disconnected for session ${sessionId}`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = join(
      session.outputDir,
      `manual-screenshot-${timestamp}.png`
    );

    const artifact = await session.artifactCollector.captureScreenshot(
      session.page,
      screenshotPath
    );

    // Add MCP URI for the artifact
    artifact.mcpUri = this.generateMcpUriForArtifact(sessionId, artifact);
    session.artifacts.push(artifact);
    logger.info(
      `[ManualSessionManager] Screenshot taken for session ${sessionId}: ${artifact.path}`
    );
  }

  /**
   * Generate helpful instructions for manual interaction
   */
  private generateSessionInstructions(
    sessionId: string,
    config: SessionConfig
  ): string[] {
    const instructions = [
      "🎯 Manual Browser Session Started",
      "",
      `Session ID: ${sessionId}`,
      "A browser window should now be open for manual interaction.",
      "",
      "📋 What you can do:",
      "- Navigate to any website by typing URLs in the address bar",
      "- Interact with web pages manually (click, type, scroll, etc.)",
      "- Use browser developer tools if needed",
      "",
      "📊 Artifact Collection:",
    ];

    if (config.artifactConfig?.enabled !== false) {
      instructions.push("- ✅ Network traffic is being recorded (HAR file)");
      if (config.artifactConfig?.saveCookies !== false) {
        instructions.push("- 🍪 Cookies will be captured");
      }
      if (config.artifactConfig?.saveScreenshots !== false) {
        instructions.push("- 📸 Screenshots will be taken");
      }
      if (config.artifactConfig?.autoScreenshotInterval) {
        instructions.push(
          `- 📸 Auto-screenshots every ${config.artifactConfig.autoScreenshotInterval}s`
        );
      }
    } else {
      instructions.push("- ❌ Artifact collection is disabled");
    }

    instructions.push("");

    if (config.timeout) {
      instructions.push(`⏰ Auto-cleanup in ${config.timeout} minutes`);
    } else {
      instructions.push(
        "⏰ No auto-cleanup timeout (remember to stop the session)"
      );
    }

    instructions.push("");
    instructions.push(
      "🛑 AGENT INSTRUCTION: Only use session_stop_manual when:"
    );
    instructions.push("- User explicitly states they are finished");
    instructions.push("- User indicates their work is complete");
    instructions.push("- User asks to stop or end the session");
    instructions.push(
      "- Do NOT stop based on assumptions or workflow completion"
    );

    return instructions;
  }

  /**
   * Generate session summary
   */
  private generateSessionSummary(
    session: ManualSession,
    duration: number,
    artifacts: Artifact[]
  ): string {
    const durationSec = Math.round(duration / 1000);
    const durationMin = Math.round(duration / 60000);

    let summary = "Manual browser session completed:\n\n";
    summary += `Duration: ${durationMin > 0 ? `${durationMin}m ` : ""}${durationSec % 60}s\n`;
    summary += `Final URL: ${session.metadata.currentUrl || "Unknown"}\n`;
    summary += `Final Page: ${session.metadata.pageTitle || "Unknown"}\n`;
    summary += `Artifacts Collected: ${artifacts.length}\n\n`;

    if (artifacts.length > 0) {
      summary += "Artifact breakdown:\n";
      const harFiles = artifacts.filter((a) => a.type === "har");
      const cookieFiles = artifacts.filter((a) => a.type === "cookies");
      const screenshots = artifacts.filter((a) => a.type === "screenshot");

      if (harFiles.length > 0) {
        summary += `- HAR files: ${harFiles.length}\n`;
      }
      if (cookieFiles.length > 0) {
        summary += `- Cookie files: ${cookieFiles.length}\n`;
      }
      if (screenshots.length > 0) {
        summary += `- Screenshots: ${screenshots.length}\n`;
      }

      summary += `\nArtifacts saved to: ${session.outputDir}`;
    }

    return summary;
  }

  /**
   * Clean up timers for a session
   */
  private cleanupSessionTimers(sessionId: string): void {
    // Clean up timeout timer
    const timeoutId = this.cleanupIntervals.get(sessionId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.cleanupIntervals.delete(sessionId);
      logger.debug(
        `[ManualSessionManager] Cleared timeout timer for session ${sessionId}`
      );
    }

    // Clean up screenshot interval (use the dedicated method)
    this.clearScreenshotInterval(sessionId);
  }

  /**
   * Clean up all active sessions (called on process exit)
   */
  private async cleanupAllSessions(): Promise<void> {
    logger.info(
      `[ManualSessionManager] Cleaning up ${this.activeSessions.size} active sessions`
    );

    const cleanupPromises = Array.from(this.activeSessions.keys()).map(
      (sessionId) =>
        this.stopSession(sessionId, { reason: "process_exit" }).catch((error) =>
          logger.error(
            `[ManualSessionManager] Error cleaning up session ${sessionId}:`,
            error
          )
        )
    );

    await Promise.allSettled(cleanupPromises);

    // Cleanup agent factory resources
    try {
      await this.agentFactory.cleanup();
      logger.info("[ManualSessionManager] Agent factory cleaned up");
    } catch (error) {
      logger.error(
        "[ManualSessionManager] Error cleaning up agent factory:",
        error
      );
    }

    logger.info("[ManualSessionManager] All sessions cleaned up");
  }

  /**
   * Check if a browser page is still alive and responsive
   */
  private async checkPageHealth(session: ManualSession): Promise<boolean> {
    try {
      // Quick check if the page is still accessible
      if (!session.page || session.page.isClosed()) {
        logger.debug(
          "[ManualSessionManager] Page health check failed: page is closed"
        );
        return false;
      }

      // Check browser connection
      if (!session.browser?.isConnected()) {
        logger.debug(
          "[ManualSessionManager] Page health check failed: browser disconnected"
        );
        return false;
      }

      // Check context validity
      if (!session.context) {
        logger.debug(
          "[ManualSessionManager] Page health check failed: context missing"
        );
        return false;
      }

      // Try a simple operation with timeout to check responsiveness
      await Promise.race([
        session.page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                document?: { readyState?: string };
              }
            ).document?.readyState || "loading"
        ),
        new Promise(
          (_, reject) =>
            setTimeout(() => reject(new Error("Health check timeout")), 1500) // Reduced timeout
        ),
      ]);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Execution context was destroyed") ||
          error.message.includes(
            "Target page, context or browser has been closed"
          ) ||
          error.message.includes("TargetClosedError") ||
          error.message.includes("Health check timeout") ||
          error.message.includes("Protocol error") ||
          error.message.includes("Navigation"))
      ) {
        logger.debug(
          `[ManualSessionManager] Page health check failed due to navigation/context change: ${error.message}`
        );
        return false;
      }
      logger.debug(`[ManualSessionManager] Page health check failed: ${error}`);
      return false;
    }
  }

  /**
   * Gracefully clean up browser session with fallbacks
   */
  private async gracefulBrowserCleanup(
    page: Page,
    context: BrowserContext,
    browser: Browser,
    sessionId: string
  ): Promise<void> {
    // Get cleanup timeout from configuration or use default
    let cleanupTimeout = 5000;
    try {
      const centralConfig = getConfig();
      cleanupTimeout = centralConfig.manualSession.cleanupTimeoutMs;
    } catch {
      // Use default if config not available
    }

    try {
      // Try graceful cleanup with timeout
      await Promise.race([
        this.performBrowserCleanup(page, context, browser),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Cleanup timeout")), cleanupTimeout)
        ),
      ]);
      logger.debug(
        `[ManualSessionManager] Graceful cleanup completed for ${sessionId}`
      );
    } catch (error) {
      logger.warn(
        `[ManualSessionManager] Graceful cleanup failed for ${sessionId}, attempting force cleanup: ${error}`
      );

      // Fallback to force cleanup
      try {
        if (context) {
          await context.close();
        }
        if (browser?.isConnected()) {
          await browser.close();
        }
      } catch (forceError) {
        logger.error(
          `[ManualSessionManager] Force cleanup also failed for ${sessionId}: ${forceError}`
        );
      }
    }
  }

  /**
   * Perform the actual browser cleanup
   */
  private async performBrowserCleanup(
    page: Page,
    context: BrowserContext,
    browser: Browser
  ): Promise<void> {
    // Close page first
    if (page && !page.isClosed()) {
      await page.close();
    }

    // Close context
    if (context) {
      await context.close();
    }

    // Close browser if it's still connected
    if (browser?.isConnected()) {
      await browser.close();
    }
  }

  /**
   * Emergency cleanup when normal stop fails
   */
  private async emergencySessionCleanup(
    session: ManualSession,
    sessionId: string
  ): Promise<void> {
    logger.warn(
      `[ManualSessionManager] Performing emergency cleanup for session: ${sessionId}`
    );

    try {
      // Clear screenshot intervals immediately to prevent further calls
      this.clearScreenshotInterval(sessionId);

      // Force cleanup without waiting
      await this.gracefulBrowserCleanup(
        session.page,
        session.context,
        session.browser,
        sessionId
      );
    } catch (error) {
      logger.error(`[ManualSessionManager] Emergency cleanup failed: ${error}`);
    } finally {
      // Always clean up local state
      this.cleanupSessionTimers(sessionId);
      this.activeSessions.delete(sessionId);
    }
  }

  /**
   * Force stop a session (emergency cleanup)
   */
  async forceStopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    logger.warn(`[ManualSessionManager] Force stopping session: ${sessionId}`);
    await this.emergencySessionCleanup(session, sessionId);
  }

  /**
   * Get memory usage statistics for all sessions
   */
  getMemoryStats(): {
    current: MemoryUsage;
    peak: MemoryUsage;
    average: MemoryUsage;
    snapshotCount: number;
    activeSessions: number;
    leakDetection: ReturnType<typeof memoryMonitor.detectMemoryLeaks>;
  } {
    const stats = memoryMonitor.getMemoryStats();
    const leakDetection = memoryMonitor.detectMemoryLeaks();

    return {
      ...stats,
      activeSessions: this.activeSessions.size,
      leakDetection,
    };
  }

  /**
   * Handle timeout check for a session
   */
  private async handleSessionTimeout(
    session: ManualSession,
    duration: number
  ): Promise<boolean> {
    const timeoutMs = (session.config.timeout || 0) * 60 * 1000;

    if (session.config.timeout && duration > timeoutMs) {
      logger.warn(
        `[ManualSessionManager] Session ${session.id} exceeded timeout, cleaning up`
      );
      try {
        await this.stopSession(session.id, {
          reason: "timeout_maintenance",
        });
      } catch (error) {
        logger.error(
          `[ManualSessionManager] Failed to cleanup timed out session ${session.id}: ${error}`
        );
        await this.emergencySessionCleanup(session, session.id);
      }
      return true; // Session was handled (timeout occurred)
    }
    return false; // No timeout
  }

  /**
   * Handle health check for long-running sessions
   */
  private async handleSessionHealthCheck(
    session: ManualSession,
    duration: number
  ): Promise<void> {
    if (duration > 10 * 60 * 1000) {
      try {
        const health = await this.checkSessionHealth(session.id);

        if (!health.isHealthy) {
          logger.warn(
            `[ManualSessionManager] Unhealthy session detected: ${session.id}`
          );

          // Attempt recovery for sessions with browser issues
          if (
            !health.metrics.browserConnected ||
            !health.metrics.pageResponsive
          ) {
            const recovery = await this.recoverSession(session.id);
            if (!recovery.success) {
              logger.warn(
                `[ManualSessionManager] Session ${session.id} recovery failed, flagging for cleanup`
              );
            }
          }
        }
      } catch (healthError) {
        logger.error(
          `[ManualSessionManager] Health check failed for session ${session.id}: ${healthError}`
        );
      }
    }
  }

  /**
   * Handle memory monitoring and cleanup
   */
  private handleMemoryMaintenance(): void {
    const currentMemory = memoryMonitor.getCurrentMemoryUsage().heapUsed;
    const memoryThreshold = 400 * 1024 * 1024; // 400MB

    if (currentMemory > memoryThreshold) {
      logger.info(
        `[ManualSessionManager] High memory usage detected (${MemoryMonitor.formatMemorySize(currentMemory)}), performing cleanup`
      );
      this.performCleanup();
    }

    // Check for memory leaks
    const leakDetection = memoryMonitor.detectMemoryLeaks();
    if (leakDetection.isLeaking) {
      logger.warn(
        `[ManualSessionManager] Memory leak detected during maintenance: ${leakDetection.recommendation}`
      );
    }
  }

  /**
   * Perform periodic maintenance: health checks, memory cleanup, timeout handling
   */
  private async performPeriodicMaintenance(): Promise<void> {
    try {
      const activeSessions = Array.from(this.activeSessions.values());
      const now = Date.now();

      logger.debug(
        `[ManualSessionManager] Periodic maintenance: ${activeSessions.length} active sessions`
      );

      // Process each session for timeouts and health checks
      for (const session of activeSessions) {
        const duration = now - session.startTime;

        // Check for timeouts first
        const timeoutHandled = await this.handleSessionTimeout(
          session,
          duration
        );
        if (timeoutHandled) {
          continue; // Session was stopped due to timeout
        }

        // Check session health for long-running sessions
        await this.handleSessionHealthCheck(session, duration);
      }

      // Handle memory monitoring and cleanup
      this.handleMemoryMaintenance();
    } catch (error) {
      logger.error(
        `[ManualSessionManager] Periodic maintenance failed: ${error}`
      );
    }
  }

  /**
   * Force garbage collection and cleanup with enhanced reporting
   */
  performCleanup(): {
    gcForced: boolean;
    memoryBefore: number;
    memoryAfter: number;
    memoryReclaimed: number;
    activeSessions: number;
    cleanupActions: string[];
  } {
    const memoryBefore = memoryMonitor.getCurrentMemoryUsage().heapUsed;
    const cleanupActions: string[] = [];

    // Force garbage collection
    const gcForced = memoryMonitor.forceGarbageCollection();
    if (gcForced) {
      cleanupActions.push("Forced garbage collection");
    }

    // Clean up any stale intervals
    let intervalsCleaned = 0;
    for (const [key, interval] of this.cleanupIntervals) {
      // Check if the session still exists
      const sessionId = key.startsWith("screenshot_")
        ? key.replace("screenshot_", "")
        : key;
      if (!this.activeSessions.has(sessionId)) {
        clearInterval(interval);
        this.cleanupIntervals.delete(key);
        intervalsCleaned++;
      }
    }

    if (intervalsCleaned > 0) {
      cleanupActions.push(`Cleaned ${intervalsCleaned} stale intervals`);
    }

    // Wait for GC to complete
    setTimeout(() => {
      // Intentionally empty - just waiting for GC
    }, 100);

    const memoryAfter = memoryMonitor.getCurrentMemoryUsage().heapUsed;
    const memoryReclaimed = memoryBefore - memoryAfter;

    logger.info(
      `[ManualSessionManager] Cleanup performed - GC: ${gcForced ? "forced" : "not available"}, ` +
        `Memory reclaimed: ${MemoryMonitor.formatMemorySize(memoryReclaimed)}, ` +
        `Actions: ${cleanupActions.join(", ")}`
    );

    return {
      gcForced,
      memoryBefore,
      memoryAfter,
      memoryReclaimed,
      activeSessions: this.activeSessions.size,
      cleanupActions,
    };
  }

  /**
   * Perform aggressive cleanup - used when memory pressure is high
   */
  performAggressiveCleanup(): {
    sessionsClosed: number;
    memoryReclaimed: number;
    errors: string[];
  } {
    const initialMemory = memoryMonitor.getCurrentMemoryUsage().heapUsed;
    const errors: string[] = [];
    let sessionsClosed = 0;

    logger.warn(
      "[ManualSessionManager] Performing aggressive cleanup due to memory pressure"
    );

    // Close sessions that have been running for more than 2 hours (extended for HAR file access)
    const now = Date.now();
    const oldSessionThreshold = 120 * 60 * 1000; // 2 hours (was 30 minutes)

    for (const [sessionId, session] of this.activeSessions) {
      const sessionAge = now - session.startTime;

      if (sessionAge > oldSessionThreshold) {
        try {
          this.forceStopSession(sessionId);
          sessionsClosed++;
          logger.info(
            `[ManualSessionManager] Force stopped old session: ${sessionId} (age: ${Math.round(sessionAge / 60000)}m)`
          );
        } catch (error) {
          errors.push(`Failed to stop session ${sessionId}: ${error}`);
        }
      }
    }

    // Force garbage collection multiple times
    for (let i = 0; i < 3; i++) {
      memoryMonitor.forceGarbageCollection();
    }

    const finalMemory = memoryMonitor.getCurrentMemoryUsage().heapUsed;
    const memoryReclaimed = initialMemory - finalMemory;

    logger.warn(
      `[ManualSessionManager] Aggressive cleanup completed - Sessions closed: ${sessionsClosed}, Memory reclaimed: ${MemoryMonitor.formatMemorySize(memoryReclaimed)}`
    );

    return {
      sessionsClosed,
      memoryReclaimed,
      errors,
    };
  }

  /**
   * Get session-specific memory usage
   */
  getSessionMemoryUsage(sessionId: string) {
    return memoryMonitor.getSessionMemoryUsage(sessionId);
  }

  /**
   * Set up navigation event monitoring for a session
   */
  private setupNavigationEventMonitoring(
    page: import("playwright").Page,
    sessionId: string
  ): void {
    try {
      // Monitor page navigation events
      page.on("load", () => {
        try {
          logger.debug(
            `[ManualSessionManager] Page loaded for session ${sessionId}: ${this.safeGetPageUrl(page)}`
          );
        } catch (error) {
          logger.debug(
            `[ManualSessionManager] Failed to log page load for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      });

      page.on("domcontentloaded", () => {
        try {
          logger.debug(
            `[ManualSessionManager] DOM content loaded for session ${sessionId}: ${this.safeGetPageUrl(page)}`
          );
        } catch (error) {
          logger.debug(
            `[ManualSessionManager] Failed to log DOM content loaded for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      });

      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          try {
            logger.debug(
              `[ManualSessionManager] Main frame navigated for session ${sessionId}: ${this.safeGetPageUrl(page)}`
            );
          } catch (error) {
            logger.debug(
              `[ManualSessionManager] Failed to log navigation for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      });

      // Monitor page errors that might indicate context issues
      page.on("pageerror", (error) => {
        logger.debug(
          `[ManualSessionManager] Page error for session ${sessionId}: ${error.message}`
        );
      });

      // Monitor console errors that might indicate context destruction
      page.on("console", (message) => {
        if (message.type() === "error") {
          logger.debug(
            `[ManualSessionManager] Console error for session ${sessionId}: ${message.text()}`
          );
        }
      });

      // Monitor for page context destruction events
      page.on("close", () => {
        logger.debug(
          `[ManualSessionManager] Page closed for session ${sessionId}`
        );
      });

      // Monitor for browser context destruction
      page.context().on("close", () => {
        logger.debug(
          `[ManualSessionManager] Browser context closed for session ${sessionId}`
        );
      });

      logger.debug(
        `[ManualSessionManager] Navigation event monitoring set up for session ${sessionId}`
      );
    } catch (error) {
      logger.warn(
        `[ManualSessionManager] Failed to set up navigation monitoring for session ${sessionId}: ${error}`
      );
    }
  }

  /**
   * Safely get page URL with error handling for navigation-related issues
   */
  private safeGetPageUrl(page: import("playwright").Page): string {
    try {
      if (!page || page.isClosed()) {
        return "Unknown";
      }

      // Additional check for page context validity
      try {
        const url = page.url();
        return url;
      } catch (urlError) {
        logger.debug(
          `[ManualSessionManager] Page URL access failed: ${urlError instanceof Error ? urlError.message : String(urlError)}`
        );
        return "Unknown";
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Execution context was destroyed") ||
          error.message.includes(
            "Target page, context or browser has been closed"
          ) ||
          error.message.includes("TargetClosedError") ||
          error.message.includes("Navigation") ||
          error.message.includes("Protocol error"))
      ) {
        logger.debug(
          `[ManualSessionManager] Page URL access failed due to navigation: ${error.message}`
        );
        return "Unknown";
      }
      logger.warn(`[ManualSessionManager] Failed to get page URL: ${error}`);
      return "Unknown";
    }
  }

  /**
   * Safely get page title with error handling for navigation-related issues
   */
  private async safeGetPageTitle(
    page: import("playwright").Page
  ): Promise<string> {
    try {
      if (!page || page.isClosed()) {
        return "Unknown";
      }

      // Check if the page context is still valid
      try {
        await page.evaluate(
          () =>
            (
              globalThis as typeof globalThis & {
                document?: { readyState?: string };
              }
            ).document?.readyState
        );
      } catch (contextError) {
        logger.debug(
          `[ManualSessionManager] Page context is not available: ${contextError instanceof Error ? contextError.message : String(contextError)}`
        );
        return "Unknown";
      }

      // Use race condition to handle hanging title requests
      const title = await Promise.race([
        page.title(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Title fetch timeout")), 3000)
        ),
      ]);

      return title;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("Execution context was destroyed") ||
          error.message.includes(
            "Target page, context or browser has been closed"
          ) ||
          error.message.includes("TargetClosedError") ||
          error.message.includes("Title fetch timeout") ||
          error.message.includes("Navigation") ||
          error.message.includes("Protocol error"))
      ) {
        logger.debug(
          `[ManualSessionManager] Page title access failed due to navigation: ${error.message}`
        );
        return "Unknown";
      }
      logger.warn(`[ManualSessionManager] Failed to get page title: ${error}`);
      return "Unknown";
    }
  }

  /**
   * Generate MCP URI for accessing manual session artifacts
   */
  private generateMcpUriForArtifact(
    sessionId: string,
    artifact: Artifact
  ): string {
    const filename = artifact.path.split("/").pop() || "unknown";

    switch (artifact.type) {
      case "har":
        return `harvest://manual/${sessionId}/artifacts/har/${filename}`;
      case "cookies":
        return `harvest://manual/${sessionId}/artifacts/cookies/${filename}`;
      case "screenshot":
        return `harvest://manual/${sessionId}/artifacts/screenshots/${filename}`;
      case "log":
        return `harvest://manual/${sessionId}/artifacts/logs/${filename}`;
      default:
        return `harvest://manual/${sessionId}/artifacts/other/${filename}`;
    }
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0
        ? `${minutes}m ${remainingSeconds}s`
        : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
}

// Export singleton instance
export const manualSessionManager = ManualSessionManager.getInstance();
