/**
 * Agent factory for Harvest MCP
 * Adapted from magnitude-mcp, simplified for harvest-mcp use case
 * Creates and configures browser agents with proper resource management
 */

import type { Page } from "playwright";
import { logBrowserError, logBrowserOperation } from "../utils/logger.js";
import { getTestBrowserPool } from "./BrowserPool.js";
import { BrowserProvider } from "./BrowserProvider.js";
import type {
  BrowserAgentConfig,
  BrowserOptions,
  BrowserSessionData,
} from "./types.js";

export class AgentFactory {
  private browserProvider: BrowserProvider;

  constructor() {
    this.browserProvider = new BrowserProvider();

    // Enable browser pooling in test environments
    if (process.env.NODE_ENV === "test") {
      this.browserProvider.enablePooling(getTestBrowserPool());
      logBrowserOperation("agent_factory_created", { poolingEnabled: true });
    } else {
      logBrowserOperation("agent_factory_created", { poolingEnabled: false });
    }
  }

  /**
   * Create a new browser session with the given configuration
   */
  async createBrowserSession(
    config: BrowserAgentConfig,
    browserOptions?: BrowserOptions
  ): Promise<BrowserSessionData> {
    try {
      logBrowserOperation("agent_creation_start", {
        config,
        browserOptions: browserOptions ? "provided" : "default",
      });

      // Get or create browser instance
      const browser = await this.browserProvider.getBrowser(browserOptions);

      logBrowserOperation("browser_obtained", {
        version: browser.version(),
      });

      // Create browser context with options
      const context = await this.browserProvider.createContext(browserOptions);

      logBrowserOperation("context_created", {
        activeContexts: this.browserProvider.getActiveContextsCount(),
      });

      let page: Page | undefined;
      try {
        // Create new page in the context
        page = await context.newPage();

        logBrowserOperation("page_created", {
          url: page.url(),
        });

        // Navigate to URL if provided
        if (config.url) {
          await page.goto(config.url);
          logBrowserOperation("page_navigated", {
            url: config.url,
            finalUrl: page.url(),
          });
        }

        // Return browser session data
        const browserSessionData: BrowserSessionData = {
          page,
          context,
          browser,
        };

        logBrowserOperation("browser_session_created", {
          url: page.url(),
          isReady: !page.isClosed() && browser.isConnected(),
        });

        return browserSessionData;
      } catch (error) {
        // Cleanup on failure
        if (page) {
          try {
            await page.close();
          } catch (cleanupError) {
            logBrowserError(cleanupError as Error, {
              operation: "page_cleanup",
            });
          }
        }

        try {
          await context.close();
        } catch (cleanupError) {
          logBrowserError(cleanupError as Error, {
            operation: "context_cleanup",
          });
        }

        throw error;
      }
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "agent_creation",
        config,
        browserOptions: browserOptions ? "provided" : "default",
      });
      throw error;
    }
  }

  /**
   * Create multiple browser sessions concurrently
   */
  async createBrowserSessions(
    configs: BrowserAgentConfig[],
    browserOptions?: BrowserOptions
  ): Promise<BrowserSessionData[]> {
    try {
      logBrowserOperation("bulk_agent_creation_start", {
        count: configs.length,
      });

      const sessionPromises = configs.map((config) =>
        this.createBrowserSession(config, browserOptions)
      );

      const sessions = await Promise.all(sessionPromises);

      logBrowserOperation("bulk_session_creation_complete", {
        count: sessions.length,
        successCount: sessions.length,
      });

      return sessions;
    } catch (error) {
      logBrowserError(error as Error, {
        operation: "bulk_agent_creation",
        configCount: configs.length,
      });
      throw error;
    }
  }

  /**
   * Cleanup all resources managed by this factory
   */
  async cleanup(): Promise<void> {
    try {
      logBrowserOperation("factory_cleanup_start");

      await this.browserProvider.cleanup();

      logBrowserOperation("factory_cleanup_complete");
    } catch (error) {
      logBrowserError(error as Error, { operation: "factory_cleanup" });
      throw error;
    }
  }

  /**
   * Get the browser provider instance
   */
  getBrowserProvider(): BrowserProvider {
    return this.browserProvider;
  }
}
