/**
 * Tests for PcDescriptorsParser — ARM64 BL instruction decoding,
 * PcDescriptors binary data parsing, and call-target resolution.
 *
 * Covers:
 *  - decodeArm64BlInstruction: BL / non-BL / BL with negative offset
 *  - resolveCallTarget: address computation
 *  - parsePcDescriptorsData: headerless raw array, 8-byte tagged header,
 *    empty input, truncated/misaligned input
 *  - resolveCallTargets: BL resolved, non-BL skipped, function map lookup,
 *    out-of-bounds PC offset, mixed instructions
 *  - filterCallEntries: call-site kinds vs non-call kinds
 *  - buildFunctionMap: name presence/absence
 */

import { describe, expect, it } from 'vitest';
import {
  decodeArm64BlInstruction,
  resolveCallTarget,
  parsePcDescriptorsData,
  resolveCallTargets,
  filterCallEntries,
  buildFunctionMap,
  type PcDescriptorEntry,
} from '@modules/native-emulator/dart/PcDescriptorsParser';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Encode an ARM64 BL instruction: `0x94000000 | (imm26 & 0x03FFFFFF)`. */
function encodeBl(imm26: number): number {
  return (0x94000000 | (imm26 & 0x03ffffff)) >>> 0;
}

/** Encode a non-BL ARM64 instruction (e.g. ADD x0, x0, #1). */
function encodeNonBl(): number {
  // ADD x0, x0, #1 — opcode = 0x8B (not 0x25)
  return 0x91000400;
}

/** Build raw PcDescriptors binary data from entry records. */
function buildPcDescriptorsRaw(
  entries: Array<{
    pcOffset: number;
    deoptId?: number;
    tokenPos?: number;
    kind?: number;
  }>,
  withTaggedHeader: boolean,
): Uint8Array {
  const intsPerEntry = 5;
  const numElements = entries.length * intsPerEntry;

  let dataSize: number;
  let headerSize: number;
  if (withTaggedHeader) {
    headerSize = 8; // Smi-tagged length in 64-bit AOT
    dataSize = headerSize + numElements * 4;
  } else {
    headerSize = 0;
    dataSize = numElements * 4;
  }

  const buf = new ArrayBuffer(dataSize);
  const view = new DataView(buf);

  if (withTaggedHeader) {
    // Tagged Smi: (numElements * 2) + 1, stored as 64-bit little-endian
    const tagged = BigInt(numElements * 2 + 1);
    view.setBigUint64(0, tagged, true);
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const base = headerSize + i * intsPerEntry * 4;
    view.setUint32(base, e.pcOffset, true);
    view.setInt32(base + 4, e.deoptId ?? 0, true);
    view.setInt32(base + 8, e.tokenPos ?? -1, true);
    // bytes 12-15: packed try_index/yield_index (zeroed)
    view.setUint32(base + 12, 0, true);
    // byte 16: kind (lowest byte of 5th uint32)
    view.setUint32(base + 16, (e.kind ?? 7) & 0xff, true);
  }

  return new Uint8Array(buf);
}

/** Build a simple ARM64 machine code section with BL instructions. */
function buildCodeSection(
  instructions: Array<{ offset: number; insn: number }>,
  totalSize: number,
): Uint8Array {
  const buf = new Uint8Array(totalSize);
  for (const { offset, insn } of instructions) {
    buf[offset] = insn & 0xff;
    buf[offset + 1] = (insn >>> 8) & 0xff;
    buf[offset + 2] = (insn >>> 16) & 0xff;
    buf[offset + 3] = (insn >>> 24) & 0xff;
  }
  return buf;
}

// ── BL Instruction Decoding ──────────────────────────────────────────────

describe('decodeArm64BlInstruction', () => {
  it('decodes a positive-offset BL', () => {
    // BL with offset +5 (5 instructions forward = +20 bytes)
    // imm26 = 5, opcode = 0x94000000 => encoded = 0x94000005
    const insn = encodeBl(5);
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(true);
    expect(offset).toBe(5);
  });

  it('decodes a negative-offset BL (sign-extended)', () => {
    // imm26 = -1 => bits[25:0] = 0x3FFFFFF
    // encoded = 0x97FFFFFF
    const insn = 0x97ffffff;
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(true);
    // -1 in 32-bit signed: 0xFFFFFFFF
    expect(offset).toBe(-1);
  });

  it('returns isBl=false for non-BL instruction', () => {
    const insn = encodeNonBl();
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(false);
    expect(offset).toBe(0);
  });

  it('decodes a large positive offset (imm26=0x1FFFFFF, ~8MB forward)', () => {
    // Max positive: 0x01FFFFFF
    const insn = encodeBl(0x01ffffff);
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(true);
    expect(offset).toBe(0x01ffffff);
  });

  it('decodes a large negative offset (imm26 max negative)', () => {
    // Most negative: -0x2000000 => bits[25:0] = 0x2000000
    // 0x94000000 | 0x2000000 = 0x96000000
    // Put differently: imm26 = -0x2000000 = -33554432
    // In 32-bit: bits 25:0 = 0x2000000, sign extended = 0xFE000000
    const insn = 0x96000000;
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(true);
    expect(offset).toBe(-0x2000000);
  });

  it('correctly handles BL with zero offset', () => {
    const insn = encodeBl(0);
    const { isBl, offset } = decodeArm64BlInstruction(insn);
    expect(isBl).toBe(true);
    expect(offset).toBe(0);
  });
});

// ── Call Target Resolution ───────────────────────────────────────────────

describe('resolveCallTarget', () => {
  it('computes target = PC + imm26 * 4', () => {
    const pc = 0x1000;
    const imm26 = 5; // +20 bytes
    const insn = encodeBl(imm26);
    expect(resolveCallTarget(insn, pc)).toBe(0x1014); // 0x1000 + 20 = 0x1014
  });

  it('computes target with negative offset', () => {
    const pc = 0x2000;
    const insn = 0x97ffffff; // BL -1 => -4 bytes
    expect(resolveCallTarget(insn, pc)).toBe(0x1ffc); // 0x2000 - 4 = 0x1FFC
  });

  it('returns -1 for non-BL instruction', () => {
    const insn = encodeNonBl();
    expect(resolveCallTarget(insn, 0x1000)).toBe(-1);
  });
});

// ── PcDescriptors Binary Data Parsing ────────────────────────────────────

describe('parsePcDescriptorsData', () => {
  it('parses a headerless raw uint32 array (offset 0)', () => {
    const data = buildPcDescriptorsRaw(
      [
        { pcOffset: 0x10, deoptId: 1, tokenPos: 100, kind: 1 },
        { pcOffset: 0x20, deoptId: 2, tokenPos: 200, kind: 2 },
      ],
      false,
    );
    const entries = parsePcDescriptorsData(data);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.pcOffset).toBe(0x10);
    expect(entries[0]!.kind).toBe(1);
    expect(entries[1]!.pcOffset).toBe(0x20);
    expect(entries[1]!.kind).toBe(2);
  });

  it('parses a tagged-header format (8-byte Smi prefix)', () => {
    const data = buildPcDescriptorsRaw(
      [{ pcOffset: 0x08, deoptId: 0, tokenPos: 50, kind: 3 }],
      true,
    );
    const entries = parsePcDescriptorsData(data);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.pcOffset).toBe(0x08);
    expect(entries[0]!.kind).toBe(3);
  });

  it('returns empty array for empty input', () => {
    expect(parsePcDescriptorsData(new Uint8Array(0))).toEqual([]);
  });

  it('returns empty array for too-small input', () => {
    const data = new Uint8Array(10); // less than 5*4 = 20
    expect(parsePcDescriptorsData(data)).toEqual([]);
  });

  it('rejects data with invalid kind values (>7)', () => {
    // Build data with kind=9 at offset 0 (kind field = byte 16)
    const buf = new ArrayBuffer(20); // one entry
    const view = new DataView(buf);
    view.setUint32(0, 0x10, true); // pcOffset
    view.setUint32(16, 9, true); // kind=9 (invalid)
    const data = new Uint8Array(buf);
    expect(parsePcDescriptorsData(data)).toEqual([]);
  });

  it('rejects data with pcOffset > 1MB', () => {
    const entries = [{ pcOffset: 0x200000, kind: 1 }]; // > 0x100000
    const data = buildPcDescriptorsRaw(entries, false);
    expect(parsePcDescriptorsData(data)).toEqual([]);
  });

  it('parses multiple entries correctly', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      pcOffset: i * 4,
      deoptId: i,
      tokenPos: i * 10,
      kind: i % 4,
    }));
    const data = buildPcDescriptorsRaw(entries, true);
    const parsed = parsePcDescriptorsData(data);
    expect(parsed).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(parsed[i]!.pcOffset).toBe(i * 4);
      expect(parsed[i]!.kind).toBe(i % 4);
    }
  });
});

// ── Call Target Resolution from Code Section ─────────────────────────────

describe('resolveCallTargets', () => {
  const entryPoint = 0x10000;
  const functionMap = new Map<number, string>([
    [0x11000, 'helper_1'],
    [0x12000, 'helper_2'],
  ]);

  it('resolves BL call targets from code section', () => {
    // BL from PC=0x10004 (offset +4) to target 0x11000
    // imm26 = (0x11000 - 0x10004) / 4 = 0x0FFC / 4 = 0x03FF
    const targetAddr = 0x11000;
    const pcOffset = 0x04; // within the function
    const pc = entryPoint + pcOffset;
    const imm26 = (targetAddr - pc) / 4;
    expect(imm26 % 1).toBe(0); // must be integral
    const codeSection = buildCodeSection([{ offset: pcOffset, insn: encodeBl(imm26) }], 16);

    const entries: PcDescriptorEntry[] = [{ pcOffset, kind: 1, deoptId: 0, tokenPos: 0 }];

    const targets = resolveCallTargets(entries, codeSection, entryPoint, functionMap);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetAddress).toBe(targetAddr);
    expect(targets[0]!.targetHex).toBe('0x11000');
    expect(targets[0]!.functionName).toBe('helper_1');
    expect(targets[0]!.pcOffset).toBe(pcOffset);
  });

  it('skips non-BL instructions and returns empty', () => {
    const codeSection = buildCodeSection([{ offset: 0x04, insn: encodeNonBl() }], 16);
    const entries: PcDescriptorEntry[] = [{ pcOffset: 0x04, kind: 1, deoptId: 0, tokenPos: 0 }];
    const targets = resolveCallTargets(entries, codeSection, entryPoint, functionMap);
    expect(targets).toHaveLength(0);
  });

  it('leaves functionName undefined when target not in map', () => {
    // BL to 0x13000 which is NOT in functionMap
    const targetAddr = 0x13000;
    const pcOffset = 0x08;
    const pc = entryPoint + pcOffset;
    const imm26 = (targetAddr - pc) / 4;
    const codeSection = buildCodeSection([{ offset: pcOffset, insn: encodeBl(imm26) }], 16);
    const entries: PcDescriptorEntry[] = [{ pcOffset, kind: 2, deoptId: 0, tokenPos: 0 }];
    const targets = resolveCallTargets(entries, codeSection, entryPoint, functionMap);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.targetAddress).toBe(targetAddr);
    expect(targets[0]!.functionName).toBeUndefined();
  });

  it('skips entries with pcOffset out of code section bounds', () => {
    const codeSection = buildCodeSection([], 8); // 8 bytes only
    const entries: PcDescriptorEntry[] = [
      { pcOffset: 16, kind: 1, deoptId: 0, tokenPos: 0 }, // beyond bounds
    ];
    expect(resolveCallTargets(entries, codeSection, entryPoint, functionMap)).toHaveLength(0);
  });

  it('handles mixed call and non-call instructions', () => {
    const codeSection = buildCodeSection(
      [
        { offset: 0x00, insn: encodeNonBl() },
        { offset: 0x04, insn: encodeBl((0x11000 - (entryPoint + 0x04)) / 4) },
        { offset: 0x08, insn: encodeNonBl() },
      ],
      16,
    );
    const entries: PcDescriptorEntry[] = [
      { pcOffset: 0x00, kind: 1, deoptId: 0, tokenPos: 0 },
      { pcOffset: 0x04, kind: 1, deoptId: 0, tokenPos: 0 },
      { pcOffset: 0x08, kind: 1, deoptId: 0, tokenPos: 0 },
    ];
    const targets = resolveCallTargets(entries, codeSection, entryPoint, functionMap);
    // Only offset 0x04 has a BL
    expect(targets).toHaveLength(1);
    expect(targets[0]!.pcOffset).toBe(0x04);
    expect(targets[0]!.functionName).toBe('helper_1');
  });
});

// ── filterCallEntries ────────────────────────────────────────────────────

describe('filterCallEntries', () => {
  it('keeps call-site kinds (1=icCall, 2=unoptStaticCall, 3=runtimeCall)', () => {
    const entries: PcDescriptorEntry[] = [
      { pcOffset: 0, kind: 0, deoptId: 0, tokenPos: 0 }, // deopt
      { pcOffset: 4, kind: 1, deoptId: 0, tokenPos: 0 }, // icCall
      { pcOffset: 8, kind: 2, deoptId: 0, tokenPos: 0 }, // unoptStaticCall
      { pcOffset: 12, kind: 3, deoptId: 0, tokenPos: 0 }, // runtimeCall
      { pcOffset: 16, kind: 4, deoptId: 0, tokenPos: 0 }, // osrEntry
      { pcOffset: 20, kind: 7, deoptId: 0, tokenPos: 0 }, // other
    ];
    const filtered = filterCallEntries(entries);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((e) => e.kind)).toEqual([1, 2, 3]);
  });

  it('returns empty when no call-site kinds present', () => {
    const entries: PcDescriptorEntry[] = [
      { pcOffset: 0, kind: 0, deoptId: 0, tokenPos: 0 },
      { pcOffset: 4, kind: 4, deoptId: 0, tokenPos: 0 },
    ];
    expect(filterCallEntries(entries)).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(filterCallEntries([])).toHaveLength(0);
  });
});

// ── buildFunctionMap ─────────────────────────────────────────────────────

describe('buildFunctionMap', () => {
  it('maps entry points to names when name is present', () => {
    const fns = [
      { entryPoint: 0x1000n, name: 'main' },
      { entryPoint: 0x2000n, name: 'helper' },
    ];
    const map = buildFunctionMap(fns);
    expect(map.get(0x1000)).toBe('main');
    expect(map.get(0x2000)).toBe('helper');
  });

  it('omits functions without a name', () => {
    const fns = [
      { entryPoint: 0x1000n, name: 'main' },
      { entryPoint: 0x2000n, name: undefined },
    ];
    const map = buildFunctionMap(fns);
    expect(map.has(0x1000)).toBe(true);
    expect(map.has(0x2000)).toBe(false);
  });

  it('returns empty map for empty input', () => {
    expect(buildFunctionMap([]).size).toBe(0);
  });
});
