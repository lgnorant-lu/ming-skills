import { describe, expect, it } from 'vitest';

import { parseGrpcFrames, buildGrpcBody } from '@server/domains/network/grpc-raw';

describe('network grpc-raw parseGrpcFrames', () => {
  it('parses a single uncompressed message (hex)', () => {
    // flag=0x00, length=5, payload="Hello"
    const data = '000000000548656c6c6f';
    const { frames, warnings } = parseGrpcFrames(data);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      index: 0,
      compressed: false,
      isTrailer: false,
      flag: 0,
      declaredLength: 5,
      payloadBytes: 5,
      truncated: false,
    });
    expect(frames[0]!.payloadHex).toBe('48656c6c6f');
    expect(warnings).toHaveLength(0);
  });

  it('parses multiple concatenated messages', () => {
    const data = '000000000241420000000003414243';
    const { frames } = parseGrpcFrames(data);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.payloadHex).toBe('4142');
    expect(frames[1]!.payloadHex).toBe('414243');
    expect(frames[1]!.index).toBe(1);
  });

  it('detects the compressed flag (bit 0)', () => {
    const data = '01000000029900';
    const { frames } = parseGrpcFrames(data);
    expect(frames[0]!.compressed).toBe(true);
    expect(frames[0]!.isTrailer).toBe(false);
    expect(frames[0]!.flag).toBe(0x01);
  });

  it('detects a gRPC-Web trailer frame (bit 7)', () => {
    // trailer payload is ASCII: "grpc-status:0\r\n"
    const trailerText = 'grpc-status:0\r\n';
    const trailer = Buffer.from(trailerText, 'ascii').toString('hex');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(trailerText.length, 0);
    const fixed = '80' + len.toString('hex') + trailer;
    const { frames } = parseGrpcFrames(fixed);
    expect(frames[0]!.isTrailer).toBe(true);
    expect(frames[0]!.compressed).toBe(false);
    expect(frames[0]!.flag).toBe(0x80);
  });

  it('decodes base64 input identically to hex', () => {
    const hexData = '000000000548656c6c6f';
    const b64 = Buffer.from(hexData, 'hex').toString('base64');
    const fromHex = parseGrpcFrames(hexData, 'hex');
    const fromB64 = parseGrpcFrames(b64, 'base64');
    expect(fromB64.frames).toEqual(fromHex.frames);
  });

  it('tolerates URL-safe base64 (- and _)', () => {
    const hexData = '0000000005fbfa'; // payload bytes that map to +/ in base64
    const buf = Buffer.from(hexData, 'hex');
    const urlSafeB64 = buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const { frames } = parseGrpcFrames(urlSafeB64, 'base64');
    expect(frames[0]!.payloadHex).toBe('fbfa');
  });

  it('emits a truncated frame with a warning when declared length exceeds remaining', () => {
    // declares 10 payload bytes but only 2 remain
    const data = '000000000a4142';
    const { frames, warnings } = parseGrpcFrames(data);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.truncated).toBe(true);
    expect(frames[0]!.payloadBytes).toBe(2);
    expect(frames[0]!.declaredLength).toBe(10);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/declares 10 payload bytes but only 2 remain/);
  });

  it('warns on stray trailing bytes too short for a header', () => {
    const data = '00000000024142ff'; // 1 stray byte
    const { frames, warnings } = parseGrpcFrames(data);
    expect(frames).toHaveLength(1);
    expect(warnings.some((w) => /trailing 1 bytes/.test(w))).toBe(true);
  });

  it('warns when input is shorter than a frame header', () => {
    const { frames, warnings } = parseGrpcFrames('0001', 'hex');
    expect(frames).toHaveLength(0);
    expect(warnings[0]).toMatch(/shorter than a single gRPC frame header/);
  });

  it('rejects invalid hex and invalid base64', () => {
    expect(() => parseGrpcFrames('zz', 'hex')).toThrow();
    expect(() => parseGrpcFrames('@@@', 'base64')).toThrow();
    expect(() => parseGrpcFrames('', 'hex')).toThrow();
  });

  it('payloadBase64 is the base64 of the same bytes as payloadHex', () => {
    const data = '000000000548656c6c6f';
    const { frames } = parseGrpcFrames(data);
    expect(frames[0]!.payloadBase64).toBe(Buffer.from('48656c6c6f', 'hex').toString('base64'));
    // and decodes back to "Hello"
    expect(Buffer.from(frames[0]!.payloadBase64, 'base64').toString('utf8')).toBe('Hello');
  });
});

describe('network grpc-raw buildGrpcBody', () => {
  it('builds a single-message body and round-trips through parse', () => {
    const built = buildGrpcBody([{ payloadHex: '48656c6c6f' }]);
    expect(built.messageCount).toBe(1);
    expect(built.hex).toBe('000000000548656c6c6f');
    const { frames } = parseGrpcFrames(built.hex);
    expect(frames).toHaveLength(1);
    expect(frames[0]!.payloadHex).toBe('48656c6c6f');
  });

  it('encodes compressed and trailer flags', () => {
    const built = buildGrpcBody([
      { payloadHex: 'aa', compressed: true },
      { payloadHex: '616263', isTrailer: true },
    ]);
    const { frames } = parseGrpcFrames(built.hex);
    expect(frames[0]!.compressed).toBe(true);
    expect(frames[0]!.flag).toBe(0x01);
    expect(frames[1]!.isTrailer).toBe(true);
    expect(frames[1]!.flag).toBe(0x80);
  });

  it('round-trips multiple messages', () => {
    const built = buildGrpcBody([
      { payloadHex: '0102' },
      { payloadHex: '030405' },
      { payloadHex: '06' },
    ]);
    const { frames } = parseGrpcFrames(built.hex);
    expect(frames.map((f) => f.payloadHex)).toEqual(['0102', '030405', '06']);
  });

  it('exposes base64 output', () => {
    const built = buildGrpcBody([{ payloadHex: '48656c6c6f' }]);
    const reparsed = parseGrpcFrames(built.base64, 'base64');
    expect(reparsed.frames[0]!.payloadHex).toBe('48656c6c6f');
  });

  it('rejects an empty messages array and invalid payloadHex', () => {
    expect(() => buildGrpcBody([])).toThrow('non-empty');
    expect(() => buildGrpcBody([{ payloadHex: 'xyz' }])).toThrow('even-length hex');
  });
});
