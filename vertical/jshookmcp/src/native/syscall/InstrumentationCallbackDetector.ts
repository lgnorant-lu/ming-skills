/**
 * InstrumentationCallbackDetector — detects the ProcessInstrumentationCallback.
 *
 * The ProcessInstrumentationCallback (NtSetInformationProcess class 0x28 / 40)
 * is an undocumented Windows mechanism that intercepts EVERY kernel-to-user
 * transition (syscall returns, APC delivery, exception dispatch) within a
 * process. Anti-cheat systems (EAC, BattlEye, Vanguard) and some EDRs use
 * it to validate syscall origins.
 *
 * ## What this module does:
 *
 * 1. **Detection**: Attempts to detect if an instrumentation callback is
 *    active on the current process. NtQueryInformationProcess does NOT
 *    support querying class 0x28, so we use indirect methods:
 *    - A. Try setting our own null callback (under CFG, we can only
 *         REPLACE, not nullify). If NtSetInformationProcess(0x28, NULL)
 *         succeeds, no callback was set.
 *    - B. If it fails with a specific NTSTATUS, a callback may be active
 *         (or CFG is blocking us).
 *    - C. Heuristic: measure syscall latency — an active IC adds ~50-200ns
 *         per syscall, detectable with statistical sampling.
 *
 * 2. **Reporting**: Honest assessment of the situation. If an IC is active:
 *    - "kernel instrumentation active — full stealth requires ring-0"
 *    - The IC intercepts ALL syscalls, including our NtReadVirtualMemory
 *      and NtWriteVirtualMemory calls
 *    - Bypass from user-mode requires callback chaining (reading the old
 *      IC address from R10 after a syscall, then proxying to it)
 *
 * 3. **CFG-aware replacement**: Under Control Flow Guard, we cannot set
 *    the IC to NULL. Instead, we can set it to a valid CFG target that
 *    simply jumps to R10 (normal return). This effectively neutralizes
 *    the IC without triggering CFG violations.
 *
 * @module InstrumentationCallbackDetector
 */

import { logger } from '@utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface InstrumentationCallbackReport {
  /** Whether an instrumentation callback is likely active. */
  likelyActive: boolean;
  /** Confidence: low (heuristic), medium (NtSetInformationProcess failure), high (confirmed) */
  confidence: 'low' | 'medium' | 'high';
  /** Detection method used. */
  method: 'ntqip_rejection' | 'ntsip_attempt' | 'syscall_timing' | 'unavailable';
  /** Human-readable status description. */
  status: string;
  /** Whether CFG (Control Flow Guard) is enabled for this process. */
  cfgEnabled: boolean;
  /** Whether the IC can be bypassed from user-mode. */
  canBypass: boolean;
  /** Recommended action. */
  recommendation: string;
  /** Honest limitations. */
  limitations: string[];
  /** NTSTATUS from the detection attempt (if applicable). */
  ntStatus?: number;
  /** Average syscall round-trip in nanoseconds (if timing method used). */
  avgSyscallLatencyNs?: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PROCESS_INSTRUMENTATION_CALLBACK = 0x28;

/**
 * Expected NTSTATUS codes:
 * - STATUS_SUCCESS (0x00000000): IC was NOT set, our attempt to clear succeeded
 *   (or we successfully set a new callback).
 * - STATUS_ACCESS_DENIED (0xC0000022): IC was already set OR CFG blocked us.
 * - STATUS_NOT_IMPLEMENTED (0xC0000002): Not supported on this Windows version
 *   (pre-Win10 RS3).
 * - STATUS_INVALID_PARAMETER (0xC000000D): Our input buffer was wrong.
 * - STATUS_UNSUCCESSFUL (0xC0000001): Generic failure.
 */

/** Baseline syscall latency in ns for a normal process (no IC). */
const BASELINE_SYSCALL_LATENCY_NS = 200; // ~200ns for a simple syscall without IC

/** Threshold multiplier: if avg latency > baseline * threshold, IC is likely active. */
const IC_LATENCY_THRESHOLD_MULTIPLIER = 2.5; // 2.5x baseline = 500ns

/** Number of syscall samples for timing measurement. */
const TIMING_SAMPLE_COUNT = 1000;

// ── Detection Implementations ────────────────────────────────────────────────

/**
 * Method A: Try to set the IC to NULL and observe the result.
 *
 * This is the most direct detection method. We call NtSetInformationProcess
 * with class 0x28 and NULL callback address. Under CFG, NULL is rejected
 * by MmValidateUserCallTarget, but we can still infer state from the error.
 *
 * - STATUS_SUCCESS: No IC was set (or we successfully replaced it — unlikely
 *   with NULL under CFG).
 * - STATUS_ACCESS_DENIED: An IC is likely already set (or CFG blocked NULL).
 * - Other: Cannot determine.
 */
function detectViaNtSetInformationProcess(): {
  likelyActive: boolean;
  ntStatus?: number;
  cfgEnabled: boolean;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { likelyActive: false, cfgEnabled: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtSetInformationProcess = ntdll.func(
      'int32 NtSetInformationProcess(void *, uint32, _In_ void *, uint32)',
    );

    // GetCurrentProcess pseudo-handle = -1 (0xFFFFFFFFFFFFFFFF on x64)
    const currentProcess = BigInt('0xFFFFFFFFFFFFFFFF');

    // Try to set IC to NULL
    const nullCallback = Buffer.alloc(8); // 8 zero bytes
    const status = NtSetInformationProcess(
      currentProcess,
      PROCESS_INSTRUMENTATION_CALLBACK,
      koffi.address(nullCallback),
      8,
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    // Check if CFG is enabled via GetProcessMitigationPolicy
    const cfgEnabled = checkCFGEnabled();

    if (status === 0) {
      // STATUS_SUCCESS: No IC was set. We just cleared nothing.
      return { likelyActive: false, ntStatus: status, cfgEnabled };
    }

    if (status === 0xc0000022) {
      // STATUS_ACCESS_DENIED: IC was already set (and we tried to overwrite)
      // OR CFG blocked the NULL callback
      return { likelyActive: !cfgEnabled, ntStatus: status, cfgEnabled };
    }

    // Other status codes — indeterminate
    return {
      likelyActive: false,
      ntStatus: status,
      cfgEnabled,
      error: `NtSetInformationProcess returned 0x${(status >>> 0).toString(16)}`,
    };
  } catch {
    return { likelyActive: false, cfgEnabled: false, error: 'koffi unavailable' };
  }
}

/**
 * Check if Control Flow Guard is enabled for this process.
 *
 * Uses GetProcessMitigationPolicy with ProcessControlFlowGuardPolicy.
 */
function checkCFGEnabled(): boolean {
  if (process.platform !== 'win32') return false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');

    const GetProcessMitigationPolicy = k32.func(
      'int GetProcessMitigationPolicy(void *, int32, _Out_ void *, uint32)',
    );

    const ProcessControlFlowGuardPolicy = 9;
    const currentProcess = BigInt('0xFFFFFFFFFFFFFFFF');

    // PROCESS_MITIGATION_CONTROL_FLOW_GUARD_POLICY is 8 bytes
    const policy = Buffer.alloc(8);
    const result = GetProcessMitigationPolicy(
      currentProcess,
      ProcessControlFlowGuardPolicy,
      koffi.address(policy),
      8,
    );

    try {
      k32.unload();
    } catch {
      /* ignore */
    }

    if (!result) return false;

    // Bit 0: EnableControlFlowGuard
    return (policy.readUInt32LE(0) & 0x1) !== 0;
  } catch {
    return false;
  }
}

/**
 * Method B: Measure syscall latency to detect IC overhead.
 *
 * An active InstrumentationCallback adds overhead to EVERY syscall return
 * (the kernel swaps RIP before sysret, and the callback must restore it).
 * This adds ~50-200ns per syscall. We measure NtYieldExecution (the
 * simplest possible syscall) and compare against baseline.
 *
 * This is a statistical method — not definitive, but useful when
 * NtSetInformationProcess is unavailable or fails ambiguously.
 */
function detectViaSyscallTiming(): {
  likelyActive: boolean;
  avgLatencyNs?: number;
  error?: string;
} {
  if (process.platform !== 'win32') {
    return { likelyActive: false, error: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtYieldExecution = ntdll.func('int32 NtYieldExecution()');

    // Warm up
    for (let i = 0; i < 100; i++) {
      NtYieldExecution();
    }

    // Measure
    const latencies: number[] = [];
    for (let i = 0; i < TIMING_SAMPLE_COUNT; i++) {
      const start = process.hrtime.bigint();
      NtYieldExecution();
      const end = process.hrtime.bigint();
      latencies.push(Number(end - start));
    }

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    // Compute median (more robust than mean against outliers)
    latencies.sort((a, b) => a - b);
    const median = latencies[Math.floor(latencies.length / 2)]!;

    const likelyActive = median > BASELINE_SYSCALL_LATENCY_NS * IC_LATENCY_THRESHOLD_MULTIPLIER;

    return { likelyActive, avgLatencyNs: median };
  } catch {
    return { likelyActive: false, error: 'Syscall timing unavailable' };
  }
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

let cachedResult: InstrumentationCallbackReport | null = null;

/**
 * Detect if a ProcessInstrumentationCallback is active on this process.
 *
 * Tries multiple detection methods in order of reliability:
 * 1. NtSetInformationProcess (most direct, but may be blocked by CFG)
 * 2. Syscall timing (statistical, always available)
 *
 * @returns Detailed report with detection results and recommendations.
 */
export function detectInstrumentationCallback(): InstrumentationCallbackReport {
  if (cachedResult) return cachedResult;

  const limitations: string[] = [
    'NtQueryInformationProcess does NOT support querying class 0x28',
    'Under CFG, NULL callback is rejected — cannot fully neutralize IC',
    'Syscall timing is statistical, not definitive (VM/throttling can affect results)',
    'Callback chaining requires reading R10 register after each syscall',
  ];

  // Method 1: Direct NtSetInformationProcess attempt
  const ntsipResult = detectViaNtSetInformationProcess();

  // Method 2: Syscall timing
  const timingResult = detectViaSyscallTiming();

  // Combine results
  let likelyActive = ntsipResult.likelyActive || timingResult.likelyActive;
  let confidence: InstrumentationCallbackReport['confidence'] = 'low';
  let method: InstrumentationCallbackReport['method'] = 'ntsip_attempt';

  if (ntsipResult.likelyActive) {
    confidence = 'high';
    method = 'ntsip_attempt';
  } else if (timingResult.likelyActive) {
    confidence = 'medium';
    method = 'syscall_timing';
  } else if (ntsipResult.ntStatus === 0xc0000022 && ntsipResult.cfgEnabled) {
    // CFG blocked us — indeterminate but worth flagging
    likelyActive = false;
    confidence = 'low';
    method = 'ntsip_attempt';
    limitations.push('CFG blocked NULL callback — cannot confirm IC absence');
  }

  const canBypass = !ntsipResult.cfgEnabled;
  let recommendation: string;

  if (likelyActive && confidence === 'high') {
    recommendation =
      'KERNEL INSTRUMENTATION ACTIVE — all syscalls are intercepted. ' +
      'Full stealth requires ring-0 access (BYOVD). User-mode options: ' +
      '1) callback chaining (read old IC from R10, proxy to it after filtering), ' +
      '2) avoid syscall-heavy operations, use memory-mapped files instead.';
  } else if (likelyActive && confidence === 'medium') {
    recommendation =
      'Syscall timing suggests instrumentation. Consider using indirect syscalls ' +
      'from ntdll.dll gadgets to appear legitimate, or use NtContinue-based spoofing.';
  } else if (!ntsipResult.cfgEnabled) {
    recommendation =
      'CFG is NOT enabled — IC can be set to a benign callback that proxies to ' +
      'the original (callback chaining). This allows filtering of detection-relevant ' +
      'events while maintaining normal appearance.';
  } else {
    recommendation = 'No instrumentation callback detected. Normal syscall path is available.';
  }

  const result: InstrumentationCallbackReport = {
    likelyActive,
    confidence,
    method,
    status: likelyActive
      ? `Instrumentation callback likely active (confidence: ${confidence}, method: ${method})`
      : `No instrumentation callback detected (method: ${method})`,
    cfgEnabled: ntsipResult.cfgEnabled,
    canBypass,
    recommendation,
    limitations,
    ntStatus: ntsipResult.ntStatus,
    avgSyscallLatencyNs: timingResult.avgLatencyNs,
  };

  cachedResult = result;

  if (likelyActive && confidence === 'high') {
    logger.warn('InstrumentationCallbackDetector: kernel instrumentation is ACTIVE', {
      confidence,
      cfgEnabled: ntsipResult.cfgEnabled,
      ntStatus: ntsipResult.ntStatus?.toString(16),
    });
  } else if (likelyActive) {
    logger.debug('InstrumentationCallbackDetector: possible instrumentation detected', {
      confidence,
      avgLatencyNs: timingResult.avgLatencyNs,
    });
  }

  return result;
}

/** Reset cached result (for testing). */
export function resetInstrumentationCallbackCache(): void {
  cachedResult = null;
}

/**
 * Attempt to replace the instrumentation callback with a benign proxy.
 *
 * CAUTION: This is potentially DANGEROUS. If the target process is
 * protected by an anti-cheat that monitors the IC address, replacing
 * it will be detected immediately (heartbeat failure).
 *
 * Only call this when you are certain the IC belongs to a passive
 * observer (not an anti-cheat with integrity checks).
 *
 * Under CFG: the proxy address must be a valid CFG target.
 * Without CFG: can set to any address.
 *
 * @param proxyAddress — Address of the replacement callback function.
 *   Must follow the IC calling convention: (RCX = syscall return value,
 *   R10 = original return RIP). Must jump to R10 to resume execution.
 * @returns NTSTATUS from NtSetInformationProcess.
 */
export function replaceInstrumentationCallback(proxyAddress: bigint): {
  success: boolean;
  ntStatus: number;
  warning: string;
} {
  if (process.platform !== 'win32') {
    return { success: false, ntStatus: -1, warning: 'Not on Windows' };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi');
    const ntdll = koffi.load('ntdll.dll');

    const NtSetInformationProcess = ntdll.func(
      'int32 NtSetInformationProcess(void *, uint32, _In_ void *, uint32)',
    );

    const currentProcess = BigInt('0xFFFFFFFFFFFFFFFF');

    const addrBuf = Buffer.alloc(8);
    addrBuf.writeBigUInt64LE(proxyAddress);

    const status = NtSetInformationProcess(
      currentProcess,
      PROCESS_INSTRUMENTATION_CALLBACK,
      koffi.address(addrBuf),
      8,
    ) as number;

    try {
      ntdll.unload();
    } catch {
      /* ignore */
    }

    if (status === 0) {
      return {
        success: true,
        ntStatus: status,
        warning: 'IC replaced. Anti-cheat heartbeat detection is likely. Proceed with caution.',
      };
    }

    return {
      success: false,
      ntStatus: status,
      warning: `IC replacement failed: 0x${(status >>> 0).toString(16)}. CFG may be blocking the proxy address.`,
    };
  } catch (err) {
    return {
      success: false,
      ntStatus: -1,
      warning: `IC replacement error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
