/**
 * Tests for BrowserProvider - browser instance management
 * Following TDD approach - write tests first, then implement
 */

import type { Browser, BrowserContext } from "playwright";
import { describe, expect, test } from "vitest";
import { BrowserProvider } from "../../../src/browser/BrowserProvider.js";
import type { BrowserOptions } from "../../../src/browser/types.js";

describe("BrowserProvider", () => {
  test("should create BrowserProvider instance", () => {
    const provider = new BrowserProvider();
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(BrowserProvider);
  });

  test("should support existing browser instance", async () => {
    const provider = new BrowserProvider();

    // Create a minimal mock browser that implements the needed interface
    const mockBrowser = {
      contexts: () => [],
      close: async () => {
        /* Mock implementation */
      },
      isConnected: () => true,
      newContext: async () => ({
        close: async () => {
          /* Mock implementation */
        },
        newPage: async () => ({}),
      }),
      newPage: async () => ({}),
      version: () => "1.0.0",
    } as unknown as Browser;

    const options: BrowserOptions = {
      instance: mockBrowser,
    };

    const browser = await provider.getBrowser(options);
    expect(browser).toBe(mockBrowser);
  });

  test("should track active contexts count initially", () => {
    const provider = new BrowserProvider();
    expect(provider.getActiveContextsCount()).toBe(0);
  });

  test("should create new context with existing browser", async () => {
    const provider = new BrowserProvider();

    const mockContext = {
      close: async () => {
        /* Mock implementation */
      },
      newPage: async () => ({}),
    } as unknown as BrowserContext;

    const mockBrowser = {
      contexts: () => [],
      close: async () => {
        /* Mock implementation */
      },
      isConnected: () => true,
      newContext: async (_options: unknown) => mockContext,
      newPage: async () => ({}),
      version: () => "1.0.0",
    } as unknown as Browser;

    const browserOptions: BrowserOptions = {
      instance: mockBrowser,
      contextOptions: {
        viewport: { width: 1280, height: 720 },
        userAgent: "test-agent",
      },
    };

    const context = await provider.createContext(browserOptions);
    expect(context).toBe(mockContext);
    expect(provider.getActiveContextsCount()).toBe(1);
  });

  test("should track active contexts after creation and cleanup", async () => {
    const provider = new BrowserProvider();

    const mockContext = {
      close: async () => {
        /* Mock implementation */
      },
      newPage: async () => ({}),
    } as unknown as BrowserContext;

    const mockBrowser = {
      contexts: () => [],
      close: async () => {
        /* Mock implementation */
      },
      isConnected: () => true,
      newContext: async () => mockContext,
      newPage: async () => ({}),
      version: () => "1.0.0",
    } as unknown as Browser;

    const options: BrowserOptions = {
      instance: mockBrowser,
    };

    // Create context and check count
    await provider.createContext(options);
    expect(provider.getActiveContextsCount()).toBe(1);

    // Close context and check count
    await provider.closeContext(mockContext);
    expect(provider.getActiveContextsCount()).toBe(0);
  });

  test("should handle cleanup with no active contexts", async () => {
    const provider = new BrowserProvider();
    // Cleanup should not throw when there are no active contexts
    await expect(provider.cleanup()).resolves.toBeUndefined();
  });

  test("should handle cleanup with active contexts", async () => {
    const provider = new BrowserProvider();

    const mockContext = {
      close: async () => {
        /* Mock implementation */
      },
      newPage: async () => ({}),
    } as unknown as BrowserContext;

    const mockBrowser = {
      contexts: () => [],
      close: async () => {
        /* Mock implementation */
      },
      isConnected: () => true,
      newContext: async () => mockContext,
      newPage: async () => ({}),
      version: () => "1.0.0",
    } as unknown as Browser;

    const options: BrowserOptions = {
      instance: mockBrowser,
    };

    // Create a context
    await provider.createContext(options);
    expect(provider.getActiveContextsCount()).toBe(1);

    // Cleanup should close all contexts
    await provider.cleanup();
    expect(provider.getActiveContextsCount()).toBe(0);
  });

  // Note: Tests for actual browser launching with playwright engines
  // will be tested in integration tests with real browser instances
});
