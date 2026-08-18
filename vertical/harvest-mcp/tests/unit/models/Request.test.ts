import { describe, expect, it } from "vitest";
import { Request } from "../../../src/models/Request.js";

describe("Request", () => {
  describe("toCurlCommand", () => {
    it("should generate basic GET curl command", () => {
      const request = new Request("GET", "https://api.example.com/users", {
        Authorization: "Bearer token123",
        "Content-Type": "application/json",
      });

      const curl = request.toCurlCommand();

      expect(curl).toContain("curl -X GET");
      expect(curl).toContain("-H 'Authorization: Bearer token123'");
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).toContain("'https://api.example.com/users'");
    });

    it("should generate POST curl command with JSON body", () => {
      const request = new Request(
        "POST",
        "https://api.example.com/users",
        {
          "Content-Type": "application/json",
        },
        undefined,
        {
          name: "John Doe",
          email: "john@example.com",
        }
      );

      const curl = request.toCurlCommand();

      expect(curl).toContain("curl -X POST");
      expect(curl).toContain(
        '--data \'{"name":"John Doe","email":"john@example.com"}\''
      );
    });

    it("should handle query parameters", () => {
      const request = new Request(
        "GET",
        "https://api.example.com/search",
        {},
        {
          q: "test query",
          limit: "10",
        }
      );

      const curl = request.toCurlCommand();

      expect(curl).toContain(
        "https://api.example.com/search?q=test%20query&limit=10"
      );
    });

    it("should escape single quotes in headers and data", () => {
      const request = new Request(
        "POST",
        "https://api.example.com/data",
        {
          "X-Custom": "value with 'quotes'",
        },
        undefined,
        "data with 'quotes'"
      );

      const curl = request.toCurlCommand();

      expect(curl).toContain("-H 'X-Custom: value with '\"'\"'quotes'\"'\"''");
      expect(curl).toContain("--data 'data with '\"'\"'quotes'\"'\"''");
    });
  });

  describe("toMinifiedCurlCommand", () => {
    it("should exclude noise headers in minified version", () => {
      const request = new Request("GET", "https://api.example.com/users", {
        Authorization: "Bearer token123",
        "User-Agent": "Mozilla/5.0...",
        Referer: "https://example.com",
        Cookie: "session=abc123",
        "Content-Type": "application/json",
      });

      const curl = request.toMinifiedCurlCommand();

      expect(curl).toContain("-H 'Authorization: Bearer token123'");
      expect(curl).toContain("-H 'Content-Type: application/json'");
      expect(curl).not.toContain("User-Agent");
      expect(curl).not.toContain("Referer");
      expect(curl).not.toContain("Cookie");
    });
  });

  describe("toFetchCode", () => {
    it("should generate TypeScript fetch code", () => {
      const request = new Request(
        "POST",
        "https://api.example.com/users",
        {
          Authorization: "Bearer token123",
          "Content-Type": "application/json",
        },
        undefined,
        {
          name: "John Doe",
        }
      );

      const fetchCode = request.toFetchCode("userResponse");

      expect(fetchCode).toContain("const userResponse = await fetch");
      expect(fetchCode).toContain("method: 'POST'");
      expect(fetchCode).toContain("'Authorization': 'Bearer token123'");
      expect(fetchCode).toContain("body: JSON.stringify");
    });

    it("should handle query parameters in fetch code", () => {
      const request = new Request(
        "GET",
        "https://api.example.com/search",
        {},
        {
          q: "test",
          limit: "10",
        }
      );

      const fetchCode = request.toFetchCode();

      expect(fetchCode).toContain("const params = new URLSearchParams");
      expect(fetchCode).toContain("q: 'test'");
      expect(fetchCode).toContain("limit: '10'");
      expect(fetchCode).toContain("params.toString()");
    });
  });

  describe("extractDynamicParts", () => {
    it("should extract potential tokens from URL", () => {
      const request = new Request(
        "GET",
        "https://api.example.com/users/abc123def456/profile",
        {}
      );

      const dynamicParts = request.extractDynamicParts();

      expect(dynamicParts).toContain("abc123def456");
    });

    it("should extract tokens from headers", () => {
      const request = new Request("GET", "https://api.example.com/users", {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "X-API-Key": "sk_test_1234567890abcdef",
      });

      const dynamicParts = request.extractDynamicParts();

      expect(dynamicParts.length).toBeGreaterThan(0);
      // Check for the JWT token or the API key parts
      const hasJwtPart = dynamicParts.some((part) =>
        part.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6")
      );
      const hasApiKeyPart = dynamicParts.some((part) =>
        part.includes("1234567890abcdef")
      );
      expect(hasJwtPart || hasApiKeyPart).toBe(true);
    });

    it("should extract tokens from query parameters", () => {
      const request = new Request(
        "GET",
        "https://api.example.com/data",
        {},
        {
          token: "abc123def456789",
          session_id: "sess_1234567890abcdef",
        }
      );

      const dynamicParts = request.extractDynamicParts();

      expect(dynamicParts).toContain("abc123def456789");
      expect(dynamicParts).toContain("sess_1234567890abcdef");
    });
  });

  describe("clone", () => {
    it("should create a copy of the request", () => {
      const original = new Request(
        "GET",
        "https://api.example.com/users",
        {
          Authorization: "Bearer token123",
        },
        { limit: "10" }
      );

      const cloned = original.clone();

      expect(cloned.method).toBe(original.method);
      expect(cloned.url).toBe(original.url);
      expect(cloned.headers).toEqual(original.headers);
      expect(cloned.queryParams).toEqual(original.queryParams);

      // Should be different objects
      expect(cloned).not.toBe(original);
      expect(cloned.headers).not.toBe(original.headers);
    });

    it("should apply modifications when cloning", () => {
      const original = new Request("GET", "https://api.example.com/users", {});

      const modified = original.clone({
        method: "POST",
        body: { data: "test" },
      });

      expect(modified.method).toBe("POST");
      expect(modified.url).toBe(original.url);
      expect(modified.body).toEqual({ data: "test" });
    });
  });

  describe("toString", () => {
    it("should return method and URL", () => {
      const request = new Request("POST", "https://api.example.com/users", {});

      expect(request.toString()).toBe("POST https://api.example.com/users");
    });
  });
});
