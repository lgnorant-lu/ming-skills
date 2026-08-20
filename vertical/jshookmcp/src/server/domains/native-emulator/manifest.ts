import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { nativeEmulatorTools } from './definitions';
import type { NativeEmulatorHandlers } from './handlers';

const DOMAIN = 'native-emulator' as const;
const DEP_KEY = 'nativeEmulatorHandlers' as const;
type H = NativeEmulatorHandlers;
const toolByName = toolLookup(nativeEmulatorTools);
const registrations = defineMethodRegistrations<H, (typeof nativeEmulatorTools)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: toolByName,
  entries: [
    { tool: 'nemu_capabilities', method: 'handleCapabilities' },
    { tool: 'nemu_create_session', method: 'handleCreateSession' },
    { tool: 'nemu_destroy_session', method: 'handleDestroySession' },
    { tool: 'nemu_list_sessions', method: 'handleListSessions' },
    { tool: 'nemu_session_info', method: 'handleSessionInfo' },
    { tool: 'nemu_load_library', method: 'handleLoadLibrary' },
    { tool: 'nemu_load_library_chain', method: 'handleLoadLibraryChain' },
    { tool: 'nemu_inspect_imports', method: 'handleInspectImports' },
    { tool: 'nemu_dump_got', method: 'handleDumpGot' },
    { tool: 'nemu_extract_apk_libs', method: 'handleExtractApkLibs' },
    { tool: 'nemu_load_apk_library', method: 'handleLoadApkLibrary' },
    { tool: 'nemu_list_symbols', method: 'handleListSymbols' },
    { tool: 'nemu_call_symbol', method: 'handleCallSymbol' },
    { tool: 'nemu_call_jni_export', method: 'handleCallJniExport' },
    { tool: 'nemu_call_address', method: 'handleCallAddress' },
    { tool: 'nemu_setup_java_mock', method: 'handleSetupJavaMock' },
    { tool: 'nemu_setup_java_field', method: 'handleSetupJavaField' },
    { tool: 'nemu_setup_java_mocks', method: 'handleSetupJavaMocks' },
    { tool: 'nemu_new_byte_array', method: 'handleNewByteArray' },
    { tool: 'nemu_read_byte_array', method: 'handleReadByteArray' },
    { tool: 'nemu_create_jni_handle', method: 'handleCreateJniHandle' },
    { tool: 'nemu_trace', method: 'handleTrace' },
    { tool: 'nemu_set_pac_key', method: 'handleSetPacKey' },
    { tool: 'nemu_disassemble', method: 'handleDisassemble' },
    { tool: 'nemu_alloc_memory', method: 'handleAllocMemory' },
    { tool: 'nemu_read_memory', method: 'handleReadMemory' },
    { tool: 'nemu_write_memory', method: 'handleWriteMemory' },
    { tool: 'nemu_write_regions', method: 'handleWriteRegions' },
    { tool: 'nemu_prepare_tls', method: 'handlePrepareTls' },
    { tool: 'nemu_session_load', method: 'handleSessionLoad' },
    { tool: 'nemu_bind_host_fn', method: 'handleBindHostFn' },
    { tool: 'nemu_bind_all_imports', method: 'handleBindAllImports' },
    { tool: 'nemu_mem_shadow', method: 'handleMemShadow' },
    { tool: 'nemu_create_vtable', method: 'handleCreateVtable' },
    { tool: 'nemu_set_vtable_slot', method: 'handleSetVtableSlot' },
    { tool: 'nemu_set_registers', method: 'handleSetRegisters' },
    // JNI diagnostics
    { tool: 'nemu_jni_diag', method: 'handleJniDiag' },
    { tool: 'nemu_jni_handles', method: 'handleJniHandles' },
    { tool: 'nemu_get_jni_stub', method: 'handleGetJniStub' },
    // Code discovery
    { tool: 'nemu_dlsym_diag', method: 'handleDlsymDiag' },
    // VM state bridge
    { tool: 'nemu_vm_state_dump', method: 'handleVmStateDump' },
    { tool: 'nemu_vm_state_load', method: 'handleVmStateLoad' },
    { tool: 'nemu_vm_state_compare', method: 'handleVmStateCompare' },
    // Memory management
    { tool: 'nemu_mem_map', method: 'handleMemMap' },
    // Bytecode analysis
    { tool: 'nemu_bytecode_decode', method: 'handleBytecodeDecode' },
    { tool: 'nemu_bytecode_scan', method: 'handleBytecodeScan' },
    // Pointer chain walking
    { tool: 'nemu_pointer_chain', method: 'handlePointerChain' },
    { tool: 'nemu_data_dump', method: 'handleDataDump' },
    { tool: 'nemu_dump_frame', method: 'handleDumpFrame' },
    { tool: 'nemu_patch_apply', method: 'handlePatchApply' },
    { tool: 'nemu_regs_save', method: 'handleRegsSave' },
    { tool: 'nemu_regs_restore', method: 'handleRegsRestore' },
    { tool: 'nemu_scan_memory', method: 'handleScanMemory' },
    { tool: 'nemu_xor_region', method: 'handleXorRegion' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { NativeEmulatorHandlers } = await import('./handlers');
  let handlers = ctx.getDomainInstance<H>(DEP_KEY);
  if (!handlers) {
    handlers = new NativeEmulatorHandlers();
    ctx.setDomainInstance(DEP_KEY, handlers);
  }
  return handlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,
  registrations,
  workflowRule: {
    patterns: [
      /\b(emulate|emulator|nemu)\b.*(so|native|jni|arm64|aarch64)/i,
      /(android|flutter|apk).*(native|jni|\.so|sign|crypt|decrypt|encrypt)/i,
      /\b(jni|java_[a-z])\b.*(emulate|reverse|recover|call)/i,
      /(in-process|self-?built|no-?device).*(emulat|arm64|native)/i,
      /(recover|reverse).*(native|jni|signing|crypto).*(algorithm|function|\.so)/i,
    ],
    priority: 86,
    tools: [
      'nemu_capabilities',
      'nemu_create_session',
      'nemu_extract_apk_libs',
      'nemu_inspect_imports',
      'nemu_load_library',
      'nemu_list_symbols',
      'nemu_setup_java_mock',
      'nemu_call_jni_export',
      'nemu_trace',
      'nemu_disassemble',
      'nemu_jni_diag',
      'nemu_jni_handles',
      'nemu_dlsym_diag',
      'nemu_vm_state_dump',
      'nemu_vm_state_load',
      'nemu_vm_state_compare',
    ],
    hint: 'In-process ARM64 emulation: inspect imports → create a session → load a .so (or extract one from an APK) → alloc_memory → call_symbol/call_jni_export → read_memory, or mock Java → call JNI functions → trace. Destroy the session when done.',
  },
  prerequisites: {
    nemu_load_library: [
      {
        condition: 'An emulator session must exist',
        fix: 'Call nemu_create_session first and reuse the returned sessionId.',
      },
    ],
    nemu_call_symbol: [
      {
        condition: 'A library must be loaded into the session',
        fix: 'Call nemu_load_library (or nemu_load_apk_library) before calling a symbol.',
      },
    ],
    nemu_call_jni_export: [
      {
        condition: 'A library must be loaded into the session',
        fix: 'Call nemu_load_library (or nemu_load_apk_library) first; register any Java callbacks with nemu_setup_java_mock.',
      },
    ],
    nemu_list_symbols: [
      {
        condition: 'A library must be loaded into the session',
        fix: 'Call nemu_load_library before listing symbols.',
      },
    ],
    nemu_trace: [
      {
        condition: 'A library must be loaded into the session',
        fix: 'Call nemu_load_library before tracing a symbol.',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'nemu_extract_apk_libs',
      to: 'nemu_load_apk_library',
      relation: 'precedes',
      weight: 0.7,
    },
    { from: 'nemu_load_library', to: 'nemu_call_jni_export', relation: 'precedes', weight: 0.6 },
    { from: 'nemu_setup_java_mock', to: 'nemu_call_jni_export', relation: 'suggests', weight: 0.5 },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
