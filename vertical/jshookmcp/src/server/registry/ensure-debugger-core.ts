import type { MCPServerContext } from '@server/MCPServer.context';
import { DebuggerManager } from '@modules/debugger/DebuggerManager';
import { RuntimeInspector } from '@modules/debugger/RuntimeInspector';
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';
import { ensureBrowserCore } from '@server/registry/ensure-browser-core';

/** Initialize page-bound debugger state as one CDP stack per MCP session. */
export async function ensureDebuggerCore(ctx: MCPServerContext): Promise<void> {
  await ensureBrowserCore(ctx);

  if (!ctx.debuggerManager) {
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        () => new DebuggerManager(ctx.collector!),
        async (manager) => await manager.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionDebuggerManagerPool', pool);
      ctx.debuggerManager = pool.getProxy();
    } else {
      ctx.debuggerManager = new DebuggerManager(ctx.collector!);
    }
  }

  if (!ctx.runtimeInspector) {
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        () => new RuntimeInspector(ctx.collector!, ctx.debuggerManager!),
        async (inspector) => await inspector.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionRuntimeInspectorPool', pool);
      ctx.runtimeInspector = pool.getProxy();
    } else {
      ctx.runtimeInspector = new RuntimeInspector(ctx.collector!, ctx.debuggerManager);
    }
  }
}
