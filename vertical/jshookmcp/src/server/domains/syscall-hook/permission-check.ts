import { LOGON_PROBE_TIMEOUT_MS } from '@src/constants/syscall-hook';
import { logger } from '@utils/logger';

export interface PermissionCheckResult {
  hasPermission: boolean;
  platform: string;
  reason?: string;
  requiredCapabilities?: string[];
}

/** Log a fail-open probe failure — a silent mis-authorization is undiagnosable. */
function logProbeFailure(platform: string, error: unknown): void {
  logger.warn(
    `[syscall-hook] permission probe failed on ${platform}; fail-open: monitor will be attempted and surface the real error at runtime. ${error instanceof Error ? error.message : String(error)}`,
  );
}

export async function checkSyscallPermission(): Promise<PermissionCheckResult> {
  const platform = process.platform;

  if (platform === 'linux') {
    // Check: process.geteuid?.() === 0 OR ptrace_scope == 0
    // On Linux, strace needs either root or ptrace_scope=0
    try {
      if (process.geteuid?.() === 0) return { hasPermission: true, platform };
      const { readFileSync } = await import('node:fs');
      const ptraceScope = readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim();
      if (ptraceScope === '0') return { hasPermission: true, platform };
      return {
        hasPermission: false,
        platform,
        reason: 'strace requires root (EUID=0) or ptrace_scope=0',
        requiredCapabilities: ['root', 'CAP_SYS_PTRACE'],
      };
    } catch (error) {
      // Fail-open stays (the monitor itself will surface the real error at
      // runtime), but the probe failure must be logged — a silent
      // mis-authorization is undiagnosable.
      logProbeFailure(platform, error);
      return { hasPermission: true, platform };
    }
  }

  if (platform === 'win32') {
    // ETW requires Administrator or Performance Monitor Users group
    // We can't reliably check without native APIs, so attempt a lightweight probe
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      await execFileAsync('logman', ['query', 'providers'], { timeout: LOGON_PROBE_TIMEOUT_MS });
      return { hasPermission: true, platform };
    } catch {
      return {
        hasPermission: false,
        platform,
        reason: 'ETW trace requires Administrator privileges',
        requiredCapabilities: ['Administrator'],
      };
    }
  }

  if (platform === 'darwin') {
    // dtrace requires root or specific entitlements
    try {
      if (process.geteuid?.() === 0) return { hasPermission: true, platform };
      return {
        hasPermission: false,
        platform,
        reason: 'dtrace requires root privileges on macOS',
        requiredCapabilities: ['root'],
      };
    } catch (error) {
      // Fail-open + log (see logProbeFailure).
      logProbeFailure(platform, error);
      return { hasPermission: true, platform };
    }
  }

  return { hasPermission: true, platform };
}
