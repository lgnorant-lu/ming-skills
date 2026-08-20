import { disassembleArm64 } from './arm64';
import { disassembleMips } from './mips';
import { disassembleRiscV } from './riscv';
import type { DisasmArchitecture, NormalizedDisasmArchitecture, OpcodeInput } from './types';
import { disassembleX86 } from './x86';
import { readOpcode32 } from './utils';

export const SUPPORTED_DISASSEMBLY_ARCHITECTURES: readonly DisasmArchitecture[] = [
  'arm64',
  'aarch64',
  'x86',
  'x64',
  'riscv32',
  'riscv64',
  'mips',
  'mips32',
  'mipsel',
];

export function normalizeDisasmArchitecture(
  architecture: DisasmArchitecture,
): NormalizedDisasmArchitecture {
  switch (architecture) {
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    case 'x86':
      return 'x86';
    case 'x64':
      return 'x64';
    case 'riscv32':
    case 'riscv64':
      return 'riscv';
    case 'mips':
    case 'mips32':
      return 'mips';
    case 'mipsel':
      return 'mipsel';
  }
}

export function disassembleInstruction(
  architecture: DisasmArchitecture,
  opcode: OpcodeInput,
  pc: bigint = 0n,
): string {
  switch (normalizeDisasmArchitecture(architecture)) {
    case 'arm64':
      return disassembleArm64(readOpcode32(opcode, 'little'), pc);
    case 'x86':
      return disassembleX86(opcode, pc, 'x86');
    case 'x64':
      return disassembleX86(opcode, pc, 'x64');
    case 'riscv':
      return disassembleRiscV(readOpcode32(opcode, 'little'), pc);
    case 'mips':
      return disassembleMips(readOpcode32(opcode, 'big'), pc);
    case 'mipsel':
      return disassembleMips(readOpcode32(opcode, 'little'), pc);
  }
}
