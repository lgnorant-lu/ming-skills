import { readFile } from "node:fs/promises";
import type { CookieData } from "../types/index.js";
import { expandTilde } from "../utils/pathUtils.js";

/**
 * Parse a cookie file and return cookie data
 */
export async function parseCookieFile(cookiePath: string): Promise<CookieData> {
  try {
    // Expand tilde paths to absolute paths
    const expandedPath = expandTilde(cookiePath);
    const cookieContent = await readFile(expandedPath, "utf-8");
    const cookies = JSON.parse(cookieContent);

    const cookieData: CookieData = {};

    // Handle different cookie file formats
    if (Array.isArray(cookies)) {
      // Format: Array of cookie objects (Chrome format)
      for (const cookie of cookies) {
        if (cookie.name && cookie.value !== undefined) {
          cookieData[cookie.name] = {
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
          };
        }
      }
    } else if (typeof cookies === "object") {
      // Format: Object with cookie name as key
      for (const [name, value] of Object.entries(cookies)) {
        if (typeof value === "string") {
          // Simple string value
          cookieData[name] = { value };
        } else if (typeof value === "object" && value !== null) {
          // Cookie object with metadata
          const cookieObj = value as Record<string, string | boolean>;
          cookieData[name] = {
            value: String(cookieObj.value || cookieObj.Value || ""),
            domain: String(cookieObj.domain || cookieObj.Domain || ""),
            path: String(cookieObj.path || cookieObj.Path || ""),
            secure: Boolean(cookieObj.secure || cookieObj.Secure),
            httpOnly: Boolean(cookieObj.httpOnly || cookieObj.HttpOnly),
          };
        }
      }
    }

    return cookieData;
  } catch (error) {
    throw new Error(
      `Failed to parse cookie file: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Find a cookie by searching for a specific value
 */
export function findCookieByValue(
  cookies: CookieData,
  searchValue: string
): string | null {
  for (const [cookieName, cookieInfo] of Object.entries(cookies)) {
    if (cookieInfo.value === searchValue) {
      return cookieName;
    }

    // Also check if the search value is contained within the cookie value
    if (cookieInfo.value.includes(searchValue)) {
      return cookieName;
    }
  }

  return null;
}

/**
 * Find cookies by name pattern
 */
export function findCookiesByPattern(
  cookies: CookieData,
  pattern: RegExp
): Record<string, string> {
  const matchingCookies: Record<string, string> = {};

  for (const [cookieName, cookieInfo] of Object.entries(cookies)) {
    if (pattern.test(cookieName)) {
      matchingCookies[cookieName] = cookieInfo.value;
    }
  }

  return matchingCookies;
}

/**
 * Get all cookie values as a simple key-value map
 */
export function getCookieValues(cookies: CookieData): Record<string, string> {
  const values: Record<string, string> = {};

  for (const [name, cookieInfo] of Object.entries(cookies)) {
    values[name] = cookieInfo.value;
  }

  return values;
}

/**
 * Convert cookies to cookie header string
 */
export function toCookieHeader(cookies: CookieData): string {
  const cookiePairs: string[] = [];

  for (const [name, cookieInfo] of Object.entries(cookies)) {
    cookiePairs.push(`${name}=${cookieInfo.value}`);
  }

  return cookiePairs.join("; ");
}

/**
 * Filter cookies by domain
 */
export function filterByDomain(
  cookies: CookieData,
  domain: string
): CookieData {
  const filtered: CookieData = {};

  for (const [name, cookieInfo] of Object.entries(cookies)) {
    if (
      !cookieInfo.domain ||
      cookieInfo.domain === domain ||
      domain.endsWith(cookieInfo.domain) ||
      cookieInfo.domain.endsWith(domain)
    ) {
      filtered[name] = cookieInfo;
    }
  }

  return filtered;
}

/**
 * Check if a cookie value looks like a token or session ID
 */
export function isLikelyToken(value: string): boolean {
  // Common patterns for tokens/session IDs
  const tokenPatterns = [
    /^[A-Za-z0-9+/]+=*$/, // Base64-like
    /^[A-Fa-f0-9]{16,}$/, // Hex string (16+ chars)
    /^[A-Za-z0-9]{20,}$/, // Alphanumeric string (20+ chars)
    /jwt/i, // JWT tokens
    /token/i, // Contains "token"
    /session/i, // Contains "session"
  ];

  // Must be at least 8 characters
  if (value.length < 8) {
    return false;
  }

  return tokenPatterns.some((pattern) => pattern.test(value));
}

/**
 * Extract potential authentication tokens from cookies
 */
export function extractAuthTokens(cookies: CookieData): Record<string, string> {
  const authTokens: Record<string, string> = {};

  for (const [name, cookieInfo] of Object.entries(cookies)) {
    const lowerName = name.toLowerCase();

    // Check cookie name for auth indicators
    const isAuthCookie = [
      "token",
      "auth",
      "session",
      "jwt",
      "bearer",
      "api",
      "access",
      "refresh",
    ].some((keyword) => lowerName.includes(keyword));

    // Check if value looks like a token
    const valueIsToken = isLikelyToken(cookieInfo.value);

    if (isAuthCookie || valueIsToken) {
      authTokens[name] = cookieInfo.value;
    }
  }

  return authTokens;
}
