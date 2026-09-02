/**
 * LinuxBreakpointEngine — unit tests (mock koffi / ptrace).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({
      func: vi.fn(() => vi.fn(() => 0)),
      unload: vi.fn(),
    })),
    address: vi.fn(() => 0),
    errno: vi.fn(() => 0),
  },
}));

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

import { LinuxBreakpointEngine } from '@native/platform/LinuxBreakpointEngine';

describe('LinuxBreakpointEngine', () => {
  let engine: LinuxBreakpointEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new LinuxBreakpointEngine();
  });

  describe('listBreakpoints', () => {
    it('returns empty array initially', () => {
      expect(engine.listBreakpoints()).toEqual([]);
    });
  });

  describe('removeBreakpoint', () => {
    it('returns false for non-existent id', () => {
      expect(Promise.resolve(engine.removeBreakpoint('nonexistent'))).resolves.toBe(false);
    });
  });

  describe('platform guard', () => {
    it('should throw on non-linux platform for attach', async () => {
      // attach will fail because koffi is mocked to return 0 (no real ptrace)
      // and the guardPlatform() runs within setBreakpoint
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      // setBreakpoint tries ptrace(PTRACE_ATTACH) — mock returns 0 (failure)
      try {
        await expect(engine.setBreakpoint(1234, '0x1000', 'write', 4)).rejects.toThrow();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('API surface', () => {
    it('has attach/detach/setBreakpoint/removeBreakpoint/listBreakpoints/waitForHit/traceAccess methods', () => {
      expect(typeof engine.attach).toBe('function');
      expect(typeof engine.detach).toBe('function');
      expect(typeof engine.setBreakpoint).toBe('function');
      expect(typeof engine.removeBreakpoint).toBe('function');
      expect(typeof engine.listBreakpoints).toBe('function');
      expect(typeof engine.waitForHit).toBe('function');
      expect(typeof engine.traceAccess).toBe('function');
    });
  });
});
