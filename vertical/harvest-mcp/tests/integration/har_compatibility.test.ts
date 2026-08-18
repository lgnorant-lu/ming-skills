import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHARFile } from "../../src/core/HARParser.js";
import { manualSessionManager } from "../../src/core/ManualSessionManager.js";
import { HarvestMCPServer } from "../../src/server.js";
import {
  handleIsComplete,
  handleStartPrimaryWorkflow,
} from "../../src/tools/analysisTools.js";
import { handleGetUnresolvedNodes } from "../../src/tools/debugTools.js";
import {
  handleSessionDelete,
  handleSessionList,
  handleSessionStart,
} from "../../src/tools/sessionTools.js";
import type { SessionConfig } from "../../src/types/index.js";

/**
 * HAR Compatibility Integration Tests
 *
 * These tests validate Sprint 6 requirement:
 * "Generated HAR files work with existing harvest analysis"
 *
 * Ensures manual session HAR files are fully compatible with
 * harvest-mcp's analysis pipeline and existing tools.
 */
describe("Sprint 6: HAR → Harvest Analysis Compatibility", () => {
  let server: HarvestMCPServer;
  let testOutputDir: string;

  beforeEach(() => {
    server = new HarvestMCPServer();
    testOutputDir = join(tmpdir(), `harvest-har-compat-test-${randomUUID()}`);
  });

  afterEach(async () => {
    // Clean up any active sessions
    const activeSessions = manualSessionManager.listActiveSessions();
    for (const session of activeSessions) {
      try {
        await manualSessionManager.stopSession(session.id, {
          reason: "test_cleanup",
        });
      } catch (_error) {
        // Ignore cleanup errors
      }
    }
  });

  describe("HAR File Compatibility", () => {
    test("should generate HAR files that parse correctly with harvest analysis", async () => {
      // Create a manual session that generates network traffic
      const sessionConfig: SessionConfig = {
        url: "https://httpbin.org/json",
        artifactConfig: {
          enabled: true,
          outputDir: testOutputDir,
          saveHar: true,
          saveCookies: false,
          saveScreenshots: false,
        },
        browserOptions: {
          headless: true,
        },
      };

      const sessionInfo =
        await manualSessionManager.startSession(sessionConfig);

      // Allow time for navigation and network requests
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const result = await manualSessionManager.stopSession(sessionInfo.id, {
        reason: "har_compatibility_test",
      });

      // Verify HAR artifact was created
      const harArtifact = result.artifacts.find((a) => a.type === "har");
      expect(harArtifact).toBeDefined();
      expect(harArtifact?.path).toBeDefined();
      expect(existsSync(harArtifact?.path ?? "")).toBe(true);

      // Test HAR file with harvest's parseHARFile function
      const harPath = harArtifact?.path ?? "";
      const parsedData = await parseHARFile(harPath);

      // Verify parsed data structure matches harvest expectations
      expect(parsedData).toBeDefined();
      expect(parsedData.requests).toBeDefined();
      expect(parsedData.urls).toBeDefined();
      expect(Array.isArray(parsedData.requests)).toBe(true);
      expect(Array.isArray(parsedData.urls)).toBe(true);

      // Verify request structure
      if (parsedData.requests.length > 0) {
        const firstRequest = parsedData.requests[0];
        expect(firstRequest).toBeDefined();
        expect(typeof firstRequest?.url).toBe("string");
        expect(typeof firstRequest?.method).toBe("string");
        expect(firstRequest?.headers).toBeDefined();
        expect(firstRequest?.timestamp).toBeDefined();
      }

      // Verify URLs are extracted
      expect(parsedData.urls.length).toBeGreaterThan(0);
      expect(
        parsedData.urls.every(
          (url) => typeof url === "object" && typeof url.url === "string"
        )
      ).toBe(true);
    }, 20000);

    test("should generate HAR files compatible with harvest analysis session creation", async () => {
      // Generate HAR file from manual session
      const sessionConfig: SessionConfig = {
        url: "https://httpbin.org/get",
        artifactConfig: {
          enabled: true,
          outputDir: testOutputDir,
          saveHar: true,
        },
        browserOptions: {
          headless: true,
        },
      };

      const manualSession =
        await manualSessionManager.startSession(sessionConfig);

      // Allow time for navigation and network activity
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const stopResult = await manualSessionManager.stopSession(
        manualSession.id,
        {
          reason: "harvest_analysis_test",
        }
      );

      const harArtifact = stopResult.artifacts.find((a) => a.type === "har");
      expect(harArtifact?.path).toBeDefined();

      // Try to create a harvest analysis session using the generated HAR
      const analysisResponse = await handleSessionStart(
        {
          harPath: harArtifact?.path ?? "",
          prompt: "Test analysis of manual session generated HAR file",
        },
        server.getSessionToolContext()
      );

      expect(analysisResponse.content).toHaveLength(1);
      const analysisData = JSON.parse(
        analysisResponse.content[0]?.text as string
      );
      expect(analysisData.sessionId).toBeDefined();

      // Verify the analysis session was created successfully
      const sessionListResponse = await handleSessionList(
        server.getSessionToolContext()
      );
      const sessionListData = JSON.parse(
        sessionListResponse.content[0]?.text as string
      );

      const createdSession = sessionListData.sessions.find(
        (s: any) => s.id === analysisData.sessionId
      );
      expect(createdSession).toBeDefined();
      expect(createdSession.isComplete).toBeDefined();

      // Clean up analysis session
      await handleSessionDelete(
        { sessionId: analysisData.sessionId },
        server.getSessionToolContext()
      );
    }, 25000);

    test("should generate HAR files with proper structure and metadata", async () => {
      const sessionConfig: SessionConfig = {
        url: "https://httpbin.org/headers",
        artifactConfig: {
          enabled: true,
          outputDir: testOutputDir,
          saveHar: true,
        },
        browserOptions: {
          headless: true,
        },
      };

      const sessionInfo =
        await manualSessionManager.startSession(sessionConfig);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const result = await manualSessionManager.stopSession(sessionInfo.id, {
        reason: "har_structure_test",
      });

      const harArtifact = result.artifacts.find((a) => a.type === "har");
      expect(harArtifact?.path).toBeDefined();

      // Read and validate HAR file structure
      const harContent = readFileSync(harArtifact?.path ?? "", "utf-8");
      const harData = JSON.parse(harContent);

      // Validate HAR 1.2 specification compliance
      expect(harData.log).toBeDefined();
      expect(harData.log.version).toBe("1.2");
      expect(harData.log.creator).toBeDefined();
      expect(harData.log.creator.name).toBe("harvest-mcp");
      expect(harData.log.creator.version).toBeDefined();

      // Validate pages array
      expect(harData.log.pages).toBeDefined();
      expect(Array.isArray(harData.log.pages)).toBe(true);
      if (harData.log.pages.length > 0) {
        const page = harData.log.pages[0];
        expect(page.id).toBeDefined();
        expect(page.title).toBeDefined();
        expect(page.startedDateTime).toBeDefined();
        expect(page.pageTimings).toBeDefined();
      }

      // Validate entries array
      expect(harData.log.entries).toBeDefined();
      expect(Array.isArray(harData.log.entries)).toBe(true);

      if (harData.log.entries.length > 0) {
        const entry = harData.log.entries[0];
        expect(entry.startedDateTime).toBeDefined();
        expect(entry.time).toBeDefined();
        expect(entry.request).toBeDefined();
        expect(entry.response).toBeDefined();
        expect(entry.cache).toBeDefined();
        expect(entry.timings).toBeDefined();

        // Validate request structure
        expect(entry.request.method).toBeDefined();
        expect(entry.request.url).toBeDefined();
        expect(entry.request.httpVersion).toBeDefined();
        expect(Array.isArray(entry.request.headers)).toBe(true);
        expect(Array.isArray(entry.request.cookies)).toBe(true);

        // Validate response structure
        expect(entry.response.status).toBeDefined();
        expect(entry.response.statusText).toBeDefined();
        expect(entry.response.httpVersion).toBeDefined();
        expect(Array.isArray(entry.response.headers)).toBe(true);
        expect(Array.isArray(entry.response.cookies)).toBe(true);
        expect(entry.response.content).toBeDefined();
      }
    }, 15000);

    test("should generate HAR files that support harvest code generation", async () => {
      // Create manual session with multiple types of requests
      const sessionConfig: SessionConfig = {
        url: "https://httpbin.org/html",
        artifactConfig: {
          enabled: true,
          outputDir: testOutputDir,
          saveHar: true,
        },
        browserOptions: {
          headless: true,
        },
      };

      const sessionInfo =
        await manualSessionManager.startSession(sessionConfig);
      await new Promise((resolve) => setTimeout(resolve, 4000));

      const result = await manualSessionManager.stopSession(sessionInfo.id, {
        reason: "code_generation_test",
      });

      const harArtifact = result.artifacts.find((a) => a.type === "har");
      expect(harArtifact?.path).toBeDefined();

      // Create analysis session
      const analysisResponse = await handleSessionStart(
        {
          harPath: harArtifact?.path ?? "",
          prompt: "Generate code for HTML page interaction workflow",
        },
        server.getSessionToolContext()
      );

      const analysisData = JSON.parse(
        analysisResponse.content[0]?.text as string
      );
      const sessionId = analysisData.sessionId;

      try {
        // Run initial analysis
        await handleStartPrimaryWorkflow(
          { sessionId },
          server.getAnalysisToolContext()
        );

        // Check if analysis can identify URLs and create nodes
        const statusResponse = await handleIsComplete(
          { sessionId },
          server.getAnalysisToolContext()
        );
        const statusData = JSON.parse(
          statusResponse.content[0]?.text as string
        );

        // Should have identified some structure from the HAR
        expect(statusData.isComplete).toBeDefined();
        expect(statusData.status).toBeDefined();

        // Try to generate code (even if analysis is not complete)
        const unresolvedResponse = await handleGetUnresolvedNodes(
          {
            sessionId,
          },
          server.getDebugToolContext()
        );
        const unresolvedData = JSON.parse(
          unresolvedResponse.content[0]?.text as string
        );

        // Should have processed the HAR file without errors
        expect(unresolvedData.unresolvedNodes).toBeDefined();
        expect(unresolvedData.totalUnresolved).toBeGreaterThanOrEqual(0);
      } finally {
        // Clean up analysis session
        await handleSessionDelete(
          { sessionId },
          server.getSessionToolContext()
        );
      }
    }, 30000);

    test("should handle edge cases in HAR file generation", async () => {
      // Test with minimal configuration
      const sessionConfig: SessionConfig = {
        url: "https://httpbin.org/status/200",
        artifactConfig: {
          enabled: true,
          outputDir: testOutputDir,
          saveHar: true,
          saveCookies: false,
          saveScreenshots: false,
        },
        browserOptions: {
          headless: true,
        },
        timeout: 1, // Short timeout
      };

      const sessionInfo =
        await manualSessionManager.startSession(sessionConfig);

      // Very brief session
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await manualSessionManager.stopSession(sessionInfo.id, {
        reason: "edge_case_test",
      });

      const harArtifact = result.artifacts.find((a) => a.type === "har");
      expect(harArtifact?.path).toBeDefined();

      // Even minimal HAR should be parseable
      const parsedData = await parseHARFile(harArtifact?.path ?? "");
      expect(parsedData.requests).toBeDefined();
      expect(parsedData.urls).toBeDefined();

      // Should handle empty or minimal request data gracefully
      const harContent = readFileSync(harArtifact?.path ?? "", "utf-8");
      const harData = JSON.parse(harContent);

      expect(harData.log.version).toBe("1.2");
      expect(harData.log.creator.name).toBe("harvest-mcp");
      expect(Array.isArray(harData.log.entries)).toBe(true);
    }, 10000);
  });

  describe("Cross-Integration Validation", () => {
    test("should maintain HAR compatibility across multiple manual sessions", async () => {
      const sessionCount = 3;
      const harPaths: string[] = [];

      // Create multiple manual sessions
      for (let i = 0; i < sessionCount; i++) {
        const sessionConfig: SessionConfig = {
          url: `https://httpbin.org/json?session=${i}`,
          artifactConfig: {
            enabled: true,
            outputDir: join(testOutputDir, `session-${i}`),
            saveHar: true,
            saveCookies: false,
            saveScreenshots: false,
          },
          browserOptions: {
            headless: true,
          },
        };

        const sessionInfo =
          await manualSessionManager.startSession(sessionConfig);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const result = await manualSessionManager.stopSession(sessionInfo.id, {
          reason: `multi_session_test_${i}`,
        });

        const harArtifact = result.artifacts.find((a) => a.type === "har");
        expect(harArtifact?.path).toBeDefined();
        harPaths.push(harArtifact?.path ?? "");
      }

      // Validate all generated HAR files
      for (const [index, harPath] of harPaths.entries()) {
        // Parse with harvest analyzer
        const parsedData = await parseHARFile(harPath);
        expect(parsedData.requests).toBeDefined();
        expect(parsedData.urls).toBeDefined();

        // Should contain requests specific to this session
        const sessionRequests = parsedData.requests.filter((req) =>
          req.url.includes(`session=${index}`)
        );
        expect(sessionRequests.length).toBeGreaterThan(0);

        // Test harvest analysis integration
        const analysisResponse = await handleSessionStart(
          {
            harPath,
            prompt: `Analyze session ${index} workflow`,
          },
          server.getSessionToolContext()
        );

        const analysisData = JSON.parse(
          analysisResponse.content[0]?.text as string
        );
        expect(analysisData.sessionId).toBeDefined();

        // Clean up
        await handleSessionDelete(
          { sessionId: analysisData.sessionId },
          server.getSessionToolContext()
        );
      }
    }, 45000);
  });
});
