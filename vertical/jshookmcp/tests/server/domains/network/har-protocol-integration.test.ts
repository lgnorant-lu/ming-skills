/**
 * Integration test for CRIT-08: HAR export with real-world mixed protocol traffic
 * Demonstrates that HAR export correctly captures HTTP/1.1, HTTP/2, and HTTP/3 traffic
 */

import { describe, it, expect } from 'vitest';
import { buildHar } from '@server/domains/network/har';

describe('CRIT-08 Integration: Real-world HAR Export with Mixed Protocols', () => {
  it('should export realistic multi-protocol traffic from a modern web app', async () => {
    // Simulate real-world captured traffic from a modern web application
    // that uses HTTP/1.1 for legacy APIs, HTTP/2 for CDN assets, and HTTP/3 for streaming
    const requests = [
      // Legacy API endpoint (HTTP/1.1)
      {
        requestId: 'req1',
        url: 'https://legacy-api.example.com/v1/users',
        method: 'GET',
        headers: { accept: 'application/json' },
        protocol: 'http/1.1',
      },
      // CDN asset over HTTP/2
      {
        requestId: 'req2',
        url: 'https://cdn.example.com/assets/app.js',
        method: 'GET',
        headers: { accept: '*/*' },
        protocol: 'h2',
      },
      // Image over HTTP/2
      {
        requestId: 'req3',
        url: 'https://cdn.example.com/images/logo.png',
        method: 'GET',
        headers: { accept: 'image/*' },
        protocol: 'h2',
      },
      // Modern API with HTTP/2
      {
        requestId: 'req4',
        url: 'https://api.example.com/graphql',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"query":"{ user { id name } }"}',
        protocol: 'h2',
      },
      // Video streaming over HTTP/3 (QUIC)
      {
        requestId: 'req5',
        url: 'https://video.example.com/stream/hls/playlist.m3u8',
        method: 'GET',
        headers: { accept: 'application/vnd.apple.mpegurl' },
        protocol: 'h3',
      },
      // WebSocket upgrade (starts with HTTP/1.1)
      {
        requestId: 'req6',
        url: 'wss://realtime.example.com/updates',
        method: 'GET',
        headers: { upgrade: 'websocket' },
        protocol: 'http/1.1',
      },
      // Early QUIC implementation (http/2+quic/43)
      {
        requestId: 'req7',
        url: 'https://experimental.example.com/api/data',
        method: 'GET',
        headers: { accept: 'application/json' },
        protocol: 'http/2+quic/43',
      },
    ];

    const responses = new Map([
      [
        'req1',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
          protocol: 'http/1.1',
        },
      ],
      [
        'req2',
        {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/javascript',
            'cache-control': 'max-age=31536000',
          },
          mimeType: 'application/javascript',
          protocol: 'h2',
        },
      ],
      [
        'req3',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' },
          mimeType: 'image/png',
          protocol: 'h2',
        },
      ],
      [
        'req4',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
          protocol: 'h2',
        },
      ],
      [
        'req5',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/vnd.apple.mpegurl' },
          mimeType: 'application/vnd.apple.mpegurl',
          protocol: 'h3',
        },
      ],
      [
        'req6',
        {
          status: 101,
          statusText: 'Switching Protocols',
          headers: { upgrade: 'websocket', connection: 'Upgrade' },
          mimeType: 'text/plain',
          protocol: 'http/1.1',
        },
      ],
      [
        'req7',
        {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          mimeType: 'application/json',
          protocol: 'http/2+quic/43',
        },
      ],
    ]);

    const har = await buildHar({
      requests,
      getResponse: (requestId) => responses.get(requestId),
      getResponseBody: async () => null,
      includeBodies: false,
    });

    // Verify HAR structure
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('jshookmcp');
    expect(har.log.entries).toHaveLength(7);

    // Verify each entry has correct protocol
    const entries = har.log.entries;

    // req1: Legacy API (HTTP/1.1)
    expect(entries[0]?.request.httpVersion).toBe('HTTP/1.1');
    expect(entries[0]?.response.httpVersion).toBe('HTTP/1.1');
    expect(entries[0]?.request.url).toContain('legacy-api');

    // req2: CDN JS (HTTP/2)
    expect(entries[1]?.request.httpVersion).toBe('HTTP/2');
    expect(entries[1]?.response.httpVersion).toBe('HTTP/2');
    expect(entries[1]?.request.url).toContain('app.js');

    // req3: CDN Image (HTTP/2)
    expect(entries[2]?.request.httpVersion).toBe('HTTP/2');
    expect(entries[2]?.response.httpVersion).toBe('HTTP/2');
    expect(entries[2]?.request.url).toContain('logo.png');

    // req4: GraphQL API (HTTP/2)
    expect(entries[3]?.request.httpVersion).toBe('HTTP/2');
    expect(entries[3]?.response.httpVersion).toBe('HTTP/2');
    expect(entries[3]?.request.method).toBe('POST');
    expect(entries[3]?.request.postData?.text).toContain('query');

    // req5: Video streaming (HTTP/3)
    expect(entries[4]?.request.httpVersion).toBe('HTTP/3');
    expect(entries[4]?.response.httpVersion).toBe('HTTP/3');
    expect(entries[4]?.request.url).toContain('video');

    // req6: WebSocket upgrade (HTTP/1.1)
    expect(entries[5]?.request.httpVersion).toBe('HTTP/1.1');
    expect(entries[5]?.response.httpVersion).toBe('HTTP/1.1');
    expect(entries[5]?.response.status).toBe(101);

    // req7: Early QUIC (HTTP/3)
    expect(entries[6]?.request.httpVersion).toBe('HTTP/3');
    expect(entries[6]?.response.httpVersion).toBe('HTTP/3');
    expect(entries[6]?.request.url).toContain('experimental');

    // Verify protocol distribution
    const protocols = entries.map((e) => e.request.httpVersion);
    expect(protocols.filter((p) => p === 'HTTP/1.1')).toHaveLength(2);
    expect(protocols.filter((p) => p === 'HTTP/2')).toHaveLength(3);
    expect(protocols.filter((p) => p === 'HTTP/3')).toHaveLength(2);
  });

  it('should handle protocol upgrade scenarios (ALT-SVC)', async () => {
    // Simulate ALT-SVC protocol upgrade: request sent as HTTP/1.1, response indicates HTTP/2 available
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
              headers: {
                'alt-svc': 'h2=":443"; ma=2592000',
              },
              mimeType: 'application/json',
              protocol: 'h2', // Server upgraded connection
            }
          : undefined,
      getResponseBody: async () => null,
      includeBodies: false,
    });

    // Request was HTTP/1.1, but response came back as HTTP/2
    expect(har.log.entries[0]?.request.httpVersion).toBe('HTTP/1.1');
    expect(har.log.entries[0]?.response.httpVersion).toBe('HTTP/2');
    expect(har.log.entries[0]?.response.headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'alt-svc',
          value: 'h2=":443"; ma=2592000',
        }),
      ]),
    );
  });

  it('should correctly export HAR that can be imported into Chrome DevTools', async () => {
    // This test verifies that the exported HAR structure is valid for Chrome DevTools import
    const har = await buildHar({
      requests: [
        {
          requestId: 'req1',
          url: 'https://www.google.com/',
          method: 'GET',
          headers: { 'user-agent': 'Chrome/120.0' },
          protocol: 'h3', // Google uses HTTP/3
        },
      ],
      getResponse: (requestId) =>
        requestId === 'req1'
          ? {
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'text/html' },
              mimeType: 'text/html',
              protocol: 'h3',
            }
          : undefined,
      getResponseBody: async () => null,
      includeBodies: false,
      creatorVersion: '0.3.3',
    });

    // Verify HAR 1.2 structure compliance
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator).toEqual({
      name: 'jshookmcp',
      version: '0.3.3',
    });

    // Verify entry structure
    const entry = har.log.entries[0];
    expect(entry).toBeDefined();
    expect(entry?.request).toHaveProperty('method');
    expect(entry?.request).toHaveProperty('url');
    expect(entry?.request).toHaveProperty('httpVersion');
    expect(entry?.request).toHaveProperty('headers');
    expect(entry?.request).toHaveProperty('queryString');
    expect(entry?.request).toHaveProperty('cookies');
    expect(entry?.request).toHaveProperty('headersSize');
    expect(entry?.request).toHaveProperty('bodySize');

    expect(entry?.response).toHaveProperty('status');
    expect(entry?.response).toHaveProperty('statusText');
    expect(entry?.response).toHaveProperty('httpVersion');
    expect(entry?.response).toHaveProperty('headers');
    expect(entry?.response).toHaveProperty('cookies');
    expect(entry?.response).toHaveProperty('content');
    expect(entry?.response).toHaveProperty('redirectURL');
    expect(entry?.response).toHaveProperty('headersSize');
    expect(entry?.response).toHaveProperty('bodySize');

    // Verify HTTP/3 protocol
    expect(entry?.request.httpVersion).toBe('HTTP/3');
    expect(entry?.response.httpVersion).toBe('HTTP/3');

    // JSON serialization test (HAR files are JSON)
    expect(() => JSON.stringify(har)).not.toThrow();
    const serialized = JSON.stringify(har, null, 2);
    expect(serialized).toContain('"httpVersion": "HTTP/3"');
  });
});
