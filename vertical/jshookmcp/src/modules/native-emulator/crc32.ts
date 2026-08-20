/**
 * ARMv8 CRC32 / CRC32C (CRC32B/H/W/X + CRC32CB/CH/CW/CX).
 *
 * Reflected CRC-32: standard zlib/gzip polynomial 0x04C11DB7 (reflected
 * 0xEDB88320); CRC32C uses Castagnoli 0x1EDC6F41 (reflected 0x82F63B78). The
 * ARM instruction appends the low `sizeBytes` of Rm (LSB-first) to the 32-bit
 * accumulator in Rn and returns the updated CRC. Bit-exact against the zlib
 * (0xCBF43926 over "123456789") and iSCSI CRC32C (0xE3069283) test vectors.
 */
function buildTable(poly: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ poly : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = buildTable(0xedb88320);
const CRC32C_TABLE = buildTable(0x82f63b78);

/**
 * @param accumulator Current 32-bit CRC value (Rn).
 * @param data        Full 64-bit Rm value; only the low `sizeBytes` are consumed.
 * @param sizeBytes   1 (CRC32B/CB), 2 (H/CH), 4 (W/CW), or 8 (X/CX).
 * @param isVariantC  true for CRC32C (Castagnoli), false for CRC32.
 */
export function computeArmCrc32(
  accumulator: number,
  data: bigint,
  sizeBytes: number,
  isVariantC: boolean,
): number {
  const table = isVariantC ? CRC32C_TABLE : CRC32_TABLE;
  let crc = accumulator >>> 0;
  const value = BigInt.asUintN(64, data);
  for (let i = 0; i < sizeBytes; i++) {
    const byte = Number((value >> BigInt(i * 8)) & 0xffn);
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!;
  }
  return crc >>> 0;
}
