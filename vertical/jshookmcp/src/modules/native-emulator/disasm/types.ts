export interface DisasmResult {
  mnemonic: string;
  operands: string;
}

export type DisasmArchitecture =
  | 'arm64'
  | 'aarch64'
  | 'x86'
  | 'x64'
  | 'riscv32'
  | 'riscv64'
  | 'mips'
  | 'mips32'
  | 'mipsel';

export type NormalizedDisasmArchitecture = 'arm64' | 'x86' | 'x64' | 'riscv' | 'mips' | 'mipsel';
export type OpcodeInput = number | Uint8Array | readonly number[];
