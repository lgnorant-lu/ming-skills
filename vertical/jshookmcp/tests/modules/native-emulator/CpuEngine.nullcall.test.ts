/**
 * TDD — NULL indirect-call detection (the RETURN_SENTINEL=0 caveat).
 *
 * callSymbol/runInitializers place the sentinel value 0 in LR so the run loop
 * halts when a function returns (PC reaches 0). A genuine return reaches the
 * sentinel via RET, which reads LR. But an indirect branch/call (BR/BLR) to a
 * register that holds 0 — i.e. a call through an *uninitialised* function
 * pointer — ALSO sets PC=0 and silently halts, masquerading as a clean return.
 * On real hardware that is a SIGSEGV (jump to address 0).
 *
 * As of the auto-NOP feature (tolerate constructor faults), BR/BLR to 0 in the
 * main run loop is caught, the instruction is patched to RET in-place, and for
 * BLR, x0 is set to 0 before the RET executes. The patched address is recorded
 * in `nullCallPatches` for diagnostics. Constructor NULL-calls are still
 * tolerated (recorded in `constructorFaultLog`).
 *
 * Encodings (verified against the decoder masks in CpuEngine.execBranchSystem):
 *   br  x8  = 0xd61f0100   (0xd61f0000 | (8<<5))
 *   blr x8  = 0xd63f0100   (0xd63f0000 | (8<<5))
 *   ret     = 0xd65f03c0   (default Rn = x30)
 */
import { describe, expect, it } from 'vitest';

import { CpuEngine } from '@modules/native-emulator/CpuEngine';

/** Little-endian split of a 32-bit instruction word into 4 code bytes. */
function le32(word: number): number[] {
  return [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
}

describe('CpuEngine — NULL indirect-call detection', () => {
  it('BLR to 0 is auto-patched to RET and returns cleanly', () => {
    const engine = new CpuEngine();
    engine.mapMemory(0x1000, 8);
    // blr x8, with x8 = 0 → auto-NOP'd to RET, x0 ← 0
    engine.writeRegister('x8', 0);
    engine.writeRegister('x30', 0); // sentinel LR
    engine.writeCode(0x1000, Uint8Array.from(le32(0xd63f0100)));
    expect(() => engine.start(0x1000, 0)).not.toThrow();
    expect(engine.nullCallPatches).toContain('0x1000');
  });

  it('BR to 0 is auto-patched to RET and returns cleanly', () => {
    const engine = new CpuEngine();
    engine.mapMemory(0x1000, 8);
    engine.writeRegister('x8', 0);
    engine.writeRegister('x30', 0); // sentinel LR
    engine.writeCode(0x1000, Uint8Array.from(le32(0xd61f0100)));
    expect(() => engine.start(0x1000, 0)).not.toThrow();
    expect(engine.nullCallPatches).toContain('0x1000');
  });

  it('the auto-patched address is recorded in nullCallPatches for diagnosis', () => {
    const engine = new CpuEngine();
    engine.mapMemory(0x1000, 8);
    engine.writeRegister('x8', 0);
    engine.writeRegister('x30', 0);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xd63f0100)));
    engine.start(0x1000, 0);
    expect(engine.nullCallPatches.length).toBeGreaterThanOrEqual(1);
    expect(engine.nullCallPatches[0]).toMatch(/0x1000/);
  });

  it('BLR to a legitimate (non-zero) address still calls normally', () => {
    const engine = new CpuEngine();
    // 0x1000: blr x8   (x8 → 0x2000)
    // 0x2000: ret       (LR was set by BLR to 0x1004; but we halt at 0x1004)
    engine.mapMemory(0x1000, 16);
    engine.mapMemory(0x2000, 16);
    engine.writeRegister('x8', 0x2000);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xd63f0100))); // blr x8
    engine.writeCode(0x2000, Uint8Array.from(le32(0xd65f03c0))); // ret
    // Halt when control returns to the instruction after BLR (LR = 0x1004).
    engine.start(0x1000, 0x1004);
    expect(engine.readRegister('x30')).toBe(0x1004); // BLR linked correctly
  });

  it('RET to the sentinel 0 still halts as a normal return (not flagged)', () => {
    const engine = new CpuEngine();
    // A bare function that immediately returns. callSymbol sets LR=0, so RET
    // reaches the sentinel and halts — this is the legitimate path and must NOT
    // be mistaken for a NULL call.
    engine.mapMemory(0x3000, 16);
    engine.writeCode(0x3000, Uint8Array.from(le32(0xd65f03c0))); // ret
    engine.writeRegister('x30', 0); // sentinel LR
    expect(() => engine.start(0x3000, 0)).not.toThrow();
  });

  it('callSymbol on a trivial RET function returns without throwing', () => {
    const engine = new CpuEngine();
    // Build a minimal mapped function: mov x0,#7 ; ret, then call it directly.
    // 0x4000: movz x0,#7   = 0xd28000e0
    // 0x4004: ret          = 0xd65f03c0
    engine.mapMemory(0x4000, 16);
    engine.writeCode(0x4000, Uint8Array.from([...le32(0xd28000e0), ...le32(0xd65f03c0)]));
    engine.writeRegister('x30', 0); // sentinel
    engine.start(0x4000, 0);
    expect(engine.readRegister('x0')).toBe(7);
  });

  it('BLR to 0 no longer throws NullIndirectCallError (auto-NOP handles it)', () => {
    const engine = new CpuEngine();
    engine.mapMemory(0x1000, 8);
    engine.writeRegister('x8', 0);
    engine.writeRegister('x30', 0);
    engine.writeCode(0x1000, Uint8Array.from(le32(0xd63f0100)));
    // Auto-NOP patches the BLR to RET and continues — no throw.
    expect(() => engine.start(0x1000, 0)).not.toThrow();
    // But the nullCallPatches list records the address.
    expect(engine.nullCallPatches.length).toBe(1);
  });
});

/**
 * Constructor tolerance: a NULL indirect call inside an .init_array constructor
 * must NOT abort loadElf (it reflects emulator fidelity, not a load failure),
 * but it must be recorded in the fault log. Contrast with the user-driven
 * callSymbol path above, which propagates the throw.
 */
const EM_AARCH64 = 183;
const PT_LOAD = 1;
const PT_DYNAMIC = 2;
const ET_DYN = 3;
const DT_NULL = 0;
const DT_RELA = 7;
const DT_RELASZ = 8;
const DT_RELAENT = 9;
const DT_INIT_ARRAY = 25;
const DT_INIT_ARRAYSZ = 27;
const R_AARCH64_RELATIVE = 1027;

/** Build a minimal AArch64 .so whose single init_array constructor is `ctorCode`. */
function buildSoWithCtor(ctorCode: number[]): Uint8Array {
  const segVaddr = 0x10000;
  const ctorVaddr = 0x10000;
  const initArrayVaddr = 0x10800;
  const dynVaddr = 0x10808;
  const relaVaddr = 0x10900;
  const segSize = 0x1000;
  const EHDR = 64;
  const PHDR = 56;
  const phnum = 2;
  const segOffset = EHDR + PHDR * phnum;
  const buf = new ArrayBuffer(segOffset + segSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const toOff = (v: number): number => segOffset + (v - segVaddr);

  u8.set([0x7f, 0x45, 0x4c, 0x46], 0);
  dv.setUint8(4, 2);
  dv.setUint8(5, 1);
  dv.setUint8(6, 1);
  dv.setUint16(0x10, ET_DYN, true);
  dv.setUint16(0x12, EM_AARCH64, true);
  dv.setUint32(0x14, 1, true);
  dv.setBigUint64(0x18, BigInt(ctorVaddr), true);
  dv.setBigUint64(0x20, BigInt(EHDR), true);
  dv.setUint16(0x34, EHDR, true);
  dv.setUint16(0x36, PHDR, true);
  dv.setUint16(0x38, phnum, true);

  let p = EHDR;
  dv.setUint32(p + 0x00, PT_LOAD, true);
  dv.setUint32(p + 0x04, 0b111, true);
  dv.setBigUint64(p + 0x08, BigInt(segOffset), true);
  dv.setBigUint64(p + 0x10, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(segVaddr), true);
  dv.setBigUint64(p + 0x20, BigInt(segSize), true);
  dv.setBigUint64(p + 0x28, BigInt(segSize), true);
  dv.setBigUint64(p + 0x30, 0x10000n, true);

  p = EHDR + PHDR;
  dv.setUint32(p + 0x00, PT_DYNAMIC, true);
  dv.setUint32(p + 0x04, 0b110, true);
  dv.setBigUint64(p + 0x08, BigInt(toOff(dynVaddr)), true);
  dv.setBigUint64(p + 0x10, BigInt(dynVaddr), true);
  dv.setBigUint64(p + 0x18, BigInt(dynVaddr), true);

  u8.set(ctorCode, toOff(ctorVaddr));
  dv.setBigUint64(toOff(initArrayVaddr), 0n, true);

  const relaOff = toOff(relaVaddr);
  dv.setBigUint64(relaOff + 0x00, BigInt(initArrayVaddr), true);
  dv.setBigUint64(relaOff + 0x08, BigInt(R_AARCH64_RELATIVE), true);
  dv.setBigUint64(relaOff + 0x10, BigInt(ctorVaddr), true);

  const dynEntries: Array<[number, number]> = [
    [DT_RELA, relaVaddr],
    [DT_RELASZ, 24],
    [DT_RELAENT, 24],
    [DT_INIT_ARRAY, initArrayVaddr],
    [DT_INIT_ARRAYSZ, 8],
    [DT_NULL, 0],
  ];
  let d = toOff(dynVaddr);
  for (const [tag, val] of dynEntries) {
    dv.setBigInt64(d + 0x00, BigInt(tag), true);
    dv.setBigUint64(d + 0x08, BigInt(val), true);
    d += 16;
  }
  const dynSize = dynEntries.length * 16;
  dv.setBigUint64(EHDR + PHDR + 0x20, BigInt(dynSize), true);
  dv.setBigUint64(EHDR + PHDR + 0x28, BigInt(dynSize), true);
  return u8;
}

describe('CpuEngine.loadElf — constructor NULL-call tolerance', () => {
  it('a NULL indirect call in a constructor does not abort loadElf', () => {
    // Constructor: movz x8,#0 ; blr x8  → call through NULL.
    const movz_x8_0 = (0xd2800000 | (0 << 5) | 8) >>> 0; // x8 = 0
    const blr_x8 = (0xd63f0000 | (8 << 5)) >>> 0;
    const so = buildSoWithCtor([...le32(movz_x8_0), ...le32(blr_x8)]);
    const engine = new CpuEngine();
    expect(() => engine.loadElf(so)).not.toThrow();
  });

  it('the swallowed constructor NULL-call is recorded in the fault log', () => {
    const movz_x8_0 = (0xd2800000 | (0 << 5) | 8) >>> 0;
    const blr_x8 = (0xd63f0000 | (8 << 5)) >>> 0;
    const so = buildSoWithCtor([...le32(movz_x8_0), ...le32(blr_x8)]);
    const engine = new CpuEngine();
    engine.loadElf(so);
    const faults = engine.constructorFaultLog();
    expect(faults.length).toBe(1);
    expect(faults[0]).toMatch(/NULL indirect call/i);
  });

  it('a constructor that returns cleanly leaves an empty fault log', () => {
    const ret = 0xd65f03c0 >>> 0; // ret
    const so = buildSoWithCtor([...le32(ret)]);
    const engine = new CpuEngine();
    engine.loadElf(so);
    expect(engine.constructorFaultLog().length).toBe(0);
  });
});
