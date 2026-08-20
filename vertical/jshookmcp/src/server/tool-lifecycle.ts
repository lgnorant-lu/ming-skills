/**
 * Shared tool lifecycle helpers — single source of truth for activation /
 * deactivation sequences that were previously copy-pasted across 5 files.
 *
 * Centralising the core deactivation logic eliminates drift: a bug fixed in
 * one copy no longer silently persists in the other four.
 */

import { logger } from '@utils/logger';

/** Minimum surface needed by the deactivation helpers. */
export interface ToolDeactivationDeps {
  activatedToolNames: Set<string>;
  activatedRegisteredTools: Map<string, { remove(): void }>;
  router: { removeHandler(name: string): void };
  extensionToolsByName?: Map<string, { registeredTool?: unknown }>;
}

/**
 * Core tool deactivation sequence shared by MCPServer,
 * MCPServer.activation.ttl, MCPServer.search.handlers.activate,
 * ExtensionManager.tools, and DynamicToolRegistry.
 *
 * Callers are responsible for:
 * - Pre-flight guards (circuit breaker, activation check)
 * - Extension-tool special handling (if any)
 * - sendToolListChanged() notification after deactivation
 */
export function deactivateToolCore(name: string, deps: ToolDeactivationDeps): void {
  // 1. Unregister the MCP tool
  const registeredTool = deps.activatedRegisteredTools.get(name);
  if (registeredTool) {
    try {
      registeredTool.remove();
    } catch (e) {
      logger.warn(`Failed to remove tool "${name}" during deactivation:`, e);
    }
  }

  // 2. Clean up handler and tracking state
  deps.router.removeHandler(name);
  deps.activatedToolNames.delete(name);
  deps.activatedRegisteredTools.delete(name);

  // 3. Clear extension tool registration state (if applicable)
  const extRecord = deps.extensionToolsByName?.get(name);
  if (extRecord) {
    extRecord.registeredTool = undefined;
  }
}
