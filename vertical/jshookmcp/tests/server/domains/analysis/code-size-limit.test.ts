/**
 * b4-02: `code` inputs to deobfuscation tools must be capped at
 * MAX_ANALYSIS_CODE_BYTES. Oversized payloads are rejected with an explicit
 * error BEFORE any CPU-heavy engine is invoked.
 */

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_ANALYSIS_CODE_BYTES } from '@src/constants';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';

const webcrackState = vi.hoisted(() => ({
  runWebcrack: vi.fn(async () => ({
    applied: true,
    code: 'decoded',
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

interface BaseResponse {
  success?: boolean;
  error?: string;
}

describe('analysis code size limit (b4-02)', () => {
  const deps = {
    collector: { collect: vi.fn(), getActivePage: vi.fn() },
    scriptManager: { init: vi.fn(), searchInScripts: vi.fn(), extractFunctionTree: vi.fn() },
    deobfuscator: { deobfuscate: vi.fn() },
    advancedDeobfuscator: { deobfuscate: vi.fn() },
    obfuscationDetector: { detect: vi.fn(), generateReport: vi.fn() },
    analyzer: { understand: vi.fn() },
    cryptoDetector: { detect: vi.fn() },
    hookManager: {
      createHook: vi.fn(),
      getAllHooks: vi.fn(),
      getHookRecords: vi.fn(),
      clearHookRecords: vi.fn(),
    },
    samplingBridge: {
      isSamplingSupported: vi.fn().mockReturnValue(false),
      sampleText: vi.fn(),
    },
    jscramblerDeobfuscator: { deobfuscate: vi.fn() },
    packerDeobfuscator: { deobfuscate: vi.fn() },
    vmDeobfuscator: { detectVMProtection: vi.fn(), deobfuscateVM: vi.fn() },
  };

  let handlers: CoreAnalysisHandlers;
  let oversized: string;
  let atLimit: string;

  beforeEach(() => {
    vi.clearAllMocks();
    webcrackState.runWebcrack.mockImplementation(async () => ({
      applied: true,
      code: 'decoded',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    }));
    handlers = new CoreAnalysisHandlers(
      deps as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0],
    );
    oversized = 'a'.repeat(MAX_ANALYSIS_CODE_BYTES + 1);
    atLimit = 'a'.repeat(MAX_ANALYSIS_CODE_BYTES);
  });

  it('rejects oversized code in deobfuscate without invoking the engine', async () => {
    const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({ code: oversized }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code exceeds MAX_ANALYSIS_CODE_BYTES');
    expect(deps.deobfuscator.deobfuscate).not.toHaveBeenCalled();
  });

  it('rejects oversized code in webcrack_unpack without invoking webcrack', async () => {
    const body = parseJson<BaseResponse>(await handlers.handleWebcrackUnpack({ code: oversized }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code exceeds MAX_ANALYSIS_CODE_BYTES');
    expect(webcrackState.runWebcrack).not.toHaveBeenCalled();
  });

  it('rejects oversized code in analysis_decode_string_array', async () => {
    const body = parseJson<BaseResponse>(
      await handlers.handleAnalysisDecodeStringArray({ code: oversized }),
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('code exceeds MAX_ANALYSIS_CODE_BYTES');
  });

  it('accepts code exactly at the limit and delegates to the engine', async () => {
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'ok' });
    const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({ code: atLimit }));
    expect(body.success).toBe(true);
    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledTimes(1);
  });

  it('preserves the missing-code error for empty input', async () => {
    const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({ code: '' }));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code is required');
    expect(deps.deobfuscator.deobfuscate).not.toHaveBeenCalled();
  });
});
