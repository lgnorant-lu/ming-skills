/**
 * Tests for browser types and interfaces
 * Following TDD approach - these tests should pass after Sprint 1
 */

import { describe, expect, test } from "vitest";
import type {
  Artifact,
  ArtifactCollection,
  BrowserAgentConfig,
  BrowserEngine,
  BrowserOptions,
  BrowserSessionInfo,
  SessionConfig,
  SessionStopResult,
} from "../../../src/browser/types.js";
import {
  DEFAULT_BROWSER_OPTIONS,
  VIEWPORT_SIZES,
} from "../../../src/browser/types.js";

describe("Browser Types", () => {
  describe("BrowserEngine", () => {
    test("should accept valid browser engines", () => {
      const engines: BrowserEngine[] = ["chromium", "firefox", "webkit"];

      for (const engine of engines) {
        expect(["chromium", "firefox", "webkit"]).toContain(engine);
      }
    });
  });

  describe("BrowserOptions", () => {
    test("should support browser instance option", () => {
      // Mock browser instance for type checking
      const mockBrowser = {} as any;

      const options: BrowserOptions = {
        instance: mockBrowser,
        contextOptions: {
          viewport: { width: 1280, height: 720 },
        },
      };

      expect(options).toBeDefined();
      expect("instance" in options).toBe(true);
    });

    test("should support launch options", () => {
      const options: BrowserOptions = {
        launchOptions: {
          headless: false,
          args: ["--disable-gpu"],
        },
        engine: "chromium",
      };

      expect(options).toBeDefined();
      expect("launchOptions" in options).toBe(true);
    });

    test("should support CDP connection", () => {
      const options: BrowserOptions = {
        cdp: "ws://localhost:9222/devtools/browser/123",
        contextOptions: {
          viewport: { width: 1024, height: 768 },
        },
      };

      expect(options).toBeDefined();
      expect("cdp" in options).toBe(true);
    });
  });

  describe("BrowserAgentConfig", () => {
    test("should have optional properties with correct types", () => {
      const config: BrowserAgentConfig = {
        url: "https://example.com",
        browserOptions: {
          headless: true,
          viewport: {
            width: 1280,
            height: 720,
          },
          contextOptions: {
            deviceScaleFactor: 1,
          },
        },
      };

      expect(config.url).toBe("https://example.com");
      expect(config.browserOptions?.headless).toBe(true);
      expect(config.browserOptions?.viewport?.width).toBe(1280);
      expect(config.browserOptions?.contextOptions?.deviceScaleFactor).toBe(1);
    });

    test("should work with minimal configuration", () => {
      const config: BrowserAgentConfig = {};

      expect(config).toBeDefined();
      expect(config.url).toBeUndefined();
      expect(config.browserOptions).toBeUndefined();
    });
  });

  describe("Artifact types", () => {
    test("should support all artifact types", () => {
      const harArtifact: Artifact = {
        type: "har",
        path: "/path/to/file.har",
        size: 1024,
        timestamp: "2023-01-01T00:00:00Z",
      };

      const cookieArtifact: Artifact = {
        type: "cookies",
        path: "/path/to/cookies.json",
      };

      const screenshotArtifact: Artifact = {
        type: "screenshot",
        path: "/path/to/screenshot.png",
        size: 2048,
      };

      const logArtifact: Artifact = {
        type: "log",
        path: "/path/to/log.txt",
      };

      expect(harArtifact.type).toBe("har");
      expect(cookieArtifact.type).toBe("cookies");
      expect(screenshotArtifact.type).toBe("screenshot");
      expect(logArtifact.type).toBe("log");
    });

    test("should create valid artifact collection", () => {
      const collection: ArtifactCollection = {
        artifacts: [
          {
            type: "har",
            path: "/path/to/file.har",
            size: 1024,
          },
        ],
        outputDir: "/path/to/output",
        summary: "Test collection with 1 artifact",
      };

      expect(collection.artifacts).toHaveLength(1);
      expect(collection.outputDir).toBe("/path/to/output");
    });
  });

  describe("Session types", () => {
    test("should create valid session config", () => {
      const config: SessionConfig = {
        url: "https://example.com",
        timeout: 30,
        browserOptions: {
          headless: false,
          viewport: { width: 1280, height: 720 },
        },
        artifactConfig: {
          enabled: true,
          saveHar: true,
          saveCookies: true,
          saveScreenshots: true,
          autoScreenshotInterval: 10,
        },
      };

      expect(config.url).toBe("https://example.com");
      expect(config.timeout).toBe(30);
      expect(config.artifactConfig?.enabled).toBe(true);
    });

    test("should create session info with required fields", () => {
      const info: BrowserSessionInfo = {
        id: "session-123",
        startTime: Date.now(),
        duration: 1000,
        outputDir: "/path/to/output",
        artifactConfig: {
          enabled: true,
        },
        instructions: ["Step 1", "Step 2"],
      };

      expect(info.id).toBe("session-123");
      expect(typeof info.startTime).toBe("number");
      expect(info.duration).toBe(1000);
      expect(info.instructions).toHaveLength(2);
    });

    test("should create session stop result", () => {
      const result: SessionStopResult = {
        id: "session-123",
        duration: 5000,
        artifacts: [],
        summary: "Session completed successfully",
        metadata: {
          networkRequestCount: 10,
          totalArtifacts: 3,
          sessionDurationMs: 5000,
        },
      };

      expect(result.id).toBe("session-123");
      expect(result.metadata.networkRequestCount).toBe(10);
    });
  });

  describe("Constants", () => {
    test("should have default browser options", () => {
      expect(DEFAULT_BROWSER_OPTIONS).toBeDefined();
      expect(DEFAULT_BROWSER_OPTIONS.headless).toBe(false);
      expect(Array.isArray(DEFAULT_BROWSER_OPTIONS.args)).toBe(true);
    });

    test("should have predefined viewport sizes", () => {
      expect(VIEWPORT_SIZES.DESKTOP).toEqual({ width: 1280, height: 720 });
      expect(VIEWPORT_SIZES.LAPTOP).toEqual({ width: 1024, height: 768 });
      expect(VIEWPORT_SIZES.TABLET).toEqual({ width: 768, height: 1024 });
      expect(VIEWPORT_SIZES.MOBILE).toEqual({ width: 375, height: 667 });
    });
  });
});
