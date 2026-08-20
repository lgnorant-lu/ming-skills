import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { debuggerTools } from '@server/domains/debugger/definitions';
import { antidebugTools } from '@server/domains/debugger/antidebug/definitions';
import type { DebuggerToolHandlers } from '@server/domains/debugger/index';
import type { AntiDebugToolHandlers } from '@server/domains/debugger/antidebug/index';
import { ensureDebuggerCore } from '@server/registry/ensure-debugger-core';

const DOMAIN = 'debugger' as const;
const DEP_KEY = 'debuggerHandlers' as const;
const SECONDARY_DEP_KEYS = ['antidebugHandlers'] as const;
type H = DebuggerToolHandlers;
const t = toolLookup(debuggerTools);
const at = toolLookup(antidebugTools);
const registrations = [
  ...defineMethodRegistrations<H, (typeof debuggerTools)[number]['name']>({
    domain: DOMAIN,
    depKey: DEP_KEY,
    lookup: t,
    entries: [
      { tool: 'debugger_lifecycle', method: 'handleDebuggerLifecycle' },
      { tool: 'debugger_pause', method: 'handleDebuggerPause' },
      { tool: 'debugger_resume', method: 'handleDebuggerResume' },
      { tool: 'debugger_run_to_location', method: 'handleDebuggerRunToLocation' },
      { tool: 'debugger_step', method: 'handleDebuggerStep' },
      { tool: 'breakpoint', method: 'handleBreakpoint' },
      { tool: 'get_call_stack', method: 'handleGetCallStack' },
      { tool: 'debugger_disassemble', method: 'handleDebuggerDisassemble' },
      { tool: 'debugger_evaluate', method: 'handleDebuggerEvaluateDispatch' },
      { tool: 'debugger_wait_for_paused', method: 'handleDebuggerWaitForPaused' },
      { tool: 'debugger_capture_hit', method: 'handleDebuggerCaptureHit' },
      { tool: 'debugger_get_paused_state', method: 'handleDebuggerGetPausedState' },
      { tool: 'get_object_properties', method: 'handleGetObjectProperties' },
      { tool: 'get_scope_variables_enhanced', method: 'handleGetScopeVariablesEnhanced' },
      { tool: 'debugger_session', method: 'handleDebuggerSession' },
      { tool: 'watch', method: 'handleWatch' },
      { tool: 'blackbox_add', method: 'handleBlackboxAdd' },
      { tool: 'blackbox_add_common', method: 'handleBlackboxAddCommon' },
      { tool: 'blackbox_list', method: 'handleBlackboxList' },
    ],
  }),
  ...defineMethodRegistrations<AntiDebugToolHandlers, (typeof antidebugTools)[number]['name']>({
    domain: DOMAIN,
    depKey: 'antidebugHandlers',
    lookup: at,
    entries: [
      { tool: 'antidebug_bypass', method: 'handleAntidebugBypass', profiles: ['full'] },
      {
        tool: 'antidebug_detect_protections',
        method: 'handleAntiDebugDetectProtections',
        profiles: ['full'],
      },
    ],
  }),
];

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { DebuggerToolHandlers } = await import('@server/domains/debugger/index');
  await ensureDebuggerCore(ctx);
  if (!ctx.debuggerHandlers) {
    const pageController = ctx.pageController;
    ctx.debuggerHandlers = new DebuggerToolHandlers(
      ctx.debuggerManager!,
      ctx.runtimeInspector!,
      ctx.eventBus,
      pageController ? async () => pageController.getPage() : undefined,
    );
  }

  // Secondary: antidebugHandlers
  if (!ctx.antidebugHandlers) {
    const { AntiDebugToolHandlers } = await import('@server/domains/debugger/antidebug/index');
    ctx.antidebugHandlers = new AntiDebugToolHandlers(ctx.collector!);
  }

  return ctx.debuggerHandlers!;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: SECONDARY_DEP_KEYS,
  profiles: ['workflow', 'full'],
  ensure,

  prerequisites: {
    debugger_lifecycle: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    breakpoint: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_lifecycle(enable) first',
      },
    ],
    debugger_run_to_location: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_lifecycle(enable) first',
      },
    ],
    debugger_disassemble: [
      {
        condition: 'Browser must be launched and debugger enabled',
        fix: 'Call browser_launch and debugger_lifecycle(enable); pause at a breakpoint or pass scriptId',
      },
    ],
  },

  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
