import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import type { MockedFunction } from "vitest";
import { vi } from "vitest";
import { cleanupTestBrowserPool } from "../../src/browser/BrowserPool.js";
import { resetLLMClient } from "../../src/core/LLMClient.js";
import { setupBrowser, teardownBrowser } from "./global-browser-setup.js";

// Load .env file if it exists
function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");

    // Parse .env file
    for (const line of envContent.split("\n")) {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith("#")) {
        const [key, ...valueParts] = trimmedLine.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").trim();
          // Only set if not already defined
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
          }
        }
      }
    }

    // Map standard env vars to HARVEST_ prefixed ones for the config system
    if (process.env.OPENAI_API_KEY && !process.env.HARVEST_OPENAI_API_KEY) {
      process.env.HARVEST_OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    }
    if (process.env.GOOGLE_API_KEY && !process.env.HARVEST_GOOGLE_API_KEY) {
      process.env.HARVEST_GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    }
    if (process.env.LLM_PROVIDER && !process.env.HARVEST_LLM_PROVIDER) {
      process.env.HARVEST_LLM_PROVIDER = process.env.LLM_PROVIDER;
    }
    if (process.env.LLM_MODEL && !process.env.HARVEST_LLM_MODEL) {
      process.env.HARVEST_LLM_MODEL = process.env.LLM_MODEL;
    }
  }
}

// Global test environment setup
beforeAll(async () => {
  // Load .env configuration
  loadDotEnv();

  // Set test environment variables (only if not already set from .env)
  process.env.NODE_ENV = "test";

  // Fallback test API key only if no real keys are configured
  if (
    !process.env.HARVEST_OPENAI_API_KEY &&
    !process.env.HARVEST_GOOGLE_API_KEY
  ) {
    process.env.HARVEST_OPENAI_API_KEY = "test-api-key-for-testing";
  }

  // Setup shared browser instance for tests
  await setupBrowser();
});

afterAll(async () => {
  // Clean up shared browser resources
  await teardownBrowser();
  await cleanupTestBrowserPool();
});

// Reset LLM client after each test to ensure test isolation
afterEach(() => {
  resetLLMClient();
});

// Make vi available globally for test files that need it
// Note: vi is already declared globally by vitest when globals: true is set

// Custom matchers and utilities
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be a valid UUID`
          : `Expected ${received} to be a valid UUID`,
    };
  },
});

// Enhanced mock utilities
export const createMockWithImplementation = <
  T extends (...args: unknown[]) => unknown,
>(
  implementation: T
): MockedFunction<T> => {
  return vi.fn(implementation) as MockedFunction<T>;
};

// Test data helpers
export const createTestSessionData = (
  overrides: Partial<{
    harPath: string;
    prompt: string;
    cookiePath?: string;
    inputVariables?: Record<string, string>;
  }> = {}
) => ({
  harPath: "tests/fixtures/test-data/pangea_search.har",
  prompt: "test analysis prompt",
  cookiePath: "tests/fixtures/test-data/pangea_cookies.json",
  inputVariables: { query: "test" },
  ...overrides,
});

export const generateValidUUID = (): string => {
  return "123e4567-e89b-12d3-a456-426614174000";
};
