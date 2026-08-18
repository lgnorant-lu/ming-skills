/**
 * Tests for browser logging infrastructure
 * Following TDD approach - these tests should pass after Sprint 1
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("Browser Logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods to capture log output in tests
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // Empty implementation to capture log output in tests
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test("should be able to import logger", async () => {
    // This test ensures the logger module can be imported without errors
    const loggerModule = await import("../../../src/utils/logger.js");

    expect(loggerModule.logger).toBeDefined();
    expect(loggerModule.browserLogger).toBeDefined();
    expect(loggerModule.sessionLogger).toBeDefined();
    expect(loggerModule.artifactLogger).toBeDefined();
    expect(loggerModule.providerLogger).toBeDefined();
  });

  test("should create component logger", async () => {
    const { createComponentLogger } = await import(
      "../../../src/utils/logger.js"
    );

    const componentLogger = createComponentLogger("test-component");
    expect(componentLogger).toBeDefined();

    // Test that logger can be called (actual logging depends on log level)
    expect(() => componentLogger.info("test message")).not.toThrow();
  });

  test("should create session logger", async () => {
    const { createSessionLogger } = await import(
      "../../../src/utils/logger.js"
    );

    const sessionLogger = createSessionLogger("test-session-123");
    expect(sessionLogger).toBeDefined();

    // Test that logger can be called
    expect(() => sessionLogger.info("session started")).not.toThrow();
  });

  test("should log browser operations", async () => {
    const { logBrowserOperation } = await import(
      "../../../src/utils/logger.js"
    );

    expect(() => {
      logBrowserOperation("browser_launch", {
        headless: false,
        viewport: { width: 1280, height: 720 },
      });
    }).not.toThrow();
  });

  test("should log artifact events", async () => {
    const { logArtifactEvent } = await import("../../../src/utils/logger.js");

    expect(() => {
      logArtifactEvent("collected", "har", {
        size: 1024,
        path: "/path/to/file.har",
      });
    }).not.toThrow();
  });

  test("should log session events", async () => {
    const { logSessionEvent } = await import("../../../src/utils/logger.js");

    expect(() => {
      logSessionEvent("session-123", "started", {
        url: "https://example.com",
      });
    }).not.toThrow();
  });

  test("should log browser errors", async () => {
    const { logBrowserError } = await import("../../../src/utils/logger.js");

    const testError = new Error("Test browser error");

    expect(() => {
      logBrowserError(testError, { sessionId: "session-123" });
    }).not.toThrow();

    // Test with string error
    expect(() => {
      logBrowserError("String error message", { component: "browser-agent" });
    }).not.toThrow();
  });

  test("should handle logger with different log levels", async () => {
    // Test that logger respects log level configuration
    const originalLogLevel = process.env.HARVEST_LOG_LEVEL;

    try {
      // Set to debug level
      process.env.HARVEST_LOG_LEVEL = "debug";

      // Re-import to get logger with new level
      delete require.cache[require.resolve("../../../src/utils/logger.js")];
      const { logger } = await import("../../../src/utils/logger.js");

      expect(() => {
        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");
      }).not.toThrow();
    } finally {
      // Restore original log level
      if (originalLogLevel !== undefined) {
        process.env.HARVEST_LOG_LEVEL = originalLogLevel;
      } else {
        process.env.HARVEST_LOG_LEVEL = undefined;
      }
    }
  });
});
