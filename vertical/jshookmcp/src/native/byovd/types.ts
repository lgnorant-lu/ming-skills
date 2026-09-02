/**
 * BYOVD (Bring Your Own Vulnerable Driver) type definitions.
 *
 * Describes kernel-driver interfaces for arbitrary memory access, loaded
 * by the user at their own risk.  No driver binaries are bundled — only
 * metadata (SHA-256 hashes, IOCTL codes, official URLs) is stored here.
 *
 * @module byovd/types
 */

/** Capability flags a vulnerable driver may expose. */
export type ByovdCapability = 'read' | 'write' | 'alloc' | 'protect' | 'physical';

/** Load-time availability summary. */
export type ByovdDriverStatus = 'available' | 'blocklisted' | 'untested';

/**
 * Descriptor for a specific signed-but-vulnerable kernel driver that
 * exposes arbitrary memory access through its IOCTL interface.
 */
export interface ByovdDriverDef {
  /** Human-readable driver name (e.g. "RTCore64", "ThrottleStop"). */
  name: string;

  /** Version string of the vulnerable driver. */
  version: string;

  /**
   * Official download URL for the authentic signed driver binary.
   * The user MUST download from this source and verify the hash before use.
   * NEVER bundled or embedded.
   */
  downloadUrl: string;

  /** Kernel service name for CreateService (e.g. "RTCore64"). */
  serviceName: string;

  /** NT device path for CreateFile (e.g. "\\\\.\\RTCore64"). */
  devicePath: string;

  /**
   * Filesystem path to the .sys driver binary for CreateService.
   * This is distinct from devicePath (which is the NT device symlink).
   * Example: "C:\\Windows\\System32\\drivers\\RTCore64.sys"
   */
  binaryPath: string;

  /** IOCTL control code for memory reads. */
  ioctlReadMemory: number;

  /** IOCTL control code for memory writes (0 if not available). */
  ioctlWriteMemory: number;

  /** Optional IOCTL for reading MSRs (model-specific registers). */
  ioctlReadMsr?: number;

  /** Optional IOCTL for writing MSRs. */
  ioctlWriteMsr?: number;

  /** What kind of memory access the driver provides. */
  capabilities: ByovdCapability[];

  /** SHA-256 of the authentic signed .sys file. */
  sha256: string;

  /** CVE identifier(s) tracking this driver's vulnerability. */
  cve: string[];

  /** Current blocklist status. */
  status: ByovdDriverStatus;

  /**
   * Whether this driver maps physical memory (via MmMapIoSpace) rather
   * than virtual memory.  Physical-memory drivers require VA→PA
   * translation before R/W — the manager handles this transparently.
   */
  physicalMemory: boolean;

  /**
   * Brief human-readable description of the vulnerability mechanism.
   */
  description: string;
}

/** Runtime state of a loaded BYOVD driver. */
export interface ByovdActiveDriver {
  /** The driver definition that was loaded. */
  driver: ByovdDriverDef;

  /** NT handle returned by CreateFile for the device. */
  deviceHandle: bigint;

  /** SC_HANDLE for the loaded kernel service. */
  serviceHandle: bigint;

  /** When the driver was loaded (unix ms). */
  loadedAt: number;
}

/** Result of a BYOVD memory read operation. */
export interface ByovdReadResult {
  success: boolean;
  data?: Buffer;
  error?: string;
  bytesRead: number;
}

/** Result of a BYOVD memory write operation. */
export interface ByovdWriteResult {
  success: boolean;
  error?: string;
  bytesWritten: number;
}

/** Structured output for memory_byovd status queries. */
export interface ByovdStatusReport {
  enabled: boolean;
  active: boolean;
  driverName: string | null;
  driverVersion: string | null;
  loadedAt: number | null;
  capabilities: ByovdCapability[] | null;
  cve: string[] | null;
  isAdmin: boolean;
  platform: NodeJS.Platform;
}

/** Per-driver availability summary for memory_byovd list. */
export interface ByovdDriverSummary {
  name: string;
  version: string;
  status: ByovdDriverStatus;
  capabilities: ByovdCapability[];
  cve: string[];
  physicalMemory: boolean;
  description: string;
}
