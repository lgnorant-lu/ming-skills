/**
 * AOB Signature Generator
 *
 * Generates update-resistant Array-of-Bytes signatures from memory regions.
 * Detects relative offsets in x64 instructions (CALL/JMP/LEA/Jcc) and replaces
 * the displacement bytes with wildcards, making the signature survive minor
 * code changes between game/app updates.
 *
 * Uses simple byte-pattern heuristics — no native Capstone dependency required.
 * The heuristics cover the most common relative-offset patterns found in
 * compiled x64 code.
 *
 * @module SignatureGenerator
 */

// ── Types ──

export interface SignatureResult {
  /** The generated AOB pattern string (e.g. "48 8B ?? ?? ?? ?? 00 00") */
  pattern: string;
  /** Original hex bytes for verification */
  originalBytes: string;
  /** List of offsets that were wildcarded, with reason */
  wildcarded: Array<{ offset: number; reason: string }>;
  /** Total bytes in the signature */
  size: number;
  /** Number of wildcarded bytes */
  wildcardCount: number;
}

// ── Displacement detection ──

interface WildcardInfo {
  /** Offset from pattern start where the displacement starts */
  offset: number;
  /** Number of bytes to wildcard */
  length: number;
  /** Human-readable reason */
  reason: string;
}

/**
 * Detect relative-offset instruction patterns in x64 bytecode and return the
 * byte ranges that should be wildcarded (displacement fields).
 *
 * This is a byte-pattern heuristic that covers the most common cases:
 * - CALL rel32 (E8 xx xx xx xx)
 * - JMP rel32 (E9 xx xx xx xx)
 * - Jcc rel32 (0F 8x xx xx xx xx)
 * - LEA REG, [RIP+disp32] (REX.W 8D 0D/05/15/1D/25/2D/35/3D xx xx xx xx)
 */
export function detectRelativeDisplacements(bytes: Buffer): WildcardInfo[] {
  const wildcards: WildcardInfo[] = [];
  let i = 0;

  while (i < bytes.length) {
    const remaining = bytes.length - i;

    // CALL rel32: E8 xx xx xx xx
    if (remaining >= 5 && bytes[i] === 0xe8) {
      wildcards.push({ offset: i + 1, length: 4, reason: 'CALL rel32 displacement' });
      i += 5;
      continue;
    }

    // JMP rel32: E9 xx xx xx xx
    if (remaining >= 5 && bytes[i] === 0xe9) {
      wildcards.push({ offset: i + 1, length: 4, reason: 'JMP rel32 displacement' });
      i += 5;
      continue;
    }

    // LOOP rel8: E2 xx
    if (remaining >= 2 && bytes[i] === 0xe2) {
      wildcards.push({ offset: i + 1, length: 1, reason: 'LOOP rel8 displacement' });
      i += 2;
      continue;
    }

    // Jcc rel32: 0F 8x xx xx xx xx (0F 80-8F)
    if (remaining >= 6 && bytes[i] === 0x0f && (bytes[i + 1]! & 0xf0) === 0x80) {
      wildcards.push({
        offset: i + 2,
        length: 4,
        reason: `Jcc rel32 displacement (0F ${bytes[i + 1]!.toString(16).padStart(2, '0')})`,
      });
      i += 6;
      continue;
    }

    // REX.W prefix + LEA with [RIP+disp32]: 48 8D 0D/05/15/1D/25/2D/35/3D xx xx xx xx
    // 4C 8D variants (REX.WR) also exist but less common
    const isRexLea =
      remaining >= 7 && (bytes[i] === 0x48 || bytes[i] === 0x4c) && bytes[i + 1] === 0x8d;

    if (isRexLea) {
      const modrm = bytes[i + 2]!;
      // Mod=00, R/M=101 (RIP-relative): modrm & 0xc7 === 0x05
      if ((modrm & 0xc7) === 0x05) {
        wildcards.push({
          offset: i + 3,
          length: 4,
          reason: `LEA [RIP+disp32] displacement (REX ${bytes[i]!.toString(16).padStart(2, '0')})`,
        });
        i += 7;
        continue;
      }
    }

    // MOV REG, [RIP+disp32]: REX.W 8B 0D/05/15/1D/25/2D/35/3D xx xx xx xx
    if (
      remaining >= 7 &&
      (bytes[i] === 0x48 || bytes[i] === 0x4c) &&
      (bytes[i + 1] === 0x8b || bytes[i + 1] === 0x8a)
    ) {
      const modrm = bytes[i + 2]!;
      if ((modrm & 0xc7) === 0x05) {
        wildcards.push({
          offset: i + 3,
          length: 4,
          reason: `MOV [RIP+disp32] displacement (REX ${bytes[i]!.toString(16).padStart(2, '0')})`,
        });
        i += 7;
        continue;
      }
    }

    // CMP with [RIP+disp32]: REX.W 3B/39 0D/05/...  xx xx xx xx
    if (
      remaining >= 7 &&
      (bytes[i] === 0x48 || bytes[i] === 0x4c) &&
      (bytes[i + 1] === 0x3b || bytes[i + 1] === 0x39)
    ) {
      const modrm = bytes[i + 2]!;
      if ((modrm & 0xc7) === 0x05) {
        wildcards.push({
          offset: i + 3,
          length: 4,
          reason: `CMP [RIP+disp32] displacement (REX ${bytes[i]!.toString(16).padStart(2, '0')})`,
        });
        i += 7;
        continue;
      }
    }

    // Advance by 1 byte (unknown instruction)
    i++;
  }

  return wildcards;
}

// ── Signature Generation ──

/**
 * Generate an AOB signature from raw bytes.
 *
 * Detects relative-offset instruction patterns and replaces displacement
 * bytes with wildcards ("??").
 */
export function generateSignature(
  bytes: Buffer,
  options?: { wildcardRelOffsets?: number },
): SignatureResult {
  const wildcardLen = options?.wildcardRelOffsets ?? 4;
  const wildcards = detectRelativeDisplacements(bytes);

  // Build pattern: byte-by-byte, replacing displaced ranges with wildcards
  const patternParts: string[] = [];
  let wildcardCount = 0;
  const wildcardedOffsets: Array<{ offset: number; reason: string }> = [];

  // Build a set of byte indices that should be wildcards
  const wildcardSet = new Set<number>();
  for (const w of wildcards) {
    const actualLen = Math.min(w.length, wildcardLen);
    for (let j = 0; j < actualLen; j++) {
      wildcardSet.add(w.offset + j);
    }
    wildcardedOffsets.push({ offset: w.offset, reason: w.reason });
  }

  for (let i = 0; i < bytes.length; i++) {
    if (wildcardSet.has(i)) {
      patternParts.push('??');
      wildcardCount++;
    } else {
      patternParts.push(bytes[i]!.toString(16).padStart(2, '0').toUpperCase());
    }
  }

  return {
    pattern: patternParts.join(' '),
    originalBytes: Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' '),
    wildcarded: wildcardedOffsets,
    size: bytes.length,
    wildcardCount,
  };
}
