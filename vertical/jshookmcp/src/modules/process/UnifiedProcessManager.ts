import { LinuxProcessManager } from '@modules/process/LinuxProcessManager';
import { MacProcessManager } from '@modules/process/MacProcessManager';
import { ProcessManager as WindowsProcessManager } from '@modules/process/ProcessManager';
import { logger } from '@utils/logger';

export type Platform = 'win32' | 'linux' | 'darwin' | 'unknown';

export function detectPlatform(): Platform {
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      return 'win32';
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    default:
      logger.warn(`Unsupported platform: ${platform}`);
      return 'unknown';
  }
}

export function createProcessManager():
  | WindowsProcessManager
  | LinuxProcessManager
  | MacProcessManager {
  const platform = detectPlatform();

  logger.info(`Creating ProcessManager for platform: ${platform}`);

  switch (platform) {
    case 'win32':
      return new WindowsProcessManager();
    case 'linux':
      return new LinuxProcessManager();
    case 'darwin':
      return new MacProcessManager();
    default:
      throw new Error(
        `Unsupported platform: ${platform}. ProcessManager requires Windows, Linux, or macOS.`,
      );
  }
}

export function isProcessManagementSupported(): boolean {
  return detectPlatform() !== 'unknown';
}

/**
 * Unified interface for cross-platform process operations.
 */
export class UnifiedProcessManager {
  private manager: WindowsProcessManager | LinuxProcessManager | MacProcessManager;
  private platform: Platform;

  constructor() {
    this.platform = detectPlatform();
    this.manager = createProcessManager();
  }

  getPlatform(): Platform {
    return this.platform;
  }

  async findProcesses(pattern: string) {
    return this.manager.findProcesses(pattern);
  }

  async getProcessByPid(pid: number) {
    return this.manager.getProcessByPid(pid);
  }

  async getProcessWindows(pid: number) {
    return this.manager.getProcessWindows(pid);
  }

  async checkDebugPort(pid: number, options?: { commandLine?: string }) {
    return this.manager.checkDebugPort(pid, options);
  }

  async launchWithDebug(executablePath: string, debugPort?: number, args?: string[]) {
    return this.manager.launchWithDebug(executablePath, debugPort, args);
  }

  async killProcess(pid: number) {
    return this.manager.killProcess(pid);
  }

  async getProcessCommandLine(pid: number) {
    return this.manager.getProcessCommandLine(pid);
  }

  async findBrowserProcesses(config?: {
    processNamePattern?: string;
    windowClassPattern?: string;
  }) {
    if (this.platform === 'win32') {
      if (config?.processNamePattern || config?.windowClassPattern) {
        return (this.manager as WindowsProcessManager).findChromiumProcesses({
          processNamePattern: config.processNamePattern,
          windowClassPattern: config.windowClassPattern,
        });
      }
      return (this.manager as WindowsProcessManager).findChromiumAppProcesses();
    }
    if (this.platform === 'linux') {
      return (this.manager as LinuxProcessManager).findChromeProcesses();
    }
    if (this.platform === 'darwin') {
      return (this.manager as MacProcessManager).findChromeProcesses();
    }
    return null;
  }
}
