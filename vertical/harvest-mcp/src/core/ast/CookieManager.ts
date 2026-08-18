/**
 * Cookie Management Utility for Generated API Clients
 *
 * Provides cookie handling functionality that works in both browser and Node.js environments.
 * This class is used by generated API clients to handle cookie-based authentication
 * and session management.
 *
 * Features:
 * - Universal cookie handling (browser + Node.js)
 * - Support for domain, path, secure, httpOnly attributes
 * - Integration with existing CookieData types
 * - Dependency injection for custom storage backends
 */

/**
 * Cookie attributes for setting cookies
 */
export interface CookieAttributes {
  /** Cookie domain */
  domain?: string;
  /** Cookie path */
  path?: string;
  /** Secure flag - only send over HTTPS */
  secure?: boolean;
  /** HttpOnly flag - not accessible via JavaScript */
  httpOnly?: boolean;
  /** Expiration date */
  expires?: Date;
  /** Max age in seconds */
  maxAge?: number;
  /** SameSite attribute */
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Cookie storage interface for different environments
 */
export interface CookieStorage {
  /** Get a cookie value by name */
  getCookie(name: string): string | null;
  /** Set a cookie with attributes */
  setCookie(name: string, value: string, attributes?: CookieAttributes): void;
  /** Remove a cookie */
  removeCookie(
    name: string,
    attributes?: Pick<CookieAttributes, "domain" | "path">
  ): void;
  /** Get all cookies as an object */
  getAllCookies(): Record<string, string>;
}

/**
 * Browser-based cookie storage implementation
 */
class BrowserCookieStorage implements CookieStorage {
  getCookie(name: string): string | null {
    // Use globalThis to avoid document reference issues
    const doc = (globalThis as { document?: Document & { cookie: string } })
      .document;
    if (!doc) {
      return null;
    }

    const value = `; ${doc.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      const cookieValue = parts.pop()?.split(";").shift();
      return cookieValue || null;
    }
    return null;
  }

  setCookie(
    name: string,
    value: string,
    attributes: CookieAttributes = {}
  ): void {
    const doc = (globalThis as { document?: Document & { cookie: string } })
      .document;
    if (!doc) {
      console.warn("Cannot set cookies in non-browser environment");
      return;
    }

    let cookieString = `${name}=${encodeURIComponent(value)}`;

    if (attributes.domain) {
      cookieString += `; Domain=${attributes.domain}`;
    }
    if (attributes.path) {
      cookieString += `; Path=${attributes.path}`;
    }
    if (attributes.expires) {
      cookieString += `; Expires=${attributes.expires.toUTCString()}`;
    }
    if (attributes.maxAge !== undefined) {
      cookieString += `; Max-Age=${attributes.maxAge}`;
    }
    if (attributes.secure) {
      cookieString += "; Secure";
    }
    if (attributes.httpOnly) {
      cookieString += "; HttpOnly";
    }
    if (attributes.sameSite) {
      cookieString += `; SameSite=${attributes.sameSite}`;
    }

    doc.cookie = cookieString;
  }

  removeCookie(
    name: string,
    attributes: Pick<CookieAttributes, "domain" | "path"> = {}
  ): void {
    this.setCookie(name, "", {
      ...attributes,
      expires: new Date(0),
    });
  }

  getAllCookies(): Record<string, string> {
    const doc = (globalThis as { document?: Document & { cookie: string } })
      .document;
    if (!doc) {
      return {};
    }

    const cookies: Record<string, string> = {};
    for (const cookie of doc.cookie.split(";")) {
      const [name, value] = cookie.trim().split("=");
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    }
    return cookies;
  }
}

/**
 * Node.js cookie storage implementation using in-memory storage
 * In production, this could be extended to use Redis, database, or file storage
 */
class NodeCookieStorage implements CookieStorage {
  private cookies: Map<
    string,
    { value: string; attributes: CookieAttributes }
  > = new Map();

  getCookie(name: string): string | null {
    const cookie = this.cookies.get(name);
    if (!cookie) {
      return null;
    }

    // Check if cookie has expired
    if (cookie.attributes.expires && cookie.attributes.expires < new Date()) {
      this.cookies.delete(name);
      return null;
    }

    return cookie.value;
  }

  setCookie(
    name: string,
    value: string,
    attributes: CookieAttributes = {}
  ): void {
    this.cookies.set(name, { value, attributes });
  }

  removeCookie(name: string): void {
    this.cookies.delete(name);
  }

  getAllCookies(): Record<string, string> {
    const result: Record<string, string> = {};
    const now = new Date();

    for (const [name, cookie] of this.cookies) {
      // Skip expired cookies
      if (cookie.attributes.expires && cookie.attributes.expires < now) {
        this.cookies.delete(name);
        continue;
      }
      result[name] = cookie.value;
    }

    return result;
  }

  /**
   * Get cookie storage as CookieData format for compatibility
   */
  getCookieData(): Record<
    string,
    {
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
    }
  > {
    const result: Record<
      string,
      {
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
      }
    > = {};

    for (const [name, cookie] of this.cookies) {
      const item: {
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
      } = {
        value: cookie.value,
      };
      if (cookie.attributes.domain) {
        item.domain = cookie.attributes.domain;
      }
      if (cookie.attributes.path) {
        item.path = cookie.attributes.path;
      }
      if (cookie.attributes.secure) {
        item.secure = cookie.attributes.secure;
      }
      if (cookie.attributes.httpOnly) {
        item.httpOnly = cookie.attributes.httpOnly;
      }

      result[name] = item;
    }

    return result;
  }
}

/**
 * Universal Cookie Manager
 *
 * Automatically detects the environment and uses the appropriate storage backend.
 * Can be used in generated API clients for cookie-based authentication.
 */
export class CookieManager {
  private storage: CookieStorage;

  constructor(customStorage?: CookieStorage) {
    if (customStorage) {
      this.storage = customStorage;
    } else if (this.isBrowserEnvironment()) {
      // Browser environment
      this.storage = new BrowserCookieStorage();
    } else {
      // Node.js environment
      this.storage = new NodeCookieStorage();
    }
  }

  /**
   * Type guard to check if we're in a browser environment
   */
  private isBrowserEnvironment(): boolean {
    return (
      typeof globalThis !== "undefined" &&
      "window" in globalThis &&
      "document" in globalThis
    );
  }

  /**
   * Get a cookie value by name
   */
  get(name: string): string | null {
    return this.storage.getCookie(name);
  }

  /**
   * Set a cookie with optional attributes
   */
  set(name: string, value: string, attributes?: CookieAttributes): void {
    this.storage.setCookie(name, value, attributes);
  }

  /**
   * Remove a cookie
   */
  remove(
    name: string,
    attributes?: Pick<CookieAttributes, "domain" | "path">
  ): void {
    this.storage.removeCookie(name, attributes);
  }

  /**
   * Get all cookies as an object
   */
  getAll(): Record<string, string> {
    return this.storage.getAllCookies();
  }

  /**
   * Check if a cookie exists
   */
  has(name: string): boolean {
    return this.get(name) !== null;
  }

  /**
   * Set multiple cookies from a CookieData object
   */
  setFromCookieData(
    cookieData: Record<
      string,
      {
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
      }
    >
  ): void {
    for (const [name, cookie] of Object.entries(cookieData)) {
      const attributes: CookieAttributes = {};
      if (cookie.domain) {
        attributes.domain = cookie.domain;
      }
      if (cookie.path) {
        attributes.path = cookie.path;
      }
      if (cookie.secure) {
        attributes.secure = cookie.secure;
      }
      if (cookie.httpOnly) {
        attributes.httpOnly = cookie.httpOnly;
      }

      this.set(name, cookie.value, attributes);
    }
  }

  /**
   * Get cookies in CookieData format for compatibility
   */
  getCookieData(): Record<
    string,
    {
      value: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
    }
  > {
    if (this.storage instanceof NodeCookieStorage) {
      return this.storage.getCookieData();
    }

    // For browser storage, we can only get values, not attributes
    const cookies = this.getAll();
    const result: Record<
      string,
      {
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
      }
    > = {};

    for (const [name, value] of Object.entries(cookies)) {
      result[name] = { value };
    }

    return result;
  }

  /**
   * Create a cookie manager with session from generated code
   * This is a helper method for generated API clients
   */
  static createWithSession(
    sessionCookies?: Record<string, string>
  ): CookieManager {
    const manager = new CookieManager();

    if (sessionCookies) {
      for (const [name, value] of Object.entries(sessionCookies)) {
        manager.set(name, value);
      }
    }

    return manager;
  }

  /**
   * Get cookies formatted for HTTP headers
   */
  getCookieHeader(): string {
    const cookies = this.getAll();
    return Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  /**
   * Parse Set-Cookie header and update cookies
   */
  parseSetCookieHeader(setCookieHeader: string): void {
    const parts = setCookieHeader.split(";").map((part) => part.trim());
    const nameValue = parts[0];
    if (!nameValue) {
      return;
    }

    const [name, value] = nameValue.split("=").map((s) => s.trim());

    if (!name || value === undefined) {
      return;
    }

    const attributes: CookieAttributes = {};

    // Parse attributes
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]?.toLowerCase();
      if (!part) {
        continue;
      }

      if (part === "secure") {
        attributes.secure = true;
      } else if (part === "httponly") {
        attributes.httpOnly = true;
      } else if (part.startsWith("domain=")) {
        attributes.domain = part.substring(7);
      } else if (part.startsWith("path=")) {
        attributes.path = part.substring(5);
      } else if (part.startsWith("expires=")) {
        attributes.expires = new Date(part.substring(8));
      } else if (part.startsWith("max-age=")) {
        attributes.maxAge = Number.parseInt(part.substring(8), 10);
      } else if (part.startsWith("samesite=")) {
        const sameSite = part.substring(9);
        if (
          sameSite === "strict" ||
          sameSite === "lax" ||
          sameSite === "none"
        ) {
          attributes.sameSite = (sameSite.charAt(0).toUpperCase() +
            sameSite.slice(1)) as "Strict" | "Lax" | "None";
        }
      }
    }

    this.set(name, decodeURIComponent(value), attributes);
  }
}

/**
 * Default cookie manager instance for convenience
 */
export const cookieManager = new CookieManager();

/**
 * Utility functions for generated code
 */
export const CookieUtils = {
  /**
   * Set a session cookie (typically used in generated cookie functions)
   */
  setSessionCookie: (
    name: string,
    value: string,
    attributes?: CookieAttributes
  ) => {
    cookieManager.set(name, value, attributes);
  },

  /**
   * Get a session cookie value
   */
  getSessionCookie: (name: string): string | null => {
    return cookieManager.get(name);
  },

  /**
   * Remove a session cookie
   */
  removeSessionCookie: (
    name: string,
    attributes?: Pick<CookieAttributes, "domain" | "path">
  ) => {
    cookieManager.remove(name, attributes);
  },

  /**
   * Create a manager from cookie data (for Node.js environments)
   */
  fromCookieData: (
    cookieData: Record<
      string,
      {
        value: string;
        domain?: string;
        path?: string;
        secure?: boolean;
        httpOnly?: boolean;
      }
    >
  ) => {
    const manager = new CookieManager();
    manager.setFromCookieData(cookieData);
    return manager;
  },
};
