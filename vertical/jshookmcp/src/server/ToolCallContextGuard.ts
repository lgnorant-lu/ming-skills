/**
 * ToolCallContextGuard — enriches tool responses with current tab context
 * and detects repeated tool call loops.
 *
 * For context-sensitive tools (page_*, console_*, debugger_*, network_*, dom_*, etc.),
 * appends `_tabContext` metadata to responses so the LLM always knows which page
 * it is operating on, preventing silent context drift.
 *
 * Additionally, tracks consecutive identical tool calls and injects `repeatWarning`
 * when the same tool is called ≥ MAX_CONSECUTIVE_REPEATS times in a row, helping
 * break LLM degeneration loops (e.g. stealth_inject called 5× instead of page_navigate).
 */

import { logger } from '@utils/logger';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';

/** Minimal TabRegistry surface needed by the guard. */
interface TabContextProvider {
  getContextMeta(): {
    url: string | null;
    title: string | null;
    tabIndex: number | null;
    pageId: string | null;
  };
}

type ContextSensitiveToolDomain =
  | 'page'
  | 'console'
  | 'debugger'
  | 'network'
  | 'dom'
  | 'stealth'
  | 'framework'
  | 'indexeddb'
  | 'js_heap'
  | 'script'
  | 'captcha'
  | 'ai_hook'
  | 'instrumentation'
  | 'hook_preset'
  | 'ws'
  | 'sse'
  | 'fetch_stream'
  | 'webrtc'
  | 'canvas'
  | 'skia'
  | 'webgpu'
  | 'v8'
  | 'wasm'
  | 'trace'
  | 'graphql'
  | 'sourcemap'
  | 'performance'
  | 'profiler'
  | 'page_script'
  | 'grpc'
  | 'antidebug'
  | 'blackbox'
  | 'evidence';

type ContextSensitiveToolPrefix = `${ContextSensitiveToolDomain}_`;

const CONTEXT_SENSITIVE_PREFIXES = [
  'page_',
  'console_',
  'debugger_',
  'network_',
  'dom_',
  'stealth_',
  'framework_',
  'indexeddb_',
  'js_heap_',
  'script_',
  'captcha_',
  'ai_hook_',
  'instrumentation_',
  'hook_preset_',
  'ws_',
  'sse_',
  'fetch_stream_',
  'webrtc_',
  'canvas_',
  'skia_',
  'webgpu_',
  'v8_',
  'wasm_',
  'trace_',
  'graphql_',
  'sourcemap_',
  'performance_',
  'profiler_',
  'page_script_',
  'grpc_',
  'antidebug_',
  'blackbox_',
  'evidence_',
] as const satisfies readonly ContextSensitiveToolPrefix[];

const CONTEXT_SENSITIVE_TOOLS = new Set([
  'collect_code',
  'call_graph_analyze',
  'script_replace_persist',
  // Debugger tools whose historical names predate the debugger_ prefix.
  'breakpoint',
  'get_call_stack',
  'get_object_properties',
  'get_scope_variables_enhanced',
  'watch',
  // Analysis and workflow tools that resolve the collector's active page.
  'search_in_scripts',
  'extract_function_tree',
  'clear_collected_data',
  'get_collection_stats',
  'webpack_enumerate',
  'api_probe_batch',
  'js_bundle_search',
  // Coordination data is shared, but capture/restore must use the caller's tab.
  'create_task_handoff',
  'save_page_snapshot',
  'restore_page_snapshot',
  'coordination_restore_snapshot',
  // Trace lifecycle binds a recorder/CDP session to the caller's current tab.
  'start_trace_recording',
  'stop_trace_recording',
  // Encoding operations can resolve request bodies from the active page.
  'binary_detect_format',
  'binary_decode',
  'binary_encode',
  'binary_entropy_analysis',
  'protobuf_decode_raw',
  // Transform operations may resolve script IDs or functions in page context.
  'ast_transform_preview',
  'ast_transform_chain',
  'ast_transform_apply',
  'crypto_extract_standalone',
]);

/** Max consecutive identical calls before injecting a warning. */
const MAX_CONSECUTIVE_REPEATS = 3;
const MAX_REPEAT_SCOPES = 256;

/** Raw network tools exempt from context-sensitivity (no browser/UI needed). */
const NETWORK_RAW_TOOLS = new Set([
  'network_icmp_probe',
  'network_traceroute',
  'network_rtt_measure',
  'http_request_build',
  'http_plain_request',
  'http2_probe',
  'http2_frame_build',
  'dns_resolve',
  'dns_reverse',
]);

/** Meta-tools excluded from repeat detection — agents legitimately chain these. */
const REPEAT_GUARD_EXCLUDES = new Set([
  'search_tools',
  'route_tool',
  'describe_tool',
  'call_tool',
  'activate_tools',
  'deactivate_tools',
  'activate_domain',
]);

/** Suggested alternative tools per domain prefix when a repeat loop is detected. */
const DOMAIN_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ['stealth', ['page_navigate', 'page_evaluate', 'stealth_verify', 'page_screenshot']],
  ['page', ['browser_jsdom_parse', 'js_bundle_search', 'network_get_requests', 'page_screenshot']],
  ['console', ['page_evaluate', 'console_get_logs', 'page_screenshot']],
  ['network', ['network_get_requests', 'page_navigate']],
  ['captcha', ['captcha_wait', 'page_screenshot']],
  ['ai_hook', ['manage_hooks', 'page_evaluate', 'ai_hook_inject']],
  ['instrumentation', ['instrumentation_session', 'instrumentation_artifact']],
  ['evidence', ['evidence_query', 'evidence_chain']],
]);

export class ToolCallContextGuard {
  private getProvider: () => TabContextProvider | null;
  /** Memoize prefix-match results — tool names repeat heavily across calls. */
  private readonly contextSensitiveCache = new Map<string, boolean>();

  /** Repeat detection is isolated per MCP client session in shared-daemon mode. */
  private readonly repeatStates = new Map<
    string,
    { lastToolName: string | null; consecutiveCount: number }
  >();

  constructor(getProvider: () => TabContextProvider | null) {
    this.getProvider = getProvider;
  }

  private getRepeatState(): { lastToolName: string | null; consecutiveCount: number } {
    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.repeatStates.get(scope);
    if (!state) {
      if (this.repeatStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.repeatStates.keys().next().value as string | undefined;
        if (oldest) this.repeatStates.delete(oldest);
      }
      state = { lastToolName: null, consecutiveCount: 0 };
      this.repeatStates.set(scope, state);
    }
    return state;
  }

  /** Check whether a tool name belongs to a context-sensitive domain. */
  isContextSensitive(toolName: string): boolean {
    const cached = this.contextSensitiveCache.get(toolName);
    if (cached !== undefined) return cached;

    if (NETWORK_RAW_TOOLS.has(toolName)) {
      this.contextSensitiveCache.set(toolName, false);
      return false;
    }

    const result =
      CONTEXT_SENSITIVE_TOOLS.has(toolName) ||
      CONTEXT_SENSITIVE_PREFIXES.some((prefix) => toolName.startsWith(prefix));
    this.contextSensitiveCache.set(toolName, result);
    return result;
  }

  /**
   * Record a tool call for repeat detection.
   * Call this BEFORE enrichResponse for accurate tracking.
   * Returns the current consecutive count (1 = first call).
   */
  recordCall(toolName: string): number {
    if (REPEAT_GUARD_EXCLUDES.has(toolName)) {
      // Don't track meta-tools — they chain legitimately
      return 0;
    }

    const state = this.getRepeatState();
    if (toolName === state.lastToolName) {
      state.consecutiveCount++;
    } else {
      state.lastToolName = toolName;
      state.consecutiveCount = 1;
    }
    return state.consecutiveCount;
  }

  /**
   * Check if the current call is a suspected repeat loop.
   */
  isRepeatLoop(): boolean {
    return this.getRepeatState().consecutiveCount >= MAX_CONSECUTIVE_REPEATS;
  }

  /**
   * Enrich a successful tool response with `_tabContext` metadata.
   *
   * Uses string splice injection to avoid a full JSON.parse → JSON.stringify
   * round-trip on the hot path. Falls back to parse+mutate only for non-object
   * JSON payloads.
   */
  enrichResponse<T extends { content?: unknown[]; isError?: boolean }>(
    toolName: string,
    response: T,
  ): T {
    // Repeat warning injection (applies to ALL tools, not just context-sensitive)
    if (this.isRepeatLoop() && !REPEAT_GUARD_EXCLUDES.has(toolName)) {
      this.injectRepeatWarning(toolName, response);
    }

    if (!this.isContextSensitive(toolName)) return response;
    if (response.isError) return response;

    const provider = this.getProvider() as Partial<TabContextProvider> | null;
    if (!provider || typeof provider.getContextMeta !== 'function') return response;

    const meta = provider.getContextMeta();
    // Skip if no active page tracked
    if (!meta.pageId && meta.tabIndex === null) return response;

    const content = response.content;
    if (!Array.isArray(content)) return response;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string',
    );
    if (!firstText) return response;

    const raw = firstText.text;
    const trimmedStart = raw.trimStart();

    // Fast path: JSON object text — splice _tabContext without full re-serialization
    if (trimmedStart.startsWith('{') && trimmedStart.trimEnd().endsWith('}')) {
      try {
        // Validate it's actually parseable JSON (cheap compared to re-stringify)
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Guard: skip if _tabContext was already injected (prevents double-injection)
          if ('_tabContext' in parsed) return response;
          firstText.text = this.spliceTabContext(raw, meta);
          return response;
        }
      } catch {
        logger.debug(`[ContextGuard] Skipped non-JSON response enrichment for ${toolName}`);
        return response;
      }
    }

    return response;
  }

  /**
   * Inject `_tabContext` into a JSON object string by splicing before the
   * closing brace, preserving the original formatting style (compact or pretty).
   */
  private spliceTabContext(
    raw: string,
    meta: {
      url: string | null;
      title: string | null;
      tabIndex: number | null;
      pageId: string | null;
    },
  ): string {
    const tabContext = {
      url: meta.url,
      title: meta.title,
      tabIndex: meta.tabIndex,
      pageId: meta.pageId,
    };

    // Detect pretty-print: if the closing brace is on its own line, match style
    if (/\n\}\s*$/.test(raw)) {
      const prettyJson = JSON.stringify(tabContext, null, 2).replace(/\n/g, '\n  ');
      return raw.replace(/\n\}\s*$/, `,\n  "_tabContext": ${prettyJson}\n}`);
    }

    // Compact style
    const compactJson = JSON.stringify(tabContext);
    if (/^\{\s*\}\s*$/.test(raw)) {
      return raw.replace(/\{\s*\}\s*$/, `{"_tabContext":${compactJson}}`);
    }
    return raw.replace(/\}\s*$/, `,"_tabContext":${compactJson}}`);
  }

  /**
   * Inject a `repeatWarning` into the response when a tool call loop is detected.
   * Splices into JSON text content if possible, or appends a new text entry.
   */
  private injectRepeatWarning<T extends { content?: unknown[] }>(
    toolName: string,
    response: T,
  ): void {
    const consecutiveCount = this.getRepeatState().consecutiveCount;
    const prefix = toolName.split('_')[0] ?? '';
    const alternatives =
      toolName === 'page_evaluate'
        ? ['browser_jsdom_parse', 'js_bundle_search', 'network_get_requests', 'page_screenshot']
        : (DOMAIN_ALTERNATIVES.get(prefix) ?? ['page_navigate', 'page_evaluate']);
    // Filter out the repeated tool itself from suggestions
    const suggestions = alternatives.filter((t) => t !== toolName);

    const warning = {
      detected: true,
      consecutiveCount,
      message:
        `⚠ You have called "${toolName}" ${consecutiveCount} times in a row. ` +
        `This is likely a loop — consider what you actually need to do next.`,
      suggestedTools: suggestions,
      hint:
        suggestions.length > 0
          ? `Try calling ${suggestions[0]} instead.`
          : 'Re-evaluate your task objective before making another tool call.',
    };

    const content = response.content;
    if (!Array.isArray(content)) return;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string',
    );

    if (firstText) {
      const raw = firstText.text;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          parsed.repeatWarning = warning;
          firstText.text = JSON.stringify(parsed, null, 2);
          return;
        }
      } catch {
        // Not JSON — fall through to append
      }
    }

    // Fallback: append as a new content item
    content.push({
      type: 'text',
      text: JSON.stringify({ repeatWarning: warning }, null, 2),
    });
  }
}
