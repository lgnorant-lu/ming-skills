/**
 * Handler for `wasm_inspect` — pure-TS wasm binary structural inspector.
 *
 * Reads a .wasm file and returns its module surface (types/imports/functions/
 * tables/memories/globals/exports/start/elements/code/data/custom sections) as
 * structured JSON, with no external tool dependency. The wabt-independent
 * counterpart to `wasm_inspect_sections` (wasm-objdump).
 */

import { readFile } from 'node:fs/promises';
import { argStringRequired } from '@server/domains/shared/parse-args';
import { ExternalToolHandlersBase } from './external-base';
import { inspectModuleStructure } from './module-structure';

export class ModuleStructureHandlers extends ExternalToolHandlersBase {
  async handleWasmInspect(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');

    let bytes: Buffer;
    try {
      bytes = await readFile(inputPath);
    } catch (error) {
      return this.fail(
        `Failed to read wasm file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      const result = inspectModuleStructure(bytes);
      const byteSize = bytes.length;
      return this.ok({ inputPath, byteSize, ...result });
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
  }
}
