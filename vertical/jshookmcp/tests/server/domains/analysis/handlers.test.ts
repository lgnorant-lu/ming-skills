import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreAnalysisHandlers } from '@server/domains/analysis/handlers';

const webcrackState = vi.hoisted(() => ({
  runWebcrack: vi.fn<(...args: any[]) => Promise<Record<string, unknown>>>(async () => ({
    applied: true,
    code: 'decoded-bundle',
    bundle: {
      type: 'webpack',
      entryId: '0',
      moduleCount: 1,
      truncated: false,
      modules: [{ id: '0', path: './index.js', isEntry: true, size: 12, code: 'decoded-bundle' }],
    },
    savedTo: 'artifacts/webcrack',
    optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
  })),
}));

vi.mock('@modules/deobfuscator/webcrack', () => ({
  runWebcrack: webcrackState.runWebcrack,
}));

interface BaseResponse {
  success?: boolean;
  error?: string;
  message?: string;
  engine?: string;
  optionsUsed?: Record<string, unknown>;
}

interface DeobfuscateResponse extends BaseResponse {
  code?: string;
  transformations?: string[];
  type?: string;
  detection?: Record<string, unknown>;
}

interface ManageHooksResponse extends BaseResponse {
  id?: string;
}

interface AdvancedDeobfuscateResponse extends BaseResponse {
  code?: string;
  astOptimized?: boolean;
}

interface WebcrackUnpackResponse extends BaseResponse {
  bundle?: Record<string, unknown>;
}

describe('CoreAnalysisHandlers', () => {
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
    webcrackState.runWebcrack.mockClear();
    handlers = new CoreAnalysisHandlers(
      deps as unknown as ConstructorParameters<typeof CoreAnalysisHandlers>[0],
    );
  });

  it('rejects deobfuscate when code is missing', async () => {
    const body = parseJson<BaseResponse>(await handlers.handleDeobfuscate({}));
    expect(body.success).toBe(false);
    expect(body.error).toContain('code is required');
  });

  it('delegates deobfuscate to deobfuscator', async () => {
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'x' });
    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'a()',
      }),
    );
    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'a()',
    });
    expect(body.success).toBe(true);
  });

  it('passes webcrack-specific options through deobfuscate', async () => {
    deps.deobfuscator.deobfuscate.mockResolvedValue({ success: true, code: 'decoded' });

    await handlers.handleDeobfuscate({
      code: 'bundle',
      unpack: false,
      unminify: false,
      jsx: false,
      mangle: true,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
    });

    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'bundle',
      unpack: false,
      unminify: false,
      jsx: false,
      mangle: true,
      outputDir: 'artifacts/deobf',
      forceOutput: true,
      includeModuleCode: true,
      maxBundleModules: 10,
      mappings: [
        { path: './main.js', pattern: 'bootstrap', matchType: 'includes', target: 'code' },
      ],
    });
  });

  it('creates hook with default action in manage hooks', async () => {
    deps.hookManager.createHook.mockResolvedValue({ success: true, id: 'h1' });
    const body = parseJson<ManageHooksResponse>(
      await handlers.handleManageHooks({
        action: 'create',
        target: 'fetch',
        type: 'fetch',
      }),
    );
    expect(deps.hookManager.createHook).toHaveBeenCalledWith({
      target: 'fetch',
      type: 'fetch',
      action: 'log',
      customCode: undefined,
    });
    expect(body.id).toBe('h1');
  });

  it('returns graceful error for unknown hook action', async () => {
    const result = await handlers.handleManageHooks({ action: 'nope' });
    const body = parseJson<BaseResponse>(result);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/Unknown hook action/);
  });

  it('delegates advanced deobfuscate directly to webcrack-backed implementation', async () => {
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({
      code: 'raw',
      success: true,
      astOptimized: false,
    });

    const body = parseJson<AdvancedDeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'obf',
        engine: 'webcrack',
        detectOnly: true,
        unpack: false,
      }),
    );

    expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'obf',
      detectOnly: true,
      unpack: false,
    });
    expect(body.code).toBe('raw');
    expect(body.astOptimized).toBe(false);
  });

  it('does not inject deprecated defaults when advanced args are omitted', async () => {
    deps.deobfuscator.deobfuscate.mockResolvedValue({ code: 'raw2', success: true });

    await handlers.handleDeobfuscate({ code: 'obf' });

    expect(deps.deobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'obf',
    });
  });

  it('runs webcrack_unpack directly and returns bundle details', async () => {
    const response = parseJson<WebcrackUnpackResponse>(
      await handlers.handleWebcrackUnpack({
        code: 'bundle',
        includeModuleCode: true,
        maxBundleModules: 5,
      }),
    );

    expect(response.success).toBe(true);
    expect(response.engine).toBe('webcrack');
    expect(response.optionsUsed).toBeDefined();
    expect(webcrackState.runWebcrack).toHaveBeenCalledWith('bundle', {
      unpack: true,
      unminify: true,
      jsx: true,
      mangle: false,
      includeModuleCode: true,
      maxBundleModules: 5,
    });
  });

  it('returns structured error when webcrack_unpack fails', async () => {
    webcrackState.runWebcrack.mockResolvedValueOnce({
      applied: false,
      code: 'original-code',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
      reason: 'webcrack requires Node.js 22.12+ or 24.x; current runtime is 20.0.0',
    });

    const response = parseJson<BaseResponse>(
      await handlers.handleWebcrackUnpack({ code: 'original-code' }),
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe(
      'webcrack requires Node.js 22.12+ or 24.x; current runtime is 20.0.0',
    );
    expect(response.optionsUsed).toEqual({
      jsx: true,
      mangle: false,
      unminify: true,
      unpack: true,
    });
    expect(response.engine).toBe('webcrack');
  });

  it('returns structured error when webcrack_unpack fails without reason', async () => {
    webcrackState.runWebcrack.mockResolvedValueOnce({
      applied: false,
      code: 'original-code',
      optionsUsed: { jsx: true, mangle: false, unminify: true, unpack: true },
    } as any);

    const response = parseJson<BaseResponse>(
      await handlers.handleWebcrackUnpack({ code: 'original-code' }),
    );

    expect(response.success).toBe(false);
    expect(response.error).toBe('webcrack execution failed');
    expect(response.engine).toBe('webcrack');
  });

  // ── New engine routing tests ──

  it('routes engine=jscrambler to JScramberDeobfuscator', async () => {
    deps.jscramblerDeobfuscator.deobfuscate.mockResolvedValue({
      code: 'jscrambler-cleaned',
      success: true,
      transformations: ['control-flow-restored'],
      warnings: [],
      confidence: 0.8,
    });

    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'jscrambler-obfuscated',
        engine: 'jscrambler',
      }),
    );

    expect(deps.jscramblerDeobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'jscrambler-obfuscated',
    });
    expect(body.success).toBe(true);
    expect(body.code).toBe('jscrambler-cleaned');
    expect(body.transformations).toEqual(['control-flow-restored']);
  });

  it('routes engine=packer to UniversalUnpacker', async () => {
    deps.packerDeobfuscator.deobfuscate.mockResolvedValue({
      code: 'unpacked-code',
      type: 'Packer',
      success: true,
    });

    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'eval(function(p,a,c,k,e,d)...',
        engine: 'packer',
      }),
    );

    expect(deps.packerDeobfuscator.deobfuscate).toHaveBeenCalledWith(
      'eval(function(p,a,c,k,e,d)...',
    );
    expect(body.success).toBe(true);
    expect(body.code).toBe('unpacked-code');
    expect(body.type).toBe('Packer');
  });

  it('routes engine=vm to VMDeobfuscator (detected)', async () => {
    deps.vmDeobfuscator.detectVMProtection.mockReturnValue({
      detected: true,
      type: 'custom-vm',
      instructionCount: 42,
    });
    deps.vmDeobfuscator.deobfuscateVM.mockResolvedValue({
      success: true,
      code: 'vm-cleaned',
    });

    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'while(true){switch(pc){case 0:...}}',
        engine: 'vm',
      }),
    );

    expect(deps.vmDeobfuscator.detectVMProtection).toHaveBeenCalled();
    expect(deps.vmDeobfuscator.deobfuscateVM).toHaveBeenCalledWith(
      'while(true){switch(pc){case 0:...}}',
      {
        type: 'custom-vm',
        instructionCount: 42,
      },
    );
    expect(body.success).toBe(true);
    expect(body.code).toBe('vm-cleaned');
    expect(body.detection).toBeDefined();
  });

  it('engine=vm returns error when no VM protection detected', async () => {
    deps.vmDeobfuscator.detectVMProtection.mockReturnValue({
      detected: false,
      type: 'none',
      instructionCount: 0,
    });

    const body = parseJson<DeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'console.log("hello")',
        engine: 'vm',
      }),
    );

    expect(deps.vmDeobfuscator.detectVMProtection).toHaveBeenCalled();
    expect(deps.vmDeobfuscator.deobfuscateVM).not.toHaveBeenCalled();
    expect(body.success).toBe(false);
    expect(body.error).toContain('No VM protection detected');
  });

  it('engine=webcrack still routes to advancedDeobfuscator', async () => {
    deps.advancedDeobfuscator.deobfuscate.mockResolvedValue({
      code: 'raw',
      success: true,
      astOptimized: false,
    });

    const body = parseJson<AdvancedDeobfuscateResponse>(
      await handlers.handleDeobfuscate({
        code: 'obf',
        engine: 'webcrack',
        detectOnly: true,
        unpack: false,
      }),
    );

    expect(deps.advancedDeobfuscator.deobfuscate).toHaveBeenCalledWith({
      code: 'obf',
      detectOnly: true,
      unpack: false,
    });
    expect(body.code).toBe('raw');
  });
});
