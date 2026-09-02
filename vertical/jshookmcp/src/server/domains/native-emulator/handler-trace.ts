import { writeFile } from 'node:fs/promises';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import { disassembleInstruction } from '@modules/native-emulator/disasm';
import { signExtend7 } from '@modules/native-emulator/simd-utils';
import { SYSCALL_NAMES } from '@modules/native-emulator/syscalls';
import { resolveArtifactPath } from '@utils/artifacts';

const VECTOR_RE = /^[vqdshb]\d{1,2}$/i;

export type TraceMode = 'full' | 'profile' | 'calls' | 'branches' | 'memory';

/**
 * Per-trace-call scratch space shared across every instruction row.
 *
 * Holds an insertion-ordered cache keyed by `(pc, insn)`, so a VMP dispatch
 * loop that hits the same handful of addresses thousands of times pays
 * `disassembleArm64` once per unique (pc, insn) instead of once per executed
 * instruction — the same class of win upstream unidbg landed in commit
 * `33766ac1` (4700万行 trace: 数小时→40s).
 *
 * The key combines pc AND insn (not pc alone): PC-relative mnemonics (ADR/ADRP,
 * B/BL, LDR literal) depend on pc, and self-modifying code can rewrite the
 * instruction word at a fixed pc mid-trace — keying on pc alone would return a
 * stale mnemonic. `(pc, insn)` stays correct under SMC at no extra cost, since
 * re-execution of the same instruction hits the same key.
 *
 * The cache is bounded; on overflow the oldest entry is evicted (FIFO via Map
 * insertion order) so a long trace with a huge working set cannot grow memory
 * unbounded.
 */
export interface TraceRowContext {
  /** `(pc:insn) → disassembled mnemonic string`. Bounded FIFO. */
  disasmCache: Map<string, string>;
  /** Cap on disasmCache size; oldest entry evicted on overflow. */
  maxEntries: number;
}

/** Upper bound on the disassembly cache to cap memory on very large traces. */
const DISASM_CACHE_MAX = 8192;

/**
 * Create a fresh per-trace scratch context. One per `handleTrace` invocation;
 * not shared across sessions or concurrent traces. `maxEntries` lets tests probe
 * eviction with a small bound; production callers omit it for the 8192 default.
 */
export function createTraceRowContext(maxEntries: number = DISASM_CACHE_MAX): TraceRowContext {
  return { disasmCache: new Map<string, string>(), maxEntries };
}

/** Cache key for a (pc, insn) pair. */
function cacheKey(pc: number, insn: number): string {
  return `${pc}:${insn >>> 0}`;
}

/**
 * Disassemble `insn` at `pc`, memoizing in the trace context's cache. Falls back
 * to an uncached call if no context is supplied (back-compat for direct callers).
 */
function cachedDisasm(ev: TraceEvent, ctx?: TraceRowContext): string {
  if (!ctx) return disassembleInstruction('arm64', ev.insn, BigInt(ev.pc));
  const key = cacheKey(ev.pc, ev.insn);
  const cached = ctx.disasmCache.get(key);
  if (cached !== undefined) return cached;
  const asm = disassembleInstruction('arm64', ev.insn, BigInt(ev.pc));
  if (ctx.disasmCache.size >= ctx.maxEntries) {
    // FIFO eviction: Map iteration order is insertion order; delete the oldest.
    const oldest = ctx.disasmCache.keys().next().value;
    if (oldest !== undefined) ctx.disasmCache.delete(oldest);
  }
  ctx.disasmCache.set(key, asm);
  return asm;
}

/**
 * Decode an `svc #0` trap into a human-readable syscall annotation, e.g.
 * `write(fd=1, buf=0x401000, count=12)`. Returns null for non-SVC instructions
 * or unknown syscall numbers — only the syscalls this emulator implements
 * (see {@link SYSCALL_NAMES}) are annotated, mirroring unidbg's
 * DefaultSyscallParser (commit b298d619).
 *
 * Pointer-bearing arguments are rendered as raw hex addresses, not
 * dereferenced: the trace formatter has no memory-accessor on TraceEvent, and
 * a failing dereference would corrupt the row.
 */
function svcAnnotation(ev: TraceEvent): string | null {
  // SVC #0: 0xd4000001 (imm32=0). Mask the whole encoding space.
  if (ev.insn !== 0xd4000001) return null;
  let nr: number;
  try {
    nr = Number(ev.x(8));
  } catch {
    return null;
  }
  const meta = SYSCALL_NAMES[nr];
  if (!meta) return null;
  if (meta.params.length === 0) return `${meta.name}()`;
  const parts: string[] = [];
  for (let i = 0; i < meta.params.length; i++) {
    try {
      parts.push(`${meta.params[i]}=0x${Number(ev.x(i)).toString(16)}`);
    } catch {
      parts.push(`${meta.params[i]}=?`);
    }
  }
  return `${meta.name}(${parts.join(', ')})`;
}

/** Return true if this instruction passes the `mode` filter, or if tableReg matches. */
export function traceFilterMatch(
  insn: number,
  _asm: string,
  mode: TraceMode,
  tableReg?: number,
): boolean {
  if (mode === 'full') return true;

  // Quick opcode-based classification to avoid string-prefix false positives.
  const op0 = (insn >>> 25) & 0b1111;
  const isLoadStore = (op0 & 0b0101) === 0b0100; // x1x0 (4,6,12,14)

  // When tableReg is set, always include load/store instructions using that register.
  if (tableReg !== undefined && tableReg >= 0 && isLoadStore) {
    const rn = (insn >>> 5) & 0b11111;
    if (rn === tableReg) return true;
  }

  if (mode === 'memory') return isLoadStore;

  // Branch / System family: 1010, 1011
  const isBranchSys = op0 === 0b1010 || op0 === 0b1011;
  if (!isBranchSys) return false;
  if (mode === 'branches') return true;

  // 'calls' mode: only BLR / BR, not plain B / B.cond / CBZ / RET etc.
  // BLR: 0xD63F0000, BR: 0xD61F0000
  const mask = (insn & 0xfffffc1f) >>> 0;
  return mask === 0xd63f0000 || mask === 0xd61f0000;
}

/**
 * Return memory-access details for a load/store instruction, or null.
 *
 * Covers four encoding families so a VMP dispatch-table / frame-prologue trace
 * annotates every access the guest makes (not just the single-register forms):
 *  - LDP/STP (load/store pair) — emits BOTH accesses, mirroring upstream
 *    unidbg (commit 8063a4f1) which splits ldp/stp into two records.
 *  - LDR/STR (unsigned immediate)
 *  - LDR/STR (register offset, with extend)
 *  - LDUR/STUR/pre-index/post-index (imm9 forms)
 *
 * When `tableReg` is set, only instructions using that register as base pass
 * through; otherwise every load/store is annotated.
 */
function memAccess(
  ev: TraceEvent,
  insn: number,
  tableReg?: number,
): Array<Record<string, unknown>> | null {
  const op0 = (insn >>> 25) & 0b1111;
  if ((op0 & 0b0101) !== 0b0100) return null; // not load/store

  const rn = (insn >>> 5) & 0b11111;
  const isLoad = ((insn >>> 22) & 1) === 1;

  // Only capture if tableReg is set and base register matches, or if tableReg is not set
  if (tableReg !== undefined && tableReg >= 0 && rn !== tableReg) return null;

  try {
    // LDP/STP (load/store pair): opc|101|V(0)|idx(24:23)|L|imm7|Rt2|Rn|Rt
    //   bits[29:25] === 0b10100 (V=0, integer). Two accesses at addr and addr+bytes.
    //   opc(31:30): 00=STP32, 01=LDP32, 10=STP64, 11=LDP64.
    //   idx(24:23): 00=LDNP/STNP (offset, no wb), 01=post-index, 10=offset, 11=pre-index.
    if (((insn >>> 25) & 0b11111) === 0b10100 && ((insn >>> 26) & 1) === 0) {
      const opc = insn >>> 30;
      const bytes = opc >= 0b10 ? 8 : 4;
      const idx = (insn >>> 23) & 0b11;
      const imm7 = signExtend7((insn >>> 15) & 0x7f) * bytes;
      const rt2 = (insn >>> 10) & 0b11111;
      const rt = insn & 0b11111;
      // post-index accesses at the bare base; offset/pre-index access at base+imm7.
      const baseVal = ev.x(rn);
      const baseAddr = idx === 0b01 ? Number(baseVal) : Number(baseVal) + imm7;
      const addr2 = baseAddr + bytes;
      // Second access is `bytes` further than the first. For post-index the
      // first access sits at the bare base (offset 0), so the second is +bytes;
      // for offset/pre-index the first is at base+imm7, so the second is imm7+bytes.
      const offset2 =
        idx === 0b01
          ? `+0x${bytes.toString(16)}`
          : `${imm7 >= 0 ? '+' : ''}0x${(imm7 + bytes).toString(16)}`;
      return [
        {
          base: `x${rn}`,
          baseValue: baseVal.toString(16),
          reg: `x${rt}`,
          offset: idx === 0b01 ? '+0' : `${imm7 >= 0 ? '+' : ''}0x${imm7.toString(16)}`,
          addr: `0x${baseAddr.toString(16)}`,
          size: bytes,
          load: isLoad,
        },
        {
          base: `x${rn}`,
          baseValue: baseVal.toString(16),
          reg: `x${rt2}`,
          offset: offset2,
          addr: `0x${addr2.toString(16)}`,
          size: bytes,
          load: isLoad,
        },
      ];
    }

    // Try to read the base register and compute the effective address.
    // Load/store unsigned immediate: bits[27:25]=111, Rn at bits[9:5], offset at bits[21:10].
    // Register offset: bits[27:24]=0011 (LDR) or 0010 (STR), Rm at bits[20:16], option at bits[15:13].
    const subType = (insn >>> 24) & 0b1111; // bits[27:24] — broader than 3 bits for register-offset

    // Unsigned immediate (LDR/STR imm): bits[27:26]=10 (op0=111, size=00), bit[24]=1 (V=1 for integer)
    if ((subType & 0b1100) === 0b1000 && ((insn >>> 24) & 1) === 1) {
      const size = (insn >>> 30) & 0b11; // 0=b, 1=h, 2=w, 3=x
      const scale = 1 << size;
      const offset = ((insn >>> 10) & 0xfff) * scale;
      const baseVal = ev.x(rn);
      const addr = Number(baseVal) + offset;
      return [
        {
          base: `x${rn}`,
          baseValue: baseVal.toString(16),
          offset: `+0x${offset.toString(16)}`,
          addr: `0x${addr.toString(16)}`,
          size: scale,
          load: isLoad,
        },
      ];
    }
    // Register offset (LDR Xt, [Xn, Xm, {SXTW/UXTW {#shift}}]):
    // Two encoding variants:
    //   - bits[27:24] = 0011 (LDR) or 0010 (STR) – simple register offset
    //   - bits[27:24] = 1001 (LDR) or 1000 (STR) – register offset with extend (UXTW/SXTW)
    // bit[21] = 0 distinguishes from SIMD load/store variants
    const isRegOffset =
      ((subType & 0b1100) === 0b0000 || (subType & 0b1100) === 0b1000) && ((insn >>> 21) & 1) === 0;
    if (isRegOffset) {
      const rm = (insn >>> 16) & 0b11111;
      const option = (insn >>> 13) & 0b111;
      const s = ((insn >>> 12) & 1) !== 0; // scaled
      const size = (insn >>> 30) & 0b11;
      const scale = s ? 1 << size : 1;
      try {
        const baseVal = ev.x(rn);
        const indexVal = Number(ev.x(rm));
        let effectiveIndex: number;
        if (option === 0b011)
          effectiveIndex = indexVal & 0xffffffff; // UXTW
        else if (option === 0b111)
          effectiveIndex = (indexVal << 32) >> 32; // SXTW
        else effectiveIndex = indexVal; // LSL (UXTX)
        const offset = effectiveIndex * scale;
        const addr = Number(baseVal) + offset;
        return [
          {
            base: `x${rn}`,
            baseValue: baseVal.toString(16),
            indexReg: `x${rm}`,
            indexValue: `0x${indexVal.toString(16)}`,
            tableIdx: effectiveIndex,
            scale,
            offset: `+${rm === 31 ? '0' : effectiveIndex + '*' + scale}`,
            addr: `0x${addr.toString(16)}`,
            size: 1 << size,
            load: isLoad,
          },
        ];
      } catch {
        /* register read may fault */
      }
    }
  } catch {
    // Register read may fault — skip memory info for this row.
  }
  return null;
}

export function traceRow(
  ev: TraceEvent,
  captureRegisters: string[],
  _mode?: TraceMode,
  tableReg?: number,
  captureBlArgs?: boolean,
  ctx?: TraceRowContext,
): Record<string, unknown> {
  const asmStr = cachedDisasm(ev, ctx);
  const row: Record<string, unknown> = {
    step: ev.step,
    pc: `0x${ev.pc.toString(16)}`,
    insn: `0x${ev.insn.toString(16).padStart(8, '0')}`,
    asm: asmStr,
  };
  // SVC semantic annotation: decode `svc #0` into the syscall name + args.
  // Rendered alongside `asm` so a reader sees both the raw mnemonic and the
  // resolved meaning without a second lookup.
  const svc = svcAnnotation(ev);
  if (svc) row.svc = svc;
  // Always capture tableReg value when set — critical for tracking
  // the x24 table pointer through bytecode execution.
  if (tableReg !== undefined && tableReg >= 0 && tableReg <= 30) {
    try {
      row['x' + tableReg] = Number(ev.x(tableReg)).toString(16);
    } catch {
      /* register read may fault */
    }
  }
  // captureBlArgs: snapshot x0-x7 (call arguments) on BL/BLR instructions.
  // BL/BLR is detected by opcode (not by re-parsing the disassembly string),
  // so the annotation survives even if the disassembler output format changes.
  if (captureBlArgs) {
    // BL imm26 (bits[31:26]=100101) and the BLR family have their top bit set,
    // so the masked result is negative as a signed int32 — compare against the
    // unsigned form via `>>> 0` (same pattern as the profile path).
    const isBl = (ev.insn & 0xfc000000) >>> 0 === 0x94000000; // BL imm26
    // BLR family (BLR + ARMv8.3 PAC variants BLRAA/BLRAAZ/BLRAB/BLRABZ): only
    // bits[11:10] (the op3 Z/A/B discriminators) distinguish them, so mask those
    // out (0xfffff1ff) instead of keeping them (the old 0xfffffc1f excluded PAC
    // variants, losing call-arg capture on ARMv8.3 .so that use pointer auth).
    const isBlr = (ev.insn & 0xfffff1ff) >>> 0 === 0xd63f0000; // BLR / BLRAA*
    if (isBl || isBlr) {
      const args: Record<string, string> = {};
      for (let i = 0; i <= 7; i++) {
        try {
          args[`x${i}`] = `0x${Number(ev.x(i)).toString(16)}`;
        } catch {
          args[`x${i}`] = '?';
        }
      }
      row.blArgs = args;
    }
  }
  const mem = memAccess(ev, ev.insn, tableReg);
  if (mem) row.memory = mem;
  if (captureRegisters.length > 0) {
    const regs: Record<string, number | string> = {};
    for (const name of captureRegisters) {
      regs[name] = VECTOR_RE.test(name) ? ev.vector(name) : ev.reg(name);
    }
    row.registers = regs;
  }
  return row;
}

export async function persistTraceArtifact(
  sessionId: string,
  symbol: string,
  result: number,
  trace: Array<Record<string, unknown>>,
  truncated: boolean,
  error?: string,
): Promise<Record<string, unknown>> {
  const artifact = await resolveArtifactPath({
    category: 'traces',
    toolName: 'nemu_trace',
    target: symbol,
    ext: 'json',
  });
  const payload: Record<string, unknown> = {
    schema: 'jshookmcp.native-emulator.trace.v1',
    sessionId,
    symbol,
    result,
    steps: trace.length,
    truncated,
    trace,
  };
  if (error) payload.error = error;
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(artifact.absolutePath, body, 'utf8');
  return {
    category: 'traces',
    path: artifact.displayPath,
    eventCount: trace.length,
    bytes: Buffer.byteLength(body, 'utf8'),
  };
}
