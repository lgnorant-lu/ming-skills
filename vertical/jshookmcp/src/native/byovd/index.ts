export { ByovdManager, byovdManager } from './ByovdManager';
export * from './types';
export { byovdDriverRegistry, findDriver, RTCore64, KProcessHacker, ThrottleStop } from './drivers';
export { KernelCallbackManager } from './KernelCallbackManager';
export type {
  KernelMemoryInterface,
  CallbackEntry,
  CallbackFilter,
  CallbackRestorePoint,
} from './KernelCallbackManager';
export {
  Hypervisor,
  getHypervisor,
  resetHypervisorForTest,
  adjustControlField,
  computeAdjustedControls,
  allocatePhysicalMemory,
  initVmxonRegion,
  buildEptIdentityTables,
  configureMsrBitmap,
  computeMsrBitmapPosition,
  freePhysicalMemory,
  INTERCEPTED_MSRS,
} from './Hypervisor';
export { encodeEptPte, encodeVmcsField, decodeVmcsField } from './VmxConstants';
export type {
  Cpuid1Features,
  Cpuid7Features,
  CpuidLeaf,
  VmxMsrValues,
  VmxBasicInfo,
  EptVpidCapabilities,
  VmxCapabilities,
  HypervisorStatus,
  VmcsConfig,
  PhysicalAllocation,
  PerProcessorSetup,
  MsrCapabilityPair,
  VmxCapabilityMsrs,
  AdjustedControls,
  EptTableConfig,
  MsrBitmapConfig,
  VmcsFieldConfig,
  HypervisorConflicts,
  HypervisorCapabilityReport,
  VmcsFieldManifestEntry,
} from './Hypervisor.types';
