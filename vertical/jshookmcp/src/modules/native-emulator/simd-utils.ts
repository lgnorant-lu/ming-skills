/**
 * simd-utils — Pure utility functions for SIMD load/store addressing and data
 * transfer, extracted from simd.ts for better modularity.
 *
 * All functions here are stateless and have no SIMD execution context dependency
 * — they operate on numbers/bigints/buffers and can be unit-tested independently.
 */

/**
 * Narrow interface to the V register file, memory, and GPRs — just the slice
 * SIMD load/store and transfer helpers need. Re-declared here to avoid circular
 * dependency (CpuEngine → simd.ts → simd-utils.ts).
 */
export interface SimdContext {
  /** Read all 16 bytes of V[index] (0..31) as a Uint8Array. */
  vGetBytes(index: number): Uint8Array;
  /** Write all 16 bytes of V[index] (0..31) from a Uint8Array. */
  vSetBytes(index: number, value: Uint8Array): void;
  /** Read `len` bytes from guest memory at `addr`. */
  memRead(addr: number, len: number): Uint8Array;
  /** Write `data` to guest memory at `addr`. */
  memWrite(addr: number, data: Uint8Array): void;
  /** Read GPR xN (0..30); index 31 is XZR (returns 0n). */
  gprRead(index: number): bigint;
  /** Write GPR xN (0..30); index 31 is discarded (XZR). */
  gprWrite(index: number, value: bigint): void;
  /** Read GPR with SP semantics for index 31 (used for base addressing). */
  gprReadSp(index: number): bigint;
}

// ══════════════════════════════════════════════════════════════════════════════
//  Shared NEON lane helpers — single source of truth for readLanes, packLanes,
//  and readLaneSigned.  Previously copy-pasted across simd-neon.ts,
//  simd-neon-widening.ts, and simd-neon-saturating.ts.
// ══════════════════════════════════════════════════════════════════════════════

/** Number of bytes per lane for an element-size field (0=1,1=2,2=4,3=8). */
export const laneBytes = (size: number): number => 1 << size;

/** Read a V register as an array of unsigned BigInt lanes at the given size/width. */
export function readLanes(v: Uint8Array, size: number, q: number): bigint[] {
  const bytes = laneBytes(size);
  const active = q === 1 ? 16 : 8;
  const count = active / bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * bytes;
    switch (bytes) {
      case 1:
        out.push(BigInt(dv.getUint8(off)));
        break;
      case 2:
        out.push(BigInt(dv.getUint16(off, true)));
        break;
      case 4:
        out.push(BigInt(dv.getUint32(off, true)));
        break;
      default:
        out.push(dv.getBigUint64(off, true));
        break;
    }
  }
  return out;
}

/** Pack unsigned BigInt lanes back into a fresh 16-byte V register. */
export function packLanes(lanes: bigint[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = laneBytes(size);
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < lanes.length; i++) {
    const off = i * bytes;
    if (off + bytes > 16) break;
    const v = lanes[i] ?? 0n;
    switch (bytes) {
      case 1:
        dv.setUint8(off, Number(v & 0xffn));
        break;
      case 2:
        dv.setUint16(off, Number(v & 0xffffn), true);
        break;
      case 4:
        dv.setUint32(off, Number(v & 0xffff_ffffn), true);
        break;
      default:
        dv.setBigUint64(off, v & 0xffff_ffff_ffff_ffffn, true);
        break;
    }
  }
  return out;
}

/**
 * Read a single lane from a V register at the given size, sign-extended.
 */
export function readLaneSigned(v: Uint8Array, index: number, size: number): bigint {
  const bytes = laneBytes(size);
  const offset = index * bytes;
  const dv = new DataView(v.buffer, v.byteOffset, 16);

  switch (bytes) {
    case 1:
      return BigInt(dv.getInt8(offset));
    case 2:
      return BigInt(dv.getInt16(offset, true));
    case 4:
      return BigInt(dv.getInt32(offset, true));
    default:
      return dv.getBigInt64(offset, true);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Sign-extension helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Sign-extend a 9-bit immediate (load/store unscaled/pre/post-index offset). */
export const signExtend9 = (v: number): number => (v & 0x100 ? v - 0x200 : v);

/** Sign-extend a 7-bit immediate (LDP/STP pair offset, scaled by element size). */
export const signExtend7 = (v: number): number => (v & 0x40 ? v - 0x80 : v);

/** Sign-extend a 19-bit immediate (LDR literal PC-relative offset, scaled by 4). */
export const signExtend19 = (v: number): number => (v & 0x40000 ? v - 0x80000 : v);

/**
 * Apply a register-offset extend (UXTW/LSL/SXTW/SXTX) with optional left shift.
 * Used by SIMD load/store register-offset addressing modes.
 *
 * @param value - The raw 64-bit register value
 * @param option - The extend type (bits[15:13] of the instruction)
 * @param shift - The shift amount (0 or log2(element-size))
 * @returns The extended and shifted offset
 */
export function extendOffset(value: bigint, option: number, shift: number): bigint {
  let v: bigint;
  switch (option) {
    case 0b010: // UXTW
      v = value & 0xffff_ffffn;
      break;
    case 0b110: // SXTW
      v = BigInt.asIntN(32, value & 0xffff_ffffn);
      break;
    case 0b111: // SXTX
      v = BigInt.asIntN(64, value);
      break;
    default: // 011 = LSL (UXTX)
      v = value;
      break;
  }
  return v << BigInt(shift);
}

/**
 * Move `bytes` bytes between V[reg] (low end) and a guest memory address.
 * Scalar/vector loads zero the unused high bytes of the destination register.
 *
 * @param ctx - The SIMD execution context
 * @param isLoad - true for load (memory→register), false for store (register→memory)
 * @param reg - The V register index (0..31)
 * @param addr - The guest memory address
 * @param bytes - The transfer size (1/2/4/8/16 bytes for B/H/S/D/Q)
 */
export function transfer(
  ctx: SimdContext,
  isLoad: boolean,
  reg: number,
  addr: number,
  bytes: number,
): void {
  if (isLoad) {
    const data = ctx.memRead(addr, bytes);
    const full = new Uint8Array(16);
    full.set(data.subarray(0, bytes));
    ctx.vSetBytes(reg, full); // a scalar/vector load zeroes the unused high bytes
  } else {
    ctx.memWrite(addr, ctx.vGetBytes(reg).subarray(0, bytes));
  }
}

/**
 * Transfer interleaved struct-of-arrays for NEON LD1/ST1/LD2/ST2/LD3/ST3/LD4/ST4.
 * Memory layout: lane0-member0, lane0-member1, ..., lane1-member0, lane1-member1, ...
 *
 * @param ctx - The SIMD execution context
 * @param options.isLoad - true for load, false for store
 * @param options.base - The guest memory address
 * @param options.rt - The first V register index
 * @param options.structCount - Number of registers (1/2/3/4 for LD1/LD2/LD3/LD4)
 * @param options.regBytes - Bytes per register (8 for .8B, 16 for .16B)
 * @param options.elementBytes - Bytes per lane element (1/2/4/8 for B/H/S/D)
 */
export function transferInterleavedStructs(
  ctx: SimdContext,
  options: {
    isLoad: boolean;
    base: number;
    rt: number;
    structCount: number;
    regBytes: number;
    elementBytes: number;
  },
): void {
  const { isLoad, base, rt, structCount, regBytes, elementBytes } = options;
  const lanes = regBytes / elementBytes;
  if (!Number.isInteger(lanes) || lanes <= 0) return;

  if (isLoad) {
    const data = ctx.memRead(base, structCount * regBytes);
    const regs = Array.from({ length: structCount }, () => new Uint8Array(16));
    for (let lane = 0; lane < lanes; lane++) {
      for (let member = 0; member < structCount; member++) {
        const src = (lane * structCount + member) * elementBytes;
        const dst = lane * elementBytes;
        regs[member]!.set(data.subarray(src, src + elementBytes), dst);
      }
    }
    for (let member = 0; member < structCount; member++) {
      ctx.vSetBytes((rt + member) % 32, regs[member]!);
    }
    return;
  }

  const out = new Uint8Array(structCount * regBytes);
  const regs = Array.from({ length: structCount }, (_, member) =>
    ctx.vGetBytes((rt + member) % 32),
  );
  for (let lane = 0; lane < lanes; lane++) {
    for (let member = 0; member < structCount; member++) {
      const src = lane * elementBytes;
      const dst = (lane * structCount + member) * elementBytes;
      out.set(regs[member]!.subarray(src, src + elementBytes), dst);
    }
  }
  ctx.memWrite(base, out);
}
