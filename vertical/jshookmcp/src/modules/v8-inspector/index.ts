export { HeapSnapshotParser } from '@modules/v8-inspector/HeapSnapshotParser';
export { BytecodeExtractor } from '@modules/v8-inspector/BytecodeExtractor';
export { JITInspector } from '@modules/v8-inspector/JITInspector';
export { V8InspectorClient } from '@modules/v8-inspector/V8InspectorClient';
export { VersionDetector } from '@modules/v8-inspector/VersionDetector';
export { DominatorTreeBuilder } from '@modules/v8-inspector/DominatorTreeBuilder';
export {
  collectTurboFanIRIsolated,
  collectTurboFanIRFromDir,
} from '@modules/v8-inspector/TurboFanTraceCollector';
export { parseTurboFanJSON } from '@modules/v8-inspector/TurboFanGraphParser';
export {
  printNativeIgnitionBytecode,
  type NativeSourceContext,
  type IsolatedNativeBytecodeAttempt,
} from '@modules/v8-inspector/NativeBytecodePrinter';
export {
  inspectWasmGc,
  discoverWasmScripts,
  type WasmScript,
  type WasmGcModule,
  type WasmStructInfo,
  type WasmGcInspectionResult,
} from '@modules/v8-inspector/WasmGcInspector';
export type { JITInfo } from '@modules/v8-inspector/JITInspector';
export type { V8Version } from '@modules/v8-inspector/VersionDetector';
export type { DominatorNode, LeakCandidate } from '@modules/v8-inspector/DominatorTreeBuilder';
export type {
  TurboFanIRGraph,
  TurboFanNode,
  TurboFanEdge,
  TurboFanGraphPhase,
  ParsedTurboFanResult,
} from '@modules/v8-inspector/TurboFanGraphParser';
