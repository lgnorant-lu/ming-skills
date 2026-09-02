/**
 * Regression test: koffi optional-化后, a missing koffi binding must NOT crash
 * memory/process domain activation.
 *
 * Before the fix, 22 native files statically imported `koffi` at module top
 * level. When koffi's native binding is absent (prebuild download failure,
 * --no-optional install, or compile failure) the static import throws
 * MODULE_NOT_FOUND at module-load time, before `isKoffiBindingUsable()`'s
 * try-catch can run — so memory/process domain activation crashed outright.
 *
 * This test simulates that absence by making `import('koffi')` reject, then
 * asserts the whole transitive import chain (native FFI modules + domain
 * handlers) loads cleanly and degrades to a descriptive error instead.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Simulate koffi absence — hoisted above every import in this file (and its
// transitive imports), matching "package/binding missing" at load time.
vi.mock('koffi', () => {
  throw new Error("Cannot find module 'koffi'");
});

// Force Win32 so the Win32-only koffi code paths are exercised by the
// degradation assertions below (mirrors Win32API.test.ts).
const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

import { getKernel32, isKoffiBindingUsable, isWindows } from '@src/native/Win32API';
import { enumerateProcessHandles } from '@src/native/HandleEnumerator';
import { detectApcInjection } from '@src/native/APCDetector';
import { requireKoffi } from '@src/native/koffi-loader';

describe('koffi-missing graceful degradation', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('imports Win32API without crashing and reports koffi unavailable', () => {
    expect(isWindows()).toBe(true);
    expect(isKoffiBindingUsable()).toBe(false);
  });

  it('requireKoffi() throws a descriptive error instead of crashing', () => {
    expect(() => requireKoffi()).toThrow(/koffi native library is not available/);
  });

  it('getKernel32() throws a descriptive error instead of crashing', () => {
    expect(() => getKernel32()).toThrow(/koffi native library is not available/);
  });

  it('handle enumeration degrades to a descriptive error', () => {
    const result = enumerateProcessHandles(999, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('koffi native library is not available');
  });

  it('APC detection degrades to a descriptive error', () => {
    const result = detectApcInjection(999);
    expect(result.success).toBe(false);
    expect(result.error).toContain('koffi native library is not available');
  });

  it('transitive activation chain imports without crashing', async () => {
    // Native FFI modules on the memory/process activation path.
    await expect(import('@src/native/Win32Debug')).resolves.toBeDefined();
    await expect(import('@src/native/HeapAnalyzer')).resolves.toBeDefined();
    await expect(import('@src/native/VehDebugger')).resolves.toBeDefined();
    await expect(import('@src/native/platform/factory')).resolves.toBeDefined();

    // Domain handler entry points (static native imports).
    await expect(import('@server/domains/memory/handlers/handle-enum')).resolves.toBeDefined();
    await expect(import('@server/domains/memory/handlers/trace-code')).resolves.toBeDefined();
    await expect(import('@server/domains/process/handlers/apc-detection')).resolves.toBeDefined();
    await expect(
      import('@server/domains/process/handlers/handle-enumeration'),
    ).resolves.toBeDefined();
    await expect(
      import('@server/domains/process/handlers/hollowing-detection'),
    ).resolves.toBeDefined();
  });
});
