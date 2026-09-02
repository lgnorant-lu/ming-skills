/**
 * Anti-detection handler — orchestrates AMSI/ETW patching, kernel callback
 * detection, instrumentation callback detection, process masquerading, and
 * self-defense from a single `memory_antidetection` tool.
 *
 * Actions:
 *   check   — run all detectors, returns a comprehensive report
 *   harden  — apply all patches + masquerading + self-defense
 *   status  — current protection status (read-only, no side effects)
 */

import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { argEnum, argBool } from '@server/domains/shared/parse-args';

const VALID_ACTIONS = new Set(['check', 'harden', 'status'] as const);
type AntiDetectionAction = 'check' | 'harden' | 'status';

export class AntiDetectionHandlers {
  /**
   * Dispatch memory_antidetection tool calls.
   */
  handleAntiDetection(args: Record<string, unknown>): Promise<unknown> {
    return handleSafe(async () => {
      const action = argEnum(args, 'action', VALID_ACTIONS, 'check') as AntiDetectionAction;
      const includeDetails = argBool(args, 'includeDetails', false);

      switch (action) {
        case 'check':
          return this.handleCheck(includeDetails);
        case 'harden':
          return this.handleHarden(includeDetails);
        case 'status':
          return this.handleStatus();
        default:
          throw new Error(`memory_antidetection: unknown action "${action}"`);
      }
    });
  }

  /**
   * Run all detectors and return a comprehensive report.
   * Read-only — no patches or modifications applied.
   */
  private async handleCheck(includeDetails: boolean): Promise<unknown> {
    const results: Record<string, unknown> = {};
    const warnings: string[] = [];

    // 1. AMSI/ETW patch status
    try {
      const { isPatched, getPatchDetails, getPatchError, getEtwMonitoringSummary } =
        await import('@src/native/syscall/InProcessPatcher');
      if (includeDetails) {
        results.amsiEtwPatches = {
          patched: isPatched(),
          details: getPatchDetails(),
          error: getPatchError(),
        };
      } else {
        results.amsiEtwPatches = { patched: isPatched() };
      }

      // Add ETW monitoring summary
      const summary = getEtwMonitoringSummary();
      results.etwMonitoring = {
        activeSessions: summary.activeSessions,
        kernelTraceActive: summary.kernelTraceActive,
        threatIntelActive: summary.threatIntelActive,
        canStopSessions: summary.canStopSessions,
        ...(includeDetails ? { monitoredProviders: summary.monitoredProviders } : {}),
      };
    } catch (err) {
      results.amsiEtwPatches = {
        patched: false,
        error: `Module load failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      results.etwMonitoring = {
        activeSessions: 0,
        kernelTraceActive: false,
        threatIntelActive: false,
        canStopSessions: false,
      };
    }

    // 2. Kernel callback detection
    try {
      const { detectKernelCallbacks } = await import('@src/native/syscall/KernelCallbackDetector');
      const report = detectKernelCallbacks();
      const kcResult: Record<string, unknown> = {
        verdict: report.verdict,
        detectedDrivers: includeDetails
          ? report.detectedDrivers
          : report.detectedDrivers.map((d) => ({ name: d.name, category: d.category })),
        threatIntelEtwActive: report.threatIntelEtwActive,
        activeKernelTraceSessions: includeDetails ? report.activeKernelTraceSessions : [],
        suspiciousHandleCount: report.suspiciousHandles.length,
      };

      if (report.verdict === 'hostile') {
        warnings.push(
          `Hostile kernel environment detected: ${report.detectedDrivers.map((d) => d.name).join(', ')}`,
        );
      } else if (report.verdict === 'suspicious') {
        warnings.push('Suspicious kernel signals detected — possible EDR/AV monitoring');
      }

      if (includeDetails) {
        kcResult.limitations = report.limitations;
        kcResult.suspiciousHandles = report.suspiciousHandles;
      }
      results.kernelCallbacks = kcResult;
    } catch (err) {
      results.kernelCallbacks = {
        verdict: 'unknown',
        error: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Instrumentation callback detection
    try {
      const { detectInstrumentationCallback } =
        await import('@src/native/syscall/InstrumentationCallbackDetector');
      const report = detectInstrumentationCallback();
      const icResult: Record<string, unknown> = {
        likelyActive: report.likelyActive,
        confidence: report.confidence,
        cfgEnabled: report.cfgEnabled,
        status: report.status,
        canBypass: report.canBypass,
      };

      if (report.likelyActive && report.confidence === 'high') {
        warnings.push(
          'KERNEL INSTRUMENTATION ACTIVE — full stealth requires ring-0. ' +
            'All syscalls are intercepted.',
        );
      }

      if (includeDetails) {
        icResult.recommendation = report.recommendation;
        icResult.limitations = report.limitations;
        icResult.avgSyscallLatencyNs = report.avgSyscallLatencyNs;
      }
      results.instrumentationCallback = icResult;
    } catch (err) {
      results.instrumentationCallback = {
        likelyActive: false,
        error: `Detection failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 4. Chaos scanner mode
    try {
      const { isChaosModeEnabled } = await import('@src/native/syscall/ChaosScanner');
      results.chaosMode = { enabled: isChaosModeEnabled() };
    } catch {
      results.chaosMode = { enabled: false };
    }

    // 5. Platform info
    results.platform = {
      os: process.platform,
      isWindows: process.platform === 'win32',
    };

    return {
      success: true,
      action: 'check',
      results,
      warnings,
      summary: this.buildSummary(results, warnings),
    };
  }

  /**
   * Apply all patches and defensive measures.
   * Destructive — modifies process state.
   */
  private async handleHarden(includeDetails: boolean): Promise<unknown> {
    const results: Record<string, unknown> = {};
    const warnings: string[] = [];

    if (process.platform !== 'win32') {
      return {
        success: false,
        action: 'harden',
        error: 'Anti-detection hardening is only available on Windows (win32)',
      };
    }

    // 1. Apply AMSI/ETW patches (layer 1) + NtTraceControl hardening (layers 2-3)
    try {
      const { hardenEtwProviders, getPatchDetails, getPatchError } =
        await import('@src/native/syscall/InProcessPatcher');
      const etwResult = hardenEtwProviders();
      results.amsiEtwPatches = {
        applied: etwResult.inProcessPatched,
        details: includeDetails ? getPatchDetails() : undefined,
        error: etwResult.inProcessPatched ? undefined : getPatchError(),
        sessionStops: etwResult.sessionStops
          .filter((s) => s.attempted)
          .map((s) => ({ success: s.success, action: s.action, error: s.error })),
        providerDisables: etwResult.providerDisables
          .filter((p) => p.attempted)
          .map((p) => ({ success: p.success, action: p.action, error: p.error })),
        anySuccess: etwResult.anySuccess,
        limitations: includeDetails ? etwResult.limitations : undefined,
      };
      if (!etwResult.anySuccess) {
        warnings.push(
          `AMSI/ETW hardening: no layers succeeded — ${getPatchError() ?? 'check privileges'}`,
        );
      }
      if (etwResult.sessionStops.some((s) => s.privilegeMissing)) {
        warnings.push(
          'Kernel ETW session stop requires SYSTEM privilege — only user-mode patches applied',
        );
      }
    } catch (err) {
      results.amsiEtwPatches = {
        applied: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 2. Apply self-defense (MUST run before masquerade — masquerade obfuscates
    //    env vars, and self-defense reads JSHOOK_SELFDEFENSE from process.env)
    try {
      const { applySelfDefense } = await import('@src/native/syscall/SelfDefense');
      const defenseReport = applySelfDefense();
      results.selfDefense = {
        handleMonitorActive: defenseReport.handleMonitorActive,
        windowHidden: defenseReport.windowHidden,
        terminationProtected: defenseReport.terminationProtected,
        priorityProtected: defenseReport.priorityProtected,
      };

      // terminationProtected is always false (stub) — no BSOD warning needed
    } catch (err) {
      results.selfDefense = {
        applied: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. Apply process masquerade (safe: runs AFTER self-defense so env vars
    //    are already read by the time masquerade obfuscates them)
    try {
      const { applyProcessMasquerade } = await import('@src/native/syscall/ProcessMasquerade');
      const masqResult = applyProcessMasquerade();
      results.masquerade = {
        applied: masqResult.applied,
        details: includeDetails ? masqResult.results : Object.keys(masqResult.results),
      };
      if (!masqResult.applied) {
        warnings.push('Process masquerade: no measures applied');
      }
    } catch (err) {
      results.masquerade = {
        applied: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 4. Chaos mode status
    try {
      const { isChaosModeEnabled } = await import('@src/native/syscall/ChaosScanner');
      results.chaosMode = { enabled: isChaosModeEnabled() };
    } catch {
      results.chaosMode = { enabled: false };
    }

    return {
      success: true,
      action: 'harden',
      results,
      warnings,
      summary: this.buildSummary(results, warnings),
    };
  }

  /**
   * Read-only status check — returns the current protection state without side effects.
   */
  private async handleStatus(): Promise<unknown> {
    if (process.platform !== 'win32') {
      return {
        success: true,
        action: 'status',
        platform: process.platform,
        message: 'Anti-detection status is only meaningful on Windows',
        patched: false,
        chaosMode: false,
        selfDefenseActive: false,
        masqueradeActive: false,
      };
    }

    let patched = false;
    let chaosMode = false;
    let selfDefenseActive = false;
    const masqueradeActive = false;

    try {
      const { isPatched } = await import('@src/native/syscall/InProcessPatcher');
      patched = isPatched();
    } catch {
      /* ignore */
    }

    try {
      const { isChaosModeEnabled } = await import('@src/native/syscall/ChaosScanner');
      chaosMode = isChaosModeEnabled();
    } catch {
      /* ignore */
    }

    try {
      const { getSuspiciousHandleCount } = await import('@src/native/syscall/SelfDefense');
      selfDefenseActive = getSuspiciousHandleCount() > 0;
    } catch {
      /* ignore */
    }

    return {
      success: true,
      action: 'status',
      platform: process.platform,
      patched,
      chaosMode,
      selfDefenseActive,
      masqueradeActive,
    };
  }

  private buildSummary(results: Record<string, unknown>, warnings: string[]): string {
    const parts: string[] = [];

    const kc = results.kernelCallbacks as Record<string, unknown> | undefined;
    if (kc?.verdict === 'hostile') {
      parts.push('Hostile kernel environment detected');
    } else if (kc?.verdict === 'suspicious') {
      parts.push('Suspicious kernel signals');
    } else {
      parts.push('Kernel environment appears clean');
    }

    const ic = results.instrumentationCallback as Record<string, unknown> | undefined;
    if (ic?.likelyActive) {
      parts.push(`Instrumentation callback likely active (${ic.confidence})`);
    }

    const patches = results.amsiEtwPatches as Record<string, unknown> | undefined;
    if (patches?.patched || patches?.applied) {
      parts.push('AMSI/ETW patches active');
    }

    if (warnings.length > 0) {
      parts.push(`${warnings.length} warning(s)`);
    }

    return parts.join('. ') || 'No anti-detection measures applied';
  }
}
