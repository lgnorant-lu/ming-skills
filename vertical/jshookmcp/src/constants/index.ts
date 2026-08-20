/**
 * Centralized runtime-tunable constants.
 *
 * Every value can be overridden via the corresponding env var (loaded from
 * `.env` by `dotenv` at startup).  Modules import from here instead of
 * hard-coding magic numbers.
 *
 * Modular structure (Option A: prefix-based split):
 *   - helpers.ts: int(), float(), bool(), str(), csv(), autoInt(), cpuCount()
 *   - server.ts: SHUTDOWN_*, RUNTIME_*, DEBUG_*, MCP_*, TOKEN_*, ACTIVATION_*
 *   - search.ts: SEARCH_*, PREDICTIVE_*, RERANK_*
 *   - memory.ts: MEMORY_*, SCAN_*, POINTER_*, STRUCT_*, HEAP_*
 *   - adb.ts: ADB_*, APK_*
 *   - dart.ts: DART_*
 *   - workflow.ts: WORKFLOW_*
 *   - browser.ts: BROWSER_*, PAGE_*, DOM_*, SCRIPTS_*
 *   - network.ts: NETWORK_*, ICMP_*, PROTO_*, BOT_*, FETCH_*
 *   - captcha.ts: CAPTCHA_*
 *   - sandbox.ts: SANDBOX_*, JSVMP_*, SYMBOLIC_*, PACKER_*
 *   - external-tools.ts: EXTERNAL_*, FRIDA_*, GHIDRA_*, UNIDBG_*, NATIVE_*, MOJO_*, V8_*, SYSCALL_*, NEMU_*, BINARY_*
 *   - transform.ts: TRANSFORM_*, EMULATOR_*, ADV_DEOBF_*, VM_DEOBF_*, DEOBF_*, CRYPTO_DETECT_*
 *   - analysis.ts: GRAPHQL_*, WASM_*, ANALYSIS_*, MINIAPP_*, DEBUGGER_*, WATCH_*, PROCESS_*, WIN_*, SOURCEMAP_*
 *   - streaming.ts: WS_*, SSE_*
 *   - proxy.ts: PROXY_*
 *   - coordination.ts: ORCHESTRATOR_*, WEBHOOK_*, MACRO_*, COORDINATION_*
 *
 * All existing imports from '@src/constants' remain valid (backward compatibility).
 */

// Re-export helpers
export * from './helpers.js';

// Re-export domain constants
export * from './server.js';
export * from './search.js';
export * from './memory.js';
export * from './adb.js';
export * from './dart.js';
export * from './workflow.js';
export * from './browser.js';
export * from './network.js';
export * from './captcha.js';
export * from './sandbox.js';
export * from './external-tools.js';
export * from './transform.js';
export * from './analysis.js';
export * from './streaming.js';
export * from './proxy.js';
export * from './coordination.js';
export * from './mojo.js';
export * from './boringssl.js';
export * from './process.js';
export * from './syscall-hook.js';
