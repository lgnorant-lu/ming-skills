import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';

import { buildHttp2Frame } from '@server/domains/network/http2-raw';
import {
  parseHttp2Frames,
  parsePriorityPayload,
  computeHttp2Fingerprint,
} from '@server/domains/network/handlers/http2-fingerprint';

describe('network http2-fingerprint parseHttp2Frames', () => {
  it('parses a single SETTINGS frame', () => {
    const built = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [
        { id: 1, value: 4096 },
        { id: 4, value: 65535 },
      ],
    });
    const { frames, prefaceSkipped, warnings } = parseHttp2Frames(built.frameHex);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frameType).toBe('SETTINGS');
    expect(prefaceSkipped).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it('parses multiple concatenated frames', () => {
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const windowUpdate = buildHttp2Frame({
      frameType: 'WINDOW_UPDATE',
      streamId: 0,
      windowSizeIncrement: 15663105,
    });
    const { frames, warnings } = parseHttp2Frames(settings.frameHex + windowUpdate.frameHex);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.frameType).toBe('SETTINGS');
    expect(frames[1]!.frameType).toBe('WINDOW_UPDATE');
    expect(warnings).toHaveLength(0);
  });

  it('detects and skips the 24-byte connection preface magic', () => {
    const magic = '505249202a20485454502f322e300d0a0d0a534d0d0a0d0a'; // PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const { frames, prefaceSkipped, warnings } = parseHttp2Frames(magic + settings.frameHex);
    expect(prefaceSkipped).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.frameType).toBe('SETTINGS');
    expect(warnings).toHaveLength(0);
  });

  it('tolerates whitespace in the hex input', () => {
    const built = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const spaced = built.frameHex.match(/.{1,4}/g)!.join(' ');
    const { frames } = parseHttp2Frames(spaced);
    expect(frames).toHaveLength(1);
  });

  it('records a warning instead of throwing on a truncated trailing frame', () => {
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    // Append 3 stray bytes (too short for any frame header).
    const { frames, warnings } = parseHttp2Frames(settings.frameHex + '0000ff');
    expect(frames).toHaveLength(1);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/trailing/);
  });

  it('rejects non-hex or odd-length input', () => {
    expect(() => parseHttp2Frames('zzzz')).toThrow();
    expect(() => parseHttp2Frames('abc')).toThrow();
    expect(() => parseHttp2Frames('')).toThrow();
  });
});

describe('network http2-fingerprint parsePriorityPayload', () => {
  it('decodes a 5-byte PRIORITY payload', () => {
    // exclusive=1, dependsOn=0x00000003, weight=15
    const payload = '800000030f';
    const info = parsePriorityPayload(payload, 1);
    expect(info).toEqual({ streamId: 1, exclusive: true, dependsOn: 3, weight: 15 });
  });

  it('decodes a non-exclusive dependency', () => {
    // exclusive=0, dependsOn=5, weight=255
    const payload = '00000005ff';
    const info = parsePriorityPayload(payload, 3);
    expect(info).toEqual({ streamId: 3, exclusive: false, dependsOn: 5, weight: 255 });
  });

  it('returns null for a malformed (short) payload', () => {
    expect(parsePriorityPayload('00', 1)).toBeNull();
  });
});

describe('network http2-fingerprint computeHttp2Fingerprint', () => {
  it('builds a canonical string from SETTINGS + WINDOW_UPDATE', () => {
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [
        { id: 1, value: 4096 },
        { id: 3, value: 1000 },
        { id: 4, value: 65535 },
      ],
    });
    const windowUpdate = buildHttp2Frame({
      frameType: 'WINDOW_UPDATE',
      streamId: 0,
      windowSizeIncrement: 15663105,
    });
    const { frames } = parseHttp2Frames(settings.frameHex + windowUpdate.frameHex);
    const fp = computeHttp2Fingerprint(frames);

    expect(fp.canonical).toBe('1:4096;3:1000;4:65535|15663105|');
    expect(fp.settings).toEqual([
      { id: 1, value: 4096 },
      { id: 3, value: 1000 },
      { id: 4, value: 65535 },
    ]);
    expect(fp.windowUpdateIncrement).toBe(15663105);
    expect(fp.priorities).toEqual([]);
    expect(fp.frameCount).toBe(2);
  });

  it('hash is sha256(canonical) and stable', () => {
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const windowUpdate = buildHttp2Frame({
      frameType: 'WINDOW_UPDATE',
      streamId: 0,
      windowSizeIncrement: 15663105,
    });
    const { frames } = parseHttp2Frames(settings.frameHex + windowUpdate.frameHex);
    const fp = computeHttp2Fingerprint(frames);
    const expected = createHash('sha256').update('1:4096|15663105|').digest('hex');
    expect(fp.hash).toBe(expected);
    expect(fp.hash).toHaveLength(64);
  });

  it('omits absent settings rather than rendering defaults (absence is the signal)', () => {
    // Chrome-style: only HEADER_TABLE_SIZE + INITIAL_WINDOW_SIZE sent.
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [
        { id: 1, value: 65536 },
        { id: 4, value: 131072 },
      ],
    });
    const { frames } = parseHttp2Frames(settings.frameHex);
    const fp = computeHttp2Fingerprint(frames);
    expect(fp.canonical).toBe('1:65536;4:131072||');
    expect(fp.windowUpdateIncrement).toBeNull();
  });

  it('ignores SETTINGS ACK frames (carry no settings)', () => {
    const ack = buildHttp2Frame({ frameType: 'SETTINGS', ack: true });
    const real = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const { frames } = parseHttp2Frames(ack.frameHex + real.frameHex);
    const fp = computeHttp2Fingerprint(frames);
    expect(fp.settings).toEqual([{ id: 1, value: 4096 }]);
    expect(fp.canonical).toBe('1:4096||');
  });

  it('includes PRIORITY frames in the priority part of the canonical string', () => {
    // PRIORITY frame: type code 0x2, streamId 3, payload exclusive=0/dependsOn=0/weight=16.
    const priorityHex = buildRawPriorityFrame(3, false, 0, 16);
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const { frames } = parseHttp2Frames(settings.frameHex + priorityHex);
    const fp = computeHttp2Fingerprint(frames);
    expect(fp.priorities).toEqual([{ streamId: 3, exclusive: false, dependsOn: 0, weight: 16 }]);
    expect(fp.canonical).toBe('1:4096||3:16');
  });

  it('returns an empty fingerprint for no usable frames', () => {
    const fp = computeHttp2Fingerprint([]);
    expect(fp.canonical).toBe('||');
    expect(fp.settings).toEqual([]);
    expect(fp.windowUpdateIncrement).toBeNull();
    expect(fp.priorities).toEqual([]);
    expect(fp.hash).toBe(createHash('sha256').update('||').digest('hex'));
  });

  it('only the stream-0 WINDOW_UPDATE contributes (per-stream updates ignored)', () => {
    const settings = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [{ id: 1, value: 4096 }],
    });
    const perStreamWU = buildHttp2Frame({
      frameType: 'WINDOW_UPDATE',
      streamId: 5,
      windowSizeIncrement: 999,
    });
    const { frames } = parseHttp2Frames(settings.frameHex + perStreamWU.frameHex);
    const fp = computeHttp2Fingerprint(frames);
    expect(fp.windowUpdateIncrement).toBeNull();
    expect(fp.canonical).toBe('1:4096||');
  });
});

/**
 * Build a raw PRIORITY frame (RFC 7540 §6.3). The PRIORITY type is not in the
 * buildable union, so we encode the 9-byte header + 5-byte payload by hand.
 */
function buildRawPriorityFrame(
  streamId: number,
  exclusive: boolean,
  dependsOn: number,
  weight: number,
): string {
  const payloadLength = 5; // 5-byte PRIORITY payload
  const typeCode = 0x2;
  const flags = 0;
  const header = Buffer.alloc(9);
  header[0] = (payloadLength >>> 16) & 0xff;
  header[1] = (payloadLength >>> 8) & 0xff;
  header[2] = payloadLength & 0xff;
  header[3] = typeCode;
  header[4] = flags;
  header.writeUInt32BE(streamId >>> 0, 5);
  header[5] = header[5]! & 0x7f;

  const payload = Buffer.alloc(5);
  const dependencyWord = (exclusive ? 0x80_00_00_00 : 0) | (dependsOn & 0x7f_ff_ff_ff);
  payload.writeUInt32BE(dependencyWord >>> 0, 0);
  payload[4] = weight & 0xff;

  return Buffer.concat([header, payload]).toString('hex');
}
