import type { MCPServerContext } from '@server/MCPServer.context';
import { TraceRecorder } from '@modules/trace/TraceRecorder';
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';

/** Initialize one mutable trace recorder per MCP session. Trace artifacts remain shareable by ID/path. */
export function ensureTraceRecorder(ctx: MCPServerContext): TraceRecorder {
  if (ctx.traceRecorder) return ctx.traceRecorder;

  if (typeof ctx.setDomainInstance !== 'function') {
    ctx.traceRecorder = new TraceRecorder();
    return ctx.traceRecorder;
  }

  const pool = new SessionScopedResourcePool(
    () => new TraceRecorder(),
    async (recorder) => {
      if (recorder.getState() === 'recording') await recorder.stop();
    },
    sessionResourcePoolOptions(ctx.config?.mcp),
  );
  ctx.setDomainInstance('sessionTraceRecorderPool', pool);
  ctx.traceRecorder = pool.getProxy();
  return ctx.traceRecorder;
}
