/**
 * GdbRspProtocol — unit tests for RSP encoding/decoding helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  GDB_REG_NAMES,
  GDB_REG_COUNT,
  GDB_REG_HEX_BYTES,
  computeRspChecksum,
  decodeRspPacket,
  encodeRspPacket,
  rleEncode,
  rleDecode,
  parseRspFields,
  bytesToHex,
  hexToBytes,
  toHex,
  fromHex,
  generateTargetXml,
  generateThreadsXml,
} from '@native/GdbRspProtocol';

// ── constants ─────────────────────────────────────────────────────

describe('GDB_REG_NAMES', () => {
  it('contains 33 registers: x0-x30, sp, pc', () => {
    expect(GDB_REG_COUNT).toBe(33);
    expect(GDB_REG_NAMES[0]).toBe('x0');
    expect(GDB_REG_NAMES[30]).toBe('x30');
    expect(GDB_REG_NAMES[31]).toBe('sp');
    expect(GDB_REG_NAMES[32]).toBe('pc');
  });

  it('is frozen (immutable)', () => {
    expect(() => {
      (GDB_REG_NAMES as string[])[0] = 'bad';
    }).toThrow();
  });
});

describe('GDB_REG_HEX_BYTES', () => {
  it('is 16 (8 bytes in hex)', () => {
    expect(GDB_REG_HEX_BYTES).toBe(16);
  });
});

// ── checksum ───────────────────────────────────────────────────────

describe('computeRspChecksum', () => {
  it('computes modulo-256 sum of all bytes', () => {
    // 'S' = 0x53 = 83, '0' = 0x30 = 48, '5' = 0x35 = 53. Sum = 184 = 0xb8
    expect(computeRspChecksum('S05')).toBe('b8');
  });

  it('handles empty string', () => {
    expect(computeRspChecksum('')).toBe('00');
  });

  it('wraps at 256', () => {
    // 'xxxx' = 120*4 = 480, 480 mod 256 = 224 = 0xe0
    expect(computeRspChecksum('xxxx')).toBe('e0');
  });

  it('is always 2 lowercase chars', () => {
    expect(computeRspChecksum('g')).toHaveLength(2);
    expect(computeRspChecksum('a')).toBe(computeRspChecksum('a').toLowerCase());
  });
});

// ── packet encode/decode ───────────────────────────────────────────

describe('decodeRspPacket', () => {
  it('parses a valid packet with checksum', () => {
    const result = decodeRspPacket('$S05#b8');
    expect(result.valid).toBe(true);
    expect(result.data).toBe('S05');
  });

  it('rejects packet without $ prefix', () => {
    const result = decodeRspPacket('S05#b8');
    expect(result.valid).toBe(false);
  });

  it('rejects packet without #checksum', () => {
    const result = decodeRspPacket('$S05');
    expect(result.valid).toBe(false);
  });

  it('handles empty data', () => {
    const result = decodeRspPacket('$#00');
    expect(result.valid).toBe(true);
    expect(result.data).toBe('');
  });

  it('trims whitespace', () => {
    const result = decodeRspPacket('  $g#67  ');
    expect(result.valid).toBe(true);
    expect(result.data).toBe('g');
  });

  it('handles $qSupported packet', () => {
    const pkt = '$qSupported:multiprocess+;swbreak+#00';
    const result = decodeRspPacket(pkt);
    expect(result.valid).toBe(true);
    expect(result.data).toContain('qSupported');
    expect(result.data).toContain('multiprocess+');
  });
});

describe('encodeRspPacket', () => {
  it('wraps data in $...#checksum format', () => {
    const pkt = encodeRspPacket('OK');
    expect(pkt.startsWith('$')).toBe(true);
    expect(pkt).toContain('#');
    // OK = 0x4F + 0x4B = 0x9A
    expect(pkt).toBe('$OK#9a');
  });

  it('produces a packet that decodeRspPacket can parse', () => {
    const data = '0000000100000002';
    const pkt = encodeRspPacket(data);
    const result = decodeRspPacket(pkt);
    expect(result.valid).toBe(true);
    expect(result.data).toBe(data);
  });

  it('handles empty string', () => {
    const pkt = encodeRspPacket('');
    expect(pkt).toBe('$#00');
  });
});

// ── run-length encoding ────────────────────────────────────────────

describe('rleEncode', () => {
  it('passes through short strings without compression', () => {
    expect(rleEncode('abc')).toBe('abc');
  });

  it('compresses runs of 4+ identical chars', () => {
    // 0 repeated 5 times: '00000'
    // Run of 5: '0' + '*' + chr(5+29=34) = '0*"'
    const encoded = rleEncode('00000');
    expect(encoded).toBe('0*"'); // 5 - 29 = -24... wait
    // Let me check: the encoding uses charCode at. GDB convention: c*N where N = repeatCount + 29
    // For 5 repeats: N = 5 + 29 = 34 = '"'
    // So '00000' → '0*"'
    // But wait, that means we encode '0' char plus the repeat count. The problem is:
    // If the input is 5 zeros '00000', after encoding we get '0*"' which is 3 chars.
    // When decoded: '0' + '*' triggers the decoder to look at the next char '"' (34), count = 34 - 29 = 5
    // So it repeats '0' 5 times. Output: '00000' + the already-read '0' = '000000'? No wait:
    // The decoder: if ch == '*' and i > 0, it pops the last part (which is the first '0')
    // Then pushes prev.repeat(count) which is '0'.repeat(5) = '00000'
    // So total output: '00000' ✓
    expect(rleDecode(encoded)).toBe('00000');
  });

  it('does not compress runs of 3', () => {
    expect(rleEncode('000')).toBe('000');
  });

  it('round-trips through rleDecode', () => {
    const orig = '0'.repeat(10) + '1'.repeat(20) + '2'.repeat(3);
    const encoded = rleEncode(orig);
    const decoded = rleDecode(encoded);
    expect(decoded).toBe(orig);
  });

  it('caps repeat at 97 (max printable RLE count)', () => {
    const orig = 'a'.repeat(200);
    const encoded = rleEncode(orig);
    // Should have multiple RLE chunks since max repeat is 97
    const decoded = rleDecode(encoded);
    expect(decoded).toBe(orig);
  });
});

describe('rleDecode', () => {
  it('handles string without any * markers', () => {
    expect(rleDecode('abcdef')).toBe('abcdef');
  });

  it('decodes a single RLE sequence', () => {
    // '*' + chr(29+3=32=' ') means repeat previous char 3 times
    // But the "*" itself is preceded by something
    // Example: 'a* ' where ' ' is chr(32), count=32-29=3
    // The decoder: sees 'a', pushes 'a'. Sees '*', pops 'a', repeats 3 times → 'aaa'
    expect(rleDecode('a* ')).toBe('aaa');
  });
});

// ── parseRspFields ─────────────────────────────────────────────────

describe('parseRspFields', () => {
  it('splits m command: maddr,len', () => {
    // Split on comma only: m1000,10 → ['m1000', '10']
    const fields = parseRspFields('m1000,10');
    expect(fields).toEqual(['m1000', '10']);
  });

  it('splits M command: Maddr,len:data', () => {
    // Split on comma + colon: M1000,10:ff → ['M1000', '10', 'ff']
    const fields = parseRspFields('M1000,10:ff');
    expect(fields).toEqual(['M1000', '10', 'ff']);
  });

  it('splits Z command: Z0,addr,kind', () => {
    const fields = parseRspFields('Z0,1000,4');
    expect(fields).toEqual(['Z0', '1000', '4']);
  });

  it('splits vCont: vCont;s:1', () => {
    const fields = parseRspFields('vCont;s:1');
    expect(fields).toEqual(['vCont', 's:1']);
  });
});

// ── hex conversion ─────────────────────────────────────────────────

describe('bytesToHex', () => {
  it('converts Uint8Array to hex', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex(bytes)).toBe('deadbeef');
  });

  it('converts number array to hex', () => {
    expect(bytesToHex([0x00, 0xff, 0x0a])).toBe('00ff0a');
  });

  it('handles empty array', () => {
    expect(bytesToHex([])).toBe('');
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

describe('hexToBytes', () => {
  it('converts hex to Uint8Array', () => {
    const bytes = hexToBytes('deadbeef');
    expect(bytes).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('handles odd-length hex (pads with leading zero)', () => {
    const bytes = hexToBytes('fff');
    expect(bytes).toEqual(new Uint8Array([0x0f, 0xff]));
  });
});

describe('toHex', () => {
  it('converts number to unpadded hex', () => {
    expect(toHex(255)).toBe('ff');
  });

  it('pads to specified width', () => {
    expect(toHex(1, 8)).toBe('00000001');
  });
});

describe('fromHex', () => {
  it('parses hex string with 0x prefix', () => {
    expect(fromHex('0x1000')).toBe(4096);
  });

  it('parses hex string without 0x prefix', () => {
    expect(fromHex('ff')).toBe(255);
  });
});

// ── target XML ─────────────────────────────────────────────────────

describe('generateTargetXml', () => {
  it('includes architecture aarch64', () => {
    const xml = generateTargetXml();
    expect(xml).toContain('<architecture>aarch64</architecture>');
  });

  it('includes x0-x30 registers', () => {
    const xml = generateTargetXml();
    for (let i = 0; i <= 30; i++) {
      expect(xml).toContain(`<reg name="x${i}"`);
    }
  });

  it('includes sp and pc registers', () => {
    const xml = generateTargetXml();
    expect(xml).toContain('<reg name="sp"');
    expect(xml).toContain('<reg name="pc"');
  });
});

describe('generateThreadsXml', () => {
  it('includes thread id 1', () => {
    const xml = generateThreadsXml();
    expect(xml).toContain('<thread id="1"');
    expect(xml).toContain('nemu-main');
  });
});
