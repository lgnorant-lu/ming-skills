import { isKoffiBindingUsable, isWindows } from '@native/Win32API';
import { NATIVE_ADMIN_CHECK_TIMEOUT_MS, MEMORY_PROBE_CMD_TIMEOUT_MS } from '@src/constants';

export async function checkNativeMemoryAvailability(
  execAsync: (
    command: string,
    options?: { timeout?: number },
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<{ available: boolean; reason?: string }> {
  // ── macOS (Darwin) path ──
  if (process.platform === 'darwin') {
    return checkDarwinAvailability(execAsync);
  }

  // Linux has a complete PlatformMemoryAPI provider. Permission failures are
  // target-specific (ptrace policy, uid, capabilities) and are reported by the
  // actual operation, so platform availability must not reject Linux outright.
  if (process.platform === 'linux') {
    return { available: true };
  }

  // ── Windows path ──
  if (!isWindows()) {
    return {
      available: false,
      reason: `Native memory operations require Windows, macOS, or Linux. Current platform: ${process.platform}`,
    };
  }

  if (!isKoffiBindingUsable()) {
    return {
      available: false,
      reason: 'koffi library not available. Install with: pnpm add koffi',
    };
  }

  // Check admin privileges
  try {
    const { stdout } = await execAsync(
      'powershell.exe -NoProfile -Command "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"',
      { timeout: NATIVE_ADMIN_CHECK_TIMEOUT_MS },
    );

    if (stdout.trim().toLowerCase() !== 'true') {
      return {
        available: false,
        reason: 'Native memory operations require Administrator privileges. Run as Administrator.',
      };
    }
  } catch {
    return {
      available: false,
      reason: 'Failed to check Administrator privileges.',
    };
  }

  return { available: true };
}

// ── macOS-specific checks ──

async function checkDarwinAvailability(
  execAsync: (
    command: string,
    options?: { timeout?: number },
  ) => Promise<{ stdout: string; stderr: string }>,
): Promise<{ available: boolean; reason?: string }> {
  // 1. Check koffi + libSystem.B.dylib availability
  try {
    // Dynamic import to avoid loading koffi bindings on Windows. Intentional
    // exception to koffi-loader's single-load-point rule: this probes a
    // *specific* libSystem binding on demand (try/catch-guarded) and hits the
    // ESM module cache, so the binding is not re-executed.
    const koffiMod = await import('koffi');
    const testLib = koffiMod.default.load('/usr/lib/libSystem.B.dylib');
    testLib.unload();
  } catch {
    return {
      available: false,
      reason: 'koffi library cannot load libSystem.B.dylib. Install koffi with: pnpm add koffi',
    };
  }

  // 2. Check SIP status (informational — not blocking)
  let sipInfo = '';
  try {
    const { stdout } = await execAsync('csrutil status 2>&1 || true', {
      timeout: MEMORY_PROBE_CMD_TIMEOUT_MS,
    });
    sipInfo = stdout.trim();
  } catch {
    // SIP check is informational only
  }

  // 3. Check root privileges (required for task_for_pid on foreign processes)
  if (process.getuid && process.getuid() !== 0) {
    const sipNote = sipInfo ? ` SIP status: ${sipInfo}` : '';
    return {
      available: false,
      reason:
        `macOS memory operations require root privileges for task_for_pid. Run with: sudo node ` +
        `<your-script>.${sipNote}`,
    };
  }

  return { available: true };
}
