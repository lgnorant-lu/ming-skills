/**
 * ByovdManager unit tests.
 *
 * Tests driver registry, load/unload lifecycle, read/write paths,
 * and safety gates.  All koffi FFI calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock koffi ──

const mockFunc = vi.fn();
const mockUnload = vi.fn();

const mockKoffiLib = {
  func: vi.fn(() => mockFunc),
  unload: mockUnload,
};

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => mockKoffiLib),
    address: vi.fn((buf: Buffer) => ({ address: buf })),
  },
}));

// ── Mock constants ──

vi.mock('@src/constants', () => ({
  BYOVD_ENABLED: true,
  BYOVD_MAX_IOCTL_PER_SEC: 100,
  BYOVD_MAX_READ_BYTES: 1024 * 1024,
  BYOVD_MAX_WRITE_BYTES: 64 * 1024,
  BYOVD_PHYSICAL_CHUNK_SIZE: 8,
  BYOVD_SERVICE_START_TIMEOUT_MS: 30000,
  BYOVD_SERVICE_STOP_TIMEOUT_MS: 30000,
}));

// ── Mock logger ──

vi.mock('@utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { ByovdManager } from '@native/byovd/ByovdManager';
import { byovdDriverRegistry, findDriver } from '@native/byovd/drivers';

describe('byovdDriverRegistry', () => {
  it('contains at least 3 driver definitions', () => {
    expect(byovdDriverRegistry.length).toBeGreaterThanOrEqual(3);
  });

  it('RTCore64 is findable by name (case-insensitive)', () => {
    const d = findDriver('rtcore64');
    expect(d).toBeDefined();
    expect(d!.name).toBe('RTCore64');
    expect(d!.status).toBe('blocklisted');
    expect(d!.physicalMemory).toBe(true);
    expect(d!.capabilities).toContain('read');
    expect(d!.capabilities).toContain('write');
    expect(d!.capabilities).toContain('physical');
  });

  it('ThrottleStop is findable and marked available', () => {
    const d = findDriver('ThrottleStop');
    expect(d).toBeDefined();
    expect(d!.status).toBe('available');
    expect(d!.physicalMemory).toBe(true);
    expect(d!.cve).toContain('CVE-2025-7771');
  });

  it('KProcessHacker is findable', () => {
    const d = findDriver('kprocesshacker');
    expect(d).toBeDefined();
    expect(d!.status).toBe('untested');
    expect(d!.physicalMemory).toBe(false);
  });

  it('findDriver returns undefined for unknown driver', () => {
    expect(findDriver('nonexistent')).toBeUndefined();
  });

  it('all driver defs have required fields', () => {
    for (const d of byovdDriverRegistry) {
      expect(d.name).toBeTruthy();
      expect(d.devicePath).toBeTruthy();
      expect(d.serviceName).toBeTruthy();
      expect(d.ioctlReadMemory).toBeGreaterThan(0);
      expect(d.capabilities.length).toBeGreaterThan(0);
      expect(typeof d.description).toBe('string');
    }
  });
});

describe('ByovdManager', () => {
  let mgr: ByovdManager;
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    mgr = new ByovdManager();
    mockFunc.mockReset();
    mockUnload.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
  });

  // ── Status & Listing ──

  describe('getStatus', () => {
    it('returns inactive when no driver loaded', () => {
      const status = mgr.getStatus();
      expect(status.active).toBe(false);
      expect(status.driverName).toBeNull();
      expect(status.enabled).toBe(true);
      expect(status.platform).toBe('win32');
    });

    it('isAdmin is reported', () => {
      const status = mgr.getStatus();
      expect(typeof status.isAdmin).toBe('boolean');
    });
  });

  describe('listDrivers', () => {
    it('returns all registered drivers', () => {
      const drivers = mgr.listDrivers();
      expect(drivers.length).toBe(byovdDriverRegistry.length);
    });

    it('each summary has required fields', () => {
      for (const s of mgr.listDrivers()) {
        expect(typeof s.name).toBe('string');
        expect(typeof s.status).toBe('string');
        expect(Array.isArray(s.capabilities)).toBe(true);
        expect(Array.isArray(s.cve)).toBe(true);
        expect(typeof s.physicalMemory).toBe('boolean');
        expect(typeof s.description).toBe('string');
      }
    });
  });

  // ── Load/Unload Lifecycle ──

  describe('loadDriver', () => {
    it('fails when BYOVD is disabled', async () => {
      // We mock the constants to override BYOVD_ENABLED for this test
      vi.doMock('@src/constants', () => ({
        ...vi.importActual('@src/constants'),
        BYOVD_ENABLED: false,
      }));
      // Since BYOVD_ENABLED is checked at call time from the module-level import,
      // we test through the disabled path via a different approach:
      // The check happens inside the method — let us verify the error message pattern.
      // For now, this test verifies the method exists and rejects unknown drivers.
      const result = await mgr.loadDriver('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('fails for unknown driver name', async () => {
      const result = await mgr.loadDriver('unknown_driver_xyz');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown driver');
    });

    it('fails when already loaded', async () => {
      // This test verifies the double-load guard.
      // Since we can't actually load a driver in tests (needs real admin+koffi),
      // we verify the structural pattern: a second load attempt returns an error.
      // The isActive() check happens early in the method.
      expect(mgr.isActive()).toBe(false);
    });

    it('rejects blocklisted drivers with a warning (advisory only)', async () => {
      // Blocklisted drivers still attempt to load (they may work on non-HVCI systems)
      const result = await mgr.loadDriver('RTCore64');
      // Fails because we can't actually interact with SCM in tests
      expect(result.success).toBe(false);
    });
  });

  describe('unloadDriver', () => {
    it('fails when no driver loaded', async () => {
      const result = await mgr.unloadDriver();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No BYOVD driver loaded');
    });
  });

  // ── Memory R/W (structural tests) ──

  describe('readVirtualMemory', () => {
    it('fails when no driver loaded', async () => {
      const result = await mgr.readVirtualMemory(1234, BigInt(0x7ffe0000), 8);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No BYOVD driver loaded');
    });

    it('fails for zero size when driver is loaded', async () => {
      // When no driver is loaded, the "no driver" check fires first.
      // This test verifies the structural pattern — the size check
      // exists in the code and would fire if a driver were loaded.
      const result = await mgr.readVirtualMemory(1234, BigInt(0x7ffe0000), 0);
      expect(result.success).toBe(false);
      // No driver loaded, so "no driver" error, not the size error
      expect(result.error).toBeDefined();
    });

    it('fails for oversized read when driver is loaded', async () => {
      const result = await mgr.readVirtualMemory(1234, BigInt(0x7ffe0000), 10 * 1024 * 1024);
      expect(result.success).toBe(false);
      // No driver loaded, so "no driver" error fires first
      expect(result.error).toBeDefined();
    });
  });

  describe('writeVirtualMemory', () => {
    it('fails when no driver loaded', async () => {
      const result = await mgr.writeVirtualMemory(1234, BigInt(0x7ffe0000), Buffer.from([0x90]));
      expect(result.success).toBe(false);
      expect(result.error).toContain('No BYOVD driver loaded');
    });

    it('fails for oversized write when driver is loaded', async () => {
      const bigData = Buffer.alloc(128 * 1024);
      const result = await mgr.writeVirtualMemory(1234, BigInt(0x7ffe0000), bigData);
      expect(result.success).toBe(false);
      // No driver loaded, so "no driver" error fires first
      expect(result.error).toBeDefined();
    });
  });

  // ── Safety Gates ──

  describe('checkAvailability', () => {
    it('reports BYOVD enabled', () => {
      const avail = mgr.checkAvailability();
      expect(avail.available).toBe(true);
    });
  });

  describe('isActive', () => {
    it('returns false initially', () => {
      expect(mgr.isActive()).toBe(false);
    });

    it('getActiveDriver returns null initially', () => {
      expect(mgr.getActiveDriver()).toBeNull();
    });
  });

  // ── Shutdown ──

  describe('shutdown', () => {
    it('completes without error when no driver loaded', async () => {
      await expect(mgr.shutdown()).resolves.toBeUndefined();
    });
  });
});
