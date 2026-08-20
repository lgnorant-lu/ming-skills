import type { UnifiedProcessManager } from '@server/domains/shared/modules/native';
import type { MCPServerContext } from '@server/MCPServer.context';
import { resolvePidOrAttachedRenderer } from '@server/runtime/renderer-pid';

/**
 * Resolve a target PID for the memory domain.
 *
 * When a `processManager` is available this delegates to the full resolver,
 * which validates the input as a positive integer, falls back to an attached
 * browser renderer, and throws a contextual error on invalid input.
 *
 * When no `processManager` is wired (mainly test/fixture contexts), the value
 * is still validated inline so that `undefined` / `"abc"` / `NaN` never reach
 * the native FFI layer — previously each handler had an unsafe
 * `return value as number` fallback here that could pass `NaN` straight to
 * koffi, producing cryptic FFI errors. This central fallback closes that gap.
 */
export async function resolveMemoryDomainPid(
  pid: unknown,
  processManager: UnifiedProcessManager | undefined,
  ctx?: MCPServerContext | null,
): Promise<number> {
  if (processManager) {
    return await resolvePidOrAttachedRenderer(pid, processManager, ctx);
  }
  // Fallback (no processManager): validate inline so invalid PIDs surface as a
  // clear handler-layer error rather than a native FFI crash.
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(
      `Invalid PID: ${JSON.stringify(pid)} (expected a positive integer). ` +
        'Provide an explicit pid, or attach a browser session for auto-discovery.',
    );
  }
  return numeric;
}
