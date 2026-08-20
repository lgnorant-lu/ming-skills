import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@src/utils/logger', () => ({ logger: loggerState }));

import { restoreJSVMPCode } from '@modules/deobfuscator/JSVMPDeobfuscator.restore';
import { JSVMPDeobfuscator } from '@modules/deobfuscator/JSVMPDeobfuscator';

describe('JSVMPDeobfuscator budget wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restoreJSVMPCode forwards the caller timeout to sandbox evaluations', async () => {
    const sandbox = {
      execute: vi.fn(async () => ({ ok: true, output: '["a"]' })),
    } as any;

    await restoreJSVMPCode({ sandbox } as any, 'var _0x123 = ["a"];', 'obfuscator.io', false, {
      timeoutMs: 1234,
      maxIterations: 5,
    });

    const calls = sandbox.execute.mock.calls as Array<Array<Record<string, unknown>>>;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((args) => args[0]?.timeoutMs === 1234)).toBe(true);
  });

  it('keeps default timeouts when no budget is provided', async () => {
    const sandbox = {
      execute: vi.fn(async () => ({ ok: true, output: '["a"]' })),
    } as any;

    await restoreJSVMPCode({ sandbox } as any, 'var _0x123 = ["a"];', 'obfuscator.io', false);

    const calls = sandbox.execute.mock.calls as Array<Array<Record<string, unknown>>>;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.[0]?.timeoutMs).toBe(3000);
  });

  it('deobfuscate passes options through without crashing for custom VMs', async () => {
    const deobfuscator = new JSVMPDeobfuscator();
    const result = await deobfuscator.deobfuscate({
      code: 'var x = 1;',
      timeout: 1234,
      maxIterations: 5,
    } as any);
    expect(result).toHaveProperty('isJSVMP');
    expect(result).toHaveProperty('warnings');
  });
});
