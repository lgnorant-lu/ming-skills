/**
 * BranchSystem — branch and system instruction family.
 *
 * Encoding space: bits[28:25] = 101x (10, 11)
 *
 * Covers:
 * - B / BL (unconditional branch, branch-with-link)
 * - RET / BR / BLR (return, branch-to-register, branch-link-to-register)
 * - CBZ / CBNZ (compare-and-branch-if-zero/nonzero)
 * - B.cond (conditional branch)
 * - TBZ / TBNZ (test-bit-and-branch)
 * - HINT space (NOP, PACIASP/AUTIASP, BTI, YIELD, etc.)
 * - Barrier space (DMB, DSB, ISB)
 * - MRS (system register read, minimal TPIDR_EL0 support)
 * - SVC (supervisor call, syscall trap)
 */

import type { ExecutionContext } from '../cpu/ExecutionContext';
import type { HostContext } from '../host-context';
import { execHintPac } from './PointerAuth';

/**
 * NullIndirectCallError — jump/call through a register holding 0.
 *
 * Carried as a distinct class so callers can tell a NULL indirect call apart
 * from any other throw. The `callSymbol` path lets it propagate (the user
 * invoked a function that dereferenced an uninitialised pointer — a real bug),
 * while the constructor path tolerates it (a C++ static-ctor that wanders into
 * a NULL call is an emulator-fidelity limit, not a reason to fail the whole load).
 */
export class NullIndirectCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NullIndirectCallError';
  }
}

/**
 * Guard an indirect branch/call target (BR/BLR). callSymbol/runInitializers
 * seed LR with the sentinel 0 so a genuine RET halts the run loop. A target of
 * 0 here is therefore NOT a return — it is a jump/call through an
 * uninitialised function pointer (a real-hardware SIGSEGV). Without this
 * guard, PC=0 silently trips the loop's stop condition and the failure
 * masquerades as a clean return — the exact effect that hid the STUR
 * write-loss bug behind a fake "ran-to-return".
 */
function assertIndirectTarget(ctx: ExecutionContext, target: number, kind: 'BR' | 'BLR'): void {
  if (target === 0) {
    throw new NullIndirectCallError(
      `NULL indirect call: ${kind} to address 0 at pc=0x${ctx.pc.toString(16)} ` +
        `(likely an uninitialised function pointer)`,
    );
  }
}

/** Compute a 26-bit PC-relative branch offset (SignExtend(imm26 << 2)). */
function branchOffset(insn: number): number {
  const imm26 = insn & 0x3ffffff;
  const sign = imm26 & 0x2000000 ? -1 : 0;
  return ((sign << 26) | imm26) * 4;
}

/** Compute a 19-bit PC-relative branch offset (SignExtend(imm19 << 2)). */
function imm19Offset(insn: number): number {
  const imm19 = (insn >>> 5) & 0x7ffff;
  const sign = imm19 & 0x40000 ? -1 : 0;
  return ((sign << 19) | imm19) * 4;
}

/**
 * Try to execute a Branches, Exception Generating and System instruction.
 * Returns true if handled, false if the instruction doesn't belong to this family.
 */
export function execBranchSystem(
  ctx: ExecutionContext,
  insn: number,
  ensureTls: () => number,
  hostContext: () => HostContext,
  syscalls: Map<number, (hctx: HostContext) => number | undefined>,
): boolean {
  // B (unconditional branch): 000101 | imm26   → PC += SignExtend(imm26 << 2)
  if (insn >>> 26 === 0b000101) {
    ctx.setPc(ctx.getPc() + branchOffset(insn));
    ctx.markBranched();
    return true;
  }

  // BL (branch with link): 100101 | imm26   → LR = PC+4; PC += offset
  if (insn >>> 26 === 0b100101) {
    ctx.writeGpr(30, BigInt(ctx.getPc() + 4));
    ctx.setPc(ctx.getPc() + branchOffset(insn));
    ctx.markBranched();
    return true;
  }

  // RET: 1101011 0 0 10 11111 000000 Rn 00000   → PC = X[Rn] (default LR)
  if ((insn & 0xfffffc1f) >>> 0 === 0xd65f0000) {
    const rn = (insn >>> 5) & 0b11111;
    ctx.setPc(Number(ctx.readGpr(rn)));
    ctx.markBranched();
    return true;
  }

  // BR Rn: 1101011 0 0 00 11111 000000 Rn 00000  → PC = X[Rn] (indirect branch)
  if ((insn & 0xfffffc1f) >>> 0 === 0xd61f0000) {
    const rn = (insn >>> 5) & 0b11111;
    const target = Number(ctx.readGpr(rn));
    assertIndirectTarget(ctx, target, 'BR');
    ctx.setPc(target);
    ctx.markBranched();
    return true;
  }

  // BLR Rn: 1101011 0 0 01 11111 000000 Rn 00000  → LR = PC+4; PC = X[Rn]
  if ((insn & 0xfffffc1f) >>> 0 === 0xd63f0000) {
    const rn = (insn >>> 5) & 0b11111;
    const target = Number(ctx.readGpr(rn));
    assertIndirectTarget(ctx, target, 'BLR');
    ctx.writeGpr(30, BigInt(ctx.getPc() + 4));
    ctx.setPc(target);
    ctx.markBranched();
    return true;
  }

  // CBZ/CBNZ: sf | 011010 | op | imm19 | Rt   (op: 0=CBZ 1=CBNZ)
  if (((insn >>> 25) & 0b111111) === 0b011010) {
    const sf = insn >>> 31;
    const op = (insn >>> 24) & 1;
    const rt = insn & 0b11111;
    const value = sf === 1 ? ctx.readGpr(rt) : BigInt.asUintN(32, ctx.readGpr(rt));
    const isZero = value === 0n;
    if (op === 0 ? isZero : !isZero) {
      ctx.setPc(ctx.getPc() + imm19Offset(insn));
      ctx.markBranched();
    }
    return true;
  }

  // B.cond: 0101010 0 | imm19 | 0 | cond
  if (insn >>> 24 === 0b01010100 && ((insn >>> 4) & 1) === 0) {
    const cond = insn & 0b1111;
    if (ctx.conditionHolds(cond)) {
      ctx.setPc(ctx.getPc() + imm19Offset(insn));
      ctx.markBranched();
    }
    return true;
  }

  // TBZ/TBNZ: b5 | 011011 | op | b40(5) | imm14 | Rt   (op: 0=TBZ 1=TBNZ)
  //   Tests bit (b5:b40) of Rt; branches by SignExtend(imm14 << 2) when the
  //   condition holds. b5 is the high bit of the 6-bit position (so 0..63).
  if (((insn >>> 25) & 0b111111) === 0b011011) {
    const op = (insn >>> 24) & 1;
    const b5 = insn >>> 31;
    const b40 = (insn >>> 19) & 0b11111;
    const bitPos = (b5 << 5) | b40;
    const rt = insn & 0b11111;
    const imm14 = (insn >>> 5) & 0x3fff;
    const offset = Number(ctx.signExtend(BigInt(imm14), 14)) * 4;
    const bitSet = ((ctx.readGpr(rt) >> BigInt(bitPos)) & 1n) === 1n;
    if (op === 0 ? !bitSet : bitSet) {
      ctx.setPc(ctx.getPc() + offset);
      ctx.markBranched();
    }
    return true;
  }

  // Pointer Authentication HINT forms (PACIASP/AUTIASP/PACIBSP/AUTIBSP/XPACLRI):
  //   check before the blanket NOP handler so PAC sign/auth is observable.
  if (execHintPac(ctx, insn)) return true;

  // BTI (Branch Target Identification): PAC landing pad, no-op in emulator.
  //   0xD503241F (BTI), 0xD503245F (BTI c), 0xD503249F (BTI j), 0xD50324DF (BTI jc)
  if ((insn & 0xffffff1f) >>> 0 === 0xd503241f) {
    return true;
  }

  // HINT space (NOP, PACIASP/AUTIASP, YIELD, …): 1101010100 0 00 011 0010 …
  //   Treat the whole hint space as a no-op so compiler-emitted prologue/landing
  //   pads (PAC/BTI) don't fault. NOP itself is 0xD503201F.
  if ((insn & 0xfffff01f) >>> 0 === 0xd503201f) {
    return true;
  }

  // Barrier space (DMB/DSB/ISB): 1101010100 0 00 011 0011 CRm op2 11111, where
  //   op2 selects DSB(4)/DMB(5)/ISB(6) and CRm the shareability domain. This
  //   interpreter executes a single guest thread in program order, so memory
  //   barriers have no observable effect — model them as no-ops (the alternative
  //   is an honest fault that would stop real libc/SQLite code that fences
  //   around lock-free sequences). The CRn=0011 group bit distinguishes these
  //   from the HINT space (CRn=0010) above.
  if ((insn & 0xfffff01f) >>> 0 === 0xd503301f) {
    return true;
  }

  // MSR <sysreg>, Xt: 1101 0101 0001 1 o0 op1 CRn CRm op2 Rt (write; 0xd51
  //   prefix is the write-to-system-register direction). TPIDR_EL0
  //   (S3_3_C13_C0_2) writes are no-ops — the MRS path always returns the
  //   fixed TLS block base, so storing a different value would have no effect.
  //   Other system register writes are also no-ops: the emulator models only a
  //   minimal set of system registers, and silently ignoring writes lets real-
  //   world code (TLS setup, PAC key writes, cache maintenance) run without
  //   faulting on unmodeled MSR instructions.
  if (insn >>> 20 === 0xd51) {
    return true;
  }

  // MRS Xt, <sysreg>: 1101 0101 0011 1 o0 op1 CRn CRm op2 Rt (read; the 0xd53
  //   prefix is the read direction). Modelled minimally: TPIDR_EL0
  //   (S3_3_C13_C0_2) and TPIDRRO_EL0 (S3_3_C13_C0_3) return the thread-
  //   pointer block base (lazily mapped, carrying a fixed stack canary at
  //   +0x28); every other system register reads as 0. This lets stack-
  //   protector and TLS prologues run instead of faulting, without modelling
  //   the full processor-element state.
  if (insn >>> 20 === 0xd53) {
    const rt = insn & 0b11111;
    const op1 = (insn >>> 16) & 0b111;
    const crn = (insn >>> 12) & 0b1111;
    const crm = (insn >>> 8) & 0b1111;
    const op2 = (insn >>> 5) & 0b111;
    const isTpidr = op1 === 3 && crn === 13 && crm === 0 && (op2 === 2 || op2 === 3);
    ctx.writeGpr(rt, isTpidr ? BigInt(ensureTls()) : 0n);
    return true;
  }

  // SVC #imm16: 11010100 000 imm16 000 01 → trap to a syscall handler.
  //   AArch64 ABI: syscall number in x8, args x0..x5, result returns in x0.
  if ((insn & 0xffe0001f) >>> 0 === 0xd4000001) {
    const nr = Number(ctx.readGpr(8));
    const handler = syscalls.get(nr);
    if (!handler) {
      throw new Error(`Unimplemented syscall ${nr} (x8) at pc=0x${ctx.pc.toString(16)}`);
    }
    const result = handler(hostContext());
    if (result !== undefined) {
      ctx.writeGpr(0, BigInt.asUintN(64, BigInt(result)));
    }
    return true;
  }

  return false;
}
