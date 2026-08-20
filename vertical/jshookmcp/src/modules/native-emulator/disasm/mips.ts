import type { DisasmResult } from './types';
import { formatDisasm, signExtend } from './utils';

// --- MIPS -------------------------------------------------------------------

const MIPS_REGS = [
  '$zero',
  '$at',
  '$v0',
  '$v1',
  '$a0',
  '$a1',
  '$a2',
  '$a3',
  '$t0',
  '$t1',
  '$t2',
  '$t3',
  '$t4',
  '$t5',
  '$t6',
  '$t7',
  '$s0',
  '$s1',
  '$s2',
  '$s3',
  '$s4',
  '$s5',
  '$s6',
  '$s7',
  '$t8',
  '$t9',
  '$k0',
  '$k1',
  '$gp',
  '$sp',
  '$fp',
  '$ra',
] as const;

export function disassembleMips(insn: number, pc: bigint): string {
  if (insn === 0) return formatDisasm({ mnemonic: 'nop', operands: '' });

  const opcode = (insn >>> 26) & 0x3f;
  const rs = (insn >>> 21) & 0x1f;
  const rt = (insn >>> 16) & 0x1f;
  const rd = (insn >>> 11) & 0x1f;
  const shamt = (insn >>> 6) & 0x1f;
  const funct = insn & 0x3f;
  const imm = insn & 0xffff;
  const simm = signExtend(imm, 16);

  if (opcode === 0) return formatDisasm(decodeMipsRType(rs, rt, rd, shamt, funct, insn));

  if (opcode === 0x02 || opcode === 0x03) {
    const target = ((pc + 4n) & 0xf0000000n) | (BigInt(insn & 0x03ffffff) << 2n);
    return formatDisasm({
      mnemonic: opcode === 0x03 ? 'jal' : 'j',
      operands: `0x${target.toString(16)}`,
    });
  }

  if (opcode === 0x04 || opcode === 0x05) {
    const target = pc + 4n + (BigInt(simm) << 2n);
    return formatDisasm({
      mnemonic: opcode === 0x04 ? 'beq' : 'bne',
      operands: `${mipsReg(rs)}, ${mipsReg(rt)}, 0x${target.toString(16)}`,
    });
  }

  if (opcode === 0x0f) {
    return formatDisasm({ mnemonic: 'lui', operands: `${mipsReg(rt)}, #0x${imm.toString(16)}` });
  }

  const immediateMnemonic = MIPS_IMMEDIATE[opcode];
  if (immediateMnemonic) {
    const literal =
      opcode === 0x0c || opcode === 0x0d || opcode === 0x0e ? `#0x${imm.toString(16)}` : `#${simm}`;
    return formatDisasm({
      mnemonic: immediateMnemonic,
      operands: `${mipsReg(rt)}, ${mipsReg(rs)}, ${literal}`,
    });
  }

  const memoryMnemonic = MIPS_MEMORY[opcode];
  if (memoryMnemonic) {
    return formatDisasm({
      mnemonic: memoryMnemonic,
      operands: `${mipsReg(rt)}, ${simm}(${mipsReg(rs)})`,
    });
  }

  return `<unknown>  0x${insn.toString(16).padStart(8, '0')}`;
}

function decodeMipsRType(
  rs: number,
  rt: number,
  rd: number,
  shamt: number,
  funct: number,
  insn: number,
): DisasmResult {
  if (funct === 0x08) return { mnemonic: 'jr', operands: mipsReg(rs) };
  if (funct === 0x09) return { mnemonic: 'jalr', operands: `${mipsReg(rd)}, ${mipsReg(rs)}` };
  if (funct === 0x00)
    return { mnemonic: 'sll', operands: `${mipsReg(rd)}, ${mipsReg(rt)}, #${shamt}` };
  if (funct === 0x02)
    return { mnemonic: 'srl', operands: `${mipsReg(rd)}, ${mipsReg(rt)}, #${shamt}` };
  if (funct === 0x03)
    return { mnemonic: 'sra', operands: `${mipsReg(rd)}, ${mipsReg(rt)}, #${shamt}` };

  const mnemonic = MIPS_R_TYPE[funct];
  if (mnemonic) return { mnemonic, operands: `${mipsReg(rd)}, ${mipsReg(rs)}, ${mipsReg(rt)}` };

  return { mnemonic: '<unknown>', operands: `0x${insn.toString(16).padStart(8, '0')}` };
}

const MIPS_R_TYPE: Record<number, string> = {
  0x20: 'add',
  0x21: 'addu',
  0x22: 'sub',
  0x23: 'subu',
  0x24: 'and',
  0x25: 'or',
  0x26: 'xor',
  0x27: 'nor',
  0x2a: 'slt',
  0x2b: 'sltu',
};

const MIPS_IMMEDIATE: Record<number, string> = {
  0x08: 'addi',
  0x09: 'addiu',
  0x0a: 'slti',
  0x0b: 'sltiu',
  0x0c: 'andi',
  0x0d: 'ori',
  0x0e: 'xori',
};

const MIPS_MEMORY: Record<number, string> = {
  0x20: 'lb',
  0x21: 'lh',
  0x23: 'lw',
  0x24: 'lbu',
  0x25: 'lhu',
  0x28: 'sb',
  0x29: 'sh',
  0x2b: 'sw',
};

function mipsReg(index: number): string {
  return MIPS_REGS[index] ?? `$r${index}`;
}
