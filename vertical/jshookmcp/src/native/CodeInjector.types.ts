/**
 * Code Injector types.
 * @module CodeInjector.types
 */

export interface PatchOperation {
  id: string;
  pid: number;
  address: string;
  originalBytes: number[];
  patchBytes: number[];
  isApplied: boolean;
  timestamp: number;
}

export interface CodeCave {
  address: string;
  size: number;
  module: string;
  section: string;
}

export interface ShellcodeInjectionResult {
  address: string;
  threadId: number;
  method: 'createremote' | 'ntcreatethread';
}

export interface DllInjectionResult {
  /** Injection method used */
  method: 'loadlibrary' | 'manualmap';
  /** Requested injection mode */
  mode: 'loadlibrary' | 'manualmap';
  /** DLL path that was injected */
  dllPath: string;
  /** Remote thread ID (loadlibrary mode) */
  threadId?: number;
  /** Address of the allocated DLL path string in the target (loadlibrary mode) */
  allocatedAddress?: string;
  /** Base address where the DLL was mapped (manualmap mode) */
  imageBase?: string;
  /** Size of the mapped image in bytes (manualmap mode) */
  imageSize?: number;
  /** Entry point address executed (manualmap mode) */
  entryPoint?: string;
  /** Specific injection sub-method used (manualmap mode) */
  injectionMethod?: string;
}
