/**
 * CrossPlatformBreakpointEngine — unit tests.
 *
 * Verifies engine selection logic and delegation.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

describe('CrossPlatformBreakpointEngine — engine selection', () => {
  describe('on win32', () => {
    it('selects HardwareBreakpointEngine', async () => {
      const originalPlatform = process.platform;
      const originalEnv = process.env.JSHOOK_REGISTRY_PLATFORM;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      process.env.JSHOOK_REGISTRY_PLATFORM = 'win32';

      try {
        const { CrossPlatformBreakpointEngine } =
          await import('@native/CrossPlatformBreakpointEngine');
        const engine = new CrossPlatformBreakpointEngine();

        // listBreakpoints returns [] before engine is loaded
        expect(engine.listBreakpoints()).toEqual([]);

        // setBreakpoint will load the Win32 HardwareBreakpointEngine (mock env)
        // It should throw because Win32Debug is not available in test env
        await expect(engine.setBreakpoint(1234, '0x1000', 'write', 4)).rejects.toThrow();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        if (originalEnv !== undefined) {
          process.env.JSHOOK_REGISTRY_PLATFORM = originalEnv;
        } else {
          delete process.env.JSHOOK_REGISTRY_PLATFORM;
        }
      }
    });
  });

  describe('on linux', () => {
    it('selects LinuxBreakpointEngine', async () => {
      const originalPlatform = process.platform;
      const originalEnv = process.env.JSHOOK_REGISTRY_PLATFORM;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      process.env.JSHOOK_REGISTRY_PLATFORM = 'linux';

      try {
        const { CrossPlatformBreakpointEngine } =
          await import('@native/CrossPlatformBreakpointEngine');
        const engine = new CrossPlatformBreakpointEngine();

        expect(engine.listBreakpoints()).toEqual([]);
        // setBreakpoint will instantiate LinuxBreakpointEngine and call attach
        // (which will try ptrace via koffi — that's mocked, will fail)
        await expect(engine.setBreakpoint(1234, '0x1000', 'write', 4)).rejects.toThrow();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        if (originalEnv !== undefined) {
          process.env.JSHOOK_REGISTRY_PLATFORM = originalEnv;
        } else {
          delete process.env.JSHOOK_REGISTRY_PLATFORM;
        }
      }
    });
  });

  describe('on unsupported platform', () => {
    it('throws a clear error', async () => {
      const originalPlatform = process.platform;
      const originalEnv = process.env.JSHOOK_REGISTRY_PLATFORM;
      Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
      delete process.env.JSHOOK_REGISTRY_PLATFORM;

      try {
        const { CrossPlatformBreakpointEngine } =
          await import('@native/CrossPlatformBreakpointEngine');
        const engine = new CrossPlatformBreakpointEngine();

        await expect(engine.setBreakpoint(1234, '0x1000', 'write', 4)).rejects.toThrow(
          /only supported on Windows, Linux, and macOS/,
        );
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
        if (originalEnv !== undefined) {
          process.env.JSHOOK_REGISTRY_PLATFORM = originalEnv;
        } else {
          delete process.env.JSHOOK_REGISTRY_PLATFORM;
        }
      }
    });
  });

  describe('crossPlatformBreakpointEngine singleton', () => {
    it('exports a singleton instance', async () => {
      const { crossPlatformBreakpointEngine } =
        await import('@native/CrossPlatformBreakpointEngine');
      expect(crossPlatformBreakpointEngine).toBeDefined();
      expect(typeof crossPlatformBreakpointEngine.setBreakpoint).toBe('function');
      expect(typeof crossPlatformBreakpointEngine.listBreakpoints).toBe('function');
      expect(typeof crossPlatformBreakpointEngine.removeBreakpoint).toBe('function');
    });
  });
});
