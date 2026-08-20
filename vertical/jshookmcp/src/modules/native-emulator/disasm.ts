/** Public facade for lightweight instruction disassembly used by trace output. */
export { disassembleArm64 } from './disasm/arm64';
export {
  disassembleInstruction,
  normalizeDisasmArchitecture,
  SUPPORTED_DISASSEMBLY_ARCHITECTURES,
} from './disasm/registry';
export type {
  DisasmArchitecture,
  DisasmResult,
  NormalizedDisasmArchitecture,
  OpcodeInput,
} from './disasm/types';
