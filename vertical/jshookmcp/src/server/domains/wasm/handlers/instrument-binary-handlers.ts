/**
 * Real wasm-level binary instrumentation handler for `wasm_instrument_binary`.
 *
 * Pipeline: wasm2wat → instrumentWat (insert per-function entry-trace call +
 * trace import) → wat2wasm reassemble. This rewrites the module's code section
 * so every function entry is observable, in contrast to `wasm_instrument_trace`
 * which only proxies JS-visible exports.
 */

import { writeFile } from 'node:fs/promises';
import { argString, argStringRequired } from '@server/domains/shared/parse-args';
import { WASM_TOOL_TIMEOUT_MS } from '@src/constants';
import { resolveArtifactPath } from '@utils/artifacts';
import { ExternalToolHandlersBase } from './external-base';
import { validateOutputPath } from './shared';
import { instrumentWat } from './wat-instrument';

export class InstrumentBinaryHandlers extends ExternalToolHandlersBase {
  async handleWasmInstrumentBinary(args: Record<string, unknown>) {
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

    // 2. Instrument WAT with per-function entry-trace calls + trace import.
    const { instrumented, functionsInstrumented, functionsSkipped } = instrumentWat(disasm.stdout);

    // 3. Persist the patched WAT (artifact, useful for inspection / re-edit).
    const watArtifact = await resolveArtifactPath({
      category: 'wasm',
      toolName: 'wasm-instrument-binary',
      ext: 'wat',
    });
    await writeFile(watArtifact.absolutePath, instrumented, 'utf-8');

    // 4. Reassemble to a wasm binary via wat2wasm.
    const outTarget = outputPath
      ? { absolutePath: validateOutputPath(outputPath), displayPath: outputPath }
      : await resolveArtifactPath({
          category: 'wasm',
          toolName: 'wasm-instrument-binary',
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
      functionsSkipped,
      size,
      traceFnImport: { module: '__jshook', field: 'trace_fn', signature: '(param i32)' },
      honestBoundary:
        'Function-ENTRY-level tracing only (not basic-block). Each instrumented function calls the imported $__jshook_trace_fn(i32.const <ordinal>) on entry; the host/runtime must supply a trace_fn import at instantiation. Indirect/branch internal dispatch is still not observed per-block. This is real wasm-level instrumentation (code section rewritten + reassembled via wat2wasm), unlike wasm_instrument_trace which only proxies JS-visible exports.',
      durationMs: disasm.durationMs + reassemble.durationMs,
    });
  }
}
