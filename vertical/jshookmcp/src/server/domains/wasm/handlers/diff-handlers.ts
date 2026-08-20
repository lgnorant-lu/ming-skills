import { argBool, argString, argStringRequired } from '@server/domains/shared/parse-args';
import { WASM_TOOL_TIMEOUT_MS } from '@src/constants';
import { ExternalToolHandlersBase } from './external-base';
import { diffWatStructures, parseWatStructure } from './wat-diff';

/**
 * Patch-diff two .wasm binaries for vulnerability research ("vendor patched
 * CVE-XXXX — what changed?"). Disassembles both via wabt wasm2wat, parses the
 * WAT into a coarse structure, and emits a structured function-level diff plus
 * a per-function unified line-level diff for changed functions. Optional
 * `semantic: true` normalizes transient local names so pure renumbering does
 * not register as a change.
 */
export class DiffHandlers extends ExternalToolHandlersBase {
  async handleWasmDiff(args: Record<string, unknown>) {
    const inputPathA = argStringRequired(args, 'inputPathA');
    const inputPathB = argStringRequired(args, 'inputPathB');
    const semantic = argBool(args, 'semantic', false);
    const outputPath = argString(args, 'outputPath');

    const [resA, resB] = await Promise.all([
      this.state.runner.run({
        tool: 'wabt.wasm2wat',
        args: [inputPathA, '-o', '/dev/stdout'],
        timeoutMs: WASM_TOOL_TIMEOUT_MS,
        requireNonEmptyOutput: true,
        outputLabel: 'wasm text output (A)',
      }),
      this.state.runner.run({
        tool: 'wabt.wasm2wat',
        args: [inputPathB, '-o', '/dev/stdout'],
        timeoutMs: WASM_TOOL_TIMEOUT_MS,
        requireNonEmptyOutput: true,
        outputLabel: 'wasm text output (B)',
      }),
    ]);

    if (!resA.ok) {
      return this.fail(
        `wasm2wat failed for inputPathA: ${resA.stderr}`,
        resA.exitCode ?? undefined,
      );
    }
    if (!resB.ok) {
      return this.fail(
        `wasm2wat failed for inputPathB: ${resB.stderr}`,
        resB.exitCode ?? undefined,
      );
    }

    const structA = parseWatStructure(resA.stdout);
    const structB = parseWatStructure(resB.stdout);
    const diff = diffWatStructures(structA, structB, { semantic });

    // Full diff (every changed function's complete unified diff) is offloaded
    // to an artifact; the in-context response carries a per-function preview
    // so multi-MB diffs do not bloat the tool result.
    const artifactPath = await this.writeTextArtifact({
      outputPath,
      artifact: { category: 'wasm', toolName: 'wasm-diff', ext: 'json' },
      content: JSON.stringify(diff, null, 2),
    });

    return this.ok({
      summary: diff.summary,
      semantic,
      addedFunctions: diff.addedFunctions,
      removedFunctions: diff.removedFunctions,
      unchangedFunctions: diff.unchangedFunctions,
      importDelta: diff.importDelta,
      exportDelta: diff.exportDelta,
      changedFunctions: diff.changedFunctions.map((c) => ({
        key: c.key,
        displayName: c.displayName,
        addedLines: c.addedLines,
        removedLines: c.removedLines,
        unifiedDiffPreview: c.unifiedDiff.slice(0, 50),
      })),
      artifactPath,
      durationMs: resA.durationMs + resB.durationMs,
    });
  }
}
