import { describe, it, expect, vi, beforeEach } from 'vitest';

import { manifestTestMocksInstalled } from '../../shared/manifest-test-mocks';

void manifestTestMocksInstalled;

describe('server/domains/debugger/antidebug exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('exposes anti-debug tool definitions', async () => {
    expect.hasAssertions();

    const mod = await import('@server/domains/debugger/antidebug/definitions');
    expect(mod.antidebugTools).toBeDefined();
    expect(Array.isArray(mod.antidebugTools)).toBe(true);
    expect(mod.antidebugTools.length).toBe(2);
    expect(mod.antidebugTools.map((t: Record<string, unknown>) => t.name)).toEqual(
      expect.arrayContaining(['antidebug_bypass', 'antidebug_detect_protections']),
    );
  });

  it('anti-debug definitions are included in the parent debugger manifest', async () => {
    expect.hasAssertions();

    const { debuggerTools } = await import('@server/domains/debugger/definitions');
    const debuggerToolNames = debuggerTools.map((t) => t.name);
    expect(debuggerToolNames).toContain('antidebug_bypass');
    expect(debuggerToolNames).toContain('antidebug_detect_protections');
  });
});
