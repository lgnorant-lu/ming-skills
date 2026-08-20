import { parseJson } from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExtractor } = vi.hoisted(() => ({
  mockExtractor: {
    attemptNativeBytecodeExtraction: vi.fn(),
    disassembleBytecode: vi.fn(),
    findHiddenClasses: vi.fn(),
    extractBytecode: vi.fn(),
  },
}));

vi.mock('@modules/v8-inspector', () => ({
  // Regular function (not arrow) so it is constructable with `new`; assigns the
  // shared spy methods onto each instance. vi.fn keeps the constructor spyable.
  BytecodeExtractor: vi.fn(function (this: any) {
    Object.assign(this, mockExtractor);
  }),
}));

import { BytecodeExtractor } from '@modules/v8-inspector';
import { DisassembleHandlers } from '@server/domains/debugger/handlers/disassemble-handlers';

describe('DisassembleHandlers', () => {
  const debuggerManager = {
    getPausedState: vi.fn(),
  };
  const getPage = vi.fn();

  let handlers: DisassembleHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new DisassembleHandlers({
      debuggerManager: debuggerManager as any,
      getPage,
    });
  });

  it('resolves scriptId from the current paused top frame and runs native extraction', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce({
      reason: 'breakpoint',
      callFrames: [
        { callFrameId: 'frame-0', location: { scriptId: '42', lineNumber: 7, columnNumber: 1 } },
      ],
    });
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce({
      available: true,
      bytecode: 'LdaSmi [1]\nReturn',
      format: 'v8-disassembly',
      functionName: 'decrypt',
      reason: 'ok',
      rawIgnitionBytecodeAvailable: true,
      sourcePosition: 12,
      supportsNativesSyntax: true,
    });
    mockExtractor.disassembleBytecode.mockReturnValueOnce([
      { offset: 0, opcode: 'LdaSmi', operands: ['1'] },
    ]);
    mockExtractor.findHiddenClasses.mockResolvedValueOnce([{ address: '0x1', properties: ['x'] }]);

    const body = parseJson<any>(await handlers.handleDebuggerDisassemble({}));

    expect(BytecodeExtractor).toHaveBeenCalledWith(getPage);
    expect(mockExtractor.attemptNativeBytecodeExtraction).toHaveBeenCalledWith('42', undefined);
    expect(body.success).toBe(true);
    expect(body.resolvedFrom).toBe('paused');
    expect(body.location).toEqual({ scriptId: '42', lineNumber: 7, columnNumber: 1 });
    expect(body.mode).toBe('native');
    expect(body.bytecodeAvailable).toBe(true);
    expect(body.extraction.functionName).toBe('decrypt');
    expect(body.disassembly).toHaveLength(1);
    expect(body.hiddenClasses).toHaveLength(1);
  });

  it('uses an explicit scriptId without consulting paused state', async () => {
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce({
      available: true,
      bytecode: 'b',
      format: 'v8-disassembly',
      functionName: 'fn',
      reason: 'ok',
      rawIgnitionBytecodeAvailable: false,
      supportsNativesSyntax: true,
    });
    mockExtractor.disassembleBytecode.mockReturnValueOnce([]);
    mockExtractor.findHiddenClasses.mockResolvedValueOnce([]);

    const body = parseJson<any>(await handlers.handleDebuggerDisassemble({ scriptId: '99' }));

    expect(debuggerManager.getPausedState).not.toHaveBeenCalled();
    expect(mockExtractor.attemptNativeBytecodeExtraction).toHaveBeenCalledWith('99', undefined);
    expect(body.resolvedFrom).toBe('explicit');
    expect(body.scriptId).toBe('99');
  });

  it('resolves scriptId from a named callFrameId', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce({
      callFrames: [
        { callFrameId: 'frame-0', location: { scriptId: '1', lineNumber: 0 } },
        { callFrameId: 'frame-1', location: { scriptId: '77', lineNumber: 30 } },
      ],
    });
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce({
      available: true,
      bytecode: 'b',
      format: 'v8-disassembly',
      functionName: 'fn',
      reason: 'ok',
      rawIgnitionBytecodeAvailable: false,
      supportsNativesSyntax: true,
    });
    mockExtractor.disassembleBytecode.mockReturnValueOnce([]);
    mockExtractor.findHiddenClasses.mockResolvedValueOnce([]);

    await handlers.handleDebuggerDisassemble({ callFrameId: 'frame-1' });

    expect(mockExtractor.attemptNativeBytecodeExtraction).toHaveBeenCalledWith('77', undefined);
  });

  it('fails when not paused and no scriptId is given', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce(undefined);

    const body = parseJson<any>(await handlers.handleDebuggerDisassemble({}));

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No scriptId resolved/);
    expect(mockExtractor.attemptNativeBytecodeExtraction).not.toHaveBeenCalled();
  });

  it('fails when the named callFrameId is not in the paused stack', async () => {
    debuggerManager.getPausedState.mockReturnValueOnce({
      callFrames: [{ callFrameId: 'frame-0', location: { scriptId: '1', lineNumber: 0 } }],
    });

    const body = parseJson<any>(
      await handlers.handleDebuggerDisassemble({ callFrameId: 'missing' }),
    );

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/No paused call frame with callFrameId "missing"/);
  });

  it('reports honest unavailable when no page context is wired', async () => {
    const noPageHandlers = new DisassembleHandlers({ debuggerManager: debuggerManager as any });

    const body = parseJson<any>(await noPageHandlers.handleDebuggerDisassemble({ scriptId: '5' }));

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Page context unavailable/);
    expect(mockExtractor.attemptNativeBytecodeExtraction).not.toHaveBeenCalled();
  });

  it('returns source-fallback mode when native unavailable and fallback enabled', async () => {
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce({
      available: false,
      bytecode: null,
      format: null,
      functionName: 'fn',
      reason: 'V8 natives syntax is unavailable',
      rawIgnitionBytecodeAvailable: false,
      supportsNativesSyntax: false,
    });
    mockExtractor.findHiddenClasses.mockResolvedValueOnce([]);
    const fallbackBytecode = { functionName: 'fn', bytecode: 'pseudo', sourcePosition: 0 };
    mockExtractor.extractBytecode.mockResolvedValueOnce(fallbackBytecode);
    mockExtractor.disassembleBytecode.mockReturnValueOnce([
      { offset: 0, opcode: 'Store', operands: [] },
    ]);

    const body = parseJson<any>(
      await handlers.handleDebuggerDisassemble({ scriptId: '9', includeSourceFallback: true }),
    );

    expect(body.success).toBe(true);
    expect(body.mode).toBe('source-fallback');
    expect(body.bytecodeAvailable).toBe(false);
    expect(body.sourceFallback.extraction).toEqual(fallbackBytecode);
    expect(mockExtractor.extractBytecode).toHaveBeenCalledWith('9', undefined);
  });

  it('returns unavailable mode when native fails and fallback is disabled', async () => {
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce({
      available: false,
      bytecode: null,
      format: null,
      functionName: 'fn',
      reason: 'no natives',
      rawIgnitionBytecodeAvailable: false,
      supportsNativesSyntax: false,
    });
    mockExtractor.findHiddenClasses.mockResolvedValueOnce([]);

    const body = parseJson<any>(await handlers.handleDebuggerDisassemble({ scriptId: '9' }));

    expect(body.success).toBe(true);
    expect(body.mode).toBe('unavailable');
    expect(body.sourceFallback).toBeNull();
    expect(mockExtractor.extractBytecode).not.toHaveBeenCalled();
  });

  it('fails when the extractor cannot resolve a function context', async () => {
    mockExtractor.attemptNativeBytecodeExtraction.mockResolvedValueOnce(null);

    const body = parseJson<any>(await handlers.handleDebuggerDisassemble({ scriptId: '404' }));

    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Unable to inspect bytecode/);
  });
});
