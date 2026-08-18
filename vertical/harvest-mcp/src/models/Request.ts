import type { RequestModel, ResponseData } from "../types/index.js";

export class Request implements RequestModel {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public queryParams?: Record<string, string>;
  public body?: unknown;
  public response?: ResponseData;
  public timestamp?: Date;

  constructor(
    method: string,
    url: string,
    headers: Record<string, string>,
    queryParams?: Record<string, string>,
    body?: unknown,
    response?: ResponseData,
    timestamp?: Date
  ) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    if (queryParams !== undefined) {
      this.queryParams = queryParams;
    }
    if (body !== undefined) {
      this.body = body;
    }
    if (response !== undefined) {
      this.response = response;
    }
    if (timestamp !== undefined) {
      this.timestamp = timestamp;
    }
  }

  /**
   * Generate a full cURL command from the request
   */
  toCurlCommand(): string {
    const curlParts: string[] = [`curl -X ${this.method}`];

    // Add headers
    for (const [name, value] of Object.entries(this.headers)) {
      // Escape single quotes in header values
      const escapedValue = value.replace(/'/g, "'\"'\"'");
      curlParts.push(`-H '${name}: ${escapedValue}'`);
    }

    // Build URL with query parameters
    let finalUrl = this.url;
    if (this.queryParams && Object.keys(this.queryParams).length > 0) {
      const queryString = Object.entries(this.queryParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const separator = this.url.includes("?") ? "&" : "?";
      finalUrl = `${this.url}${separator}${queryString}`;
    }

    // Add request body if present
    if (this.body) {
      const contentType = this.getContentType();

      if (typeof this.body === "object") {
        // JSON data
        if (!contentType || contentType.includes("application/json")) {
          if (!contentType) {
            curlParts.push(`-H 'Content-Type: application/json'`);
          }
          const jsonData = JSON.stringify(this.body).replace(/'/g, "'\"'\"'");
          curlParts.push(`--data '${jsonData}'`);
        } else {
          // Form data
          const formData = Object.entries(this.body)
            .map(
              ([k, v]) =>
                `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
            )
            .join("&");
          curlParts.push(`--data '${formData}'`);
        }
      } else if (typeof this.body === "string") {
        // String data
        const escapedData = this.body.replace(/'/g, "'\"'\"'");
        curlParts.push(`--data '${escapedData}'`);
      }
    }

    // Add the final URL (escaped)
    const escapedUrl = finalUrl.replace(/'/g, "'\"'\"'");
    curlParts.push(`'${escapedUrl}'`);

    return curlParts.join(" ");
  }

  /**
   * Generate a minified cURL command (removes certain headers to reduce noise)
   */
  toMinifiedCurlCommand(): string {
    const curlParts: string[] = [`curl -X ${this.method}`];

    // Headers to exclude from minified version
    const excludeHeaders = [
      "referer",
      "cookie",
      "user-agent",
      "accept-encoding",
      "accept-language",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
    ];

    // Add headers (excluding noise headers)
    for (const [name, value] of Object.entries(this.headers)) {
      if (!excludeHeaders.includes(name.toLowerCase())) {
        const escapedValue = value.replace(/'/g, "'\"'\"'");
        curlParts.push(`-H '${name}: ${escapedValue}'`);
      }
    }

    // Build URL with query parameters
    let finalUrl = this.url;
    if (this.queryParams && Object.keys(this.queryParams).length > 0) {
      const queryString = Object.entries(this.queryParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      const separator = this.url.includes("?") ? "&" : "?";
      finalUrl = `${this.url}${separator}${queryString}`;
    }

    // Add request body if present
    if (this.body) {
      const contentType = this.getContentType();

      if (typeof this.body === "object") {
        // JSON data
        if (!contentType || contentType.includes("application/json")) {
          const jsonData = JSON.stringify(this.body).replace(/'/g, "'\"'\"'");
          curlParts.push(`--data '${jsonData}'`);
        } else {
          // Form data
          const formData = Object.entries(this.body)
            .map(
              ([k, v]) =>
                `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
            )
            .join("&");
          curlParts.push(`--data '${formData}'`);
        }
      } else if (typeof this.body === "string") {
        // String data
        const escapedData = this.body.replace(/'/g, "'\"'\"'");
        curlParts.push(`--data '${escapedData}'`);
      }
    }

    // Add the final URL (escaped)
    const escapedUrl = finalUrl.replace(/'/g, "'\"'\"'");
    curlParts.push(`'${escapedUrl}'`);

    return curlParts.join(" ");
  }

  /**
   * Convert to TypeScript fetch code
   */
  toFetchCode(variableName = "response"): string {
    const lines: string[] = [];

    // Build URL
    let urlCode = `'${this.url}'`;
    if (this.queryParams && Object.keys(this.queryParams).length > 0) {
      const params = Object.entries(this.queryParams)
        .map(([k, v]) => `  ${k}: '${v}'`)
        .join(",\n");

      lines.push("const params = new URLSearchParams({");
      lines.push(params);
      lines.push("});");
      urlCode = `'${this.url}?' + params.toString()`;
    }

    // Build options object
    const options: string[] = [`  method: '${this.method}'`];

    // Add headers
    if (Object.keys(this.headers).length > 0) {
      const headerLines = Object.entries(this.headers)
        .map(([k, v]) => `    '${k}': '${v.replace(/'/g, "\\'")}'`)
        .join(",\n");

      options.push(`  headers: {\n${headerLines}\n  }`);
    }

    // Add body
    if (this.body) {
      if (typeof this.body === "object") {
        options.push(
          `  body: JSON.stringify(${JSON.stringify(this.body, null, 2).replace(/^/gm, "    ")})`
        );
      } else if (typeof this.body === "string") {
        options.push(`  body: '${this.body.replace(/'/g, "\\'")}'`);
      } else {
        options.push(`  body: '${String(this.body)}'`);
      }
    }

    // Generate fetch call
    lines.push(`const ${variableName} = await fetch(${urlCode}, {`);
    lines.push(options.join(",\n"));
    lines.push("});");

    return lines.join("\n");
  }

  /**
   * Get content type from headers
   */
  private getContentType(): string | undefined {
    for (const [key, value] of Object.entries(this.headers)) {
      if (key.toLowerCase() === "content-type") {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Create a copy of the request with modified properties
   */
  clone(modifications?: Partial<RequestModel>): Request {
    return new Request(
      modifications?.method ?? this.method,
      modifications?.url ?? this.url,
      modifications?.headers ?? { ...this.headers },
      modifications?.queryParams ??
        (this.queryParams ? { ...this.queryParams } : undefined),
      modifications?.body ?? this.body,
      modifications?.response ?? this.response
    );
  }

  /**
   * Extract dynamic parts from the request that might need resolution
   */
  extractDynamicParts(): string[] {
    const dynamicParts: Set<string> = new Set();

    // Check URL for potential tokens/IDs
    const urlParts = this.url.match(/[a-f0-9]{8,}|[A-Z0-9]{10,}/g) || [];
    for (const part of urlParts) {
      dynamicParts.add(part);
    }

    // Check headers for tokens
    for (const [key, value] of Object.entries(this.headers)) {
      if (
        key.toLowerCase().includes("authorization") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("x-api")
      ) {
        const tokenParts = value.match(/[a-f0-9]{8,}|[A-Z0-9]{10,}/g) || [];
        for (const part of tokenParts) {
          dynamicParts.add(part);
        }
      }
    }

    // Check query parameters
    if (this.queryParams) {
      for (const [key, value] of Object.entries(this.queryParams)) {
        if (
          key.toLowerCase().includes("token") ||
          key.toLowerCase().includes("id") ||
          key.toLowerCase().includes("session")
        ) {
          if (value.match(/[a-f0-9]{8,}|[A-Z0-9]{10,}/)) {
            dynamicParts.add(value);
          }
        }
      }
    }

    // Check body for tokens/IDs
    if (this.body && typeof this.body === "object") {
      const bodyStr = JSON.stringify(this.body);
      const bodyParts = bodyStr.match(/[a-f0-9]{8,}|[A-Z0-9]{10,}/g) || [];
      for (const part of bodyParts) {
        dynamicParts.add(part);
      }
    }

    return Array.from(dynamicParts);
  }

  /**
   * String representation of the request
   */
  toString(): string {
    return `${this.method} ${this.url}`;
  }
}
