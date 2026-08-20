/**
 * Coverage tests for protocol-analysis handler chain — pcapng (read/write +
 * validation helpers), DNS dissection, HTTP dissection. The leaf class
 * ProtocolAnalysisHttpHandlers inherits all methods; constructed with no args
 * (eventBus undefined → emitEvent is a no-op).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProtocolAnalysisHttpHandlers } from '@server/domains/protocol-analysis/handlers/http-handlers';

const TMP = join(process.cwd(), 'tests', 'tmp', 'protocol-cov');
mkdirSync(TMP, { recursive: true });

afterEach(() => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  mkdirSync(TMP, { recursive: true });
});

describe('proto_dissect_dns — handler wrapper', () => {
  const h = new ProtocolAnalysisHttpHandlers();

  it('parses a minimal DNS query', async () => {
    // ID=0x1234, flags=0x0100 (std query), QDCOUNT=1, rest 0, QNAME="a", QTYPE=A, QCLASS=IN
    const hex = Buffer.concat([
      Buffer.from([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x01, 0x61, 0x00, 0x00, 0x01, 0x00, 0x01]), // QNAME + QTYPE + QCLASS
    ]).toString('hex');

    const r = await h.handleProtoDissectDns({ packetHex: hex } as never);
    expect(r.success).toBe(true);
    expect(r.message).not.toBeNull();
    expect(r.byteLength).toBeGreaterThan(0);
  });

  it('errors on non-hex input', async () => {
    const r = await h.handleProtoDissectDns({ packetHex: 'xyz' } as never);
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it('errors on odd-length hex', async () => {
    const r = await h.handleProtoDissectDns({ packetHex: 'abc' } as never);
    expect(r.success).toBe(false);
  });

  it('errors when packetHex is not a string', async () => {
    const r = await h.handleProtoDissectDns({ packetHex: 123 } as never);
    expect(r.success).toBe(false);
  });
});

describe('proto_dissect_http — handler wrapper', () => {
  const h = new ProtocolAnalysisHttpHandlers();

  it('parses a GET request', async () => {
    const req = 'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n';
    const r = await h.handleProtoDissectHttp({
      packetHex: Buffer.from(req).toString('hex'),
    } as never);
    expect(r.success).toBe(true);
    expect(r.message?.kind).toBe('request');
  });

  it('parses a 200 response', async () => {
    const res = 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello';
    const r = await h.handleProtoDissectHttp({
      packetHex: Buffer.from(res).toString('hex'),
    } as never);
    expect(r.success).toBe(true);
    expect(r.message?.kind).toBe('response');
  });

  it('errors on invalid hex', async () => {
    const r = await h.handleProtoDissectHttp({ packetHex: 'nothex!!' } as never);
    expect(r.success).toBe(false);
  });
});

describe('pcapng_write — handler + validation helpers', () => {
  const h = new ProtocolAnalysisHttpHandlers();
  const outPath = join(TMP, 'out.pcapng');

  it('writes a valid pcapng from one interface + one packet', async () => {
    const r = await h.handlePcapngWrite({
      path: outPath,
      interfaces: [{ linkType: 1, name: 'eth0' }],
      packets: [{ dataHex: 'aabbccdd' }],
    } as never);
    expect(r.success).toBe(true);
    expect(r.packetCount).toBe(1);
    expect(r.interfaceCount).toBe(1);
    expect(r.byteLength).toBeGreaterThan(0);
    expect(r.endianness).toBe('little');
  });

  it('honors big-endian + custom versions', async () => {
    const r = await h.handlePcapngWrite({
      path: join(TMP, 'be.pcapng'),
      endianness: 'big',
      majorVersion: 1,
      minorVersion: 0,
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: '00112233', interfaceId: 0 }],
    } as never);
    expect(r.success).toBe(true);
    expect(r.endianness).toBe('big');
  });

  it('rejects interfaces not an array', async () => {
    const r = await h.handlePcapngWrite({
      path: outPath,
      interfaces: 'nope',
      packets: [],
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/interfaces must be an array/);
  });

  it('rejects packets not an array', async () => {
    const r = await h.handlePcapngWrite({
      path: outPath,
      interfaces: [],
      packets: 'nope',
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/packets must be an array/);
  });

  it('rejects a bad linkType', async () => {
    const r = await h.handlePcapngWrite({
      path: outPath,
      interfaces: [{ linkType: -1 }],
      packets: [],
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/linkType/);
  });

  it('rejects a bad packet dataHex', async () => {
    const r = await h.handlePcapngWrite({
      path: outPath,
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'xyz' }],
    } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/dataHex/);
  });

  it('rejects a missing path', async () => {
    const r = await h.handlePcapngWrite({ interfaces: [{ linkType: 1 }], packets: [] } as never);
    expect(r.success).toBe(false);
  });
});

describe('pcapng_read — handler', () => {
  const h = new ProtocolAnalysisHttpHandlers();

  it('reads back a file written by pcapng_write', async () => {
    const path = join(TMP, 'roundtrip.pcapng');
    await h.handlePcapngWrite({
      path,
      interfaces: [{ linkType: 1 }],
      packets: [{ dataHex: 'deadbeef' }],
    } as never);
    const r = await h.handlePcapngRead({ path } as never);
    expect(r.success).toBe(true);
    expect(r.blockCount).toBeGreaterThan(0);
    expect(r.packets.length).toBe(1);
  });

  it('errors on a too-small file', async () => {
    const path = join(TMP, 'tiny.pcapng');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from([0, 0, 0]));
    const r = await h.handlePcapngRead({ path } as never);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/too small/i);
  });

  it('errors when the path is missing', async () => {
    const r = await h.handlePcapngRead({ path: join(TMP, 'nope.pcapng') } as never);
    expect(r.success).toBe(false);
  });
});
