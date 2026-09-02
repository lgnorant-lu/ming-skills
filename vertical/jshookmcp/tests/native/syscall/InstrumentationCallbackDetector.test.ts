import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectInstrumentationCallback,
  replaceInstrumentationCallback,
  resetInstrumentationCallbackCache,
} from '@src/native/syscall/InstrumentationCallbackDetector';

describe('InstrumentationCallbackDetector', () => {
  beforeEach(() => {
    resetInstrumentationCallbackCache();
  });

  describe('detectInstrumentationCallback', () => {
    it('returns a valid report', () => {
      const report = detectInstrumentationCallback();

      expect(report).toHaveProperty('likelyActive');
      expect(report).toHaveProperty('confidence');
      expect(report).toHaveProperty('method');
      expect(report).toHaveProperty('status');
      expect(report).toHaveProperty('cfgEnabled');
      expect(report).toHaveProperty('canBypass');
      expect(report).toHaveProperty('recommendation');
      expect(report).toHaveProperty('limitations');
      expect(report).toHaveProperty('avgSyscallLatencyNs');

      expect(typeof report.likelyActive).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(report.confidence);
      expect(['ntqip_rejection', 'ntsip_attempt', 'syscall_timing', 'unavailable']).toContain(
        report.method,
      );
      expect(typeof report.status).toBe('string');
      expect(report.status.length).toBeGreaterThan(0);
      expect(typeof report.cfgEnabled).toBe('boolean');
      expect(typeof report.canBypass).toBe('boolean');
      expect(typeof report.recommendation).toBe('string');
      expect(report.recommendation.length).toBeGreaterThan(0);
      expect(Array.isArray(report.limitations)).toBe(true);
    });

    it('includes honest limitations', () => {
      const report = detectInstrumentationCallback();

      const limitations = report.limitations.join(' ');
      expect(limitations).toMatch(/NtQueryInformationProcess/i);
    });

    it('caches result — second call returns same object', () => {
      const report1 = detectInstrumentationCallback();
      const report2 = detectInstrumentationCallback();
      expect(report1).toBe(report2);
    });

    it('resetInstrumentationCallbackCache clears cache', () => {
      const report1 = detectInstrumentationCallback();
      resetInstrumentationCallbackCache();
      const report2 = detectInstrumentationCallback();
      expect(report1).not.toBe(report2);
    });

    it('on non-Windows, CFG is reported as disabled', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const report = detectInstrumentationCallback();
      expect(report.cfgEnabled).toBe(false);

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });

  describe('replaceInstrumentationCallback', () => {
    it('returns failure on non-Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = replaceInstrumentationCallback(0x1000n);
      expect(result.success).toBe(false);
      expect(result.warning).toContain('Not on Windows');

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });
  });
});
