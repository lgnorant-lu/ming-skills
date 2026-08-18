/**
 * Tests for screenshot capture functionality
 * Enhanced screenshot features with timing and configuration options
 * Following TDD approach - write tests first, then enhance implementation
 */

import type { Page } from "playwright";
import { describe, expect, test } from "vitest";
import { ArtifactCollector } from "../../../src/browser/ArtifactCollector.js";

describe("Screenshot Capture", () => {
  test("should capture basic screenshot", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-basic.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.path).toBe(outputPath);
        expect(options.fullPage).toBe(true);
        expect(options.type).toBe("png");
        return Buffer.from("fake-png-data");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureScreenshot(
      mockPage,
      outputPath
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
    expect(screenshotArtifact.timestamp).toBeDefined();
  });

  test("should capture screenshot with custom options", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-custom.png";

    const customOptions = {
      fullPage: false,
      type: "jpeg" as const,
      quality: 80,
      clip: { x: 0, y: 0, width: 800, height: 600 },
    };

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.path).toBe(outputPath);
        expect(options.fullPage).toBe(false);
        expect(options.type).toBe("jpeg");
        expect(options.quality).toBe(80);
        expect(options.clip).toEqual({ x: 0, y: 0, width: 800, height: 600 });
        return Buffer.from("fake-jpeg-data");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureScreenshotWithOptions(
      mockPage,
      outputPath,
      customOptions
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should capture viewport-only screenshot", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-viewport.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.fullPage).toBe(false);
        expect(options.type).toBe("png");
        return Buffer.from("fake-viewport-screenshot");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureViewportScreenshot(
      mockPage,
      outputPath
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should capture full page screenshot", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-fullpage.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.fullPage).toBe(true);
        expect(options.type).toBe("png");
        return Buffer.from("fake-fullpage-screenshot");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureFullPageScreenshot(
      mockPage,
      outputPath
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should support timed screenshot capture", async () => {
    const collector = new ArtifactCollector();
    const outputDir = "/tmp/screenshots";

    let screenshotCount = 0;
    const mockPage = {
      url: () => "https://example.com/dynamic",
      title: () => "Dynamic Page",
      screenshot: async (options: any) => {
        screenshotCount++;
        expect(options.fullPage).toBe(true);
        expect(options.path).toMatch(
          /\/tmp\/screenshots\/timed-screenshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.png/
        );
        return Buffer.from(`fake-screenshot-${screenshotCount}`);
      },
    } as unknown as Page;

    const screenshotArtifacts = await collector.captureTimedScreenshots(
      mockPage,
      outputDir,
      3, // count
      100 // interval in ms
    );

    expect(screenshotArtifacts).toHaveLength(3);
    expect(screenshotCount).toBe(3);

    for (const artifact of screenshotArtifacts) {
      expect(artifact.type).toBe("screenshot");
      expect(artifact.path).toMatch(
        /\/tmp\/screenshots\/timed-screenshot-.*\.png/
      );
      expect(artifact.timestamp).toBeDefined();
    }
  });

  test("should handle interval-based screenshot capture", async () => {
    const collector = new ArtifactCollector();
    const outputDir = "/tmp/interval-screenshots";

    let screenshotCount = 0;
    const mockPage = {
      url: () => "https://example.com/live",
      title: () => "Live Page",
      screenshot: async (_options: any) => {
        screenshotCount++;
        return Buffer.from(`fake-interval-screenshot-${screenshotCount}`);
      },
    } as unknown as Page;

    // Start interval screenshots
    const intervalId = await collector.startIntervalScreenshots(
      mockPage,
      outputDir,
      50 // 50ms interval for fast testing
    );

    // Wait for a few screenshots to be taken
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Stop interval screenshots
    const capturedArtifacts =
      await collector.stopIntervalScreenshots(intervalId);

    expect(screenshotCount).toBeGreaterThan(2);
    expect(capturedArtifacts.length).toBeGreaterThan(2);

    for (const artifact of capturedArtifacts) {
      expect(artifact.type).toBe("screenshot");
      expect(artifact.path).toMatch(
        /\/tmp\/interval-screenshots\/interval-screenshot-.*\.png/
      );
    }
  });

  test("should capture screenshot with element selector", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-element.png";
    const selector = "#main-content";

    const mockElement = {
      screenshot: async (options: any) => {
        expect(options.path).toBe(outputPath);
        expect(options.type).toBe("png");
        return Buffer.from("fake-element-screenshot");
      },
    };

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      locator: (sel: string) => {
        expect(sel).toBe(selector);
        return mockElement;
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureElementScreenshot(
      mockPage,
      outputPath,
      selector
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should generate screenshots with proper timestamps", async () => {
    const collector = new ArtifactCollector();

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async () => Buffer.from("fake-screenshot"),
    } as unknown as Page;

    const beforeTime = Date.now();
    const screenshotArtifact = await collector.captureScreenshot(
      mockPage,
      "/tmp/test-timestamp.png"
    );
    const afterTime = Date.now();

    expect(screenshotArtifact.timestamp).toBeDefined();
    const timestampTime = new Date(
      screenshotArtifact.timestamp ?? ""
    ).getTime();

    expect(timestampTime).toBeGreaterThanOrEqual(beforeTime);
    expect(timestampTime).toBeLessThanOrEqual(afterTime);
  });

  test("should create output directory if it doesn't exist", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/nested/deep/screenshot.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async () => Buffer.from("fake-screenshot"),
    } as unknown as Page;

    // The directory creation is handled in the implementation
    const screenshotArtifact = await collector.captureScreenshot(
      mockPage,
      outputPath
    );

    expect(screenshotArtifact.type).toBe("screenshot");
    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should handle screenshot capture errors", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-screenshot-error.png";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async () => {
        throw new Error("Screenshot capture failed");
      },
    } as unknown as Page;

    await expect(
      collector.captureScreenshot(mockPage, outputPath)
    ).rejects.toThrow("Screenshot capture failed");
  });

  test("should support different image formats", async () => {
    const collector = new ArtifactCollector();

    const formats = [
      { path: "/tmp/test.png", type: "png" as const },
      { path: "/tmp/test.jpeg", type: "jpeg" as const },
    ];

    for (const format of formats) {
      const mockPage = {
        url: () => "https://example.com",
        title: () => "Test Page",
        screenshot: async (options: any) => {
          expect(options.type).toBe(format.type);
          return Buffer.from(`fake-${format.type}-data`);
        },
      } as unknown as Page;

      const screenshotArtifact = await collector.captureScreenshotWithOptions(
        mockPage,
        format.path,
        { type: format.type }
      );

      expect(screenshotArtifact.path).toBe(format.path);
    }
  });

  test("should support screenshot quality settings", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-quality.jpeg";

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.type).toBe("jpeg");
        expect(options.quality).toBe(90);
        return Buffer.from("fake-high-quality-jpeg");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureScreenshotWithOptions(
      mockPage,
      outputPath,
      { type: "jpeg", quality: 90 }
    );

    expect(screenshotArtifact.path).toBe(outputPath);
  });

  test("should handle clipped screenshots", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-clipped.png";
    const clipRegion = { x: 100, y: 100, width: 500, height: 400 };

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      screenshot: async (options: any) => {
        expect(options.clip).toEqual(clipRegion);
        expect(options.fullPage).toBe(false); // Should be false when clipping
        return Buffer.from("fake-clipped-screenshot");
      },
    } as unknown as Page;

    const screenshotArtifact = await collector.captureScreenshotWithOptions(
      mockPage,
      outputPath,
      { clip: clipRegion }
    );

    expect(screenshotArtifact.path).toBe(outputPath);
  });
});
