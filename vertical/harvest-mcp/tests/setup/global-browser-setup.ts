/**
 * Global browser setup and teardown for test suites
 * Manages shared browser instances to reduce resource usage
 */

import { type Browser, type BrowserContext, chromium } from "playwright";
import { TEST_BROWSER_DEFAULTS } from "./browser-defaults.js";

// Global browser instance shared across tests
let globalBrowser: Browser | null = null;
let globalContext: BrowserContext | null = null;

export async function setupBrowser(): Promise<void> {
  if (!globalBrowser) {
    console.log("[Global Browser Setup] Launching shared browser instance...");
    globalBrowser = await chromium.launch({
      headless: TEST_BROWSER_DEFAULTS.headless,
      args: TEST_BROWSER_DEFAULTS.args,
      timeout: TEST_BROWSER_DEFAULTS.timeout,
    });
    console.log("[Global Browser Setup] Browser launched successfully");
  }
}

export async function teardownBrowser(): Promise<void> {
  if (globalContext) {
    await globalContext.close();
    globalContext = null;
  }

  if (globalBrowser) {
    console.log("[Global Browser Setup] Closing shared browser instance...");
    await globalBrowser.close();
    globalBrowser = null;
    console.log("[Global Browser Setup] Browser closed successfully");
  }
}

// For tests that need isolated contexts but shared browser
