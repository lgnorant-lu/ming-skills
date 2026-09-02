/**
 * Coverage tests for ApcDetectionHandlers.handleProcessDetectApc — exercises
 * pid validation, the platform guard, and the delegation to detectApcInjection
 * (mocked @native/APCDetector).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryAuditTrail, type AuditEntry } from '@modules/process/memory/AuditTrail';

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

  it('records an audit entry with string-compatible types (no BigInt) and durationMs', async () => {
    setPlatform('win32');
    mockDetect.mockReturnValue({ success: true, pid: 999, threadCount: 2, suspiciousThreads: 0 });
    const record = vi.fn();
    await new ApcDetectionHandlers({
      auditTrail: { record },
    } as never).handleProcessDetectApc({ pid: 999 });

    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.address).toBeNull();
    expect(entry.pid).toBe(999);
    expect(entry.result).toBe('success');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry).not.toHaveProperty('address', expect.any(BigInt));
    // The record must be JSON-serializable — a BigInt address used to poison
    // the audit trail so memory_audit_export threw on JSON.stringify.
    expect(() => JSON.stringify(entry)).not.toThrow();
  });

  it('records a failure audit entry with durationMs when detection fails', async () => {
    setPlatform('win32');
    mockDetect.mockReturnValue({ success: false, pid: 1, error: 'access denied' });
    const record = vi.fn();
    await new ApcDetectionHandlers({
      auditTrail: { record },
    } as never).handleProcessDetectApc({ pid: 1 });

    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry.result).toBe('failure');
    expect(entry.error).toBe('access denied');
    expect(typeof entry.durationMs).toBe('number');
    expect(() => JSON.stringify(entry)).not.toThrow();
  });

  it('does not poison a real audit trail: exportJson survives after an APC entry', async () => {
    setPlatform('win32');
    mockDetect.mockReturnValue({ success: true, pid: 777, threadCount: 1, suspiciousThreads: 0 });
    const trail = new MemoryAuditTrail(10);
    await new ApcDetectionHandlers({
      auditTrail: trail,
    } as never).handleProcessDetectApc({ pid: 777 });

    const exported: AuditEntry[] = JSON.parse(trail.exportJson()) as AuditEntry[];
    expect(exported).toHaveLength(1);
    expect(exported[0]!.address).toBeNull();
    expect(exported[0]!.operation).toBe('process_detect_apc');
    expect(typeof exported[0]!.durationMs).toBe('number');
  });
});
