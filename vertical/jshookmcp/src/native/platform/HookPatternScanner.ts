/**
 * HookPatternScanner — pure byte-pattern inline-hook detector (OS-agnostic).
 *
 * Extracted from PEAnalyzer.classifyHook / decodeJumpTarget so the same 8-pattern
 * pe-sieve PatchAnalyzer classification can run on any process-memory byte
 * window, without needing a PE export table. Used by `memory_inline_hook_detect`
 * on Linux/macOS where there is no PEAnalyzer fast path.
 *
 * Recognised patterns (pe-sieve PatchAnalyzer superset):
 *   - `jmp_rel32`   E9 disp32          — direct jump
 *   - `call_rel32`  E8 disp32          — direct call hook
 *   - `short_jmp`   EB disp8           — short jump hook
 *   - `jmp_abs64`   FF 25 ...          — indirect jump via [rip+disp32]
 *   - `mov_jmp`     B8-BF imm32 FF E0-EF — MOV reg,imm32; JMP reg
 *   - `mov_call`    B8-BF imm32 FF D0-DF — MOV reg,imm32; CALL reg
 *   - `push_ret`    68 imm32 C3        — PUSH imm32; RET
 *   - `int3_breakpoint` CC             — debug breakpoint
 *   - `padding`     any run of identical bytes (e.g. NOP sled 0x90)
 */

export type HookType =
  | 'jmp_rel32'
  | 'call_rel32'
  | 'short_jmp'
  | 'jmp_abs64'
  | 'mov_jmp'
  | 'mov_call'
  | 'push_ret'
  | 'int3_breakpoint'
  | 'padding'
  | 'unknown';

/** A single hook-pattern match found by `scanRangeForHooks`. */
export interface HookPatternMatch {
  /** Byte offset within the scanned buffer where the pattern starts. */
  offset: number;
  /** Absolute guest address of the pattern (baseAddr + offset), hex string. */
  address: string;
  /** Classified hook mechanism. */
  hookType: HookType;
  /** Decoded jump/call target address (hex), or '0x0' if not extractable. */
  jumpTarget: string;
  /** The leading bytes that matched (length depends on pattern, max 8). */
  matchedBytes: number[];
}

/** Patterns that strongly indicate an inline hook (rare in clean compiler output). */
const HIGH_CONFIDENCE_TYPES = new Set<HookType>(['jmp_abs64', 'mov_jmp', 'mov_call', 'push_ret']);

/** Little-endian signed 32-bit read from a Uint8Array (no Buffer dependency). */
function readInt32LE(b: Uint8Array, off: number): number {
  const u = (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
  return u > 0x7fffffff ? u - 0x100000000 : u;
}
/** Little-endian unsigned 32-bit read. */
function readUInt32LE(b: Uint8Array, off: number): number {
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}
/** Signed 8-bit read. */
function readInt8(b: Uint8Array, off: number): number {
  return b[off]! > 0x7f ? b[off]! - 0x100 : b[off]!;
}
/** Little-endian unsigned 64-bit read as BigInt. */
function readBigUInt64LE(b: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i]!);
  return v;
}

/**
 * Classify the hook pattern at the start of a byte window.
 *
 * @param bytes - leading bytes of the candidate instruction (≥8 recommended)
 * @returns the classified hook type, or 'unknown' if no pattern matches
 */
export function classifyHookPattern(bytes: Uint8Array): HookType {
  if (bytes.length === 0) return 'unknown';
  const b0 = bytes[0]!;
  // INT3 breakpoint (single or repeated 0xCC).
  if (b0 === 0xcc) return 'int3_breakpoint';
  // Padding: all bytes identical (NOP sled, zero-fill). Excludes 0xCC above.
  if (bytes.length >= 2 && bytes.every((b) => b === b0)) return 'padding';
  if (b0 === 0xe9) return 'jmp_rel32';
  if (b0 === 0xe8) return 'call_rel32';
  if (b0 === 0xeb) return 'short_jmp';
  if (b0 === 0xff && bytes[1] === 0x25) return 'jmp_abs64';
  // MOV r32, imm32 (B8-BF) followed by FF E0-EF (JMP r32) or FF D0-DF (CALL r32).
  // Layout: [B8-BF][imm32 4 bytes][FF][E0-EF | D0-DF] = 7 bytes minimum.
  if (b0 >= 0xb8 && b0 <= 0xbf && bytes.length >= 7) {
    if (bytes[5] === 0xff) {
      const reg = bytes[6]!;
      if (reg >= 0xe0 && reg <= 0xef) return 'mov_jmp';
      if (reg >= 0xd0 && reg <= 0xdf) return 'mov_call';
    }
  }
  if (b0 === 0x68 && bytes[5] === 0xc3) return 'push_ret';
  return 'unknown';
}

/**
 * Decode the jump/call target address for a classified hook.
 *
 * @param bytes - leading bytes of the instruction (same window passed to classify)
 * @param funcAddr - absolute address of the instruction's first byte
 * @returns hex target address, or '0x0' if the pattern has no extractable target
 */
export function decodeHookTarget(bytes: Uint8Array, funcAddr: bigint): string {
  if (bytes.length === 0) return '0x0';
  const b0 = bytes[0]!;
  // JMP rel32 / CALL rel32 — target = funcAddr + 5 + rel32
  if (b0 === 0xe9 || b0 === 0xe8) {
    if (bytes.length < 5) return '0x0';
    const rel32 = readInt32LE(bytes, 1);
    return `0x${(funcAddr + 5n + BigInt(rel32)).toString(16)}`;
  }
  // Short JMP rel8 — target = funcAddr + 2 + rel8
  if (b0 === 0xeb) {
    if (bytes.length < 2) return '0x0';
    const rel8 = readInt8(bytes, 1);
    return `0x${(funcAddr + 2n + BigInt(rel8)).toString(16)}`;
  }
  // JMP [rip+disp32] — two encodings with different target extraction:
  //   * MinHook-style hook (disp32 == 0): the 8-byte absolute address is
  //     embedded directly after the 6-byte instruction (bytes 6-13).
  //   * Compiler output (disp32 != 0): JMP QWORD PTR [rip+disp32] — the target
  //     is the *address of the memory slot* (funcAddr + 6 + disp32), where the
  //     indirect pointer lives. Reading bytes 6-13 as an absolute address would
  //     return garbage (the disp32-relative slot content or neighbouring bytes).
  if (b0 === 0xff && bytes[1] === 0x25) {
    if (bytes.length < 6) return '0x0';
    const disp32 = readInt32LE(bytes, 2);
    if (disp32 === 0) {
      if (bytes.length >= 14) {
        const target = readBigUInt64LE(bytes, 6);
        return `0x${target.toString(16)}`;
      }
      return '0x0';
    }
    return `0x${(funcAddr + 6n + BigInt(disp32)).toString(16)}`;
  }
  // MOV r32, imm32 (B8-BF) — target is the loaded immediate (mov_jmp / mov_call).
  if (b0 >= 0xb8 && b0 <= 0xbf) {
    if (bytes.length < 5) return '0x0';
    const imm32 = readUInt32LE(bytes, 1);
    return `0x${imm32.toString(16)}`;
  }
  // PUSH imm32; RET — target is the pushed immediate.
  if (b0 === 0x68 && bytes[5] === 0xc3) {
    if (bytes.length < 5) return '0x0';
    const imm32 = readUInt32LE(bytes, 1);
    return `0x${imm32.toString(16)}`;
  }
  return '0x0';
}

/**
 * Scan a byte buffer for inline-hook patterns. Walks every byte offset and
 * classifies the window starting there. By default only high-confidence
 * patterns (FF25 / mov_jmp / mov_call / push_ret) are reported — the common
 * jmp_rel32/call_rel32/short_jmp instructions appear in legitimate compiler
 * output and would flood results without disk-vs-memory comparison. Pass
 * `confidence: 'all'` to include them, and `skipPadding: false` to include
 * INT3/padding runs.
 *
 * @param bytes       - the memory window to scan
 * @param baseAddr    - absolute guest address of `bytes[0]`
 * @param options     - scan tuning (defaults: high-confidence only, skip padding)
 */
export function scanRangeForHooks(
  bytes: Uint8Array,
  baseAddr: bigint,
  options: { confidence?: 'high' | 'all'; skipPadding?: boolean } = {},
): HookPatternMatch[] {
  const confidence = options.confidence ?? 'high';
  const skipPadding = options.skipPadding ?? true;
  const out: HookPatternMatch[] = [];

  for (let i = 0; i + 1 < bytes.length; i++) {
    const window = bytes.subarray(i, i + 16);
    const hookType = classifyHookPattern(window);
    if (hookType === 'unknown') continue;
    const isPadding = hookType === 'int3_breakpoint' || hookType === 'padding';
    // skipPadding controls INT3/padding; confidence controls the jmp/call family.
    if (skipPadding && isPadding) continue;
    if (!isPadding && confidence === 'high' && !HIGH_CONFIDENCE_TYPES.has(hookType)) continue;

    const addr = baseAddr + BigInt(i);
    out.push({
      offset: i,
      address: `0x${addr.toString(16)}`,
      hookType,
      jumpTarget: decodeHookTarget(window, addr),
      matchedBytes: Array.from(window.subarray(0, patternLength(hookType))),
    });
  }
  return out;
}

/** Byte length consumed by each pattern's leading signature (for matchedBytes). */
function patternLength(t: HookType): number {
  switch (t) {
    case 'jmp_rel32':
    case 'call_rel32':
      return 5;
    case 'short_jmp':
      return 2;
    case 'jmp_abs64':
      return 6;
    case 'mov_jmp':
    case 'mov_call':
      return 8;
    case 'push_ret':
      return 6;
    case 'int3_breakpoint':
      return 1;
    case 'padding':
      return 2;
    default:
      return 1;
  }
}
