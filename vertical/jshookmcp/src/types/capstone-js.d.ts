/**
 * Type declarations for @alexaltea/capstone-js
 *
 * This module is a WASM-based disassembly framework.
 * It provides a Capstone instance with disassembly methods.
 */

declare module '@alexaltea/capstone-js' {
  interface CapstoneInstruction {
    address: bigint;
    mnemonic: string;
    op_str: string;
    bytes: Uint8Array;
  }

  interface CapstoneInstance {
    // Architecture constants
    readonly ARCH_X86: number;
    readonly ARCH_ARM: number;
    readonly ARCH_ARM64: number;
    readonly ARCH_MIPS: number;
    readonly ARCH_PPC: number;
    readonly ARCH_SPARC: number;

    // Mode constants
    readonly MODE_32: number;
    readonly MODE_64: number;
    readonly MODE_ARM: number;
    readonly MODE_THUMB: number;
    readonly MODE_BIG_ENDIAN: number;
    readonly MODE_LITTLE_ENDIAN: number;

    // Capstone constructor
    Capstone: new (
      arch: number,
      mode: number,
    ) => {
      disasm(code: Uint8Array, address: bigint, count?: number): CapstoneInstruction[];
      close(): void;
    };

    disasm(code: Uint8Array, address: bigint, count?: number): CapstoneInstruction[];
    close(): void;
  }

  function MCapstone(): Promise<CapstoneInstance>;

  export default MCapstone;
}
