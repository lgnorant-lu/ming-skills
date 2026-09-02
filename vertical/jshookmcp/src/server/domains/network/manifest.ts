import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { advancedTools } from '@server/domains/network/definitions';
import type { AdvancedToolHandlers } from '@server/domains/network/index';
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';

const DOMAIN = 'network' as const;
const DEP_KEY = 'advancedHandlers' as const;
type H = AdvancedToolHandlers;
const t = toolLookup(advancedTools);
const registrations = defineMethodRegistrations<H, (typeof advancedTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'network_enable', method: 'handleNetworkEnable' },
    { tool: 'network_disable', method: 'handleNetworkDisable' },
    { tool: 'network_get_status', method: 'handleNetworkGetStatus' },
    { tool: 'network_monitor', method: 'handleNetworkMonitor' },
    { tool: 'network_get_requests', method: 'handleNetworkGetRequests' },
    { tool: 'network_get_response_body', method: 'handleNetworkGetResponseBody' },
    { tool: 'network_get_stats', method: 'handleNetworkGetStats' },
    { tool: 'performance_get_metrics', method: 'handlePerformanceGetMetrics' },
    { tool: 'performance_trace', method: 'handlePerformanceTraceDispatch' },
    { tool: 'profiler_cpu', method: 'handleProfilerCpuDispatch' },
    { tool: 'console_get_exceptions', method: 'handleConsoleGetExceptions' },
    { tool: 'console_inject', method: 'handleConsoleInjectDispatch' },
    {
      tool: 'console_inject_fetch_interceptor',
      method: 'handleConsoleInjectFetchInterceptor',
    },
    {
      tool: 'console_inject_xhr_interceptor',
      method: 'handleConsoleInjectXhrInterceptor',
    },
    { tool: 'console_buffers', method: 'handleConsoleBuffersDispatch' },
    { tool: 'http_request_build', method: 'handleHttpRequestBuild' },
    { tool: 'http_plain_request', method: 'handleHttpPlainRequest' },
    { tool: 'http2_probe', method: 'handleHttp2Probe' },
    { tool: 'http2_frame_build', method: 'handleHttp2FrameBuild' },
    { tool: 'http2_frame_parse', method: 'handleHttp2FrameParse' },
    { tool: 'network_http2_fingerprint', method: 'handleNetworkHttp2Fingerprint' },
    { tool: 'grpc_frame_parse', method: 'handleGrpcFrameParse' },
    { tool: 'grpc_frame_build', method: 'handleGrpcFrameBuild' },
    { tool: 'network_rtt_measure', method: 'handleNetworkRttMeasure' },
    { tool: 'network_latency_stats', method: 'handleNetworkLatencyStats' },
    { tool: 'network_traceroute', method: 'handleNetworkTraceroute' },
    { tool: 'network_icmp_probe', method: 'handleNetworkIcmpProbe' },
    { tool: 'dns_resolve', method: 'handleDnsResolve' },
    { tool: 'dns_reverse', method: 'handleDnsReverse' },
    { tool: 'dns_probe', method: 'handleDnsProbe' },
    { tool: 'dns_cname_chain', method: 'handleDnsCnameChain' },
    { tool: 'dns_bulk_resolve', method: 'handleDnsBulkResolve' },
    { tool: 'network_extract_auth', method: 'handleNetworkExtractAuth' },
    { tool: 'network_export_har', method: 'handleNetworkExportHar' },
    { tool: 'network_replay_request', method: 'handleNetworkReplayRequest' },
    { tool: 'network_intercept', method: 'handleNetworkInterceptDispatch' },
    { tool: 'network_tls_fingerprint', method: 'handleNetworkTlsFingerprint' },
    { tool: 'network_bot_detect_analyze', method: 'handleNetworkBotDetectAnalyze' },
  ],
});

// Tools that can operate without a browser. Everything else requires ensureBrowserCore.
const RAW_NETWORK_TOOLS = new Set([
  'http_request_build',
  'http_plain_request',
  'http2_probe',
  'http2_frame_build',
  'http2_frame_parse',
  'network_http2_fingerprint',
  'grpc_frame_parse',
  'grpc_frame_build',
  'network_rtt_measure',
  'network_latency_stats',
  'network_traceroute',
  'network_icmp_probe',
  'dns_resolve',
  'dns_reverse',
  'dns_probe',
  'dns_cname_chain',
  'dns_bulk_resolve',
]);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { AdvancedToolHandlers } = await import('@server/domains/network/index');

  // Skip browser-core initialization if only raw tools are being activated
  const needsBrowser =
    !(ctx.activatedToolNames instanceof Set) ||
    [...ctx.activatedToolNames].some((name) => !RAW_NETWORK_TOOLS.has(name));

  if (needsBrowser) {
    const { ensureBrowserCore } = await import('@server/registry/ensure-browser-core');
    await ensureBrowserCore(ctx);
  }

  if (!ctx.advancedHandlers) {
    const createHandlers = () =>
      new AdvancedToolHandlers(ctx.collector!, ctx.consoleMonitor!, ctx.eventBus);
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        createHandlers,
        async (handlers) => await handlers.close(),
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionAdvancedHandlersPool', pool);
      ctx.advancedHandlers = pool.getProxy();
    } else {
      ctx.advancedHandlers = createHandlers();
    }
  }

  return ctx.advancedHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  // ── Routing metadata (consumed by ToolRouter) ──

  workflowRule: {
    patterns: [
      /(capture|intercept|monitor|hook).*(network|request|response|api|traffic)/i,
      /(抓包|拦截|监控|hook).*(网络|请求|响应|api|流量)/i,
    ],
    priority: 100,
    // Only list tools owned by this domain. workflow-domain tools
    // (run_extension_workflow / list_extension_workflows) belong to the
    // workflow manifest; routing them here caused an ownership conflict
    // because both manifests claimed the same names.
    tools: ['network_monitor', 'page_navigate', 'network_get_requests'],
    hint:
      'Network capture workflow: bootstrap browser/page state ->' +
      ' enable capture -> navigate or act -> inspect captured requests.' +
      ' (Tip: list_extension_workflows can suggest higher-level recipes.)',
  },

  prerequisites: {
    network_get_requests: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
    network_get_response_body: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
    network_extract_auth: [
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
  },

  registrations,
};

export default manifest;
