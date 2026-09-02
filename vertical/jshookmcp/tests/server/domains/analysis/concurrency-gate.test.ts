/**
 * b4-01: CPU-heavy analysis handlers must run behind the global cpuLimit
 * concurrency gate. Validates that every CPU-dense entry point routes through
 * cpuLimit, and that fast-fail argument validation happens OUTSIDE the gate
 * (invalid requests must not occupy queue slots).
 */

import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gateState = vi.hoisted(() => ({
  cpuLimit: vi.fn(async (fn: () => unknown) => fn()),
}));

vi.mock('@utils/concurrency', () => ({
  ioLimit: async (fn: () => unknown) => fn(),
  cpuLimit: gateState.cpuLimit,
  cdpLimit: async (fn: () => unknown) => fn(),
}));

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

vi.mock('@modules/symbolic/SymbolicExecutor', () => ({
  SymbolicExecutor: class {
    execute = vi.fn(async () => ({ paths: [], pathCount: 0 }));
  },
}));

vi.mock('@modules/symbolic/JSVMPSymbolicExecutor', () => ({
  JSVMPSymbolicExecutor: class {
    executeJSVMP = vi.fn(async () => ({ steps: [] }));
  },
}));

import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';
import {
  handleAnalysisAstMatch,
  handleAnalysisDeflatControlFlow,
} from '@server/domains/analysis/handlers/ast-analysis';
import {
  handleJsDeobfuscatePipeline,
  handleJsSolveConstraints,
} from '@server/domains/analysis/handlers/pipeline';
import {
  handleJsSymbolicExecute,
  handleJsSymbolicExecuteJsvmp,
} from '@server/domains/analysis/handlers/symbolic';
import { handleAnalysisDataFlow } from '@server/domains/analysis/handlers/data-flow';
import { handleAnalysisSecurityScan } from '@server/domains/analysis/handlers/security-scan';
import {
  handleJsDeobfuscateJsvmp,
  handleJsAnalyzeVm,
} from '@server/domains/analysis/handlers/jsvmp';

describe('analysis CPU concurrency gate (b4-01)', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    gateState.cpuLimit.mockImplementation(async (fn: () => unknown) => fn());
    webcrackState.runWebcrack.mockImplementation(async () => ({
      applied: true,
      code: 'decoded',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    }));
    handlers = new CoreAnalysisHandlers(
      deps as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0],
    );
  });

  it('routes analysis_ast_match through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleAnalysisAstMatch({ code: 'const x = 1;', nodeType: 'Identifier' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('rejects analysis_ast_match without code before entering the gate', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(await handleAnalysisAstMatch({ nodeType: 'X' }));
    expect(body.success).toBe(false);
    expect(gateState.cpuLimit).not.toHaveBeenCalled();
  });

  it('routes analysis_deflat_control_flow through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleAnalysisDeflatControlFlow({ code: 'function f() { return 1; }' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes deobfuscate (auto engine) through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'x' });
    const body = parseJson<{ success: boolean }>(await handlers.handleDeobfuscate({ code: 'a()' }));
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('rejects deobfuscate without code before entering the gate', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(await handlers.handleDeobfuscate({}));
    expect(body.success).toBe(false);
    expect(gateState.cpuLimit).not.toHaveBeenCalled();
  });

  it('routes webcrack_unpack through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handlers.handleWebcrackUnpack({ code: 'bundle' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes analysis_decode_string_array through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handlers.handleAnalysisDecodeStringArray({
        code: 'var _a = ["x"]; console.log(_a[0]);',
      }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_deobfuscate_pipeline through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleJsDeobfuscatePipeline({ code: 'const x = 1;' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_solve_constraints through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleJsSolveConstraints({ code: 'const x = 1 + 2;' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_symbolic_execute through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ pathCount: number }>(
      await handleJsSymbolicExecute({ code: 'var x = 1;' }),
    );
    expect(body.pathCount).toBe(0);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_symbolic_execute_jsvmp through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ steps: unknown[] }>(
      await handleJsSymbolicExecuteJsvmp({
        instructions: [{ op: 'PUSH', args: [1] }],
      } as never),
    );
    expect(Array.isArray(body.steps)).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes understand_code through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    deps.analyzer.understand.mockResolvedValue({ success: true });
    const body = parseJson<{ success: boolean }>(
      await handlers.handleUnderstandCode({ code: 'f()' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes detect_crypto through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    deps.cryptoDetector.detect.mockResolvedValue({ success: true });
    const body = parseJson<{ success: boolean }>(
      await handlers.handleDetectCrypto({ code: 'f()' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes detect_obfuscation through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    deps.obfuscationDetector.detect.mockReturnValue({ type: 'none' });
    deps.obfuscationDetector.generateReport.mockReturnValue('report');
    await handlers.handleDetectObfuscation({ code: 'f()' });
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_deobfuscate_jsvmp through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const jsvmpDeobfuscator = {
      deobfuscate: vi.fn(async () => ({
        isJSVMP: true,
        vmType: 'custom',
        vmFeatures: {},
        instructions: [],
        deobfuscatedCode: 'clean',
        confidence: 1,
      })),
    };
    const body = parseJson<{ success: boolean }>(
      await handleJsDeobfuscateJsvmp({ code: 'f()' }, jsvmpDeobfuscator as never),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes js_analyze_vm through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const jsvmpDeobfuscator = {
      deobfuscate: vi.fn(async () => ({
        isJSVMP: false,
        vmType: 'none',
        vmFeatures: {},
        instructions: [],
        deobfuscatedCode: '',
        confidence: 0,
      })),
    };
    const body = parseJson<{ success: boolean }>(
      await handleJsAnalyzeVm({ code: 'f()' }, jsvmpDeobfuscator as never),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes analysis_data_flow through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleAnalysisDataFlow({ code: 'var x = 1;' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });

  it('routes analysis_security_scan through cpuLimit', async () => {
    gateState.cpuLimit.mockClear();
    const body = parseJson<{ success: boolean }>(
      await handleAnalysisSecurityScan({ code: 'var x = 1;' }),
    );
    expect(body.success).toBe(true);
    expect(gateState.cpuLimit).toHaveBeenCalledTimes(1);
  });
});
