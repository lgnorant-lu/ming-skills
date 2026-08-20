/**
 * PointerAuth — ARMv8.3-A Pointer Authentication (PAC) instruction family.
 *
 * Two entry encodings arrive here via the top-level dispatch:
 *
 * - 3-source register form (bits[28:25] = x101 → Data Processing -- Register):
 *     1101 0101 000 | op31[2:0] | Rm | o0 | Ra | Rn | Rd   (prefix 0xDAC00000)
 *     op31: 001 PACIA, 011 PACIB, 101 AUTIA, 111 AUTIB.
 *     o0 (bit15) = 1 selects the "-Z[A|B]" variant whose modifier is XZR.
 *
 * - HINT form (bits[28:25] = 101x → Branches, Exception Generating and System):
 *     1101 0101 0000 0011 0010 CRm op2 11111   (NOP-family prefix 0xD5032xxxF)
 *     PACIASP / AUTIASP operate on LR with SP as modifier for prologue/epilogue.
 *
 * The PAC value is the QARMA5 cipher (ARM DDI 0487 C5.1.1) — a tweakable
 * 4-round-reflector Feistel over a 64-bit block (16 4-bit cells), keyed by a
 * 128-bit key (w0 || k0), with the modifier as the tweak. This implementation is
 * a faithful TypeScript port of the public reference implementation
 * (https://github.com/dkales/qarma64-python, qarma.py), verified against its
 * official-style test vectors (rounds=5, S-box 0 → ciphertext 3ee99a6c82af0c38).
 *
 * Cell layout follows the reference: a 64-bit value packs 16 nibbles BIG-endian
 * at the cell level — cell 0 = bits[63:60], cell 15 = bits[3:0]. toNibbles()
 * produces index 0 = most-significant nibble so the algorithm reads identically
 * to the Python `HexToBlock` (string left-to-right = cell 0 → cell 15).
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';

/** Per-engine PAC key set. IA/IB used by PACIA/PACIB/AUTIA/AUTIB; DA/DB reserved for GA. */
export interface PacKeys {
  /** 128-bit IA key as a 32-hex-char string (w0[0..15] || k0[0..15]). */
  ia: string;
  ib: string;
  da: string;
  db: string;
}

// ── QARMA5 constants (S-box 0, M4,2, 64-bit block) ──────────────────────────

const SBOX = [0, 14, 2, 10, 9, 15, 8, 11, 6, 4, 3, 7, 13, 12, 1, 5];
const SBOX_INV = (() => {
  const inv = Array.from({ length: 16 }) as number[];
  for (let i = 0; i < 16; i++) inv[SBOX[i]!] = i;
  return inv;
})();

const STATE_PERM = [0, 11, 6, 13, 10, 1, 12, 7, 5, 14, 3, 8, 15, 4, 9, 2];
const STATE_PERM_INV = (() => {
  const inv = Array.from({ length: 16 }) as number[];
  for (let i = 0; i < 16; i++) inv[STATE_PERM[i]!] = i;
  return inv;
})();
const TWEAK_PERM = [6, 5, 14, 15, 0, 1, 2, 3, 7, 12, 13, 4, 8, 9, 10, 11];

const ALPHA = hexToNibbles('C0AC29B7C97C50DD');
const ROUND_CONSTANTS = [
  '0000000000000000',
  '13198A2E03707344',
  'A4093822299F31D0',
  '082EFA98EC4E6C89',
  '452821E638D01377',
  'BE5466CF34E90C6C',
  '3F84D5B5B5470917',
  '9216D5D98979FB1B',
].map(hexToNibbles);

const QARMA_ROUNDS = 5; // ARMv8.3 silicon uses r=5 ("QARMA5").

// ── nibble-array <-> 64-bit BigInt helpers ──────────────────────────────────
// index 0 = most-significant nibble (matches Python HexToBlock left-to-right).

function hexToNibbles(hex: string): number[] {
  const clean = hex.toLowerCase().replace(/^0x/, '');
  const nibbles: number[] = [];
  for (const ch of clean) nibbles.push(parseInt(ch, 16));
  return nibbles;
}

function u64ToNibbles(v: bigint): number[] {
  const nibbles = Array.from({ length: 16 }, () => 0);
  for (let i = 0; i < 16; i++) {
    nibbles[15 - i] = Number((v >> BigInt(i * 4)) & 0xfn);
  }
  return nibbles;
}

function nibblesToU64(nibbles: number[]): bigint {
  let v = 0n;
  for (let i = 0; i < 16; i++) v |= BigInt(nibbles[i]! & 0xf) << BigInt((15 - i) * 4);
  return v & ((1n << 64n) - 1n);
}

// ── QARMA5 primitives (ported verbatim from qarma.py) ───────────────────────

function subBytes(state: number[], inverse: boolean): number[] {
  const s = inverse ? SBOX_INV : SBOX;
  return state.map((b) => s[b]!);
}

function xorBlocks(a: number[], b: number[]): number[] {
  return a.map((x, i) => x ^ b[i]!);
}

/** 4-bit rotate LEFT by r (QARMA MixColumns uses left rotation). */
function rot4(b: number, r: number): number {
  r &= 3;
  return (((b << r) | (b >> (4 - r))) & 0xf) % 16;
}

/** MixColumns (M4,2) applied column-wise: incol = [state[i], state[4+i], state[8+i], state[12+i]]. */
function mixColumns(state: number[]): number[] {
  const out = Array.from({ length: 16 }, () => 0);
  for (let i = 0; i < 4; i++) {
    const c0 = state[0 + i]!;
    const c1 = state[4 + i]!;
    const c2 = state[8 + i]!;
    const c3 = state[12 + i]!;
    out[0 + i] = rot4(c1, 1) ^ rot4(c2, 2) ^ rot4(c3, 1);
    out[4 + i] = rot4(c0, 1) ^ rot4(c2, 1) ^ rot4(c3, 2);
    out[8 + i] = rot4(c0, 2) ^ rot4(c1, 1) ^ rot4(c3, 1);
    out[12 + i] = rot4(c0, 1) ^ rot4(c1, 2) ^ rot4(c2, 1);
  }
  return out;
}

function permuteState(state: number[], inverse: boolean): number[] {
  const p = inverse ? STATE_PERM_INV : STATE_PERM;
  return state.map((_, i) => state[p[i]!]!);
}

function permuteTweak(tweak: number[]): number[] {
  return tweak.map((_, i) => tweak[TWEAK_PERM[i]!]!);
}

/** LFSR ω (m=4) applied to cells {0,1,3,4,8,11,13}: (b3,b2,b1,b0) → (b0^b1, b3, b2, b1). */
function tweakLfsrForward(nibbles: number[]): number[] {
  for (const b of [0, 1, 3, 4, 8, 11, 13]) {
    const t = nibbles[b]!;
    const b3 = (t >> 3) & 1;
    const b2 = (t >> 2) & 1;
    const b1 = (t >> 1) & 1;
    const b0 = (t >> 0) & 1;
    nibbles[b] = ((b0 ^ b1) << 3) | (b3 << 2) | (b2 << 1) | b1;
  }
  return nibbles;
}

function calcTweak(tweak: number[], r: number): number[] {
  let t = tweak.slice();
  for (let i = 0; i < r; i++) {
    t = permuteTweak(t);
    t = tweakLfsrForward(t);
  }
  return t;
}

function calcRoundTweakey(tweak: number[], r: number, k0: number[], backwards: boolean): number[] {
  let tk = calcTweak(tweak, r);
  tk = xorBlocks(tk, k0);
  tk = xorBlocks(tk, ROUND_CONSTANTS[r]!);
  if (backwards) tk = xorBlocks(tk, ALPHA);
  return tk;
}

function roundForward(state: number[], tweakey: number[], r: number): number[] {
  let s = xorBlocks(state, tweakey);
  if (r !== 0) {
    s = permuteState(s, false);
    s = mixColumns(s);
  }
  s = subBytes(s, false);
  return s;
}

function roundBackward(state: number[], tweakey: number[], r: number): number[] {
  let s = subBytes(state, true);
  if (r !== 0) {
    s = mixColumns(s);
    s = permuteState(s, true);
  }
  s = xorBlocks(s, tweakey);
  return s;
}

function middleRound(state: number[], k1: number[]): number[] {
  let s = permuteState(state, false);
  s = mixColumns(s);
  s = xorBlocks(s, k1);
  s = permuteState(s, true);
  return s;
}

/**
 * QARMA5 encryption over a 64-bit block. Mirrors qarma.py `qarma64(encrypt=True)`.
 * `keyHex` = w0[16 hex] || k0[16 hex] (32 hex chars = 128 bits).
 */
export function qarma5Encrypt(plaintext: bigint, tweak: bigint, keyHex: string): bigint {
  const w0 = u64ToNibbles(BigInt('0x' + keyHex.slice(0, 16)));
  const w0Int = BigInt('0x' + keyHex.slice(0, 16));
  const w1Int = (((w0Int >> 1n) | ((w0Int & 1n) << 63n)) ^ (w0Int >> 63n)) & ((1n << 64n) - 1n);
  const w1 = u64ToNibbles(w1Int);
  const k0 = u64ToNibbles(BigInt('0x' + keyHex.slice(16, 32)));
  const k1 = k0; // encryption: k1 = k0
  const p = u64ToNibbles(plaintext);
  const t = u64ToNibbles(tweak);

  let state = xorBlocks(p, w0);
  for (let i = 0; i < QARMA_ROUNDS; i++) {
    state = roundForward(state, calcRoundTweakey(t, i, k0, false), i);
  }
  const tweakR = calcTweak(t, QARMA_ROUNDS);
  state = roundForward(state, xorBlocks(w1, tweakR), QARMA_ROUNDS);
  state = middleRound(state, k1);
  state = roundBackward(state, xorBlocks(w0, tweakR), QARMA_ROUNDS);
  for (let i = QARMA_ROUNDS - 1; i >= 0; i--) {
    state = roundBackward(state, calcRoundTweakey(t, i, k0, true), i);
  }

  const cipher = xorBlocks(state, w1);
  return nibblesToU64(cipher);
}

// ── PAC field placement (ARM ARM C5.1.5) ────────────────────────────────────
// For a canonical 48-bit VA the PAC occupies bits[55:48] (8 bits, top byte unused
// after the bottom-8 extension bits). We truncate the 64-bit QARMA output to a
// PAC field and place it there; XPAC strips it without verification.

const PAC_LSB = 48n;
const PAC_MASK = 0x00ff000000000000n;
const MASK64 = (1n << 64n) - 1n;

function insertPac(pointer: bigint, pac: bigint): bigint {
  return (pointer & ~PAC_MASK & MASK64) | ((pac << PAC_LSB) & PAC_MASK);
}
function extractPac(pointer: bigint): bigint {
  return (pointer & PAC_MASK) >> PAC_LSB;
}
function stripPac(pointer: bigint): bigint {
  return pointer & ~PAC_MASK & MASK64;
}

/**
 * Compute the 8-bit PAC field for (key, modifier, pointer).
 * The modifier is duplicated 32→64 (ARM PAC convention) before being used as the
 * QARMA tweak. The full 64-bit cipher output is truncated to the PAC field width
 * (bits[55:48]); the lower 48 address bits are what reach the cipher as plaintext
 * (high byte cleared).
 */
function computePacField(keyHex: string, modifier: bigint, pointer: bigint): bigint {
  const dup = ((modifier & 0xffffffffn) | ((modifier & 0xffffffffn) << 32n)) & MASK64;
  const cipher = qarma5Encrypt(stripPac(pointer), dup, keyHex);
  // Truncate to 16 bits then mask to the 8-bit field we place at bits[55:48].
  return (cipher >> 48n) & 0xffn;
}

// ── Engine-side PAC key holder ──────────────────────────────────────────────
// The ExecutionContext passed by CpuEngine carries pacKeys (initialized in the
// engine constructor) — no fallback needed; the engine always owns a key set.
interface CpuEnginePacContext extends ExecutionContext {
  pacKeys: PacKeys;
  setPacKeys?(keys: PacKeys): void;
}

function keyHexFor(keys: PacKeys, isB: boolean): string {
  return isB ? keys.ib : keys.ia;
}

function diag(_ctx: CpuEnginePacContext, _msg: string): void {
  // AUT mismatch sink — informational in the reverse-engineering workflow, not
  // fatal. A future patch can route this to jniDiagnostics() once wired.
}

/**
 * Try to execute a 3-source PAC/AUT instruction. Returns true if handled.
 * Discriminator (caller-checked): (insn & 0xFFE00000) === 0xDAC00000.
 * op31: 001 PACIA, 011 PACIB, 101 AUTIA, 111 AUTIB.
 */
export function execPointerAuth3Source(ctx: ExecutionContext, insn: number): boolean {
  // Match top byte 0xDA in the Data Processing Register group (bits[31:24]).
  if ((insn & 0xff000000) >>> 0 !== 0xda000000) return false;
  const op31 = (insn >>> 21) & 0b111;
  const o0 = (insn >>> 15) & 1;
  if (op31 !== 0b001 && op31 !== 0b011 && op31 !== 0b101 && op31 !== 0b111) return false;

  const rm = (insn >>> 16) & 0b11111;
  const rn = (insn >>> 5) & 0b11111;
  const rd = insn & 0b11111;

  const isAut = (op31 & 0b100) !== 0;
  const isB = (op31 & 0b010) !== 0;
  const engine = ctx as CpuEnginePacContext;
  const keyHex = keyHexFor(engine.pacKeys, isB);

  // Modifier: Z variant (o0=1) → XZR (0); else Rm (XZR=0).
  const modifier = o0 === 1 ? 0n : rm === 31 ? 0n : ctx.readGpr(rm);
  const pointer = ctx.readGpr(rn);

  if (isAut) {
    const stored = extractPac(pointer);
    const expected = computePacField(keyHex, modifier, pointer);
    if (stored !== expected) {
      diag(engine, `AUT mismatch stored=${stored.toString(16)} expected=${expected.toString(16)}`);
    }
    // Verify-and-strip: real hardware faults on mismatch; here we strip to keep
    // control flow alive for the reverse engineer (the PAC round-trips in every
    // self-consistent case anyway).
    ctx.writeGpr(rd, stripPac(pointer));
  } else {
    const pac = computePacField(keyHex, modifier, pointer);
    ctx.writeGpr(rd, insertPac(stripPac(pointer), pac));
  }
  return true;
}

/**
 * HINT-form PAC instructions (PACIASP/AUTIASP/PACIBSP/AUTIBSP/XPACLRI).
 * Returns true if the instruction was a recognised HINT-space PAC opcode and was
 * executed; false otherwise (caller falls through to NOP/barrier handling).
 *
 * Operates on LR (x30) with SP as the modifier (prologue/epilogue signing).
 */
export function execHintPac(ctx: ExecutionContext, insn: number): boolean {
  // HINT space prefix 0xD5032xxxF; mask aligns the CRm/op2 fields.
  if ((insn & 0xfffff01f) >>> 0 !== 0xd503201f) return false;
  const crm = (insn >>> 8) & 0xf;
  const op2 = (insn >>> 5) & 0b111;

  const engine = ctx as CpuEnginePacContext;
  const lr = ctx.readGpr(30);
  const sp = ctx.readGprSp(31);

  // XPACLRI: 0xD50320FF (CRm=0, op2=7).
  if (crm === 0b0000 && op2 === 0b111) {
    ctx.writeGpr(30, stripPac(lr));
    return true;
  }

  // PACIsp/AUTIsp: CRm {0011, 0101, 0111, 1001, 1011, 1101}; op2 encodes action+key.
  //   Per ARM ARM C6.2: SP-signing family — op2 001/101 = I/A, 011/111 = B-variants.
  // We map conservatively to the modifier=SP, key=A/B variants:
  const isB = op2 === 0b011 || op2 === 0b111;
  const isAut = op2 === 0b101 || op2 === 0b111;
  if (!(op2 === 0b001 || op2 === 0b011 || op2 === 0b101 || op2 === 0b111)) return false;

  const keyHex = keyHexFor(engine.pacKeys, isB);
  const modifier = sp;
  if (isAut) {
    const stored = extractPac(lr);
    const expected = computePacField(keyHex, modifier, lr);
    if (stored !== expected) diag(engine, `AUTIsp mismatch at pc=0x${ctx.pc.toString(16)}`);
    ctx.writeGpr(30, stripPac(lr));
  } else {
    const pac = computePacField(keyHex, modifier, lr);
    ctx.writeGpr(30, insertPac(stripPac(lr), pac));
  }
  return true;
}

export { insertPac, extractPac, stripPac };
