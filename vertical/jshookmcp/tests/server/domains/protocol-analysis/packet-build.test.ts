/**
 * Unit tests for the network-packet builders: RFC 1071 checksum semantics
 * (including odd-length buffers, OCR finding 4123) and RFC 792 ICMP type codes.
 */

import { describe, expect, it } from 'vitest';
import {
  buildIcmpEcho,
  computeInternetChecksum,
} from '@server/domains/protocol-analysis/handlers/shared/network-packet/packet-build';

describe('computeInternetChecksum', () => {
  it('treats the final byte of an odd-length buffer as the high byte (RFC 1071)', () => {
    // bytes 01 02 03 → words 0x0102, 0x0300 → sum 0x0402 → ~sum = 0xfbfd
    expect(computeInternetChecksum(Buffer.from([0x01, 0x02, 0x03]))).toBe(0xfbfd);
  });

  it('folds carries across 16-bit words (all-ones buffer)', () => {
    // 0xffff + 0xffff = 0x1fffe → fold → 0xffff → ~sum = 0x0000
    expect(computeInternetChecksum(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(0x0000);
  });

  it('returns the complement of zero for an empty buffer', () => {
    expect(computeInternetChecksum(Buffer.alloc(0))).toBe(0xffff);
  });
});

describe('buildIcmpEcho', () => {
  it('maps request → type 8 and reply → type 0 (RFC 792)', () => {
    const request = buildIcmpEcho({
      operation: 'request',
      identifier: 1,
      sequenceNumber: 2,
      payload: Buffer.from('00', 'hex'),
    });
    expect(request.packet[0]).toBe(8);

    const reply = buildIcmpEcho({
      operation: 'reply',
      identifier: 1,
      sequenceNumber: 2,
      payload: Buffer.from('00', 'hex'),
    });
    expect(reply.packet[0]).toBe(0);
  });
});
