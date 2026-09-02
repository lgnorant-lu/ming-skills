/**
 * Anti-sandbox / anti-analysis checks.
 *
 * Before loading dangerous native code (FFI, syscalls, injection), these checks
 * help detect and respond to analysis environments. Controlled by:
 *   - JSHOOK_SKIP_ANTI_ANALYSIS=1  — bypass all checks
 *   - JSHOOK_ANTI_ANALYSIS_STRICT=1 — refuse to load native modules on any warning
 *
 * @module AntiAnalysis
 */

import { logger } from '@utils/logger';
import { readEnvBoolean } from '@src/config/environment';

// ── Types ──

export interface AntiAnalysisResult {
  isDebugged: boolean;
  likelySandbox: boolean;
  uptimeMinutes: number;
  lastUserInputSeconds: number;
  suspiciousProcesses: string[];
  shouldProceed: boolean;
  warnings: string[];
}

const SUSPICIOUS_PROCESS_NAMES = [
  'wireshark.exe',
  'procmon.exe',
  'procmon64.exe',
  'x64dbg.exe',
  'x32dbg.exe',
  'ollydbg.exe',
  'windbg.exe',
  'ida.exe',
  'ida64.exe',
  'idaq.exe',
  'idaq64.exe',
  'dumpcap.exe',
  'tcpview.exe',
  'fiddler.exe',
  'httpdebugger.exe',
  'processhacker.exe',
  'systeminformer.exe',
  'autoruns.exe',
  'autoruns64.exe',
  'regmon.exe',
  'filemon.exe',
  'dnspy.exe',
  'ilspy.exe',
  'de4dot.exe',
  'scylla.exe',
  'scylla_x64.exe',
  'pe-sieve.exe',
  'pebear.exe',
  'cff explorer.exe',
  'stud_pe.exe',
  'lordpe.exe',
  'importrec.exe',
  'reconstructor.exe',
  'die.exe', // Detect It Easy
  'protection_id.exe',
  'vboxservice.exe',
  'vboxtray.exe',
  'vmsrvc.exe',
  'vmusrvc.exe',
  'xenservice.exe',
  'prl_tools.exe',
  'prl_cc.exe',
  'vmtoolsd.exe',
  'vmwaretray.exe',
  'vmwareuser.exe',
  'sandboxierpcss.exe',
  'sandboxiedcomlaunch.exe',
  'sbiesvc.exe',
  'joeboxserver.exe',
  'joeboxcontrol.exe',
];

// ── Constants ──

/** Minimum uptime in ms before sandbox suspicion is lifted (10 minutes). */
const MIN_UPTIME_MS = 10 * 60 * 1000;

/** Maximum idle time in ms (5 minutes) before interaction check triggers. */
const MAX_IDLE_MS = 5 * 60 * 1000;

// ── Helper ──

function envFlag(name: string): boolean {
  try {
    return readEnvBoolean(name, false);
  } catch {
    return false;
  }
}

// ── Check Implementations ──

/**
 * Check if a debugger is attached via PEB.BeingDebugged.
 * On Windows this reads the PEB via NtQueryInformationProcess.
 * On non-Windows falls back to process-level signals.
 */
function checkDebuggerPresence(): { isDebugged: boolean; warning?: string } {
  if (process.platform !== 'win32') {
    // Non-Windows: check for common debugger env vars / signals
    const debugEnv =
      process.env.NODE_OPTIONS?.includes('--inspect') ||
      process.env.NODE_OPTIONS?.includes('--debug') ||
      process.env.VSCODE_INSPECTOR_OPTIONS !== undefined ||
      process.env.ELECTRON_RUN_AS_NODE === '1';
    return { isDebugged: debugEnv };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load(
      // Decoded from base64 at import-time — avoids string in source
      Buffer.from('bnRkbGwuZGxs', 'base64').toString('utf8'),
    );
    const NtQIP = ntdll.func(
      'int32 NtQueryInformationProcess(void *, uint32, _Out_ void *, uint32, void *)',
    );

    // ProcessDebugPort (class 7) — non-zero = debugger present
    const debugPortBuf = Buffer.alloc(8);
    const status = NtQIP(
      BigInt('0xffffffffffffffff'), // GetCurrentProcess() pseudo-handle
      7,
      debugPortBuf,
      8,
      null,
    ) as number;

    if (status < 0) {
      try {
        ntdll.unload();
      } catch {
        /* ignore */
      }
      return {
        isDebugged: false,
        warning: `NtQueryInformationProcess returned ${status.toString(16)}`,
      };
    }

    const debugPort = Number(debugPortBuf.readBigUInt64LE());
    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }
    return { isDebugged: debugPort !== 0 && debugPort !== 0xffffffff };
  } catch {
    // koffi not available — assume not debugged (best effort)
    return { isDebugged: false, warning: 'Debugger check unavailable (koffi not loaded)' };
  }
}

/**
 * Check system uptime. Sandboxes often reboot frequently.
 * On Windows uses GetTickCount64. On non-Windows uses process.uptime() as proxy.
 */
function checkUptime(): { uptimeMinutes: number; warning?: string } {
  if (process.platform === 'win32') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi');
      const k32 = koffi.load(Buffer.from('a2VybmVsMzIuZGxs', 'base64').toString('utf8'));
      const GetTickCount64 = k32.func('uint64 GetTickCount64()');
      const ticks = Number(GetTickCount64());
      try {
        k32.unload();
      } catch {
        /* ignore */
      }
      return { uptimeMinutes: Math.floor(ticks / 60000) };
    } catch {
      return { uptimeMinutes: 0, warning: 'Uptime check unavailable' };
    }
  }

  // Non-Windows: use process.uptime() as rough proxy
  return { uptimeMinutes: Math.floor(process.uptime() / 60) };
}

/**
 * Check for recent user interaction.
 * On Windows uses GetLastInputInfo. On non-Windows is best-effort.
 */
function checkUserInteraction(): { lastInputSeconds: number; warning?: string } {
  if (process.platform !== 'win32') {
    // Non-Windows: can't easily check — assume interacted
    return { lastInputSeconds: 0 };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const u32 = koffi.load(Buffer.from('dXNlcjMyLmRsbA==', 'base64').toString('utf8'));
    const GetLastInputInfo = u32.func('int GetLastInputInfo(_Out_ uint8_t[8])');
    const GetTickCount = u32.func('uint32 GetTickCount()');

    // LASTINPUTINFO: cbSize(4) + dwTime(4) = 8 bytes
    const lii = Buffer.alloc(8);
    lii.writeUInt32LE(8, 0); // cbSize
    const result = GetLastInputInfo(lii);
    if (result === 0) {
      try {
        u32.unload();
      } catch {
        /* ignore */
      }
      return { lastInputSeconds: 0, warning: 'GetLastInputInfo failed' };
    }

    const lastInputTicks = lii.readUInt32LE(4);
    const currentTicks = GetTickCount();
    const idleMs = currentTicks - lastInputTicks;

    try {
      u32.unload();
    } catch {
      /* ignore */
    }
    return { lastInputSeconds: Math.floor(idleMs / 1000) };
  } catch {
    return { lastInputSeconds: 0, warning: 'User interaction check unavailable' };
  }
}

/**
 * Lightweight VM detection via common artifacts.
 * Checks filesystem paths, registry keys (Windows), and device files.
 */
function checkVMArtifacts(): { isVM: boolean; hints: string[] } {
  const hints: string[] = [];
  const fs = require('node:fs');

  // Common VM filesystem artifacts
  const vmPaths: string[] = [];
  if (process.platform === 'win32') {
    vmPaths.push(
      'C:\\Program Files\\VMware\\VMware Tools\\vmtoolsd.exe',
      'C:\\Program Files\\Oracle\\VirtualBox Guest Additions\\VBoxService.exe',
      'C:\\Windows\\System32\\drivers\\VBoxMouse.sys',
      'C:\\Windows\\System32\\drivers\\VBoxGuest.sys',
      'C:\\Windows\\System32\\drivers\\vmci.sys',
      'C:\\Windows\\System32\\drivers\\vmmouse.sys',
      'C:\\Windows\\System32\\drivers\\vmusbmouse.sys',
      'C:\\Windows\\System32\\drivers\\vm3dmp.sys',
      'C:\\Windows\\System32\\drivers\\vpcbus.sys',
      'C:\\Windows\\System32\\drivers\\vmsrvc.sys',
      'C:\\Windows\\System32\\drivers\\xen.sys',
    );
  } else {
    vmPaths.push(
      '/proc/xen',
      '/proc/vz',
      '/sys/class/dmi/id/product_name',
      '/sys/class/dmi/id/sys_vendor',
    );
  }

  for (const p of vmPaths) {
    try {
      if (fs.existsSync(p)) {
        hints.push(`VM artifact found: ${p}`);
      }
    } catch {
      // Permission error — ignore
    }
  }

  // Check /sys/class/dmi/id for VM signatures on Linux
  if (process.platform === 'linux') {
    try {
      const vendor = readFileQuiet('/sys/class/dmi/id/sys_vendor');
      if (vendor && /vmware|virtualbox|qemu|xen|kvm|microsoft/i.test(vendor)) {
        hints.push(`VM vendor detected: ${vendor.trim()}`);
      }
      const product = readFileQuiet('/sys/class/dmi/id/product_name');
      if (product && /virtualbox|vmware|virtual machine|kvm|qemu|hvm domU|droplet/i.test(product)) {
        hints.push(`VM product detected: ${product.trim()}`);
      }
    } catch {
      /* ignore */
    }
  }

  return { isVM: hints.length > 0, hints };
}

/** Read a file quietly — returns null on any error. */
function readFileQuiet(path: string): string | null {
  try {
    const fs = require('node:fs');
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Check for running analysis / sandbox tools by process name.
 * On Windows enumerates via tasklist. On Linux via /proc.
 */
function checkSuspiciousProcesses(): string[] {
  const found: string[] = [];

  try {
    if (process.platform === 'win32') {
      const { execSync } = require('node:child_process');
      const output = execSync('tasklist /FO CSV /NH', {
        timeout: 5000,
        encoding: 'utf8',
        windowsHide: true,
      }) as string;

      const lower = output.toLowerCase();
      for (const name of SUSPICIOUS_PROCESS_NAMES) {
        if (lower.includes(name.toLowerCase())) {
          found.push(name);
        }
      }
    } else if (process.platform === 'linux') {
      const fs = require('node:fs');
      const procDirs = fs.readdirSync('/proc').filter((d: string) => /^\d+$/.test(d));
      for (const pid of procDirs) {
        try {
          const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase();
          for (const name of SUSPICIOUS_PROCESS_NAMES) {
            if (comm === name.toLowerCase() && !found.includes(name)) {
              found.push(name);
            }
          }
        } catch {
          // Process may have exited
        }
      }
    }
  } catch {
    // Enumeration failed — not critical
  }

  return found;
}

// ── Main Entry Point ──

let cachedResult: AntiAnalysisResult | null = null;

/**
 * Run all anti-analysis checks. Result is cached — subsequent calls return
 * the same result. Set `JSHOOK_SKIP_ANTI_ANALYSIS=1` to bypass all checks.
 */
export function checkAntiAnalysis(): AntiAnalysisResult {
  if (envFlag('JSHOOK_SKIP_ANTI_ANALYSIS')) {
    return {
      isDebugged: false,
      likelySandbox: false,
      uptimeMinutes: 999,
      lastUserInputSeconds: 0,
      suspiciousProcesses: [],
      shouldProceed: true,
      warnings: [],
    };
  }

  if (cachedResult) return cachedResult;

  const warnings: string[] = [];

  // 1. Debugger presence
  const dbg = checkDebuggerPresence();
  if (dbg.warning) warnings.push(dbg.warning);

  // 2. System uptime (< 10 min = suspect)
  const uptime = checkUptime();
  if (uptime.warning) warnings.push(uptime.warning);
  const shortUptime = uptime.uptimeMinutes > 0 && uptime.uptimeMinutes * 60000 < MIN_UPTIME_MS;

  // 3. User interaction (no input in 5 min = suspect)
  const input = checkUserInteraction();
  if (input.warning) warnings.push(input.warning);
  const noInteraction = input.lastInputSeconds > MAX_IDLE_MS / 1000;

  // 4. VM artifacts
  const vm = checkVMArtifacts();
  for (const hint of vm.hints) {
    warnings.push(hint);
  }

  // 5. Suspicious processes
  const suspiciousProcs = checkSuspiciousProcesses();
  for (const p of suspiciousProcs) {
    warnings.push(`Suspicious process detected: ${p}`);
  }

  // Aggregate
  const likelySandbox = shortUptime || vm.isVM || noInteraction;
  const isStrict = envFlag('JSHOOK_ANTI_ANALYSIS_STRICT');
  const shouldProceed = isStrict
    ? !dbg.isDebugged && !likelySandbox && suspiciousProcs.length === 0
    : !dbg.isDebugged;

  const result: AntiAnalysisResult = {
    isDebugged: dbg.isDebugged,
    likelySandbox,
    uptimeMinutes: uptime.uptimeMinutes,
    lastUserInputSeconds: input.lastInputSeconds,
    suspiciousProcesses: suspiciousProcs,
    shouldProceed,
    warnings,
  };

  cachedResult = result;

  if (!result.shouldProceed) {
    logger.warn('Anti-analysis check failed — native modules will not load', {
      isDebugged: result.isDebugged,
      likelySandbox: result.likelySandbox,
      warnings: result.warnings,
    });
  } else if (result.warnings.length > 0) {
    logger.debug('Anti-analysis warnings (non-blocking)', { warnings: result.warnings });
  }

  return result;
}

/** Reset cached result (for testing). */
export function resetAntiAnalysisCache(): void {
  cachedResult = null;
}
