import { formatDisasm, signExtend } from './utils';

// --- RISC-V -----------------------------------------------------------------

const RISCV_REGS = Array.from({ length: 32 }, (_, index) => `x${index}`);

export function disassembleRiscV(insn: number, pc: bigint): string {
  if (insn === 0x00000013) return formatDisasm({ mnemonic: 'nop', operands: '' });
  if (insn === 0x00008067) return formatDisasm({ mnemonic: 'ret', operands: '' });

  const opcode = insn & 0x7f;
  const rd = (insn >> 7) & 0x1f;
  const funct3 = (insn >> 12) & 0x7;
  const rs1 = (insn >> 15) & 0x1f;
  const rs2 = (insn >> 20) & 0x1f;
  const funct7 = (insn >> 25) & 0x7f;

  if (opcode === 0x13) {
    const imm = signExtend(insn >>> 20, 12);
    const mnemonic = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi'][funct3];
    if (funct3 === 0x5 && funct7 === 0x20) {
      return formatDisasm({
        mnemonic: 'srai',
        operands: `${rvReg(rd)}, ${rvReg(rs1)}, #${(insn >> 20) & 0x1f}`,
      });
    }
    if (mnemonic)
      return formatDisasm({ mnemonic, operands: `${rvReg(rd)}, ${rvReg(rs1)}, #${imm}` });
  }

  if (opcode === 0x33) {
    const key = `${funct7}:${funct3}`;
    const mnemonic = RISCV_R_TYPE[key];
    if (mnemonic)
      return formatDisasm({ mnemonic, operands: `${rvReg(rd)}, ${rvReg(rs1)}, ${rvReg(rs2)}` });
  }

  if (opcode === 0x03) {
    const imm = signExtend(insn >>> 20, 12);
    const mnemonic = ['lb', 'lh', 'lw', 'ld', 'lbu', 'lhu', 'lwu'][funct3];
    if (mnemonic)
      return formatDisasm({ mnemonic, operands: `${rvReg(rd)}, ${imm}(${rvReg(rs1)})` });
  }

  if (opcode === 0x23) {
    const imm = signExtend(((insn >> 7) & 0x1f) | (((insn >> 25) & 0x7f) << 5), 12);
    const mnemonic = ['sb', 'sh', 'sw', 'sd'][funct3];
    if (mnemonic)
      return formatDisasm({ mnemonic, operands: `${rvReg(rs2)}, ${imm}(${rvReg(rs1)})` });
  }

  if (opcode === 0x63) {
    const imm = signExtend(
      ((insn >> 7) & 0x1e) |
        ((insn >> 20) & 0x7e0) |
        ((insn << 4) & 0x800) |
        ((insn >> 19) & 0x1000),
      13,
    );
    const mnemonic = ['beq', 'bne', undefined, undefined, 'blt', 'bge', 'bltu', 'bgeu'][funct3];
    if (mnemonic) {
      return formatDisasm({
        mnemonic,
        operands: `${rvReg(rs1)}, ${rvReg(rs2)}, 0x${(pc + BigInt(imm)).toString(16)}`,
      });
    }
  }

  if (opcode === 0x6f) {
    const imm = signExtend(
      (((insn >> 21) & 0x3ff) << 1) |
        (((insn >> 20) & 0x1) << 11) |
        (((insn >> 12) & 0xff) << 12) |
        (((insn >> 31) & 0x1) << 20),
      21,
    );
    return formatDisasm({
      mnemonic: 'jal',
      operands: `${rvReg(rd)}, 0x${(pc + BigInt(imm)).toString(16)}`,
    });
  }

  if (opcode === 0x67) {
    const imm = signExtend(insn >>> 20, 12);
    return formatDisasm({ mnemonic: 'jalr', operands: `${rvReg(rd)}, ${imm}(${rvReg(rs1)})` });
  }

  if (opcode === 0x37)
    return formatDisasm({
      mnemonic: 'lui',
      operands: `${rvReg(rd)}, #0x${(insn & 0xfffff000).toString(16)}`,
    });
  if (opcode === 0x17)
    return formatDisasm({
      mnemonic: 'auipc',
      operands: `${rvReg(rd)}, #0x${(insn & 0xfffff000).toString(16)}`,
    });

  return `<unknown>  0x${insn.toString(16).padStart(8, '0')}`;
}

const RISCV_R_TYPE: Record<string, string> = {
  '0:0': 'add',
  '32:0': 'sub',
  '0:1': 'sll',
  '0:2': 'slt',
  '0:3': 'sltu',
  '0:4': 'xor',
  '0:5': 'srl',
  '32:5': 'sra',
  '0:6': 'or',
  '0:7': 'and',
};

function rvReg(index: number): string {
  return RISCV_REGS[index] ?? `x${index}`;
}
