/**
 * Coverage tests for ApcDetectionHandlers.handleProcessDetectApc — exercises
 * pid validation, the platform guard, and the delegation to detectApcInjection
 * (mocked @native/APCDetector).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDetect = vi.fn();

vi.mock('@native/APCDetector', () => ({
  detectApcInjection: (...args: unknown[]) => mockDetect(...args),
}));

import { ApcDetectionHandlers } from '@server/domains/process/handlers/apc-detection';

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
});

beforeEach(() => {
  mockDetect.mockReset();
});

describe('ApcDetectionHandlers.handleProcessDetectApc', () => {
  it('rejects a non-positive pid', async () => {
    setPlatform('win32');
    const r = (await new ApcDetectionHandlers({} as never).handleProcessDetectApc({
      pid: 0,
    })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/pid/i);
    expect(mockDetect).not.toHaveBeenCalled();
  });

  it('returns a platform error on non-Win32', async () => {
    setPlatform('linux');
    const r = (await new ApcDetectionHandlers({} as never).handleProcessDetectApc({
      pid: 1000,
    })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Windows-only/);
  });

  it('delegates to detectApcInjection on Win32 + forwards the result', async () => {
    setPlatform('win32');
    mockDetect.mockReturnValue({
      success: true,
      pid: 1234,
      threadCount: 4,
      suspiciousThreads: 2,
      apcThreads: [],
      verdict: 'suspicious',
      confidence: 60,
      riskReasons: ['reason'],
    });
    const r = (await new ApcDetectionHandlers({} as never).handleProcessDetectApc({
      pid: 1234,
    })) as Record<string, unknown>;
    expect(mockDetect).toHaveBeenCalledWith(1234);
    expect(r.verdict).toBe('suspicious');
    expect(r.success).toBe(true);
  });

  it('propagates detectApcInjection errors as the handler result', async () => {
    setPlatform('win32');
    mockDetect.mockReturnValue({ success: false, pid: 1, error: 'access denied' });
    const r = (await new ApcDetectionHandlers({} as never).handleProcessDetectApc({
      pid: 1,
    })) as Record<string, unknown>;
    expect(r.success).toBe(false);
    expect(r.error).toBe('access denied');
  });
});
