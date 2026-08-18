/**
 * Artifact collector for Harvest MCP
 * Ported from magnitude-mcp, adapted for harvest-mcp use case
 * Collects HAR files, cookies, and screenshots from browser sessions
 */

import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserContext, Page, Request, Response } from "playwright";
import { HARGenerationError } from "../types/index.js";
import { logBrowserError, logBrowserOperation } from "../utils/logger.js";
import { pathTranslator } from "../utils/pathTranslator.js";
import type { Artifact, ArtifactCollection } from "./types.js";

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    postData?:
      | {
          mimeType: string;
          text: string;
        }
      | undefined;
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: Array<{ name: string; value: string }>;
    cookies: Array<{ name: string; value: string }>;
    content: {
      size: number;
      mimeType: string;
      text?: string;
    };
  };
  cache: Record<string, unknown>;
  timings: {
    send: number;
    wait: number;
    receive: number;
  };
}

export interface HarData {
  log: {
    version: string;
    creator: {
      name: string;
      version: string;
    };
    pages: Array<{
      startedDateTime: string;
      id: string;
      title: string;
      pageTimings: {
        onContentLoad: number;
        onLoad: number;
      };
    }>;
    entries: HarEntry[];
  };
}

export interface HARGenerationConfig {
  minEntries?: number; // Minimum entries required (default: 5)
  minApiRequests?: number; // Minimum API requests (default: 1)
  waitForPendingMs?: number; // Wait for pending requests (default: 2000ms)
  qualityThreshold?: "poor" | "good" | "excellent"; // Minimum quality (default: "good")
}

export interface ScreenshotOptions {
  type?: "png" | "jpeg";
  quality?: number;
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export class ArtifactCollector {
  private harEntries: HarEntry[] = [];
  private isNetworkTracking = false;
  private requestHandler?: ((request: Request) => void) | undefined;
  private responseHandler?: ((response: Response) => void) | undefined;
  private currentPage?: Page | undefined;
  private intervalScreenshots = new Map<
    string,
    { intervalId: NodeJS.Timeout; artifacts: Artifact[] }
  >();
  private networkRequestCallback?: ((count: number) => void) | undefined;
  private clientAccessible: boolean;
  private pendingResponses = new Map<string, Request>();
  private lastRequestTimestamp = 0;
  private apiRequestCount = 0;

  constructor(clientAccessible = false) {
    this.clientAccessible = clientAccessible;
    logBrowserOperation("artifact_collector_created", { clientAccessible });
  }

  /**
   * Get the current number of HAR entries
   */
  getHarEntryCount(): number {
    return this.harEntries.length;
  }

  /**
   * Check if network tracking is active
   */
  isTrackingNetwork(): boolean {
    return this.isNetworkTracking;
  }

  /**
   * Set callback for network request count updates
   */
  setNetworkRequestCallback(callback: (count: number) => void): void {
    this.networkRequestCallback = callback;
  }

  /**
   * Validate that an artifact file was created and has content
   */
  private async validateArtifact(
    artifact: Artifact
  ): Promise<{ isValid: boolean; size: number; error?: string }> {
    try {
      await access(artifact.path);
      const stats = await stat(artifact.path);

      if (stats.size === 0) {
        return {
          isValid: false,
          size: 0,
          error: "Artifact file is empty",
        };
      }

      return {
        isValid: true,
        size: stats.size,
      };
    } catch (error) {
      return {
        isValid: false,
        size: 0,
        error: error instanceof Error ? error.message : "File access failed",
      };
    }
  }

  /**
   * Start tracking network requests and responses
   */
  startNetworkTracking(page: Page): void {
    try {
      logBrowserOperation("network_tracking_start", {
        url: page.url(),
      });

      this.currentPage = page;
      this.isNetworkTracking = true;

      // Create request handler
      this.requestHandler = (request: Request) => {
        const requestId = `${Date.now()}-${Math.random()}`;
        const url = request.url();

        // Track pending request
        this.pendingResponses.set(requestId, request);
        this.lastRequestTimestamp = Date.now();

        // Check if this is an API request
        if (
          url.includes("/api/") ||
          url.includes("/v1/") ||
          url.includes("/v2/")
        ) {
          this.apiRequestCount++;
        }

        const harEntry: HarEntry = {
          startedDateTime: new Date().toISOString(),
          time: 0,
          request: {
            method: request.method(),
            url: request.url(),
            httpVersion: "HTTP/1.1", // Default to HTTP/1.1 since Playwright doesn't always expose this
            headers: Object.entries(request.headers()).map(([name, value]) => ({
              name,
              value,
            })),
            cookies: [], // Cookie extraction handled via context.cookies()
            postData: request.postData()
              ? {
                  mimeType:
                    request.headers()["content-type"] ||
                    request.headers()["Content-Type"] ||
                    "application/octet-stream",
                  text: request.postData() || "",
                }
              : undefined,
          },
          response: {
            status: 0,
            statusText: "",
            httpVersion: "HTTP/1.1",
            headers: [],
            cookies: [],
            content: {
              size: 0,
              mimeType: "",
            },
          },
          cache: {},
          timings: {
            send: 0,
            wait: 0,
            receive: 0,
          },
        };

        // Store reference to HAR entry on request for response handler
        (
          request as Request & { _harEntry: HarEntry; _requestId: string }
        )._harEntry = harEntry;
        (
          request as Request & { _harEntry: HarEntry; _requestId: string }
        )._requestId = requestId;
        this.harEntries.push(harEntry);

        // Notify callback of updated request count
        if (this.networkRequestCallback) {
          this.networkRequestCallback(this.harEntries.length);
        }

        logBrowserOperation("network_request_tracked", {
          method: request.method(),
          url: request.url(),
          entryCount: this.harEntries.length,
          apiRequestCount: this.apiRequestCount,
          pendingCount: this.pendingResponses.size,
        });
      };

      // Create response handler
      this.responseHandler = (response: Response) => {
        const requestWithMetadata = response.request() as Request & {
          _harEntry?: HarEntry;
          _requestId?: string;
        };
        const harEntry = requestWithMetadata._harEntry;
        const requestId = requestWithMetadata._requestId;

        if (harEntry) {
          harEntry.response = {
            status: response.status(),
            statusText: response.statusText(),
            httpVersion: "HTTP/1.1", // Default to HTTP/1.1 since Playwright doesn't always expose this
            headers: Object.entries(response.headers()).map(
              ([name, value]) => ({
                name,
                value,
              })
            ),
            cookies: [], // Cookie extraction handled via context.cookies()
            content: {
              size: Number.parseInt(
                response.headers()["content-length"] || "0",
                10
              ),
              mimeType:
                response.headers()["content-type"] ||
                "application/octet-stream",
            },
          };

          // Remove from pending responses when response is received
          if (requestId) {
            this.pendingResponses.delete(requestId);
          }

          logBrowserOperation("network_response_tracked", {
            status: response.status(),
            url: response.url(),
            pendingCount: this.pendingResponses.size,
          });
        }
      };

      // Attach event listeners
      page.on("request", this.requestHandler);
      page.on("response", this.responseHandler);

      logBrowserOperation("network_tracking_started", {
        url: page.url(),
      });
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "start_network_tracking",
        url: page.url(),
      });
      throw error;
    }
  }

  /**
   * Stop tracking network requests and responses
   */
  stopNetworkTracking(): void {
    try {
      if (this.currentPage && this.requestHandler && this.responseHandler) {
        this.currentPage.off("request", this.requestHandler);
        this.currentPage.off("response", this.responseHandler);
      }

      this.isNetworkTracking = false;
      this.currentPage = undefined;
      this.requestHandler = undefined;
      this.responseHandler = undefined;

      logBrowserOperation("network_tracking_stopped", {
        harEntryCount: this.harEntries.length,
        apiRequestCount: this.apiRequestCount,
        pendingCount: this.pendingResponses.size,
        quality: this.assessHarQuality(),
      });
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "stop_network_tracking",
      });
      throw error;
    }
  }

  /**
   * Wait for pending network requests to complete
   */
  private async waitForPendingRequests(waitMs: number): Promise<void> {
    if (this.pendingResponses.size === 0) {
      return;
    }

    logBrowserOperation("waiting_for_pending_requests", {
      pendingCount: this.pendingResponses.size,
      waitMs,
    });

    const startTime = Date.now();
    const endTime = startTime + waitMs;

    while (Date.now() < endTime && this.pendingResponses.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logBrowserOperation("pending_requests_wait_complete", {
      finalPendingCount: this.pendingResponses.size,
      waitedMs: Date.now() - startTime,
    });
  }

  /**
   * Assess HAR quality based on current entries
   */
  private assessHarQuality(): "excellent" | "good" | "poor" | "empty" {
    const entryCount = this.harEntries.length;
    const apiCount = this.apiRequestCount;
    const postCount = this.harEntries.filter(
      (entry) =>
        entry.request.method === "POST" ||
        entry.request.method === "PUT" ||
        entry.request.method === "DELETE"
    ).length;

    if (entryCount === 0) {
      return "empty";
    }

    if (apiCount >= 3 || postCount >= 2) {
      return "excellent";
    }

    if (entryCount >= 5 || apiCount >= 1) {
      return "good";
    }

    return "poor";
  }

  /**
   * Generate HAR file from collected network data with quality validation
   */
  async generateHarFile(
    outputPath: string,
    config?: HARGenerationConfig
  ): Promise<Artifact> {
    try {
      const defaultConfig: Required<HARGenerationConfig> = {
        minEntries: 5,
        minApiRequests: 1,
        waitForPendingMs: 2000,
        qualityThreshold: "good",
      };

      const finalConfig = { ...defaultConfig, ...config };

      logBrowserOperation("har_generation_start", {
        entryCount: this.harEntries.length,
        apiRequestCount: this.apiRequestCount,
        pendingCount: this.pendingResponses.size,
        outputPath,
        config: finalConfig,
      });

      // Wait for pending requests to complete
      if (finalConfig.waitForPendingMs > 0) {
        await this.waitForPendingRequests(finalConfig.waitForPendingMs);
      }

      // Assess current quality
      const currentQuality = this.assessHarQuality();

      // Check minimum requirements
      if (this.harEntries.length < finalConfig.minEntries) {
        throw new HARGenerationError(
          `Insufficient HAR entries: ${this.harEntries.length} < ${finalConfig.minEntries} required. ` +
            "Try interacting more with the application to generate network traffic.",
          {
            entryCount: this.harEntries.length,
            apiCount: this.apiRequestCount,
            pendingCount: this.pendingResponses.size,
            quality: currentQuality,
          }
        );
      }

      if (this.apiRequestCount < finalConfig.minApiRequests) {
        throw new HARGenerationError(
          `Insufficient API requests: ${this.apiRequestCount} < ${finalConfig.minApiRequests} required. ` +
            "Look for data loading operations, form submissions, or API interactions.",
          {
            entryCount: this.harEntries.length,
            apiCount: this.apiRequestCount,
            pendingCount: this.pendingResponses.size,
            quality: currentQuality,
          }
        );
      }

      // Check quality threshold
      const qualityLevels = { poor: 0, good: 1, excellent: 2 };
      const requiredLevel = qualityLevels[finalConfig.qualityThreshold];
      const currentLevel =
        currentQuality === "empty" ? -1 : qualityLevels[currentQuality];

      if (currentLevel < requiredLevel) {
        throw new HARGenerationError(
          `HAR quality "${currentQuality}" below required "${finalConfig.qualityThreshold}". ` +
            "Try capturing more meaningful interactions like form submissions or data operations.",
          {
            entryCount: this.harEntries.length,
            apiCount: this.apiRequestCount,
            pendingCount: this.pendingResponses.size,
            quality: currentQuality,
          }
        );
      }

      // Get page title if available (safely handle destroyed contexts)
      let pageTitle = "Session";
      if (this.currentPage) {
        try {
          // Check if the page context is still alive before getting title
          if (!this.currentPage.isClosed()) {
            const title = await this.currentPage.title();
            pageTitle = typeof title === "string" && title ? title : "Session";
          }
        } catch {
          pageTitle = "Session";
        }
      }

      const harData: HarData = {
        log: {
          version: "1.2",
          creator: {
            name: "harvest-mcp",
            version: "1.0.0",
          },
          pages: [
            {
              startedDateTime: new Date().toISOString(),
              id: "page_1",
              title: pageTitle,
              pageTimings: {
                onContentLoad: -1,
                onLoad: -1,
              },
            },
          ],
          entries: this.harEntries,
        },
      };

      // Ensure output directory exists with proper permissions
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o755 });

      // Write HAR file with proper permissions
      await writeFile(outputPath, JSON.stringify(harData, null, 2), {
        encoding: "utf-8",
        mode: 0o644,
      });

      // Register path for client access if needed
      if (this.clientAccessible) {
        try {
          const clientPath = pathTranslator.translateForClient(outputPath);

          // Verify the translation is meaningful (not just returning the original path)
          if (clientPath !== outputPath || outputPath.includes(".harvest")) {
            pathTranslator.registerPath(outputPath, clientPath);
            logBrowserOperation("har_path_registered", {
              serverPath: outputPath,
              clientPath,
              registrationSuccess: true,
            });
          } else {
            logBrowserOperation("har_path_registration_skipped", {
              serverPath: outputPath,
              reason: "Path not in client-accessible location",
              pathIncludes: {
                harvest: outputPath.includes(".harvest"),
                temp: outputPath.includes("tmp"),
                home: outputPath.includes(process.env.HOME || ""),
              },
            });
          }
        } catch (translationError) {
          logBrowserOperation("har_path_registration_failed", {
            serverPath: outputPath,
            error:
              translationError instanceof Error
                ? translationError.message
                : "Unknown error",
          });
        }
      }

      const artifact: Artifact = {
        type: "har",
        path: outputPath,
        timestamp: new Date().toISOString(),
      };

      // Validate the artifact was created properly
      const validation = await this.validateArtifact(artifact);
      if (!validation.isValid) {
        throw new Error(`HAR artifact validation failed: ${validation.error}`);
      }

      // Add size to artifact
      (artifact as Artifact & { size?: number }).size = validation.size;

      logBrowserOperation("har_generation_complete", {
        entryCount: this.harEntries.length,
        apiRequestCount: this.apiRequestCount,
        finalPendingCount: this.pendingResponses.size,
        quality: currentQuality,
        outputPath,
        size: validation.size,
        validated: true,
      });

      return artifact;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "har_generation",
        outputPath,
      });
      throw error;
    }
  }

  /**
   * Extract cookies from browser context
   */
  async extractCookies(
    context: BrowserContext,
    outputPath: string
  ): Promise<Artifact> {
    try {
      logBrowserOperation("cookie_extraction_start", {
        outputPath,
      });

      const cookies = await context.cookies();

      const cookieData = {
        collectedAt: new Date().toISOString(),
        totalCookies: cookies.length,
        domains: Array.from(new Set(cookies.map((c) => c.domain))),
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          expires: cookie.expires,
          httpOnly: cookie.httpOnly,
          secure: cookie.secure,
          sameSite: cookie.sameSite,
        })),
      };

      // Ensure output directory exists with proper permissions
      await mkdir(dirname(outputPath), { recursive: true, mode: 0o755 });

      // Write cookie file with proper permissions
      await writeFile(outputPath, JSON.stringify(cookieData, null, 2), {
        encoding: "utf-8",
        mode: 0o644,
      });

      // Register path for client access if needed
      if (this.clientAccessible) {
        try {
          const clientPath = pathTranslator.translateForClient(outputPath);

          // Verify the translation is meaningful (not just returning the original path)
          if (clientPath !== outputPath || outputPath.includes(".harvest")) {
            pathTranslator.registerPath(outputPath, clientPath);
            logBrowserOperation("cookie_path_registered", {
              serverPath: outputPath,
              clientPath,
              registrationSuccess: true,
            });
          } else {
            logBrowserOperation("cookie_path_registration_skipped", {
              serverPath: outputPath,
              reason: "Path not in client-accessible location",
              pathIncludes: {
                harvest: outputPath.includes(".harvest"),
                temp: outputPath.includes("tmp"),
                home: outputPath.includes(process.env.HOME || ""),
              },
            });
          }
        } catch (translationError) {
          logBrowserOperation("cookie_path_registration_failed", {
            serverPath: outputPath,
            error:
              translationError instanceof Error
                ? translationError.message
                : "Unknown error",
          });
        }
      }

      const artifact: Artifact = {
        type: "cookies",
        path: outputPath,
        timestamp: new Date().toISOString(),
      };

      // Validate the artifact was created properly
      const validation = await this.validateArtifact(artifact);
      if (!validation.isValid) {
        throw new Error(
          `Cookie artifact validation failed: ${validation.error}`
        );
      }

      // Add size to artifact
      (artifact as Artifact & { size?: number }).size = validation.size;

      logBrowserOperation("cookie_extraction_complete", {
        cookieCount: cookies.length,
        outputPath,
        domains: cookieData.domains.length,
        size: validation.size,
        validated: true,
      });

      return artifact;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "cookie_extraction",
        outputPath,
      });
      throw error;
    }
  }

  /**
   * Capture screenshot from page
   */
  async captureScreenshot(page: Page, outputPath: string): Promise<Artifact> {
    try {
      logBrowserOperation("screenshot_capture_start", {
        url: page.url(),
        outputPath,
      });

      // Ensure output directory exists
      await mkdir(dirname(outputPath), { recursive: true });

      // Capture screenshot
      await page.screenshot({
        path: outputPath,
        fullPage: true,
        type: "png",
      });

      const artifact: Artifact = {
        type: "screenshot",
        path: outputPath,
        timestamp: new Date().toISOString(),
      };

      // Validate the artifact was created properly
      const validation = await this.validateArtifact(artifact);
      if (!validation.isValid) {
        throw new Error(
          `Screenshot artifact validation failed: ${validation.error}`
        );
      }

      // Add size to artifact
      (artifact as Artifact & { size?: number }).size = validation.size;

      logBrowserOperation("screenshot_capture_complete", {
        url: page.url(),
        outputPath,
        size: validation.size,
        validated: true,
      });

      return artifact;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "screenshot_capture",
        url: page.url(),
        outputPath,
      });
      throw error;
    }
  }

  /**
   * Collect all artifacts (HAR, cookies, screenshot) with optional HAR generation config
   */
  async collectAllArtifacts(
    page: Page,
    context: BrowserContext,
    outputDir: string,
    harConfig?: HARGenerationConfig
  ): Promise<ArtifactCollection> {
    try {
      logBrowserOperation("artifact_collection_start", {
        outputDir,
        url: page.url(),
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const artifacts: Artifact[] = [];

      // Generate HAR file with optional config
      const harPath = join(outputDir, `network-${timestamp}.har`);
      const harArtifact = await this.generateHarFile(harPath, harConfig);
      artifacts.push(harArtifact);

      // Extract cookies
      const cookiePath = join(outputDir, `cookies-${timestamp}.json`);
      const cookieArtifact = await this.extractCookies(context, cookiePath);
      artifacts.push(cookieArtifact);

      // Capture screenshot
      const screenshotPath = join(outputDir, `screenshot-${timestamp}.png`);
      const screenshotArtifact = await this.captureScreenshot(
        page,
        screenshotPath
      );
      artifacts.push(screenshotArtifact);

      const collection: ArtifactCollection = {
        artifacts,
        outputDir,
        summary: `Collected ${artifacts.length} artifacts to ${outputDir}`,
      };

      logBrowserOperation("artifact_collection_complete", {
        outputDir,
        artifactCount: artifacts.length,
        harEntries: this.harEntries.length,
      });

      return collection;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "artifact_collection",
        outputDir,
        url: page.url(),
      });
      throw error;
    }
  }

  /**
   * Clear all HAR entries and reset tracking counters
   */
  clearHarEntries(): void {
    logBrowserOperation("har_entries_cleared", {
      previousCount: this.harEntries.length,
      previousApiCount: this.apiRequestCount,
      previousPendingCount: this.pendingResponses.size,
    });
    this.harEntries = [];
    this.pendingResponses.clear();
    this.apiRequestCount = 0;
    this.lastRequestTimestamp = 0;
  }

  /**
   * Get current API request count
   */
  getApiRequestCount(): number {
    return this.apiRequestCount;
  }

  /**
   * Get count of pending requests
   */
  getPendingRequestCount(): number {
    return this.pendingResponses.size;
  }

  /**
   * Get time since last network request (milliseconds)
   */
  getTimeSinceLastRequest(): number {
    return this.lastRequestTimestamp === 0
      ? 0
      : Date.now() - this.lastRequestTimestamp;
  }

  /**
   * Get current HAR quality assessment
   */
  getCurrentQuality(): "excellent" | "good" | "poor" | "empty" {
    return this.assessHarQuality();
  }

  /**
   * Get network activity monitoring status
   */
  getNetworkActivityStatus(): {
    isTracking: boolean;
    harEntryCount: number;
    apiRequestCount: number;
    pendingRequestCount: number;
    lastRequestTime: number;
    timeSinceLastRequest: number;
    quality: "excellent" | "good" | "poor" | "empty";
    isActive: boolean; // True if requests within last 30 seconds
    recommendations: string[];
  } {
    const timeSinceLastRequest = this.getTimeSinceLastRequest();
    const isActive = timeSinceLastRequest < 30000; // Active if request within 30 seconds
    const quality = this.getCurrentQuality();

    const recommendations: string[] = [];

    // Generate real-time recommendations
    if (!this.isNetworkTracking) {
      recommendations.push("Network tracking is not active");
    } else if (this.harEntries.length === 0) {
      recommendations.push(
        "No network requests captured yet - try interacting with the page"
      );
    } else if (this.apiRequestCount === 0) {
      recommendations.push(
        "No API requests captured - look for data loading or form submissions"
      );
    } else if (quality === "poor") {
      recommendations.push(
        "Low network activity - try completing more workflows"
      );
    } else if (!isActive && this.harEntries.length > 0) {
      recommendations.push(
        "No recent network activity - current capture may be complete"
      );
    }

    if (this.pendingResponses.size > 0) {
      recommendations.push(
        `${this.pendingResponses.size} requests still pending - wait before stopping`
      );
    }

    return {
      isTracking: this.isNetworkTracking,
      harEntryCount: this.harEntries.length,
      apiRequestCount: this.apiRequestCount,
      pendingRequestCount: this.pendingResponses.size,
      lastRequestTime: this.lastRequestTimestamp,
      timeSinceLastRequest,
      quality,
      isActive,
      recommendations,
    };
  }

  /**
   * Get detailed network activity summary
   */
  getNetworkActivitySummary(): {
    summary: string;
    status: "active" | "idle" | "complete" | "empty";
    details: {
      totalRequests: number;
      apiRequests: number;
      pendingRequests: number;
      methodBreakdown: Record<string, number>;
      domainBreakdown: Record<string, number>;
      recent: Array<{ method: string; url: string; timestamp: string }>;
    };
  } {
    const methodBreakdown: Record<string, number> = {};
    const domainBreakdown: Record<string, number> = {};
    const recent: Array<{ method: string; url: string; timestamp: string }> =
      [];

    // Analyze all entries
    for (const entry of this.harEntries) {
      // Method breakdown
      const method = entry.request.method;
      methodBreakdown[method] = (methodBreakdown[method] || 0) + 1;

      // Domain breakdown
      try {
        const domain = new URL(entry.request.url).hostname;
        domainBreakdown[domain] = (domainBreakdown[domain] || 0) + 1;
      } catch {
        // Ignore invalid URLs
      }
    }

    // Get recent entries (last 10)
    const recentEntries = this.harEntries.slice(-10);
    for (const entry of recentEntries) {
      recent.push({
        method: entry.request.method,
        url: entry.request.url,
        timestamp: entry.startedDateTime,
      });
    }

    // Determine status
    let status: "active" | "idle" | "complete" | "empty";
    const timeSinceLastRequest = this.getTimeSinceLastRequest();

    if (this.harEntries.length === 0) {
      status = "empty";
    } else if (timeSinceLastRequest < 10000) {
      // 10 seconds
      status = "active";
    } else if (timeSinceLastRequest < 60000) {
      // 1 minute
      status = "idle";
    } else {
      status = "complete";
    }

    // Generate summary
    let summary = `Network capture ${status}: ${this.harEntries.length} total requests`;
    if (this.apiRequestCount > 0) {
      summary += `, ${this.apiRequestCount} API requests`;
    }
    if (this.pendingResponses.size > 0) {
      summary += `, ${this.pendingResponses.size} pending`;
    }

    return {
      summary,
      status,
      details: {
        totalRequests: this.harEntries.length,
        apiRequests: this.apiRequestCount,
        pendingRequests: this.pendingResponses.size,
        methodBreakdown,
        domainBreakdown,
        recent,
      },
    };
  }

  /**
   * Get current HAR entries (for debugging)
   */
  getHarEntries(): readonly HarEntry[] {
    return this.harEntries;
  }

  /**
   * Capture screenshot with custom options
   */
  async captureScreenshotWithOptions(
    page: Page,
    outputPath: string,
    options: ScreenshotOptions = {}
  ): Promise<Artifact> {
    try {
      logBrowserOperation("screenshot_capture_with_options_start", {
        url: page.url(),
        outputPath,
        options,
      });

      // Ensure output directory exists
      await mkdir(dirname(outputPath), { recursive: true });

      // Prepare screenshot options
      const screenshotOptions: {
        path: string;
        type: "png" | "jpeg";
        fullPage: boolean;
        quality?: number;
        clip?: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      } = {
        path: outputPath,
        type: options.type || "png",
        fullPage: options.fullPage !== undefined ? options.fullPage : true,
      };

      if (options.quality !== undefined && options.type === "jpeg") {
        screenshotOptions.quality = options.quality;
      }

      if (options.clip) {
        screenshotOptions.clip = options.clip;
        screenshotOptions.fullPage = false; // Can't use fullPage with clip
      }

      // Capture screenshot
      await page.screenshot(screenshotOptions);

      const artifact: Artifact = {
        type: "screenshot",
        path: outputPath,
        timestamp: new Date().toISOString(),
      };

      logBrowserOperation("screenshot_capture_with_options_complete", {
        url: page.url(),
        outputPath,
        options,
      });

      return artifact;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "screenshot_capture_with_options",
        url: page.url(),
        outputPath,
        options,
      });
      throw error;
    }
  }

  /**
   * Capture viewport-only screenshot
   */
  captureViewportScreenshot(page: Page, outputPath: string): Promise<Artifact> {
    return this.captureScreenshotWithOptions(page, outputPath, {
      fullPage: false,
    });
  }

  /**
   * Capture full page screenshot
   */
  captureFullPageScreenshot(page: Page, outputPath: string): Promise<Artifact> {
    return this.captureScreenshotWithOptions(page, outputPath, {
      fullPage: true,
    });
  }

  /**
   * Capture multiple screenshots at timed intervals
   */
  async captureTimedScreenshots(
    page: Page,
    outputDir: string,
    count: number,
    intervalMs: number
  ): Promise<Artifact[]> {
    try {
      logBrowserOperation("timed_screenshots_start", {
        url: page.url(),
        outputDir,
        count,
        intervalMs,
      });

      const artifacts: Artifact[] = [];

      for (let i = 0; i < count; i++) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const outputPath = join(outputDir, `timed-screenshot-${timestamp}.png`);

        const artifact = await this.captureScreenshot(page, outputPath);
        artifacts.push(artifact);

        // Wait for interval before next screenshot (except for last one)
        if (i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }

      logBrowserOperation("timed_screenshots_complete", {
        url: page.url(),
        outputDir,
        count: artifacts.length,
      });

      return artifacts;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "timed_screenshots",
        url: page.url(),
        outputDir,
        count,
        intervalMs,
      });
      throw error;
    }
  }

  /**
   * Start interval-based screenshot capture
   */
  startIntervalScreenshots(
    page: Page,
    outputDir: string,
    intervalMs: number
  ): string {
    try {
      const sessionId = `interval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      logBrowserOperation("interval_screenshots_start", {
        sessionId,
        url: page.url(),
        outputDir,
        intervalMs,
      });

      const artifacts: Artifact[] = [];

      const intervalId = setInterval(async () => {
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const outputPath = join(
            outputDir,
            `interval-screenshot-${timestamp}.png`
          );

          const artifact = await this.captureScreenshot(page, outputPath);
          artifacts.push(artifact);

          logBrowserOperation("interval_screenshot_captured", {
            sessionId,
            path: outputPath,
            count: artifacts.length,
          });
        } catch (error) {
          logBrowserError(error as Error, {
            operation: "interval_screenshot_capture",
            sessionId,
            url: page.url(),
          });
        }
      }, intervalMs);

      // Store interval reference
      this.intervalScreenshots.set(sessionId, { intervalId, artifacts });

      logBrowserOperation("interval_screenshots_started", {
        sessionId,
        url: page.url(),
        intervalMs,
      });

      return sessionId;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "start_interval_screenshots",
        url: page.url(),
        outputDir,
        intervalMs,
      });
      throw error;
    }
  }

  /**
   * Stop interval-based screenshot capture
   */
  stopIntervalScreenshots(sessionId: string): Artifact[] {
    try {
      logBrowserOperation("interval_screenshots_stop", {
        sessionId,
      });

      const session = this.intervalScreenshots.get(sessionId);
      if (!session) {
        throw new Error(`Interval screenshot session not found: ${sessionId}`);
      }

      // Clear the interval
      clearInterval(session.intervalId);

      // Get captured artifacts
      const artifacts = [...session.artifacts];

      // Clean up session
      this.intervalScreenshots.delete(sessionId);

      logBrowserOperation("interval_screenshots_stopped", {
        sessionId,
        artifactCount: artifacts.length,
      });

      return artifacts;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "stop_interval_screenshots",
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Capture screenshot of a specific element
   */
  async captureElementScreenshot(
    page: Page,
    outputPath: string,
    selector: string
  ): Promise<Artifact> {
    try {
      logBrowserOperation("element_screenshot_start", {
        url: page.url(),
        outputPath,
        selector,
      });

      // Ensure output directory exists
      await mkdir(dirname(outputPath), { recursive: true });

      // Get element and capture screenshot
      const element = page.locator(selector);
      await element.screenshot({
        path: outputPath,
        type: "png",
      });

      const artifact: Artifact = {
        type: "screenshot",
        path: outputPath,
        timestamp: new Date().toISOString(),
      };

      logBrowserOperation("element_screenshot_complete", {
        url: page.url(),
        outputPath,
        selector,
      });

      return artifact;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "element_screenshot",
        url: page.url(),
        outputPath,
        selector,
      });
      throw error;
    }
  }

  /**
   * Cleanup all interval screenshots
   */
  cleanup(): void {
    logBrowserOperation("artifact_collector_cleanup_start", {
      activeIntervals: this.intervalScreenshots.size,
    });

    for (const [sessionId, session] of this.intervalScreenshots) {
      clearInterval(session.intervalId);
      logBrowserOperation("interval_screenshot_cleaned", {
        sessionId,
        artifactCount: session.artifacts.length,
      });
    }

    this.intervalScreenshots.clear();

    logBrowserOperation("artifact_collector_cleanup_complete");
  }
}
