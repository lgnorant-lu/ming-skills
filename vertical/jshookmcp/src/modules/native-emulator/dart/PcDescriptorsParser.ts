/**
 * PcDescriptorsParser — Parse Dart AOT PcDescriptors binary data and resolve
 * call targets via ARM64 BL instruction decoding.
 *
 * In a Dart AOT snapshot each Code object references a PcDescriptors typed-data
 * blob that records PC offsets for deopt points, call sites, try-blocks, and
 * other runtime events.  This module:
 *
 *  1. Parses the raw PcDescriptors {@link ClusterObject}.data into structured
 *     entries (pc_offset, kind, deopt_id, token_pos).
 *  2. Decodes ARM64 BL instructions (opcode `0x94000000` with 26-bit signed
 *     immediate) at each call-site PC offset.
 *  3. Resolves the BL target address and cross-references it against a
 *     user-supplied function entry-point → name map.
 *
 * ARM64 BL encoding:
 *  - bits[31:26] = 0b100101 (0x25)
 *  - bits[25:0]  = imm26 (signed 26-bit offset in instruction words)
 *  - target       = PC + signExtend(imm26, 26) * 4
 */

/** A single PcDescriptors entry parsed from the raw uint32 array. */
export interface PcDescriptorEntry {
  /** Byte offset from the function's code start. */
  pcOffset: number;
  /** Descriptor kind (0=deopt, 1=icCall, 2=unoptStaticCall, 3=runtimeCall, …). */
  kind: number;
  /** Deoptimization ID (Dart VM internal). */
  deoptId: number;
  /** Source token position (Dart VM internal). */
  tokenPos: number;
}

/** A resolved call target with provenance. */
export interface CallTarget {
  /** PC offset within the function (relative to entry point). */
  pcOffset: number;
  /** The absolute target address computed from the BL instruction. */
  targetAddress: number;
  /** Hex string of targetAddress (for display). */
  targetHex: string;
  /** Resolved function name, if found in the function map. */
  functionName?: string;
  /** The raw BL instruction word at the call site (for debugging). */
  instruction: number;
  /** Descriptor kind from PcDescriptors. */
  kind: number;
}

/**
 * Decode an ARM64 instruction word as a BL (Branch with Link).
 *
 * BL encodes a PC-relative signed 26-bit offset in instruction words (4 bytes).
 * The actual byte offset is `signExtend(imm26, 26) * 4`.
 *
 * Opcode mask: bits[31:26] must equal 0b100101 (0x25).
 */
export function decodeArm64BlInstruction(insn: number): { isBl: boolean; offset: number } {
  // ARM64 BL: bits[31:26] = 0b100101
  const opcode = (insn >>> 26) & 0x3f;
  if (opcode !== 0x25) return { isBl: false, offset: 0 };

  // Extract bits 25:0 as a signed 26-bit value.
  // Sign extension from bit 25 using JS 32-bit signed semantics.
  let imm26 = insn & 0x03ffffff;
  // If bit 25 is set, sign-extend to 32 bits.
  if (imm26 & 0x02000000) imm26 |= 0xfc000000; // sets bits 31:26

  return { isBl: true, offset: imm26 };
}

/**
 * Compute the absolute target address for an ARM64 BL instruction.
 *
 * `pc` is the absolute address of the BL instruction itself (NOT the
 * instruction word).  The BL offset is in instruction words (4 bytes), so:
 *
 *   target = pc + signExtend(imm26, 26) * 4
 */
export function resolveCallTarget(insn: number, pc: number): number {
  const { isBl, offset } = decodeArm64BlInstruction(insn);
  if (!isBl) return -1;
  // offset is in instruction words → multiply by 4 for byte address.
  return pc + offset * 4;
}

// ── PcDescriptors binary parser ───────────────────────────────────────────

/**
 * How many uint32 values make up one PcDescriptor entry.
 *
 * Dart 2.x AOT uses 5 uint32 per entry:
 *   [0] pc_offset   [1] deopt_id   [2] token_pos
 *   [3] try_index:u16 | yield_index:u16
 *   [4] kind:u8 | flags:u8 | reserved:u16
 */
const INTS_PER_ENTRY = 5;

/** Call-related descriptor kinds (from runtime/vm/pc_descriptors.h). */
const CALL_KINDS = new Set([1 /* kIcCall */, 2 /* kUnoptStaticCall */, 3 /* kRuntimeCall */]);

/**
 * Parse raw PcDescriptors {@link ClusterObject}.data into a list of
 * {@link PcDescriptorEntry}.
 *
 * The data layout (Dart AOT 64-bit snapshot):
 *   [0x00..0x07] Smi-tagged length = (num_uint32_elements * 2) + 1
 *   [0x08+     ] Inline uint32 values (INTS_PER_ENTRY per descriptor)
 *
 * Falls back to offset 0 (raw array w/o tagged header) when the tagged
 * length at offset 0 produces garbage values.
 */
export function parsePcDescriptorsData(data: Uint8Array): PcDescriptorEntry[] {
  // Try each plausible header offset.  Most Dart AOT snapshots use the
  // 8-byte Smi-tagged length prefix; some stripped or cluster-internal
  // views start directly at the uint32 array.
  // Pick the offset that yields the most valid entries (best-fit heuristic).
  let best: PcDescriptorEntry[] = [];
  for (const headerSize of [8, 0]) {
    const entries = tryParse(data, headerSize);
    if (entries && entries.length > best.length) {
      best = entries;
    }
  }
  return best;
}

function tryParse(data: Uint8Array, headerSize: number): PcDescriptorEntry[] | null {
  const payloadSize = data.length - headerSize;
  const entryBytes = INTS_PER_ENTRY * 4;
  if (payloadSize < entryBytes) return null;

  const numEntries = Math.floor(payloadSize / entryBytes);
  const view = new DataView(data.buffer, data.byteOffset + headerSize, payloadSize);

  const entries: PcDescriptorEntry[] = [];
  let prevPcOffset = -1;
  for (let i = 0; i < numEntries; i++) {
    const base = i * entryBytes;
    const pcOffset = view.getUint32(base, true);
    const deoptId = view.getInt32(base + 4, true);
    const tokenPos = view.getInt32(base + 8, true);
    const kind = view.getUint8(base + 16); // byte 0 of the 5th uint32

    // Validation: kind must be 0-7, pcOffset must be non-negative,
    // within a reasonable range, and monotonically non-decreasing
    // (real PcDescriptors entries appear in ascending PC order).
    if (kind > 7) return null;
    if (pcOffset > 0x100000) return null;
    if (i > 0 && pcOffset < prevPcOffset) return null;

    prevPcOffset = pcOffset;
    entries.push({ pcOffset, kind, deoptId, tokenPos });
  }

  return entries;
}

// ── Call-target resolution ────────────────────────────────────────────────

/**
 * Read a 32-bit little-endian word from `bytes` at `offset`.
 */
function readUint32LE(bytes: Uint8Array, offset: number): number {
  // Reconstruct a uint32 from 4 little-endian bytes, using >>>0 to coerce to unsigned.
  const lo = bytes[offset]! | (bytes[offset + 1]! << 8);
  const hi = bytes[offset + 2]! | (bytes[offset + 3]! << 8);
  return ((hi << 16) | lo) >>> 0;
}

/**
 * Resolve call targets from PcDescriptors entries by reading and decoding
 * the ARM64 BL instruction at each call-site PC offset in `codeSection`.
 *
 * @param entries    Parsed PcDescriptor entries (filter for call kinds
 *                   externally via `callKindsOnly`).
 * @param codeSection ARM64 machine code bytes for this function.
 * @param entryPoint Absolute address of this function's entry point
 *                   (used as the base for computing absolute target addresses).
 * @param functionMap Map of absolute addresses → function names for target
 *                    resolution.
 */
export function resolveCallTargets(
  entries: readonly PcDescriptorEntry[],
  codeSection: Uint8Array,
  entryPoint: number,
  functionMap: Map<number, string>,
): CallTarget[] {
  const results: CallTarget[] = [];

  for (const entry of entries) {
    const { pcOffset } = entry;
    if (pcOffset < 0 || pcOffset + 4 > codeSection.length) continue;

    const insn = readUint32LE(codeSection, pcOffset);
    const pc = entryPoint + pcOffset;
    const targetAddress = resolveCallTarget(insn, pc);
    if (targetAddress < 0) continue; // not a BL instruction

    const targetHex = `0x${targetAddress.toString(16)}`;
    const functionName = functionMap.get(targetAddress);

    results.push({
      pcOffset,
      targetAddress,
      targetHex,
      functionName,
      instruction: insn,
      kind: entry.kind,
    });
  }

  return results;
}

/**
 * Filter entries to only call-relevant kinds (kIcCall, kUnoptStaticCall,
 * kRuntimeCall).
 */
export function filterCallEntries(entries: readonly PcDescriptorEntry[]): PcDescriptorEntry[] {
  return entries.filter((e) => CALL_KINDS.has(e.kind));
}

/**
 * Build a function map from a list of {entryPoint, name} objects.
 */
export function buildFunctionMap(
  functions: readonly { entryPoint: bigint; name?: string }[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const fn of functions) {
    if (fn.name) {
      map.set(Number(fn.entryPoint), fn.name);
    }
  }
  return map;
}
