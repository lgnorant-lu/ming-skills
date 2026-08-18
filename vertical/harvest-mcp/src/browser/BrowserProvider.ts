/**
 * Browser provider for Harvest MCP
 * Ported from magnitude-core and adapted for harvest-mcp use case
 * Manages browser instances, contexts, and lifecycle
 */

import {
  type Browser,
  type BrowserContext,
  chromium,
  firefox,
  webkit,
} from "playwright";
import {
  browserLogger,
  logBrowserError,
  logBrowserOperation,
} from "../utils/logger.js";
import { BrowserPool } from "./BrowserPool.js";
import type { ActiveBrowser, BrowserEngine, BrowserOptions } from "./types.js";

export class BrowserProvider {
  private activeBrowsers = new Map<string, ActiveBrowser>();
  private activeContexts = new Set<BrowserContext>();
  private browserPool?: BrowserPool | undefined;
  private usePool = false;

  /**
   * Enable browser pooling for resource efficiency
   */
  enablePooling(pool?: BrowserPool): void {
    this.usePool = true;
    this.browserPool = pool || new BrowserPool();
  }

  /**
   * Disable browser pooling
   */
  disablePooling(): void {
    this.usePool = false;
    if (this.browserPool) {
      this.browserPool.cleanup();
    }
    this.browserPool = undefined;
  }

  /**
   * Get or create a browser instance based on options
   */
  async getBrowser(options?: BrowserOptions): Promise<Browser> {
    try {
      // If existing browser instance provided, use it
      if (options && "instance" in options && options.instance) {
        logBrowserOperation("browser_instance_provided", {
          type: "existing_instance",
        });
        return options.instance;
      }

      // If CDP connection provided, connect to it
      if (options && "cdp" in options && options.cdp) {
        return await this.connectToCDP(options.cdp);
      }

      // Launch new browser instance
      return await this.launchBrowser(options);
    } catch (error) {
      logBrowserError(error as Error, { options });
      throw error;
    }
  }

  /**
   * Create a new browser context with options
   */
  async createContext(options?: BrowserOptions): Promise<BrowserContext> {
    try {
      const browser = await this.getBrowser(options);
      const contextOptions = options?.contextOptions || {};

      logBrowserOperation("context_create", {
        contextOptions,
        activeContexts: this.activeContexts.size,
      });

      const context = await browser.newContext(contextOptions);
      this.activeContexts.add(context);

      return context;
    } catch (error) {
      logBrowserError(error as Error, { options });
      throw error;
    }
  }

  /**
   * Close a browser context and remove from tracking
   */
  async closeContext(context: BrowserContext): Promise<void> {
    try {
      await context.close();
      this.activeContexts.delete(context);

      logBrowserOperation("context_close", {
        activeContexts: this.activeContexts.size,
      });
    } catch (error) {
      logBrowserError(error as Error, { context });
      throw error;
    }
  }

  /**
   * Get the number of active contexts
   */
  getActiveContextsCount(): number {
    return this.activeContexts.size;
  }

  /**
   * Clean up all browser instances and contexts
   */
  async cleanup(): Promise<void> {
    try {
      logBrowserOperation("cleanup_start", {
        activeContexts: this.activeContexts.size,
        activeBrowsers: this.activeBrowsers.size,
        usePool: this.usePool,
      });

      // Clean up pool if enabled
      if (this.usePool && this.browserPool) {
        await this.browserPool.cleanup();
      }

      // Close all active contexts
      const contextClosePromises = Array.from(this.activeContexts).map(
        (context) =>
          context.close().catch((error) => {
            logBrowserError(error as Error, { operation: "context_cleanup" });
          })
      );
      await Promise.all(contextClosePromises);
      this.activeContexts.clear();

      // Close all browsers
      const browserClosePromises = Array.from(this.activeBrowsers.values()).map(
        async (activeBrowser) => {
          try {
            const browser = await activeBrowser.browserPromise;
            await browser.close();
          } catch (error) {
            logBrowserError(error as Error, { operation: "browser_cleanup" });
          }
        }
      );
      await Promise.all(browserClosePromises);
      this.activeBrowsers.clear();

      logBrowserOperation("cleanup_complete");
    } catch (error) {
      logBrowserError(error as Error, { operation: "cleanup" });
      throw error;
    }
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(options?: BrowserOptions): Promise<Browser> {
    const engine = this.getEngine(options);
    const launchOptions = this.getLaunchOptions(options);

    try {
      logBrowserOperation("browser_launch_attempt", {
        engine,
        launchOptions,
      });

      const browser = await this.launchWithEngine(engine, launchOptions);

      logBrowserOperation("browser_launch_success", {
        engine,
        version: browser.version(),
      });

      return browser;
    } catch (error) {
      // Try fallback engine if configured
      if (options?.fallback && options.fallbackOnTimeout) {
        browserLogger.warn(
          { error: error instanceof Error ? error.message : error, engine },
          `Browser launch failed, trying fallback: ${options.fallback}`
        );

        try {
          const fallbackBrowser = await this.launchWithEngine(
            options.fallback,
            launchOptions
          );

          logBrowserOperation("browser_launch_fallback_success", {
            originalEngine: engine,
            fallbackEngine: options.fallback,
            version: fallbackBrowser.version(),
          });

          return fallbackBrowser;
        } catch (fallbackError) {
          logBrowserError(fallbackError as Error, {
            operation: "browser_launch_fallback",
            engine: options.fallback,
          });
          throw fallbackError;
        }
      }

      logBrowserError(error as Error, { operation: "browser_launch", engine });
      throw error;
    }
  }

  /**
   * Launch browser with specific engine
   */
  private async launchWithEngine(
    engine: BrowserEngine,
    launchOptions: Record<string, unknown>
  ): Promise<Browser> {
    switch (engine) {
      case "chromium":
        return await chromium.launch(launchOptions);
      case "firefox":
        return await firefox.launch(launchOptions);
      case "webkit":
        return await webkit.launch(launchOptions);
      default:
        throw new Error(`Unsupported browser engine: ${engine}`);
    }
  }

  /**
   * Connect to browser via CDP
   */
  private async connectToCDP(cdpUrl: string): Promise<Browser> {
    try {
      logBrowserOperation("browser_cdp_connect", { cdpUrl });

      // Use chromium for CDP connections (default)
      const browser = await chromium.connect(cdpUrl);

      logBrowserOperation("browser_cdp_connect_success", {
        cdpUrl,
        version: browser.version(),
      });

      return browser;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "browser_cdp_connect",
        cdpUrl,
      });
      throw error;
    }
  }

  /**
   * Get browser engine from options
   */
  private getEngine(options?: BrowserOptions): BrowserEngine {
    if (options && "engine" in options && options.engine) {
      return options.engine;
    }
    if (options?.primary) {
      return options.primary;
    }
    return "chromium"; // Default engine
  }

  /**
   * Get launch options from browser options
   */
  private getLaunchOptions(options?: BrowserOptions): Record<string, unknown> {
    if (options && "launchOptions" in options && options.launchOptions) {
      return options.launchOptions as Record<string, unknown>;
    }
    return {
      headless: false,
      args: ["--disable-gpu", "--disable-blink-features=AutomationControlled"],
    };
  }
}
