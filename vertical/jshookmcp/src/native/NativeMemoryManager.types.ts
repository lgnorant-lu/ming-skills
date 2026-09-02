export interface NativeMemoryReadResult {
  success: boolean;
  data?: string; // hex encoded
  error?: string;
}

export interface NativeMemoryWriteResult {
  success: boolean;
  bytesWritten?: number;
  error?: string;
}

export interface NativeMemoryScanResult {
  success: boolean;
  addresses: string[];
  error?: string;
  stats?: {
    patternLength: number;
    resultsFound: number;
  };
}

export interface MemoryRegion {
  baseAddress: string;
  size: number;
  state: string;
  protection: string;
  isReadable: boolean;
  isWritable: boolean;
  isExecutable: boolean;
  type: string;
}

export interface ModuleInfo {
  name: string;
  baseAddress: string;
  size: number;
}

export type NativePatternType =
  | 'hex'
  | 'string'
  | 'byte'
  | 'int8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float'
  | 'double'
  | 'pointer';

// ── Scan engine types ──

/** Value types supported by the CE-style iterative scan engine. */
export type ScanValueType =
  | 'byte'
  | 'int8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'
  | 'float'
  | 'double'
  | 'pointer'
  | 'hex'
  | 'string';

/** Comparison modes for next-scan narrowing. */
export type ScanCompareMode =
  | 'exact'
  | 'unknown_initial'
  | 'changed'
  | 'unchanged'
  | 'increased'
  | 'decreased'
  | 'greater_than'
  | 'less_than'
  | 'between'
  | 'not_equal'
  | 'changed_by'
  | 'increased_by'
  | 'decreased_by'
  | 'changed_by_variable';

/** Region filter for scan operations — generalized CE-style filter. */
export interface RegionFilter {
  /** Only scan writable regions */
  writable?: boolean;
  /** Only scan readable regions (default: true, always applied) */
  readable?: boolean;
  /** Only scan executable regions */
  executable?: boolean;
  /** Only module-backed (image) regions */
  moduleOnly?: boolean;
  /** Skip system modules (ntdll, kernel32, kernelbase, etc.) */
  skipSystemModules?: boolean;
  /** Only scan regions whose module name matches this pattern (case-insensitive substring) */
  modulePattern?: string;
  /** Skip regions smaller than N bytes */
  minSize?: number;
}

/** Options bag for first-scan and unknown-initial-scan. */
export interface ScanOptions {
  valueType: ScanValueType;
  alignment?: number;
  maxResults?: number;
  regionFilter?: RegionFilter;
  onProgress?: (progress: number, total?: number) => void;
}

/** Internal state for a live scan session. */
export interface ScanSessionState {
  id: string;
  pid: number;
  valueType: ScanValueType;
  alignment: number;
  createdAt: number;
  lastScanAt: number;
  scanCount: number;
  /** Addresses stored as bigint internally to avoid GC overhead from string conversion. */
  addresses: bigint[];
  /** Previous scan values keyed by bigint address. */
  previousValues: Map<bigint, Buffer>;
}
