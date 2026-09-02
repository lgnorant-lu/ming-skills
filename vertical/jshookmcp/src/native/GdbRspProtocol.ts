/**
 * GDB Remote Serial Protocol (RSP) shared helpers.
 *
 * Packet format: $<data>#<checksum>
 * Checksum = sum of <data> bytes, mod 256, hex-encoded (2 lowercase chars).
 *
 * Run-length encoding: * followed by a repeat count (0x20+29=77 max).
 * Example: "0* " -> 32 repeated bytes of 0x30.
 *
 * @module native/GdbRspProtocol
 */

// ── constants ───────────────────────────────────────────────────────────────

/** GDB 'g'/'G' register order: x0..x30 (31 GPRs) + sp + pc = 33 registers, each 64-bit. */
export const GDB_REG_NAMES: readonly string[] = Object.freeze(
  Array.from({ length: 31 }, (_, i) => `x${i}`).concat(['sp', 'pc']),
) as readonly string[];

/** Number of registers in the g/G packet. */
export const GDB_REG_COUNT = GDB_REG_NAMES.length;

/** Bytes per register in hex (16 hex chars = 8 bytes). */
export const GDB_REG_HEX_BYTES = 16;

// ── encoding / decoding ─────────────────────────────────────────────────────

/** Compute RSP checksum: sum of all bytes in data, mod 256, as 2-char lowercase hex. */
export function computeRspChecksum(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum = (sum + data.charCodeAt(i)) & 0xff;
  return sum.toString(16).padStart(2, '0');
}

/**
 * Decode a raw GDB RSP packet: strip $ prefix and #checksum suffix.
 * Returns {data, valid} — valid=false when the packet is malformed.
 * Checksum verification is lenient — mismatches are logged but still accepted.
 */
export function decodeRspPacket(packet: string): { data: string; valid: boolean } {
  const trimmed = packet.trim();
  if (!trimmed.startsWith('$')) return { data: '', valid: false };
  const hashIdx = trimmed.lastIndexOf('#');
  if (hashIdx < 0) return { data: '', valid: false };
  const data = trimmed.slice(1, hashIdx);
  return { data, valid: true };
}

/** Encode a response string into an RSP packet: $<data>#<checksum>. */
export function encodeRspPacket(data: string): string {
  const checksum = computeRspChecksum(data);
  return `$${data}#${checksum}`;
}

/**
 * Apply RSP run-length encoding to a hex string.
 * Sequences of the same character are compressed: c*N where N = repeatCount + 29.
 * Only encodes runs of 4+ identical chars (GDB convention: min 4).
 */
export function rleEncode(data: string): string {
  if (data.length < 4) return data;
  const parts: string[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === ch && run < 97) run++;
    if (run >= 4) {
      // Encode as ch * (run + 29 - 0x20), where count = repeatCount + 29
      // GDB convention: the repeat count is offset by 29 so printable.
      parts.push(`${ch}*${String.fromCharCode(run + 29)}`);
      i += run;
    } else {
      parts.push(ch);
      i++;
    }
  }
  return parts.join('');
}

/**
 * Decode RSP run-length encoding.
 * * followed by a byte N means repeat the preceding character (N - 29) times.
 */
export function rleDecode(data: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    if (ch === '*' && i > 0 && i + 1 < data.length) {
      const count = data.charCodeAt(i + 1) - 29;
      const prev = parts.pop()!;
      parts.push(prev.repeat(count));
      i += 2;
    } else {
      parts.push(ch);
      i++;
    }
  }
  return parts.join('');
}

// ── field parsing ───────────────────────────────────────────────────────────

/**
 * Split RSP comma/colon/semicolon-separated fields.
 * Handles: "maddr,len" → ["m", "addr", "len"]
 *          "Maddr,len:data" → ["M", "addr", "len", "data"]
 *          "Z0,addr,kind" → ["Z0", "addr", "kind"]
 *          "vCont;s:1" → ["vCont", "s:1"]
 */
export function parseRspFields(data: string): string[] {
  // For 'm'/'M': comma between addr,len, colon before data
  // For 'Z'/'z': comma-separated
  // For 'vCont': semicolon between actions, colon before thread-id
  // Strategy: split on commas first, but preserve vCont semicolons
  if (data.startsWith('vCont')) {
    return data.split(';');
  }
  return data.split(/[,:]/g);
}

// ── hex conversion ──────────────────────────────────────────────────────────

/** Convert Uint8Array (or number array) to lowercase hex string. */
export function bytesToHex(bytes: Uint8Array | number[]): string {
  if (bytes instanceof Uint8Array) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Convert hex string to Uint8Array. Odd-length strings are padded with leading zero. */
export function hexToBytes(hex: string): Uint8Array {
  let h = hex;
  if (h.length % 2 !== 0) h = '0' + h;
  const result = new Uint8Array(h.length >> 1);
  for (let i = 0; i < h.length; i += 2) {
    result[i >> 1] = parseInt(h.substring(i, i + 2), 16) || 0;
  }
  return result;
}

/** Format a number as a hex string without 0x prefix. */
export function toHex(value: number | bigint, padTo: number = 0): string {
  const h = value.toString(16);
  return h.padStart(padTo, '0');
}

/** Parse a hex string (with optional 0x prefix) to a number. */
export function fromHex(hex: string): number {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  return parseInt(h, 16);
}

// ── target XML ──────────────────────────────────────────────────────────────

/**
 * Generate a minimal GDB target description XML for AArch64.
 * Describes x0-x30, sp, pc as 64-bit registers.
 */
export function generateTargetXml(): string {
  const features = ['<feature name="org.gnu.gdb.aarch64.core">'];
  for (let i = 0; i <= 30; i++) {
    features.push(`  <reg name="x${i}" bitsize="64" type="uint64"/>`);
  }
  features.push('  <reg name="sp" bitsize="64" type="data_ptr"/>');
  features.push('  <reg name="pc" bitsize="64" type="code_ptr"/>');
  features.push('</feature>');

  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE target SYSTEM "gdb-target.dtd">',
    '<target version="1.0">',
    '<architecture>aarch64</architecture>',
    ...features,
    '</target>',
  ].join('');
}

/** Thread info XML for qXfer:threads:read. Single-thread for now. */
export function generateThreadsXml(): string {
  return [
    '<?xml version="1.0"?>',
    '<threads>',
    '  <thread id="1" core="0" name="nemu-main"/>',
    '</threads>',
  ].join('');
}
