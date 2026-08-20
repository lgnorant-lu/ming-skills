import { describe, expect, it, vi } from 'vitest';
import { ProtocolAnalysisHandlers } from '@server/domains/protocol-analysis/handlers';

function toHex(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

describe('ProtocolAnalysisHandlers — handleProtoDissectHttp', () => {
  const eventBus = { emit: vi.fn() } as any;
  const handlers = new ProtocolAnalysisHandlers(undefined, undefined, eventBus);

  it('decodes a GET request with method, target, version, and headers', async () => {
    const payload = toHex(
      'GET /api/v1/users?id=42 HTTP/1.1\r\nHost: example.com\r\nAccept: application/json\r\n\r\n',
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    expect(result.byteLength).toBe(payload.length / 2);
    const message = result.message!;
    expect(message.kind).toBe('request');
    expect(message.method).toBe('GET');
    expect(message.requestTarget).toBe('/api/v1/users?id=42');
    expect(message.httpVersion).toBe('1.1');
    expect(message.headers).toHaveLength(2);
    expect(message.headersByKey['host']).toBe('example.com');
    expect(message.headersByKey['accept']).toBe('application/json');
    expect(message.bodyHex).toBe('');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'protocol:http_dissected',
      expect.objectContaining({
        byteLength: result.byteLength,
        kind: 'request',
        headerCount: 2,
      }),
    );
  });

  it('decodes a POST request with a body and Content-Length', async () => {
    const body = '{"name":"alice"}';
    const payload = toHex(
      `POST /submit HTTP/1.1\r\nHost: example.com\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.method).toBe('POST');
    expect(message.contentLength).toBe(body.length);
    expect(message.contentType).toBe('application/json');
    expect(Buffer.from(message.bodyHex, 'hex').toString('utf8')).toBe(body);
  });

  it('decodes a 200 OK response with status line and reason phrase', async () => {
    const payload = toHex(
      'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nHello',
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.kind).toBe('response');
    expect(message.httpVersion).toBe('1.1');
    expect(message.statusCode).toBe(200);
    expect(message.reasonPhrase).toBe('OK');
    expect(Buffer.from(message.bodyHex, 'hex').toString('utf8')).toBe('Hello');
  });

  it('decodes a 404 response with an empty reason phrase', async () => {
    const payload = toHex('HTTP/1.1 404 \r\nContent-Length: 0\r\n\r\n');

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    expect(result.message!.statusCode).toBe(404);
    expect(result.message!.reasonPhrase).toBe('');
  });

  it('unwinds a chunked transfer-encoding body into a single decoded buffer', async () => {
    // Two chunks: "Hello" (5 bytes) and "World" (5 bytes), then a terminating 0-chunk.
    const payload = toHex(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' +
        '5\r\nHello\r\n' +
        '5\r\nWorld\r\n' +
        '0\r\n\r\n',
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.transferEncoding).toBe('chunked');
    expect(message.chunkCount).toBe(2);
    expect(message.malformedChunks).toEqual([]);
    expect(Buffer.from(message.decodedBodyHex ?? '', 'hex').toString('utf8')).toBe('HelloWorld');
  });

  it('reports a malformed chunk when a chunk size token is invalid', async () => {
    const payload = toHex(
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' +
        'not-hex\r\nHello\r\n' +
        '0\r\n\r\n',
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    expect(result.message!.malformedChunks.length).toBeGreaterThan(0);
    expect(result.message!.chunkCount).toBe(0);
  });

  it('merges repeated headers into the keyed map (last value wins)', async () => {
    const payload = toHex(
      'GET / HTTP/1.1\r\nX-Forwarded-For: 10.0.0.1\r\nX-Forwarded-For: 10.0.0.2\r\n\r\n',
    );

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    const message = result.message!;
    expect(message.headers).toHaveLength(2);
    expect(message.headersByKey['x-forwarded-for']).toBe('10.0.0.2');
  });

  it('treats header names case-insensitively', async () => {
    const payload = toHex('GET / HTTP/1.1\r\nHOST: example.com\r\n\r\n');

    const result = await handlers.handleProtoDissectHttp({ packetHex: payload });

    expect(result.success).toBe(true);
    expect(result.message!.host).toBe('example.com');
  });

  it('returns a structured error for a payload missing a start line', async () => {
    const result = await handlers.handleProtoDissectHttp({ packetHex: '00' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('start line');
  });

  it('returns a structured error for invalid hex', async () => {
    const result = await handlers.handleProtoDissectHttp({ packetHex: 'xyz' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('hex');
  });

  it('returns a structured error when packetHex is missing', async () => {
    const result = await handlers.handleProtoDissectHttp({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('packetHex');
  });
});
