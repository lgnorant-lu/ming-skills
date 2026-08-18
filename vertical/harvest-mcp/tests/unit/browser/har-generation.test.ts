/**
 * Tests for HAR generation functionality
 * Ensures compatibility with existing harvest-mcp HARParser
 * Following TDD approach - write tests first, then enhance implementation
 */

import { readFile } from "node:fs/promises";
import type { Har } from "har-format";
import type { Page, Request, Response } from "playwright";
import { describe, expect, test } from "vitest";
import { ArtifactCollector } from "../../../src/browser/ArtifactCollector.js";
import { parseHARFile } from "../../../src/core/HARParser.js";

describe("HAR Generation", () => {
  test("should generate valid HAR 1.2 format", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-har-format.har";

    await collector.generateHarFile(outputPath);

    // Read and parse the generated HAR file
    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    // Validate HAR structure
    expect(harData).toBeDefined();
    expect(harData.log).toBeDefined();
    expect(harData.log.version).toBe("1.2");
    expect(harData.log.creator).toBeDefined();
    expect(harData.log.creator.name).toBe("harvest-mcp");
    expect(harData.log.creator.version).toBe("1.0.0");
    expect(harData.log.pages).toHaveLength(1);
    expect(harData.log.entries).toBeDefined();
    expect(Array.isArray(harData.log.entries)).toBe(true);
  });

  test("should be compatible with existing HARParser", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-har-parser-compat.har";

    // Generate HAR file
    await collector.generateHarFile(outputPath);

    // Ensure it can be parsed by existing HARParser
    const parsedData = await parseHARFile(outputPath);

    expect(parsedData).toBeDefined();
    expect(parsedData.requests).toBeDefined();
    expect(parsedData.urls).toBeDefined();
    expect(Array.isArray(parsedData.requests)).toBe(true);
    expect(Array.isArray(parsedData.urls)).toBe(true);
  });

  test("should generate HAR entries from network activity", async () => {
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

    // Simulate multiple network requests
    const requests = [
      {
        method: () => "GET",
        url: () => "https://api.example.com/users",
        headers: () => ({
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        }),
        postData: () => null,
      },
      {
        method: () => "POST",
        url: () => "https://api.example.com/users",
        headers: () => ({
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
        postData: () =>
          JSON.stringify({ name: "John", email: "john@example.com" }),
      },
    ];

    const responses = [
      {
        status: () => 200,
        statusText: () => "OK",
        headers: () => ({
          "Content-Type": "application/json",
          "Content-Length": "156",
        }),
        request: () => requests[0],
        url: () => "https://api.example.com/users",
      },
      {
        status: () => 201,
        statusText: () => "Created",
        headers: () => ({
          "Content-Type": "application/json",
          "Content-Length": "98",
        }),
        request: () => requests[1],
        url: () => "https://api.example.com/users",
      },
    ];

    // Trigger network events
    if (requestHandler && responseHandler) {
      for (let i = 0; i < requests.length; i++) {
        requestHandler?.(requests[i] as unknown as Request);
        responseHandler?.(responses[i] as unknown as Response);
      }
    }

    const outputPath = "/tmp/test-har-network.har";
    await collector.generateHarFile(outputPath);

    // Verify HAR entries
    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    expect(harData.log.entries).toHaveLength(2);

    // Verify first entry (GET request)
    const getEntry = harData.log.entries[0];
    expect(getEntry).toBeDefined();
    if (getEntry) {
      expect(getEntry.request.method).toBe("GET");
      expect(getEntry.request.url).toBe("https://api.example.com/users");
      expect(getEntry.response.status).toBe(200);
      expect(getEntry.response.statusText).toBe("OK");
    }

    // Verify second entry (POST request)
    const postEntry = harData.log.entries[1];
    expect(postEntry).toBeDefined();
    if (postEntry) {
      expect(postEntry.request.method).toBe("POST");
      expect(postEntry.request.url).toBe("https://api.example.com/users");
      expect(postEntry.request.postData).toBeDefined();
      expect(postEntry.request.postData?.text).toBe(
        JSON.stringify({ name: "John", email: "john@example.com" })
      );
      expect(postEntry.response.status).toBe(201);
    }
  });

  test("should handle request headers correctly", async () => {
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

    const mockRequest = {
      method: () => "POST",
      url: () => "https://api.example.com/data",
      headers: () => ({
        "Content-Type": "application/json",
        Authorization: "Bearer token123",
        "X-Custom-Header": "custom-value",
      }),
      postData: () => JSON.stringify({ test: "data" }),
    } as unknown as Request;

    const mockResponse = {
      status: () => 200,
      statusText: () => "OK",
      headers: () => ({
        "Content-Type": "application/json",
        "Set-Cookie": "session=abc123; Path=/",
      }),
      request: () => mockRequest,
      url: () => "https://api.example.com/data",
    } as unknown as Response;

    if (requestHandler && responseHandler) {
      requestHandler(mockRequest);
      responseHandler(mockResponse);
    }

    const outputPath = "/tmp/test-har-headers.har";
    await collector.generateHarFile(outputPath);

    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    expect(harData.log.entries).toHaveLength(1);
    const entry = harData.log.entries[0];
    expect(entry).toBeDefined();

    if (entry) {
      // Check request headers
      const requestHeaders = entry.request.headers;
      expect(requestHeaders.find((h) => h.name === "Content-Type")?.value).toBe(
        "application/json"
      );
      expect(
        requestHeaders.find((h) => h.name === "Authorization")?.value
      ).toBe("Bearer token123");
      expect(
        requestHeaders.find((h) => h.name === "X-Custom-Header")?.value
      ).toBe("custom-value");

      // Check response headers
      const responseHeaders = entry.response.headers;
      expect(
        responseHeaders.find((h) => h.name === "Content-Type")?.value
      ).toBe("application/json");
      expect(responseHeaders.find((h) => h.name === "Set-Cookie")?.value).toBe(
        "session=abc123; Path=/"
      );
    }
  });

  test("should handle POST data correctly", async () => {
    const collector = new ArtifactCollector();

    let requestHandler: ((req: Request) => void) | undefined;

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: (event: string, handler: unknown) => {
        if (event === "request") {
          requestHandler = handler as (req: Request) => void;
        }
      },
      off: () => {
        /* Mock implementation */
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);

    const testData = { username: "test", password: "secret" };
    const mockRequest = {
      method: () => "POST",
      url: () => "https://api.example.com/login",
      headers: () => ({
        "Content-Type": "application/json",
      }),
      postData: () => JSON.stringify(testData),
    } as unknown as Request;

    if (requestHandler) {
      (requestHandler as (request: Request) => void)(mockRequest);
    }

    const outputPath = "/tmp/test-har-postdata.har";
    await collector.generateHarFile(outputPath);

    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    expect(harData.log.entries).toHaveLength(1);
    const entry = harData.log.entries[0];
    expect(entry).toBeDefined();

    if (entry) {
      expect(entry.request.postData).toBeDefined();
      expect(entry.request.postData?.mimeType).toBe("application/json");
      expect(entry.request.postData?.text).toBe(JSON.stringify(testData));
    }
  });

  test("should handle requests without POST data", async () => {
    const collector = new ArtifactCollector();

    let requestHandler: ((req: Request) => void) | undefined;

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: (event: string, handler: unknown) => {
        if (event === "request") {
          requestHandler = handler as (req: Request) => void;
        }
      },
      off: () => {
        /* Mock implementation */
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);

    const mockRequest = {
      method: () => "GET",
      url: () => "https://api.example.com/data",
      headers: () => ({
        Accept: "application/json",
      }),
      postData: () => null,
    } as unknown as Request;

    if (requestHandler) {
      (requestHandler as (request: Request) => void)(mockRequest);
    }

    const outputPath = "/tmp/test-har-no-postdata.har";
    await collector.generateHarFile(outputPath);

    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    expect(harData.log.entries).toHaveLength(1);
    const entry = harData.log.entries[0];
    expect(entry).toBeDefined();

    if (entry) {
      expect(entry.request.postData).toBeUndefined();
    }
  });

  test("should clear HAR entries between sessions", async () => {
    const collector = new ArtifactCollector();

    // Generate initial HAR with some entries
    let requestHandler: ((req: Request) => void) | undefined;

    const mockPage = {
      url: () => "https://example.com",
      title: () => "Test Page",
      on: (event: string, handler: unknown) => {
        if (event === "request") {
          requestHandler = handler as (req: Request) => void;
        }
      },
      off: () => {
        /* Mock implementation */
      },
    } as unknown as Page;

    collector.startNetworkTracking(mockPage);

    const mockRequest = {
      method: () => "GET",
      url: () => "https://api.example.com/test",
      headers: () => ({}),
      postData: () => null,
    } as unknown as Request;

    if (requestHandler) {
      (requestHandler as (request: Request) => void)(mockRequest);
    }

    expect(collector.getHarEntryCount()).toBe(1);

    // Clear entries and generate new HAR
    collector.clearHarEntries();
    expect(collector.getHarEntryCount()).toBe(0);

    const outputPath = "/tmp/test-har-cleared.har";
    await collector.generateHarFile(outputPath);

    const harContent = await readFile(outputPath, "utf-8");
    const harData = JSON.parse(harContent) as Har;

    expect(harData.log.entries).toHaveLength(0);
  });
});
