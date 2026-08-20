import { writeFile } from 'node:fs/promises';
import type { TraceEvent } from '@modules/native-emulator/CpuEngine';
import { disassembleInstruction } from '@modules/native-emulator/disasm';
import { resolveArtifactPath } from '@utils/artifacts';

const VECTOR_RE = /^[vqdshb]\d{1,2}$/i;

export type TraceMode = 'full' | 'calls' | 'branches' | 'memory';

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
  const mask = insn & 0xfffffc1f;
  return mask === 0xd63f0000 || mask === 0xd61f0000;
}

/** Return memory-access details for a load/store instruction, or null. */
function memAccess(
  ev: TraceEvent,
  insn: number,
  tableReg?: number,
): Record<string, unknown> | null {
  const op0 = (insn >>> 25) & 0b1111;
  if ((op0 & 0b0101) !== 0b0100) return null; // not load/store

  // Try to read the base register and compute the effective address.
  // Load/store unsigned immediate: bits[27:25]=111, Rn at bits[9:5], offset at bits[21:10].
  // Register offset: bits[27:24]=0011 (LDR) or 0010 (STR), Rm at bits[20:16], option at bits[15:13].
  const subType = (insn >>> 24) & 0b1111; // bits[27:24] — broader than 3 bits for register-offset
  const rn = (insn >>> 5) & 0b11111;
  const isLoad = ((insn >>> 22) & 1) === 1;

  // Only capture if tableReg is set and base register matches, or if tableReg is not set
  if (tableReg !== undefined && tableReg >= 0 && rn !== tableReg) return null;

  try {
    // Unsigned immediate (LDR/STR imm): bits[27:26]=10 (op0=111, size=00), bit[24]=1 (V=1 for integer)
    if ((subType & 0b1100) === 0b1000 && ((insn >>> 24) & 1) === 1) {
      const size = (insn >>> 30) & 0b11; // 0=b, 1=h, 2=w, 3=x
      const scale = 1 << size;
      const offset = ((insn >>> 10) & 0xfff) * scale;
      const baseVal = ev.x(rn);
      const addr = Number(baseVal) + offset;
      return {
        base: `x${rn}`,
        baseValue: baseVal.toString(16),
        offset: `+0x${offset.toString(16)}`,
        addr: `0x${addr.toString(16)}`,
        load: isLoad,
      };
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
        return {
          base: `x${rn}`,
          baseValue: baseVal.toString(16),
          indexReg: `x${rm}`,
          indexValue: `0x${indexVal.toString(16)}`,
          tableIdx: effectiveIndex,
          scale,
          offset: `+${rm === 31 ? '0' : effectiveIndex + '*' + scale}`,
          addr: `0x${addr.toString(16)}`,
          load: isLoad,
        };
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
): Record<string, unknown> {
  const asmStr = disassembleInstruction('arm64', ev.insn, BigInt(ev.pc));
  const row: Record<string, unknown> = {
    step: ev.step,
    pc: `0x${ev.pc.toString(16)}`,
    insn: `0x${ev.insn.toString(16).padStart(8, '0')}`,
    asm: asmStr,
  };
  // Always capture tableReg value when set — critical for tracking
  // the x24 table pointer through bytecode execution.
  if (tableReg !== undefined && tableReg >= 0 && tableReg <= 30) {
    try {
      row['x' + tableReg] = Number(ev.x(tableReg)).toString(16);
    } catch {
      /* register read may fault */
    }
  }
  // captureBlArgs: snapshot x0-x7 (call arguments) on BL instructions
  if (captureBlArgs) {
    const isBl = asmStr.startsWith('bl ') || asmStr.startsWith('blr');
    if (isBl) {
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
