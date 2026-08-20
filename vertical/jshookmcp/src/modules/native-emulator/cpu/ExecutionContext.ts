/**
 * ExecutionContext — unified interface for instruction family executors.
 *
 * Provides a stable boundary between the instruction decoder/executor families
 * and the CPU state (registers, memory, flags, PC). Each instruction family
 * method accepts an ExecutionContext and operates through it, allowing the
 * families to be extracted to separate modules without tight coupling to
 * CpuEngine's internals.
 *
 * The interface includes both raw state access (readGpr, setFlags) and helper
 * functions (addWithFlags, conditionHolds) that instruction families need but
 * should not reimplement themselves.
 */

export interface ExecutionContext {
  // ── Register Access ──

  /** Read GPR xN as a 64-bit BigInt (index 31 = XZR = 0). */
  readGpr(index: number): bigint;

  /** Write GPR xN (index 31 = XZR, discarded). */
  writeGpr(index: number, value: bigint): void;

  /** Read GPR xN/SP: index 31 = SP (stack pointer), not XZR. */
  readGprSp(index: number): bigint;

  /** Write GPR xN/SP: index 31 = SP, not XZR. */
  writeGprSp(index: number, value: bigint): void;

  // ── Memory Access ──

  /** Load `bytes` bytes from guest memory as a little-endian unsigned integer. */
  loadValue(address: number, bytes: number): bigint;

  /** Store `bytes` bytes to guest memory from a little-endian unsigned integer. */
  storeValue(address: number, bytes: number, value: bigint): void;

  // ── Flag Access ──

  /** Set all four NZCV flags atomically. */
  setFlags(n: boolean, z: boolean, c: boolean, v: boolean): void;

  /** Read all four NZCV flags. */
  getFlags(): { n: boolean; z: boolean; c: boolean; v: boolean };

  /** Read-only flag accessors (for conditionHolds and instruction predicates). */
  readonly n: boolean;
  readonly z: boolean;
  readonly c: boolean;
  readonly v: boolean;

  // ── PC Control ──

  /** Read the current program counter. */
  getPc(): number;

  /** Set the program counter (for branch targets). */
  setPc(addr: number): void;

  /**
   * Mark that a branch occurred. The fetch loop skips the default +4 increment
   * when this is set. Branch/control-flow instructions MUST call this after
   * setting PC.
   */
  markBranched(): void;

  /** Read-only PC accessor (for ADR/ADRP and logging). */
  readonly pc: number;

  // ── Arithmetic Helpers ──

  /**
   * Compute operand1 + operand2 at the given width, update NZCV flags, and
   * return the (width-masked) result. C = unsigned carry-out, V = signed
   * overflow. ADC adds an incoming carry bit.
   *
   * @param sf 0 = 32-bit, 1 = 64-bit
   * @param carry Optional carry-in (0n or 1n), used by ADC/ADCS
   */
  addWithFlags(a: bigint, b: bigint, sf: number, carry?: bigint): bigint;

  /**
   * Compute operand1 - operand2 at the given width, update NZCV flags, and
   * return the (width-masked) result. C = "no borrow", V = signed overflow.
   * Subtraction is add-with-carry of ~operand2 + 1, matching AArch64 SUBS.
   *
   * @param sf 0 = 32-bit, 1 = 64-bit
   */
  subWithFlags(a: bigint, b: bigint, sf: number): bigint;

  /**
   * Evaluate an AArch64 condition code against the current NZCV flags.
   * Used by conditional branches, CSEL family, and CCMP/CCMN.
   */
  conditionHolds(cond: number): boolean;

  // ── Shift/Extend Helpers ──

  /**
   * Apply a shift (LSL/LSR/ASR/ROR) to value. Used by shifted-register forms
   * (ADD/SUB/CMP with shifted operands, logical ops, etc.).
   *
   * @param value Input value to shift
   * @param type Shift type: 0=LSL, 1=LSR, 2=ASR, 3=ROR
   * @param amount Shift amount (0-63 for 64-bit, 0-31 for 32-bit)
   * @param sf 0 = 32-bit, 1 = 64-bit
   */
  applyShift(value: bigint, type: number, amount: number, sf: number): bigint;

  /**
   * Extend a register value (UXTB/UXTH/UXTW/UXTX/SXTB/SXTH/SXTW/SXTX) and
   * optionally left-shift. Used by extended-register addressing modes.
   *
   * @param value Input value to extend
   * @param option Extend type (0-7): see AArch64 ISA manual
   * @param shift Left-shift amount (0-4)
   * @param sf 0 = 32-bit, 1 = 64-bit
   */
  extendReg(value: bigint, option: number, shift: number, sf: number): bigint;

  // ── Bit Manipulation Helpers ──

  /**
   * Sign-extend a value from `bits` width to 64-bit.
   *
   * @param value The value to extend
   * @param bits Source width (sign bit is at position bits-1)
   */
  signExtend(value: bigint, bits: number): bigint;

  /**
   * Decode an AArch64 logical-immediate bitmask (N:immr:imms encoding).
   * Returns the decoded 64-bit or 32-bit pattern.
   *
   * @param n The N bit (1 for 64-bit patterns, 0 for 32-bit)
   * @param immr Rotation amount (6 bits)
   * @param imms S field (determines element size and ones count)
   * @param sf 0 = 32-bit, 1 = 64-bit
   */
  decodeBitMask(n: number, immr: number, imms: number, sf: number): bigint;
}
