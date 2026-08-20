import { describe, expect, it } from 'vitest';
import { computeArmCrc32 } from '@modules/native-emulator/crc32';

describe('computeArmCrc32', () => {
  it('full CRC32 of "123456789" matches the zlib test vector 0xCBF43926', () => {
    let crc = 0xffffffff;
    for (const ch of '123456789') {
      crc = computeArmCrc32(crc, BigInt(ch.charCodeAt(0)), 1, false);
    }
    expect((crc ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
  });

  it('full CRC32C of "123456789" matches the Castagnoli/iSCSI vector 0xE3069283', () => {
    let crc = 0xffffffff;
    for (const ch of '123456789') {
      crc = computeArmCrc32(crc, BigInt(ch.charCodeAt(0)), 1, true);
    }
    expect((crc ^ 0xffffffff) >>> 0).toBe(0xe3069283);
  });

  it('CRC32W (4 bytes) matches byte-wise CRC32B over the same bytes LSB-first', () => {
    let byteWise = 0;
    for (const b of [0x34, 0x33, 0x32, 0x31]) {
      byteWise = computeArmCrc32(byteWise, BigInt(b), 1, false);
    }
    expect(computeArmCrc32(0, 0x31323334n, 4, false)).toBe(byteWise);
  });

  it('CRC32X consumes the low 8 bytes of the 64-bit register LSB-first', () => {
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8];
    let byteWise = 0;
    for (const b of bytes) {
      byteWise = computeArmCrc32(byteWise, BigInt(b), 1, false);
    }
    let packed = 0n;
    for (let i = 0; i < bytes.length; i++) packed |= BigInt(bytes[i]!) << BigInt(i * 8);
    expect(computeArmCrc32(0, packed, 8, false)).toBe(byteWise);
  });

  it('CRC32C word path is consistent byte-wise vs word-wise', () => {
    let byteWise = 0;
    for (const b of [0x34, 0x33, 0x32, 0x31]) {
      byteWise = computeArmCrc32(byteWise, BigInt(b), 1, true);
    }
    expect(computeArmCrc32(0, 0x31323334n, 4, true)).toBe(byteWise);
  });
});
