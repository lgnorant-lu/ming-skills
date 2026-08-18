/**
 * Browser pool for efficient resource management
 * Manages a pool of browser instances and contexts for reuse
 */

import {
  type Browser,
  type BrowserContext,
  chromium,
  firefox,
  webkit,
} from "playwright";
import { logBrowserError, logBrowserOperation } from "../utils/logger.js";
import type { BrowserEngine, BrowserOptions } from "./types.js";

interface PooledBrowser {
  browser: Browser;
  engine: BrowserEngine;
  createdAt: number;
  lastUsed: number;
  useCount: number;
}

interface PooledContext {
  context: BrowserContext;
  browserId: string;
  createdAt: number;
  inUse: boolean;
}

export interface BrowserPoolOptions {
  maxBrowsers?: number;
  maxContextsPerBrowser?: number;
  browserTTL?: number; // Time to live in milliseconds
  contextTTL?: number;
  cleanupInterval?: number;
}

export class BrowserPool {
  private browsers = new Map<string, PooledBrowser>();
  private contexts = new Map<string, PooledContext>();
  private cleanupTimer?: NodeJS.Timeout | undefined;

  private readonly options: Required<BrowserPoolOptions> = {
    maxBrowsers: 3,
    maxContextsPerBrowser: 5,
    browserTTL: 5 * 60 * 1000, // 5 minutes
    contextTTL: 2 * 60 * 1000, // 2 minutes
    cleanupInterval: 60 * 1000, // 1 minute
  };

  constructor(options?: BrowserPoolOptions) {
    this.options = { ...this.options, ...options };
    this.startCleanupTimer();
  }

  /**
   * Get or create a browser instance from the pool
   */
  async getBrowser(options?: BrowserOptions): Promise<Browser> {
    const engine = this.getEngine(options);

    // Try to find an existing browser of the same engine
    for (const [id, pooledBrowser] of this.browsers) {
      if (
        pooledBrowser.engine === engine &&
        pooledBrowser.browser.isConnected()
      ) {
        pooledBrowser.lastUsed = Date.now();
        pooledBrowser.useCount++;

        logBrowserOperation("browser_pool_reuse", {
          browserId: id,
          engine,
          useCount: pooledBrowser.useCount,
        });

        return pooledBrowser.browser;
      }
    }

    // Create new browser if none available
    if (this.browsers.size >= this.options.maxBrowsers) {
      // Remove least recently used browser
      await this.evictLRUBrowser();
    }

    const browser = await this.launchBrowser(engine, options);
    const browserId = this.generateId();

    this.browsers.set(browserId, {
      browser,
      engine,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      useCount: 1,
    });

    logBrowserOperation("browser_pool_create", {
      browserId,
      engine,
      poolSize: this.browsers.size,
    });

    return browser;
  }

  /**
   * Get or create a browser context from the pool
   */
  async getContext(options?: BrowserOptions): Promise<BrowserContext> {
    // Try to find an available context
    for (const [id, pooledContext] of this.contexts) {
      if (!pooledContext.inUse) {
        const browser = this.getBrowserById(pooledContext.browserId);
        if (browser?.isConnected()) {
          pooledContext.inUse = true;

          logBrowserOperation("context_pool_reuse", {
            contextId: id,
            browserId: pooledContext.browserId,
          });

          return pooledContext.context;
        }
      }
    }

    // Create new context
    const browser = await this.getBrowser(options);
    const browserId = this.findBrowserId(browser);

    if (!browserId) {
      throw new Error("Browser not found in pool");
    }

    // Check context limit per browser
    const browserContexts = Array.from(this.contexts.values()).filter(
      (c) => c.browserId === browserId
    ).length;

    if (browserContexts >= this.options.maxContextsPerBrowser) {
      // Use a different browser or create new one
      const newBrowser = await this.getBrowser(options);
      const newBrowserId = this.findBrowserId(newBrowser);
      if (!newBrowserId) {
        throw new Error("Failed to create new browser");
      }
      return this.createContext(newBrowser, newBrowserId, options);
    }

    return this.createContext(browser, browserId, options);
  }

  /**
   * Release a context back to the pool
   */
  async releaseContext(context: BrowserContext): Promise<void> {
    for (const [id, pooledContext] of this.contexts) {
      if (pooledContext.context === context) {
        pooledContext.inUse = false;

        logBrowserOperation("context_pool_release", {
          contextId: id,
        });

        return;
      }
    }
  }

  /**
   * Close a context and remove from pool
   */
  async closeContext(context: BrowserContext): Promise<void> {
    for (const [id, pooledContext] of this.contexts) {
      if (pooledContext.context === context) {
        try {
          await context.close();
        } catch (error) {
          logBrowserError(error as Error, { operation: "context_close" });
        }

        this.contexts.delete(id);

        logBrowserOperation("context_pool_close", {
          contextId: id,
          remainingContexts: this.contexts.size,
        });

        return;
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const activeBrowsers = Array.from(this.browsers.values()).filter((b) =>
      b.browser.isConnected()
    ).length;

    const activeContexts = Array.from(this.contexts.values()).filter(
      (c) => c.inUse
    ).length;

    const availableContexts = this.contexts.size - activeContexts;

    return {
      browsers: {
        total: this.browsers.size,
        active: activeBrowsers,
        max: this.options.maxBrowsers,
      },
      contexts: {
        total: this.contexts.size,
        active: activeContexts,
        available: availableContexts,
        maxPerBrowser: this.options.maxContextsPerBrowser,
      },
    };
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    this.stopCleanupTimer();

    // Close all contexts
    for (const [, pooledContext] of this.contexts) {
      try {
        await pooledContext.context.close();
      } catch (error) {
        logBrowserError(error as Error, { operation: "cleanup_context" });
      }
    }
    this.contexts.clear();

    // Close all browsers
    for (const [, pooledBrowser] of this.browsers) {
      try {
        await pooledBrowser.browser.close();
      } catch (error) {
        logBrowserError(error as Error, { operation: "cleanup_browser" });
      }
    }
    this.browsers.clear();

    logBrowserOperation("browser_pool_cleanup", {
      message: "All resources cleaned up",
    });
  }

  private async createContext(
    browser: Browser,
    browserId: string,
    options?: BrowserOptions
  ): Promise<BrowserContext> {
    const contextOptions = options?.contextOptions || {};
    const context = await browser.newContext(contextOptions);
    const contextId = this.generateId();

    this.contexts.set(contextId, {
      context,
      browserId,
      createdAt: Date.now(),
      inUse: true,
    });

    logBrowserOperation("context_pool_create", {
      contextId,
      browserId,
      poolSize: this.contexts.size,
    });

    return context;
  }

  private async launchBrowser(
    engine: BrowserEngine,
    _options?: BrowserOptions
  ): Promise<Browser> {
    const launchOptions = {};

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

  private getEngine(options?: BrowserOptions): BrowserEngine {
    if (options && "engine" in options && options.engine) {
      return options.engine;
    }
    return "chromium"; // default
  }

  private getBrowserById(id: string): Browser | undefined {
    return this.browsers.get(id)?.browser;
  }

  private findBrowserId(browser: Browser): string | undefined {
    for (const [id, pooledBrowser] of this.browsers) {
      if (pooledBrowser.browser === browser) {
        return id;
      }
    }
    return undefined;
  }

  private async evictLRUBrowser(): Promise<void> {
    let lruId: string | null = null;
    let lruTime = Number.POSITIVE_INFINITY;

    for (const [id, pooledBrowser] of this.browsers) {
      if (pooledBrowser.lastUsed < lruTime) {
        lruTime = pooledBrowser.lastUsed;
        lruId = id;
      }
    }

    if (lruId) {
      const pooledBrowser = this.browsers.get(lruId);
      if (pooledBrowser) {
        // Close all contexts for this browser
        for (const [contextId, pooledContext] of this.contexts) {
          if (pooledContext.browserId === lruId) {
            try {
              await pooledContext.context.close();
            } catch (error) {
              logBrowserError(error as Error, { operation: "evict_context" });
            }
            this.contexts.delete(contextId);
          }
        }

        // Close the browser
        try {
          await pooledBrowser.browser.close();
        } catch (error) {
          logBrowserError(error as Error, { operation: "evict_browser" });
        }

        this.browsers.delete(lruId);

        logBrowserOperation("browser_pool_evict", {
          browserId: lruId,
          reason: "LRU",
        });
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.options.cleanupInterval);
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private async performCleanup(): Promise<void> {
    const now = Date.now();

    // Clean up expired contexts
    for (const [id, pooledContext] of this.contexts) {
      if (
        !pooledContext.inUse &&
        now - pooledContext.createdAt > this.options.contextTTL
      ) {
        try {
          await pooledContext.context.close();
        } catch (error) {
          logBrowserError(error as Error, {
            operation: "cleanup_expired_context",
          });
        }
        this.contexts.delete(id);

        logBrowserOperation("context_pool_expire", {
          contextId: id,
          age: now - pooledContext.createdAt,
        });
      }
    }

    // Clean up expired browsers
    for (const [id, pooledBrowser] of this.browsers) {
      if (now - pooledBrowser.lastUsed > this.options.browserTTL) {
        // Check if any contexts are still using this browser
        const hasActiveContexts = Array.from(this.contexts.values()).some(
          (c) => c.browserId === id && c.inUse
        );

        if (!hasActiveContexts) {
          // Close all contexts for this browser
          for (const [contextId, pooledContext] of this.contexts) {
            if (pooledContext.browserId === id) {
              try {
                await pooledContext.context.close();
              } catch (error) {
                logBrowserError(error as Error, {
                  operation: "cleanup_browser_context",
                });
              }
              this.contexts.delete(contextId);
            }
          }

          // Close the browser
          try {
            await pooledBrowser.browser.close();
          } catch (error) {
            logBrowserError(error as Error, {
              operation: "cleanup_expired_browser",
            });
          }

          this.browsers.delete(id);

          logBrowserOperation("browser_pool_expire", {
            browserId: id,
            age: now - pooledBrowser.lastUsed,
          });
        }
      }
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance for test environments
let testBrowserPool: BrowserPool | null = null;

export function getTestBrowserPool(): BrowserPool {
  if (!testBrowserPool) {
    testBrowserPool = new BrowserPool({
      maxBrowsers: 2,
      maxContextsPerBrowser: 3,
      browserTTL: 10 * 60 * 1000, // 10 minutes for tests
      contextTTL: 5 * 60 * 1000, // 5 minutes for tests
    });
  }
  return testBrowserPool;
}

export async function cleanupTestBrowserPool(): Promise<void> {
  if (testBrowserPool) {
    await testBrowserPool.cleanup();
    testBrowserPool = null;
  }
}
