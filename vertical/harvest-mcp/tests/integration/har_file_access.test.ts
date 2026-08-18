import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManualSessionManager } from "../../src/core/ManualSessionManager.js";
import type {
  BrowserSessionInfo,
  SessionConfig,
  SessionStopResult,
} from "../../src/types/index.js";

describe("HAR File Access", () => {
  let sessionManager: ManualSessionManager;
  let testSessionId: string;

  beforeEach(async () => {
    sessionManager = ManualSessionManager.getInstance();
  });

  afterEach(async () => {
    // Clean up any test sessions
    if (testSessionId) {
      try {
        await sessionManager.stopSession(testSessionId, {
          reason: "test_cleanup",
        });
      } catch (_error) {
        // Session might already be stopped
      }
    }
  });

  describe("Manual Session HAR File Creation", () => {
    it("should create HAR files in client-accessible locations", async () => {
      const config: SessionConfig = {
        timeout: 1, // 1 minute for quick test
        url: "https://httpbin.org/get?test=har", // Navigate to a URL that generates network traffic
        browserOptions: {
          headless: true, // Use headless for CI/testing
        },
        artifactConfig: {
          enabled: true,
          saveHar: true,
          saveCookies: false,
          saveScreenshots: false,
        },
      };

      // Start a manual session
      const sessionResult: BrowserSessionInfo =
        await sessionManager.startSession(config);
      testSessionId = sessionResult.id;

      expect(sessionResult.id).toBeDefined();
      expect(sessionResult.outputDir).toBeDefined();

      // Output directory should be in a client-accessible location
      const outputDir = sessionResult.outputDir;
      expect(
        outputDir.includes(".harvest") ||
          outputDir.includes(homedir()) ||
          outputDir.startsWith("/Users/") // For macOS
      ).toBe(true);

      // Allow time for page load and network requests to complete
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Stop the session to generate artifacts
      const stopResult: SessionStopResult = await sessionManager.stopSession(
        testSessionId,
        {
          reason: "test_completion",
          takeScreenshot: false,
        }
      );

      expect(stopResult.id).toBe(testSessionId);
      expect(stopResult.artifacts).toBeDefined();
      expect(stopResult.artifacts.length).toBeGreaterThan(0);

      // Find HAR artifact
      const harArtifact = stopResult.artifacts.find((a) => a.type === "har");
      expect(harArtifact).toBeDefined();

      if (harArtifact) {
        // Verify HAR file exists and is accessible
        try {
          await access(harArtifact.path);
          // If we reach here, the file exists and is accessible
        } catch (error) {
          throw new Error(`HAR file is not accessible: ${error}`);
        }

        // Verify file has content
        const stats = await stat(harArtifact.path);
        expect(stats.size).toBeGreaterThan(0);

        // Verify it's valid JSON
        const harContent = await readFile(harArtifact.path, "utf-8");
        const harData = JSON.parse(harContent);

        expect(harData).toHaveProperty("log");
        expect(harData.log).toHaveProperty("version");
        expect(harData.log).toHaveProperty("entries");
        expect(harData.log.entries).toBeInstanceOf(Array);

        // Verify HAR is in client-accessible location
        expect(
          harArtifact.path.includes(".harvest") ||
            harArtifact.path.includes(homedir())
        ).toBe(true);
      }

      testSessionId = ""; // Mark as cleaned up
    }, 10000); // 10 second timeout for manual session operations

    it("should handle path translation correctly", async () => {
      const config: SessionConfig = {
        timeout: 1,
        url: "https://httpbin.org/json", // Navigate to a URL that generates network traffic
        browserOptions: { headless: true },
        artifactConfig: {
          enabled: true,
          saveHar: true,
          // Explicitly request client-accessible directory
          outputDir: join(homedir(), ".harvest", "test-artifacts"),
        },
      };

      const sessionResult: BrowserSessionInfo =
        await sessionManager.startSession(config);
      testSessionId = sessionResult.id;

      // Verify the output directory is client-accessible
      expect(sessionResult.outputDir).toContain(".harvest");

      // Allow time for network activity to be captured
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const stopResult: SessionStopResult = await sessionManager.stopSession(
        testSessionId,
        {
          reason: "test_completion",
        }
      );

      expect(stopResult.id).toBe(testSessionId);

      const harArtifact = stopResult.artifacts.find((a) => a.type === "har");
      if (harArtifact) {
        // Path should be in the requested location
        expect(harArtifact.path).toContain(".harvest");

        // File should be accessible
        try {
          await access(harArtifact.path);
          // If we reach here, the file exists and is accessible
        } catch (error) {
          throw new Error(`HAR file is not accessible: ${error}`);
        }
      }

      testSessionId = "";
    }, 10000);

    it("should survive session cleanup policies", async () => {
      const config: SessionConfig = {
        timeout: 1,
        url: "https://httpbin.org/get?test=survival", // Navigate to a URL that generates network traffic
        browserOptions: { headless: true },
        artifactConfig: { enabled: true, saveHar: true },
      };

      const sessionResult: BrowserSessionInfo =
        await sessionManager.startSession(config);
      testSessionId = sessionResult.id;

      // Allow time for network requests to be captured
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const stopResult = await sessionManager.stopSession(testSessionId, {
        reason: "test_completion",
      });

      const harArtifact = stopResult.artifacts.find((a) => a.type === "har");
      expect(harArtifact).toBeDefined();

      if (harArtifact) {
        // File should exist immediately after session stop
        try {
          await access(harArtifact.path);
          // If we reach here, the file exists and is accessible
        } catch (error) {
          throw new Error(`HAR file is not accessible: ${error}`);
        }

        // File should still exist after some time (testing extended cleanup timeout)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          await access(harArtifact.path);
          // If we reach here, the file exists and is accessible
        } catch (error) {
          throw new Error(`HAR file is not accessible after delay: ${error}`);
        }

        // Verify file content is still valid
        const harContent = await readFile(harArtifact.path, "utf-8");
        const harData = JSON.parse(harContent);
        expect(harData.log.entries).toBeInstanceOf(Array);
      }

      testSessionId = "";
    }, 10000);
  });

  describe("Path Translation Robustness", () => {
    it("should handle fallback paths when primary path fails", async () => {
      const config: SessionConfig = {
        timeout: 1,
        url: "https://httpbin.org/user-agent", // Navigate to a URL that generates network traffic
        browserOptions: { headless: true },
        artifactConfig: {
          enabled: true,
          saveHar: true,
          // Try to use a potentially problematic path
          outputDir: "/invalid/path/that/should/fallback",
        },
      };

      // Should not fail even with invalid path
      const sessionResult: BrowserSessionInfo =
        await sessionManager.startSession(config);
      testSessionId = sessionResult.id;

      expect(sessionResult.id).toBeDefined();
      expect(sessionResult.outputDir).toBeDefined();

      // Should have fallen back to a valid path
      expect(sessionResult.outputDir).not.toBe(
        "/invalid/path/that/should/fallback"
      );

      // Allow time for network requests to be captured
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const stopResult: SessionStopResult = await sessionManager.stopSession(
        testSessionId,
        {
          reason: "test_completion",
        }
      );

      expect(stopResult.id).toBe(testSessionId);

      const harArtifact = stopResult.artifacts.find((a) => a.type === "har");
      if (harArtifact) {
        // Should be accessible despite path issues
        try {
          await access(harArtifact.path);
          // If we reach here, the file exists and is accessible
        } catch (error) {
          throw new Error(`HAR file is not accessible: ${error}`);
        }
      }

      testSessionId = "";
    }, 10000);
  });

  describe("Error Handling", () => {
    it("should provide meaningful errors when HAR access fails", async () => {
      // Test session that we'll force to fail
      const config: SessionConfig = {
        timeout: 1,
        url: "https://httpbin.org/status/200", // Navigate to a URL that generates network traffic
        browserOptions: { headless: true },
        artifactConfig: { enabled: true, saveHar: true },
      };

      const sessionResult: BrowserSessionInfo =
        await sessionManager.startSession(config);
      testSessionId = sessionResult.id;

      // Allow time for network activity before forcing stop
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force stop without proper cleanup
      try {
        const stopResult = await sessionManager.stopSession(testSessionId, {
          reason: "forced_test_stop",
        });

        // Even forced stops should provide some artifacts
        expect(stopResult).toHaveProperty("artifacts");
        expect(stopResult.artifacts).toBeInstanceOf(Array);
      } catch (error) {
        // Error should be informative
        expect((error as Error).message).toContain("session");
        expect(typeof (error as Error).message).toBe("string");
        expect((error as Error).message.length).toBeGreaterThan(0);
      }

      testSessionId = "";
    }, 10000);
  });
});
