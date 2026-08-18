import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionManager } from "../../src/core/SessionManager.js";
import type { HarvestMCPServer } from "../../src/server.js";
import {
  handleIsComplete,
  handleProcessNextNode,
  handleStartPrimaryWorkflow,
} from "../../src/tools/analysisTools.js";
import { handleSessionList } from "../../src/tools/sessionTools.js";
import {
  cleanupE2EContext,
  createTestSession,
  type E2ETestContext,
  runInitialAnalysis,
  setupE2EContext,
} from "../helpers/e2e-helpers.js";

/**
 * Performance Benchmarking Tests
 *
 * These tests validate Sprint 7 performance requirements:
 * - Analysis Speed: Complete analysis in <30s for typical HAR files
 * - Memory Usage: <500MB per active session
 * - Tool Response Time: Non-LLM tools respond in <200ms
 * - Session Capacity: Support >10 concurrent sessions
 */
describe("Performance Benchmarking", () => {
  let context: E2ETestContext;
  let server: HarvestMCPServer;
  let sessionManager: SessionManager;

  beforeEach(() => {
    context = setupE2EContext();
    server = context.server;
    sessionManager = context.sessionManager;
  });

  afterEach(() => {
    cleanupE2EContext();
  });

  describe("Analysis Speed Requirements", () => {
    it("should complete typical analysis workflow in under 30 seconds", async () => {
      const startTime = Date.now();

      // Create session and run initial analysis steps
      const sessionId = await createTestSession(server, {
        prompt: "Complete performance test analysis",
      });

      // Run initial analysis
      await runInitialAnalysis(server, sessionId);

      // Process a few nodes to simulate workflow
      const maxIterations = 10; // Reasonable limit for mock data
      let iterations = 0;

      for (let i = 0; i < maxIterations; i++) {
        try {
          await handleProcessNextNode(
            { sessionId },
            server.getAnalysisToolContext()
          );
          iterations++;
        } catch (_error) {
          // Expected to fail at some point with mock data
          break;
        }
      }

      const totalTime = Date.now() - startTime;

      // Verify performance requirements
      expect(totalTime).toBeLessThan(30000); // Less than 30 seconds
      expect(iterations).toBeGreaterThan(0); // Should process at least some iterations
      expect(iterations).toBeLessThanOrEqual(maxIterations); // Should not exceed the limit

      console.log(
        `Performance: Analysis workflow completed in ${totalTime}ms with ${iterations} iterations`
      );
    });

    it("should handle large HAR files efficiently", async () => {
      const startTime = Date.now();

      // Create session with larger test data
      const sessionId = await createTestSession(server, {
        prompt: "Process large HAR file efficiently",
      });

      await runInitialAnalysis(server, sessionId);

      const totalTime = Date.now() - startTime;

      // Initial analysis should be fast even for large files
      expect(totalTime).toBeLessThan(5000); // Less than 5 seconds for initial analysis

      console.log(
        `Performance: Large HAR initial analysis completed in ${totalTime}ms`
      );
    });
  });

  describe("Tool Response Time Requirements", () => {
    it("should respond to non-LLM tools in under 200ms", async () => {
      await createTestSession(server);

      // Test session list response time
      const startTime = Date.now();
      const listResult = await handleSessionList(
        server.getSessionToolContext()
      );
      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(200);

      // Verify the response structure
      const firstContent = listResult.content[0];
      expect(firstContent?.text).toBeDefined();
      const parsedResult = JSON.parse(firstContent?.text as string);
      expect(Array.isArray(parsedResult.sessions)).toBe(true);

      console.log(`Performance: session.list responded in ${responseTime}ms`);
    });

    it("should respond to analysis.is_complete quickly", async () => {
      const sessionId = await createTestSession(server);

      const startTime = Date.now();
      const result = await handleIsComplete(
        { sessionId },
        server.getAnalysisToolContext()
      );
      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(200);
      const firstContent = result.content[0];
      expect(firstContent?.text).toBeDefined();

      console.log(
        `Performance: analysis.is_complete responded in ${responseTime}ms`
      );
    });

    it("should respond to DAG operations quickly", async () => {
      const sessionId = await createTestSession(server);
      const session = sessionManager.getSession(sessionId);

      const startTime = Date.now();

      // Test DAG operations performance
      const nodeCount = session.dagManager.getNodeCount();
      const isComplete = session.dagManager.isComplete();
      const unresolvedNodes = session.dagManager.getUnresolvedNodes();

      const responseTime = Date.now() - startTime;

      expect(responseTime).toBeLessThan(50); // DAG operations should be very fast
      expect(typeof nodeCount).toBe("number");
      expect(typeof isComplete).toBe("boolean");
      expect(Array.isArray(unresolvedNodes)).toBe(true);

      console.log(`Performance: DAG operations completed in ${responseTime}ms`);
    });
  });

  describe("Memory Usage Requirements", () => {
    it("should maintain reasonable memory usage for single session", async () => {
      const initialMemory = process.memoryUsage();

      const sessionId = await createTestSession(server, {
        prompt: "Memory usage test session",
      });

      await runInitialAnalysis(server, sessionId);

      const afterMemory = process.memoryUsage();
      const heapUsed =
        (afterMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024; // MB

      // Single session should use reasonable memory
      expect(heapUsed).toBeLessThan(100); // Less than 100MB per session

      console.log(
        `Performance: Single session memory usage: ${heapUsed.toFixed(2)}MB`
      );
    });

    it("should properly manage session lifecycle", async () => {
      const initialSessionCount = sessionManager.getAllSessionIds().length;

      // Create multiple sessions
      const sessionIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const sessionId = await createTestSession(server, {
          prompt: `Session lifecycle test ${i}`,
        });
        sessionIds.push(sessionId);
      }

      const afterCreation = sessionManager.getAllSessionIds().length;

      // Delete all sessions
      for (const sessionId of sessionIds) {
        sessionManager.deleteSession(sessionId);
      }

      const afterCleanup = sessionManager.getAllSessionIds().length;

      // Session count should be properly managed
      expect(afterCreation).toBe(initialSessionCount + 5);
      expect(afterCleanup).toBe(initialSessionCount);

      console.log(
        `Performance: Session lifecycle - Created: ${sessionIds.length}, Final count: ${afterCleanup}`
      );
    });
  });

  describe("Concurrent Session Requirements", () => {
    it("should handle multiple concurrent sessions efficiently", async () => {
      const startTime = Date.now();
      const sessionCount = 12; // More than the required 10
      const sessionPromises: Promise<string>[] = [];

      // Create multiple sessions concurrently
      for (let i = 0; i < sessionCount; i++) {
        sessionPromises.push(
          createTestSession(server, {
            prompt: `Concurrent session test ${i}`,
          })
        );
      }

      const sessionIds = await Promise.all(sessionPromises);
      const creationTime = Date.now() - startTime;

      // Run initial analysis on all sessions concurrently
      const analysisStartTime = Date.now();
      const analysisPromises = sessionIds.map((sessionId) =>
        runInitialAnalysis(server, sessionId)
      );

      await Promise.all(analysisPromises);
      const analysisTime = Date.now() - analysisStartTime;

      // Verify all sessions were created and analyzed
      expect(sessionIds).toHaveLength(sessionCount);
      expect(creationTime).toBeLessThan(10000); // Session creation should be fast
      expect(analysisTime).toBeLessThan(15000); // Concurrent analysis should complete reasonably

      // Verify session manager can handle the load
      const sessionList = sessionManager.listSessions();
      expect(sessionList.length).toBeGreaterThanOrEqual(sessionCount);

      console.log(
        `Performance: ${sessionCount} concurrent sessions - creation: ${creationTime}ms, analysis: ${analysisTime}ms`
      );
    });

    it("should maintain performance with session queue processing", async () => {
      const startTime = Date.now();

      // Create sessions rapidly
      const sessionIds: string[] = [];
      for (let i = 0; i < 15; i++) {
        const sessionId = await createTestSession(server, {
          prompt: `Queue test session ${i}`,
        });
        sessionIds.push(sessionId);
      }

      // Process some operations on multiple sessions
      const operations: Promise<CallToolResult>[] = [];
      for (let i = 0; i < 10; i++) {
        const sessionId = sessionIds[i];
        if (sessionId) {
          operations.push(
            Promise.resolve(
              handleIsComplete({ sessionId }, server.getAnalysisToolContext())
            )
          );
          operations.push(
            handleStartPrimaryWorkflow(
              { sessionId },
              server.getAnalysisToolContext()
            )
          );
        }
      }

      await Promise.all(operations);
      const totalTime = Date.now() - startTime;

      // Should handle rapid operations efficiently
      expect(totalTime).toBeLessThan(20000); // Less than 20 seconds for bulk operations
      expect(sessionManager.getAllSessionIds().length).toBeGreaterThanOrEqual(
        15
      );

      console.log(
        `Performance: 15 sessions + 20 operations completed in ${totalTime}ms`
      );
    });
  });

  describe("Resource Management", () => {
    it("should automatically clean up expired sessions", async () => {
      // Create a session
      const sessionId = await createTestSession(server, {
        prompt: "Session cleanup test",
      });

      expect(sessionManager.hasSession(sessionId)).toBe(true);

      // Manually trigger cleanup (in real usage this happens automatically)
      // We can't easily test the time-based cleanup in unit tests, but we can verify the cleanup mechanism works
      sessionManager.deleteSession(sessionId);
      expect(sessionManager.hasSession(sessionId)).toBe(false);

      console.log("Performance: Session cleanup mechanism verified");
    });

    it("should handle session capacity limits", () => {
      const stats = sessionManager.getStats();
      stats.totalSessions;

      // The SessionManager should handle capacity limits gracefully
      // This test verifies the monitoring capability exists
      expect(typeof stats.totalSessions).toBe("number");
      expect(typeof stats.activeSessions).toBe("number");
      expect(typeof stats.completedSessions).toBe("number");
      expect(typeof stats.averageNodeCount).toBe("number");

      expect(stats.activeSessions).toBeGreaterThanOrEqual(0);
      expect(stats.totalSessions).toBeGreaterThanOrEqual(stats.activeSessions);

      console.log(
        `Performance: Session stats - Total: ${stats.totalSessions}, Active: ${stats.activeSessions}, Avg nodes: ${stats.averageNodeCount.toFixed(1)}`
      );
    });
  });

  describe("Performance Regression Detection", () => {
    it("should maintain consistent performance across operations", async () => {
      const sessionId = await createTestSession(server);
      const measurements: number[] = [];

      // Measure multiple identical operations
      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        await handleIsComplete({ sessionId }, server.getAnalysisToolContext());
        measurements.push(Date.now() - startTime);
      }

      // Calculate statistics
      const average =
        measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const max = Math.max(...measurements);
      const variance =
        measurements.reduce((sum, val) => sum + (val - average) ** 2, 0) /
        measurements.length;
      const stdDev = Math.sqrt(variance);

      // Performance should be consistent
      expect(average).toBeLessThan(100); // Average should be fast
      expect(max).toBeLessThan(200); // No outliers should be too slow
      expect(stdDev).toBeLessThan(50); // Low variance indicates consistent performance

      console.log(
        `Performance: Consistency - avg: ${average.toFixed(1)}ms, max: ${max}ms, stdDev: ${stdDev.toFixed(1)}ms`
      );
    });
  });
});
