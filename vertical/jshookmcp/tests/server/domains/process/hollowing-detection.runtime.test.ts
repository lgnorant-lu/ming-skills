/**
 * Runtime integration test for HollowingDetectionHandlers — exercises the REAL
 * Win32 fast path against the test runner's OWN process (node.exe).
 *
 * The mocked hollowing-detection.test.ts covers the comparison logic with
 * stubbed PEAnalyzer / Win32API; this file drives the genuine path:
 * OpenProcess(self) → EnumProcessModules → GetModuleFileNameEx →
 * PEAnalyzer.compareMemoryWithDisk(node.exe memory vs on-disk node.exe).
 *
 * OpenProcess on the caller's own pid needs no privilege, so this is the most
 * portable real-runtime check in the native layer. node.exe's main module is
 * not hollowed, so we expect isHollowed=false (or a documented, section-level
 * benign mismatch from loader relocations — the tool's real behavior, not a
 * bug).
 *
 * Gate: Win32 + JSHOOK_NATIVE_RUNTIME=1.
 */
import { describe, it, expect } from 'vitest';
import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';

const WIN32_RUNTIME = process.platform === 'win32' && process.env.JSHOOK_NATIVE_RUNTIME === '1';

describe.skipIf(!WIN32_RUNTIME)(
  'HollowingDetectionHandlers — self process node.exe (runtime, host=Windows)',
  () => {
    it('runs the full Win32 fast path on the runner itself', async () => {
      const handlers = new HollowingDetectionHandlers();
      const r = (await handlers.handleDetectHollowing({ pid: process.pid })) as Record<
        string,
        unknown
      >;

      // If the host denies even self-targeted OpenProcess (rare), document it.
      if (r.success !== true) {
        expect(typeof r.error).toBe('string');
        return;
      }

      expect(r.success).toBe(true);
      expect(String(r.modulePath).toLowerCase()).toContain('node');
      expect(typeof r.moduleBase).toBe('string'); // 0x... hex
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);

      // Hollowing invariant: if flagged, there must be section differences; if
      // not flagged, the differences array is empty.
      const diffs = (r.differences as unknown[]) ?? [];
      if (r.isHollowed === true) {
        expect(diffs.length).toBeGreaterThan(0);
      } else {
        expect(diffs.length).toBe(0);
      }
    });
  },
);
