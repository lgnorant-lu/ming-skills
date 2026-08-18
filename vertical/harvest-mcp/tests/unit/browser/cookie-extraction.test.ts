/**
 * Tests for cookie extraction functionality
 * Ensures compatibility with existing harvest-mcp CookieParser
 * Following TDD approach - write tests first, then enhance implementation
 */

import { readFile } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { describe, expect, test } from "vitest";
import { ArtifactCollector } from "../../../src/browser/ArtifactCollector.js";
import { parseCookieFile } from "../../../src/core/CookieParser.js";

describe("Cookie Extraction", () => {
  test("should extract cookies in compatible JSON format", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-format.json";

    const mockContext = {
      cookies: async () => [
        {
          name: "session_id",
          value: "abc123def456",
          domain: "example.com",
          path: "/",
          expires: 1640995200, // 2022-01-01
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        },
        {
          name: "user_pref",
          value: "dark_mode",
          domain: ".example.com",
          path: "/app",
          expires: -1, // session cookie
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
    } as unknown as BrowserContext;

    const cookieArtifact = await collector.extractCookies(
      mockContext,
      outputPath
    );

    // Verify artifact structure
    expect(cookieArtifact.type).toBe("cookies");
    expect(cookieArtifact.path).toBe(outputPath);
    expect(cookieArtifact.timestamp).toBeDefined();

    // Read and parse the generated cookie file
    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    // Verify cookie file structure
    expect(cookieData).toBeDefined();
    expect(cookieData.collectedAt).toBeDefined();
    expect(cookieData.totalCookies).toBe(2);
    expect(cookieData.domains).toContain("example.com");
    expect(cookieData.domains).toContain(".example.com");
    expect(cookieData.cookies).toHaveLength(2);

    // Verify individual cookie data
    const sessionCookie = cookieData.cookies.find(
      (c: any) => c.name === "session_id"
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie.value).toBe("abc123def456");
    expect(sessionCookie.domain).toBe("example.com");
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.secure).toBe(true);
    expect(sessionCookie.sameSite).toBe("Strict");

    const prefCookie = cookieData.cookies.find(
      (c: any) => c.name === "user_pref"
    );
    expect(prefCookie).toBeDefined();
    expect(prefCookie.value).toBe("dark_mode");
    expect(prefCookie.domain).toBe(".example.com");
    expect(prefCookie.httpOnly).toBe(false);
    expect(prefCookie.secure).toBe(false);
    expect(prefCookie.sameSite).toBe("Lax");
  });

  test("should be compatible with existing CookieParser", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-parser-compat.json";

    const mockContext = {
      cookies: async () => [
        {
          name: "auth_token",
          value: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxMjN9.xyz",
          domain: "api.example.com",
          path: "/v1",
          expires: 1640995200,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "csrf_token",
          value: "random-csrf-token-123",
          domain: "example.com",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: "Strict",
        },
      ],
    } as unknown as BrowserContext;

    // Extract cookies
    await collector.extractCookies(mockContext, outputPath);

    // Ensure it can be parsed by existing CookieParser
    const parsedCookies = await parseCookieFile(outputPath);

    expect(parsedCookies).toBeDefined();
    expect(typeof parsedCookies).toBe("object");

    // Verify the extracted cookies are in the expected enhanced format
    // The CookieParser handles this format natively (supports both array and object formats)
    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.cookies).toHaveLength(2);
    expect(cookieData.cookies.some((c: any) => c.name === "auth_token")).toBe(
      true
    );
    expect(cookieData.cookies.some((c: any) => c.name === "csrf_token")).toBe(
      true
    );
  });

  test("should handle empty cookie list", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-empty.json";

    const mockContext = {
      cookies: async () => [],
    } as unknown as BrowserContext;

    const cookieArtifact = await collector.extractCookies(
      mockContext,
      outputPath
    );

    expect(cookieArtifact.type).toBe("cookies");
    expect(cookieArtifact.path).toBe(outputPath);

    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.totalCookies).toBe(0);
    expect(cookieData.domains).toHaveLength(0);
    expect(cookieData.cookies).toHaveLength(0);
  });

  test("should handle various cookie attributes correctly", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-attributes.json";

    const mockContext = {
      cookies: async () => [
        {
          name: "simple_cookie",
          value: "simple_value",
          domain: "test.com",
          path: "/",
          expires: undefined, // No expiration
          httpOnly: false,
          secure: false,
          sameSite: undefined, // No sameSite
        },
        {
          name: "complex_cookie",
          value: "complex_value_with_special_chars!@#$%",
          domain: ".subdomain.test.com",
          path: "/api/v2/",
          expires: 9999999999, // Far future
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "session_cookie",
          value: "",
          domain: "localhost",
          path: "",
          expires: -1, // Session cookie
          httpOnly: undefined, // Undefined httpOnly
          secure: undefined, // Undefined secure
          sameSite: "Lax",
        },
      ],
    } as unknown as BrowserContext;

    await collector.extractCookies(mockContext, outputPath);

    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.cookies).toHaveLength(3);

    // Check simple cookie
    const simpleCookie = cookieData.cookies.find(
      (c: any) => c.name === "simple_cookie"
    );
    expect(simpleCookie.value).toBe("simple_value");
    expect(simpleCookie.domain).toBe("test.com");
    expect(simpleCookie.httpOnly).toBe(false);
    expect(simpleCookie.secure).toBe(false);

    // Check complex cookie
    const complexCookie = cookieData.cookies.find(
      (c: any) => c.name === "complex_cookie"
    );
    expect(complexCookie.value).toBe("complex_value_with_special_chars!@#$%");
    expect(complexCookie.domain).toBe(".subdomain.test.com");
    expect(complexCookie.path).toBe("/api/v2/");
    expect(complexCookie.httpOnly).toBe(true);
    expect(complexCookie.secure).toBe(true);
    expect(complexCookie.sameSite).toBe("None");

    // Check session cookie
    const sessionCookie = cookieData.cookies.find(
      (c: any) => c.name === "session_cookie"
    );
    expect(sessionCookie.value).toBe("");
    expect(sessionCookie.domain).toBe("localhost");
    expect(sessionCookie.expires).toBe(-1);
    expect(sessionCookie.sameSite).toBe("Lax");
  });

  test("should track unique domains correctly", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-domains.json";

    const mockContext = {
      cookies: async () => [
        {
          name: "cookie1",
          value: "value1",
          domain: "example.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
        {
          name: "cookie2",
          value: "value2",
          domain: "example.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
        {
          name: "cookie3",
          value: "value3",
          domain: ".example.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
        {
          name: "cookie4",
          value: "value4",
          domain: "api.example.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
        {
          name: "cookie5",
          value: "value5",
          domain: "different.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
      ],
    } as unknown as BrowserContext;

    await collector.extractCookies(mockContext, outputPath);

    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.totalCookies).toBe(5);
    expect(cookieData.domains).toHaveLength(4); // Unique domains
    expect(cookieData.domains).toContain("example.com");
    expect(cookieData.domains).toContain(".example.com");
    expect(cookieData.domains).toContain("api.example.com");
    expect(cookieData.domains).toContain("different.com");
  });

  test("should include collection timestamp", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-timestamp.json";

    const beforeTime = new Date().toISOString();

    const mockContext = {
      cookies: async () => [
        {
          name: "test",
          value: "value",
          domain: "test.com",
          path: "/",
          httpOnly: false,
          secure: false,
        },
      ],
    } as unknown as BrowserContext;

    await collector.extractCookies(mockContext, outputPath);

    const afterTime = new Date().toISOString();

    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.collectedAt).toBeDefined();
    expect(cookieData.collectedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );

    // Verify timestamp is within reasonable bounds
    expect(cookieData.collectedAt >= beforeTime).toBe(true);
    expect(cookieData.collectedAt <= afterTime).toBe(true);
  });

  test("should handle cookie extraction errors gracefully", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-error.json";

    const mockContext = {
      cookies: async () => {
        throw new Error("Failed to get cookies");
      },
    } as unknown as BrowserContext;

    await expect(
      collector.extractCookies(mockContext, outputPath)
    ).rejects.toThrow("Failed to get cookies");
  });

  test("should preserve cookie values with special characters", async () => {
    const collector = new ArtifactCollector();
    const outputPath = "/tmp/test-cookies-special-chars.json";

    const specialValues = [
      "value with spaces",
      "value;with;semicolons",
      "value=with=equals",
      "value,with,commas",
      'value"with"quotes',
      "value'with'apostrophes",
      "value\nwith\nnewlines",
      "value\twith\ttabs",
      "encoded%20value",
      "base64==encoded==value",
      "unicode_çöökîé_value_🍪",
    ];

    const mockContext = {
      cookies: async () =>
        specialValues.map((value, index) => ({
          name: `special_cookie_${index}`,
          value,
          domain: "test.com",
          path: "/",
          httpOnly: false,
          secure: false,
        })),
    } as unknown as BrowserContext;

    await collector.extractCookies(mockContext, outputPath);

    const cookieContent = await readFile(outputPath, "utf-8");
    const cookieData = JSON.parse(cookieContent);

    expect(cookieData.cookies).toHaveLength(specialValues.length);

    // Verify all special values are preserved
    specialValues.forEach((expectedValue, index) => {
      const cookie = cookieData.cookies.find(
        (c: any) => c.name === `special_cookie_${index}`
      );
      expect(cookie).toBeDefined();
      expect(cookie.value).toBe(expectedValue);
    });
  });
});
