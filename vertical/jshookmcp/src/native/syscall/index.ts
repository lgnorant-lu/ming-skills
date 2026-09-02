export {
  ntOpenProcess,
  ntReadVirtualMemory,
  ntWriteVirtualMemory,
  ntAllocateVirtualMemory,
  ntProtectVirtualMemory,
  ntFreeVirtualMemory,
  ntSuspendProcess,
  ntResumeProcess,
  ntSuccess,
} from './DirectNtApi';
export { resolveNtdll, resetNtdllCache, resolveRuntimeKernelBase } from './SyscallResolver';
export type { SyscallEntry, ResolvedNtdll } from './SyscallResolver';
export { createScanWalker, DEFAULT_OBFUSCATION_CONFIG } from './ScanObfuscator';
export type { ScanObfuscationConfig, ScanWalker } from './ScanObfuscator';
export { buildSyscallStub, freeAllStubs } from './SyscallStubBuilder';
export type { SyscallStub } from './SyscallStubBuilder';
export {
  ntCreateThreadEx,
  ntAllocateVirtualMemory as ntAllocVM,
  ntProtectVirtualMemory as ntProtectVM,
  ntClose,
  ntCreateThreadExSafe,
} from './NtInjection';
export { enumerateKernelModules, findKernelModule } from './NtModuleEnumerator';
export type { KernelModule } from './NtModuleEnumerator';

// ── InProcessPatcher ─────────────────────────────────────────────────────────
export {
  applyInProcessPatches,
  isPatched,
  getPatchError,
  getPatchDetails,
  resetPatchState,
  enumerateEtwProviders,
  enumerateActiveTraceSessions,
  getCriticalEtwGuids,
  hardenEtwProviders,
  getEtwMonitoringSummary,
  verifyPatch,
  CRITICAL_ETW_PROVIDERS,
} from './InProcessPatcher';
export type { EtwDisableResult } from './InProcessPatcher';

// ── ChaosScanner ─────────────────────────────────────────────────────────────
export {
  createChaosWalker,
  createChaosRegionIterator,
  generateDummyPids,
  isChaosModeEnabled,
  getChaosConfigFromEnv,
  DEFAULT_CHAOS_CONFIG,
} from './ChaosScanner';
export type { ChaosConfig, ChaosWalker, ChaosRegionIterator } from './ChaosScanner';

// ── KernelCallbackDetector ───────────────────────────────────────────────────
export {
  detectKernelCallbacks,
  enumerateHandleOwners,
  resetKernelCallbackCache,
} from './KernelCallbackDetector';
export type {
  KernelCallbackReport,
  DetectedDriver,
  SuspiciousHandle,
} from './KernelCallbackDetector';

// ── InstrumentationCallbackDetector ──────────────────────────────────────────
export {
  detectInstrumentationCallback,
  replaceInstrumentationCallback,
  resetInstrumentationCallbackCache,
} from './InstrumentationCallbackDetector';
export type { InstrumentationCallbackReport } from './InstrumentationCallbackDetector';

// ── ProcessMasquerade ────────────────────────────────────────────────────────
export { applyProcessMasquerade, restoreProcessMasquerade } from './ProcessMasquerade';
export type { MasqueradeConfig, MasqueradeResult } from './ProcessMasquerade';

// ── SelfDefense ──────────────────────────────────────────────────────────────
export { applySelfDefense, stopSelfDefense, getSuspiciousHandleCount } from './SelfDefense';
export type { SelfDefenseConfig, SelfDefenseReport } from './SelfDefense';
