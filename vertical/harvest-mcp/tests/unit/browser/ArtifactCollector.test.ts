/**
 * Tests for ArtifactCollector - artifact collection and generation
 * Following TDD approach - write tests first, then implement
 */

import type { BrowserContext, Page, Request, Response } from "playwright";
import { describe, expect, test } from "vitest";
import { ArtifactCollector } from "../../../src/browser/ArtifactCollector.js";

describe("ArtifactCollector", () => {
  test("should create ArtifactCollector instance", () => {
    const collector = new ArtifactCollector();
    expect(collector).toBeDefined();
    expect(collector).toBeInstanceOf(ArtifactCollector);
  });

  test("should initialize with empty HAR entries", () => {
    const collector = new ArtifactCollector();
    expect(collector.getHarEntryCount()).toBe(0);
  });

  test("should start network tracking for a page", async () => {
    const collector = new ArtifactCollector();

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: (event: string, handler: unknown) => {
        expect(event).toMatch(/^(request|response)$/);
        expect(handler).toBeInstanceOf(Function);
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);
    expect(collector.isTrackingNetwork()).toBe(true);
  });

  test("should stop network tracking", async () => {
    const collector = new ArtifactCollector();

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: () => {
        /* Mock implementation */
      },
      off: (event: string, _handler: unknown) => {
        expect(event).toMatch(/^(request|response)$/);
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);
    collector.stopNetworkTracking();
    expect(collector.isTrackingNetwork()).toBe(false);
  });

  test("should collect network requests and responses", async () => {
    const collector = new ArtifactCollector();

    let requestHandler: ((req: Request) => void) | undefined;
    let responseHandler: ((res: Response) => void) | undefined;

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: (event: string, handler: unknown) => {
        if (event === "request") {
          requestHandler = handler as (req: Request) => void;
        } else if (event === "response") {
          responseHandler = handler as (res: Response) => void;
        }
      },
      off: () => {
        /* Mock implementation */
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);

    // Simulate network request
    const mockRequest = {
      method: () => "GET",
      url: () => "https://api.example.com/data",
      headers: () => ({ "Content-Type": "application/json" }),
      postData: () => null,
    } as unknown as Request;

    // Simulate network response
    const mockResponse = {
      status: () => 200,
      statusText: () => "OK",
      headers: () => ({ "Content-Type": "application/json" }),
      request: () => mockRequest,
      url: () => "https://api.example.com/data",
    } as unknown as Response;

    // Trigger request handler
    requestHandler?.(mockRequest);

    // Trigger response handler
    responseHandler?.(mockResponse);

    expect(collector.getHarEntryCount()).toBe(1);
  });

  test("should generate HAR file", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test.har";

    const harArtifact = await collector.generateHarFile(outputPath);

    expect(harArtifact).toBeDefined();
    expect(harArtifact.type).toBe("har");
    expect(harArtifact.path).toBe(outputPath);
    expect(harArtifact.timestamp).toBeDefined();
  });

  test("should extract cookies from browser context", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies.json";

    const mockContext = {
      cookies: async () => [
        {
          name: "session_id",
          value: "abc123",
          domain: "example.com",
          path: "/",
          secure: true,
          httpOnly: true,
        },
      ],
    } as unknown as BrowserContext;

    const cookieArtifact = await collector.extractCookies(
      mockContext,
      outputPath
    );

    expect(cookieArtifact).toBeDefined();
    expect(cookieArtifact.type).toBe("cookies");
    expect(cookieArtifact.path).toBe(outputPath);
    expect(cookieArtifact.timestamp).toBeDefined();
  });

  test("should capture screenshot from page", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: (options: {
        path: string;
        fullPage: boolean;
        type: string;
      }) => {
        expect(options.path).toBe(outputPath);
        expect(options.fullPage).toBe(true);
        expect(options.type).toBe("png");
        return Buffer.from("fake-screenshot-data");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureScreenshot(
      mockPage,
      outputPath
    );

    expect(screenshotArtifact).toBeDefined();
    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
    expect(screenshotArtifact.timestamp).toBeDefined();
  });

  test("should collect all artifacts", async () => {
    const collector = new ArtifactCollector();
    const outputDir = "/tmp/artifacts";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: () => {
        /* Mock implementation */
      },
      off: () => {
        /* Mock implementation */
      },
      screenshot: async () => Buffer.from("fake-screenshot-data"),
    } as unknown as Page;

    const mockContext = {
      cookies: async () => [
        {
          name: "test_cookie",
          value: "test_value",
          domain: "example.com",
          path: "/",
        },
      ],
    } as unknown as BrowserContext;

    const artifactCollection = await collector.collectAllArtifacts(
      mockPage,
      mockContext,
      outputDir
    );

    expect(artifactCollection).toBeDefined();
    expect(artifactCollection.outputDir).toBe(outputDir);
    expect(artifactCollection.artifacts).toHaveLength(3); // HAR, cookies, screenshot
    expect(artifactCollection.artifacts.some((a) => a.type === "har")).toBe(
      true
    );
    expect(artifactCollection.artifacts.some((a) => a.type === "cookies")).toBe(
      true
    );
    expect(
      artifactCollection.artifacts.some((a) => a.type === "screenshot")
    ).toBe(true);
  });

  test("should clear HAR entries", () => {
    const collector = new ArtifactCollector();

    // Add some mock entries
    collector.startNetworkTracking({
      url: () => "https://example.com",
      title: () => "Test Page",
      on: () => {
        /* Mock implementation */
      },
      off: () => {
        /* Mock implementation */
      },
    } as unknown as Page);

    collector.clearHarEntries();
    expect(collector.getHarEntryCount()).toBe(0);
  });

  test("should handle errors gracefully", async () => {
    const collector = new ArtifactCollector();

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: () => {
        throw new Error("Screenshot failed");
      },
    } as unknown as Page;

    await expect(
      collector.captureScreenshot(mockPage, "/tmp/fail.png")
    ).rejects.toThrow("Screenshot failed");
  });
});
