/**
 * Real wasm-level block instrumentation handler for `wasm_instrument_block`.
 *
 * Pipeline: wasm2wat → instrumentWatBlocks (insert per-block-entry trace call
 * at every `block` / `loop` / `if` body entry + optional func-entry trace +
 * trace import) → wat2wasm reassemble.
 *
 * This is the basic-block-level sibling of `wasm_instrument_binary`, which
 * only instruments function entry.  Branch targets (br/br_if/br_table) are
 * covered because Wasm structured control flow resolves them to block/loop/if
 * labels — every branch destination is instrumented.
 */

import { writeFile } from 'node:fs/promises';
import { argString, argStringRequired } from '@server/domains/shared/parse-args';
import { WASM_TOOL_TIMEOUT_MS } from '@src/constants';
import { resolveArtifactPath } from '@utils/artifacts';
import { ExternalToolHandlersBase } from './external-base';
import { validateOutputPath } from './shared';
import { instrumentWatBlocks, analyzeWasmBasicBlocks } from './wat-block-instrument';

export class InstrumentBlockHandlers extends ExternalToolHandlersBase {
  async handleWasmInstrumentBlock(args: Record<string, unknown>) {
    const inputPath = argStringRequired(args, 'inputPath');
    const outputPath = argString(args, 'outputPath');

    // 1. Disassemble to WAT (stdout).
    const disasm = await this.state.runner.run({
      tool: 'wabt.wasm2wat',
      args: [inputPath, '-o', '/dev/stdout'],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
      requireNonEmptyOutput: true,
      outputLabel: 'wasm text output',
    });
    if (!disasm.ok) {
      return this.fail(`wasm2wat failed: ${disasm.stderr}`, disasm.exitCode ?? undefined);
    }

    // 2. Diagnostic: analyze basic blocks before instrumentation.
    const analysis = analyzeWasmBasicBlocks(disasm.stdout);

    // 3. Instrument WAT with block-level trace calls.
    const { instrumented, functionsInstrumented, blocksInstrumented, functionsSkipped } =
      instrumentWatBlocks(disasm.stdout);

    // 4. Persist the patched WAT (artifact, useful for inspection / re-edit).
    const watArtifact = await resolveArtifactPath({
      category: 'wasm',
      toolName: 'wasm-instrument-block',
      ext: 'wat',
    });
    await writeFile(watArtifact.absolutePath, instrumented, 'utf-8');

    // 5. Reassemble to a wasm binary via wat2wasm.
    const outTarget = outputPath
      ? { absolutePath: validateOutputPath(outputPath), displayPath: outputPath }
      : await resolveArtifactPath({
          category: 'wasm',
          toolName: 'wasm-instrument-block',
          ext: 'wasm',
        });

    const reassemble = await this.state.runner.run({
      tool: 'wabt.wat2wasm',
      args: [watArtifact.absolutePath, '-o', outTarget.absolutePath],
      timeoutMs: WASM_TOOL_TIMEOUT_MS,
      requireNonEmptyOutput: false,
      outputLabel: 'instrumented wasm',
    });
    if (!reassemble.ok) {
      return this.fail(
        `wat2wasm reassembly failed: ${reassemble.stderr}`,
        reassemble.exitCode ?? undefined,
      );
    }

    const size = await this.tryStatSize(outTarget.absolutePath);

    return this.ok({
      instrumentedPath: outTarget.displayPath,
      patchedWatPath: watArtifact.displayPath,
      functionsInstrumented,
      blocksInstrumented,
      functionsSkipped,
      analysis,
      size,
      traceFnImport: { module: '__jshook', field: 'trace_block', signature: '(param i32)' },
      honestBoundary:
        'Block/loop/if-ENTRY-level tracing. Each block/loop/if body entry (and optionally each function entry) calls the imported $__jshook_trace_block(i32.const <ordinal>); the host/runtime must supply a trace_block import at instantiation. Branch targets (br/br_if/br_table) are covered because Wasm structured control flow resolves them to block/loop/if labels. Intra-block instruction-level tracing is not provided.',
      durationMs: disasm.durationMs + reassemble.durationMs,
    });
  }
}
