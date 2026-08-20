/**
 * Process Manager Module - Cross-platform process management
 *
 * Supports: Windows, Linux, macOS
 */

// Re-export types
export type {
  ProcessInfo,
  WindowInfo,
  ChromiumProcess,
  TargetAppConfig,
} from '@modules/process/ProcessManager';
export { DEFAULT_CHROMIUM_CONFIG } from '@modules/process/ProcessManager';
export type { ChromeProcess as LinuxChromeProcess } from '@modules/process/LinuxProcessManager';
export type { ChromeProcess as MacChromeProcess } from '@modules/process/MacProcessManager';

// Export platform-specific implementations
export { ProcessManager as WindowsProcessManager } from '@modules/process/ProcessManager';
export { LinuxProcessManager } from '@modules/process/LinuxProcessManager';
export { MacProcessManager } from '@modules/process/MacProcessManager';

// Export Memory Manager
export {
  MemoryManager,
  type MemoryReadResult,
  type MemoryWriteResult,
  type MemoryScanResult,
} from '@modules/process/MemoryManager';

// Export utility functions for advanced memory operations
export {
  scanMemory,
  dumpMemory,
  listMemoryRegions,
  checkProtection,
  scanFiltered,
  batchWrite,
  startMonitor,
  stopMonitor,
  injectDll,
  injectShellcode,
  checkDebugPort,
  enumerateModules,
} from '@modules/process/memoryUtils';

export {
  createProcessManager,
  detectPlatform,
  isProcessManagementSupported,
  UnifiedProcessManager,
  type Platform,
} from '@modules/process/UnifiedProcessManager';
