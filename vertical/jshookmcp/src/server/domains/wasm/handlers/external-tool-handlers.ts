import type { WasmSharedState } from './shared';
import { ExternalAnalysisHandlers } from './external-analysis-handlers';
import { ExternalConversionHandlers } from './external-conversion-handlers';
import { ExternalRuntimeHandlers } from './external-runtime-handlers';
import { StringExtractHandlers } from './string-extract-handlers';
import { DiffHandlers } from './diff-handlers';
import { InstrumentBinaryHandlers } from './instrument-binary-handlers';
import { InstrumentBlockHandlers } from './instrument-block-handlers';
import { ModuleStructureHandlers } from './module-structure-handlers';

export class ExternalToolHandlers {
  private readonly conversion: ExternalConversionHandlers;
  private readonly runtime: ExternalRuntimeHandlers;
  private readonly analysis: ExternalAnalysisHandlers;
  private readonly stringExtract: StringExtractHandlers;
  private readonly diff: DiffHandlers;
  private readonly instrumentBinary: InstrumentBinaryHandlers;
  private readonly instrumentBlock: InstrumentBlockHandlers;
  private readonly moduleStructure: ModuleStructureHandlers;

  constructor(state: WasmSharedState) {
    this.conversion = new ExternalConversionHandlers(state);
    this.runtime = new ExternalRuntimeHandlers(state);
    this.analysis = new ExternalAnalysisHandlers(state);
    this.stringExtract = new StringExtractHandlers(state);
    this.diff = new DiffHandlers(state);
    this.instrumentBinary = new InstrumentBinaryHandlers(state);
    this.instrumentBlock = new InstrumentBlockHandlers(state);
    this.moduleStructure = new ModuleStructureHandlers(state);
  }

  handleWasmDisassemble(args: Record<string, unknown>) {
    return this.conversion.handleWasmDisassemble(args);
  }

  handleWasmDecompile(args: Record<string, unknown>) {
    return this.conversion.handleWasmDecompile(args);
  }

  handleWasmInspectSections(args: Record<string, unknown>) {
    return this.conversion.handleWasmInspectSections(args);
  }

  handleWasmOfflineRun(args: Record<string, unknown>) {
    return this.runtime.handleWasmOfflineRun(args);
  }

  handleWasmOptimize(args: Record<string, unknown>) {
    return this.runtime.handleWasmOptimize(args);
  }

  handleWasmToC(args: Record<string, unknown>) {
    return this.conversion.handleWasmToC(args);
  }

  handleWasmDetectObfuscation(args: Record<string, unknown>) {
    return this.analysis.handleWasmDetectObfuscation(args);
  }

  handleWasmInstrumentTrace(args: Record<string, unknown>) {
    return this.analysis.handleWasmInstrumentTrace(args);
  }

  handleWasmStringExtract(args: Record<string, unknown>) {
    return this.stringExtract.handleWasmStringExtract(args);
  }

  handleWasmDiff(args: Record<string, unknown>) {
    return this.diff.handleWasmDiff(args);
  }

  handleWasmInstrumentBinary(args: Record<string, unknown>) {
    return this.instrumentBinary.handleWasmInstrumentBinary(args);
  }

  handleWasmInstrumentBlock(args: Record<string, unknown>) {
    return this.instrumentBlock.handleWasmInstrumentBlock(args);
  }

  handleWasmInspect(args: Record<string, unknown>) {
    return this.moduleStructure.handleWasmInspect(args);
  }
}
