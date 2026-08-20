/**
 * Frida hook generation handlers.
 */

import { HookGenerator } from '@modules/binary-instrument';
import type { BinaryInstrumentState } from './shared';
import {
  readOptionalString,
  readStringArray,
  readHookOptions,
  isRecord,
  isGhidraAnalysisOutput,
  toHookTemplates,
  textResponse,
  jsonResponse,
} from './shared';

export class HooksGenerationHandlers {
  private state: BinaryInstrumentState;

  constructor(state: BinaryInstrumentState) {
    this.state = state;
  }

  async handleGenerateHooks(args: Record<string, unknown>): Promise<unknown> {
    const legacyGhidraOutput = readOptionalString(args, 'ghidraOutput');
    if (legacyGhidraOutput) return this.handleLegacyGenerateHooks(legacyGhidraOutput);

    const legacyGhidraOutputObj = args['ghidraOutput'];
    if (isRecord(legacyGhidraOutputObj)) {
      return this.handleLegacyGenerateHooks(JSON.stringify(legacyGhidraOutputObj));
    }

    const symbols = readStringArray(args, 'symbols');
    if (symbols.length === 0) return textResponse('symbols or ghidraOutput is required');

    const options = readHookOptions(args, 'options');
    const hookGen = this.getHookGenerator();
    const script = hookGen.generateFridaHookScript(symbols, options);
    return jsonResponse({ available: true, symbolCount: symbols.length, script });
  }

  async handleExportHookScript(args: Record<string, unknown>): Promise<unknown> {
    const rawTemplates = readOptionalString(args, 'hookTemplates');
    if (!rawTemplates) {
      const generated = this.state.hookCodeGenerator.exportScript([], 'frida');
      const script = generated.includes('Java.perform')
        ? generated
        : `Java.perform(function() {\n${generated}\n});`;
      return jsonResponse({ format: 'frida', hookCount: 0, script });
    }

    try {
      const parsed = JSON.parse(rawTemplates);
      if (!Array.isArray(parsed)) return textResponse('Invalid JSON');
      const templates = toHookTemplates(parsed);
      const script = this.state.hookCodeGenerator.exportScript(templates, 'frida');
      return jsonResponse({ format: 'frida', hookCount: templates.length, script });
    } catch {
      return textResponse('Invalid JSON');
    }
  }

  private getHookGenerator(): HookGenerator {
    if (!this.state.hookGen) this.state.hookGen = new HookGenerator();
    return this.state.hookGen;
  }

  private handleLegacyGenerateHooks(ghidraOutput: string): Promise<unknown> | unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ghidraOutput);
    } catch {
      return textResponse('Invalid JSON');
    }
    if (!isGhidraAnalysisOutput(parsed)) return textResponse('ghidraOutput is required');
    const hooks = this.state.hookCodeGenerator.generateHooks(parsed);
    return jsonResponse({ count: hooks.length, hooks });
  }
}
