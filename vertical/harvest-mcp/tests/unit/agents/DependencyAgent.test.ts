import { beforeEach, describe, expect, it } from "vitest";
import {
  findCookieDependencies,
  findDependencies,
  findRequestDependencies,
  isJavaScriptOrHtml,
  selectSimplestRequest,
} from "../../../src/agents/DependencyAgent.js";
import { Request } from "../../../src/models/Request.js";
import type { CookieData, ParsedHARData } from "../../../src/types/index.js";

describe("DependencyAgent", () => {
  let mockHARData: ParsedHARData;
  let mockCookieData: CookieData;

  beforeEach(() => {
    // Set API key for LLM client
    process.env.OPENAI_API_KEY = "test-api-key";

    // Mock HAR data with requests and responses
    const loginRequest = new Request(
      "POST",
      "https://api.example.com/auth/login",
      { "Content-Type": "application/json" },
      {},
      { username: "user@example.com", password: "secret" }
    );

    const profileRequest = new Request(
      "GET",
      "https://api.example.com/user/profile",
      { Authorization: "Bearer token123" },
      { user_id: "12345" }
    );

    const searchRequest = new Request(
      "POST",
      "https://api.example.com/search",
      { Authorization: "Bearer token123" },
      {},
      { query: "documents", user_id: "12345" }
    );

    // Add response data
    loginRequest.response = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      text: '{"access_token": "token123", "user_id": "12345", "session_id": "sess456"}',
      json: {
        access_token: "token123",
        user_id: "12345",
        session_id: "sess456",
      },
    };

    profileRequest.response = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      text: '{"name": "John Doe", "email": "user@example.com"}',
      json: { name: "John Doe", email: "user@example.com" },
    };

    searchRequest.response = {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
      text: '{"results": ["doc1", "doc2"], "total": 2}',
      json: { results: ["doc1", "doc2"], total: 2 },
    };

    mockHARData = {
      requests: [loginRequest, profileRequest, searchRequest],
      urls: [
        {
          method: "POST",
          url: loginRequest.url,
          requestType: "JSON",
          responseType: "JSON",
        },
        {
          method: "GET",
          url: profileRequest.url,
          requestType: "Query",
          responseType: "JSON",
        },
        {
          method: "POST",
          url: searchRequest.url,
          requestType: "JSON",
          responseType: "JSON",
        },
      ],
    };

    mockCookieData = {
      session_cookie: {
        value: "sess456",
        domain: "example.com",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      user_pref: {
        value: "theme_dark",
        domain: "example.com",
        path: "/",
      },
    };
  });

  describe("findDependencies", () => {
    it("should find cookie dependencies", async () => {
      const cookieParts = ["sess456"];

      const result = await findDependencies(
        cookieParts,
        mockHARData,
        mockCookieData
      );

      expect(result.cookieDependencies).toHaveLength(1);
      expect(result.cookieDependencies[0]).toEqual({
        type: "cookie",
        cookieKey: "session_cookie",
        dynamicPart: "sess456",
      });
    });

    it("should find request dependencies", async () => {
      const requestParts = ["token123", "12345"];

      const result = await findDependencies(
        requestParts,
        mockHARData,
        mockCookieData
      );

      expect(result.requestDependencies).toHaveLength(2);

      // Both token123 and 12345 should be found in login response
      const tokenDep = result.requestDependencies.find(
        (dep) => dep.dynamicPart === "token123"
      );
      const userIdDep = result.requestDependencies.find(
        (dep) => dep.dynamicPart === "12345"
      );

      expect(tokenDep).toBeDefined();
      expect(tokenDep?.sourceRequest.url).toBe(
        "https://api.example.com/auth/login"
      );
      expect(userIdDep).toBeDefined();
      expect(userIdDep?.sourceRequest.url).toBe(
        "https://api.example.com/auth/login"
      );
    });

    it("should handle not found parts", async () => {
      const unknownParts = ["unknown_token", "missing_id"];

      const result = await findDependencies(
        unknownParts,
        mockHARData,
        mockCookieData
      );

      expect(result.notFoundParts).toHaveLength(2);
      expect(result.notFoundParts).toContain("unknown_token");
      expect(result.notFoundParts).toContain("missing_id");
    });

    it("should prioritize cookies over requests", async () => {
      // If a part exists in both cookies and requests, cookies should be preferred
      const mixedParts = ["sess456"]; // This exists in both cookie and login response

      const result = await findDependencies(
        mixedParts,
        mockHARData,
        mockCookieData
      );

      expect(result.cookieDependencies).toHaveLength(1);
      expect(result.requestDependencies).toHaveLength(0);
    });
  });

  describe("findCookieDependencies", () => {
    it("should find matching cookies", () => {
      const result = findCookieDependencies(["sess456"], mockCookieData);

      expect(result.found).toHaveLength(1);
      expect(result.found[0]).toEqual({
        type: "cookie",
        cookieKey: "session_cookie",
        dynamicPart: "sess456",
      });
      expect(result.remaining).toEqual([]);
    });

    it("should return remaining parts when not found", () => {
      const result = findCookieDependencies(["unknown"], mockCookieData);

      expect(result.found).toEqual([]);
      expect(result.remaining).toEqual(["unknown"]);
    });
  });

  describe("findRequestDependencies", () => {
    it("should find requests containing dynamic parts in responses", () => {
      const result = findRequestDependencies(
        ["token123"],
        mockHARData.requests
      );

      expect(result.length).toBeGreaterThan(0);
      const tokenSource = result.find((dep) => dep.dynamicPart === "token123");
      expect(tokenSource).toBeDefined();
      expect(tokenSource?.sourceRequest.url).toBe(
        "https://api.example.com/auth/login"
      );
    });

    it("should exclude JavaScript files", () => {
      const jsRequest = new Request(
        "GET",
        "https://example.com/script.js",
        {},
        {}
      );
      jsRequest.response = {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/javascript" },
        text: 'var token = "token123";',
      };

      const requests = [...mockHARData.requests, jsRequest];
      const result = findRequestDependencies(["token123"], requests);

      // Should still find the login request, not the JS file
      expect(result.some((dep) => dep.sourceRequest.url.endsWith(".js"))).toBe(
        false
      );
    });
  });

  describe("selectSimplestRequest", () => {
    it("should return single request when only one option", () => {
      const firstRequest = mockHARData.requests[0];
      if (!firstRequest) {
        throw new Error("No request available");
      }
      const requests = [firstRequest];

      const result = selectSimplestRequest(requests);

      expect(result).toBe(requests[0]);
    });

    it("should select simpler requests using heuristics", () => {
      const [loginRequest, profileRequest, searchRequest] =
        mockHARData.requests;
      if (!loginRequest || !profileRequest || !searchRequest) {
        throw new Error("Missing test requests");
      }

      // profileRequest should be selected as simplest (GET, fewer headers, simpler URL)
      const result = selectSimplestRequest([
        loginRequest,
        profileRequest,
        searchRequest,
      ]);

      expect(result).toBe(profileRequest); // GET request with Authorization header
    });

    it("should prefer requests without bodies", () => {
      const [loginRequest, profileRequest] = mockHARData.requests;
      if (!loginRequest || !profileRequest) {
        throw new Error("Missing test requests");
      }

      // profileRequest (GET, no body) should be simpler than loginRequest (POST with body)
      const result = selectSimplestRequest([loginRequest, profileRequest]);

      expect(result).toBe(profileRequest);
    });
  });

  describe("isJavaScriptOrHtml", () => {
    it("should detect JavaScript files", () => {
      const jsRequest = new Request(
        "GET",
        "https://example.com/script.js",
        {},
        {}
      );
      expect(isJavaScriptOrHtml(jsRequest)).toBe(true);
    });

    it("should detect HTML responses", () => {
      const htmlRequest = new Request(
        "GET",
        "https://example.com/page",
        {},
        {}
      );
      htmlRequest.response = {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html" },
      };
      expect(isJavaScriptOrHtml(htmlRequest)).toBe(true);
    });

    it("should not detect API requests", () => {
      const firstRequest = mockHARData.requests[0];
      if (!firstRequest) {
        throw new Error("No request available");
      }
      expect(isJavaScriptOrHtml(firstRequest)).toBe(false);
    });
  });
});
