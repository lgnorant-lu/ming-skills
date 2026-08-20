/**
 * RegisterFile — Encapsulates the AArch64 register file state extracted from CpuEngine.
 *
 * Manages:
 * - 31 general-purpose registers (X0..X30) as BigInt
 * - Stack pointer (SP) as BigInt
 * - Program counter (PC) as JS number (< 2^53)
 * - NZCV condition flags
 * - 32 SIMD/FP vector registers (V0..V31, 128-bit each)
 *
 * Provides accessors with XZR/SP semantics and named register lookup.
 */

const GPR_COUNT = 31;

export class RegisterFile {
  private readonly gpr: bigint[] = Array.from({ length: GPR_COUNT }, () => 0n);
  // eslint-disable-next-line no-underscore-dangle
  private _sp = 0n;
  // eslint-disable-next-line no-underscore-dangle
  private _pc = 0;
  private flagN = false;
  private flagZ = false;
  private flagC = false;
  private flagV = false;
  /**
   * The SIMD/FP V register file: 32 × 128-bit vectors (V0..V31), each the
   * backing store for its Q/D/S/H/B aliases. A DataView per register gives
   * multi-width lane access without re-wrapping. AArch64 is little-endian,
   * so byte 0 is least significant.
   */
  private readonly vreg: Uint8Array[] = Array.from({ length: 32 }, () => new Uint8Array(16));
  private readonly vview: DataView[] = this.vreg.map((b) => new DataView(b.buffer));

  // ── GPR access with XZR semantics (encoding 31 = zero register) ──

  private framePtr = 0n; // x31 override (0=normal XZR, setFrame→non-zero=writable FP)

  readGpr(index: number): bigint {
    if (index === 31) return this.framePtr;
    return this.gpr[index] ?? 0n;
  }

  writeGpr(index: number, value: bigint): void {
    if (index === 31) {
      // Only write to x31 if framePtr was explicitly enabled (non-zero).
      // Otherwise discard (XZR semantics for backward compat).
      if (this.framePtr !== 0n) this.framePtr = BigInt.asUintN(64, value);
      return;
    }
    this.gpr[index] = BigInt.asUintN(64, value);
  }

  /** Enable x31 as frame pointer. Set to non-zero to allow x31 writes. */
  setFrame(value: bigint): void {
    this.framePtr = BigInt.asUintN(64, value);
  }
  getFrame(): bigint {
    return this.framePtr;
  }

  /** Register access where encoding 31 means SP (used by ADD/SUB immediate). */
  readGprSp(index: number): bigint {
    // eslint-disable-next-line no-underscore-dangle
    if (index === 31) return this._sp;
    return this.gpr[index] ?? 0n;
  }

  writeGprSp(index: number, value: bigint): void {
    if (index === 31) {
      // eslint-disable-next-line no-underscore-dangle
      this._sp = BigInt.asUintN(64, value);
      return;
    }
    this.gpr[index] = BigInt.asUintN(64, value);
  }

  // ── Named register access (x0..x30, sp, pc, xzr) ──

  writeNamed(name: string, value: bigint): void {
    const lower = name.toLowerCase();
    if (lower === 'sp') {
      // eslint-disable-next-line no-underscore-dangle
      this._sp = value;
      return;
    }
    if (lower === 'pc') {
      // eslint-disable-next-line no-underscore-dangle
      this._pc = Number(value);
      return;
    }
    if (lower === 'xzr') return;
    this.gpr[this.gprIndex(lower)] = value;
  }

  readNamed(name: string): bigint {
    const lower = name.toLowerCase();
    // eslint-disable-next-line no-underscore-dangle
    if (lower === 'sp') return this._sp;
    // eslint-disable-next-line no-underscore-dangle
    if (lower === 'pc') return BigInt(this._pc);
    if (lower === 'xzr') return 0n;
    return this.gpr[this.gprIndex(lower)] ?? 0n;
  }

  /** Resolve "x0".."x30" to a register-file index, or throw on a bad name. */
  private gprIndex(lower: string): number {
    const match = /^x(\d{1,2})$/.exec(lower);
    const index = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= GPR_COUNT) {
      throw new Error(`Unknown register: "${lower}"`);
    }
    return index;
  }

  // ── SP and PC getters/setters ──

  get sp(): bigint {
    // eslint-disable-next-line no-underscore-dangle
    return this._sp;
  }

  set sp(value: bigint) {
    // eslint-disable-next-line no-underscore-dangle
    this._sp = BigInt.asUintN(64, value);
  }

  get pc(): number {
    // eslint-disable-next-line no-underscore-dangle
    return this._pc;
  }

  set pc(value: number) {
    // eslint-disable-next-line no-underscore-dangle
    this._pc = value;
  }

  // ── NZCV condition flags ──

  setFlags(n: boolean, z: boolean, c: boolean, v: boolean): void {
    this.flagN = n;
    this.flagZ = z;
    this.flagC = c;
    this.flagV = v;
  }

  getFlags(): { n: boolean; z: boolean; c: boolean; v: boolean } {
    return { n: this.flagN, z: this.flagZ, c: this.flagC, v: this.flagV };
  }

  get n(): boolean {
    return this.flagN;
  }
  set n(value: boolean) {
    this.flagN = value;
  }

  get z(): boolean {
    return this.flagZ;
  }
  set z(value: boolean) {
    this.flagZ = value;
  }

  get c(): boolean {
    return this.flagC;
  }
  set c(value: boolean) {
    this.flagC = value;
  }

  get v(): boolean {
    return this.flagV;
  }
  set v(value: boolean) {
    this.flagV = value;
  }

  // ── SIMD/FP vector register access ──

  /**
   * Read a SIMD/FP vector register alias (`vN`/`qN`/`dN`/`sN`/`hN`/`bN`) as the
   * alias-width little-endian byte hex string. `v` and `q` both return the full
   * 128 bits.
   */
  readVectorAlias(name: string): string {
    const match = /^([vqdshb])(\d{1,2})$/i.exec(name);
    if (!match) {
      throw new Error(`Unknown vector register: "${name}" (expected vN/qN/dN/sN/hN/bN)`);
    }
    const widthChar = match[1]!.toLowerCase();
    const reg = Number(match[2]);
    if (!Number.isInteger(reg) || reg < 0 || reg >= 32) {
      throw new Error(`Vector register index out of range: "${name}"`);
    }
    // Alias → byte width: b=1, h=2, s=4, d=8, q/v=16.
    const width =
      widthChar === 'b'
        ? 1
        : widthChar === 'h'
          ? 2
          : widthChar === 's'
            ? 4
            : widthChar === 'd'
              ? 8
              : 16;
    const bytes = this.vreg[reg] ?? new Uint8Array(16);
    let hex = '';
    for (let i = 0; i < width; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
    return hex;
  }

  /** Write a full 128-bit vector register from a Uint8Array (little-endian). */
  writeVector(index: number, bytes: Uint8Array): void {
    if (index < 0 || index >= 32) {
      throw new Error(`Vector register index out of range: ${index}`);
    }
    this.vreg[index]!.set(bytes.subarray(0, 16));
  }

  /** Get direct access to the vector register DataView (for SIMD operations). */
  getVectorView(index: number): DataView {
    if (index < 0 || index >= 32) {
      throw new Error(`Vector register index out of range: ${index}`);
    }
    return this.vview[index]!;
  }

  /** Get direct access to the vector register bytes (for SIMD operations). */
  getVectorBytes(index: number): Uint8Array {
    if (index < 0 || index >= 32) {
      throw new Error(`Vector register index out of range: ${index}`);
    }
    return this.vreg[index]!;
  }
}
