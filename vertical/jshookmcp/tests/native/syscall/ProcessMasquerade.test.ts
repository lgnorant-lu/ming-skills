import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import {
  applyProcessMasquerade,
  restoreProcessMasquerade,
} from '@src/native/syscall/ProcessMasquerade';
import type { MasqueradeConfig } from '@src/native/syscall/ProcessMasquerade';

describe('ProcessMasquerade', () => {
  let originalPlatform: NodeJS.Platform;

  beforeAll(() => {
    // applyProcessMasquerade is a Windows-only module — many of its koffi
    // branches early-return on non-Windows, which the unit tests below
    // don't want. Stub platform to win32 for the entire suite (restored
    // in afterAll). The dedicated "non-Windows" test below temporarily
    // toggles it back.
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('applyProcessMasquerade', () => {
    it('returns a valid structure with default config', () => {
      const result = applyProcessMasquerade();

      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('limitations');
      expect(result).toHaveProperty('applied');
      expect(typeof result.applied).toBe('boolean');
      expect(Array.isArray(result.limitations)).toBe(true);

      // Should have results for each enabled setting
      expect(result.results).toHaveProperty('mitigationPolicies');
      expect(result.results).toHaveProperty('backgroundPriority');
      expect(result.results).toHaveProperty('heapTermination');
      expect(result.results).toHaveProperty('parentPid');
    });

    it('includes honest limitations', () => {
      const result = applyProcessMasquerade();

      const limitations = result.limitations.join(' ');
      expect(limitations).toMatch(/EPROCESS/i);
      expect(limitations).toMatch(/ETW-TI/i);
      expect(limitations).toMatch(/digital signature/i);
    });

    it('includes v2 safety contract limitations', () => {
      const result = applyProcessMasquerade();

      const limitations = result.limitations.join(' ');
      expect(limitations).toMatch(/JSHOOK_\* env var KEYS remain visible/i);
      expect(limitations).toMatch(/BYOVD/i);
    });

    it('accepts custom config to disable settings', () => {
      const config: MasqueradeConfig = {
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
        randomizeCreationTime: false,
        obfuscateEnvValues: false,
      };

      const result = applyProcessMasquerade(config);

      // When all settings are disabled, only parentPid remains
      const keys = Object.keys(result.results);
      expect(keys).toContain('parentPid');
    });

    it('creation time randomization is disabled by default', () => {
      const result = applyProcessMasquerade();
      expect(result.results).not.toHaveProperty('creationTime');
    });

    it('creation time randomization enabled with config', () => {
      const config: MasqueradeConfig = { randomizeCreationTime: true };
      const result = applyProcessMasquerade(config);
      expect(result.results).toHaveProperty('creationTime');

      const ctResult = result.results['creationTime']!;
      expect(ctResult.applied).toBe(false);
      expect(ctResult.error).toBeDefined();
      expect(ctResult.error).toMatch(/native trampoline|in-process API hooking/i);
    });

    it('parentPid result always present with current PID info', () => {
      const result = applyProcessMasquerade();
      expect(result.results['parentPid']).toBeDefined();
      const ppid = result.results['parentPid']!;
      expect(ppid.applied).toBe(true);
    });

    it('applyProcessMasquerade on non-Windows still returns valid structure', () => {
      const realPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = applyProcessMasquerade();
      expect(result).toHaveProperty('applied');
      expect(result).toHaveProperty('limitations');
      // On non-Windows, getParentPid() returns an error so the lookup
      // result lands in `limitations` for visibility.
      expect(result.limitations.some((l) => l.includes('Parent PID'))).toBe(true);

      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
    });
  });

  describe('v2 env var obfuscation', () => {
    it('does NOT delete JSHOOK_* env vars', () => {
      vi.stubEnv('JSHOOK_MASQUERADE', '1');
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '1');

      const before = process.env['JSHOOK_SELFDEFENSE'];

      applyProcessMasquerade({ obfuscateEnvValues: true });

      // Key must still exist
      expect(process.env['JSHOOK_SELFDEFENSE']).toBeDefined();
      // Value must not be empty
      expect(process.env['JSHOOK_SELFDEFENSE']!.length).toBeGreaterThan(0);
      // Value should be obfuscated (prefixed with OBF:)
      const afterValue = process.env['JSHOOK_SELFDEFENSE']!;
      // Either unchanged (no JSHOOK_MASQUERADE flag) or obfuscated
      const isObfuscated =
        afterValue !== before || afterValue.startsWith('OBF:') || afterValue.length > before.length;
      expect(isObfuscated).toBe(true);

      // Restore
      restoreProcessMasquerade();
    });

    it('obfuscation is reversible via restoreProcessMasquerade', () => {
      vi.stubEnv('JSHOOK_MASQUERADE', '1');
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const originalValue = process.env['JSHOOK_SELFDEFENSE'];

      applyProcessMasquerade({ obfuscateEnvValues: true });
      restoreProcessMasquerade();

      // After restore, value should be back to original
      expect(process.env['JSHOOK_SELFDEFENSE']).toBe(originalValue);
    });

    it('restoreProcessMasquerade is safe to call when nothing obfuscated', () => {
      const result = restoreProcessMasquerade();
      expect(result).toHaveProperty('applied');
      expect(typeof result.applied).toBe('boolean');
    });

    it('env var keys are preserved after obfuscation', () => {
      vi.stubEnv('JSHOOK_MASQUERADE', '1');
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '1');

      applyProcessMasquerade({ obfuscateEnvValues: true });

      // All JSHOOK_* keys must still exist
      expect(process.env['JSHOOK_SELFDEFENSE']).toBeDefined();
      expect(process.env['JSHOOK_BYOVD_ENABLE']).toBeDefined();
      expect(process.env['JSHOOK_MASQUERADE']).toBeDefined();

      // Restore
      restoreProcessMasquerade();
    });
  });

  describe('v2 parent PID spoofing', () => {
    it('buildParentPid approach returns applied on Windows', () => {
      if (process.platform !== 'win32') return;

      const result = applyProcessMasquerade({
        spoofParentPid: 4, // System PID — can't open but tests the code path
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
      });

      expect(result.results).toHaveProperty('parentPidSpoof');
      const ppidSpoof = result.results['parentPidSpoof']!;
      expect(typeof ppidSpoof.applied).toBe('boolean');
    });

    it('spoofParentPid is not activated without config', () => {
      const result = applyProcessMasquerade();
      expect(result.results).not.toHaveProperty('parentPidSpoof');
    });

    it('self parent PID spoofing requires JSHOOK_BYOVD_ENABLE=1', () => {
      const result = applyProcessMasquerade({
        spoofSelfParentPid: 1234,
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
      });

      // Without BYOVD, should fail with clear error
      if (result.results.selfParentPidSpoof) {
        const selfSpoof = result.results['selfParentPidSpoof']!;
        expect(selfSpoof.applied).toBe(false);
        if (selfSpoof.error) {
          expect(selfSpoof.error).toMatch(/JSHOOK_BYOVD_ENABLE|BYOVD/i);
        }
      }
    });

    it('self parent PID spoofing with BYOVD flag attempts operation', () => {
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '1');

      const result = applyProcessMasquerade({
        spoofSelfParentPid: 1234,
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
      });

      expect(result.results).toHaveProperty('selfParentPidSpoof');
      const selfSpoof = result.results['selfParentPidSpoof']!;
      expect(typeof selfSpoof.applied).toBe('boolean');
      // On Windows, should have attempted the EPROCESS lookup
      if (process.platform === 'win32') {
        expect(selfSpoof.error).toBeDefined();
      }
    });

    it('self parent PID from env var JSHOOK_MASQUERADE_SELF_PPID', () => {
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '1');
      vi.stubEnv('JSHOOK_MASQUERADE_SELF_PPID', '5678');

      const result = applyProcessMasquerade({
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
      });

      expect(result.results).toHaveProperty('selfParentPidSpoof');
    });
  });

  describe('v2 safety contract', () => {
    it('env var keys are NEVER deleted', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '1');
      vi.stubEnv('JSHOOK_HYPERVISOR_ENABLE', '1');
      vi.stubEnv('JSHOOK_MASQUERADE', '1');

      // Apply masquerade with obfuscation
      applyProcessMasquerade({ obfuscateEnvValues: true });

      // All keys must still exist
      expect(process.env['JSHOOK_SELFDEFENSE']).toBeDefined();
      expect(process.env['JSHOOK_BYOVD_ENABLE']).toBeDefined();
      expect(process.env['JSHOOK_HYPERVISOR_ENABLE']).toBeDefined();

      // Restore
      restoreProcessMasquerade();
    });

    it('BYOVD operations are gated behind JSHOOK_BYOVD_ENABLE=1', () => {
      // Without BYOVD flag
      vi.stubEnv('JSHOOK_BYOVD_ENABLE', '0');
      const result = applyProcessMasquerade({
        spoofSelfParentPid: 1234,
        applyMitigationPolicies: false,
        backgroundPriority: false,
        disableHeapTermination: false,
      });

      if (result.results.selfParentPidSpoof) {
        const selfSpoof = result.results['selfParentPidSpoof']!;
        expect(selfSpoof.applied).toBe(false);
      }
    });

    it('limitations document the honest bounds of masquerading', () => {
      const result = applyProcessMasquerade();

      const limitationsStr = result.limitations.join(' ');
      // Should mention that parent PID spoofing needs BYOVD
      expect(limitationsStr).toMatch(/BYOVD|kernel R\/W/i);
      // Should mention that ETW-TI cannot be bypassed
      expect(limitationsStr).toMatch(/ETW-TI/i);
      // Should mention that keys stay visible
      expect(limitationsStr).toMatch(/keys.*visible/i);
    });
  });
});
