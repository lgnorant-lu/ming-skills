import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  clearAllBreakpointsCore,
  setBreakpointByUrlCore,
} from '@modules/debugger/DebuggerManager.impl.core.breakpoints';

function makeContext(overrides: Record<string, unknown> = {}) {
  const breakpoints = new Map<string, any>([
    ['bp-1', { breakpointId: 'bp-1', location: { url: 'a.js', lineNumber: 1 }, enabled: true }],
    ['bp-2', { breakpointId: 'bp-2', location: { url: 'b.js', lineNumber: 2 }, enabled: true }],
  ]);
  return {
    enabled: true,
    cdpSession: { send: vi.fn(async () => ({})) },
    ensureSession: vi.fn(async () => {}),
    breakpoints,
    removeBreakpoint: vi.fn(async (id: string) => {
      breakpoints.delete(id);
    }),
    ...overrides,
  };
}

describe('breakpoints bug fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clearAll keeps clearing remaining breakpoints when one removal fails', async () => {
    const breakpoints = new Map<string, any>([
      ['bp-1', { breakpointId: 'bp-1' }],
      ['bp-2', { breakpointId: 'bp-2' }],
    ]);
    const ctx = makeContext({
      breakpoints,
      removeBreakpoint: vi.fn(async (id: string) => {
        if (id === 'bp-1') {
          throw new Error('cdp gone');
        }
        breakpoints.delete(id);
      }),
    });

    await clearAllBreakpointsCore(ctx);

    // bp-2 must still have been removed despite bp-1 failing.
    expect(breakpoints.has('bp-2')).toBe(false);
    expect(breakpoints.has('bp-1')).toBe(true);
    expect(ctx.removeBreakpoint).toHaveBeenCalledTimes(2);
  });

  it('setBreakpointByUrl throws a PrerequisiteError when auto-reconnect leaves no session', async () => {
    const ctx = makeContext({
      enabled: false,
      cdpSession: null,
      ensureSession: vi.fn(async () => {}), // "succeeds" without restoring a session
    });

    await expect(setBreakpointByUrlCore(ctx, { url: 'x.js', lineNumber: 1 })).rejects.toThrow(
      'did not restore the CDP session',
    );
  });
});
