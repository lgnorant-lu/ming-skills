/**
 * Tests for process hollowing detection — cross-platform fallback path
 * (Linux/macOS via IntegrityScanner). The Win32 PE-comparison path is covered
 * by hollowing-detection.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockScanIntegrity = vi.fn();
const mockCreatePlatformProvider = vi.fn();

vi.mock('@native/platform/IntegrityScanner', () => ({
  scanIntegrity: (...args: unknown[]) => mockScanIntegrity(...args),
}));

vi.mock('@native/platform/factory', () => ({
  createPlatformProvider: (...args: unknown[]) => mockCreatePlatformProvider(...args),
}));

// PEAnalyzer + Win32API are statically imported by the handler module but never
// called on the cross-platform path — stub them so the import resolves cleanly.
vi.mock('@native/PEAnalyzer', () => ({
  PEAnalyzer: class MockPEAnalyzer {
    // no-op stub — the cross-platform path never instantiates PEAnalyzer
    // methods. Member present to satisfy oxlint(no-extraneous-class); public
    // so tsc does not flag it as an unused private field.
    readonly stub = true;
  },
}));
vi.mock('@native/Win32API', () => ({
  openProcessForMemory: vi.fn(),
  CloseHandle: vi.fn(),
  EnumProcessModules: vi.fn(),
  GetModuleFileNameEx: vi.fn(),
  GetModuleInformation: vi.fn(),
}));
vi.mock('@utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { HollowingDetectionHandlers } from '@server/domains/process/handlers/hollowing-detection';
import type { ProcessManagementHandlers } from '@server/domains/process/handlers/process-management';

function makePlatformMgmt(platform: string): ProcessManagementHandlers {
  return { platformValue: platform } as unknown as ProcessManagementHandlers;
}

function sha64(ch: string): string {
  return ch.repeat(64);
}

describe('HollowingDetectionHandlers — cross-platform fallback (Linux/macOS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePlatformProvider.mockReturnValue({
      openProcess: vi.fn(() => ({})),
      closeProcess: vi.fn(),
      enumerateModules: vi.fn(() => []),
      readMemory: vi.fn(),
      platform: 'linux',
    });
  });

  it('reports isHollowed=false when all executable sections match disk', async () => {
    mockScanIntegrity.mockResolvedValue({
      sections: [
        {
          sectionName: '.text',
          moduleName: 'app',
          diskHash: sha64('a'),
          memoryHash: sha64('a'),
          isModified: false,
        },
      ],
      stats: {
        scannedSections: 1,
        skippedSections: 0,
        hashedBytes: 4096,
        timedOut: false,
        truncated: false,
      },
    });

    const h = new HollowingDetectionHandlers(makePlatformMgmt('linux'));
    const result = (await h.handleDetectHollowing({ pid: 1000 })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.isHollowed).toBe(false);
    expect(result.confidence).toBe(95);
    expect(result.differences).toEqual([]);
    expect(result.platformNote).toMatch(/Cross-platform fallback/);
    expect(result.restored).toBe(false);
    expect(result.warning).toBeUndefined();
    expect(mockScanIntegrity).toHaveBeenCalledTimes(1);
  });

  it('reports isHollowed=true with evidence when a section differs from disk', async () => {
    mockScanIntegrity.mockResolvedValue({
      sections: [
        {
          sectionName: '.text',
          moduleName: 'app',
          diskHash: sha64('a'),
          memoryHash: sha64('b'),
          isModified: true,
        },
        {
          sectionName: '.rodata',
          moduleName: 'app',
          diskHash: sha64('c'),
          memoryHash: sha64('c'),
          isModified: false,
        },
      ],
      stats: {
        scannedSections: 2,
        skippedSections: 0,
        hashedBytes: 8192,
        timedOut: false,
        truncated: false,
      },
    });

    const h = new HollowingDetectionHandlers(makePlatformMgmt('darwin'));
    const result = (await h.handleDetectHollowing({ pid: 2000 })) as Record<string, unknown> & {
      differences: Array<{ section: string; moduleName: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.isHollowed).toBe(true);
    expect(result.confidence as number).toBeGreaterThanOrEqual(80);
    expect(result.differences).toHaveLength(1);
    const first = result.differences[0];
    expect(first?.section).toBe('.text');
    expect(first?.moduleName).toBe('app');
    expect(result.platform).toBe('darwin');
    expect(result.warning).toMatch(/hollowing/);
  });

  it('returns a clear error when the platform provider cannot be created', async () => {
    mockCreatePlatformProvider.mockImplementation(() => {
      throw new Error('Unsupported platform: solaris');
    });

    const h = new HollowingDetectionHandlers(makePlatformMgmt('solaris'));
    const result = (await h.handleDetectHollowing({ pid: 3000 })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Cross-platform memory provider unavailable/);
    expect(mockScanIntegrity).not.toHaveBeenCalled();
  });

  it('returns a clear error when scanIntegrity throws', async () => {
    mockScanIntegrity.mockRejectedValue(new Error('permission denied'));

    const h = new HollowingDetectionHandlers(makePlatformMgmt('linux'));
    const result = (await h.handleDetectHollowing({ pid: 4000 })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Integrity scan failed/);
  });

  it('rejects invalid pid before touching the platform provider', async () => {
    const h = new HollowingDetectionHandlers(makePlatformMgmt('linux'));
    const result = (await h.handleDetectHollowing({ pid: 0 })) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/pid must be a positive integer/);
    expect(mockCreatePlatformProvider).not.toHaveBeenCalled();
    expect(mockScanIntegrity).not.toHaveBeenCalled();
  });

  it('does NOT call Win32-only primitives on the cross-platform path', async () => {
    // Sanity: the dispatcher routes linux away from the PE path entirely.
    mockScanIntegrity.mockResolvedValue({
      sections: [],
      stats: {
        scannedSections: 0,
        skippedSections: 0,
        hashedBytes: 0,
        timedOut: false,
        truncated: false,
      },
    });

    const h = new HollowingDetectionHandlers(makePlatformMgmt('linux'));
    const result = (await h.handleDetectHollowing({ pid: 5000 })) as Record<string, unknown>;

    expect(result.success).toBe(true);
    // No moduleBase / moduleSizeOfImage / modulePath (those are Win32-only fields)
    expect(result.moduleBase).toBeUndefined();
    expect(result.moduleSizeOfImage).toBeUndefined();
  });
});
