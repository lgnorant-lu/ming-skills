import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectKernelCallbacks,
  enumerateHandleOwners,
  resetKernelCallbackCache,
} from '@src/native/syscall/KernelCallbackDetector';

describe('KernelCallbackDetector', () => {
  beforeEach(() => {
    resetKernelCallbackCache();
  });

  describe('detectKernelCallbacks', () => {
    it('returns a valid report on non-Windows platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const report = detectKernelCallbacks();
      expect(report.detectedDrivers).toEqual([]);
      expect(report.suspiciousHandles).toEqual([]);
      expect(report.activeKernelTraceSessions).toEqual([]);
      expect(report.threatIntelEtwActive).toBe(false);
      expect(report.verdict).toBe('clean');
      expect(report.checkedAt).toBeGreaterThan(0);
      expect(report.limitations.length).toBeGreaterThan(0);

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('includes honest limitations about kernel callbacks', () => {
      const report = detectKernelCallbacks();

      const limitations = report.limitations.join(' ');
      // Must mention key kernel boundaries
      expect(limitations).toMatch(/ObRegisterCallbacks/i);
      expect(limitations).toMatch(/PsSetCreateProcessNotifyRoutine/i);
      expect(limitations).toMatch(/ETW-TI/i);
    });

    it('report contains all required fields', () => {
      const report = detectKernelCallbacks();

      // Verify structure
      expect(report).toHaveProperty('detectedDrivers');
      expect(report).toHaveProperty('suspiciousHandles');
      expect(report).toHaveProperty('activeKernelTraceSessions');
      expect(report).toHaveProperty('threatIntelEtwActive');
      expect(report).toHaveProperty('verdict');
      expect(report).toHaveProperty('limitations');
      expect(report).toHaveProperty('checkedAt');

      expect(Array.isArray(report.detectedDrivers)).toBe(true);
      expect(Array.isArray(report.suspiciousHandles)).toBe(true);
      expect(Array.isArray(report.activeKernelTraceSessions)).toBe(true);
      expect(Array.isArray(report.limitations)).toBe(true);
      expect(typeof report.threatIntelEtwActive).toBe('boolean');
      expect(['clean', 'suspicious', 'hostile']).toContain(report.verdict);
    });

    it('verdict defaults to clean with zero findings', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      try {
        const report = detectKernelCallbacks();
        expect(report.verdict).toBe('clean');
        expect(report.detectedDrivers).toEqual([]);
        expect(report.suspiciousHandles).toEqual([]);
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true,
        });
      }
    });

    it('caches results — second call returns same object', () => {
      const report1 = detectKernelCallbacks();
      const report2 = detectKernelCallbacks();
      expect(report1).toBe(report2);
    });

    it('resetKernelCallbackCache clears cached result', () => {
      const report1 = detectKernelCallbacks();
      resetKernelCallbackCache();
      const report2 = detectKernelCallbacks();
      // Different call should produce a new object
      expect(report1).not.toBe(report2);
    });
  });

  describe('enumerateHandleOwners', () => {
    it('returns empty on non-Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = enumerateHandleOwners(1234);
      expect(result.owners).toEqual([]);
      expect(result.error).toContain('Only available on Windows');

      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    it('uses process.pid as default', () => {
      // This just verifies the function runs without throwing
      const result = enumerateHandleOwners();
      expect(result).toHaveProperty('owners');
      expect(result).toHaveProperty('error');
    });
  });
});
