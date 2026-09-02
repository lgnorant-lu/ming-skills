/**
 * EPT Hypervisor constants.
 *
 * All hypervisor operations are gated behind JSHOOK_HYPERVISOR_ENABLE=1.
 * The hypervisor requires a BYOVD kernel driver for ring-0 memory access
 * and MSR reads. Actual VMX instruction execution requires a kernel-mode
 * component (not yet implemented in Phase 1).
 */

import { bool, int } from './helpers';

/** Master enable gate — must be explicitly set to '1'. */
export const HYPERVISOR_ENABLED = bool('JSHOOK_HYPERVISOR_ENABLE', false);

/** Maximum concurrent hypervisor instances (always 1 — VMX is exclusive). */
export const HYPERVISOR_MAX_INSTANCES = int('HYPERVISOR_MAX_INSTANCES', 1);

/** VMXON region size in bytes (typically 4096 — page-aligned). */
export const HYPERVISOR_VMXON_REGION_SIZE = int('HYPERVISOR_VMXON_REGION_SIZE', 4096);

/** VMCS region size in bytes (from IA32_VMX_BASIC MSR, typically 4096). */
export const HYPERVISOR_VMCS_REGION_SIZE = int('HYPERVISOR_VMCS_REGION_SIZE', 4096);
