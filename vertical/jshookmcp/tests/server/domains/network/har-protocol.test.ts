/**
 * HAR Protocol Version Tests (CRIT-08 Fix)
 * Tests that HAR export correctly captures HTTP/1.1, HTTP/2, and HTTP/3 protocol versions
 * instead of hardcoding HTTP/1.1 for all requests.
 */

import { describe, it, expect } from 'vitest';
import { buildHar } from '@server/domains/network/har';

describe('HAR Protocol Version Support', () => {
  describe('HTTP/1.1 traffic', () => {
    it('should export HTTP/1.1 when protocol is http/1.1', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'http/1.1',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                protocol: 'http/1.1',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries).toHaveLength(1);
      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/1.1');
    });

    it('should handle HTTP/1.0 correctly', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'http/1.0',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'text/html',
                protocol: 'http/1.0',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.0');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/1.0');
    });
  });

  describe('HTTP/2 traffic', () => {
    it('should export HTTP/2 when protocol is h2', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req2',
            url: 'https://http2.example.com/data',
            method: 'POST',
            headers: {},
            protocol: 'h2',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req2'
            ? {
                status: 201,
                statusText: 'Created',
                headers: {},
                mimeType: 'application/json',
                protocol: 'h2',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries).toHaveLength(1);
      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/2');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/2');
    });

    it('should handle h2c (HTTP/2 cleartext) correctly', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'http://h2c.example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'h2c',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'text/plain',
                protocol: 'h2c',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/2');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/2');
    });
  });

  describe('HTTP/3 traffic', () => {
    it('should export HTTP/3 when protocol is h3', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req3',
            url: 'https://http3.example.com/stream',
            method: 'GET',
            headers: {},
            protocol: 'h3',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req3'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'video/mp4',
                protocol: 'h3',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries).toHaveLength(1);
      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/3');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/3');
    });

    it('should handle http/2+quic variant', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://quic.example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'http/2+quic/43',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                protocol: 'http/2+quic/43',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/3');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/3');
    });
  });

  describe('Mixed protocol traffic', () => {
    it('should handle different protocols for different requests', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/http1',
            method: 'GET',
            headers: {},
            protocol: 'http/1.1',
          },
          {
            requestId: 'req2',
            url: 'https://example.com/http2',
            method: 'GET',
            headers: {},
            protocol: 'h2',
          },
          {
            requestId: 'req3',
            url: 'https://example.com/http3',
            method: 'GET',
            headers: {},
            protocol: 'h3',
          },
        ],
        getResponse: (requestId) => {
          if (requestId === 'req1') {
            return {
              status: 200,
              statusText: 'OK',
              headers: {},
              mimeType: 'text/html',
              protocol: 'http/1.1',
            };
          }
          if (requestId === 'req2') {
            return {
              status: 200,
              statusText: 'OK',
              headers: {},
              mimeType: 'application/json',
              protocol: 'h2',
            };
          }
          if (requestId === 'req3') {
            return {
              status: 200,
              statusText: 'OK',
              headers: {},
              mimeType: 'video/webm',
              protocol: 'h3',
            };
          }
          return undefined;
        },
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries).toHaveLength(3);
      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[1]?.request.httpVersion).toBe('HTTP/2');
      expect(har.log.entries[1]?.response.httpVersion).toBe('HTTP/2');
      expect(har.log.entries[2]?.request.httpVersion).toBe('HTTP/3');
      expect(har.log.entries[2]?.response.httpVersion).toBe('HTTP/3');
    });
  });

  describe('Fallback behavior', () => {
    it('should default to HTTP/1.1 when protocol is undefined', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            // no protocol field
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                // no protocol field
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/1.1');
    });

    it('should handle unknown protocol values gracefully', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'unknown-protocol',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                protocol: 'weird/123',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      // Should preserve unknown protocol as-is or fallback to HTTP/1.1
      const version = har.log.entries[0]?.request.httpVersion;
      expect(typeof version).toBe('string');
      expect(version?.length).toBeGreaterThan(0);
    });

    it('should handle empty protocol string', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            protocol: '',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                protocol: '',
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/1.1');
    });
  });

  describe('Request/Response protocol mismatch', () => {
    it('should handle different protocols for request and response (upgrade scenarios)', async () => {
      const har = await buildHar({
        requests: [
          {
            requestId: 'req1',
            url: 'https://example.com/api',
            method: 'GET',
            headers: {},
            protocol: 'http/1.1',
          },
        ],
        getResponse: (requestId) =>
          requestId === 'req1'
            ? {
                status: 200,
                statusText: 'OK',
                headers: {},
                mimeType: 'application/json',
                protocol: 'h2', // Server upgraded to HTTP/2
              }
            : undefined,
        getResponseBody: async () => null,
        includeBodies: false,
      });

      // Request was HTTP/1.1, response is HTTP/2 (ALT-SVC upgrade)
      expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
      expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/2');
    });
  });
});
