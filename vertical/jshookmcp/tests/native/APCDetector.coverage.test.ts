/**
 * Coverage tests for APCDetector.detectApcInjection — the FFI layer is mocked
 * so the Toolhelp32 snapshot returns an invalid handle, exercising the
 * "no threads found" early return + the top-level try/catch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ffiCall = vi.fn();
const funcFactory = vi.fn(() => ffiCall);
const mockHandle = { func: funcFactory };

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => mockHandle),
    address: vi.fn((buf: unknown) => buf),
  },
}));

vi.mock('@native/Win32API', () => ({
  getKernel32: vi.fn(() => mockHandle),
  getNtdll: vi.fn(() => mockHandle),
}));

import { detectApcInjection } from '@native/APCDetector';

beforeEach(() => {
  ffiCall.mockReset();
});

describe('detectApcInjection — no-threads path', () => {
  it('returns the structured "no threads" result when the snapshot is invalid', () => {
    // Snapshot FFI returns 0 (invalid handle) → enumThreadsByPid yields [] →
    // detectApcInjection returns success=false with "No threads found".
    ffiCall.mockReturnValue(0);
    const r = detectApcInjection(1234);
    expect(r.success).toBe(false);
    expect(r.threadCount).toBe(0);
    expect(r.requiresElevation).toBe(true);
    expect(r.error).toMatch(/No threads found|access denied/);
  });

  it('returns a clean verdict-shaped result on a zero-thread enumeration', () => {
    ffiCall.mockReturnValue(0);
    const r = detectApcInjection(99);
    expect(r.verdict).toBe('clean');
    expect(r.confidence).toBe(0);
    expect(r.suspiciousThreads).toBe(0);
  });
});
