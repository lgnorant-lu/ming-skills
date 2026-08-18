import { describe, expect, it } from "vitest";
import {
  extractAuthTokens,
  filterByDomain,
  findCookieByValue,
  findCookiesByPattern,
  getCookieValues,
  isLikelyToken,
  toCookieHeader,
} from "../../../src/core/CookieParser.js";
import type { CookieData } from "../../../src/types/index.js";

describe("CookieParser", () => {
  // Note: parseCookieFile tests are skipped as they require file system mocking
  // The function is tested through integration tests that use real test files

  describe("findCookieByValue", () => {
    const cookies: CookieData = {
      sessionId: { value: "abc123session" },
      authToken: { value: "token_xyz789" },
      userId: { value: "12345" },
    };

    it("should find cookie by exact value match", () => {
      const result = findCookieByValue(cookies, "abc123session");
      expect(result).toBe("sessionId");
    });

    it("should find cookie by partial value match", () => {
      const result = findCookieByValue(cookies, "xyz789");
      expect(result).toBe("authToken");
    });

    it("should return null when value not found", () => {
      const result = findCookieByValue(cookies, "nonexistent");
      expect(result).toBeNull();
    });

    it("should return first match when multiple cookies contain value", () => {
      const cookiesWithDuplicates: CookieData = {
        first: { value: "shared123" },
        second: { value: "shared123" },
      };

      const result = findCookieByValue(cookiesWithDuplicates, "shared123");
      expect(result).toBe("first");
    });
  });

  describe("findCookiesByPattern", () => {
    const cookies: CookieData = {
      sessionId: { value: "session123" },
      authToken: { value: "token456" },
      userPrefs: { value: "prefs789" },
      sessionData: { value: "data123" },
    };

    it("should find cookies matching pattern", () => {
      const result = findCookiesByPattern(cookies, /session/i);
      expect(result).toEqual({
        sessionId: "session123",
        sessionData: "data123",
      });
    });

    it("should return empty object when no matches", () => {
      const result = findCookiesByPattern(cookies, /nonexistent/);
      expect(result).toEqual({});
    });

    it("should handle case-sensitive patterns", () => {
      const result = findCookiesByPattern(cookies, /Session/);
      expect(result).toEqual({});
    });
  });

  describe("getCookieValues", () => {
    it("should extract all cookie values", () => {
      const cookies: CookieData = {
        sessionId: { value: "session123" },
        authToken: { value: "token456", domain: ".example.com" },
        userId: { value: "789" },
      };

      const result = getCookieValues(cookies);
      expect(result).toEqual({
        sessionId: "session123",
        authToken: "token456",
        userId: "789",
      });
    });

    it("should handle empty cookies object", () => {
      const result = getCookieValues({});
      expect(result).toEqual({});
    });
  });

  describe("toCookieHeader", () => {
    it("should create cookie header string", () => {
      const cookies: CookieData = {
        sessionId: { value: "session123" },
        authToken: { value: "token456" },
        userId: { value: "789" },
      };

      const result = toCookieHeader(cookies);
      expect(result).toBe(
        "sessionId=session123; authToken=token456; userId=789"
      );
    });

    it("should handle empty cookies object", () => {
      const result = toCookieHeader({});
      expect(result).toBe("");
    });

    it("should handle cookies with special characters", () => {
      const cookies: CookieData = {
        specialCookie: { value: "value with spaces and = signs" },
      };

      const result = toCookieHeader(cookies);
      expect(result).toBe("specialCookie=value with spaces and = signs");
    });
  });

  describe("filterByDomain", () => {
    const cookies: CookieData = {
      globalCookie: { value: "global" },
      exampleCookie: { value: "example", domain: ".example.com" },
      subdomainCookie: { value: "subdomain", domain: ".api.example.com" },
      otherCookie: { value: "other", domain: ".other.com" },
    };

    it("should include cookies with no domain", () => {
      const result = filterByDomain(cookies, "example.com");
      expect(result).toHaveProperty("globalCookie");
    });

    it("should include cookies with exact domain match", () => {
      const result = filterByDomain(cookies, "example.com");
      expect(result).toHaveProperty("exampleCookie");
    });

    it("should include cookies when domain ends with cookie domain", () => {
      const result = filterByDomain(cookies, "api.example.com");
      expect(result).toHaveProperty("exampleCookie"); // .example.com matches api.example.com
    });

    it("should include cookies when cookie domain ends with target domain", () => {
      const result = filterByDomain(cookies, "example.com");
      expect(result).toHaveProperty("subdomainCookie"); // .api.example.com ends with example.com
    });

    it("should exclude cookies from different domains", () => {
      const result = filterByDomain(cookies, "example.com");
      expect(result).not.toHaveProperty("otherCookie");
    });
  });

  describe("isLikelyToken", () => {
    it("should identify base64-like strings as tokens", () => {
      expect(isLikelyToken("dGVzdFRva2VuMTIz")).toBe(true);
      expect(isLikelyToken("aGVsbG93b3JsZA==")).toBe(true);
    });

    it("should identify hex strings as tokens", () => {
      expect(isLikelyToken("1234567890abcdef1234567890abcdef")).toBe(true);
      expect(isLikelyToken("ABCDEF1234567890")).toBe(true);
    });

    it("should identify long alphanumeric strings as tokens", () => {
      expect(isLikelyToken("ABCdef123456789012345")).toBe(true);
      expect(isLikelyToken("sessionToken123456789")).toBe(true);
    });

    it("should identify JWT tokens", () => {
      expect(isLikelyToken("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")).toBe(true);
      expect(isLikelyToken("jwt_something")).toBe(true);
    });

    it('should identify tokens with "token" keyword', () => {
      expect(isLikelyToken("authtoken123")).toBe(true);
      expect(isLikelyToken("token_abc123")).toBe(true);
    });

    it("should identify session values", () => {
      expect(isLikelyToken("session_abc123")).toBe(true);
      expect(isLikelyToken("mysession123")).toBe(true);
    });

    it("should reject short strings", () => {
      expect(isLikelyToken("abc123")).toBe(false);
      expect(isLikelyToken("token")).toBe(false);
    });

    it("should reject simple text", () => {
      expect(isLikelyToken("user")).toBe(false); // Too short
      expect(isLikelyToken("user@example.com")).toBe(false); // Contains special chars that aren't base64
    });
  });

  describe("extractAuthTokens", () => {
    const cookies: CookieData = {
      sessionId: { value: "longSessionValue123456789" },
      authToken: { value: "shortAuth" },
      apiKey: { value: "1234567890abcdef1234567890abcdef" },
      userName: { value: "john_doe" },
      preferences: { value: "dark_mode" },
      jwtToken: { value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" },
      randomLongValue: { value: "thisIsAVeryLongValueButNotAToken12345" },
    };

    it("should extract cookies with auth-related names", () => {
      const result = extractAuthTokens(cookies);

      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("authToken");
      expect(result).toHaveProperty("apiKey");
      expect(result).toHaveProperty("jwtToken");
    });

    it("should extract cookies with token-like values", () => {
      const result = extractAuthTokens(cookies);

      expect(result).toHaveProperty("apiKey"); // Hex pattern
      expect(result).toHaveProperty("jwtToken"); // JWT pattern
      expect(result).toHaveProperty("sessionId"); // Long alphanumeric
    });

    it("should not extract regular cookies", () => {
      const result = extractAuthTokens(cookies);

      expect(result).not.toHaveProperty("userName");
      expect(result).not.toHaveProperty("preferences");
    });

    it("should handle empty cookies object", () => {
      const result = extractAuthTokens({});
      expect(result).toEqual({});
    });

    it("should extract cookies with various auth keywords", () => {
      const authCookies: CookieData = {
        bearerToken: { value: "bearer123456789" },
        accessToken: { value: "access123456789" },
        refreshToken: { value: "refresh123456789" },
        authentication: { value: "auth123456789" },
      };

      const result = extractAuthTokens(authCookies);

      expect(Object.keys(result)).toHaveLength(4);
      expect(result).toHaveProperty("bearerToken");
      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(result).toHaveProperty("authentication");
    });
  });
});
